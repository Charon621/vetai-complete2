const assert=require('assert'),compare=require('../evaluation/tools/rag_compare'),guided=require('../evaluation/tools/rag_guided_compare'),bank=require('../evaluation/datasets/retrieval_scenarios.json')
const empty=JSON.parse(JSON.stringify(bank));empty.cases=empty.cases.filter(c=>c.expected_behavior==='no_candidates')
const report=compare.evaluate(empty,()=>[]);assert(compare.markdown(report).includes('—'))
const invalid=compare.evaluate(empty,()=>null);assert(invalid.rows.every(r=>r.status==='failed'));assert.equal(invalid.rows.length,empty.cases.length*4)
const expected=bank.cases[0].expected_relevant_cards[0],other=bank.cases[1].expected_relevant_cards[0]
assert.equal(guided.metric([other,'x','y',expected],[expected]).recall_at_3,0)
const actual=guided.evaluate(bank);assert(actual.same_pool_verified);assert.equal(actual.model_calls,0);assert.equal(actual.rows.length,bank.cases.length*5)
const data={};global.wx={getStorageSync:k=>data[k]||[],setStorageSync:(k,v)=>{data[k]=v}}
require('../utils/analytics').track('ragWorkflow',{status:'ok',candidateCount:2,complaint:'SECRET',image:'SECRET',name:'SECRET',identity:'SECRET',reasonCode:'invalid text'});assert(!JSON.stringify(data).includes('SECRET'));assert(!JSON.stringify(data).includes('invalid text'))
console.log('same pool / fixed K / null metrics / failed denominator / analytics whitelist passed')
