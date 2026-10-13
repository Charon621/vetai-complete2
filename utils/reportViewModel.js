var contracts=require('./ragContracts'),concepts=require('./clinicalConcepts')
var URGENCY={unknown:'风险信息不完整，不能据此判断安全',low:'风险信息有限',moderate:'建议关注并核对',urgent:'建议尽快就诊',emergency:'请立即就医'}
function build(record) {
  record=record||{}
  if(!record.assessment)return {isNew:false,title:record.disease||record.primaryDiagnosis||record.lesionNameCn||'初筛结果',summary:record.possibleMeaning||record.explanation||record.observations||'',shareTitle:'VetAI 宠物皮肤初筛报告',legacy:true}
  var a=record.assessment,valid=contracts.validateAssessment(a)
  if(!valid.valid)return {isNew:true,title:'本次结果无法读取',summary:'记录格式不完整，请重新分析。',scopes:[],lines:[{label:'初筛结果',value:'本次结果无法读取'}],riskText:URGENCY.unknown,limitations:[],canDeepen:false,exportText:'本次结果无法读取；风险信息不完整。'}
  var evidence={},facts=record.evidenceSnapshot && record.evidenceSnapshot.facts || []
  facts.forEach(function(f){evidence[f.evidenceId]=f})
  function evidenceText(id) {var f=evidence[id];if(!f)return '依据未完整保存';var row=concepts.lookup(f.conceptId);return (f.source==='photo'?'照片观察：':'主人描述：')+(f.assertion==='absent'?'未见':'')+(f.certainty==='possible'?'可能':'')+(row?row.term:f.rawText)}
  var supplemental=a.supplementalAnalysis,completed=supplemental && ['ok','clinical_abstain'].indexOf(supplemental.status)>=0
  var title=completed?(supplemental.modelSuggestions||[]).length?'需要核对的可能方向':'完整分析暂未确定病因':a.answerLevel==='ranked_candidates'?'需要核对的可能方向':a.answerLevel==='morphology_only'?'照片观察已完成，病因尚待分析':a.status==='provider_error'?'分析服务暂时不可用':a.status==='schema_error'?'本次分析未完成':'暂时无法判断'
  var scopes=a.scopeResults.map(function(s,index){return {lesionId:s.lesionId,label:(s.site && s.site!=='unknown'?s.site+' · ':'')+'观察区域 '+(index+1),morphology:s.morphology.map(function(m){return typeof m==='string'?m:m.text}).filter(function(t,i,all){return all.indexOf(t)===i}),candidates:s.candidates.map(function(c,i){return {name:c.name,evidenceTier:c.evidenceTier,orderLabel:c.evidenceTier==='tentative'?'可能方向':i===0?'优先核对方向':'其他可能',supports:c.supportEvidenceIds.map(evidenceText),conflicts:c.conflictEvidenceIds.map(evidenceText),missing:c.missingItems,reference:c.referenceKnowledge||'',differentials:c.differentials||'',sourceNote:c.knowledgeStatus==='source_verified'?'指定参考内容已核验':'参考内容尚待逐条核验'}}),coverage:s.coverage==='out_of_scope'?'超出当前适用范围':s.candidates.length?'候选需要检查确认':'现有观察不足以区分病因'}})
  // 旧记录没有点名分级时沿用原展示；新记录全部为可能方向时不给单一病名。
  var tentative=a.answerLevel==='ranked_candidates'&&a.scopeResults.some(function(s){return s.candidates.some(function(c){return c.evidenceTier})})&&!a.scopeResults.some(function(s){return s.candidates.some(function(c){return c.evidenceTier==='named'})})
  var levels={unknown:0,low:1,moderate:2,urgent:3,emergency:4},urgency=a.triage.urgency
  if(completed && levels[supplemental.urgency]>levels[urgency])urgency=supplemental.urgency
  var riskText=URGENCY[urgency] || URGENCY.unknown,flags=(a.triage.flags||[]).map(function(f){return f.desc||''}).filter(Boolean)
  if(flags.length)riskText+='：'+flags.join('、')
  var lines=[{label:'初筛结果',value:title},{label:'风险提示',value:riskText}]
  var fullLines=[]
  if(completed) {
    if(supplemental.text)fullLines.push({label:'综合分析',value:supplemental.text})
    ;(supplemental.modelSuggestions||[]).forEach(function(c){fullLines.push({label:'可能方向',value:c.name+'（需兽医检查确认）'});if(c.supporting)fullLines.push({label:c.name+' · 支持依据',value:c.supporting});if(c.against)fullLines.push({label:c.name+' · 不一致之处',value:c.against})})
    ;[['evidenceFor','支持依据'],['evidenceAgainst','不一致之处'],['missingInformation','待补充信息'],['recommendedTests','建议检查']].forEach(function(pair){if((supplemental[pair[0]]||[]).length)fullLines.push({label:pair[1],value:supplemental[pair[0]].join('；')})})
    if(supplemental.homeCare)fullLines.push({label:'目前可以做什么',value:supplemental.homeCare})
    if(supplemental.whenToSeeVet)fullLines.push({label:'何时就医',value:supplemental.whenToSeeVet})
    if(supplemental.abstainReason)fullLines.push({label:'暂无法判断的原因',value:supplemental.abstainReason})
    fullLines.push({label:'分析依据说明',value:'以上为照片与已填写信息的完整分析，需结合兽医检查核对。'})
    lines=lines.concat(fullLines)
  }
  scopes.forEach(function(s){if(s.morphology.length)lines.push({label:s.label+' · 所见',value:s.morphology.join('；')});s.candidates.forEach(function(c){lines.push({label:s.label+' · '+c.orderLabel,value:c.name+'（需核对，不能据此确诊）'});lines.push({label:c.name+' · 支持依据',value:c.supports.join('；')});if(c.conflicts.length)lines.push({label:c.name+' · 不一致之处',value:c.conflicts.join('；')});if(c.missing.length)lines.push({label:c.name+' · 待补充与检查',value:c.missing.join('；')});if(c.reference)lines.push({label:c.name+' · 参考表现',value:c.reference+'；'+c.sourceNote});if(c.differentials)lines.push({label:c.name+' · 鉴别参考',value:c.differentials})})})
  var limitations=(a.limitations||[]).concat(['候选是核对方向，不能替代兽医检查。'])
  lines.push({label:'结果限制',value:limitations.join('；')})
  var nextActionText=completed?'':a.status==='provider_error'?(a.serviceMessage||'分析请求未完成，原照片已保留。可以重试分析。'):a.status==='schema_error'?'分析结果格式不完整，原照片已保留。可以重试分析。':supplemental?(supplemental.text||'完整分析未完成，照片观察已保留。')+' 请重试完整分析。':a.answerLevel!=='ranked_candidates'?'目前只完成照片观察，还未形成病因方向。请继续完整分析。':tentative?'目前依据还不足以指向单一方向，建议继续完整分析，或带宠物做检查核对。':''
  if(nextActionText)lines.push({label:'下一步',value:nextActionText})
  return {isNew:true,title:title,summary:completed?(supplemental.modelSuggestions||[]).map(function(c){return c.name}).join('、')||supplemental.text:scopes.map(function(s){return s.candidates.map(function(c){return c.name}).join('、')||s.morphology.join('、')||s.coverage}).join('；'),scopes:scopes,riskText:riskText,urgency:urgency,limitations:limitations,lines:lines,fullLines:fullLines,nextActionText:nextActionText,tentative:tentative,canRetry:['provider_error','schema_error'].indexOf(a.status)>=0&&!!record.evidenceSnapshot,canDeepen:['ok','clinical_abstain'].indexOf(a.status)>=0&&!!record.evidenceSnapshot,deepeningLabel:completed?'重新完整分析':supplemental?'重试完整分析':a.answerLevel==='ranked_candidates'&&!tentative?'进一步分析':'继续完整分析',shareTitle:'VetAI 宠物皮肤初筛：'+title,exportText:lines.map(function(l){return l.label+'：'+l.value}).join('\n'),supplemental:completed?supplemental:null}
}
module.exports={build:build,URGENCY:URGENCY}
