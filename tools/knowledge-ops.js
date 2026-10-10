#!/usr/bin/env node
'use strict'
// Local release packages are content-addressed. Restore refuses unrecorded edits and backs up current bytes.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os'),cp=require('child_process')
const ROOT=path.resolve(__dirname,'..')
function sha(text){return crypto.createHash('sha256').update(text).digest('hex')}
function outputRoot(){return process.env.VETAI_OUTPUT_DIR||(process.platform==='win32'?'E:\\CodexOutputs\\vetai-complete2':path.join(os.homedir(),'CodexOutputs','vetai-complete2'))}
function managed(name){return /^utils\/[A-Za-z0-9_-]+\.js$/.test(name)||/^knowledge\/[A-Za-z0-9_-]+\.json$/.test(name)&&name!=='knowledge/current-release.json'||name==='evaluation/datasets/retrieval_scenarios.json'}
function files(root){
  const list=[]
  for(const dir of ['utils','knowledge'])if(fs.existsSync(path.join(root,dir)))for(const name of fs.readdirSync(path.join(root,dir))){const p=dir+'/'+name;if(managed(p))list.push(p)}
  if(fs.existsSync(path.join(root,'evaluation/datasets/retrieval_scenarios.json')))list.push('evaluation/datasets/retrieval_scenarios.json')
  return list.sort()
}
function capture(root){return Object.fromEntries(files(root).map(p=>{const text=fs.readFileSync(path.join(root,p),'utf8');return [p,{sha256:sha(text),text}]}))}
function idValid(id){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id||'')||id.includes('..'))throw new Error('Invalid release ID')}
function outside(root,store){root=path.resolve(root);store=path.resolve(store);if(store===root||store.startsWith(root+path.sep))throw new Error('Release store must be outside repository');return store}
function load(store,id){idValid(id);const p=JSON.parse(fs.readFileSync(path.join(store,id+'.json'),'utf8'));if(p.id!==id||p.schema_version!==1)throw new Error('Invalid package');const data=JSON.stringify(p.files);if(sha(data)!==p.content_sha256)throw new Error('Package hash mismatch');for(const [f,v]of Object.entries(p.files)){if(!managed(f)||typeof v.text!=='string'||sha(v.text)!==v.sha256)throw new Error('Invalid package file: '+f)}return p}
function current(root){const p=path.join(root,'knowledge/current-release.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null}
function changes(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(f=>!before[f]||!after[f]||before[f].sha256!==after[f].sha256)}
function atomic(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,text,{flag:'wx'});fs.renameSync(tmp,file)}
function event(store,data){fs.appendFileSync(path.join(store,'events.jsonl'),JSON.stringify(Object.assign({at:new Date().toISOString()},data))+'\n')}
function inspectCards(root){
  const out=cp.spawnSync(process.execPath,['-e',"process.stdout.write(JSON.stringify(require('./utils/kb').DISEASE_KB))"],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024})
  if(out.status!==0)throw new Error('Cannot load knowledge cards: '+out.stderr)
  return JSON.parse(out.stdout)
}
function check(root){
  const ledger=JSON.parse(fs.readFileSync(path.join(root,'knowledge/evidence-ledger.json'),'utf8'))
  const result=require('../evaluation/tools/evidence_audit').audit(ledger,inspectCards(root))
  if(!result.ok)throw new Error('Evidence audit failed: '+result.errors.join('; '))
  return result
}
function publishUnlocked(root,store,id,reason){
  store=outside(root,store);idValid(id);const audit=check(root),snapshot=capture(root),prev=current(root)
  if(fs.existsSync(path.join(store,id+'.json')))throw new Error('Release ID already exists')
  const previous=prev?prev.files:{}
  const pkg={schema_version:1,id,reason:reason || 'Versioned knowledge update',created_at:new Date().toISOString(),previous_release:prev?prev.id:null,content_sha256:sha(JSON.stringify(snapshot)),files:snapshot,changed_files:changes(previous,snapshot),audit}
  fs.mkdirSync(store,{recursive:true});fs.writeFileSync(path.join(store,id+'.json'),JSON.stringify(pkg,null,2)+'\n',{flag:'wx'})
  const pointer={schema_version:1,id,content_sha256:pkg.content_sha256,files:Object.fromEntries(Object.entries(snapshot).map(([f,v])=>[f,{sha256:v.sha256}]))}
  atomic(path.join(root,'knowledge/current-release.json'),JSON.stringify(pointer,null,2)+'\n')
  event(store,{action:'publish',id,reason:pkg.reason,previous:pkg.previous_release,changed_files:pkg.changed_files})
  return {id,package:path.join(store,id+'.json'),changed_files:pkg.changed_files,audit}
}
function status(root){const c=current(root),snapshot=capture(root);return {current_release:c?c.id:null,changed_files:c?changes(c.files,snapshot):Object.keys(snapshot),audit:check(root)}}
function plan(root,store,id){const old=load(store,id),snapshot=capture(root),changed=changes(old.files,snapshot),ledger=JSON.parse(fs.readFileSync(path.join(root,'knowledge/evidence-ledger.json'),'utf8')),oldLedger=old.files['knowledge/evidence-ledger.json']?JSON.parse(old.files['knowledge/evidence-ledger.json'].text):null
 const oldSources=oldLedger?oldLedger.sources:[],changedSources=ledger.sources.filter(s=>JSON.stringify(s)!==JSON.stringify(oldSources.find(o=>o.id===s.id))).map(s=>s.id)
 const removedSources=oldSources.filter(s=>!ledger.sources.some(n=>n.id===s.id)).map(s=>s.id)
 const affected=ledger.claims.filter(c=>changed.includes('utils/kb.js')||c.evidence.some(e=>{const span=ledger.spans.find(s=>s.id===e),oldSpan=oldLedger&&oldLedger.spans.find(s=>s.id===e);return !span||changedSources.includes(span.source_id)||JSON.stringify(span)!==JSON.stringify(oldSpan)} )||!oldLedger||JSON.stringify(c)!==JSON.stringify(oldLedger.claims.find(o=>o.id===c.id)))
 return {from:id,changed_files:changed,changed_sources:changedSources,removed_sources:removedSources,affected_claims:affected.map(c=>c.id),affected_cards:[...new Set(affected.map(c=>c.card_name))],action:changed.length?'Review affected bindings, rebuild in-memory index on restart, run same-bank comparison, publish a new ID':'No changes'}
}
function restoreUnlocked(root,store,id){
  store=outside(root,store);const target=load(store,id),c=current(root),snapshot=capture(root)
  if(!c)throw new Error('No current release; publish current workspace first')
  const dirty=changes(c.files,snapshot);if(dirty.length)throw new Error('Unpublished edits; publish a checkpoint before restore: '+dirty.join(', '))
  const oldPointer=fs.readFileSync(path.join(root,'knowledge/current-release.json'),'utf8')
  // Validate staged target before touching the working tree.
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'vetai-restore-'))
  try{for(const [f,v]of Object.entries(target.files)){fs.mkdirSync(path.dirname(path.join(stage,f)),{recursive:true});fs.writeFileSync(path.join(stage,f),v.text)}check(stage)}finally{fs.rmSync(stage,{recursive:true,force:true})}
  const backup=path.join(store,'restore-backup-'+Date.now()+'-'+process.pid+'.json')
  fs.writeFileSync(backup,JSON.stringify({files:snapshot,pointer:JSON.parse(oldPointer)},null,2),{flag:'wx'})
  try{
    for(const [f,v]of Object.entries(target.files))atomic(path.join(root,f),v.text)
    for(const f of Object.keys(snapshot))if(!target.files[f])fs.unlinkSync(path.join(root,f))
    const pointer={schema_version:1,id,content_sha256:target.content_sha256,files:Object.fromEntries(Object.entries(target.files).map(([f,v])=>[f,{sha256:v.sha256}]))}
    atomic(path.join(root,'knowledge/current-release.json'),JSON.stringify(pointer,null,2)+'\n')
  }catch(error){
    for(const [f,v]of Object.entries(snapshot))atomic(path.join(root,f),v.text)
    for(const f of Object.keys(target.files))if(!snapshot[f]&&fs.existsSync(path.join(root,f)))fs.unlinkSync(path.join(root,f))
    atomic(path.join(root,'knowledge/current-release.json'),oldPointer);throw error
  }
  event(store,{action:'restore',from:c.id,to:id,backup});return {restored:id,backup,restart_required:true}
}
function withLock(root, callback) {
 const lock=path.join(os.tmpdir(),'vetai-knowledge-'+sha(path.resolve(root)).slice(0,24)+'.lock')
 let fd
 try{fd=fs.openSync(lock,'wx')}catch(e){if(e.code==='EEXIST')throw new Error('Knowledge operation already running; inspect stale lock before retry: '+lock);throw e}
 try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));return callback()}finally{fs.closeSync(fd);fs.unlinkSync(lock)}
}
function publish(root,store,id,reason){return withLock(root,()=>publishUnlocked(root,store,id,reason))}
function restore(root,store,id){return withLock(root,()=>restoreUnlocked(root,store,id))}
if(require.main===module){
 try{const args=process.argv.slice(2),cmd=args[0]||'status',get=k=>{const i=args.indexOf(k);return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : undefined},store=args.includes('--store')?get('--store'):path.join(outputRoot(),'knowledge-releases');let result
 if(cmd==='status')result=status(ROOT)
 else if(cmd==='publish')result=publish(ROOT,store,get('--id'),get('--reason'))
 else if(cmd==='plan')result=plan(ROOT,store,get('--from'))
 else if(cmd==='restore')result=restore(ROOT,store,get('--id'))
 else throw new Error('Use status | publish --id ID | plan --from ID | restore --id ID [--store OUTSIDE_REPOSITORY]')
 console.log(JSON.stringify(result,null,2))
 }catch(e){console.error(e.message);process.exitCode=1}
}
module.exports={capture,load,publish,status,plan,restore,sha,managed}
