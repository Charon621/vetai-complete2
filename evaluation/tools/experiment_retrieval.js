#!/usr/bin/env node
// BUG-35：仅离线隔离加载的有限消融。应用不能传入实验权重或策略。
'use strict'
const fs = require('fs'), path = require('path'), Module = require('module')
const replay = require('./run_paired_replay'), weights = require('../../utils/retrievalWeights')
const ROOT = path.resolve(__dirname, '../..'), registration = require('../config/retrieval_experiments.json')
const DEFAULT_CONFIG = require('../../utils/config'), productionKb = require('../../utils/kb'), scope = require('../../utils/evidenceScope')
const GATE_KEYS = ['VISION_RAG_MIN_SCORE', 'VISION_RAG_MIN_GAP', 'VISION_RAG_MIN_PRECHECK_HITS', 'VISION_RAG_MIN_DISCRIMINATIVE', 'VISION_RAG_MIN_SYMPTOM_MATCHES', 'VISION_RAG_MIN_DISCRIMINATIVE_EAGER']
function isolate(profile, options) {
  options = options || {}
  if (!['top3_then_worthy', 'worthy_then_top3', 'all_shadow'].includes(profile.selection)) throw new Error('invalid selection')
  const validated = weights.validate(Object.assign({}, weights.weights, profile.weights)), config = Object.assign({}, DEFAULT_CONFIG)
  Object.keys(profile.gates || {}).forEach(key => {
    const v = profile.gates[key]
    if (!GATE_KEYS.includes(key) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('invalid gate')
    config[key] = v
  })
  const cache = {}
  function load(relative) {
    if (cache[relative]) return cache[relative].exports
    const filename = path.join(ROOT, relative), module = new Module(filename, moduleParent)
    module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename)); cache[relative] = module
    module.require = function(request) {
      if (request === './retrievalWeights') return { VERSION: weights.VERSION, HASH: weights.hash(validated), weights: validated }
      if (request === './config') return config
      if (request === './kb') return load('utils/kb.js')
      return Module.createRequire(filename)(request)
    }
    let source = options.kbSource && relative === 'utils/kb.js' ? options.kbSource : fs.readFileSync(filename, 'utf8')
    if (relative === 'utils/kb.js' && profile.selection !== 'top3_then_worthy') {
      // 审计锚点必须唯一；源码漂移时停止实验，不能悄用错误替换。
      function replaceOnce(anchor, replacement) {
        if (source.split(anchor).length !== 2) throw new Error('selection source anchor drift: ' + anchor)
        source = source.replace(anchor, replacement)
      }
      replaceOnce('return results.slice(0, 3)', profile.selection === 'all_shadow' ? 'return results' : 'return results.filter(isPromptWorthyResult).slice(0, 3)')
      replaceOnce('return chosen.slice(0,3).sort', profile.selection === 'all_shadow' ? 'return chosen.sort' : 'return chosen.filter(isPromptWorthyResult).slice(0,3).sort')
    }
    if (relative === 'utils/api.js') {
      // 实验门槛中的合法 0 不走应用历史 || 回退。
      source = source.replace('config.VISION_RAG_MIN_SCORE || 8', "typeof config.VISION_RAG_MIN_SCORE === 'number' ? config.VISION_RAG_MIN_SCORE : 8")
      source = source.replace('config.VISION_RAG_MIN_SYMPTOM_MATCHES || 2', "typeof config.VISION_RAG_MIN_SYMPTOM_MATCHES === 'number' ? config.VISION_RAG_MIN_SYMPTOM_MATCHES : 2")
    }
    module._compile(source, filename); return module.exports
  }
  const moduleParent = module
  if (!global.wx) global.wx = { getStorageSync() { return [] }, setStorageSync() {} }
  const kb = load('utils/kb.js'), api = load('utils/api.js')
  return { kb, api, weights: validated, weight_hash: weights.hash(validated), config }
}
function shadowConcepts(query) {
  const entries = [], groups = registration.concept_equivalence_groups
  function concept(term) { const group = groups.find(g => g.includes(term)); return group ? group[0] : term }
  const fragments = query.evidenceContext ? query.evidenceContext.activeFacts.map(f => ({ text: f.concept, subject: 'pet', assertion: 'present', temporality: 'current', evidenceSpan: f.evidenceSpan, lesionId: f.lesionId || f.site || 'unspecified' })) : scope.fragments(query.complaint || '')
  fragments.filter(f => f.subject === 'pet' && f.assertion === 'present' && f.temporality === 'current').forEach(f => {
    const terms = productionKb.VISUAL_VOCAB.filter(t => f.text.includes(t))
    terms.forEach(t => entries.push({ concept: concept(t), term: t, source: 'owner', sourceSpan: f.evidenceSpan, lesionId: f.lesionId || 'unspecified' }))
  })
  productionKb.filterPhotoFeatures(query.visualFeatures).forEach((t, i) => entries.push({ concept: concept(t), term: t, source: 'photo', sourceSpan: { featureIndex: i }, lesionId: query.visualLesionId || query.bodyPart || 'unspecified' }))
  // 跨来源复述不是第二种独立形态。计数来源仍分别报告，不能把主人词叫照片词。
  const concepts = [...new Set(entries.map(e => e.concept))]
  return { concept_equivalence_version: registration.concept_equivalence_version, clinical_validated: false, entries, exact_terms: [...new Set(entries.map(e => e.term))].length, independent_morphology_concepts: concepts.length, photo_concepts: [...new Set(entries.filter(e => e.source === 'photo').map(e => e.concept))].length, owner_concepts: [...new Set(entries.filter(e => e.source === 'owner').map(e => e.concept))].length, concepts }
}
function dangerReminder(query) {
  const text = query.evidenceContext ? require('../../utils/caseFacts').evidenceText(query.evidenceContext) : scope.currentPetText(query.complaint || '')
  // 先分诊/检查提醒，不命名罕病，不改变生产紧急度。未知温度/质地不能从照片推断。
  const expandingMass = /越来越大|逐渐增大|持续增大|快速扩大/.test(text) && /硬块|硬疙瘩|肿块|结节/.test(text)
  const bleeding = /出血|流血|破溃/.test(text)
  return { shadow_only: true, disease_names: [], warning: expandingMass || bleeding ? '建议兽医现场评估病灶及是否需要取样；仅凭照片不能确定病因' : '', triggers: (expandingMass ? ['current_expanding_mass'] : []).concat(bleeding ? ['current_bleeding_or_ulceration'] : []) }
}
function validateCaseBank(bank) {
  if (!bank || bank.bank_version !== '1.0.0' || !Array.isArray(bank.cases) || !bank.cases.length) throw new Error('versioned case bank required')
  const animals = {}, ids = new Set()
  bank.cases.forEach(c => {
    for (const k of ['case_id', 'animal_id_hash', 'split', 'input_snapshot_id', 'input_sha256']) if (!c[k]) throw new Error('missing ' + k)
    if (!['development', 'independent'].includes(c.split) || !c.query) throw new Error('invalid split/query')
    if (ids.has(c.case_id)) throw new Error('duplicate case_id'); ids.add(c.case_id)
    if (animals[c.animal_id_hash] && animals[c.animal_id_hash] !== c.split) throw new Error('animal split leakage')
    animals[c.animal_id_hash] = c.split
    if (replay.hash(c.query) !== c.input_sha256) throw new Error('input hash mismatch')
    if (/final_label|gold_tier|acceptable_primary_labels/.test(replay.stable(c.query))) throw new Error('reference leakage')
  })
}
function runBank(bank, reg) {
  reg = reg || registration; validateCaseBank(bank)
  if (reg.scope !== 'offline_only' || reg.model_calls !== 0 || reg.billed_cost !== 0 || reg.primary_attempt_policy !== 'first_scheduled') throw new Error('offline registration required')
  if (reg !== registration && replay.hash(reg) !== replay.hash(registration)) throw new Error('unregistered experiment configuration')
  const profiles = reg.profiles.map(p => ({ profile: p, engine: isolate(p) })), records = []
  for (const c of bank.cases) for (const p of profiles) {
    const identity = { case_id: c.case_id, animal_id_hash: c.animal_id_hash, split: c.split, input_snapshot_id: c.input_snapshot_id, input_sha256: c.input_sha256, scheduled_attempt_id: reg.registration_id + ':' + p.profile.id + ':' + c.case_id + ':1', attempt_index: 1, profile: p.profile.id, weight_version: weights.VERSION, weight_hash: p.engine.weight_hash, config_hash: replay.hash(p.engine.config), selection: p.profile.selection }
    try {
      if (c.fixture_failure) throw new Error(c.fixture_failure)
      const top3 = p.engine.kb.search(c.query), worthy = top3.filter(p.engine.kb.isPromptWorthyResult)
      records.push(Object.assign(identity, { execution_status: 'completed', top3, worthy, fast_eligible: p.engine.api.isStrongVisionRagHit(top3), fast_eager: p.engine.api.shouldResolveFastRag(top3), shadow_counts: shadowConcepts(c.query), danger_reminder: dangerReminder(c.query) }))
    } catch (error) { records.push(Object.assign(identity, { execution_status: 'technical_failure', error: String(error.message) })) }
  }
  const strata = {}
  records.forEach(r => {
    const key = [r.profile, r.split, bank.cases.find(c => c.case_id === r.case_id).query.species || 'unknown'].join('/')
    if (!strata[key]) strata[key] = { scheduled: 0, completed: 0, fast_triggered: 0, eager_triggered: 0, warned: 0 }
    const s = strata[key]; s.scheduled++; if (r.execution_status === 'completed') { s.completed++; s.fast_triggered += Number(r.fast_eligible); s.eager_triggered += Number(r.fast_eager); s.warned += Number(!!r.danger_reminder.warning) }
  })
  return { schema_version: 'retrieval-experiment-result-v1', registration_hash: replay.hash(reg), bank_hash: replay.hash(bank), provenance: replay.provenance(), network_calls: 0, model_calls: 0, billed_cost: 0, strata, records, clinical_metrics: { accuracy: null, false_positive_rate: null, clinical_recall: null, over_abstention: null, dangerous_false_reassurance: null, intervals: null, reason: 'requires independent expert references via B16 scorer' }, best_profile: null, interpretation: reg.interpretation }
}
if (require.main === module) {
  const args = process.argv.slice(2), get = key => args[args.indexOf(key) + 1]
  if (args.includes('--live') || !args.includes('--bank') || !args.includes('--out')) { console.error('Usage: experiment_retrieval.js --bank OFFLINE_JSON --out NEW_ABSOLUTE_JSON (no live)'); process.exitCode = 2 }
  else {
    const out = get('--out')
    if (!path.isAbsolute(out) || path.resolve(out).startsWith(ROOT + path.sep)) throw new Error('output outside repository required')
    const bank = JSON.parse(fs.readFileSync(get('--bank'), 'utf8'))
    validateCaseBank(bank)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out + '.scheduled.json', JSON.stringify({ manifest_version: '1.0.0', registration_hash: replay.hash(registration), bank_hash: replay.hash(bank), scheduled_attempts: bank.cases.flatMap(c => registration.profiles.map(p => ({ run_id: registration.registration_id, case_id: c.case_id, animal_id_hash: c.animal_id_hash, branch: p.id, stage: 'retrieval_experiment', scheduled_attempt_id: registration.registration_id + ':' + p.id + ':' + c.case_id + ':1', attempt_index: 1, input_snapshot_id: c.input_snapshot_id, input_sha256: c.input_sha256 }))) }, null, 2), { flag: 'wx' })
    const result = runBank(bank)
    fs.writeFileSync(out, JSON.stringify(result, null, 2), { flag: 'wx' }); console.log('offline experiment complete; clinical metrics NA; best_profile null')
  }
}
module.exports = { isolate, shadowConcepts, dangerReminder, validateCaseBank, runBank, registration }
