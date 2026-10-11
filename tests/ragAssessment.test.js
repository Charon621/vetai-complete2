const assert=require('assert'),a=require('../utils/ragAssessment'),r=require('../utils/ragRetrieval'),c=require('../utils/ragContracts'),api=require('../utils/api')
function snapshot(words){return c.snapshot({provenanceStatus:'compatibility_limited',facts:words.map((w,i)=>({evidenceId:'e'+i,conceptId:'c:'+w,rawText:w,assertion:'present',certainty:'clear',observed:true,source:'photo',subject:'pet',temporality:'current',lesionId:'l',site:'unknown'}))})}
const s=snapshot(['圆形脱毛','鳞屑']),assessment=a.build(s,r.rank(s,{species:'猫'}),{species:'猫'},{runId:'r',inspectSafety:api.inspectUserVisibleSafety,guardrails:api.applyGuardrails})
assert.equal(assessment.answerLevel,'ranked_candidates')
assert(assessment.scopeResults[0].candidates[0].supportEvidenceIds.includes('e0'))
assert.equal(a.result(assessment,s).data.confidence,undefined)
const general=snapshot(['红斑','脱毛']);assert.equal(a.build(general,r.rank(general,{species:'猫'}),{},{}).answerLevel,'morphology_only')
const ranking=r.rank(s,{species:'猫'});ranking.scopes[0].candidates[0].referenceKnowledge='直接服用泼尼松，每天两次'
const blocked=a.build(s,ranking,{}, {inspectSafety:api.inspectUserVisibleSafety})
assert.equal(blocked.status,'schema_error');assert.equal(blocked.answerLevel,'unavailable');assert(!blocked.scopeResults.length)
const failure=a.build(c.snapshot(),{scopes:[]},{complaint:'我的狗现在呼吸困难'},{status:'provider_error',guardrails:api.applyGuardrails})
assert.equal(failure.answerLevel,'unavailable');assert.notEqual(failure.triage.urgency,'unknown')
const cf=require('../utils/caseFacts'),draft={petType:'cat'}
cf.updateDraft(draft,'我的猫现在呼吸困难',{},'first');cf.updateDraft(draft,'皮肤还有鳞屑',{},'second')
assert.equal(a.build(c.snapshot(),{scopes:[]},{evidenceContext:cf.buildEvidenceContext(draft)},{status:'provider_error',guardrails:api.applyGuardrails}).triage.urgency,'emergency','unresolved earlier red line survives later normal symptom')
cf.updateDraft(draft,'现在猫没有呼吸困难',{},'third')
assert.equal(a.build(c.snapshot(),{scopes:[]},{evidenceContext:cf.buildEvidenceContext(draft)},{status:'provider_error',guardrails:api.applyGuardrails}).triage.urgency,'unknown','explicit retraction applies within owner risk stream')
for(const text of ['我现在呼吸困难，猫只有鳞屑','我的猫以前呼吸困难，现在已经恢复正常']){
  const d={petType:'cat'};cf.updateDraft(d,text,{},'scope')
  assert.equal(a.build(c.snapshot(),{scopes:[]},{evidenceContext:cf.buildEvidenceContext(d)},{status:'provider_error',guardrails:api.applyGuardrails}).triage.urgency,'unknown')
}
const riskWithPhoto=a.build(s,r.rank(s,{species:'猫'}),{complaint:'我的猫现在呼吸困难'},{guardrails:api.applyGuardrails})
assert.deepEqual(riskWithPhoto.triage.supportEvidenceIds,[],'unrelated photo morphology is not risk evidence')
console.log('candidate / morphology / independent risk / new-field safety passed')
