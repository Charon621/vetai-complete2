// BUG-19/20/21/22：追加事件与活动视图；旧症状不反向注入当前事实。
var scope = require('./evidenceScope')
var VERSION = 'case-facts-v1'
var LIMITS = { text: 2000, eventsPerTurn: 64, ledger: 500 }
var LEGACY = { itching: '瘙痒', hair_loss: '脱毛', scratching: '搔抓', crusting: '结痂', oozing: '渗出', redness: '红肿', scaling: '鳞屑', lump: '肿块' }
function vocabulary() {
  // 惰性读取避免 kb <-> caseFacts 初始化循环。
  var kb=require('./kb'),terms=kb.VISUAL_VOCAB.concat(kb.HISTORY_VOCAB)
  kb.DISEASE_KB.forEach(function(c){terms=terms.concat(c.historySigns||[])})
  return terms.filter(function(w,i,a){return a.indexOf(w)===i})
}
function validateFact(f, raw) {
  if (!f || typeof f !== 'object') return false
  var span=f.evidenceSpan
  return typeof f.factId==='string' && !!f.factId && typeof f.turnId==='string' && !!f.turnId &&
    (f.concept==='species'||vocabulary().indexOf(f.concept)>=0) &&
    ['pet','owner','other_animal','unknown'].indexOf(f.subject)>=0 &&
    ['present','absent','unknown'].indexOf(f.assertion)>=0 &&
    ['current','past','resolved','unknown'].indexOf(f.temporality)>=0 &&
    ['owner_text','visual_precheck','profile'].indexOf(f.source)>=0 &&
    ['assert','correct','resolve'].indexOf(f.updateType)>=0 &&
    span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start>=0 && span.end>=span.start &&
    typeof span.text==='string' && (raw===undefined || String(raw).slice(span.start,span.end)===span.text)
}
function reduceFactEvents(events) {
  var replaced={},latest={},history=[],uncertain=[]
  ;(events||[]).forEach(function(e){(e.supersedes||[]).forEach(function(id){replaced[id]=true})})
  ;(events||[]).forEach(function(e){
    if(replaced[e.factId]){history.push(Object.assign({},e,{superseded:true}));return}
    if(e.temporality==='past'||e.temporality==='resolved'){history.push(e);return}
    if(e.temporality!=='current'||e.assertion==='unknown'||e.subject==='unknown'){uncertain.push(e);return}
    var key=[e.subject,e.concept,e.site||'',e.source].join('|');latest[key]=e
  })
  var all=Object.keys(latest).map(function(k){return latest[k]}),active=all.filter(function(e){return e.subject==='pet'&&e.assertion==='present'}),negative=all.filter(function(e){return e.subject==='pet'&&e.assertion==='absent'})
  var conflicts=active.filter(function(a){return negative.some(function(n){return a.concept===n.concept&&a.site===n.site&&a.source!==n.source})})
  return {activeFacts:active,negativeFacts:negative,historyFacts:history,uncertainFacts:uncertain,ownerFacts:all.filter(function(e){return e.subject==='owner'}),conflicts:conflicts}
}
function appendFactEvents(events,incoming,raw) {
  var out=(events||[]).slice()
  ;(incoming||[]).forEach(function(f){
    if(!validateFact(f,raw))throw new Error('invalid_fact_event')
    if(out.some(function(e){return e.factId===f.factId}))return
    var targets=(f.supersedes||[]).map(function(id){return out.filter(function(e){return e.factId===id})[0]})
    if(targets.some(function(t){return !t||t.subject!==f.subject||t.concept!==f.concept||t.source!==f.source||(f.site&&t.site!==f.site)}))throw new Error('invalid_supersedes')
    if(out.length>=LIMITS.ledger)throw new Error('fact_ledger_full')
    out.push(f)
  })
  return out
}
function buildEvidenceContext(draft) {
  var view=reduceFactEvents(draft.factEvents||[])
  return Object.assign({schemaVersion:VERSION,rawOwnerText:draft.rawOwnerText||draft.complaint||'',currentOwnerText:draft.lastOwnerText||'',extractionStatus:draft.extractionStatus||'ok'},view)
}
function validateEvidenceContext(context) {
  if(!context||context.schemaVersion!==VERSION)return false
  var keys=['activeFacts','negativeFacts','historyFacts','uncertainFacts']
  if(!keys.every(function(k){return Array.isArray(context[k])&&context[k].every(function(f){return validateFact(f)})}))return false
  return context.activeFacts.every(function(f){return f.subject==='pet'&&f.assertion==='present'&&f.temporality==='current'})&&context.negativeFacts.every(function(f){return f.subject==='pet'&&f.assertion==='absent'&&f.temporality==='current'})
}
function evidenceText(context) {
  if(!validateEvidenceContext(context))return ''
  return context.activeFacts.map(function(f){return f.concept==='species'?'':f.concept}).filter(Boolean).join(' ')+' '+context.negativeFacts.map(function(f){return '未见'+f.concept}).join(' ')
}
function textToEvents(raw, turnId, existing) {
  var kb=require('./kb'),text=String(raw||''),parts=scope.fragments(text.slice(0,LIMITS.text)),events=[],terms=vocabulary(),previous=reduceFactEvents(existing||[]),clarification=[]
  parts.forEach(function(part){
    var normalized=part.text.replace(/现在|目前|以前|过去|去年|没有|未见|没见|不再|不痒|不挠|不抓|不疼|没皮屑/g,function(w){return w==='不痒'?'瘙痒':w==='不挠'||w==='不抓'?'搔抓':w==='不疼'?'疼痛':w==='没皮屑'?'皮屑':''})
    var expanded=kb.expandQueryTerms(normalized),hits=terms.filter(function(w){return normalized.indexOf(w)>=0||expanded.indexOf(w)>=0})
    if(/不痒|无瘙痒|不挠|没注意.*挠|有没有挠/.test(part.text))hits.push(/挠/.test(part.text)?'搔抓':'瘙痒')
    if(/没驱虫|好久没驱虫/.test(part.text))hits.push('驱虫不规律')
    if(/^(猫|狗|犬)$/.test(part.text.trim()) || /这只|其实是|不是猫.*狗|不是狗.*猫/.test(part.text))hits.push('species')
    if(/这个.*(?:没有|没了|消退)|(?:没有|没了).*这个/.test(part.text)){
      var targets=previous.activeFacts.filter(function(f){return f.concept!=='species'&&(!part.site||f.site===part.site)})
      if(targets.length===1)hits.push(targets[0].concept)
      else clarification.push('ambiguous_retraction_target')
    }
    var canonical = {皮屑:'鳞屑',脱屑:'鳞屑',剧烈瘙痒:'瘙痒',轻痒:'瘙痒',轻度瘙痒:'瘙痒',抓挠:'搔抓',挠:'搔抓',疯狂抓挠:'搔抓'}
    hits=hits.map(function(w){return canonical[w]||w})
    hits.filter(function(w,i,a){return a.indexOf(w)===i && ['不痒','无瘙痒','无痛','不痛'].indexOf(w)<0}).forEach(function(concept){
      var assertion=part.assertion==='uncertain'?'unknown':part.assertion
      if(concept==='驱虫不规律')assertion='present'
      var temporal=/消退|好了|不再|没了/.test(part.text)?'resolved':part.temporality
      var targets=previous.activeFacts.concat(previous.negativeFacts).filter(function(f){return f.concept===concept&&f.subject===part.subject&&f.source==='owner_text'&&(!part.site||f.site===part.site)})
      var supersedes=(assertion==='absent'||temporal==='resolved'||/说错|更正/.test(text))&&targets.length===1?[targets[0].factId]:[]
      var site=part.site||(supersedes.length?targets[0].site:'')
      events.push({factId:turnId+':'+events.length,concept:concept,value:concept==='species'?resolveSpecies(part.text,'',''):'',subject:part.subject,assertion:assertion,temporality:temporal,site:site,lesionId:site||part.lesionId,source:'owner_text',turnId:turnId,observedAt:Date.now(),evidenceSpan:part.evidenceSpan,updateType:supersedes.length?(temporal==='resolved'?'resolve':'correct'):'assert',supersedes:supersedes})
    })
  })
  // BUG-20复核：主体纠正撤销旧宠物陈述，同时保留旧事件与主人线索。
  if(/刚才|前面|之前/.test(text)&&/说的|说的是|说错/.test(text)&&/是我|我的|主人/.test(text)&&/不是.*(?:猫|狗|宠物)|都是我/.test(text)) {
    var pool=previous.activeFacts.filter(function(f){return f.subject==='pet'&&f.source==='owner_text'&&f.concept!=='species'})
    var named=pool.filter(function(f){return text.indexOf(f.concept)>=0})
    var selected=named.length?named:pool.length===1?pool:[]
    if(!selected.length&&/都是我/.test(text)&&pool.length){var latest=pool[pool.length-1].turnId;selected=pool.filter(function(f){return f.turnId===latest})}
    if(!selected.length)clarification.push('ambiguous_subject_correction')
    selected.forEach(function(old) {
      var span={start:0,end:Math.min(text.length,LIMITS.text),text:text.slice(0,LIMITS.text)}
      events.push({factId:turnId+':'+events.length,concept:old.concept,subject:'pet',assertion:'unknown',temporality:'unknown',site:old.site||'',lesionId:old.lesionId||'',source:'owner_text',turnId:turnId,evidenceSpan:span,updateType:'correct',supersedes:[old.factId]})
      events.push({factId:turnId+':'+events.length,concept:old.concept,subject:'owner',assertion:'present',temporality:'current',site:old.site||'',lesionId:old.lesionId||'',source:'owner_text',turnId:turnId,evidenceSpan:span,updateType:'assert',supersedes:[]})
    })
  }
  return {events:events.slice(0,LIMITS.eventsPerTurn),status:text.length>LIMITS.text||events.length>LIMITS.eventsPerTurn?'extraction_truncated':clarification.length?'clarification_required':'ok',clarificationReasons:clarification,measuredFactCount:events.length}
}
function resolveSpecies(text,current,proposal) {
  text=String(text||'')
  if(/不确定.*猫.*狗|猫还是狗.*不确定|不知道.*(?:猫|狗)/.test(text))return 'unknown'
  if(/朋友的|邻居的|别人家|接触|举例|比如|假如|如果/.test(text)&&!/这只其实|这只不是|刚才说错/.test(text))return current||''
  var correction=/刚才说错|这只其实|这只不是|不是猫.*(?:是狗|是犬)|不是狗.*是猫/.test(text)
  var matches=text.match(/狗|犬|猫|兔|仓鼠|鹦鹉|鸟/g)||[]
  if(!matches.length)return current||(/蜥蜴|乌龟|龟|蛇|马|猪|其他动物/.test(text)?'other':proposal||'')
  var match=correction?matches[matches.length-1]:matches[0],kind={狗:'dog',犬:'dog',猫:'cat',兔:'rabbit',仓鼠:'hamster',鸟:'bird',鹦鹉:'bird'}[match]
  if(current&&current!==kind&&!correction)return current
  return kind||proposal||current||''
}
function symptoms(context) {
  var concepts=context.activeFacts.map(function(f){return f.concept}),out=[]
  Object.keys(LEGACY).forEach(function(key){var word=LEGACY[key];if(concepts.indexOf(word)>=0||(key==='redness'&&concepts.indexOf('红斑')>=0)||(key==='scaling'&&concepts.indexOf('皮屑')>=0)||(key==='scratching'&&concepts.indexOf('挠')>=0))out.push(key)})
  return out
}
function ensureDraft(draft) {
  if(draft.factSchemaVersion===VERSION)return
  draft.factSchemaVersion=VERSION;draft.factEvents=[];draft.rawOwnerText=draft.complaint||''
  ;(draft.symptoms||[]).forEach(function(key,i){if(!LEGACY[key])return;draft.factEvents.push({factId:'legacy:'+i,concept:LEGACY[key],subject:'pet',assertion:'unknown',temporality:'unknown',site:'',source:'profile',turnId:'legacy-migration',evidenceSpan:{start:0,end:0,text:''},updateType:'assert',supersedes:[]})})
  draft.symptoms=[];draft.factMigrationVersion='legacy-conservative-v1'
}
function updateDraft(draft,text,extracted,turnId) {
  ensureDraft(draft)
  var local=textToEvents(text,turnId,draft.factEvents),incoming=local.events,status=local.status
  if(status==='ok'&&extracted&&extracted.extractionStatus)status=extracted.extractionStatus
  if(extracted&&extracted.isObservation===false){
    incoming=local.events.map(function(f){return Object.assign({},f,{assertion:'unknown',supersedes:[]})})
  } else if(extracted&&Array.isArray(extracted.facts)){
    // 合法但缺项/空数组不能抹掉本轮已由原话支持的观察；模型只能补充经同源校验的信息。
    if(extracted.facts.every(function(f){return f.source==='owner_text'&&validateFact(f,text)&&local.events.some(function(e){return e.concept===f.concept&&e.subject===f.subject&&e.assertion===f.assertion&&e.temporality===f.temporality&&e.evidenceSpan.start===f.evidenceSpan.start&&e.evidenceSpan.end===f.evidenceSpan.end})}))incoming=local.events
    else status='extraction_schema_error'
  }
  try{draft.factEvents=appendFactEvents(draft.factEvents,incoming,text)}catch(e){status=e.message}
  draft.rawOwnerText=(draft.rawOwnerText?draft.rawOwnerText+'；':'')+text
  draft.lastOwnerText=text
  draft.extractionStatus=status;draft.evidenceContext=buildEvidenceContext(draft);draft.symptoms=symptoms(draft.evidenceContext)
  return local
}
module.exports={VERSION:VERSION,LIMITS:LIMITS,LEGACY:LEGACY,validateFact:validateFact,appendFactEvents:appendFactEvents,reduceFactEvents:reduceFactEvents,buildEvidenceContext:buildEvidenceContext,validateEvidenceContext:validateEvidenceContext,evidenceText:evidenceText,textToEvents:textToEvents,resolveSpecies:resolveSpecies,symptoms:symptoms,ensureDraft:ensureDraft,updateDraft:updateDraft}
