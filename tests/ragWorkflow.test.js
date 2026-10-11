const assert=require('assert'),runner=require('../evaluation/tools/run_paired_replay'),fixture=require('./fixtures/rag')
async function run(){
  global.wx={getStorageSync(){return []},setStorageSync(){}}
  const guided=await runner.runCase(fixture.entry(),{provenance:{code_commit:'synthetic'}})
  assert.deepEqual(guided.calls,['vision-precheck']);assert.equal(guided.records[1].execution_status,'not_scheduled')
  assert.equal(guided.result.data.assessment.answerLevel,'ranked_candidates')
  assert.equal(guided.result.data.requestStats.calls.full,0)
  const bad=fixture.entry();bad.fixtures.precheck.raw='{'
  const failed=await runner.runCase(bad,{provenance:{}})
  assert.equal(failed.result.data.assessment.status,'schema_error');assert.equal(failed.calls.length,1)
  const provider=fixture.entry();provider.fixtures.precheck.failure='timeout'
  const timeout=await runner.runCase(provider,{provenance:{}})
  assert.equal(timeout.result.data.assessment.status,'provider_error');assert.equal(timeout.calls.length,1)
  const quota=fixture.entry();quota.fixtures.precheck.failure='今日使用次数已达上限，请明天再试'
  const limited=await runner.runCase(quota,{provenance:{}})
  assert.equal(limited.result.data.assessment.serviceMessage,quota.fixtures.precheck.failure)
  const savedLimited=require('../utils/recordEvidence').fields(limited.result.data)
  assert.equal(require('../utils/reportViewModel').build(savedLimited).nextActionText,quota.fixtures.precheck.failure)
  const privateFailure=fixture.entry();privateFailure.fixtures.precheck.failure='private-server-detail'
  const sanitized=await runner.runCase(privateFailure,{provenance:{}})
  assert(!JSON.stringify(sanitized.result.data).includes('private-server-detail'))
  const generic=await runner.runCase(fixture.entry(['红斑','脱毛']),{provenance:{}})
  assert.equal(generic.result.data.assessment.answerLevel,'morphology_only')
  assert.deepEqual(generic.calls,['vision-precheck','full-diagnosis'])
  assert.equal(generic.result.data.assessment.supplementalAnalysis.status,'ok')
  assert.equal(generic.result.data.requestStats.calls.full,1)
  assert(!JSON.stringify(generic.result.data.assessment.supplementalAnalysis).includes('probability'))
  const fallbackFail=fixture.entry(['红斑','脱毛']);fallbackFail.fixtures.full={failure:'timeout'}
  const kept=await runner.runCase(fallbackFail,{provenance:{}})
  assert(kept.result.success);assert.equal(kept.result.data.assessment.supplementalAnalysis.status,'provider_error');assert.equal(kept.result.data.assessment.scopeResults[0].morphology.length,2)
  assert.deepEqual(kept.calls,['vision-precheck','full-diagnosis'])
  const unusable=fixture.entry([]);unusable.fixtures.precheck.raw.images[0].quality='unusable'
  assert.deepEqual((await runner.runCase(unusable,{provenance:{}})).calls,['vision-precheck'])
  const brokenFull=fixture.entry(['红斑','脱毛']);brokenFull.fixtures.full.raw={garbage:true}
  const broken=await runner.runCase(brokenFull,{provenance:{}});assert(broken.result.success);assert.equal(broken.result.data.assessment.supplementalAnalysis.status,'schema_error')
  const neck=fixture.entry(['红斑','结痂','局灶脱毛','破溃']);neck.input.petInfo.species='dog';neck.fixtures.precheck.raw.images[0].findings.forEach(f=>f.site='颈部')
  const neckResult=await runner.runCase(neck,{provenance:{}});assert.deepEqual(neckResult.calls,['vision-precheck','full-diagnosis']);assert.equal(neckResult.result.data.assessment.scopeResults[0].candidates.length,0);assert(neckResult.result.data.assessment.supplementalAnalysis)
  const full=fixture.entry();full.action='full_analysis';full.assessment=guided.result.data.assessment;full.evidence_snapshot=guided.result.data.evidenceSnapshot
  const deeper=await runner.runCase(full,{provenance:{}})
  assert.deepEqual(deeper.calls,['full-diagnosis']);assert.equal(deeper.result.data.assessment.revision,2)
  const changed=JSON.parse(JSON.stringify(full));changed.input.images=['ZGlmZmVyZW50'];const reject=await runner.runCase(changed,{provenance:{}});assert.equal(reject.result.success,false);assert.deepEqual(reject.calls,[])
  changed.input.images=full.input.images;changed.input.petInfo.species='dog';assert.deepEqual((await runner.runCase(changed,{provenance:{}})).calls,[])
  assert(deeper.events.some(e=>e.stage==='full_request'&&JSON.stringify(e.data.prompt).includes('supportEvidenceIds')))
  full.fixtures.full={failure:'timeout'}
  const retry=await runner.runCase(full,{provenance:{}});assert.equal(retry.result.success,false);assert.equal(full.assessment.revision,1)
  full.fixtures.full={failure:'今日使用次数已达上限，请明天再试'}
  const fullLimited=await runner.runCase(full,{provenance:{}})
  assert.equal(fullLimited.result.status,'provider_error')
  assert.equal(fullLimited.result.error,full.fixtures.full.failure)
  const autoLimited=fixture.entry(['红斑','脱毛']);autoLimited.fixtures.full=full.fixtures.full
  const keptLimited=await runner.runCase(autoLimited,{provenance:{}})
  assert.equal(keptLimited.result.data.assessment.supplementalAnalysis.text,full.fixtures.full.failure)
  const legacy=fixture.entry(null,'legacy');legacy.fixtures.precheck.raw={visualFeatures:['圆形脱毛','鳞屑'],quality:'clear',diagnosabilityScore:95}
  const l=await runner.runCase(legacy,{provenance:{}});legacy.workflow_mode='shadow'
  const shadow=await runner.runCase(legacy,{provenance:{}})
  assert.deepEqual(shadow.calls,l.calls)
  assert.deepEqual(shadow.events.filter(e=>/_request$/.test(e.stage)).map(e=>e.data.prompt),l.events.filter(e=>/_request$/.test(e.stage)).map(e=>e.data.prompt))
  assert(shadow.events.some(e=>e.stage==='shadow_local'))
  let pending,scope='one',calls=0
  global.wx={getStorageSync(k){return k==='vetai_current_user'?{id:scope}:[]},setStorageSync(){},cloud:{callFunction(o){calls++;pending=o}}}
  const api=require('../utils/api'),p=api.diagnose(['aGVsbG8='],fixture.entry().input.petInfo,{workflowMode:'guided'})
  await Promise.resolve();await Promise.resolve();assert.equal(calls,1)
  const duplicate=await api.diagnose(['aGVsbG8='],fixture.entry().input.petInfo,{workflowMode:'guided'});assert.equal(duplicate.success,false)
  scope='two';pending.success({result:{success:true,data:{choices:[{message:{content:JSON.stringify(fixture.observation(['鳞屑']))}}]}}})
  const cancelled=await p;assert(cancelled.cancelled)
  let pre=0
  const workflow=require('../utils/ragWorkflow')
  const before=await workflow.run({runId:'cancelled',images:['aGVsbG8='],petInfo:fixture.entry().input.petInfo},{isCancelled:()=>true,precheck:()=>{pre++}})
  assert(before.cancelled);assert.equal(pre,0)
  let resolveFull,cancelFull=false
  const observation=require('../utils/ragObservation').parse(JSON.stringify(fixture.observation(['红斑','脱毛'])),fixture.manifest,null,'cancel-full')
  const inFlight=workflow.run({runId:'cancel-full',images:['aGVsbG8='],petInfo:fixture.entry().input.petInfo},{precheck:()=>observation,full:()=>new Promise(resolve=>resolveFull=resolve),isCancelled:()=>cancelFull})
  for(let i=0;i<5;i++)await Promise.resolve()
  assert(resolveFull);cancelFull=true;resolveFull({success:true,data:fixture.report});assert((await inFlight).cancelled)
  console.log('guided actual one precheck / explicit full / shadow parity / cancellation / duplicate passed')
}
run().catch(e=>{console.error(e);process.exitCode=1})
