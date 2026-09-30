// 内置衬线字体加载（BUG-UI58）
//
// 为什么需要：设计系统的标题 / 病名 / AI 回复用宋体，靠系统字体栈时
// iOS 能落到 Songti SC，**安卓真机没有中文衬线**、也不认 -apple-system /
// PingFang / Songti，整套会掉回黑体，和开发者工具里看到的不一样。
// wx.loadBuiltInFontFace 只提供微信自家无衬线字体，没有中文衬线，所以
// 这里把思源宋体子集以 base64 内置，用 wx.loadFontFace 加载——
// 不依赖服务器，也不需要配置 downloadFile 域名（字体走本地数据，不发起网络请求）。
//
// 失败处理：任何一步失败都只打日志。font-family 里 'VetAISerif' 排在系统字体
// 前面，加载失败时后面的系统字体照常生效，页面不会因此出问题。
//
// 体积与覆盖范围的取舍：内置子集只收界面文案 + 场景词，覆盖约 1/3 常用字。
// AI 报告正文里的罕见字会回落到系统字体（安卓上是黑体），同一行可能字体不一致。
// 想提高覆盖率：改 tools/build_font_subset.py 里的 EXTRA_COMMON 后重跑脚本即可，
// 但注意体积线性增长（+600 字约 +130 KB base64），主包上限 2048 KB。
var fontData = require('./fontData')
var storage = require('./storage')

var FAMILY = fontData.family || 'VetAISerif'
// BUG-UI71：内置字体构建为 WOFF，声明类型须与数据一致
var SOURCE = 'data:font/woff;base64,' + (fontData.base64 || '')
var CACHE_KEY = 'vetai_serif_font_ok'
var _loading = false
var _loaded = false

function markLoaded() {
  _loaded = true
  try {
    wx.setStorageSync(CACHE_KEY, 1)
  } catch (e) {}
}

/**
 * 加载内置宋体。可重复调用，只会真正加载一次。
 * @param {Function} [done] 加载结束（成功或失败）后的回调
 */
function loadSerif(done) {
  var finish = function () {
    if (typeof done === 'function') done(_loaded)
  }

  if (_loaded) return finish()
  if (_loading) return finish()

  if (!SOURCE || SOURCE.length < 100) {
    // 没跑过 tools/build_font_subset.py，或字体数据缺失
    console.warn('[font] 未内置字体数据，跳过加载')
    return finish()
  }
  if (!wx.loadFontFace) {
    console.warn('[font] 当前基础库不支持 wx.loadFontFace，使用系统字体')
    return finish()
  }

  _loading = true
  wx.loadFontFace({
    family: FAMILY,
    source: SOURCE,
    // global: 让所有页面（含分包）都能用到
    global: true,
    scopes: ['webview', 'native'],
    success: function () {
      _loading = false
      markLoaded()
      finish()
    },
    fail: function (err) {
      _loading = false
      console.warn('[font] 内置宋体加载失败，回落系统字体', err)
      finish()
    }
  })
}

function isLoaded() {
  return _loaded
}

module.exports = {
  family: FAMILY,
  loadSerif: loadSerif,
  isLoaded: isLoaded
}
