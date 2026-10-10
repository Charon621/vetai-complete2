const assert = require('assert'), fs = require('fs'), path = require('path')
global.wx = { getStorageSync() { return [] }, setStorageSync() {} }
const tool = require('../evaluation/tools/experiment_retrieval'), weights = require('../utils/retrievalWeights'), replay = require('../evaluation/tools/run_paired_replay'), probe = require('../evaluation/tools/recall_probe')
const baseline = tool.isolate(tool.registration.profiles[0])
// 在 CI/新工作树中也可重建提取前常数源码，避免依赖外部备份位置。
let source = fs.readFileSync(path.join(__dirname, '../utils/kb.js'), 'utf8')
for (const key of Object.keys(weights.weights)) source = source.replace(new RegExp('WEIGHTS\\.' + key + '\\b', 'g'), String(weights.weights[key]))
const before = tool.isolate(tool.registration.profiles[0], { kbSource: source })
const cases = probe.CASES.flatMap(c => [Object.assign({}, { species: c.s, complaint: c.c, bodyPart: c.b }), Object.assign({}, { species: c.s, complaint: c.c, bodyPart: c.b, visualFeatures: c.vf })])
cases.push({ species: '犬', complaint: '耳朵红肿，但没有脓；爪子圆形脱毛', visualFeatures: ['圆形脱毛'], bodyPart: '爪部' })
cases.push({ species: '猫', complaint: '我手上起红疹，猫没有红斑' })
for (const query of cases) {
  const a = baseline.kb.search(query), b = before.kb.search(query)
  assert.deepStrictEqual(a, b, 'default score/components/order changed: ' + query.complaint)
  assert.deepStrictEqual(a.filter(baseline.kb.isPromptWorthyResult), b.filter(before.kb.isPromptWorthyResult))
  assert.strictEqual(baseline.api.isStrongVisionRagHit(a), before.api.isStrongVisionRagHit(b))
  assert.strictEqual(baseline.api.shouldResolveFastRag(a), before.api.shouldResolveFastRag(b))
}
const missing = Object.assign({}, weights.weights); delete missing.photoSpecific
assert.throws(() => weights.validate(missing), /invalid weight/)
assert.throws(() => weights.validate(Object.assign({}, weights.weights, { priorFactor: Infinity })), /invalid weight/)
assert.throws(() => weights.validate(Object.assign({}, weights.weights, { priorFactor: '0' })), /invalid weight/)
assert.strictEqual(weights.validate(Object.assign({}, weights.weights, { priorFactor: 0 })).priorFactor, 0)
const zero = tool.isolate({ selection: 'top3_then_worthy', weights: { priorFactor: 0, signFloor: 0, signCeil: 0 }, gates: { VISION_RAG_MIN_SCORE: 0, VISION_RAG_MIN_GAP: 0 } })
assert.strictEqual(zero.config.VISION_RAG_MIN_SCORE, 0); assert(zero.kb.DISEASE_KB.every(c => c.signWeight === 0))
assert.throws(() => tool.isolate({ selection: 'top3_then_worthy', gates: { UNKNOWN: 0 }, weights: {} }), /invalid gate/)
const shadow = tool.shadowConcepts({ complaint: '下巴黑头粉刺', visualFeatures: ['黑头', '粉刺'] })
assert.strictEqual(shadow.independent_morphology_concepts, 1); assert.strictEqual(shadow.photo_concepts, 1); assert.strictEqual(shadow.owner_concepts, 1)
assert.strictEqual(tool.shadowConcepts({ visualFeatures: ['圆形脱毛', '表皮环'] }).independent_morphology_concepts, 2)
assert(tool.dangerReminder({ complaint: '身上硬块越来越大' }).warning)
for (const complaint of ['现在没有硬块，也没有出血', '如果以后出血怎么办', '以前有硬块，现在没有了', '只有皮屑', '我手上硬块越来越大，猫只有皮屑']) assert.strictEqual(tool.dangerReminder({ complaint }).warning, '', complaint)
function c(id, split) { const query = { species: '猫', bodyPart: '下巴', complaint: '下巴黑头粉刺', visualFeatures: ['黑头', '粉刺'] }; return { case_id: id, animal_id_hash: 'animal-' + id, split: split || 'development', input_snapshot_id: 'snapshot-' + id, input_sha256: replay.hash(query), query } }
const bank = { bank_version: '1.0.0', cases: [c('a'), Object.assign(c('failed'), { fixture_failure: 'timeout' })] }
const result = tool.runBank(bank)
assert.strictEqual(result.records.length, bank.cases.length * tool.registration.profiles.length)
assert.strictEqual(result.records.filter(r => r.execution_status === 'technical_failure').length, tool.registration.profiles.length)
assert.strictEqual(result.best_profile, null); assert.strictEqual(result.clinical_metrics.accuracy, null); assert.strictEqual(result.network_calls, 0)
const leaked = { bank_version: '1.0.0', cases: [c('a'), Object.assign(c('b', 'independent'), { animal_id_hash: 'animal-a' })] }
assert.throws(() => tool.validateCaseBank(leaked), /split leakage/)
assert.strictEqual(tool.runBank({ bank_version: '1.0.0', cases: [c('h', 'independent')] }).records.length, tool.registration.profiles.length)
const drift = c('drift'); drift.query.complaint += 'changed'
assert.throws(() => tool.validateCaseBank({ bank_version: '1.0.0', cases: [drift] }), /hash mismatch/)
// 先worthy再3直接使用独立隔离检索全榜，不能先切3后再filter冒充策略对照。
const all = tool.isolate({ selection: 'all_shadow', weights: {}, gates: {} })
const first = tool.isolate(tool.registration.profiles.find(p => p.id === 'worthy_first'))
for (const query of cases.slice(0, 10)) {
  const ranked = rows => rows.map(r => ({ id: r.id, score: r.score }))
  assert.deepStrictEqual(ranked(first.kb.search(query)), ranked(all.kb.search(query).filter(all.kb.isPromptWorthyResult).slice(0, 3)))
}
console.log('B18 50-case unchanged defaults, shadow concepts, finite offline experiments and leakage contracts passed')
