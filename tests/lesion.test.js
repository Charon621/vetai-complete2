// ============================================================
// tests/lesion.test.js
// utils/lesion.js 纯算法测试：
//   - smoothPoints：Catmull-Rom 插值点数、首点保持、末点行为（BUG-I4）
//   - getPathBounds：自由圈选点集 → 归一化外接框
//   - buildLesionBox：模式映射 + 点集归一化
//   - getPoint：触摸点归一化（0-100）与越界判定
//   - getAspectFitRect：aspectFit 展示区域换算
// 直接 node tests/lesion.test.js 执行，无测试框架
// ============================================================

const assert = require('assert')

// lesion.js 顶层不触碰 wx，最小 stub 仅为 vibrate 等运行时兜底
global.wx = {}

const lesion = require('../utils/lesion')

// ============================================================
// smoothPoints
// ============================================================

// 少于 3 个点：原样返回，不插值
assert.deepStrictEqual(lesion.smoothPoints(null), [], 'null points -> []')
assert.deepStrictEqual(lesion.smoothPoints([]), [], 'empty points -> []')
const twoPoints = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
assert.strictEqual(lesion.smoothPoints(twoPoints), twoPoints, '<3 points returned as-is')

// 4 个共线点：每段固定 5 个插值点（整数步进，BUG-I4），共 (n-1)*5
const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]
const smoothedLine = lesion.smoothPoints(line)
assert.strictEqual(smoothedLine.length, (line.length - 1) * 5, 'each segment yields 5 points')

// 首点必须严格保持（t=0 时公式退化为 p1）
assert.strictEqual(smoothedLine[0].x, 0, 'first point x preserved')
assert.strictEqual(smoothedLine[0].y, 0, 'first point y preserved')

// 所有插值点必须是有限数值
smoothedLine.forEach(function (p, i) {
  assert.ok(isFinite(p.x) && isFinite(p.y), 'point ' + i + ' must be finite')
})
// 共线水平点：y 恒为 0，x 不越界
smoothedLine.forEach(function (p) {
  assert.strictEqual(p.y, 0, 'collinear horizontal points stay on the line')
  assert.ok(p.x >= 0 && p.x <= 30, 'no overshoot on uniform collinear input')
})

// tension=1 时末点严格回到最后一个输入点
const smoothedFull = lesion.smoothPoints(line, 1)
const lastFull = smoothedFull[smoothedFull.length - 1]
assert.strictEqual(lastFull.x, 30, 'tension=1 preserves last point x')
assert.strictEqual(lastFull.y, 0, 'tension=1 preserves last point y')

// 默认 tension=0.5 时末点落在最后一段的中点（当前实现行为：
// 末点 = p[n-2] + tension * (p[n-1] - p[n-2])，并非严格保持末点）
const lastDefault = smoothedLine[smoothedLine.length - 1]
assert.strictEqual(lastDefault.x, 25, 'default tension endpoint lands at last-segment midpoint')

// ============================================================
// getPathBounds：0-100 坐标点集 → 0-1 归一化外接框
// ============================================================

assert.strictEqual(lesion.getPathBounds(null), null, 'null points -> null bounds')
assert.strictEqual(lesion.getPathBounds([]), null, 'empty points -> null bounds')

const boundsPts = [{ x: 10, y: 20 }, { x: 50, y: 80 }, { x: 30, y: 40 }]
const bounds = lesion.getPathBounds(boundsPts)
assert.strictEqual(bounds.x, 0.1, 'bounds x = minX/100')
assert.strictEqual(bounds.y, 0.2, 'bounds y = minY/100')
assert.strictEqual(bounds.width, 0.4, 'bounds width = (maxX-minX)/100')
assert.strictEqual(bounds.height, 0.6, 'bounds height = (maxY-minY)/100')

// 单点：宽高为 0
const pointBounds = lesion.getPathBounds([{ x: 33.3333, y: 66.6666 }])
assert.strictEqual(pointBounds.width, 0, 'single point width 0')
assert.strictEqual(pointBounds.height, 0, 'single point height 0')
assert.strictEqual(pointBounds.x, 0.3333, 'bounds rounded to 4 decimals')

// ============================================================
// buildLesionBox：模式映射 + 点集归一化
// ============================================================

const freehandBox = lesion.buildLesionBox(boundsPts, 'freehand')
assert.strictEqual(freehandBox.type, 'freehand', 'non-rectangle mode -> freehand')
assert.strictEqual(freehandBox.x, 0.1, 'box x follows bounds')
assert.strictEqual(freehandBox.width, 0.4, 'box width follows bounds')
assert.strictEqual(freehandBox.points.length, 3, 'all points kept')
assert.deepStrictEqual(freehandBox.points[0], { x: 0.1, y: 0.2 }, 'points normalized to 0-1')

