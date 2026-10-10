const assert = require('assert'), cp = require('child_process'), runner = require('../evaluation/tools/run_paired_replay')
const report = { imageFindings: [{ imageIndex: 1, role: 'overview', observation: '局部脱毛', quality: 'clear', usable: true }], observations: '局部脱毛', evidenceFor: ['圆形脱毛', '鳞屑'], evidenceAgainst: [], missingInformation: ['真菌检查'], abstainReason: '', primaryDiagnosis: '皮肤癣菌病（犬猫）', primaryDiagnosisProbability: 60, diagnosisCandidates: [{ name: '皮肤癣菌病（犬猫）', probability: 60, reason: '形态支持', supporting: '圆形脱毛', against: '待检查' }], lesionNameCn: '脱毛', confidence: 60, recommendedTests: ['真菌检查'], urgencyEvidence: [], urgency: 'low', explanation: '待检查确认', possibleMeaning: '初筛', homeCare: '记录变化', whenToWatch: '观察变化', whenToSeeVet: '扩大时就医', diagnosisProbabilityNote: '匹配分' }
function entry() { return { case_id: 'synthetic-cat', animal_id_hash: 'synthetic-animal', run_id: 'test', input_snapshot_id: 'first', scheduled_attempt_id: 'a', attempt_index: 1, response_origin: 'synthetic_fixture', input: { images: ['aGVsbG8='], petInfo: { species: 'cat', complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠', bodyPart: 'head', bodyPartLabel: '面部', useKnowledgeBase: true, imageRoles: ['overview'] } }, fixtures: { precheck: { raw: { quality: 'clear', diagnosabilityScore: 95, visualFeatures: ['圆形脱毛', '鳞屑', '结痂', '断毛'], bodyPartGuess: '面部', lesionPattern: '环形', lesionShape: '圆形' } }, full: { raw: Object.assign({}, report) } } } }
async function run() {
  global.wx = { getStorageSync() { return [] }, setStorageSync() {} }
  const a = await runner.runCase(entry(), { provenance: { code_commit: 'synthetic' } })
  const planned = runner.schedule({ manifest_version: '1.0.0', adapter: 'fixture', cases: [entry()] })
  assert.strictEqual(planned.scheduled_attempts.length, 4)
  assert.deepStrictEqual(planned.scheduled_attempts.map(r => r.scheduled_attempt_id), a.records.map(r => r.scheduled_attempt_id))
  assert.strictEqual(a.records.length, 4); assert.strictEqual(a.records[0].network_calls, 0)
  assert.strictEqual(a.records[1].fixture_calls, 2); assert.strictEqual(a.records[1].responseStatus, 'ok')
  assert.strictEqual(a.records[0].eligible, true); assert.strictEqual(a.records[0].execution_status, 'completed'); assert.strictEqual(a.comparison.comparable, true)
  for (const stage of ['input', 'precheck_provider_raw', 'precheck_canonical', 'retrieval', 'fast_eligibility', 'fast_assembled', 'full_provider_raw', 'full_parsed', 'full_normalized', 'parallel_decision', 'final']) assert(a.events.some(e => e.stage === stage), stage)
  const reversed = entry(); reversed.delivery_order = ['full-diagnosis', 'vision-precheck']
  const b = await runner.runCase(reversed, { provenance: { code_commit: 'synthetic' } })
  assert.deepStrictEqual(a.records.map(r => r.responseStatus), b.records.map(r => r.responseStatus))
  assert.strictEqual(a.records[0].input_sha256, a.records[1].input_sha256)
  assert.strictEqual(a.records[0].precheck_ref, a.records[1].precheck_ref)
  assert.strictEqual(runner.comparePair(a.records[0], Object.assign({}, a.records[1], { input_sha256: 'different' })).comparable, false)
  assert.strictEqual(runner.comparePair(a.records[0], Object.assign({}, a.records[1], { kb_hash: 'different' })).comparable, false)
  const failed = entry(); failed.fixtures.full = { failure: 'timeout' }
  const c = await runner.runCase(failed, { provenance: { code_commit: 'synthetic' } })
  assert.strictEqual(c.records[1].execution_status, 'timeout'); assert.strictEqual(c.comparison.comparable, false)
  const abstain = entry(); abstain.fixtures.full.raw = Object.assign({}, report, { responseStatus: 'clinical_abstain', primaryDiagnosis: '', diagnosisCandidates: [], primaryDiagnosisProbability: 0, confidence: 0, abstainReason: '证据不足以命名病因' })
  const abstained = await runner.runCase(abstain, { provenance: {} }); assert.strictEqual(abstained.records[0].eligible, true); assert.strictEqual(abstained.records[1].responseStatus, 'clinical_abstain'); assert.strictEqual(abstained.records[2].responseStatus, 'clinical_abstain')
  const badSink = { events: [], emit() { throw new Error('disk full') } }
  const d = await runner.runCase(entry(), { sink: badSink, provenance: {} })
  assert.strictEqual(d.records[2].execution_status, 'trace_error'); assert.strictEqual(d.result.success, true)
  const leak = entry(); leak.input.petInfo.final_label = 'secret-reference'
  await assert.rejects(runner.runCase(leak), /reference leakage/)
  const live = cp.spawnSync(process.execPath, ['evaluation/tools/run_dev_set.js', '--live'], { encoding: 'utf8' })
  assert.strictEqual(live.status, 2); assert(/unsupported/.test(live.stderr))
  console.log('real application chain offline pairing / first failure / no live contracts passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { entry }
