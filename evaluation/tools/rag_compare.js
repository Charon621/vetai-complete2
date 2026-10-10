#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os')
const kb = require('../../utils/kb'), hybrid = require('../../utils/hybridRetrieval')
const ROOT = path.resolve(__dirname, '../..')
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
function outputRoot() { return process.env.VETAI_OUTPUT_DIR || (process.platform === 'win32' ? 'E:\\CodexOutputs\\vetai-complete2' : path.join(os.homedir(), 'CodexOutputs', 'vetai-complete2')) }
function validate(bank) {
  if (!bank || !bank.version || !Array.isArray(bank.cases) || !bank.cases.length) throw new Error('Versioned nonempty case bank required')
  const ids = new Set(), names = new Set(kb.DISEASE_KB.map(c => c.name))
  bank.cases.forEach(c => {
    if (!c.case_id || ids.has(c.case_id)) throw new Error('Duplicate/missing case ID'); ids.add(c.case_id)
    if (!c.query || typeof c.query.complaint !== 'string' || !c.scenario || !c.input_origin || !c.label_author) throw new Error('Missing input/provenance')
    if (!Array.isArray(c.expected_relevant_cards) || c.expected_relevant_cards.some(n => !names.has(n))) throw new Error('Unknown expected card')
    if (new Set(c.expected_relevant_cards).size !== c.expected_relevant_cards.length) throw new Error('Duplicate expected card')
    if (!['retrieve_reference','no_candidates'].includes(c.expected_behavior) || (c.expected_behavior === 'no_candidates') !== (c.expected_relevant_cards.length === 0)) throw new Error('Inconsistent expected behavior')
    if (/expected_relevant_cards|label_rationale/.test(JSON.stringify(c.query))) throw new Error('Reference leaked into query')
  })
}
function evaluate(bank, searcher) {
  validate(bank); searcher = searcher || hybrid.search
  const rows = [], aggregates = {}
  for (const c of bank.cases) for (const strategy of ['rules','bm25','hybrid_unscoped','hybrid']) {
    const start = process.hrtime.bigint(); let hits = [], error = null
    try { hits = searcher(c.query, strategy) } catch(e) { error = e.message }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6
    const ranked = hits.map(h => h.canonicalName || h.name), expected = c.expected_relevant_cards
    const found = expected.filter(n => ranked.includes(n)), first = ranked.findIndex(n => expected.includes(n))
    const row = { case_id:c.case_id, scenario:c.scenario, strategy, input_sha256:hash(c.query), expected, ranked, status:error?'failed':'completed', error, elapsed_ms:elapsed, recall_at_3:expected.length ? found.length/expected.length : null, reciprocal_rank:expected.length ? (first<0?0:1/(first+1)) : null, no_candidate_pass:expected.length ? null : (!error && !hits.length), full_coverage:!error && (expected.length ? found.length===expected.length : !hits.length) }
    rows.push(row)
    for(const key of [strategy, strategy+'/'+c.scenario]) {
      const a=aggregates[key] || (aggregates[key]={scheduled:0,failures:0,answerable:0,empty_expected:0,full_coverage:0,recall_sum:0,mrr_sum:0,empty_pass:0,latencies:[]})
      a.scheduled++;a.failures+=Number(!!error);a.full_coverage+=Number(row.full_coverage);a.latencies.push(elapsed)
      if(expected.length){a.answerable++;a.recall_sum+=row.recall_at_3;a.mrr_sum+=row.reciprocal_rank}else{a.empty_expected++;a.empty_pass+=Number(row.no_candidate_pass)}
    }
  }
  Object.values(aggregates).forEach(a=>{
    a.mean_recall_at_3=a.answerable?a.recall_sum/a.answerable:null;a.mrr=a.answerable?a.mrr_sum/a.answerable:null
    a.empty_pass_rate=a.empty_expected?a.empty_pass/a.empty_expected:null;a.full_coverage_rate=a.full_coverage/a.scheduled
    a.latencies.sort((a,b)=>a-b);a.p95_ms=a.latencies[Math.max(0,Math.ceil(a.latencies.length*0.95)-1)];delete a.latencies;delete a.recall_sum;delete a.mrr_sum
  })
  const diffs=bank.cases.map(c=>{
    const a=rows.find(r=>r.case_id===c.case_id&&r.strategy==='rules'),b=rows.find(r=>r.case_id===c.case_id&&r.strategy==='hybrid')
    return {case_id:c.case_id,baseline:a.ranked,hybrid:b.ranked,recall_delta:a.recall_at_3===null?null:b.recall_at_3-a.recall_at_3,mrr_delta:a.reciprocal_rank===null?null:b.reciprocal_rank-a.reciprocal_rank,regression:a.full_coverage&&!b.full_coverage,improvement:!a.full_coverage&&b.full_coverage}
  })
  return {schema_version:1,created_at:new Date().toISOString(),dataset_version:bank.version,dataset_sha256:hash(bank),knowledge_version:kb.KB_VERSION,evidence_version:require('../../knowledge/evidence-ledger.json').version,implementation_hashes:Object.fromEntries(['utils/kb.js','utils/hybridRetrieval.js','utils/evidenceScope.js','utils/caseFacts.js','utils/retrievalWeights.js'].map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f),'utf8'))])),scope:'synthetic_engineering_only',model_calls:0,aggregates,diffs,rows,recommendation:diffs.some(d=>d.regression || d.recall_delta<0 || d.mrr_delta<0)?'keep_rules_default_hybrid_regresses':diffs.some(d=>d.improvement || d.recall_delta>0 || d.mrr_delta>0)?'hybrid_gain_requires_followup_validation':'keep_rules_default_no_demonstrated_gain',clinical_accuracy:null}
}
function markdown(result) {
  const lines=['# 检索策略对照','',`题库：${result.dataset_version}。本批为合成工程题，非临床诊断准确率。`,'','|策略|完整覆盖|平均召回@3|MRR|无候选题通过|失败|P95毫秒|','|---|---:|---:|---:|---:|---:|---:|']
  for(const s of ['rules','bm25','hybrid_unscoped','hybrid']){const a=result.aggregates[s];lines.push(`|${s}|${a.full_coverage}/${a.scheduled}|${a.mean_recall_at_3.toFixed(3)}|${a.mrr.toFixed(3)}|${a.empty_pass}/${a.empty_expected}|${a.failures}|${a.p95_ms.toFixed(2)}|`)}
  lines.push('','## 场景分层','','|场景/策略|完整覆盖|平均召回@3|MRR|','|---|---:|---:|---:|')
  Object.keys(result.aggregates).filter(k=>k.includes('/')).forEach(k=>{const a=result.aggregates[k];lines.push(`|${k}|${a.full_coverage}/${a.scheduled}|${a.mean_recall_at_3===null?'—':a.mean_recall_at_3.toFixed(3)}|${a.mrr===null?'—':a.mrr.toFixed(3)}|`)})
  lines.push('','## 每题差异','','所有题的输入哈希、输出顺序、失败和计分见同名 JSON。检索排名分数不表示诊断概率。','')
  result.diffs.forEach(d=>lines.push(`- ${d.case_id}：规则 [${d.baseline.join('、')}]；混合 [${d.hybrid.join('、')}]；召回差 ${d.recall_delta===null?'—':d.recall_delta.toFixed(3)}；MRR差 ${d.mrr_delta===null?'—':d.mrr_delta.toFixed(3)}。`))
  lines.push('',`默认策略建议：${result.recommendation}。`,'','改进归因：BM25 对照使用与混合检索相同的规则准入候选；相对原规则的差异包含扩大候选数量与词频排序。hybrid_unscoped 与 BM25 的差异反映规则排名融合；hybrid 与 hybrid_unscoped 的差异反映多部位覆盖保护。没有使用向量模型。')
  return lines.join('\n')+'\n'
}
if(require.main===module){
  const args=process.argv.slice(2),read=k=>args[args.indexOf(k)+1]
  const bank=JSON.parse(fs.readFileSync(args.includes('--bank')?read('--bank'):path.join(ROOT,'evaluation/datasets/retrieval_scenarios.json'),'utf8'))
  const result=evaluate(bank),out=path.resolve(args.includes('--out')?read('--out'):path.join(outputRoot(),'rag-evaluations',Date.now()+'.json'))
  if(out===ROOT||out.startsWith(ROOT+path.sep))throw new Error('Reports must be outside repository')
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  fs.writeFileSync(out+'.md',markdown(result),{flag:'wx'});console.log(JSON.stringify({report:out,summary:Object.fromEntries(['rules','bm25','hybrid_unscoped','hybrid'].map(s=>[s,result.aggregates[s]])),recommendation:result.recommendation},null,2))
}
module.exports={hash,outputRoot,validate,evaluate,markdown}
