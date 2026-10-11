const assert=require('assert'),r=require('../evaluation/tools/run_paired_replay')
const queue=[],calls=[];let count=0
const t=r.createFixtureTransport({fixtures:{precheck:{raw:{images:[]}}}},{'vision-precheck':1},calls,{schedule(fn){queue.push(fn)}})
t.call({data:{phase:'vision-precheck'},success(){count++},fail(){throw Error('unexpected failure')}})
assert.equal(calls.length,1);queue[0]();assert.equal(count,1)
assert.throws(()=>t.call({data:{phase:'full-diagnosis'}}),/unexpected/)
assert.throws(()=>t.call({data:{phase:'vision-precheck'}}),/extra/)
queue[0]();assert(t.errors.includes('duplicate_fixture_delivery'));assert.equal(count,1)
console.log('independent one-request fixture scheduling passed')
