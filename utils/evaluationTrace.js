// BUG-34：显式注入的离线追踪接口。默认 no-op；写入失败不改变临床输出。
function create(sink, metadata) {
  var state={enabled:!!(sink&&typeof sink.emit==='function'),failed:false,errors:[],reference:''}
  function emit(stage,data) {
    if(!state.enabled)return
    try {
      var result=sink.emit({schema_version:'evaluation-trace-v1',stage:stage,at:new Date().toISOString(),metadata:metadata||{},data:data||{}})
      if(result&&typeof result.then==='function') { state.failed=true;state.errors.push('async_sink_not_supported');result.catch(function(){}) }
      else if(typeof result==='string')state.reference=result
    }catch(err){state.failed=true;state.errors.push(String(err&&err.message||err).slice(0,160))}
  }
  return {state:state,emit:emit}
}
module.exports={create:create}
