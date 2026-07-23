// ============================================================
// utils/image.js
// 图片处理 + 质量检测 + ROI 裁剪增强
// ============================================================

var config = require('./config')
var analytics = require('./analytics')

var USER_DATA_PATH = (wx.env && wx.env.USER_DATA_PATH) || ''

/**
 * 把 http://tmp/ 等临时路径复制到本地用户目录，避免临时文件被回收或 DevTools 返回假路径
 */
function stabilizeTempFile(path) {
  return new Promise(function (resolve) {
    if (!path || path.indexOf('data:') === 0) return resolve(path)
    if (USER_DATA_PATH && path.indexOf(USER_DATA_PATH) === 0) return resolve(path)

    var fs = wx.getFileSystemManager()
    var dir = USER_DATA_PATH + '/vetai_tmp'
    var dest = dir + '/img_' + Date.now() + '_' + Math.floor(Math.random() * 1000000) + '.jpg'

    function doCopy() {
      fs.copyFile({
        srcPath: path,
        destPath: dest,
        success: function () { resolve(dest) },
        fail: function () { resolve(path) }
      })
    }

    fs.access({
      path: dir,
      success: doCopy,
      fail: function () {
        fs.mkdir({
          dirPath: dir,
          recursive: true,
          success: doCopy,
          fail: function () { resolve(path) }
        })
      }
    })
  })
}

// ============================================================
// 核心图片处理（保留原有逻辑）
// ============================================================

function processImage(path, pageContext) {
  return new Promise(function (resolve, reject) {
    // 只有两步：readFile（真机快路径）→ canvas.toDataURL（DevTools 兜底）
    // 不再走 getImageInfo → compressImage → canvasToTempFilePath 等中间步骤，
    // 消除 DevTools 下大量无意义的 fail 日志
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: function (res) {
        resolve('data:image/jpeg;base64,' + res.data)
      },
      fail: function () {
        canvasToDataURLFallback(path, pageContext, resolve, reject)
      }
    })
  })
}

function resizeWithCanvas(path, info, maxDim, quality, pageContext, resolve, reject) {
  var query = wx.createSelectorQuery().in(pageContext)
  query.select('#resizeCanvas')
    .fields({ node: true, size: true })
    .exec(function (res) {
      if (!res || !res[0] || !res[0].node) {
        console.warn('[VetAI] resizeCanvas node not found, falling back to compress')
        compressAndRead(path, info, quality, pageContext, resolve, reject, true)
        return
      }

      var canvas = res[0].node
      var ctx = canvas.getContext('2d')
      var newWidth = info.width
      var newHeight = info.height
      if (newWidth > newHeight) {
        if (newWidth > maxDim) { newHeight = Math.round(newHeight * maxDim / newWidth); newWidth = maxDim }
      } else {
        if (newHeight > maxDim) { newWidth = Math.round(newWidth * maxDim / newHeight); newHeight = maxDim }
      }

      canvas.width = newWidth
      canvas.height = newHeight
      var img = canvas.createImage()
      img.onload = function () {
        ctx.drawImage(img, 0, 0, newWidth, newHeight)
        wx.canvasToTempFilePath({
          canvas: canvas, fileType: 'jpg', quality: quality,
          success: function (tempRes) {
            wx.getFileSystemManager().readFile({
              filePath: tempRes.tempFilePath, encoding: 'base64',
              success: function (fileRes) { resolve('data:image/jpeg;base64,' + fileRes.data) },
              fail: function (err) {
                console.warn('[VetAI] readFile (canvas temp) failed:', err)
                readAsBase64Fallback(path, pageContext, resolve, reject)
              }
            })
          },
          fail: function () { compressAndRead(path, info, quality, pageContext, resolve, reject, true) }
        })
      }
      img.onerror = function () {
        console.warn('[VetAI] canvas image load failed, falling back to compress')
        compressAndRead(path, info, quality, pageContext, resolve, reject, true)
      }
      img.src = info.path || path
    })
}