const rectBox = lesion.buildLesionBox([{ x: 0, y: 0 }, { x: 100, y: 100 }], 'rectangle')
assert.strictEqual(rectBox.type, 'rectangle', 'rectangle mode preserved')
assert.strictEqual(rectBox.width, 1, 'full-canvas rectangle width 1')
assert.strictEqual(rectBox.height, 1, 'full-canvas rectangle height 1')

// 空点集：退化为 0 尺寸框，不抛异常
const emptyBox = lesion.buildLesionBox([], 'freehand')
assert.strictEqual(emptyBox.x, 0, 'empty points -> zero box x')
assert.strictEqual(emptyBox.width, 0, 'empty points -> zero box width')

// ============================================================
// getPoint：触摸点 → 0-100 归一化坐标
// ============================================================

const rect = { left: 10, top: 20, width: 100, height: 100 }

assert.strictEqual(lesion.getPoint(null, rect), null, 'null touch -> null')
assert.strictEqual(lesion.getPoint({ clientX: 0, clientY: 0 }, null), null, 'null rect -> null')

// 无 imageRect：以整个 rect 为坐标系
const mid = lesion.getPoint({ clientX: 60, clientY: 70 }, rect)
assert.strictEqual(mid.x, 50, 'center x normalized to 50')
assert.strictEqual(mid.y, 50, 'center y normalized to 50')

// 边界点：正好落在边缘时取 0 / 100
const corner = lesion.getPoint({ clientX: 10, clientY: 20 }, rect)
assert.strictEqual(corner.x, 0, 'left edge -> 0')
assert.strictEqual(corner.y, 0, 'top edge -> 0')
const farCorner = lesion.getPoint({ clientX: 110, clientY: 120 }, rect)
assert.strictEqual(farCorner.x, 100, 'right edge -> 100')
assert.strictEqual(farCorner.y, 100, 'bottom edge -> 100')

// 越界：返回 null 而不是钳制（圈选不允许从图外起笔）
assert.strictEqual(lesion.getPoint({ clientX: 5, clientY: 70 }, rect), null, 'left of rect -> null')
assert.strictEqual(lesion.getPoint({ clientX: 60, clientY: 121 }, rect), null, 'below rect -> null')

// 带 imageRect（aspectFit letterbox 区域）：坐标相对图片显示区域
const imageRect = { left: 10, top: 10, width: 80, height: 80 }
const inImage = lesion.getPoint({ clientX: 60, clientY: 70 }, rect, imageRect)
assert.strictEqual(inImage.x, 50, 'imageRect-relative x')
assert.strictEqual(inImage.y, 50, 'imageRect-relative y')
// 落在 letterbox 黑边内（图片区域外）：null
assert.strictEqual(lesion.getPoint({ clientX: 15, clientY: 25 }, rect, imageRect), null,
  'touch inside container but outside image area -> null')

// ============================================================
// getAspectFitRect：容器内 aspectFit 展示区域
// ============================================================

// 宽图在正方形容器：上下留边
const wide = lesion.getAspectFitRect(100, 100, 200, 100)
assert.strictEqual(wide.width, 100, 'wide image fills container width')
assert.strictEqual(wide.height, 50, 'wide image height scaled')
assert.strictEqual(wide.left, 0, 'wide image no horizontal offset')
assert.strictEqual(wide.top, 25, 'wide image vertically centered')

// 高图在正方形容器：左右留边
const tall = lesion.getAspectFitRect(100, 100, 100, 200)
assert.strictEqual(tall.width, 50, 'tall image width scaled')
assert.strictEqual(tall.height, 100, 'tall image fills container height')
assert.strictEqual(tall.left, 25, 'tall image horizontally centered')
assert.strictEqual(tall.top, 0, 'tall image no vertical offset')

// 同比例：铺满
const fit = lesion.getAspectFitRect(200, 100, 400, 200)
assert.deepStrictEqual(fit, { left: 0, top: 0, width: 200, height: 100 }, 'same ratio fills container')

// 非法尺寸：退化为整容器，不抛异常
const degenerate = lesion.getAspectFitRect(100, 100, 0, 0)
assert.strictEqual(degenerate.left, 0, 'degenerate input falls back to full container')
assert.strictEqual(degenerate.width, 100, 'degenerate input keeps container width')
const nanCase = lesion.getAspectFitRect('abc', 100, 100, 100)
assert.strictEqual(nanCase.width, 0, 'non-numeric container width coerced to 0')

console.log('lesion tests passed')
