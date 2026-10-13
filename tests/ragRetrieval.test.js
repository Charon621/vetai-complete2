const assert=require('assert'),r=require('../utils/ragRetrieval'),c=require('../utils/ragContracts'),concept=require('../utils/clinicalConcepts'),profiles=require('../utils/retrievalProfileBundle')
function snapshot(words,lesions){return c.snapshot({provenanceStatus:'compatibility_limited',facts:words.map((word,i)=>({evidenceId:'e'+i,conceptId:concept.lookup(word).conceptId,rawText:word,assertion:'present',certainty:'clear',observed:true,source:'photo',subject:'pet',temporality:'current',imageId:null,sourceImageId:null,lesionId:lesions?lesions[i]:'l1',site:'unknown'}))})}
const a=snapshot(['圆形脱毛','鳞屑']),b=snapshot(['表皮环','脓疱','鳞屑'])
assert(r.rank(a,{species:'猫'}).scopes[0].candidates.some(c=>/癣/.test(c.name)))
assert(r.rank(b,{species:'犬'}).scopes[0].candidates.some(c=>/浅表脓皮/.test(c.name)))
const dup=snapshot(['黑头','粉刺','黑头粉刺','脓疱']),single=snapshot(['黑头粉刺','脓疱'])
assert.deepEqual(r.rank(dup,{species:'猫'},{strategy:'concept'}).scopes[0].pool.map(c=>[c.cardId,c.rankScore]),r.rank(single,{species:'猫'},{strategy:'concept'}).scopes[0].pool.map(c=>[c.cardId,c.rankScore]))
const split=r.rank(snapshot(['圆形脱毛','鳞屑'],['l1','l2']),{species:'猫'})
assert.equal(split.scopes.length,2);assert(split.scopes.every(s=>s.candidates.length===0))
assert(r.rank(snapshot(['红斑','脱毛']),{species:'猫'}).scopes[0].candidates.length===0)
assert(r.rank(a,{species:'兔'}).scopes.every(s=>!s.candidates.length))
const baseline=r.rank(a,{species:'猫'}),extra=r.rank(a,{species:'猫'},{profiles:profiles.profiles.concat(profiles.profiles)})
assert.deepEqual(baseline,extra)
a.facts[0].assertion='unknown';assert.equal(r.rank(a,{species:'猫'}).scopes[0].candidates.length,0)
// 部位锁定卡：病灶部位明确在其他区域时不进入可交付候选；头部/未知不排除。
const kb=require('../utils/kb'),earCard=kb.DISEASE_KB.find(c=>c.name==='耳螨感染'),ringworm=kb.DISEASE_KB.find(c=>/皮肤癣菌病/.test(c.name))
assert.deepEqual(r.lockedRegions(earCard),['ear']);assert.deepEqual(r.lockedRegions(ringworm),[])
const studTail=kb.DISEASE_KB.find(c=>/尾根腺炎/.test(c.name));assert.deepEqual(r.lockedRegions(studTail).sort(),['back','tail']);assert(r.siteConflict(studTail,['嘴巴下面']));assert(!r.siteConflict(studTail,['背部']))
assert(r.siteConflict(earCard,['尾巴']));assert(!r.siteConflict(earCard,['耳朵']));assert(!r.siteConflict(earCard,['头部']));assert(!r.siteConflict(earCard,[]));assert(!r.siteConflict(earCard,['尾巴','耳朵后面']))
const tailEar=snapshot(['黑色','耳垢']);tailEar.facts.forEach(f=>f.site='尾巴')
const tailRank=r.rank(tailEar,{species:'猫'}).scopes[0]
assert(!tailRank.candidates.some(c=>c.name==='耳螨感染'));assert(tailRank.pool.filter(c=>c.name==='耳螨感染').every(c=>c.siteConflict&&!c.eligible))
const unknownSite=snapshot(['黑色','耳垢']);assert(r.rank(unknownSite,{species:'猫',bodyPartLabel:'尾部'}).scopes[0].candidates.every(c=>c.name!=='耳螨感染'),'表单部位作为未知部位的兜底')
// 线上路径固定回归（主诉→事实→概念→检索→分级），与 evaluation/tools/guided_probe.js 同一组用例。
const probe=require('../evaluation/tools/guided_probe')
probe.evaluate().pinned.forEach(p=>assert(p.pass,p.id+'：'+p.failures.join('；')))
console.log('A01/A02 / duplicate concepts / scopes / generic / species / profile count passed')
module.exports={snapshot}
