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
// 点名分级：照片清晰可见且本组独有的特异表现才点名；并列、仅“可能可见”或文字证据只作可能方向。
assert.equal(assessment.scopeResults[0].candidates[0].evidenceTier,'named')
function fake(id,ids){return {cardId:id,name:id,role:'etiology',supports:ids.map(e=>({evidenceId:e,conceptId:s.facts.find(f=>f.evidenceId===e).conceptId,specific:true,soft:false})),conflicts:[],missing:[],knowledgeBindings:[{cardId:id,conditionId:id+':c',field:'visualSigns',sourceFieldHash:'h',evidenceStatus:'pending'}],referenceKnowledge:'',ddx:'',sourceStatus:'pending'}}
function tiersOf(snap,cands){return a.build(snap,{scopes:[{lesionId:'l',site:'unknown',coverage:'covered',candidates:cands}]},{},{}).scopeResults[0].candidates.map(x=>x.name+':'+x.evidenceTier)}
assert.deepEqual(tiersOf(s,[fake('X',['e0']),fake('Y',['e1'])]),['X:tentative','Y:tentative'],'两个候选各有独有证据视为并列')
assert.deepEqual(tiersOf(s,[fake('Y',['e0']),fake('X',['e0','e1'])]),['X:named','Y:tentative'],'独有证据的候选点名并排到首位')
const soft=JSON.parse(JSON.stringify(s));soft.facts[1].certainty='possible'
assert.deepEqual(tiersOf(soft,[fake('Y',['e0']),fake('X',['e0','e1'])]),['Y:tentative','X:tentative'],'可能可见不构成独有证据')
const text=JSON.parse(JSON.stringify(s));text.facts.forEach(f=>f.source='owner_text')
assert.deepEqual(tiersOf(text,[fake('X',['e0','e1'])]),['X:tentative'],'文字证据不点名')
const badTier=JSON.parse(JSON.stringify(assessment));badTier.scopeResults[0].candidates[0].evidenceTier='confirmed'
assert.equal(c.validateAssessment(badTier).code,'invalid_candidate')
console.log('candidate / morphology / independent risk / new-field safety passed')
