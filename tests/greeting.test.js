const assert = require('assert')
const greeting = require('../utils/greeting')

const DAY = 24 * 60 * 60 * 1000
const now = new Date(2026, 8, 25, 10, 0, 0).getTime()

// 没有记录：第一次检查
let g = greeting.buildGreeting({ petName: '团子', record: null, now: now })
assert.strictEqual(g.mode, 'first')
assert.strictEqual(g.pre + g.name + g.post + g.line2, '给团子做第一次皮肤检查')

// 未选宠物且没有记录：用 TA 兜底
g = greeting.buildGreeting({ petName: '', record: null, now: now })
assert.strictEqual(g.name, 'TA')

// 7 天前中度关注的耳部记录：复查问候，部位转口语
g = greeting.buildGreeting({
  petName: '团子',
  record: { urgency: 'moderate', bodyPart: 'ears', createdAt: now - 7 * DAY },
  now: now
})
assert.strictEqual(g.mode, 'recheck')
assert.strictEqual(g.name + g.post + g.line2, '团子的耳朵，好些了吗？')
assert.ok(g.sub.indexOf('9月18日') >= 0, 'recheck subtitle should mention last check date')

// 未知部位退回“皮肤”
g = greeting.buildGreeting({
  petName: '豆豆',
  record: { urgency: 'urgent', bodyPart: 'whole', createdAt: now - DAY },
  now: now
})
assert.strictEqual(g.post, '的皮肤，')

// 低风险记录：默认问候
g = greeting.buildGreeting({
  petName: '团子',
  record: { urgency: 'low', bodyPart: 'ears', createdAt: now - DAY },
  now: now
})
assert.strictEqual(g.mode, 'default')
assert.strictEqual(g.name + g.line2, '团子哪里不舒服？')

// 超过 30 天的关注记录不再追问
g = greeting.buildGreeting({
  petName: '团子',
  record: { urgency: 'urgent', bodyPart: 'ears', createdAt: now - 40 * DAY },
  now: now
})
assert.strictEqual(g.mode, 'default')

// 未选宠物时取记录里的宠物名，临时问诊用 TA
g = greeting.buildGreeting({ petName: '', record: { petName: '咪咪', urgency: 'low', createdAt: now }, now: now })
assert.strictEqual(g.name, '咪咪')
g = greeting.buildGreeting({ petName: '', record: { petName: '临时问诊', urgency: 'low', createdAt: now }, now: now })
assert.strictEqual(g.name, 'TA')

console.log('greeting tests passed')
