const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os')
const kb=require('../utils/kb'),ledger=require('../knowledge/evidence-ledger.json'),audit=require('../evaluation/tools/evidence_audit'),evidence=require('../utils/knowledgeEvidence')
const hybrid=require('../utils/hybridRetrieval'),compare=require('../evaluation/tools/rag_compare'),bank=require('../evaluation/datasets/retrieval_scenarios.json'),ops=require('../tools/knowledge-ops')
const clone=x=>JSON.parse(JSON.stringify(x))
assert(audit.audit(ledger,kb.DISEASE_KB,'2026-10-08').ok)
const legacy=clone(ledger);legacy.schema_version=1;legacy.spans.forEach(s=>delete s.species);legacy.claims.forEach(c=>c.evidence_sha256=audit.evidenceHash(legacy,c))
assert(audit.audit(legacy,kb.DISEASE_KB).ok)
assert(audit.audit(legacy,kb.DISEASE_KB).warnings.some(w=>w.startsWith('Legacy')))
const invalidNew=clone(legacy);invalidNew.schema_version=2;assert(!audit.audit(invalidNew,kb.DISEASE_KB).ok)
const changed=clone(kb.DISEASE_KB);changed.find(c=>c.name===ledger.claims[0].card_name).ddx+='变更'
assert(audit.audit(ledger,changed).errors.some(e=>e.includes('Stale')))
const broken=clone(ledger);broken.claims[0].evidence=['missing'];assert(!audit.audit(broken,kb.DISEASE_KB).ok)
const spoof=clone(ledger);spoof.claims[0].review.clinical_signed_at='2026-10-08';assert(!audit.audit(spoof,kb.DISEASE_KB).ok)
assert(audit.audit(ledger,kb.DISEASE_KB,'2028-01-01').warnings.some(w=>w.includes('overdue')))
const newSource=clone(ledger);newSource.sources[0].version+=' revised'
assert(audit.audit(newSource,kb.DISEASE_KB).errors.some(e=>e.includes('Stale evidence')))
assert(kb.getSourcesForDiagnosisNames(['食物过敏性皮炎'],'犬').some(s=>s.url.includes('#page=')))
const catEvidence=evidence.forCard('特应性皮炎（环境过敏）','猫')
assert(!catEvidence.some(c=>c.claimId==='ALG-1-DIFF'));assert(catEvidence.some(c=>c.claimId==='ALG-CAT-SCOPE'&&c.status==='partial_support'))
assert.deepStrictEqual(evidence.forCard('特应性皮炎（环境过敏）','兔'),[])
assert(evidence.forCard('食物过敏性皮炎','犬').every(c=>c.sources.every(s=>![16,18].includes(s.page))))
assert(evidence.forCard('食物过敏性皮炎','猫').every(c=>c.sources.every(s=>[16,18].includes(s.page))))
const wrongSpecies=clone(ledger);wrongSpecies.spans.find(s=>s.id==='S1').species=['猫'];wrongSpecies.claims.forEach(c=>c.evidence_sha256=audit.evidenceHash(wrongSpecies,c))
assert(audit.audit(wrongSpecies,kb.DISEASE_KB).errors.some(e=>e.includes('species coverage gap')))
// Same negative/subject/species constraints for every strategy; no extra candidates from denied facts.
for(const query of [
 {species:'犬',complaint:'没有瘙痒，没有脱毛，没有红斑'},
 {species:'兔',complaint:'背部脱毛有皮屑'},
 {species:'猫',complaint:'以前有脱毛，现在没有了'},
 {species:'猫',complaint:'我手上有黑头，猫没有任何皮损'},
 {species:'猫',complaint:'下巴黑头',evidenceContext:{schemaVersion:'invalid'}}
])for(const strategy of ['bm25','hybrid_unscoped','hybrid'])assert.deepStrictEqual(hybrid.search(query,strategy),[],JSON.stringify(query))
const q={species:'犬',complaint:'腹部有脓疱，右耳有油腻的黄褐色分泌物和酸臭',bodyPart:'腹部'}
const candidates=kb.searchCandidates(q),top=kb.search(q)
assert(candidates.length>top.length);assert(top.every(h=>candidates.some(c=>c.id===h.id)))
const mixed=hybrid.search(q);assert(new Set(mixed.map(h=>h.evidenceScope.lesionId)).size>=2)
assert(mixed.every(h=>h.retrieval.fastPathEligible===false&&h.score===candidates.find(c=>c.id===h.id).score))
global.wx={getStorageSync(){return []},setStorageSync(){}}
const api=require('../utils/api')
assert.strictEqual(api.isStrongVisionRagHit(mixed),false);assert.strictEqual(api.shouldResolveFastRag(mixed),false)
const prompt=api.buildDebugPrompt({species:'犬',complaint:'食物过敏性皮炎，反复瘙痒',bodyPart:'爪部'},[]).userPrompt
assert(prompt.includes('ALG-2-DIET'));assert(prompt.includes('automated_source_comparison'))
const result=compare.evaluate(bank);assert.strictEqual(result.rows.length,bank.cases.length*4)
const independentUse=require('../evaluation/tools/experiment_retrieval'),replay=require('../evaluation/tools/run_paired_replay')
const independentBank={bank_version:'1.0.0',cases:[{case_id:'fresh',animal_id_hash:'test-animal',split:'independent',input_snapshot_id:'test-input',input_sha256:replay.hash(q),query:q}]}
assert.strictEqual(independentUse.runBank(independentBank).records.length,independentUse.registration.profiles.length)
const metrics=require('../evaluation/tools/retrieval_metrics')
assert(metrics.validateCasefile({kind:'retrieval_casefile',casefile_version:'1',cases:[{case_id:'available',complaint:'下巴黑头',expected:['猫痤疮'],split:'independent',development_exposure:'exposed'}]}).ok)
assert.strictEqual(result.clinical_accuracy,null);assert(result.rows.every(r=>r.input_sha256))
assert(new Set(bank.cases.map(c=>c.scenario)).size===6)
const damaged=clone(bank);damaged.cases[0].expected_relevant_cards=['不存在'];assert.throws(()=>compare.validate(damaged),/Unknown/)
const failures=compare.evaluate(bank,()=>{throw new Error('failed retrieval')})
assert.strictEqual(failures.aggregates.hybrid.failures,bank.cases.length)
assert.strictEqual(failures.aggregates.hybrid.full_coverage,0)
// Packages and rollback operate on a disposable workspace, never the user's files.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vetai-knowledge-test-')),root=path.join(temp,'workspace'),store=path.join(temp,'releases')
try{
 fs.mkdirSync(root)
 for(const [name,v]of Object.entries(ops.capture(path.resolve(__dirname,'..')))){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),v.text)}
 const lock=path.join(os.tmpdir(),'vetai-knowledge-'+ops.sha(path.resolve(root)).slice(0,24)+'.lock')
 fs.writeFileSync(lock,'test');try{assert.throws(()=>ops.publish(root,store,'locked'),/already running/)}finally{fs.unlinkSync(lock)}
 assert.throws(()=>ops.publish(root,store,undefined),/Invalid release/)
 ops.publish(root,store,'batch-1');assert.deepStrictEqual(ops.status(root).changed_files,[])
 const file=path.join(root,'knowledge/evidence-ledger.json'),next=JSON.parse(fs.readFileSync(file,'utf8'));next.version='evidence-test-v2';next.claims[0].review.note+=' second review';fs.writeFileSync(file,JSON.stringify(next))
 assert.throws(()=>ops.restore(root,store,'batch-1'),/Unpublished edits/)
 const update=ops.plan(root,store,'batch-1');assert(update.affected_claims.includes(next.claims[0].id))
 ops.publish(root,store,'batch-2');assert.throws(()=>ops.publish(root,store,'batch-2'),/already exists/)
 assert.strictEqual(ops.restore(root,store,'batch-1').restored,'batch-1')
 assert.strictEqual(JSON.parse(fs.readFileSync(file)).version,ledger.version)
 assert.strictEqual(ops.status(root).current_release,'batch-1')
 ops.restore(root,store,'batch-2');assert.strictEqual(JSON.parse(fs.readFileSync(file)).version,'evidence-test-v2')
 const pack=JSON.parse(fs.readFileSync(path.join(store,'batch-1.json'),'utf8'));pack.files['utils/kb.js'].text+='tamper';fs.writeFileSync(path.join(store,'batch-1.json'),JSON.stringify(pack));assert.throws(()=>ops.restore(root,store,'batch-1'),/hash mismatch/)
 assert.throws(()=>ops.load(store,'../escape'),/Invalid release/)
}finally{fs.rmSync(temp,{recursive:true,force:true})}
// No raw inputs in local telemetry.
const saved=[];global.wx={getStorageSync(){return []},setStorageSync(k,v){saved.push(v)}}
const monitor=require('../utils/retrievalMonitor');monitor.record('hybrid',mixed,10,false)
const payload=saved.flat();assert(!JSON.stringify(payload).includes(q.complaint));assert(!JSON.stringify(payload).includes('脓皮病'))
const stats=monitor.summarize(payload);assert(Object.keys(stats.groups).length>0)
console.log('Evidence bindings, controlled retrieval, independent case bank, version/rollback and telemetry checks passed')
// 小程序台账 bundle 必须与 JSON 源文件内容一致；版本号字段随发布变化，由 knowledge:status 的漂移检查负责，这里不比较。
assert.deepStrictEqual(require('../utils/knowledgeBundle').ledger,ledger,'utils/knowledgeBundle.js ledger out of date; run npm run knowledge:bundle')
