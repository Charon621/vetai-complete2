// 只记录运行计数与版本；不保存主诉、照片、宠物身份或疾病名称。
var analytics = require('./analytics')
var evidence = require('./knowledgeEvidence')
function record(strategy, hits, elapsedMs, failed) {
  if (typeof wx === 'undefined') return
  var claimCount = 0, verified = 0
  ;(hits || []).forEach(function(h) { (h.evidenceBindings || []).forEach(function(c) { claimCount++; if(c.status === 'source_verified') verified++ }) })
  var releaseId = require('./knowledgeBundle').release.id
  analytics.trackSample('knowledgeRetrieval', { schemaVersion:1, releaseId:releaseId, knowledgeVersion:require('./kb').KB_VERSION, weightHash:require('./retrievalWeights').HASH, evidenceVersion:evidence.version, strategy:strategy, resultCount:(hits||[]).length, elapsedMs:Math.max(0,elapsedMs), failed:failed===true, boundClaimCount:claimCount, sourceVerifiedClaimCount:verified })
}
function summarize(samples) {
  var groups = {}
  ;(samples || []).forEach(function(sample) {
    var d = sample.data || sample
    if (!d || d.schemaVersion!==1 || typeof d.strategy!=='string' || typeof d.elapsedMs!=='number' || !isFinite(d.elapsedMs) || d.elapsedMs<0) return
    var key = [d.releaseId || 'unpublished', d.knowledgeVersion || 'unknown', d.evidenceVersion, d.strategy].join('/')
    var g = groups[key] || (groups[key]={samples:0,empty:0,failures:0,latencies:[],boundClaims:0,sourceVerifiedClaims:0})
    g.samples++;g.empty+=Number(d.resultCount===0);g.failures+=Number(d.failed===true);g.latencies.push(d.elapsedMs);g.boundClaims+=d.boundClaimCount||0;g.sourceVerifiedClaims+=d.sourceVerifiedClaimCount||0
  })
  Object.keys(groups).forEach(function(k) {
    var g=groups[k];g.latencies.sort(function(a,b){return a-b});g.p95Ms=g.latencies[Math.ceil(g.samples*0.95)-1];g.emptyRate=g.empty/g.samples;g.failureRate=g.failures/g.samples;delete g.latencies
  })
  return {scope:'local_recent_samples_not_population_metrics',groups:groups}
}
function recordWorkflow(event){analytics.track('ragWorkflow',event)}
module.exports={record:record,summarize:summarize,recordWorkflow:recordWorkflow}