function compressAndRead(path, info, quality, pageContext, resolve, reject, noCanvasFallback) {
  wx.compressImage({
    src: path, quality: Math.round(quality * 100),
    success: function (cres) {
      wx.getFileSystemManager().readFile({
        filePath: cres.tempFilePath, encoding: 'base64',
        success: function (fileRes) { resolve('data:image/jpeg;base64,' + fileRes.data) },
        fail: function (err) {
          console.warn('[VetAI] readFile (compressed) failed:', err)
          // 压缩后文件读取失败，尝试读原始文件
          readAsBase64Fallback(path, pageContext, resolve, reject)
        }
      })
    },
    fail: function (err) {
      console.warn('[VetAI] compressImage failed:', err, 'path:', path)
      if (!noCanvasFallback && pageContext && info) {
        resizeWithCanvas(path, info, 1280, quality, pageContext, resolve, reject)
      } else {
        // compressImage 失败，直接读原始文件
        readAsBase64Fallback(path, pageContext, resolve, reject)
      }
    }
  })
}

/**
 * 最终兜底：尝试多种方式读取文件为 base64
 * 1. 直接 readFile base64
 * 2. 如果 base64 失败，用 ArrayBuffer 读取再手动转 base64
 * 3. 如果都失败，用 canvas.toDataURL 直接从渲染层获取 base64（DevTools 临时文件系统异常时有效）
 */
function readAsBase64Fallback(path, pageContext, resolve, reject) {
  wx.getFileSystemManager().readFile({
    filePath: path, encoding: 'base64',
    success: function (fileRes) {
      resolve('data:image/jpeg;base64,' + fileRes.data)
    },
    fail: function (err) {
      console.warn('[VetAI] readFile (base64) failed, trying ArrayBuffer:', err)
      // 最后兜底：用 ArrayBuffer 读取再手动转 base64
      wx.getFileSystemManager().readFile({
        filePath: path,
        success: function (bufRes) {
          try {
            var base64 = arrayBufferToBase64(bufRes.data)
            resolve('data:image/jpeg;base64,' + base64)
          } catch (e) {
            console.error('[VetAI] all file read methods failed, trying canvas.toDataURL:', e)
            canvasToDataURLFallback(path, pageContext, resolve, reject)
          }
        },
        fail: function (err2) {
          console.error('[VetAI] readFile (ArrayBuffer) also failed, trying canvas.toDataURL:', err2)
          canvasToDataURLFallback(path, pageContext, resolve, reject)
        }
      })
    }
  })
}

/**
 * 通过 canvas 2d 的 toDataURL 把图片转成 base64
 * 用于 DevTools 等环境下临时文件系统返回虚假路径、readFile/compressImage 均失败的情况
 */
function canvasToDataURLFallback(path, pageContext, resolve, reject) {
  if (!pageContext) {
    reject({ errMsg: 'processImage: no pageContext for canvas fallback' })
    return
  }
  // 静默：DevTools 下这是正常路径，不需要打日志
  wx.getImageInfo({
    src: path,
    success: function (info) { doCanvasToDataURL(path, info, pageContext, resolve, reject) },
    fail: function () {
      doCanvasToDataURL(path, { width: 1280, height: 1280 }, pageContext, resolve, reject)
    }
  })
}

