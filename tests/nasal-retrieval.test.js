// 脱敏模型复测词组与工程反例；不是临床诊断标签。
const assert=require('assert'),kb=require('../utils/kb'),api=require('../utils/api'),cases=require('../evaluation/datasets/nasal_retrieval_scenarios.json')
for(const c of cases.cases){
 const hits=kb.search(c.query),insect=hits.find(h=>h.canonicalName==='蚊虫叮咬/昆虫过敏')
 const pattern=!!(insect&&insect.comboEvidence.some(e=>e.ruleId==='feline-nasal-papulocrust'))
 assert.equal(pattern,c.expect_pattern,c.id)
 if(c.expect_pattern)assert(insect.photoEvidence.some(e=>e.observed.includes('鼻部结痂')),c.id)
 if(c.no_ring_combo){const ring=kb.searchCandidates(c.query).find(h=>h.canonicalName==='皮肤癣菌病（犬猫）');assert(!ring||!ring.comboEvidence.some(e=>e.ruleId==='morphology-1'),c.id)}
}
const q=cases.cases[0].query,hits=kb.search(q)
assert(hits.some(h=>h.canonicalName==='蚊虫叮咬/昆虫过敏'))
assert(!api.shouldResolveFastRag(hits),'多种疾病共享丘疹时不能因缺少词表登记而虚增区分度')
const pyoderma=hits.find(h=>h.canonicalName==='猫浅表脓皮病')
assert(pyoderma.photoEvidence.some(e=>e.matched==='结痂'&&e.observed.includes('鼻部结痂')))
assert.equal(kb.countPrecheckVisualHits(pyoderma),1,'来源追踪不把泛词变成强证据')
const ring=kb.search({species:'猫',bodyPart:'面部',visualFeatures:['圆形脱毛','鳞屑','断毛'],lesionShape:'圆形'})
assert(ring.some(h=>h.canonicalName==='皮肤癣菌病（犬猫）'&&h.comboEvidence.some(e=>e.ruleId==='morphology-1')))
const evidence=require('../utils/knowledgeEvidence');assert(evidence.forCard('蚊虫叮咬/昆虫过敏','猫').some(e=>e.claimId==='INSECT-CAT-NASAL'));assert(!evidence.forCard('蚊虫叮咬/昆虫过敏','犬').some(e=>e.claimId==='INSECT-CAT-NASAL'))
console.log('nasal morphology retrieval, provenance, species, scope, ring shape and fast-path guards passed')
