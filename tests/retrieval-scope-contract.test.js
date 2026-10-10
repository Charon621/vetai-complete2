const assert=require('assert'),kb=require('../utils/kb'),scope=require('../utils/evidenceScope')
function concepts(text){return kb.expandQueryFacts(text).expansions.map(x=>x.concept)}
for(const text of ['没有硬疙瘩，也没有破皮','没甩头也没抓耳','以前一直挠现在一点不痒']) assert(!concepts(text).some(x=>['肿块','结节','溃疡','耳垢','搔抓','瘙痒'].includes(x)),text)
for(const text of ['一直甩头','甩耳朵'])assert(!concepts(text).some(x=>['耳垢','异味','抓耳'].includes(x)))
assert(concepts('一直甩头').includes('甩头'));assert(!concepts('一粒粒小红疙瘩').includes('脓疱'));assert(concepts('小红疙瘩并有明确脓顶').includes('脓疱'))
assert(kb.expandQueryTerms('好久没驱虫').includes('驱虫不规律'));assert(kb.expandQueryTerms('现在不痒').includes('不痒'))
for(const text of ['我手上没红疹','我抱着猫','我手上会不会长疹','去年我身上得过癣'])assert.strictEqual(kb.splitComplaintBySubject(text).zoonosisHint,false,text)
const mixed=kb.splitComplaintBySubject('猫脸上圆圆的秃了而我手上新起了红疹');assert(mixed.zoonosisHint);assert(mixed.petComplaint.includes('圆圆的秃'));assert(!mixed.petComplaint.includes('红疹'))
assert(kb.splitComplaintBySubject('我的猫掉毛').petComplaint.includes('猫掉毛'));assert(!kb.splitComplaintBySubject('我痒而猫不痒').petComplaint.includes('我痒'))
assert(concepts('左耳痒，右耳不痒').includes('瘙痒'))
const raw='我的猫脸上一块圆圆的秃了，断毛还有鳞屑';for(const e of kb.expandQueryFacts(raw).expansions){assert.strictEqual(raw.slice(e.sourceSpan.start,e.sourceSpan.end),e.sourceSpan.text);assert.strictEqual(e.subject,'pet')}
console.log('B08 scope, negation, equivalent expansion, subject spans passed')
