// 本地规则候选 + BM25 + RRF；不调用向量服务、不改变原来的强命中计分。
var kb = require('./kb')
var scope = require('./evidenceScope')
var facts = require('./caseFacts')
var VERSION = 'rule-bm25-rrf-v2'
function tokenize(text) {
  var tokens = [], runs = String(text || '').toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || []
  runs.forEach(function (run) {
    if (!/[\u3400-\u9fff]/.test(run)) { tokens.push(run); return }
    for (var i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  })
  return tokens
}
function document(card) {
  // 鉴别段落提到其他病名，不作为本卡的词频信号。
  return [card.name].concat(card.aliases, card.visualSigns, card.historySigns, card.locations, [card.typicalFeatures]).join(' ')
}
function buildIndex(cards) {
  var df = {}, total = 0
  var docs = cards.map(function (card) {
    var terms = tokenize(document(card)), tf = {}; total += terms.length
    terms.forEach(function(t) { tf[t] = (tf[t] || 0) + 1 })
    Object.keys(tf).forEach(function(t) { df[t] = (df[t] || 0) + 1 })
    return { id: card.id, tf: tf, length: terms.length }
  })
  return { docs: docs, df: df, average: total / (docs.length || 1) }
}
var index = buildIndex(kb.DISEASE_KB)
function bm25(doc, tokens) {
  var score = 0, seen = {}
  tokens.forEach(function(t) {
    if (seen[t]) return; seen[t] = true
    var tf = doc.tf[t] || 0
    if (!tf) return
    var idf = Math.log(1 + (index.docs.length - (index.df[t] || 0) + 0.5) / ((index.df[t] || 0) + 0.5))
    score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.length / (index.average || 1)))
  })
  return score
}
function search(query, strategy) {
  strategy = strategy || 'hybrid'
  if (['rules', 'bm25', 'hybrid_unscoped', 'hybrid'].indexOf(strategy) < 0) throw new Error('Unknown retrieval strategy')
  if (strategy === 'rules') return kb.search(query)
  query = query || {}
  // 物种未知或结构化事实无效时不新增词频候选。
  if (query.species !== '犬' && query.species !== '猫') return []
  if (query.evidenceContext !== undefined && !facts.validateEvidenceContext(query.evidenceContext)) return []
  var candidates = kb.searchCandidates(query)
  var photoScopes = {}
  candidates.forEach(function(hit) {
    if ((hit.matched || []).some(function(m) { return m.indexOf('视觉预检:') === 0 })) {
      photoScopes[(hit.evidenceScope || {}).lesionId || 'unspecified'] = true
    }
  })
  var scored = candidates.map(function(hit, ruleIndex) {
    var spans = (hit.evidenceScope && hit.evidenceScope.sourceSpans) || []
    // 同一作用域使用同一份原始查询；不把候选卡的匹配词反向加入查询。
    var scopedText = spans.map(function(s) { return s.text || '' }).join('，')
    var photoText = photoScopes[(hit.evidenceScope || {}).lesionId || 'unspecified'] ? kb.filterPhotoFeatures(query.visualFeatures).join(' ') : ''
    var text = kb.expandQueryTerms(scope.currentPetText(scopedText)) + ' ' + photoText
    var doc = index.docs.filter(function(d) { return d.id === hit.id })[0]
    return { hit: hit, ruleRank: ruleIndex + 1, lexical: bm25(doc, tokenize(text)) }
  })
  var lexical = scored.slice().sort(function(a,b) { return b.lexical - a.lexical || a.ruleRank - b.ruleRank })
  lexical.forEach(function(r,i) { r.lexicalRank = r.lexical > 0 ? i + 1 : null })
  scored.forEach(function(r) { r.fused = 1 / (60 + r.ruleRank) + (r.lexicalRank ? 1 / (60 + r.lexicalRank) : 0) })
  var ranked = strategy === 'bm25' ? lexical : scored.sort(function(a,b) { return b.fused - a.fused || a.ruleRank - b.ruleRank })
  if (strategy === 'hybrid') {
    // 多病灶先保留规则已选出的各作用域代表，再按融合顺序补齐；单一病灶不强制固定首位。
    var base = kb.search(query), sites = {}
    base.forEach(function(h) { var site=h.evidenceScope && h.evidenceScope.lesionId; if(site && site!=='unspecified') sites[site]=true })
    if (Object.keys(sites).length > 1) {
      var reserved=[],seenSite={},seenId={}
      base.forEach(function(h) {
        var site=h.evidenceScope && h.evidenceScope.lesionId
        if(!site || seenSite[site]) return
        var row=ranked.filter(function(r){return r.hit.id===h.id})[0]
        if(row){reserved.push(row);seenSite[site]=true;seenId[h.id]=true}
      })
      ranked=reserved.concat(ranked.filter(function(r){return !seenId[r.hit.id]}))
    }
  }
  return ranked.slice(0,3).map(function(r) {
    return Object.assign({}, r.hit, { retrieval: { version: VERSION, strategy: strategy, ruleRank: r.ruleRank, bm25Rank: r.lexicalRank, bm25Score: r.lexical, fusionScore: r.fused, candidateCount: candidates.length, fastPathEligible: false } })
  })
}
module.exports = { VERSION: VERSION, search: search, tokenize: tokenize }
