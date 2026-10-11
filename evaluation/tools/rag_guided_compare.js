'use strict'
const kb=require('../../utils/kb'),cf=require('../../utils/caseFacts'),concepts=require('../../utils/clinicalConcepts'),contracts=require('../../utils/ragContracts'),retrieval=require('../../utils/ragRetrieval'),assessment=require('../../utils/ragAssessment')
function snapshot(query,id){
  const context=cf.buildEvidenceContext({factEvents:cf.textToEvents(query.complaint,id,[]).events,rawOwnerText:query.complaint,lastOwnerText:query.complaint})
  return concepts.adaptLegacyPrecheck({visualFeatures:query.visualFeatures||[],quality:'clear'},context,id)
}
function canonicalQuery(query,s){return Object.assign({},query,{visualFeatures:s.facts.filter(f=>f.source==='photo'&&f.assertion==='present').map(f=>concepts.lookup(f.conceptId).term),complaint:s.facts.filter(f=>f.source==='owner_text'&&f.subject==='pet'&&f.temporality==='current'&&f.assertion!=='unknown').map(f=>(f.assertion==='absent'?'未见':'')+concepts.lookup(f.conceptId).term).join(' ')})}
// 仅统计用：按作用域轮流取候选，跨域去重，统一总体预算K=3。
function budget(scopes,key){const out=[];for(let i=0;i<69;i++)for(const s of scopes){const c=(s[key]||[])[i];if(c&&!out.includes(c.name))out.push(c.name)}return out}
function metric(ranked,expected){const top=ranked.slice(0,3),found=expected.filter(n=>top.includes(n)),first=top.findIndex(n=>expected.includes(n));return {ranked:top,recall_at_3:expected.length?found.length/expected.length:null,mrr:expected.length?(first<0?0:1/(first+1)):null,no_candidate_pass:expected.length?null:!top.length,full_coverage:expected.length?found.length===expected.length:!top.length}}
function evaluate(bank){
  const rows=[],aggregates={},diffs=[]
  for(const entry of bank.cases){
    const q=entry.query,s=snapshot(q,entry.case_id),canonical=canonicalQuery(q,s),start=Date.now()
    const rules=retrieval.rank(s,q,{strategy:'rules',poolLimit:69}),concept=retrieval.rank(s,q,{strategy:'concept',poolLimit:69})
    const left=rules.scopes.flatMap(s=>s.pool.map(c=>c.cardId)).sort(),right=concept.scopes.flatMap(s=>s.pool.map(c=>c.cardId)).sort()
    if(JSON.stringify(left)!==JSON.stringify(right))throw Error('comparison_pool_changed')
    const output=assessment.build(s,retrieval.rank(s,q),q,{runId:entry.case_id}),rankings={raw_rules:kb.search(q).map(h=>h.canonicalName||h.name),canonical_rules:kb.search(canonical).map(h=>h.canonicalName||h.name),expanded_pool_rules:budget(rules.scopes,'pool'),same_pool_concept:budget(concept.scopes,'pool'),guided_delivery:budget(output.scopeResults,'candidates')}
    for(const stage of Object.keys(rankings)){
      const row=Object.assign({case_id:entry.case_id,scenario:entry.scenario,species:q.species,stage,input_snapshot_id:s.snapshotId,fact_count:s.facts.length,pool_count:left.length,answerLevel:output.answerLevel,status:output.status,reasonCode:output.routeReason,elapsed_ms:Date.now()-start},metric(rankings[stage],entry.expected_relevant_cards));rows.push(row)
      for(const key of [stage,stage+'/scenario:'+entry.scenario,stage+'/species:'+q.species]){
        const a=aggregates[key]||(aggregates[key]={scheduled:0,answerable:0,empty_expected:0,full_coverage:0,recall_sum:0,mrr_sum:0,empty_pass:0,answerLevels:{}})
        a.scheduled++;a.full_coverage+=Number(row.full_coverage);a.answerLevels[row.answerLevel]=(a.answerLevels[row.answerLevel]||0)+1
        if(row.recall_at_3===null){a.empty_expected++;a.empty_pass+=Number(row.no_candidate_pass)}else{a.answerable++;a.recall_sum+=row.recall_at_3;a.mrr_sum+=row.mrr}
      }
    }
    const baseline=rows.find(r=>r.case_id===entry.case_id&&r.stage==='raw_rules')
    for(const stage of ['canonical_rules','expanded_pool_rules','same_pool_concept','guided_delivery']){const row=rows.find(r=>r.case_id===entry.case_id&&r.stage===stage);diffs.push({case_id:entry.case_id,stage,baseline:baseline.ranked,ranked:row.ranked,regression:baseline.full_coverage&&!row.full_coverage,improvement:!baseline.full_coverage&&row.full_coverage,reason:stage==='guided_delivery'?'delivery_requires_two_distinct_supports_and_one_clear_specific':stage==='canonical_rules'?'strict_raw_span_concepts_only':stage==='expanded_pool_rules'?'scope_separation_and_profile_recall':'same_candidate_pool_reordered'})}
  }
  for(const a of Object.values(aggregates)){a.mean_recall_at_3=a.answerable?a.recall_sum/a.answerable:null;a.mrr=a.answerable?a.mrr_sum/a.answerable:null;delete a.recall_sum;delete a.mrr_sum}
  return {scope:'synthetic_development_exposed_not_clinical',metric_budget:'global_K3_round_robin_across_scopes_for_statistics_only',same_pool_verified:true,model_calls:0,clinical_accuracy:'not_measured',real_model_latency:'not_measured',recommendation:'keep_rules_order_and_legacy_default_no_clinical_claim',rows,aggregates,diffs}
}
function markdown(r){const lines=['## 新流程分步对照','','同一原始输入，概念来源只取原文事实；扩大召回、排序与最终交付分开。跨作用域按轮流取项、去重、总体K=3统计；产品仍分区域显示。','','|阶段|完整覆盖|Recall@3|MRR|无候选通过|','|---|---:|---:|---:|---:|'];for(const stage of ['raw_rules','canonical_rules','expanded_pool_rules','same_pool_concept','guided_delivery']){const a=r.aggregates[stage],num=v=>v===null?'—':v.toFixed(3);lines.push(`|${stage}|${a.full_coverage}/${a.scheduled}|${num(a.mean_recall_at_3)}|${num(a.mrr)}|${a.empty_pass}/${a.empty_expected}|`)}lines.push('','交付门槛会保守放弃信息不足的检索方向，不能与“检索参考卡”标签混称诊断准确率。每题新增退化及理由保留在JSON，默认排序仍为rules；开发默认legacy。','真实模型延迟、实际费用与临床准确率：not_measured。');return lines.join('\n')}
module.exports={evaluate,markdown,snapshot,canonicalQuery,metric}