function doCanvasToDataURL(path, info, pageContext, resolve, reject) {
  var query = pageContext.createSelectorQuery ? pageContext.createSelectorQuery() : wx.createSelectorQuery().in(pageContext)
  query.select('#fallbackCanvas')
    .fields({ node: true, size: true })
    .exec(function (res) {
      if (!res || !res[0] || !res[0].node) {
        reject({ errMsg: 'canvasToDataURLFallback: canvas node not found' })
        return
      }

      var canvas = res[0].node
      var ctx = canvas.getContext('2d')
      var maxDim = 1280
      var w = info.width || 1280
      var h = info.height || 1280
      if (w > h) {
        if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim }
      } else {
        if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim }
      }
      canvas.width = w
      canvas.height = h
      ctx.clearRect(0, 0, w, h)

      var img = canvas.createImage()
      img.onload = function () {
        ctx.drawImage(img, 0, 0, w, h)
        try {
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          if (dataUrl && dataUrl.indexOf('data:image') === 0) {
            resolve(dataUrl)
          } else {
            throw new Error('invalid data url')
          }
        } catch (e) {
          try {
            var pngUrl = canvas.toDataURL('image/png')
            if (pngUrl && pngUrl.indexOf('data:image') === 0) {
              resolve(pngUrl)
            } else {
              reject({ errMsg: 'processImage: canvas toDataURL returned invalid data' })
            }
          } catch (e2) {
            reject({ errMsg: 'processImage: canvas toDataURL failed' })
          }
        }
      }
      img.onerror = function () { reject({ errMsg: 'processImage: canvas image load failed' }) }
      img.src = path
    })
}

/**
 * ArrayBuffer 转 base64
 * 优先使用内置 API（部分基础库支持），否则手动分块编码
 */
function arrayBufferToBase64(buffer) {
  // 优先使用内置 API（旧版基础库可用）
  if (typeof wx !== 'undefined' && typeof wx.arrayBufferToBase64 === 'function') {
    return wx.arrayBufferToBase64(buffer)
  }
  // 手动分块编码（避免栈溢出）
  var bytes = new Uint8Array(buffer)
  var len = bytes.byteLength
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  var result = ''
  var chunkSize = 8192
  for (var i = 0; i < len; i += chunkSize) {
    var end = Math.min(i + chunkSize, len)
    for (var j = i; j < end; j += 3) {
      var byte1 = bytes[j] || 0
      var byte2 = bytes[j + 1]
      var byte3 = bytes[j + 2]
      result += chars.charAt(byte1 >> 2)
      result += chars.charAt(((byte1 & 3) << 4) | ((byte2 || 0) >> 4))
      result += (byte2 === undefined) ? '=' : chars.charAt(((byte2 & 15) << 2) | ((byte3 || 0) >> 6))
      result += (byte3 === undefined) ? '=' : chars.charAt(byte3 & 63)
    }
  }
  return result
}

// ============================================================
// 图片质量检测（新增）
// ============================================================

/**
 * 检测图片质量：模糊 / 过曝 / 过暗
 * 使用 Canvas 采样 → 计算亮度方差和平均亮度
 */
