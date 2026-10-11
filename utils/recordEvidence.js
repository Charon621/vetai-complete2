// BUG-34：产品只保存轻量最终证据字段，原始输出仅进入显式离线 sink。
function fields(data) {
  data=data||{}
  function list(key){return (Array.isArray(data[key])?data[key]:[]).filter(function(x){return typeof x==='string'}).slice(0,24).map(function(x){return x.slice(0,240)})}
  var result={responseStatus:['ok','clinical_abstain','schema_error','provider_error'].indexOf(data.responseStatus)>=0?data.responseStatus:'unknown',abstainReason:String(data.abstainReason||'').slice(0,480),evidenceFor:list('evidenceFor'),evidenceAgainst:list('evidenceAgainst'),missingInformation:list('missingInformation'),recommendedTests:list('recommendedTests')}
  if(typeof data.traceReference==='string'&&data.traceReference.length<=160)result.traceReference=data.traceReference
  if(data.assessment) {
    var contracts=require('./ragContracts'),validation=contracts.validateAssessment(data.assessment)
    if(!validation.valid)throw Error(validation.code)
    result.assessment=project(data.assessment,['schemaVersion','runId','revision','inputSnapshotId','workflowMode','versions','status','answerLevel','scopeResults','triage','nextAction','routeReason','provenanceStatus','limitations','serviceMessage','supplementalAnalysis'])
    result.assessment.scopeResults=data.assessment.scopeResults.map(function(s){var out=project(s,['lesionId','site','coverage','morphology','candidates']);out.candidates=s.candidates.map(function(c){var row=project(c,['cardId','name','role','supportEvidenceIds','conflictEvidenceIds','missingItems','referenceKnowledge','differentials','knowledgeStatus']);row.knowledgeBindings=c.knowledgeBindings.map(function(b){return project(b,['profileId','cardId','conditionId','field','sourceFieldHash','evidenceStatus'])});return row});out.morphology=s.morphology.map(function(m){return typeof m==='string'?m:project(m,['evidenceId','text','source','site','imageId'])});return out})
    result.assessment.triage=project(data.assessment.triage,['urgency','supportEvidenceIds','completeness'])
    result.assessment.triage.flags=(data.assessment.triage.flags||[]).map(function(f){return project(f,['urgency','desc','matched'])})
    if(data.assessment.supplementalAnalysis){var sup=data.assessment.supplementalAnalysis;result.assessment.supplementalAnalysis=project(sup,['status','text','evidenceFor','evidenceAgainst','missingInformation','recommendedTests','urgency','homeCare','whenToSeeVet','abstainReason']);result.assessment.supplementalAnalysis.modelSuggestions=(sup.modelSuggestions||[]).map(function(m){return project(m,['name','note','supporting','against'])})}
    result.assessment.versions=project(data.assessment.versions,['evidenceSchemaVersion','assessmentSchemaVersion','conceptVersion','retrievalProfileVersion','rankPolicyVersion','promptVersion','knowledgeReleaseId','observationSchemaVersion'])
    if(data.evidenceSnapshot) {
      if(!contracts.validateSnapshot(data.evidenceSnapshot).valid)throw Error('invalid_snapshot')
      var s=data.evidenceSnapshot
      result.evidenceSnapshot=project(s,['schemaVersion','snapshotId','versions','provenanceStatus','truncation','sentImageFingerprints'])
      if(s.inputContext)result.evidenceSnapshot.inputContext=project(s.inputContext,['species','complaint'])
      result.evidenceSnapshot.versions=project(s.versions || {},['evidenceSchemaVersion','assessmentSchemaVersion','conceptVersion','retrievalProfileVersion','rankPolicyVersion','promptVersion','knowledgeReleaseId','observationSchemaVersion'])
      result.evidenceSnapshot.facts=s.facts.map(function(f){return project(f,['evidenceId','conceptId','rawText','assertion','certainty','observed','source','subject','temporality','imageId','sourceImageId','lesionId','site','factEventId','supersedes','provenanceStatus'])})
      result.evidenceSnapshot.manifest=s.manifest.map(function(m){var out=project(m,['imageId','sourceImageId','role','lesionId','sentImageIndex','isSent','dropReason','localPath']);if(typeof out.localPath==='string'&&out.localPath.indexOf('data:')===0)delete out.localPath;return out})
      result.evidenceSnapshot.imageQuality=s.imageQuality.map(function(q){return project(q,['imageId','quality','observation'])})
      result.evidenceSnapshot.unparsed=[]
    }
  }
  return result
}
function project(value,keys){var out={};keys.forEach(function(key){if(value[key]!==undefined)out[key]=JSON.parse(JSON.stringify(value[key]))});return out}
module.exports={fields:fields}
