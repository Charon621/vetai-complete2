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

module.exports = {
  cleanModelText: cleanModelText
}
