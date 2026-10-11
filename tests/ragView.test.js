const assert=require('assert'),obs=require('../utils/ragObservation'),retrieval=require('../utils/ragRetrieval'),assessment=require('../utils/ragAssessment'),view=require('../utils/reportViewModel'),fixture=require('./fixtures/rag')
global.wx={env:{USER_DATA_PATH:'/synthetic'},getStorageSync(){return []},setStorageSync(){},showToast(){},getWindowInfo(){return {pixelRatio:1}}}
const snapshot=obs.parse(JSON.stringify(fixture.observation(['圆形脱毛','鳞屑'])),fixture.manifest,null,'r').snapshot
const a=assessment.build(snapshot,retrieval.rank(snapshot,{species:'猫'}),{}, {runId:'r'}),record=Object.assign({id:'id',imagePaths:['/synthetic/a.jpg']},assessment.result(a,snapshot).data)
const v=view.build(record)
assert.equal(v.scopes.length,1);assert(v.lines.some(l=>l.label.includes('支持依据')));assert(!/%|RAG|prompt|知识库/.test(v.exportText));assert(v.exportText.includes('不能据此判断安全'))
let page;global.Page=p=>page=p
require('../pages/result/result');const display=page.buildDisplayRecord.call({},record)
assert(display.record.isNewAssessment);assert.equal(display.record.hasConfidence,false)
require('../pages/chat/report/report');const brief=page._buildDisplay(record)
assert(brief.lines.some(l=>l.label==='客观观察' && l.value.includes('圆形脱毛')))
assert(brief.lines.some(l=>l.label==='判断依据' && l.value.includes('照片观察')))
assert(!brief.lines.some(l=>l.label==='参考把握'))
assert(display.record.disease.includes('癣'));assert(display.record.checklist.length===3)
assert.equal(display.record.riskUnknown,true);assert.equal(display.record.severityLevel,null)
assert(!display.record.secondaryText.includes('匹配较低'))
const fs=require('fs'),path=require('path')
for(const file of ['../pages/result/result.wxml','../pages/chat/report/report.wxml']) {
  const markup=fs.readFileSync(path.join(__dirname,file),'utf8')
  assert(!markup.includes('<assessment-report'), 'all records must use the original report layout')
  assert(markup.includes('verdict'), 'retain the original verdict card')
}
const general=JSON.parse(JSON.stringify(record));general.assessment.scopeResults[0].candidates=[];general.assessment.answerLevel='morphology_only'
assert(view.build(general).title.includes('照片观察'))
assert(view.build(general).nextActionText.includes('完整分析'))
const complete=JSON.parse(JSON.stringify(general));complete.assessment.supplementalAnalysis={status:'ok',text:'综合观察需进一步核对',modelSuggestions:[{name:'核对方向',note:'需检查',supporting:'所见',against:'尚缺检查'}],recommendedTests:['真菌检查'],missingInformation:['病程'],homeCare:'记录变化',whenToSeeVet:'扩大时就医',urgency:'urgent'}
const cv=view.build(complete);assert(cv.title.includes('可能方向'));assert.equal(cv.urgency,'urgent');assert(cv.fullLines.some(l=>l.label==='建议检查'));assert(cv.exportText.includes('何时就医'));assert(!cv.exportText.includes('%'))
let resultPage;global.Page=p=>resultPage=p;delete require.cache[require.resolve('../pages/result/result')];require('../pages/result/result')
const fullDisplay=resultPage.buildDisplayRecord.call({},complete).record
assert.equal(fullDisplay.disease,'核对方向');assert(fullDisplay.possibleMeaning.includes('综合观察'));assert(fullDisplay.checklist[2].text.includes('真菌检查'));assert(fullDisplay.supportText.includes('所见'));assert(fullDisplay.uncertaintyText.includes('病程'))
assert.deepEqual(fullDisplay.assessment,complete.assessment)
const oldDisplay=resultPage.buildDisplayRecord.call({}, {id:'old',disease:'旧病名',primaryDiagnosisProbability:60,urgency:'moderate'})
assert.equal(oldDisplay.record.disease,'旧病名');assert.equal(oldDisplay.record.hasConfidence,true)
const stored=require('../utils/recordEvidence').fields(complete);assert.equal(stored.assessment.supplementalAnalysis.recommendedTests[0],'真菌检查');assert.equal(view.build(stored).fullLines.length,cv.fullLines.length)
complete.assessment.supplementalAnalysis={status:'provider_error',text:'分析未完成',modelSuggestions:[]};assert(view.build(complete).nextActionText.includes('重试'));assert.equal(view.build(complete).supplemental,null)
const failed=JSON.parse(JSON.stringify(general));failed.assessment.status='provider_error';failed.assessment.answerLevel='unavailable';failed.assessment.scopeResults=[];assert(view.build(failed).canRetry)
assert.equal(view.build({primaryDiagnosis:'旧病名',confidence:60}).title,'旧病名')
console.log('two reports / same source / no fabricated percentage / generic / legacy passed')
