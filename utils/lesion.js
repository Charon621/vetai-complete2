// ============================================================
// utils/lesion.js
// 患处圈选模块（Canvas 2D）
// 自由圈选 + 矩形模式 + Catmull-Rom 平滑 + 触感反馈
// ============================================================

/**
 * 初始化 Canvas 2D 上下文
 */
function initCanvas(pageContext, canvasId) {
  return new Promise(function (resolve) {
    var query = wx.createSelectorQuery().in(pageContext)
    query.select('#' + canvasId)
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          resolve(null)
          return
        }
        var canvas = res[0].node
        var ctx = canvas.getContext('2d')
        var dpr = 2
        try {
          // wx.getSystemInfoSync 已废弃，优先用新 API（BUG-A1）
          var winInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
          dpr = winInfo.pixelRatio || 2
        } catch (e) {}
        resolve({ canvas: canvas, ctx: ctx, dpr: dpr, sizedWidth: 0, sizedHeight: 0 })
      })
  })
}

/**
 * 触感反馈
 */
function vibrate(type) {
  try {
    if (wx.vibrateShort) {
      wx.vibrateShort({ type: type || 'light' })
    }
  } catch (e) {}
}

/**
 * Catmull-Rom 样条插值 → 平滑路径点
 * 将稀疏的折线点插值为更密集、更平滑的点序列
 */
function smoothPoints(points, tension) {
  if (!points || points.length < 3) return points || []
  tension = tension || 0.5
  var result = []

  for (var i = 0; i < points.length - 1; i++) {
    var p0 = points[i === 0 ? 0 : i - 1]
    var p1 = points[i]
    var p2 = points[i + 1]
    var p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2]

    // 在 p1 和 p2 之间插值；用整数步进避免浮点累加丢掉末点（BUG-I4）
    for (var step = 0; step <= 4; step++) {
      var t = step / 4
      var t2 = t * t
      var t3 = t2 * t

      var x = 0.5 * ((2 * p1.x) +
        (-p0.x + p2.x) * t * tension +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 * tension +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3 * tension)

      var y = 0.5 * ((2 * p1.y) +
        (-p0.y + p2.y) * t * tension +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 * tension +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3 * tension)

      result.push({ x: x, y: y })
    }
  }

  return result
}

/**
 * 绘制圈选路径（使用贝塞尔曲线替代折线，更平滑）
 */
function getAspectFitRect(containerWidth, containerHeight, imageWidth, imageHeight) {
  containerWidth = Number(containerWidth) || 0
  containerHeight = Number(containerHeight) || 0
  imageWidth = Number(imageWidth) || 0
  imageHeight = Number(imageHeight) || 0
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left: 0, top: 0, width: containerWidth, height: containerHeight }
  }
  var containerRatio = containerWidth / containerHeight
  var imageRatio = imageWidth / imageHeight
  var width = containerWidth
  var height = containerHeight
  var left = 0
  var top = 0
  if (imageRatio > containerRatio) {
    height = containerWidth / imageRatio
    top = (containerHeight - height) / 2
  } else {
    width = containerHeight * imageRatio
    left = (containerWidth - width) / 2
  }
  return { left: left, top: top, width: width, height: height }
}

