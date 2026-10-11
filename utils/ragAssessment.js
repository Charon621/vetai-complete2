var contracts=require('./ragContracts'),concepts=require('./clinicalConcepts'),retrieval=require('./ragRetrieval')
function versions(snapshot) {return Object.assign({evidenceSchemaVersion:contracts.EVIDENCE_VERSION,assessmentSchemaVersion:contracts.ASSESSMENT_VERSION,conceptVersion:concepts.VERSION,retrievalProfileVersion:require('./retrievalProfileBundle').version,rankPolicyVersion:retrieval.POLICY.version,promptVersion:contracts.PROMPT_VERSION,knowledgeReleaseId:require('./knowledgeBundle').release.id || require('./retrievalProfileBundle').knowledgeReleaseId},snapshot.versions||{})}
function build(snapshot,ranking,context,options) {
  options=options||{};context=context||{}
  var scopeResults=(ranking.scopes||[]).map(function(scope) {
    var morphology=snapshot.facts.filter(function(f){return retrieval.scopeKey(f)===scope.lesionId && f.source==='photo' && f.assertion==='present' && retrieval.eligible(f,snapshot)}).map(function(f){return {evidenceId:f.evidenceId,text:(f.certainty==='possible'?'可能可见':'可见')+concepts.lookup(f.conceptId).term,source:f.source,site:f.site,imageId:f.imageId}})
    return {lesionId:scope.lesionId,site:scope.site,coverage:scope.coverage,morphology:morphology,candidates:scope.candidates.map(function(c){return {cardId:c.cardId,name:c.name,role:c.role,supportEvidenceIds:c.supports.map(function(s){return s.evidenceId}),conflictEvidenceIds:c.conflicts.map(function(s){return s.evidenceId}),missingItems:c.missing,knowledgeBindings:c.knowledgeBindings,referenceKnowledge:c.referenceKnowledge,differentials:c.ddx,knowledgeStatus:c.sourceStatus}})}
  })
  var hasCandidates=scopeResults.some(function(s){return s.candidates.length}),hasMorphology=scopeResults.some(function(s){return s.morphology.length})
  var status=options.status || (hasCandidates||hasMorphology?'ok':'clinical_abstain'),level=hasCandidates?'ranked_candidates':hasMorphology?'morphology_only':'unavailable'
  if(status==='provider_error'||status==='schema_error'){level='unavailable';scopeResults=[]}
  var risk={urgency:'unknown',supportEvidenceIds:[],flags:[],completeness:'incomplete'}
  if(options.guardrails) {
    var checked=options.guardrails({urgency:'unknown',observations:snapshot.facts.filter(function(f){return f.source==='photo'&&f.assertion==='present'&&retrieval.eligible(f,snapshot)}).map(function(f){return f.rawText}).join(' ')},Object.assign({},context,{complaint:context.evidenceContext && context.evidenceContext.rawOwnerText || context.complaint || ''}))
    if(checked.redLineFlags && checked.redLineFlags.length){risk.urgency=checked.urgency;risk.flags=checked.redLineFlags;risk.supportEvidenceIds=snapshot.facts.filter(function(f){return retrieval.eligible(f,snapshot)&&f.assertion==='present'&&risk.flags.some(function(flag){return f.rawText.indexOf(flag.matched)>=0})}).map(function(f){return f.evidenceId});risk.completeness='known_risk'}
  }
  var a={schemaVersion:contracts.ASSESSMENT_VERSION,runId:options.runId || contracts.id('run'),revision:options.revision || 1,inputSnapshotId:snapshot.snapshotId,workflowMode:options.workflowMode || 'guided',versions:versions(snapshot),status:status,answerLevel:level,scopeResults:scopeResults,triage:risk,nextAction:risk.urgency!=='unknown'?'seek_exam':level==='unavailable'?'verify_image':hasCandidates?'seek_exam':'ask_history',routeReason:options.reasonCode || (hasCandidates?'supported_candidates':hasMorphology?'general_morphology':'no_usable_observations'),provenanceStatus:snapshot.provenanceStatus,limitations:[]}
  if(snapshot.provenanceStatus!=='complete')a.limitations.push('历史观察无法逐图对应，依据存在来源限制。')
  if(snapshot.truncation)a.limitations.push('本次观察有长度限制，未覆盖全部可见细节。')
  if(snapshot.manifest.some(function(i){return !i.isSent}))a.limitations.push('本次只分析已发送的照片，其他照片未参与判断。')
  if(snapshot.imageQuality.some(function(i){return i.quality==='unusable'}))a.limitations.push('部分照片无法辨认，已排除这些照片的观察。')
  if(options.inspectSafety) {
    var texts=[]
    scopeResults.forEach(function(s){s.morphology.forEach(function(m){texts.push(m.text)});s.candidates.forEach(function(c){texts=texts.concat([c.name,c.referenceKnowledge,c.differentials],c.missingItems)})})
    if(texts.some(function(text){return options.inspectSafety(text,{fieldDomain:'care'}).unsafeHits.length>0})){
      a.status='schema_error';a.answerLevel='unavailable';a.scopeResults=[];a.routeReason='unsafe_output';a.nextAction='seek_exam'
    }
  }
  var validation=contracts.validateAssessment(a,snapshot)
  if(!validation.valid)throw Error(validation.code)
  return a
}
function result(assessment,snapshot) {
  var morphology=[],names=[]
  assessment.scopeResults.forEach(function(s){morphology=morphology.concat(s.morphology.map(function(m){return m.text}));names=names.concat(s.candidates.map(function(c){return c.name}))})
  // 中性旧字段用于导航；新页面以assessment为权威，不伪造概率。
  return {success:true,data:{assessment:assessment,evidenceSnapshot:snapshot,responseStatus:assessment.status,primaryDiagnosis:'皮肤表现初筛',lesionNameCn:'皮肤表现初筛',diagnosisCandidates:[],observations:morphology.join('；'),explanation:names.length?'优先核对方向：'+names.join('、'):'目前信息不足以区分病因。',urgency:assessment.triage.urgency,disclaimer:'此结果为初筛参考，不能代替兽医检查。',generatedAt:new Date().toISOString()}}
}
module.exports={build:build,result:result,versions:versions}
