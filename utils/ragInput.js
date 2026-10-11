// 本机输入一致性指纹：不保存图片字节，不用于安全认证。
function imageFingerprint(value) {
  var text=String(value||'').replace(/^data:image\/[a-zA-Z0-9]+;base64,/,'').trim(),a=2166136261,b=5381
  for(var i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i)}
  return text.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16)
}
function context(info){return {species:info.species==='猫'?'cat':info.species==='犬'?'dog':info.species,complaint:String(info.complaint||'')}}
function matches(snapshot,images,info) {
  if(!snapshot.inputContext || !Array.isArray(snapshot.sentImageFingerprints))return false
  return JSON.stringify(context(info))===JSON.stringify(snapshot.inputContext) && JSON.stringify(images.map(imageFingerprint))===JSON.stringify(snapshot.sentImageFingerprints)
}
module.exports={imageFingerprint:imageFingerprint,context:context,matches:matches}
