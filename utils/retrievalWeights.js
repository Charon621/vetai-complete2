// BUG-35：初值与旧常数完全相同；实验覆盖仅由离线隔离模块使用。
var VERSION = 'retrieval-weights-v1'
var DEFAULTS = {photoSpecific:5,photoGeneric:1.5,textSpecific:4,textGeneric:1,history:3,diseaseName:3,aliasSpecific:2,aliasGeneric:1,locationPerTerm:2,locationCap:4,breedSingle:1,breedMulti:2,negativePenalty:3,negativeFloor:0.3,priorFactor:0.5,signFloor:0.65,signCeil:1.2}
function validate(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid weights object')
  var result={}
  Object.keys(DEFAULTS).forEach(function(key) {
    if(typeof value[key]!=='number'||!isFinite(value[key])||value[key]<0)throw new Error('invalid weight: '+key)
    result[key]=value[key]
  })
  if(Object.keys(value).some(function(key){return !Object.prototype.hasOwnProperty.call(DEFAULTS,key)}))throw new Error('unknown weight')
  if(result.signFloor>result.signCeil||result.negativeFloor>1)throw new Error('invalid weight bounds')
  return result
}
function hash(value) {
  var checked=validate(value),text=Object.keys(checked).sort().map(function(k){return k+':'+checked[k]}).join('|'),n=2166136261
  for(var i=0;i<text.length;i++){n^=text.charCodeAt(i);n=Math.imul(n,16777619)}
  return 'fnv1a-'+(n>>>0).toString(16)
}
var weights=validate(DEFAULTS)
if(Object.freeze)Object.freeze(weights)
module.exports={VERSION:VERSION,weights:weights,HASH:hash(weights),validate:validate,hash:hash}
