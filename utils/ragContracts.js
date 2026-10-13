// 新证据为附加契约；不迁移 case-facts-v1，不对历史概率重排。
var EVIDENCE_VERSION = 'rag-evidence-v1'
var ASSESSMENT_VERSION = 'rag-assessment-v1'
var OBSERVATION_VERSION = 'rag-observation-v1'
var PROMPT_VERSION = 'vetai-rag-observation-v1'
var LIMITS = { facts: 128, images: 12, findingsPerImage: 6, text: 160, scopes: 8, candidates: 3 }
var sequence = 0
function id(prefix) { sequence++; return prefix + '_' + Date.now().toString(36) + '_' + sequence.toString(36) }
function enumValue(value, values) { return values.indexOf(value) >= 0 }
function error(code, field) { return { valid: false, code: code, field: field } }
function validateSnapshot(s) {
  if (!s || s.schemaVersion !== EVIDENCE_VERSION) return error('unknown_evidence_version', 'schemaVersion')
  if(typeof s.snapshotId!=='string'||!s.snapshotId || !s.versions || !s.versions.conceptVersion || !s.versions.promptVersion)return error('invalid_snapshot_identity','snapshot')
  if (!enumValue(s.provenanceStatus,['complete','compatibility_limited'])) return error('invalid_provenance','provenanceStatus')
  if (!Array.isArray(s.facts) || s.facts.length > LIMITS.facts || !Array.isArray(s.manifest) || s.manifest.length > LIMITS.images || !Array.isArray(s.imageQuality)) return error('invalid_shape', 'snapshot')
  var ids = {}, images = {}, indices = {}
  for (var m = 0; m < s.manifest.length; m++) {
    var image = s.manifest[m]
    if (!image || !image.imageId || images[image.imageId] || !image.sourceImageId || !enumValue(image.role, ['overview','closeup','reference','roi','unspecified']) || typeof image.isSent !== 'boolean') return error('invalid_manifest', 'manifest')
    if (image.isSent && (!Number.isInteger(image.sentImageIndex) || image.sentImageIndex < 0 || indices[image.sentImageIndex])) return error('invalid_sent_index','manifest')
    if (!image.isSent && image.sentImageIndex !== null) return error('invalid_unsent_index','manifest')
    if (image.isSent) indices[image.sentImageIndex] = true
    images[image.imageId] = image
  }
  if(s.manifest.some(function(i){return i.role==='roi'? !images[i.sourceImageId] : i.sourceImageId!==i.imageId}))return error('invalid_source_image','manifest')
  var sentCount=s.manifest.filter(function(i){return i.isSent}).length
  for(var ix=0;ix<sentCount;ix++)if(!indices[ix])return error('noncontiguous_sent_index','manifest')
  var qualityIds = {}
  for (var q = 0; q < s.imageQuality.length; q++) {
    var quality = s.imageQuality[q]
    if (!quality || !images[quality.imageId] || !images[quality.imageId].isSent || qualityIds[quality.imageId] || !enumValue(quality.quality,['clear','limited','unusable'])) return error('invalid_image_quality','imageQuality')
    qualityIds[quality.imageId] = true
  }
  if (s.provenanceStatus === 'complete' && s.manifest.some(function(i){ return i.isSent && !qualityIds[i.imageId] })) return error('missing_image_quality','imageQuality')
  for (var i = 0; i < s.facts.length; i++) {
    var f = s.facts[i]
    if (!f || !f.evidenceId || ids[f.evidenceId]) return error('duplicate_or_missing_evidence_id','facts')
    ids[f.evidenceId] = true
    if (typeof f.conceptId !== 'string' || !f.conceptId || typeof f.rawText !== 'string' || f.rawText.length > LIMITS.text || typeof f.observed !== 'boolean' || !enumValue(f.assertion,['present','absent','unknown']) || !enumValue(f.certainty,['clear','possible','indeterminate']) || !enumValue(f.source,['photo','owner_text','profile','clinical_exam']) || !enumValue(f.subject,['pet','owner','other_animal','unknown']) || !enumValue(f.temporality,['current','past','resolved','unknown'])) return error('invalid_fact','facts')
    if (!require('./clinicalConcepts').lookup(f.conceptId,f.source)) return error('unknown_concept_or_source','facts')
    if (f.source === 'photo' && s.provenanceStatus === 'complete' && (!images[f.imageId] || !images[f.imageId].isSent || images[f.imageId].sourceImageId !== f.sourceImageId)) return error('unsent_or_wrong_source','facts')
  }
  return { valid: true }
}
function validateAssessment(a,snapshot) {
  if (!a || a.schemaVersion !== ASSESSMENT_VERSION) return error('unknown_assessment_version','schemaVersion')
  if (!a.runId || !a.inputSnapshotId || !Number.isInteger(a.revision) || a.revision < 1 || !enumValue(a.workflowMode,['legacy','shadow','guided']) || !a.versions || !enumValue(a.provenanceStatus,['complete','compatibility_limited'])) return error('invalid_run','assessment')
  if(['evidenceSchemaVersion','assessmentSchemaVersion','conceptVersion','retrievalProfileVersion','rankPolicyVersion','promptVersion','knowledgeReleaseId'].some(function(k){return typeof a.versions[k]!=='string'||!a.versions[k]}))return error('missing_independent_version','versions')
  if (!enumValue(a.status,['ok','clinical_abstain','schema_error','provider_error']) || !enumValue(a.answerLevel,['ranked_candidates','morphology_only','unavailable'])) return error('invalid_status','assessment')
  if(a.serviceMessage!==undefined && (typeof a.serviceMessage!=='string' || a.serviceMessage.length>240))return error('invalid_service_message','serviceMessage')
  if ((a.status === 'ok' && a.answerLevel === 'unavailable') || (a.status === 'clinical_abstain' && a.answerLevel === 'ranked_candidates') || (['schema_error','provider_error'].indexOf(a.status) >= 0 && a.answerLevel !== 'unavailable')) return error('illegal_status_level','assessment')
  if (!Array.isArray(a.scopeResults) || a.scopeResults.length > LIMITS.scopes || !a.triage || !enumValue(a.nextAction,['none','ask_history','verify_image','seek_exam','full_analysis'])) return error('invalid_shape','assessment')
  if (!enumValue(a.triage.urgency,['unknown','low','moderate','urgent','emergency'])) return error('invalid_triage','triage')
  var hasCandidate = false, hasMorphology = false
  for (var i = 0; i < a.scopeResults.length; i++) {
    var s = a.scopeResults[i]
    if (!s || !Array.isArray(s.candidates) || s.candidates.length > LIMITS.candidates || !Array.isArray(s.morphology) || s.morphology.some(function(m){return !(typeof m==='string'&&m.length) && !(m&&m.evidenceId&&typeof m.text==='string'&&m.text.length)})) return error('invalid_scope','scopeResults')
    hasMorphology = hasMorphology || s.morphology.length > 0
    if(snapshot && s.morphology.some(function(m){return typeof m!=='string'&&!snapshot.facts.some(function(f){return f.evidenceId===m.evidenceId})}))return error('unknown_evidence_reference','morphology')
    for (var j = 0; j < s.candidates.length; j++) {
      var c = s.candidates[j]
      if (!c || !c.cardId || !c.name || !enumValue(c.role,['etiology','presentation','secondary_process','unknown']) || !Array.isArray(c.supportEvidenceIds) || !c.supportEvidenceIds.length || !Array.isArray(c.conflictEvidenceIds) || !Array.isArray(c.missingItems) || !Array.isArray(c.knowledgeBindings) || !c.knowledgeBindings.length || c.probability !== undefined || (c.evidenceTier !== undefined && !enumValue(c.evidenceTier,['named','tentative']))) return error('invalid_candidate','scopeResults')
      if(c.supportEvidenceIds.concat(c.conflictEvidenceIds).some(function(id){return typeof id!=='string'||!id}) || c.missingItems.some(function(t){return typeof t!=='string'}) || c.knowledgeBindings.some(function(b){return !b||b.cardId!==c.cardId||!b.conditionId||!b.field||!b.sourceFieldHash||!enumValue(b.evidenceStatus,['pending','partial_support','source_verified'])}))return error('invalid_candidate_binding','scopeResults')
      if(snapshot && c.supportEvidenceIds.concat(c.conflictEvidenceIds).some(function(id){return !snapshot.facts.some(function(f){return f.evidenceId===id})}))return error('unknown_evidence_reference','scopeResults')
      hasCandidate = true
    }
  }
  if ((a.answerLevel === 'ranked_candidates' && !hasCandidate) || (a.answerLevel !== 'ranked_candidates' && hasCandidate) || (a.answerLevel === 'morphology_only' && !hasMorphology)) return error('empty_or_residual_output','answerLevel')
  if(a.supplementalAnalysis) {
    var sup=a.supplementalAnalysis
    if(!enumValue(sup.status,['ok','clinical_abstain','schema_error','provider_error']) || typeof sup.text!=='string' || sup.text.length>1500 || !Array.isArray(sup.modelSuggestions) || sup.modelSuggestions.length>3 || sup.modelSuggestions.some(function(c){return !c || typeof c.name!=='string' || !c.name || typeof c.note!=='string' || c.probability!==undefined || ['supporting','against'].some(function(k){return c[k]!==undefined && (typeof c[k]!=='string' || c[k].length>480)})}))return error('invalid_supplemental_analysis','supplementalAnalysis')
    if(['evidenceFor','evidenceAgainst','missingInformation','recommendedTests'].some(function(k){return sup[k]!==undefined && (!Array.isArray(sup[k]) || sup[k].length>12 || sup[k].some(function(t){return typeof t!=='string'||t.length>240}))}) || (sup.urgency!==undefined && !enumValue(sup.urgency,['unknown','low','moderate','urgent','emergency'])) || ['homeCare','whenToSeeVet','abstainReason'].some(function(k){return sup[k]!==undefined && (typeof sup[k]!=='string'||sup[k].length>1000)}))return error('invalid_supplemental_fields','supplementalAnalysis')
  }
  return { valid: true }
}
function mode(value) { return enumValue(value,['legacy','shadow','guided']) ? value : 'legacy' }
function readResult(data) { return data && data.assessment ? { kind: 'assessment', data: data.assessment, validation: validateAssessment(data.assessment) } : { kind: 'legacy', data: data || {}, validation: {valid:true} } }
function snapshot(values) { var s=Object.assign({schemaVersion:EVIDENCE_VERSION,snapshotId:id('snapshot'),facts:[],manifest:[],imageQuality:[],unparsed:[],versions:{},provenanceStatus:'complete'}, values || {});s.versions=Object.assign({evidenceSchemaVersion:EVIDENCE_VERSION,conceptVersion:require('./clinicalConcepts').VERSION,promptVersion:PROMPT_VERSION,observationSchemaVersion:OBSERVATION_VERSION},s.versions);return s }
module.exports = { EVIDENCE_VERSION:EVIDENCE_VERSION,ASSESSMENT_VERSION:ASSESSMENT_VERSION,OBSERVATION_VERSION:OBSERVATION_VERSION,PROMPT_VERSION:PROMPT_VERSION,LIMITS:LIMITS,id:id,mode:mode,snapshot:snapshot,validateSnapshot:validateSnapshot,validateAssessment:validateAssessment,readResult:readResult }
