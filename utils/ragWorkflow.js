// api 注入传输与安全出口，避免循环依赖。一个动作仅返回一个终态。
var contracts=require('./ragContracts'),retrieval=require('./ragRetrieval'),assessment=require('./ragAssessment')
function run(input,deps) {
  var start=deps.now?deps.now():Date.now(),trace=deps.trace || {emit:function(){}},calls={precheck:0,full:0,verify:0}
  function finish(parsed) {
    if(deps.isCancelled && deps.isCancelled())return {success:false,cancelled:true,error:'本次输入或数据空间已改变，请重新分析'}
    var snapshot=parsed.snapshot || contracts.snapshot({snapshotId:input.runId+':snapshot',manifest:input.petInfo.imageManifest||[],provenanceStatus:'compatibility_limited'})
    snapshot.inputContext=require('./ragInput').context(input.petInfo)
    snapshot.sentImageFingerprints=input.images.map(require('./ragInput').imageFingerprint)
    var ranking=parsed.status==='ok'?retrieval.rank(snapshot,input.petInfo):{scopes:[]}
    trace.emit('rag_retrieval',{snapshot:snapshot,ranking:ranking})
    var built=assessment.build(snapshot,ranking,input.petInfo,{runId:input.runId,workflowMode:'guided',status:parsed.status==='ok'?undefined:parsed.status,reasonCode:parsed.reasonCode,inspectSafety:deps.inspectSafety,guardrails:deps.guardrails})
    if(parsed.status==='provider_error' && parsed.serviceMessage)built.serviceMessage=parsed.serviceMessage
    var precheckEnd=deps.now?deps.now():Date.now()
    function deliver(result) {
    if(deps.isCancelled && deps.isCancelled())return {success:false,cancelled:true,error:'本次输入或数据空间已改变，请重新分析'}
    var end=deps.now?deps.now():Date.now()
    result.data.requestStats={calls:calls,firstUsefulMs:end-start,finalMs:end-start,precheckMs:precheckEnd-start,cost:'unknown'}
    trace.emit('rag_assessment',{output:result.data.assessment,stats:result.data.requestStats})
    if(deps.track)deps.track({answerLevel:built.answerLevel,status:built.status,reasonCode:built.routeReason,precheckCalls:calls.precheck,fullCalls:calls.full,evidenceCount:snapshot.facts.length,candidateCount:built.scopeResults.reduce(function(n,s){return n+s.candidates.length},0),firstUsefulMs:end-start,finalMs:end-start,conceptVersion:built.versions.conceptVersion,rankPolicyVersion:built.versions.rankPolicyVersion,promptVersion:built.versions.promptVersion,knowledgeReleaseId:built.versions.knowledgeReleaseId})
    return result
    }
    // 观察成功但无法形成候选时继续一次完整分析；技术失败和不可辨认照片不触发额外请求。
    var usable=snapshot.imageQuality.some(function(q){return q.quality!=='unusable'})
    if(deps.full && parsed.status==='ok' && built.answerLevel!=='ranked_candidates' && usable && built.triage.urgency!=='emergency') {
      calls.full++
      return deepen({assessment:built,snapshot:snapshot,images:input.images,petInfo:input.petInfo},{full:deps.full,isCancelled:deps.isCancelled,formatError:deps.formatError}).then(function(result) {
        if(result.cancelled)return result
        if(!result.success) {
          built.supplementalAnalysis={status:result.status||'provider_error',text:result.error||'完整分析未完成，照片观察已保留。请重试完整分析。',modelSuggestions:[]}
          return deliver(assessment.result(built,snapshot))
        }
        return deliver(result)
      })
    }
    return deliver(assessment.result(built,snapshot))
  }
  if(['犬','猫','dog','cat'].indexOf(input.petInfo.species)<0)return Promise.resolve(finish({status:'ok',snapshot:contracts.snapshot({snapshotId:input.runId+':snapshot',provenanceStatus:'compatibility_limited'}),reasonCode:'unsupported_species'}))
  var manifest=input.petInfo.imageManifest||[],sent=manifest.filter(function(m){return m&&m.isSent})
  if(!contracts.validateSnapshot(contracts.snapshot({manifest:manifest,provenanceStatus:'compatibility_limited'})).valid || sent.length!==input.images.length)return Promise.resolve(finish({status:'schema_error',snapshot:contracts.snapshot({snapshotId:input.runId+':snapshot',provenanceStatus:'compatibility_limited'}),reasonCode:'invalid_image_manifest'}))
  return Promise.resolve().then(function(){
    if(deps.isCancelled&&deps.isCancelled())return {cancelled:true}
    calls.precheck++;return deps.precheck(input.images,input.petInfo)
  }).then(finish,function(err){return finish({status:'provider_error',reasonCode:/timeout|超时/.test(String(err&&err.message||err))?'precheck_timeout':'precheck_provider_error',serviceMessage:deps.formatError?String(deps.formatError(err)).slice(0,240):''})})
}
function deepen(input,deps) {
  var validation=contracts.validateAssessment(input.assessment,input.snapshot),snapshotCheck=contracts.validateSnapshot(input.snapshot)
  if(!validation.valid||!snapshotCheck.valid||input.assessment.inputSnapshotId!==input.snapshot.snapshotId)return Promise.resolve({success:false,error:'初筛依据已改变，请重新分析'})
  if(!require('./ragInput').matches(input.snapshot,input.images,input.petInfo))return Promise.resolve({success:false,error:'原照片或问诊信息已改变，请重新初筛'})
  if(deps.isCancelled&&deps.isCancelled())return Promise.resolve({success:false,cancelled:true,error:'数据空间已改变'})
  return Promise.resolve().then(function(){return deps.full(input)}).then(function(result) {
    if(deps.isCancelled&&deps.isCancelled())return {success:false,cancelled:true,error:'数据空间已改变'}
    if(!result.success || ['provider_error','schema_error'].indexOf(result.data&&result.data.responseStatus)>=0)return {success:false,status:result.data&&result.data.responseStatus||'provider_error',error:result.error||result.data&&result.data.explanation||'完整分析未完成，照片观察已保留'}
    var revised=JSON.parse(JSON.stringify(input.assessment))
    revised.revision++
    var data=result.data
    function list(key){return (Array.isArray(data[key])?data[key]:[]).filter(function(t){return typeof t==='string'}).slice(0,12).map(function(t){return t.slice(0,240)})}
    revised.supplementalAnalysis={status:data.responseStatus||'ok',text:String(data.explanation||data.possibleMeaning||'').slice(0,1500),modelSuggestions:(data.diagnosisCandidates||[]).map(function(c){return {name:c.name,note:'完整分析提供的核对方向，需兽医检查确认',supporting:String(c.supporting||c.reason||'').slice(0,480),against:String(c.against||'').slice(0,480)}}).slice(0,3),evidenceFor:list('evidenceFor'),evidenceAgainst:list('evidenceAgainst'),missingInformation:list('missingInformation'),recommendedTests:list('recommendedTests'),urgency:data.urgency||'unknown',homeCare:String(data.homeCare||'').slice(0,1000),whenToSeeVet:String(data.whenToSeeVet||'').slice(0,1000),abstainReason:String(data.abstainReason||'').slice(0,480)}
    var out=assessment.result(revised,input.snapshot)
    out.data.requestStats={calls:{precheck:0,full:1,verify:0},cost:'unknown'}
    return out
  },function(err){return {success:false,status:'provider_error',error:deps.formatError?deps.formatError(err):'进一步分析未完成，初筛已保留'}})
}
module.exports={run:run,deepen:deepen}
