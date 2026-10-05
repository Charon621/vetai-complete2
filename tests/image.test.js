// ============================================================
// tests/image.test.js
// utils/image.js 可纯逻辑测试部分：
//   - buildModelImageBundle：送模型图片的数量裁剪与角色分配（原图/ROI）
//   - checkImageSizes：超大 base64 预警
//   - base64ToLocalFile：data URL 前缀剥离 / 扩展名 / 目录 / 失败降级
//   - processImage：data URL 直通
//   - localPathsToBase64：本地路径回读与失败过滤
//   - prepareImages：maxCount/existingCount 截断、进度回调、
//     落盘成功/失败时 displayPath 降级、质检兜底
// wx 通过 global.wx 最小 stub（文件系统 / getImageInfo 可控行为）。
// 说明：processImage 的真机压缩链路（compressImage/canvas）依赖渲染层，
// 文件大小分支用 stub 验证；实际压缩效果和 canvas 渲染不在本套件范围内。
// 直接 node tests/image.test.js 执行，无测试框架
// ============================================================

const assert = require('assert')

// ---------- wx stub（必须在 require 前就位：image.js 顶层读 wx.env） ----------
const stored = {}
let writeFileCalls = []
let writeFileShouldFail = false
let readFileHandler = null

const fsStub = {
  access: function (opts) { opts.success() },
  mkdir: function (opts) { opts.success() },
  copyFile: function (opts) { opts.fail({ errMsg: 'copyFile:fail stub' }) },
  writeFile: function (opts) {
    writeFileCalls.push(opts)
    if (writeFileShouldFail) opts.fail({ errMsg: 'writeFile:fail stub' })
    else opts.success()
  },
  readFile: function (opts) {
    if (readFileHandler) return readFileHandler(opts)
    opts.fail({ errMsg: 'readFile:fail stub' })
  },
  unlink: function () {}
}

global.wx = {
  env: { USER_DATA_PATH: '/user-data' },
  getStorageSync: function (key) { return stored[key] },
  setStorageSync: function (key, value) { stored[key] = value },
  removeStorageSync: function (key) { delete stored[key] },
  getFileSystemManager: function () { return fsStub },
  // 质检链路首步：直接 fail，让 checkImageQuality 走 isFallback 兜底
  getImageInfo: function (opts) { opts.fail({ errMsg: 'getImageInfo:fail stub' }) }
}

const config = require('../utils/config')
const imageUtil = require('../utils/image')

// ============================================================
// buildModelImageBundle：数量裁剪与角色分配（纯函数）
// ============================================================

const MAX_MODEL = config.MAX_MODEL_IMAGES // 当前 2
const MAX_ROI = config.MAX_ROI_IMAGES     // 当前 1

// 无 ROI：基础图裁到 MAX_MODEL_IMAGES，角色按位对应
const noRoi = imageUtil.buildModelImageBundle(
  ['data:b64,A', 'data:b64,B', 'data:b64,C'],
  ['overview', 'closeup', 'extra'],
  []
)
assert.strictEqual(noRoi.images.length, MAX_MODEL, 'no-roi bundle trimmed to MAX_MODEL_IMAGES')
assert.deepStrictEqual(noRoi.images, ['data:b64,A', 'data:b64,B'], 'keeps leading base images')
assert.deepStrictEqual(noRoi.roles, ['overview', 'closeup'], 'roles follow base order')
assert.strictEqual(noRoi.droppedCount, 1, 'dropped count reflects trimmed base images')

// 有 ROI：ROI 保底占位，基础图让位
const withRoi = imageUtil.buildModelImageBundle(
  ['data:b64,A', 'data:b64,B'],
  ['overview', 'closeup'],
  ['data:b64,ROI1']
)
assert.strictEqual(withRoi.images.length, MAX_MODEL, 'roi bundle still capped at MAX_MODEL_IMAGES')
assert.deepStrictEqual(withRoi.images, ['data:b64,A', 'data:b64,ROI1'], 'roi appended after base slots')
assert.deepStrictEqual(withRoi.roles, ['overview', 'roi'], 'roi images tagged with roi role')
assert.strictEqual(withRoi.droppedCount, 1, 'base image displaced by roi counts as dropped')

// ROI 超限：只保留 MAX_ROI_IMAGES 张
const excessRoi = imageUtil.buildModelImageBundle(
  ['data:b64,A'],
  ['overview'],
  ['data:b64,ROI1', 'data:b64,ROI2']
)
assert.strictEqual(excessRoi.roles.filter(function (r) { return r === 'roi' }).length, MAX_ROI,
  'roi images trimmed to MAX_ROI_IMAGES')
assert.strictEqual(excessRoi.droppedCount, 1, 'trimmed roi counts as dropped')

