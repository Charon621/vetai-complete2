const assert=require('assert'),fixture=require('./fixtures/rag'),obs=require('../utils/ragObservation'),retrieval=require('../utils/ragRetrieval'),assessment=require('../utils/ragAssessment')
const store={};let fail='',scope='test'
global.wx={getStorageSync(k){if(k==='vetai_current_user')return {id:scope};if(fail==='read')throw Error('read');return store[k]},setStorageSync(k,v){if(fail===k||fail==='all')throw Error('disk full');store[k]=JSON.parse(JSON.stringify(v))},getStorageInfoSync(){return {keys:Object.keys(store)}}}
const storage=require('../utils/storage'),fields=require('../utils/recordEvidence').fields,chat=require('../utils/chatDoctor')
const snapshot=obs.parse(JSON.stringify(fixture.observation(['圆形脱毛','鳞屑'])),fixture.manifest,null,'run').snapshot
const a=assessment.build(snapshot,retrieval.rank(snapshot,{species:'猫'}),{}, {runId:'run'}),data=fields(assessment.result(a,snapshot).data)
data.imagePaths=['/test/vetai_saved/old.jpg']
let result=storage.commitRecord(data,{ownerScope:'test'});assert(result.success)
const old=JSON.stringify(storage.getAllRecords()),id=result.record.id
assert(storage.commitRecord(data,{ownerScope:'test'}).duplicate);assert.equal(storage.getAllRecords().length,1)
fail='all';const newer=JSON.parse(JSON.stringify(data));newer.assessment.revision=2
assert(!storage.commitRecord(newer,{ownerScope:'test',replaceId:id}).success);assert.equal(JSON.stringify(storage.getAllRecords()),old)
assert.equal(storage.addRecord({disease:'x'}),null)
assert.equal(chat.saveDraft({draft:{diagnosisResult:{success:true,data:data}}},'test'),false)
fail='';result=storage.commitRecord(newer,{ownerScope:'test',replaceId:id});assert(result.success);assert.equal(result.record.revisions.length,1)
newer.assessment.revision=3;fail='chat_consultation_draft_test'
assert(storage.commitRecord(newer,{ownerScope:'test',replaceId:id}).success)
assert.equal(chat.saveDraft({draft:{diagnosisResult:{success:true,data:newer}}},'test'),false)
assert.equal(storage.findRecordByRun('run').id,id)
fail='read';assert.equal(storage.commitRecord(newer,{ownerScope:'test'}).code,'read_failed');fail=''
scope='other';assert.equal(storage.commitRecord(newer,{ownerScope:'test'}).code,'space_changed')
const dirty=JSON.parse(JSON.stringify(data));dirty.assessment.rawResponse='SECRET';dirty.evidenceSnapshot.manifest[0].base64='SECRET'
assert(!JSON.stringify(fields(dirty)).includes('SECRET'))
scope='test';assert.equal(storage.commitRecord(Object.assign({},data,{imagePaths:['data:image/png;base64,AAAA']}),{ownerScope:'test'}).code,'invalid_image_path')
assert.equal(storage.commitRecord(Object.assign({},data,{assessment:Object.assign({},data.assessment,{revision:2})}),{ownerScope:'test',replaceId:id}).code,'stale_revision')
dirty.assessment.triage.payload='SECRET';dirty.assessment.scopeResults[0].candidates[0].knowledgeBindings[0].payload='SECRET';assert(!JSON.stringify(fields(dirty)).includes('SECRET'))
console.log('atomic replace / disk full / draft fail / idempotency / space / whitelist passed')
