var api=require('./api'),image=require('./image'),storage=require('./storage'),fields=require('./recordEvidence').fields,viewModel=require('./reportViewModel')
function deepen(page,record,reload) {
  if(page.data.deepening || !record || !record.assessment)return
  var scope=storage.getUserScope(),paths=((record.evidenceSnapshot||{}).manifest||[]).filter(function(m){return m.isSent}).sort(function(a,b){return a.sentImageIndex-b.sentImageIndex}).map(function(m){return m.localPath||''})
  if(!paths.length || paths.some(function(p){return !p})){wx.showToast({title:'原分析照片未保存，请重新初筛',icon:'none'});return}
  page.setData({deepening:true})
  image.localPathsToBase64(paths,{preservePositions:true}).then(function(images) {
    if(!images.some(Boolean))throw Error('原照片无法读取，请重新上传后分析')
    return api.deepenAssessment(images,{species:record.petType||record.species,complaint:record.complaint||'',bodyPartLabel:record.bodyPartLabel||'',bodyPart:record.bodyPart||'',breed:record.breed||'',age:record.age||'',gender:record.gender||'',imageRoles:record.evidenceSnapshot.manifest.filter(function(m){return m.isSent}).sort(function(a,b){return a.sentImageIndex-b.sentImageIndex}).map(function(m){return m.role})},{ownerScope:scope,assessment:record.assessment,evidenceSnapshot:record.evidenceSnapshot,isCancelled:function(){return page._reportClosed===true}})
  }).then(function(result) {
    if(page._reportClosed || storage.getUserScope()!==scope)return
    if(!result.success)throw Error(result.error||'进一步分析未完成，初筛已保留')
    var data=Object.assign({},record,fields(result.data)),commit=storage.commitRecord(data,{ownerScope:scope,replaceId:record.id})
    if(!commit.success)throw Error('补充结果未保存，原初筛已保留')
    reload(commit.record)
  }).catch(function(err){if(!page._reportClosed)wx.showModal({title:'初筛已保留',content:err.message||'进一步分析未完成',showCancel:false})}).then(function(){if(!page._reportClosed)page.setData({deepening:false})})
}
function exportImage(page,record) {
  var view=viewModel.build(record)
  wx.showLoading({title:'生成报告图片中'})
  wx.createSelectorQuery().in(page).select('#shareCanvas').fields({node:true,size:true}).exec(function(res) {
    if(!res||!res[0]||!res[0].node){wx.hideLoading();wx.showToast({title:'报告生成失败',icon:'none'});return}
    var canvas=res[0].node,ctx=canvas.getContext('2d'),W=750,wrapped=[]
    ctx.font='24px sans-serif'
    ;('VetAI 宠物皮肤初筛报告\n'+view.exportText+'\n仅供参考，不能替代兽医诊断。').split('\n').forEach(function(line) {
      var current=''
      for(var i=0;i<line.length;i++){if(ctx.measureText(current+line[i]).width>650){wrapped.push(current);current=''}current+=line[i]}
      wrapped.push(current)
    })
    var H=Math.max(700,wrapped.length*38+100)
    // 不静默截掉风险或依据；过长时提示用完整报告。
    if(H>12000){wx.hideLoading();wx.showToast({title:'报告较长，请分区域查看完整报告',icon:'none'});return}
    canvas.width=W;canvas.height=H;ctx.fillStyle='#f7f3ea';ctx.fillRect(0,0,W,H);ctx.font='24px sans-serif';ctx.fillStyle='#29251f'
    wrapped.forEach(function(line,index){ctx.fillText(line,50,60+index*38)})
    wx.canvasToTempFilePath({canvas:canvas,fileType:'png',success:function(result){wx.hideLoading();page._lastReportExport=result.tempFilePath;wx.previewImage({urls:[result.tempFilePath]})},fail:function(){wx.hideLoading();wx.showToast({title:'报告生成失败',icon:'none'})}},page)
  })
}
function retry(page,record,reload) {
  if(page.data.deepening || !record || !record.assessment)return
  var scope=storage.getUserScope(),manifest=(record.evidenceSnapshot||{}).manifest||[],sent=manifest.filter(function(m){return m.isSent}).sort(function(a,b){return a.sentImageIndex-b.sentImageIndex}),paths=sent.map(function(m){return m.localPath||''})
  if(!paths.length || paths.some(function(p){return !p})){wx.showToast({title:'原照片未保存，请重新上传',icon:'none'});return}
  page.setData({deepening:true})
  image.localPathsToBase64(paths,{preservePositions:true}).then(function(images){
    if(images.some(function(i){return !i}))throw Error('原照片无法读取，请重新上传')
    return api.diagnose(images,{species:record.petType||record.species,complaint:record.complaint||'',bodyPartLabel:record.bodyPartLabel||'',bodyPart:record.bodyPart||'',breed:record.breed||'',age:record.age||'',gender:record.gender||'',imageManifest:manifest,imageRoles:sent.map(function(m){return m.role}),useKnowledgeBase:true},{workflowMode:'guided',isCancelled:function(){return page._reportClosed===true||storage.getUserScope()!==scope}})
  }).then(function(result){
    if(page._reportClosed || storage.getUserScope()!==scope)return
    if(!result.success)throw Error(result.error||'重试未完成，原结果已保留')
    var commit=storage.commitRecord(Object.assign({},record,fields(result.data)),{ownerScope:scope,replaceId:record.id})
    if(!commit.success)throw Error('新结果未保存，原结果已保留')
    reload(commit.record)
  }).catch(function(err){if(!page._reportClosed && storage.getUserScope()===scope)wx.showModal({title:'原结果已保留',content:err.message||'重试未完成',showCancel:false})}).then(function(){if(!page._reportClosed)page.setData({deepening:false})})
}
module.exports={deepen:deepen,retry:retry,exportImage:exportImage}