// 空洞/非数组输入：过滤 falsy、不抛异常
const holey = imageUtil.buildModelImageBundle(['data:b64,A', null, '', 'data:b64,B'], [], [undefined])
assert.deepStrictEqual(holey.images, ['data:b64,A', 'data:b64,B'], 'falsy entries filtered')
assert.deepStrictEqual(holey.roles, ['', ''], 'missing roles default to empty string')
const emptyBundle = imageUtil.buildModelImageBundle(null, null, null)
assert.deepStrictEqual(emptyBundle.images, [], 'null inputs -> empty bundle')
assert.strictEqual(emptyBundle.droppedCount, 0, 'null inputs -> nothing dropped')

// ============================================================
// checkImageSizes：超大 base64 预警
// ============================================================

assert.deepStrictEqual(imageUtil.checkImageSizes(null), [], 'null list -> no warnings')
assert.deepStrictEqual(imageUtil.checkImageSizes(['data:b64,tiny']), [], 'small image -> no warnings')
const oversized = 'x'.repeat(Math.ceil(config.MAX_BASE64_LENGTH) + 1)
const sizeWarnings = imageUtil.checkImageSizes(['data:b64,small', oversized])
assert.strictEqual(sizeWarnings.length, 1, 'only oversized image warned')
assert.ok(sizeWarnings[0].indexOf('第 2 张') === 0, 'warning names the 1-based image index')

// ============================================================
// 异步用例
// ============================================================

