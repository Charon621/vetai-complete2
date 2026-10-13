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
// 证据只够列可能方向时：主标题不放病名，列出全部方向并引导完整分析；存储保留分级。
{
  const cf=require('../utils/caseFacts'),concepts=require('../utils/clinicalConcepts'),contracts=require('../utils/ragContracts'),d={}
  cf.updateDraft(d,'尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点',null,'t')
  const snap=contracts.snapshot({snapshotId:'t:snapshot',facts:concepts.fromOwnerContext(d.evidenceContext,'t'),provenanceStatus:'complete'})
  const ta=assessment.build(snap,retrieval.rank(snap,{species:'犬'}),{}, {runId:'t'}),tentRecord=Object.assign({id:'tent'},assessment.result(ta,snap).data)
  assert(ta.scopeResults.every(s=>s.candidates.every(c=>c.evidenceTier==='tentative')))
  const tv=view.build(tentRecord);assert.equal(tv.tentative,true);assert(tv.nextActionText.includes('单一方向'));assert.equal(tv.deepeningLabel,'继续完整分析')
  assert(tv.lines.some(l=>l.label.includes('可能方向')&&l.value.includes('跳蚤')))
  let tp;global.Page=p=>tp=p;delete require.cache[require.resolve('../pages/result/result')];require('../pages/result/result')
  const td=tp.buildDisplayRecord.call({},tentRecord).record
  assert.equal(td.disease,'可能方向待核对');assert.equal(td.secondaryText,td.diseaseList.length>1?'其他可能：'+td.diseaseList.slice(1).map(function(c){return c.name}).join('；'):'');assert(td.possibleMeaning.includes('单一方向'))
  delete require.cache[require.resolve('../pages/chat/report/report')];require('../pages/chat/report/report')
  const tb=tp._buildDisplay(tentRecord)
  assert(tb.lines.some(l=>l.label==='初步判断'&&l.value==='可能方向待核对'));assert.equal(tb.lines.some(l=>l.label==='鉴别方向'),tentRecord.assessment.scopeResults.reduce(function(n,scope){return n+scope.candidates.length},0)>1)
  assert.equal(require('../utils/recordEvidence').fields(tentRecord).assessment.scopeResults[0].candidates[0].evidenceTier,'tentative')
  assert.equal(v.tentative,false,'照片清晰可见的癣仍点名')
}
console.log('two reports / same source / no fabricated percentage / generic / legacy passed')

// 用户恢复 GitHub 原版报告页后，验证原展示契约和历史原始数据不被改写。
// 完整字段仍留在记录中；本测试不再要求已撤销的增强展示。
{
  const full = {id:'complete-legacy', primaryDiagnosis:'局部皮炎', urgency:'moderate',
    observations:'可见局部皮肤变化。'.repeat(22), explanation:'综合观察说明',
    evidenceFor:['第一项支持事实','第二项支持事实'], evidenceAgainst:['第一项反证','第二项反证'],
    missingInformation:['病程','是否瘙痒','是否疼痛'], recommendedTests:['检查甲','检查乙'],
    homeCare:'建议一。建议二。建议三。建议四。建议五', whenToWatch:'条件一；条件二', whenToSeeVet:'变化一；变化二'}
  const source=JSON.stringify(full)
  let p;global.Page=x=>p=x;delete require.cache[require.resolve('../pages/result/result')];require('../pages/result/result')
  const r=p.buildDisplayRecord.call({},full).record
  assert.equal(r.observationText,full.observations.slice(0,160)+'...')
  assert.equal(r.supportText,full.explanation)
  assert.equal(r.checklist[0].text,'建议一');assert.equal(r.checklist[1].text,'条件一');assert.equal(r.checklist[2].text,'变化一')
  const markup=fs.readFileSync(path.join(__dirname,'../pages/result/result.wxml'),'utf8')
  assert(markup.includes('{{record.observationText}}'));assert(markup.includes('{{record.supportText}}'))
  assert.deepEqual(r.missingInformation,full.missingInformation);assert.deepEqual(r.recommendedTests,full.recommendedTests)
  delete require.cache[require.resolve('../pages/chat/report/report')];require('../pages/chat/report/report')
  const brief=p._buildDisplay(full)
  assert(brief.lines.some(l=>l.label==='初步判断'))
  assert.equal(JSON.stringify(full),source,'页面不得改写历史原始记录')
}