function checkImageQuality(imagePath, pageContext) {
  return new Promise(function (resolve) {
    var fallback = { isBlurry: false, isOverexposed: false, isTooDark: false, score: 80, suggestions: [] }

    wx.getImageInfo({
      src: imagePath,
      success: function (info) {
        var sampleSize = 64
        var scale = sampleSize / Math.max(info.width, info.height)
        var sw = Math.max(1, Math.round(info.width * scale))
        var sh = Math.max(1, Math.round(info.height * scale))

        var query = wx.createSelectorQuery().in(pageContext)
        query.select('#qualityCanvas')
          .fields({ node: true, size: true })
          .exec(function (res) {
            if (!res || !res[0] || !res[0].node) { resolve(fallback); return }

            var canvas = res[0].node
            var ctx = canvas.getContext('2d')
            canvas.width = sw
            canvas.height = sh
            ctx.clearRect(0, 0, sw, sh)

            var img = canvas.createImage()
            img.onload = function () {
              ctx.drawImage(img, 0, 0, sw, sh)
              try {
                var imageData = ctx.getImageData(0, 0, sw, sh)
                var pixels = imageData.data
                var totalPixels = sw * sh
                var totalBrightness = 0
                var brightnesses = []

                for (var i = 0; i < pixels.length; i += 4) {
                  var b = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114
                  brightnesses.push(b)
                  totalBrightness += b
                }
                var avgBrightness = totalBrightness / totalPixels

                var variance = 0
                for (var j = 0; j < brightnesses.length; j++) {
                  variance += (brightnesses[j] - avgBrightness) * (brightnesses[j] - avgBrightness)
                }
                variance = variance / totalPixels

                // 阈值为经验初值，未经数据校准：
                //   variance < 150 判模糊（像素亮度方差低 → 缺高频细节）
                //   avgBrightness > 230 判过曝、< 35 判过暗
                // 已埋点 imageQuality（见下方），攒够样本后应用分布重新校准这 3 个阈值
                var isBlurry = variance < 150
                var isOverexposed = avgBrightness > 230
                var isTooDark = avgBrightness < 35

                var score = 100
                if (isBlurry) score -= 35
                if (isOverexposed) score -= 30
                if (isTooDark) score -= 30
                if (variance < 80) score -= 15
                score = Math.max(0, Math.min(100, score))

                var suggestions = []
                if (isBlurry) suggestions.push('图片偏模糊，请对焦后重新拍摄')
                if (isOverexposed) suggestions.push('图片过曝，请避免强光直射')
                if (isTooDark) suggestions.push('图片过暗，请在光线充足环境下拍摄')

                // 埋点：记录亮度方差/平均亮度的 raw 分布，用于后续用真实数据校准阈值
                try {
                  analytics.track('imageQuality', {
                    score: Math.max(0, Math.min(100, score)),
                    variance: Math.round(variance),
                    avgBrightness: Math.round(avgBrightness),
                    isBlurry: isBlurry, isOverexposed: isOverexposed, isTooDark: isTooDark
                  })
                } catch (e) {}

                resolve({
                  isBlurry: isBlurry, isOverexposed: isOverexposed, isTooDark: isTooDark,
                  score: score, suggestions: suggestions,
                  variance: Math.round(variance), avgBrightness: Math.round(avgBrightness)
                })
              } catch (e) { resolve(fallback) }
            }
            img.onerror = function () { resolve(fallback) }
            img.src = imagePath
          })
      },
      fail: function () { resolve(fallback) }
    })
  })
}

// ============================================================
// 图片大小检查
// ============================================================

function checkImageSizes(imageBase64List) {
  var maxLen = config.MAX_BASE64_LENGTH || (4 * 1024 * 1024)
  var warnings = []
  ;(imageBase64List || []).forEach(function (img, i) {
    if (typeof img === 'string' && img.length > maxLen) {
      warnings.push('第 ' + (i + 1) + ' 张图片较大（' + Math.round(img.length / 1024 / 1024 * 10) / 10 + 'MB），可能导致请求超时')
    }
  })
  return warnings
}

function buildModelImageBundle(baseImages, baseRoles, roiImages) {
  baseImages = Array.isArray(baseImages) ? baseImages.filter(Boolean) : []
  baseRoles = Array.isArray(baseRoles) ? baseRoles : []
  roiImages = Array.isArray(roiImages) ? roiImages.filter(Boolean) : []

  var maxImages = config.MAX_MODEL_IMAGES || config.MAX_IMAGES || 5
  var maxRoi = Math.min(config.MAX_ROI_IMAGES || 2, roiImages.length, maxImages)

  if (roiImages.length === 0) {
    return {
      images: baseImages.slice(0, maxImages),
      roles: baseImages.slice(0, maxImages).map(function (_, i) { return baseRoles[i] || '' }),
      droppedCount: Math.max(0, baseImages.length - maxImages)
    }
  }

  var baseSlots = Math.max(0, maxImages - maxRoi)
  var selectedBase = baseImages.slice(0, baseSlots)
  var selectedRoi = roiImages.slice(0, maxRoi)
  var selectedBaseRoles = selectedBase.map(function (_, i) { return baseRoles[i] || '' })

  return {
    images: selectedBase.concat(selectedRoi),
    roles: selectedBaseRoles.concat(selectedRoi.map(function () { return 'roi' })),
    droppedCount: Math.max(0, baseImages.length - selectedBase.length) +
      Math.max(0, roiImages.length - selectedRoi.length)
  }
}

