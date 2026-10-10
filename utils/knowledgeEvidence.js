// 条目级证据记录；核验是资料比对，不等于兽医签署，也不追认历史出处。
// 小程序 require 不支持 .json，台账由 tools/build-knowledge-bundle.js 生成到 knowledgeBundle.js
var ledger = require('./knowledgeBundle').ledger
function forCard(name, species) {
  return ledger.claims.filter(function (claim) {
    return claim.card_name === name && (!species || claim.applicability.species.indexOf(species) >= 0)
  }).map(function (claim) {
    return {
      claimId: claim.id, field: claim.field, status: claim.status,
      statement: claim.statement, conditions: claim.applicability.conditions,
      limitation: claim.limitation, review: claim.review,
      sources: claim.evidence.filter(function (id) {
        var span = ledger.spans.filter(function (s) { return s.id === id })[0]
        return !species || span.species.indexOf(species) >= 0
      }).map(function (id) {
        var span = ledger.spans.filter(function (s) { return s.id === id })[0]
        var source = ledger.sources.filter(function (s) { return s.id === span.source_id })[0]
        return { sourceId: source.id, title: source.title, url: source.url + '#page=' + span.pdf_page, locator: span.section, page: span.pdf_page }
      })
    }
  })
}
function sourcesForCard(name, species) {
  var out = [], seen = {}
  forCard(name, species).filter(function(c) { return c.status === 'source_verified' }).forEach(function(c) {
    c.sources.forEach(function(s) {
      if (seen[s.url]) return
      seen[s.url] = true
      out.push({ title:s.title + ' · PDF第' + s.page + '页', url:s.url, tier:'guideline', claimId:c.claimId })
    })
  })
  return out
}
module.exports = { version: ledger.version, forCard: forCard, sourcesForCard:sourcesForCard }
