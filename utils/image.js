// ============================================================
// utils/image.js
// 图片处理 + 质量检测 + ROI 裁剪增强
// ============================================================

var config = require('./config')
var analytics = require('./analytics')

// ============================================================
// 核心图片处理（保留原有逻辑）
// ============================================================

function processImage(path, pageContext) {
  return new Promise(function (resolve, reject) {
    var MAX_DIM = 1280
    var COMPRESS_QUALITY = 0.7

    wx.getImageInfo({
      src: path,
      success: function (info) {
        var needResize = info.width > MAX_DIM || info.height > MAX_DIM
        if (needResize && pageContext) {
          resizeWithCanvas(path, info, MAX_DIM, COMPRESS_QUALITY, pageContext, resolve, reject)
        } else {
          compressAndRead(path, info, COMPRESS_QUALITY, pageContext, resolve, reject)
        }
      },
      fail: function () {
        compressAndRead(path, null, COMPRESS_QUALITY, pageContext, resolve, reject)
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
              fail: reject
            })
          },
          fail: function () { compressAndRead(path, info, quality, pageContext, resolve, reject, true) }
        })
      }
      img.onerror = function () { compressAndRead(path, info, quality, pageContext, resolve, reject, true) }
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
        fail: reject
      })
    },
    fail: function () {
      if (!noCanvasFallback && pageContext && info) {
        resizeWithCanvas(path, info, 1280, quality, pageContext, resolve, reject)
      } else {
        wx.getFileSystemManager().readFile({
          filePath: path, encoding: 'base64',
          success: function (fileRes) { resolve('data:image/jpeg;base64,' + fileRes.data) },
          fail: reject
        })
      }
    }
  })
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

// ============================================================
// 持久化存储
// ============================================================

function saveImagePermanent(tempFilePath) {
  return new Promise(function (resolve) {
    if (!tempFilePath) return resolve({ path: '', newlySaved: false })
    var userDataPath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ''
    var isPermanent = userDataPath && tempFilePath.indexOf(userDataPath) === 0
    if (isPermanent) return resolve({ path: tempFilePath, newlySaved: false })

    wx.saveFile({
      tempFilePath: tempFilePath,
      success: function (res) { resolve({ path: res.savedFilePath, newlySaved: true }) },
      fail: function (err) {
        console.warn('[VetAI] 图片持久化失败', err)
        resolve({ path: '', originalPath: tempFilePath, newlySaved: false, saveFailed: true })
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

module.exports = {
  processImage: processImage,
  checkImageQuality: checkImageQuality,
  checkImageSizes: checkImageSizes,
  buildModelImageBundle: buildModelImageBundle,
  cropLesionRegion: cropLesionRegion,
  cropAllLesionRegions: cropAllLesionRegions,
  saveImagePermanent: saveImagePermanent,
  saveImagesPermanent: saveImagesPermanent,
  cleanupSavedFiles: cleanupSavedFiles
}