// ============================================================
// ROI 裁剪增强（新增 — 准确率提升最大杠杆）
// ============================================================

/**
 * 根据圈选坐标裁剪患处区域，放大 2x 作为额外输入
 */
function cropLesionRegion(imagePath, lesionBox, pageContext) {
  if (!lesionBox || !imagePath || !pageContext) return Promise.resolve(null)

  return new Promise(function (resolve) {
    wx.getImageInfo({
      src: imagePath,
      success: function (info) {
        var px = lesionBox.x * info.width
        var py = lesionBox.y * info.height
        var pw = lesionBox.width * info.width
        var ph = lesionBox.height * info.height

        // 放大 1.5x 周围区域
        var expandX = pw * 0.25
        var expandY = ph * 0.25
        var sx = Math.max(0, Math.round(px - expandX))
        var sy = Math.max(0, Math.round(py - expandY))
        var sw = Math.min(info.width - sx, Math.round(pw + expandX * 2))
        var sh = Math.min(info.height - sy, Math.round(ph + expandY * 2))

        var maxOut = 640
        var outScale = Math.min(1, maxOut / Math.max(sw, sh))
        var outW = Math.max(1, Math.round(sw * outScale))
        var outH = Math.max(1, Math.round(sh * outScale))

        var query = wx.createSelectorQuery().in(pageContext)
        query.select('#resizeCanvas')
          .fields({ node: true, size: true })
          .exec(function (res) {
            if (!res || !res[0] || !res[0].node) { resolve(null); return }

            var canvas = res[0].node
            var ctx = canvas.getContext('2d')
            canvas.width = outW
            canvas.height = outH
            ctx.clearRect(0, 0, outW, outH)

            var img = canvas.createImage()
            img.onload = function () {
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
              wx.canvasToTempFilePath({
                canvas: canvas, fileType: 'jpg', quality: 0.62,
                success: function (tmpRes) {
                  wx.getFileSystemManager().readFile({
                    filePath: tmpRes.tempFilePath, encoding: 'base64',
                    success: function (fileRes) { resolve('data:image/jpeg;base64,' + fileRes.data) },
                    fail: function () { resolve(null) }
                  })
                },
                fail: function () { resolve(null) }
              })
            }
            img.onerror = function () { resolve(null) }
            img.src = imagePath
          })
      },
      fail: function () { resolve(null) }
    })
  })
}

/**
 * 批量裁剪所有患处区域
 */
function cropAllLesionRegions(imagePaths, lesionBoxes, pageContext) {
  var promises = []
  for (var i = 0; i < imagePaths.length; i++) {
    if (lesionBoxes[i]) {
      promises.push(cropLesionRegion(imagePaths[i], lesionBoxes[i], pageContext))
    }
  }
  if (promises.length === 0) return Promise.resolve([])
  return Promise.all(promises).then(function (results) { return results.filter(Boolean) })
}

/**
 * 将 base64 图片数据写入本地用户目录，返回本地文件路径
 * 用于 DevTools 等环境下临时路径为假路径时，用已有的 base64 重建真实文件
 */
function base64ToLocalFile(base64, originalPath) {
  return new Promise(function (resolve) {
    if (!base64 || base64.indexOf('data:image') !== 0) return resolve(originalPath)
    var userDataPath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ''
    if (!userDataPath) return resolve(originalPath)

    var fs = wx.getFileSystemManager()
    var dir = userDataPath + '/vetai_tmp'
    var ext = base64.indexOf('data:image/png') === 0 ? 'png' : 'jpg'
    var dest = dir + '/img_' + Date.now() + '_' + Math.floor(Math.random() * 1000000) + '.' + ext
    var data = base64.replace(/^data:image\/[a-zA-Z0-9]+;base64,/, '')

    function doWrite() {
      fs.writeFile({
        filePath: dest,
        data: data,
        encoding: 'base64',
        success: function () { resolve(dest) },
        fail: function () { resolve(originalPath) }
      })
    }

    fs.access({
      path: dir,
      success: doWrite,
      fail: function () {
        fs.mkdir({
          dirPath: dir,
          recursive: true,
          success: doWrite,
          fail: function () { resolve(originalPath) }
        })
      }
    })
  })
}

