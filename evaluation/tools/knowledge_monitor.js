#!/usr/bin/env node
'use strict'
const fs=require('fs'),path=require('path')
const ops=require('../../tools/knowledge-ops'),monitor=require('../../utils/retrievalMonitor')
const root=path.resolve(__dirname,'../..'),args=process.argv.slice(2),read=k=>args[args.indexOf(k)+1]
try{
 const health=ops.status(root),samples=args.includes('--samples')?JSON.parse(fs.readFileSync(read('--samples'),'utf8')):[]
 if(!Array.isArray(samples))throw new Error('Samples must be an array')
 const summary=monitor.summarize(samples),alerts=[]
 if(!health.current_release)alerts.push('No local release record')
 if(health.changed_files.length)alerts.push('Workspace differs from published version')
 health.audit.warnings.filter(w=>w.startsWith('Source review overdue')).forEach(w=>alerts.push(w))
 Object.keys(summary.groups).forEach(k=>{const g=summary.groups[k];if(g.failures)alerts.push(k+': retrieval failures observed');if(g.samples>=20&&g.p95Ms>50)alerts.push(k+': local retrieval p95 exceeds 50ms engineering budget')})
 console.log(JSON.stringify({health,sample_status:samples.length?'provided_local_samples':'no_samples_provided',summary,alerts},null,2))
 if(alerts.length)process.exitCode=1
}catch(e){console.error(e.message);process.exitCode=1}
