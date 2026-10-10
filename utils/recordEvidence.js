// BUG-34：产品只保存轻量最终证据字段，原始输出仅进入显式离线 sink。
function fields(data) {
  data=data||{}
  function list(key){return (Array.isArray(data[key])?data[key]:[]).filter(function(x){return typeof x==='string'}).slice(0,24).map(function(x){return x.slice(0,240)})}
  var result={responseStatus:['ok','clinical_abstain','schema_error','provider_error'].indexOf(data.responseStatus)>=0?data.responseStatus:'unknown',abstainReason:String(data.abstainReason||'').slice(0,480),evidenceFor:list('evidenceFor'),evidenceAgainst:list('evidenceAgainst'),missingInformation:list('missingInformation'),recommendedTests:list('recommendedTests')}
  if(typeof data.traceReference==='string'&&data.traceReference.length<=160)result.traceReference=data.traceReference
  return result
}
module.exports={fields:fields}
