// ============================================================
// utils/text.js
// 公共文本清洗：统一 api.js / result.js 原本各自重复的 markdown 残留清理
// 合并自 api.js cleanModelText 与 result.js cleanText，行为取并集
// ============================================================

function cleanModelText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[*＊#`]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .trim()
}

// 公共百分比归一化：统一 api.js / detail.js / result.js 原本各自重复的实现
function normalizePercent(value, fallback) {
  if (typeof value === 'string') {
    var parsed = parseFloat(value.replace('%', '').trim())
    if (!Number.isNaN(parsed)) value = parsed
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  // 只有 0-1 之间的真小数才按比例换算；整数 1 表示 1%，不能被放大成 100%（BUG-F1）
  if (value > 0 && value < 1) return Math.max(1, Math.round(value * 100))
  return Math.max(0, Math.min(100, Math.round(value)))
}

module.exports = {
  cleanModelText: cleanModelText,
  normalizePercent: normalizePercent
}
