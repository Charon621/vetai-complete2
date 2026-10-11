// 合成 transport + wx 内存文件系统；验证页面动作，不宣称实际渲染。
global.wx={env:{USER_DATA_PATH:'/synthetic'}}
const assert=require('assert'),fixture=require('./fixtures/rag'),config=require('../utils/config'),image=require('../utils/image'),storage=require('../utils/storage'),chatDoctor=require('../utils/chatDoctor'),view=require('../utils/reportViewModel')
const saved={},files={},timers=[],calls=[],drawn=[];let writeFail=false,definition,preview='',scope='qa'
const originalTimer=global.setTimeout
global.setTimeout=(fn,ms)=>{if(ms===300||ms===1500){timers.push({fn,ms});return timers.length}return originalTimer(fn,ms)}
const fs={access:o=>o.success(),mkdir:o=>o.success(),writeFile:o=>{files[o.filePath]=o.data;o.success()},copyFile:o=>{files[o.destPath]=files[o.srcPath]||'aGVsbG8=';o.success()},readFile:o=>files[o.filePath]?o.success({data:files[o.filePath]}):o.fail({errMsg:'missing'}),unlink:o=>{delete files[o.filePath];o.success&&o.success()}}
const ctx={measureText:t=>({width:t.length*24}),fillRect(){},fillText:t=>drawn.push(t)},canvas={getContext:()=>ctx}
global.wx={env:{USER_DATA_PATH:'/synthetic'},getFileSystemManager:()=>fs,getStorageSync:k=>k==='vetai_current_user'?{id:scope}:saved[k],setStorageSync:(k,v)=>{if(writeFail&&k.startsWith('pet_diagnosis_history'))throw Error('disk full');saved[k]=JSON.parse(JSON.stringify(v))},getStorageInfoSync:()=>({keys:Object.keys(saved)}),removeStorageSync:k=>{delete saved[k]},showModal(){},showToast(){},showLoading(){},hideLoading(){},navigateTo(){},getWindowInfo:()=>({pixelRatio:1}),createSelectorQuery(){return {in(){return this},select(){return this},fields(){return this},exec(fn){fn([{node:canvas}])}}},canvasToTempFilePath:o=>o.success({tempFilePath:'/synthetic/export.png'}),previewImage:o=>{preview=o.urls[0]},cloud:{callFunction(o){calls.push(o.data.phase);const ids=o.data.payload.messages[1].content.filter(c=>c.type==='text'&&c.text.startsWith('imageId=')).map(c=>c.text.slice(8));const raw=o.data.phase==='vision-precheck'?{schemaVersion:'rag-observation-v1',truncated:false,images:ids.map(imageId=>({imageId,quality:'clear',observation:'合成形态',findings:['圆形脱毛','鳞屑'].map(term=>({conceptId:'c:'+term,assertion:'present',certainty:'clear',site:'unknown'}))}))}:fixture.report;o.success({result:{success:true,data:{choices:[{message:{content:JSON.stringify(raw)},finish_reason:'stop'}]}}})}}}
global.Page=p=>{definition=p}
function page(module){delete require.cache[require.resolve(module)];require(module);const p=Object.assign({},definition);p.data=JSON.parse(JSON.stringify(definition.data));p.setData=(v,cb)=>{Object.assign(p.data,v);if(cb)cb()};p._scrollToBottom=p._updateProgress=p._startAnalyzingTimer=p._stopAnalyzingTimer=p.refreshUiState=()=>{};return p}
async function flush(){for(let i=0;i<18;i++)await Promise.resolve()}
async function run(){
  const mode=config.RAG_WORKFLOW_MODE;config.RAG_WORKFLOW_MODE='guided'
  try{
    const home=page('../pages/index/index');home.canSubmit=()=>true;home.buildPetInfo=()=>({species:'cat',petType:'cat',complaint:''});home.data.imagePaths=['data:image/png;base64,aGVsbG8='];home.data.imageRoles=['overview'];home.data.lesionBoxes=[null];home._imageBase64List=['data:image/png;base64,aGVsbG8=']
    home.onSubmit();await flush();const delay=timers.find(t=>t.ms===300);assert(delay);writeFail=true;delay.fn();assert(home.data.hasPendingResult);assert.equal(storage.getAllRecords().length,0);const before=calls.length;writeFail=false;home.onRetrySave();assert.equal(calls.length,before)
    const first=storage.getAllRecords()[0];assert(first.assessment);assert(first.evidenceSnapshot.manifest[0].localPath);assert(!JSON.stringify(first).includes('base64,'))
    const chat=page('../pages/chat/chat');chat._session={phase:chatDoctor.PHASE.ANALYZING,messages:[],draft:{petType:'cat',complaint:'',photoPaths:['data:image/png;base64,aGVsbG8='],photoBase64s:['data:image/png;base64,aGVsbG8='],lesionBoxes:[null]}}
    chat._runDiagnosis();await flush();assert(chat._session.draft.recordId);const second=storage.getRecordById(chat._session.draft.recordId);assert.deepEqual(view.build(first).scopes,view.build(second).scopes)
    const follow=timers.find(t=>t.ms===1500);assert(follow);scope='changed';chat._session={phase:'new',draft:{},messages:[]};follow.fn();assert.equal(chat._session.phase,'new');assert.equal(chat._session.messages.length,0);assert(!saved.chat_consultation_draft_changed);scope='qa'
    const report=page('../pages/result/result');report.setData(report.buildDisplayRecord(first));report.saveShareImage();assert.equal(preview,'/synthetic/export.png');assert(!drawn.join('').includes('%'));assert(drawn.join('').includes('风险信息不完整'))
    report.onDeepenAnalysis();await flush();assert.equal(calls.filter(c=>c==='full-diagnosis').length,1);assert.equal(storage.getRecordById(first.id).assessment.revision,2);assert.equal(calls.filter(c=>c==='vision-precheck').length,2)
    console.log('both entry pages / failed commit retry without model / reopen / local export / frozen deepen / late space callback passed')
  }finally{config.RAG_WORKFLOW_MODE=mode;global.setTimeout=originalTimer}
}
run().catch(e=>{console.error(e);process.exitCode=1})
