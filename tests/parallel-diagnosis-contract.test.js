const assert = require('assert')
global.wx={getStorageSync:function(){return []},setStorageSync:function(){}}
const decision=require('../utils/diagnosisDecision'),api=require('../utils/api'),kb=require('../utils/kb')
const clear={quality:'clear',diagnosabilityScore:80},bad={quality:'unclear',diagnosabilityScore:10}
const full={imageFindings:[{usable:true}]},unusable={imageFindings:[{usable:false}]}
assert.strictEqual(decision.decideDiagnosis({precheckStatus:'ok',precheck:bad,fullStatus:'ok',full}).reason,'quality_conflict')
assert.strictEqual(decision.decideDiagnosis({precheckStatus:'ok',precheck:clear,fullStatus:'ok',full:unusable}).reason,'quality_conflict')
assert.strictEqual(decision.decideDiagnosis({precheckStatus:'ok',precheck:bad,fullStatus:'clinical_abstain',full:unusable}).action,'abstain')
for(const preStatus of ['schema_error','provider_error','timeout']) assert.strictEqual(decision.decideDiagnosis({precheckStatus:preStatus,fullStatus:'ok',full}).action,'full')
for(const status of ['schema_error','provider_error','timeout']) {
  assert.strictEqual(decision.decideDiagnosis({precheckStatus:'ok',precheck:clear,fullStatus:status,deferredFast:{}}).action,'fallback')
  assert.strictEqual(decision.decideDiagnosis({precheckStatus:status,fullStatus:status}).action,'failure')
}
assert.strictEqual(decision.decideDiagnosis({precheckStatus:'ok',precheck:clear,fullStatus:'clinical_abstain',full,deferredFast:{}}).action,'full')
let tasks=[],cleared=0;const clock={set:fn=>{tasks.push(fn);return tasks.length},clear:()=>cleared++}
async function run(){
  const pending = []
  global.wx.cloud={callFunction:function(options){pending.push(options)}}
  const report={imageFindings:[{imageIndex:1,role:'overview',observation:'局部脱毛',quality:'clear',usable:true}],observations:'局部脱毛',evidenceFor:['圆形脱毛','鳞屑'],evidenceAgainst:[],missingInformation:['真菌检查'],abstainReason:'',primaryDiagnosis:'皮肤癣菌病（犬猫）',primaryDiagnosisProbability:60,diagnosisCandidates:[{name:'皮肤癣菌病（犬猫）',probability:60,reason:'形态支持',supporting:'圆形脱毛',against:'待检查'}],lesionNameCn:'脱毛',confidence:60,recommendedTests:['真菌检查'],urgencyEvidence:[],urgency:'low',explanation:'待检查确认',possibleMeaning:'初筛',homeCare:'记录变化',whenToWatch:'观察变化',whenToSeeVet:'扩大时就医',diagnosisProbabilityNote:'匹配分'}
  function deliver(options,data){options.success({result:{success:true,data:{choices:[{message:{content:JSON.stringify(data)}}]}}})}
  const outcomes=[]
  for(const order of [['full-diagnosis','vision-precheck'],['vision-precheck','full-diagnosis']]){
    pending.length=0
    let delivered=false
    const result=api.diagnose(['aGVsbG8='],{species:'cat',complaint:'现在呼吸困难',useKnowledgeBase:true,imageRoles:['overview']}).then(r=>{delivered=true;return r})
    assert.strictEqual(pending.length,2)
    deliver(pending.find(x=>x.data.phase===order[0]),order[0]==='vision-precheck'?bad:report)
    await Promise.resolve();await Promise.resolve();assert.strictEqual(delivered,false,'非 eager 不得跳过仍在运行的另一侧')
    deliver(pending.find(x=>x.data.phase===order[1]),order[1]==='vision-precheck'?bad:report)
    const final=await result
    assert.strictEqual(final.data.responseStatus,'clinical_abstain');assert.strictEqual(final.data.abstainCode,'quality_conflict');assert.strictEqual(final.data.urgency,'emergency');assert.deepStrictEqual(final.data.diagnosisCandidates,[]);assert.deepStrictEqual(final.data.ragSources,[])
    outcomes.push([final.data.responseStatus,final.data.abstainCode,final.data.urgency]);assert.strictEqual(pending.length,2)
  }
  assert.deepStrictEqual(outcomes[0],outcomes[1])
  let resolve;const p=new Promise(r=>resolve=r),wait=decision.waitPrecheckTerminal(p,18000,clock)
  resolve(bad);assert.strictEqual((await wait).status,'ok');assert.strictEqual(cleared,1)
  const timeout=decision.waitPrecheckTerminal(new Promise(()=>{}),18000,clock);tasks[1]();assert.strictEqual((await timeout).status,'timeout')
  const query={species:'猫',bodyPart:'面部',complaint:'圆形脱毛鳞屑结痂断毛',visualFeatures:['圆形脱毛','鳞屑','结痂','断毛']}
  const hits=kb.search(query),data=api.assembleFastRagData(hits,{visualFeatures:query.visualFeatures,quality:'clear'},'qwen',{model:'mock'},query)
  assert(data.diagnosisCandidates.length>=1);for(const candidate of data.diagnosisCandidates)assert(hits.filter(kb.isPromptWorthyResult).some(h=>h.name===candidate.name))
  const triage=api.applyGuardrails({urgency:'low',diagnosisCandidates:[]},{complaint:'现在呼吸困难'});assert.strictEqual(triage.urgency,'emergency')
  console.log('B06 terminal decision / fast candidate contracts passed')
}
run().catch(e=>{console.error(e);process.exit(1)})
