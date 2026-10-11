#!/usr/bin/env node
// BUG-34：同输入、同预检，经真实应用链配对。唯一适配器是离线 fixture；禁止网络。
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process')
const ROOT = path.resolve(__dirname, '../..'), sinkModule = require('./evaluation_trace_sink')
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex') }
function provenance() {
  const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean).sort()
  // 嵌套仓库（如 collaboration-web/，自带 .git）会以目录条目出现在 ls-files 中，无法逐文件哈希，直接跳过
  const isNestedRepoOrDir = f => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isDirectory()
  const tracked = [...new Set(files.filter(f => !isNestedRepoOrDir(f)))].map(f => [f, fs.existsSync(path.join(ROOT, f)) ? hash(fs.readFileSync(path.join(ROOT, f)).toString('base64')) : 'deleted'])
  const kb = require('../../utils/kb'), api = require('../../utils/api')
  return { code_commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), dirty_tree_hash: hash(tracked), kb_version: kb.KB_VERSION, kb_hash: hash(kb.DISEASE_KB), vocab_version: kb.VOCAB_VERSION, vocab_hash: kb.VOCAB_HASH, weight_version: kb.WEIGHT_VERSION, weight_hash: kb.WEIGHT_HASH, prompt_version: api.PROMPT_VERSION, prompt_source_hash: hash(fs.readFileSync(path.join(ROOT, 'utils/knowledge.js')).toString()), schema_version: 'paired-replay-v1', selection_strategy: 'production_top3_then_worthy' }
}
function validate(entry) {
  for (const key of ['case_id', 'animal_id_hash', 'run_id', 'input_snapshot_id', 'scheduled_attempt_id']) if (!entry[key]) throw new Error('missing ' + key)
  if (entry.attempt_index !== 1) throw new Error('runner only executes preregistered first attempt; retries must be separate archives')
  if (!['synthetic_fixture', 'approved_record_replay'].includes(entry.response_origin)) throw new Error('unapproved response origin')
  if (entry.response_origin === 'approved_record_replay' && !entry.approval_reference) throw new Error('missing replay approval_reference')
  if (!entry.input || !entry.input.petInfo || !Array.isArray(entry.input.images) || !entry.fixtures) throw new Error('missing input/fixtures')
  if (/final_label|gold_tier|acceptable_primary_labels/.test(stable(entry.input))) throw new Error('reference leakage into input')
}
function comparePair(a, b) {
  for (const key of ['case_id', 'input_snapshot_id', 'input_sha256', 'precheck_ref']) if (!a[key] || a[key] !== b[key]) return { comparable: false, reason: 'mismatched_' + key }
  for (const key of ['code_commit', 'dirty_tree_hash', 'kb_hash', 'vocab_hash', 'weight_hash', 'prompt_source_hash']) if (a[key] !== b[key]) return { comparable: false, reason: 'mismatched_' + key }
  if (a.execution_status !== 'completed' || b.execution_status !== 'completed' || a.responseStatus !== 'ok' || b.responseStatus !== 'ok') return { comparable: false, reason: 'non_etiologic_or_technical_branch' }
  function canonical(name) {
    const ontology = require('../reference_data/label_ontology.json')
    const hits = ontology.labels.filter(e => [e.code, e.label_zh, e.product_kb_name].concat(e.synonyms_zh || []).includes(name))
    return hits.length === 1 ? hits[0].code : null
  }
  const left = canonical(a.output.primaryDiagnosis), right = canonical(b.output.primaryDiagnosis)
  if (!left || !right) return { comparable: false, reason: 'unresolved_concept', raw_name_disagreement: a.output.primaryDiagnosis !== b.output.primaryDiagnosis }
  return { comparable: true, disagreement: left !== right, left_code: left, right_code: right, reference_standard: false }
}
async function runCase(entry, options) {
  validate(entry); options = options || {}
  const priorWx = global.wx, calls = [], sink = options.sink || sinkModule.create({ id: entry.scheduled_attempt_id })
  const meta = Object.assign({}, options.provenance || provenance(), { case_id: entry.case_id, run_id: entry.run_id, response_origin: entry.response_origin })
  const workflowMode = entry.workflow_mode || 'legacy'
  const allowed = entry.allowed_phases || (entry.action === 'full_analysis' ? {'full-diagnosis':1} : entry.input.petInfo.useKnowledgeBase === false ? {'full-diagnosis':1} : {'vision-precheck':1,'full-diagnosis':1})
  const transport = createFixtureTransport(entry, allowed, calls, options)
  global.wx = {
    getStorageSync() { return [] }, setStorageSync() {},
    request() { throw new Error('NETWORK_DISABLED') },
    cloud: { callFunction: transport.call }
  }
  try {
    const api = require('../../utils/api')
    const method = entry.action === 'full_analysis' ? api.deepenAssessment : api.diagnose
    if (!method) throw new Error('action_not_implemented')
    const result = await method(entry.input.images, entry.input.petInfo, { _skipLock: true, runId:entry.run_id, workflowMode, assessment:entry.assessment, evidenceSnapshot:entry.evidence_snapshot, traceSink: sink, evaluationMetadata: meta, evaluationMode: 'paired_replay' })
    if (transport.errors.length) throw new Error(transport.errors.join(';'))
    const events = sink.events || []
    const last = stage => { const rows = events.filter(e => e.stage === stage); return rows.length ? rows[rows.length - 1].data : null }
    const canonical = last('precheck_canonical'), rawPre = last('precheck_provider_raw'), fullError = last('full_error')
    const common = Object.assign({}, meta, { animal_id_hash: entry.animal_id_hash, input_snapshot_id: entry.input_snapshot_id, input_sha256: hash(entry.input), precheck_ref: hash({ raw: rawPre, canonical }), image_hashes: entry.input.images.map(hash), evidence_context_hash: hash(entry.input.petInfo.evidenceContext || null), attempt_index: 1, stage: 'system_output', network_calls: 0, fixture_calls: calls.length, billed_cost: 0, trace_status: result.evaluationTraceStatus || 'unscorable', trace_reference: result.data && result.data.traceReference, requests: events.filter(e => /_request$/.test(e.stage)).map(e => Object.assign({}, e.data, { prompt_sha256: hash(e.data.prompt || null) })), provider_usage: events.filter(e => /_provider_raw$/.test(e.stage)).map(e => ({ stage: e.stage, usage: e.data.usage, origin: entry.response_origin })), elapsed_ms: events.length > 1 ? Date.parse(events[events.length - 1].at) - Date.parse(events[0].at) : null })
    common.phase_calls=Object.assign({'vision-precheck':0,'full-diagnosis':0},transport.counts)
    common.real_model_cost='not_measured';common.real_model_latency='not_measured';common.clinical_accuracy='not_measured'
    common.actual_run_id=result.data&&result.data.assessment&&result.data.assessment.runId||null
    common.actual_evidence_snapshot_id=result.data&&result.data.evidenceSnapshot&&result.data.evidenceSnapshot.snapshotId||null
    common.actual_evidence_sha256=result.data&&result.data.evidenceSnapshot?hash(result.data.evidenceSnapshot):null
    function branch(name, output, eligible) {
      const status = output && (output.assessment&&output.assessment.status || output.responseStatus) || (output ? 'ok' : 'not_eligible')
      const execution = common.trace_status !== 'complete' ? 'trace_error' : !output ? (name === 'full' && !calls.some(c=>c.data.phase==='full-diagnosis') ? 'not_scheduled' : 'not_eligible') : ['schema_error', 'provider_error'].includes(status) ? fullError && fullError.errorCode === 'timeout' ? 'timeout' : status : 'completed'
      const filter = last(name === 'fast' ? 'fast_candidate_filter' : 'full_candidate_filter')
      const after = filter && filter.after || []
      const afterNames = after.map(v => typeof v === 'string' ? v : v.name)
      const excluded = (filter && filter.before || []).map(v => typeof v === 'string' ? v : v.name).filter(v => !afterNames.includes(v)).map(v => ({ name: v, reason: 'other', actual_filter_reason: filter.reason }))
      return Object.assign({}, common, { branch: name, scheduled_attempt_id: entry.scheduled_attempt_id + ':' + name, execution_status: execution, responseStatus: status, answerLevel:output&&output.assessment&&output.assessment.answerLevel||null,requestStats:output&&output.requestStats||null,eligible, excluded_candidates: excluded, output: output || null })
    }
    const fast = branch('fast', (last('fast_assembled') || {}).output, !!(last('fast_eligibility') || {}).eligible)
    const full = branch('full', (last('full_normalized') || {}).output || (fullError ? { responseStatus: 'provider_error', primaryDiagnosis: '', diagnosisCandidates: [] } : null), true)
    const final = branch('final', result.data, true)
    const guidedRetrieved=last('rag_retrieval'),retrieved = last('retrieval')
    const kb = require('../../utils/kb')
    const worthy = retrieved ? retrieved.top3.filter(kb.isPromptWorthyResult) : []
    const retrieval = branch('retrieval', guidedRetrieved ? {responseStatus:result.data.assessment.status,assessment:result.data.assessment,evidenceSnapshot:guidedRetrieved.snapshot,ranking:guidedRetrieved.ranking} : retrieved ? { responseStatus: worthy.length ? 'ok' : 'clinical_abstain', primaryDiagnosis: worthy.length ? worthy[0].canonicalName || worthy[0].name : '', diagnosisCandidates: worthy.map(r => ({ name: r.canonicalName || r.name })), urgency: worthy.length ? worthy[0].urgency : 'low', abstainReason: worthy.length ? '' : 'no_prompt_worthy_result' } : null, !!(retrieved||guidedRetrieved))
    return { records: [fast, full, final, retrieval], comparison: comparePair(fast, full), events, result, calls:calls.map(c=>c.data.phase), stageStatus: {'vision-precheck':calls.some(c=>c.data.phase==='vision-precheck')?'scheduled':'not_scheduled','full-diagnosis':calls.some(c=>c.data.phase==='full-diagnosis')?'scheduled':'not_scheduled'} }
  } finally { global.wx = priorWx; if (!options.sink) sink.close() }
}
function createFixtureTransport(entry, allowed, calls, options) {
  options = options || {}; calls = calls || []
  const counts={},errors=[],schedule=options.schedule || ((fn,ms)=>setTimeout(fn,ms))
  function call(request) {
    const phase=request.data.phase
    counts[phase]=(counts[phase]||0)+1
    if (!allowed[phase] || counts[phase]>allowed[phase]) { errors.push('unexpected fixture phase or extra model call: '+phase); throw new Error(errors[errors.length-1]) }
    calls.push(request)
    const fixture=entry.fixtures[phase==='vision-precheck'?'precheck':'full']
    const order=entry.delivery_order||['vision-precheck','full-diagnosis']
    const delay=fixture && fixture.delay_ms !== undefined ? fixture.delay_ms : Math.max(0,order.indexOf(phase))
    let delivered=false
    schedule(()=>{
      if(delivered) {errors.push('duplicate_fixture_delivery');return}
      delivered=true
      if(!fixture || fixture.failure)request.fail({errMsg:fixture&&fixture.failure||'missing_fixture'})
      else request.success({result:{success:true,data:{choices:[{message:{content:typeof fixture.raw==='string'?fixture.raw:JSON.stringify(fixture.raw)},finish_reason:fixture.finish_reason||'stop'}],usage:fixture.usage||null}}})
    },delay)
  }
  return {call,counts,errors}
}
async function runManifest(manifest, options) {
  if (manifest.adapter !== 'fixture' || manifest.manifest_version !== '1.0.0' || !Array.isArray(manifest.cases)) throw new Error('only versioned offline fixture manifest supported')
  const ids = new Set(), outputs = [], metadata = provenance()
  for (const entry of manifest.cases) {
    if (ids.has(entry.scheduled_attempt_id)) throw new Error('duplicate scheduled attempt')
    ids.add(entry.scheduled_attempt_id)
    let output
    try{output=await runCase(entry,Object.assign({},options,{provenance:metadata}))}catch(err){output={events:[],records:schedule({adapter:'fixture',manifest_version:'1.0.0',cases:[entry]}).scheduled_attempts.map(r=>Object.assign({},metadata,r,{execution_status:'failed',responseStatus:'provider_error',error_code:'runner_error',error:String(err.message).slice(0,200),network_calls:0,trace_status:'unscorable'})),result:{success:false}}}
    outputs.push(output);if(options&&options.onCase)options.onCase(output)
  }
  return outputs
}
function schedule(manifest) {
  if (manifest.adapter !== 'fixture' || manifest.manifest_version !== '1.0.0' || !Array.isArray(manifest.cases)) throw new Error('offline versioned manifest required')
  const ids = new Set(), entries = []
  manifest.cases.forEach(entry => {
    validate(entry)
    if (ids.has(entry.scheduled_attempt_id)) throw new Error('duplicate scheduled attempt')
    ids.add(entry.scheduled_attempt_id)
    for (const branch of ['fast', 'full', 'final', 'retrieval']) entries.push({ run_id: entry.run_id, case_id: entry.case_id, branch, stage: 'system_output', scheduled_attempt_id: entry.scheduled_attempt_id + ':' + branch, attempt_index: 1, input_snapshot_id: entry.input_snapshot_id, input_sha256: hash(entry.input), animal_id_hash: entry.animal_id_hash })
  })
  return { manifest_version: '1.0.0', scheduled_attempts: entries }
}
if (require.main === module) {
  const args = process.argv.slice(2), get = key => args[args.indexOf(key) + 1]
  if (args.includes('--live') || args.includes('--adapter') && get('--adapter') !== 'fixture') { console.error('unsupported: offline fixture adapter only'); process.exitCode = 2 }
  else if (!args.includes('--manifest') || !args.includes('--out')) { console.error('Usage: run_paired_replay.js --manifest FILE --out ABSOLUTE_JSONL'); process.exitCode = 2 }
  else {
    const out = get('--out')
    if (!path.isAbsolute(out) || fs.existsSync(out) || path.resolve(out).startsWith(ROOT + path.sep)) throw new Error('output must be new absolute path outside source repository')
    const manifest = JSON.parse(fs.readFileSync(get('--manifest'), 'utf8'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    // 运行前落下唯一分母。进程失败/中断也不能令计划尝试消失。
    fs.writeFileSync(out + '.scheduled.json', JSON.stringify(schedule(manifest), null, 2), { flag: 'wx' })
    fs.writeFileSync(out,'',{flag:'wx'});fs.writeFileSync(out+'.trace.jsonl','',{flag:'wx'})
    runManifest(manifest,{onCase:r=>{fs.appendFileSync(out,r.records.map(v=>JSON.stringify(v)).join('\n')+'\n');fs.appendFileSync(out+'.trace.jsonl',r.events.map(v=>JSON.stringify(v)).join('\n')+'\n')}}).then(results => {
      console.log(JSON.stringify({ cases: results.length, comparisons: results.map(r => r.comparison), actual_network_calls: 0, origin: 'offline_replay' }))
    }).catch(error => { console.error(error); process.exitCode = 1 })
  }
}
module.exports = { runCase, runManifest, schedule, comparePair, hash, stable, provenance, createFixtureTransport }
