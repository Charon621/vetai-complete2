const assert=require('assert'),o=require('../utils/ragObservation')
const manifest=[{imageId:'a',sourceImageId:'a',role:'overview',lesionId:'l',isSent:true,sentImageIndex:0},{imageId:'r',sourceImageId:'a',role:'roi',lesionId:'l',isSent:true,sentImageIndex:1},{imageId:'unsent',sourceImageId:'unsent',role:'reference',lesionId:'unknown',isSent:false,sentImageIndex:null}]
const data={schemaVersion:'rag-observation-v1',truncated:false,images:[{imageId:'a',quality:'clear',observation:'圆形脱毛',findings:[{conceptId:'c:圆形脱毛',assertion:'present',certainty:'clear',site:'unknown'}]},{imageId:'r',quality:'unusable',observation:'模糊',findings:[]}]}
const p=o.parse(JSON.stringify(data),manifest,null,'run','stop')
assert.equal(p.status,'ok');assert.equal(p.snapshot.facts.length,1);assert.equal(p.snapshot.facts[0].sourceImageId,'a')
assert.equal(o.parse(JSON.stringify(data),manifest,null,'run','length').reasonCode,'response_truncated')
assert.equal(o.parse('{',manifest,null,'run').status,'schema_error')
data.images[1].imageId='unsent';assert.equal(o.parse(JSON.stringify(data),manifest,null,'run').status,'schema_error')
assert.equal(o.parse(JSON.stringify({visualFeatures:['鳞屑']}),manifest,null,'run').snapshot.provenanceStatus,'compatibility_limited')
const maximum={schemaVersion:'rag-observation-v1',truncated:true,images:manifest.slice(0,2).map(m=>({imageId:m.imageId,quality:'clear',observation:'可见局部皮损',findings:Array.from({length:6},()=>({conceptId:'c:鳞屑',assertion:'present',certainty:'clear',site:'unknown'}))}))}
assert.equal(o.parse(JSON.stringify(maximum),manifest,null,'run').snapshot.facts.length,12)
assert(JSON.stringify(maximum).length<2000)
assert(!/三个|3 个/.test(o.prompt(manifest)))
console.log('per-image provenance / bad JSON / truncation / maximum response passed')
