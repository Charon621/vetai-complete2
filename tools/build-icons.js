// ============================================================
// 生成 assets/icons 下的着色 SVG 图标与报告页风险表盘
// 图标来源：Phosphor Icons（MIT，devDependency @phosphor-icons/core）
// 小程序 <image> 里的 SVG 不继承 currentColor，所以按用色预先着色成独立文件。
// 用法：node tools/build-icons.js
// ============================================================

var fs = require('fs')
var path = require('path')

var root = path.resolve(__dirname, '..')
var srcDir = path.join(root, 'node_modules', '@phosphor-icons', 'core', 'assets')
var outDir = path.join(root, 'assets', 'icons')

// 与 app.wxss 色板保持一致
var COLORS = {
  ink: '#221E18',
  body: '#4F483E',
  mute: '#8C8475',
  clay: '#BF5E3B',
  claydk: '#9F4A2B',
  rust: '#9C3A25',
  paper: '#FBF5EC',
  white: '#FFFFFF'
}

// [图标名, 字重, 颜色]
var ICONS = [
  ['paw-print', 'fill', 'clay'], ['paw-print', 'light', 'mute'],
  ['notebook', 'fill', 'clay'], ['notebook', 'light', 'mute'],
  ['user', 'fill', 'clay'], ['user', 'light', 'mute'],
  ['camera', 'light', 'paper'], ['camera', 'light', 'clay'],
  ['arrow-right', 'bold', 'claydk'],
  ['chat-teardrop-text', 'light', 'clay'],
  ['plus', 'light', 'mute'], ['plus', 'light', 'clay'], ['plus', 'bold', 'paper'],
  ['caret-left', 'light', 'ink'], ['caret-left', 'light', 'body'],
  ['caret-right', 'light', 'mute'], ['caret-right', 'bold', 'clay'],
  ['caret-down', 'light', 'mute'],
  ['x', 'bold', 'white'], ['x', 'light', 'mute'], ['x', 'light', 'body'],
  ['image', 'light', 'body'],
  ['arrow-up', 'bold', 'paper'],
  ['magnifying-glass', 'light', 'body'], ['magnifying-glass', 'light', 'clay'],
  ['clipboard-text', 'light', 'clay'],
  ['check', 'bold', 'paper'], ['check', 'bold', 'white'],
  ['pencil-simple', 'light', 'clay'],
  ['trash', 'light', 'rust'],
  ['cat', 'light', 'clay']
]

// 报告页四段弧形表盘：观察 / 关注 / 就诊 / 紧急，当前档位加粗实色，其余淡显
var GAUGE_SEGMENTS = [
  { d: 'M10 52 A38 38 0 0 1 17.4 29.4', color: '#62805A' },
  { d: 'M23.5 22.7 A38 38 0 0 1 44 14.2', color: '#C4912F' },
  { d: 'M52 14.2 A38 38 0 0 1 72.5 22.7', color: '#BF5E3B' },
  { d: 'M78.6 29.4 A38 38 0 0 1 86 52', color: '#9C3A25' }
]
var GAUGE_LEVELS = ['low', 'moderate', 'urgent', 'emergency']

function buildIcon(name, weight, colorKey) {
  var file = weight === 'regular' ? name + '.svg' : name + '-' + weight + '.svg'
  var svg = fs.readFileSync(path.join(srcDir, weight, file), 'utf8')
  var color = COLORS[colorKey]
  if (!color) throw new Error('unknown color ' + colorKey)
  svg = svg.replace(/fill="currentColor"/g, 'fill="' + color + '"')
  if (svg.indexOf('fill="' + color + '"') < 0) {
    svg = svg.replace('<svg ', '<svg fill="' + color + '" ')
  }
  return svg
}

function buildGauge(activeIndex) {
  var paths = GAUGE_SEGMENTS.map(function (seg, i) {
    var on = i === activeIndex
    return '<path d="' + seg.d + '" fill="none" stroke="' + seg.color + '"' +
      ' stroke-opacity="' + (on ? '1' : '0.3') + '" stroke-width="' + (on ? '9' : '7') + '" stroke-linecap="round"/>'
  }).join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 58">' + paths + '</svg>'
}

// 首页宠物名下的手绘下划线（一笔微弧，非直线）
var UNDERLINE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 12" preserveAspectRatio="none">' +
  '<path d="M2 8.5C22 4 52 3 98 6.5" fill="none" stroke="#BF5E3B" stroke-width="2.6" stroke-linecap="round"/></svg>'

function run() {
  if (!fs.existsSync(srcDir)) {
    console.error('缺少 @phosphor-icons/core，请先 npm install')
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.readdirSync(outDir).forEach(function (f) {
    if (/\.svg$/.test(f)) fs.unlinkSync(path.join(outDir, f))
  })
  ICONS.forEach(function (item) {
    var out = item[0] + '-' + item[1] + '-' + item[2] + '.svg'
    fs.writeFileSync(path.join(outDir, out), buildIcon(item[0], item[1], item[2]))
  })
  GAUGE_LEVELS.forEach(function (level, i) {
    fs.writeFileSync(path.join(outDir, 'gauge-' + level + '.svg'), buildGauge(i))
  })
  fs.writeFileSync(path.join(outDir, 'underline-clay.svg'), UNDERLINE_SVG)
  console.log('icons written: ' + (ICONS.length + GAUGE_LEVELS.length + 1))
}

run()
