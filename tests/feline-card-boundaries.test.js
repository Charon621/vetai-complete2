const assert=require('assert');global.wx={getStorageSync:function(){return []},setStorageSync:function(){}}
const kb=require('../utils/kb'),api=require('../utils/api'),reg=require('../evaluation/config/claim_source_registry.json')
for(const name of ['猫心理性脱毛','猫蠕形螨病']){
 const c=kb.DISEASE_KB.find(x=>x.name===name);assert(c.recommendedTests.length===4);assert(!/比犬|无原发皮损，毛发/.test(c.typicalFeatures+c.ddx));
 assert(reg.claims.filter(x=>x.card_id===c.id&&['typicalFeatures','ddx','recommendedTests'].includes(x.field_path)).every(x=>x.status==='pending_clinical_review'));
 const hit=Object.assign({},c,{score:30,matched:['视觉预检:短毛','视觉预检:断毛','组合:测试'],strongVisualCount:2,comboCount:1,evidenceCount:3});
 const data=api.assembleFastRagData([hit],{visualFeatures:['短毛','断毛']},'qwen',{model:'mock'},{species:'猫'});assert(data.diagnosisCandidates[0].reason.includes(c.recommendedTests[1]));
}
const c=kb.DISEASE_KB.find(x=>x.name==='猫蠕形螨病');assert(c.recommendedTests[0].includes('浅层或深层'));assert(c.relatedDiseases.every(r=>!r.name.includes('全身型蠕形')))
console.log('B13d feline card uncertainty / examinations / source status passed')
