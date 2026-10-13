// 严格同义来自既有受控词；宽泛黑点仍是独立概念。评测等价表不参与运行。
var VERSION = 'clinical-concepts-v1'
var EQUIVALENTS = {皮屑:'鳞屑',脱屑:'鳞屑',黑头:'黑头粉刺',粉刺:'黑头粉刺',小水泡:'水疱',抓挠:'搔抓',挠:'搔抓'}
var PARENTS = {'圆形脱毛':'脱毛','局灶脱毛':'脱毛','对称脱毛':'脱毛','虫蛀样脱毛':'脱毛','大量皮屑':'鳞屑','厚痂':'结痂','薄黄痂':'结痂','薄壁脓疱':'脓疱'}
var cachedRegistry=null
function canonical(word) { return EQUIVALENTS[word] || word }
function registry() {
  if(cachedRegistry)return cachedRegistry
  var kb=require('./kb'),rows={}
  kb.SIGN_REGISTRY.forEach(function(row) {
    var word=canonical(row.concept),key='c:'+word
    if(!rows[key])rows[key]={conceptId:key,term:word,equivalents:[],parentId:PARENTS[word]?'c:'+canonical(PARENTS[word]):null,allowedSources:row.allowedChannels.slice(),generic:kb.isGenericVisualSign(word)}
    rows[key].equivalents.push(row.concept)
    // 任何历史词限制优先，避免重叠词被当作照片可见。
    if(row.allowedChannels.indexOf('photo')<0)rows[key].allowedSources=rows[key].allowedSources.filter(function(s){return s!=='photo'})
  })
  cachedRegistry=rows
  return rows
}
function lookup(value,source) {
  if(typeof value!=='string')return null
  var rows=registry(),row=rows[value.indexOf('c:')===0?value:'c:'+canonical(value)]
  return row && (!source || row.allowedSources.indexOf(source)>=0) ? row : null
}
function fromOwnerContext(context,runId) {
  var cf=require('./caseFacts')
  if(!cf.validateEvidenceContext(context))return []
  return context.activeFacts.concat(context.negativeFacts,context.historyFacts,context.uncertainFacts,context.ownerFacts||[]).map(function(event,index) {
    var row=lookup(event.concept,'owner_text')
    if(!row || event.source!=='owner_text' || !cf.validateFact(event))return null
    var raw=String(event.evidenceSpan.text||'')
    // 原话须字面含概念词，或经主诉口语桥接（如“黑色小点”→黑色颗粒）从同一片段得出；桥接只认当前、肯定、宠物本身的片段。
    var literal=row.equivalents.concat([row.term]).some(function(term){return raw.indexOf(term)>=0})
    if(!literal && !require('./kb').expandQueryFacts(raw).expansions.some(function(e){var hit=lookup(e.concept,'owner_text');return hit&&hit.conceptId===row.conceptId}))return null
    return {evidenceId:runId+':owner:'+index,conceptId:row.conceptId,rawText:String(event.evidenceSpan.text||event.concept).slice(0,160),assertion:event.assertion,certainty:event.assertion==='unknown'?'indeterminate':'clear',observed:true,source:'owner_text',subject:event.subject,temporality:event.temporality,imageId:null,sourceImageId:null,lesionId:event.lesionId||'unknown',site:event.site||'unknown',factEventId:event.factId,supersedes:[]}
  }).filter(Boolean)
}
function adaptLegacyPrecheck(data,context,runId) {
  var contracts=require('./ragContracts'),unparsed=[]
  var facts=(data.visualFeatures||[]).slice(0,64).map(function(word,index) {
    var row=lookup(word,'photo')
    if(!row){unparsed.push(String(word).slice(0,160));return null}
    return {evidenceId:runId+':legacy:'+index,conceptId:row.conceptId,rawText:word,assertion:data.quality==='unclear'||data.quality==='unusable'?'unknown':'present',certainty:data.quality==='unclear'||data.quality==='unusable'?'indeterminate':'possible',observed:true,source:'photo',subject:'pet',temporality:'current',imageId:null,sourceImageId:null,lesionId:'unknown',site:'unknown',provenanceStatus:'legacy_unassigned'}
  }).filter(Boolean)
  return contracts.snapshot({snapshotId:runId+':snapshot',facts:facts.concat(fromOwnerContext(context,runId)),unparsed:unparsed,provenanceStatus:'compatibility_limited',versions:{conceptVersion:VERSION}})
}
module.exports={VERSION:VERSION,EQUIVALENTS:EQUIVALENTS,PARENTS:PARENTS,canonical:canonical,registry:registry,lookup:lookup,fromOwnerContext:fromOwnerContext,adaptLegacyPrecheck:adaptLegacyPrecheck}