function drawPath(canvasData, points, width, height, mode, drawRect) {
  if (!canvasData || !canvasData.ctx) return

  var ctx = canvasData.ctx
  var canvas = canvasData.canvas
  var box = drawRect || { left: 0, top: 0, width: width, height: height }

  // 只在尺寸变化时重设 canvas（重设会清空并丢失 transform），
  // 避免每次 touchmove 都重建导致低端机卡顿（BUG-I3）
  if (canvasData.sizedWidth !== width || canvasData.sizedHeight !== height) {
    canvas.width = width * canvasData.dpr
    canvas.height = height * canvasData.dpr
    ctx.scale(canvasData.dpr, canvasData.dpr)
    canvasData.sizedWidth = width
    canvasData.sizedHeight = height
  }
  ctx.clearRect(0, 0, width, height)

  if (!points || points.length === 0) return

  var toX = function (p) { return box.left + (p.x / 100) * box.width }
  var toY = function (p) { return box.top + (p.y / 100) * box.height }

  // 矩形模式
  if (mode === 'rectangle' && points.length >= 2) {
    var p1 = points[0]
    var p2 = points[points.length - 1]
    var rx = toX(p1)
    var ry = toY(p1)
    var rw = toX(p2) - rx
    var rh = toY(p2) - ry

    ctx.fillStyle = 'rgba(245, 193, 91, 0.15)'
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeStyle = '#f5c15b'
    ctx.lineWidth = 3
    ctx.setLineDash([8, 4])
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.setLineDash([])
    // 四角手柄已移除：没有拖拽交互却画手柄会误导用户（BUG-I2）
    return
  }

  // 自由圈选模式：使用平滑点
  var smoothed = smoothPoints(points)
  if (smoothed.length < 2) smoothed = points

  // 填充区域
  if (smoothed.length > 2) {
    ctx.beginPath()
    ctx.moveTo(toX(smoothed[0]), toY(smoothed[0]))

    // 用二次贝塞尔曲线连接（比直线更平滑）
    for (var i = 1; i < smoothed.length - 1; i++) {
      var xc = (toX(smoothed[i]) + toX(smoothed[i + 1])) / 2
      var yc = (toY(smoothed[i]) + toY(smoothed[i + 1])) / 2
      ctx.quadraticCurveTo(toX(smoothed[i]), toY(smoothed[i]), xc, yc)
    }
    // 最后一段
    ctx.lineTo(toX(smoothed[smoothed.length - 1]), toY(smoothed[smoothed.length - 1]))
    ctx.closePath()
    ctx.fillStyle = 'rgba(245, 193, 91, 0.15)'
    ctx.fill()
  }

  // 描边（虚线样式）
  ctx.beginPath()
  ctx.moveTo(toX(smoothed[0]), toY(smoothed[0]))
  for (var j = 1; j < smoothed.length - 1; j++) {
    var xc2 = (toX(smoothed[j]) + toX(smoothed[j + 1])) / 2
    var yc2 = (toY(smoothed[j]) + toY(smoothed[j + 1])) / 2
    ctx.quadraticCurveTo(toX(smoothed[j]), toY(smoothed[j]), xc2, yc2)
  }
  if (smoothed.length > 1) {
    ctx.lineTo(toX(smoothed[smoothed.length - 1]), toY(smoothed[smoothed.length - 1]))
  }
  if (smoothed.length > 2) ctx.closePath()

  ctx.strokeStyle = '#f5c15b'
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash([6, 3])
  ctx.stroke()
  ctx.setLineDash([])

  // 起点标记
  if (smoothed.length > 0) {
    ctx.fillStyle = '#f5c15b'
    ctx.beginPath()
    ctx.arc(toX(smoothed[0]), toY(smoothed[0]), 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(toX(smoothed[0]), toY(smoothed[0]), 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * 获取触摸点（归一化到 0-100）
 */
function getPoint(touch, rect, imageRect) {
  if (!rect || !touch) return null
  var box = imageRect || { left: 0, top: 0, width: rect.width, height: rect.height }
  var localX = touch.clientX - rect.left - box.left
  var localY = touch.clientY - rect.top - box.top
  if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) return null
  var x = Math.max(0, Math.min(100, (localX / box.width) * 100))
  var y = Math.max(0, Math.min(100, (localY / box.height) * 100))
  return { x: x, y: y }
}

/**
 * 计算路径的外接矩形
 */
function getPathBounds(points) {
  if (!points || points.length === 0) return null
  var xs = points.map(function (p) { return p.x })
  var ys = points.map(function (p) { return p.y })
  var minX = Math.min.apply(null, xs)
  var maxX = Math.max.apply(null, xs)
  var minY = Math.min.apply(null, ys)
  var maxY = Math.max.apply(null, ys)
  return {
    x: +(minX / 100).toFixed(4),
    y: +(minY / 100).toFixed(4),
    width: +((maxX - minX) / 100).toFixed(4),
    height: +((maxY - minY) / 100).toFixed(4)
  }
}

/**
 * 构建 lesion box（自由圈选或矩形）
 */
function buildLesionBox(points, mode) {
  var bounds = getPathBounds(points)
  return {
    type: mode === 'rectangle' ? 'rectangle' : 'freehand',
    points: points.map(function (p) {
      return { x: +(p.x / 100).toFixed(4), y: +(p.y / 100).toFixed(4) }
    }),
    x: bounds ? bounds.x : 0,
    y: bounds ? bounds.y : 0,
    width: bounds ? bounds.width : 0,
    height: bounds ? bounds.height : 0
  }
}

module.exports = {
  initCanvas: initCanvas,
  getAspectFitRect: getAspectFitRect,
  drawPath: drawPath,
  getPoint: getPoint,
  getPathBounds: getPathBounds,
  buildLesionBox: buildLesionBox,
  smoothPoints: smoothPoints,
  vibrate: vibrate
}
