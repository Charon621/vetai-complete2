const assert = require('assert'), c = require('../utils/ragContracts')
assert.equal(require('../utils/config').RAG_WORKFLOW_MODE, 'guided')
assert.equal(require('../utils/caseFacts').VERSION, 'case-facts-v1')
const s = c.snapshot()
assert(c.validateSnapshot(s).valid)
assert.equal(c.validateSnapshot(Object.assign({},s,{schemaVersion:'other'})).code,'unknown_evidence_version')
const fact={evidenceId:'1',conceptId:'c:红斑',rawText:'红',observed:true,assertion:'present',certainty:'clear',source:'owner_text',subject:'pet',temporality:'current'}
assert.equal(c.validateSnapshot(Object.assign({},s,{facts:[fact,fact]})).code,'duplicate_or_missing_evidence_id')
assert.equal(c.readResult({confidence:60}).kind,'legacy')
const a={schemaVersion:c.ASSESSMENT_VERSION,runId:'r',inputSnapshotId:'s',revision:1,workflowMode:'guided',versions:require('../utils/ragAssessment').versions(s),provenanceStatus:'complete',status:'ok',answerLevel:'morphology_only',scopeResults:[{candidates:[],morphology:['红斑']}],triage:{urgency:'unknown'},nextAction:'ask_history'}
assert(c.validateAssessment(a).valid)
assert.equal(c.validateAssessment(Object.assign({},a,{status:'provider_error'})).code,'illegal_status_level')
assert(!c.validateAssessment(Object.assign({},a,{answerLevel:'ranked_candidates'})).valid)
console.log('rag contracts passed')