async function run() {
  // ---------- processImage：data URL 直通，不触碰 wx 文件系统 ----------
  const passthrough = await imageUtil.processImage('data:image/jpeg;base64,RAW', null)
  assert.strictEqual(passthrough, 'data:image/jpeg;base64,RAW', 'data url passes through untouched')
  const emptyPath = await imageUtil.processImage('', null)
  assert.strictEqual(emptyPath, '', 'empty path resolves as-is')

  // 新文件 API：小图直接读、大文件压缩，取大小失败仍可读原图。
  const originalGetImageInfo = wx.getImageInfo
  wx.getImageInfo = function (opts) { opts.success({ width: 640, height: 480 }) }
  let fileSize = 100 * 1024
  let fileInfoFails = false
  const compressedPaths = []
  fsStub.getFileInfo = function (opts) {
    assert.strictEqual(opts.filePath, '/tmp/photo.jpg')
    if (fileInfoFails) opts.fail({ errMsg: 'getFileInfo:fail stub' })
    else opts.success({ size: fileSize })
  }
  wx.compressImage = function (opts) {
    compressedPaths.push(opts.src)
    opts.success({ tempFilePath: '/tmp/compressed.jpg' })
  }
  readFileHandler = function (opts) {
    opts.success({ data: opts.filePath === '/tmp/compressed.jpg' ? 'COMPRESSED' : 'ORIGINAL' })
  }
  assert.strictEqual(await imageUtil.processImage('/tmp/photo.jpg', null), 'data:image/jpeg;base64,ORIGINAL')
  assert.strictEqual(compressedPaths.length, 0, 'small files skip compression')
  fileSize = 900 * 1024
  assert.strictEqual(await imageUtil.processImage('/tmp/photo.jpg', null), 'data:image/jpeg;base64,COMPRESSED')
  assert.deepStrictEqual(compressedPaths, ['/tmp/photo.jpg'], 'large files still compress')
  fileInfoFails = true
  assert.strictEqual(await imageUtil.processImage('/tmp/photo.jpg', null), 'data:image/jpeg;base64,ORIGINAL')
  assert.strictEqual(compressedPaths.length, 1, 'file info failure falls back to reading original')
  wx.getImageInfo = originalGetImageInfo
  delete wx.compressImage
  delete fsStub.getFileInfo
  readFileHandler = null

  // ---------- base64ToLocalFile：前缀剥离 / 扩展名 / 目录 ----------
  writeFileCalls = []
  const jpgPath = await imageUtil.base64ToLocalFile('data:image/jpeg;base64,QUJD', '/orig.jpg')
  assert.strictEqual(writeFileCalls.length, 1, 'jpeg data url written once')
  assert.strictEqual(writeFileCalls[0].data, 'QUJD', 'data url prefix stripped before write')
  assert.strictEqual(writeFileCalls[0].encoding, 'base64', 'written as base64')
  assert.ok(jpgPath.indexOf('/user-data/vetai_tmp/img_') === 0, 'default dir is vetai_tmp')
  assert.ok(/\.jpg$/.test(jpgPath), 'jpeg data url gets .jpg extension')

  const pngPath = await imageUtil.base64ToLocalFile('data:image/png;base64,QUJD', '', 'vetai_saved')
  assert.ok(pngPath.indexOf('/user-data/vetai_saved/img_') === 0, 'custom dirName honored')
  assert.ok(/\.png$/.test(pngPath), 'png data url gets .png extension')

  // 非 data URL：原样返回、不写文件
  writeFileCalls = []
  const notData = await imageUtil.base64ToLocalFile('/tmp/raw.jpg', '/tmp/raw.jpg')
  assert.strictEqual(notData, '/tmp/raw.jpg', 'non-data-url input returns originalPath')
  assert.strictEqual(writeFileCalls.length, 0, 'non-data-url input never writes')

  // 写盘失败：降级返回 originalPath
  writeFileShouldFail = true
  const failedWrite = await imageUtil.base64ToLocalFile('data:image/jpeg;base64,QUJD', '/orig.jpg')
  assert.strictEqual(failedWrite, '/orig.jpg', 'write failure falls back to originalPath')
  writeFileShouldFail = false

  // ---------- localPathsToBase64：data URL 直通 + 本地路径回读 + 失败过滤 ----------
  readFileHandler = function (opts) {
    if (opts.filePath === '/user-data/ok.jpg') opts.success({ data: 'T0s=' })
    else opts.fail({ errMsg: 'not found' })
  }
  const readBack = await imageUtil.localPathsToBase64(
    ['data:image/jpeg;base64,KEEP', '/user-data/ok.jpg', '/user-data/missing.jpg', ''])
  assert.deepStrictEqual(readBack,
    ['data:image/jpeg;base64,KEEP', 'data:image/jpeg;base64,T0s='],
    'data urls pass through, readable paths converted, failures filtered')
  readFileHandler = null
  assert.deepStrictEqual(await imageUtil.localPathsToBase64([]), [], 'empty list -> []')

  // ---------- prepareImages：截断计算 ----------
  const b64s = [
    'data:image/jpeg;base64,ONE',
    'data:image/jpeg;base64,TWO',
    'data:image/jpeg;base64,THREE',
    'data:image/jpeg;base64,FOUR'
  ]

  // 非数组输入：空结果 + truncated 0
  const noInput = await imageUtil.prepareImages(null, { savePermanent: false, checkQuality: false })
  assert.strictEqual(noInput.length, 0, 'null input -> empty result')
  assert.strictEqual(noInput.truncated, 0, 'null input -> truncated 0')

  // maxCount=5 已有 3 张：4 张新图只留 2 张，截掉 2 张
  const progress = []
  const truncatedRes = await imageUtil.prepareImages(b64s, {
    maxCount: 5,
    existingCount: 3,
    savePermanent: false,
    checkQuality: false,
    onProgress: function (done, total) { progress.push([done, total]) }
  })
  assert.strictEqual(truncatedRes.length, 2, 'kept count = maxCount - existingCount')
  assert.strictEqual(truncatedRes.truncated, 2, 'truncated count recorded on result array')
  assert.strictEqual(truncatedRes[0].base64, b64s[0], 'kept images preserve order')
  assert.strictEqual(truncatedRes[0].originalPath, b64s[0], 'originalPath recorded')
  assert.deepStrictEqual(progress, [[1, 2], [2, 2]], 'onProgress reports done/total per image')

  // 未设 maxCount：全量保留
  const allKept = await imageUtil.prepareImages(b64s, { savePermanent: false, checkQuality: false })
  assert.strictEqual(allKept.length, 4, 'no maxCount -> keep all')
  assert.strictEqual(allKept.truncated, 0, 'no maxCount -> truncated 0')

  // 已有数量达上限：全部截掉
  const allTruncated = await imageUtil.prepareImages(b64s.slice(0, 2), {
    maxCount: 3, existingCount: 3, savePermanent: false, checkQuality: false
  })
  assert.strictEqual(allTruncated.length, 0, 'existingCount at cap -> nothing kept')
  assert.strictEqual(allTruncated.truncated, 2, 'all inputs counted as truncated')

  // ---------- prepareImages：displayPath 落盘成功 / 失败降级 ----------
  const savedRes = await imageUtil.prepareImages([b64s[0]], { checkQuality: false })
  assert.ok(savedRes[0].displayPath.indexOf('/user-data/vetai_saved/img_') === 0,
    'savePermanent stores displayPath under vetai_saved')
  assert.strictEqual(savedRes[0].base64, b64s[0], 'base64 kept alongside saved path')

  writeFileShouldFail = true
  const fallbackRes = await imageUtil.prepareImages([b64s[0]], { checkQuality: false })
  assert.strictEqual(fallbackRes[0].displayPath, b64s[0],
    'save failure degrades displayPath to base64 (feature must not break)')
  writeFileShouldFail = false

  // savePermanent=false（聊天页选图阶段）：displayPath 直接用 base64
  const unsavedRes = await imageUtil.prepareImages([b64s[0]], { savePermanent: false, checkQuality: false })
  assert.strictEqual(unsavedRes[0].displayPath, b64s[0], 'savePermanent=false keeps base64 displayPath')
  assert.strictEqual(unsavedRes[0].quality, null, 'checkQuality=false leaves quality null')

  // ---------- prepareImages：质检兜底（getImageInfo 失败 -> isFallback） ----------
  const qualityRes = await imageUtil.prepareImages([b64s[0]], { savePermanent: false })
  assert.ok(qualityRes[0].quality, 'checkQuality=true fills quality')
  assert.strictEqual(qualityRes[0].quality.isFallback, true,
    'quality check degrades to fallback when image info unavailable')
  assert.strictEqual(qualityRes[0].quality.score, 80, 'fallback quality score is 80')

  console.log('image tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