// ============================================================
// 持久化存储
// ============================================================

function saveImagePermanent(tempFilePath) {
  return new Promise(function (resolve) {
    if (!tempFilePath) return resolve({ path: '', newlySaved: false })

    // 如果是 base64 data URL，直接写入本地用户目录
    if (tempFilePath.indexOf('data:image') === 0) {
      base64ToLocalFile(tempFilePath, '').then(function (localPath) {
        if (localPath && localPath.indexOf('data:') !== 0) {
          resolve({ path: localPath, newlySaved: true })
        } else {
          resolve({ path: '', originalPath: tempFilePath.slice(0, 80), newlySaved: false, saveFailed: true })
        }
      })
      return
    }

    var userDataPath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ''
    var isPermanent = userDataPath && tempFilePath.indexOf(userDataPath) === 0
    if (isPermanent) return resolve({ path: tempFilePath, newlySaved: false })

    var fs = wx.getFileSystemManager()
    var dir = userDataPath + '/vetai_saved'
    var dest = dir + '/img_' + Date.now() + '_' + Math.floor(Math.random() * 1000000) + '.jpg'

    function doCopy() {
      fs.copyFile({
        srcPath: tempFilePath,
        destPath: dest,
        success: function () { resolve({ path: dest, newlySaved: true }) },
        fail: function () {
          resolve({ path: '', originalPath: tempFilePath, newlySaved: false, saveFailed: true })
        }
      })
    }

    fs.access({
      path: dir,
      success: doCopy,
      fail: function () {
        fs.mkdir({
          dirPath: dir,
          recursive: true,
          success: doCopy,
          fail: function () {
            resolve({ path: '', originalPath: tempFilePath, newlySaved: false, saveFailed: true })
          }
        })
      }
    })
  })
}

function saveImagesPermanent(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return Promise.resolve([])
  return Promise.all(paths.map(saveImagePermanent))
}

function cleanupSavedFiles(savedInfos) {
  if (!Array.isArray(savedInfos)) return
  savedInfos.forEach(function (info) {
    if (info && info.newlySaved && info.path) {
      wx.removeSavedFile({ filePath: info.path, fail: function () {} })
    }
  })
}

/**
 * 将本地文件 / data URL 路径列表读回 base64（用于「恢复会话」场景：
 * 持久化时只存了本地路径，真正的 base64 未落盘，诊断前需要读回）
 */
function localPathsToBase64(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return Promise.resolve([])
  return Promise.all(paths.map(function (path) {
    return new Promise(function (resolve) {
      if (!path) return resolve('')
      if (path.indexOf('data:image') === 0) return resolve(path)
      wx.getFileSystemManager().readFile({
        filePath: path,
        encoding: 'base64',
        success: function (res) { resolve('data:image/jpeg;base64,' + res.data) },
        fail: function () { resolve('') }
      })
    })
  })).then(function (list) { return list.filter(Boolean) })
}

module.exports = {
  processImage: processImage,
  checkImageQuality: checkImageQuality,
  checkImageSizes: checkImageSizes,
  buildModelImageBundle: buildModelImageBundle,
  cropLesionRegion: cropLesionRegion,
  cropAllLesionRegions: cropAllLesionRegions,
  saveImagePermanent: saveImagePermanent,
  saveImagesPermanent: saveImagesPermanent,
  cleanupSavedFiles: cleanupSavedFiles,
  localPathsToBase64: localPathsToBase64,
  stabilizeTempFile: stabilizeTempFile,
  base64ToLocalFile: base64ToLocalFile
}
