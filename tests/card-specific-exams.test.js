const assert=require('assert');global.wx={getStorageSync:function(){return []},setStorageSync:function(){}}
const kb=require('../utils/kb'),api=require('../utils/api')
const paths=[['肛门囊病','肛门囊','内容物'],['睑炎','眼睑','眼科'],['猫浆细胞性足炎','细针','组织病理'],['蝇蛆病（伤口蛆症）','虫体','全身状态']]
for(const [name,first,second] of paths){
 const card=kb.DISEASE_KB.find(c=>c.name===name);assert(card.recommendedTests[0].includes(first));assert(card.recommendedTests[1].includes(second));
 const hit=Object.assign({},card,{score:30,matched:['视觉预检:圆形脱毛','视觉预检:断毛','组合:测试'],strongVisualCount:2,comboCount:1,evidenceCount:3});
 const data=api.assembleFastRagData([hit],{visualFeatures:['圆形脱毛','断毛'],quality:'clear'},'qwen',{model:'mock'},{species:card.species[0]});
 assert(data.diagnosisCandidates[0].reason.includes(card.recommendedTests[0]));assert(data.diagnosisCandidates[0].reason.includes(card.recommendedTests[1]));
 assert(!/自行挤|自行取|自行活检|药物剂量/.test(data.homeCare));
}
console.log('B13b card-specific examinations reach fast report / fallback assembler')
