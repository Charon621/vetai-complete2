// 知识库检索验证脚本
// 用几个典型场景验证修改后的 search 逻辑

var kb = require('./utils/kb')

console.log('=== 知识库检索验证 ===\n')

// 测试 1: 猫癣典型场景 - 视觉预检有标准词
console.log('--- 测试 1: 猫癣（视觉预检标准词 + 口语）---')
var r1 = kb.search({
  species: '猫',
  breed: '英短',
  bodyPart: '面部',
  complaint: '圆形掉毛 有白屑',
  visualFeatures: ['圆形脱毛', '鳞屑', '结痂', '断毛'],
  lesionPattern: '局灶性',
  lesionShape: '圆形'
})
r1.forEach(function(r) { console.log('  ' + r.name + ' (score: ' + r.score + ') matched: ' + r.matched.slice(0, 5).join(', ')) })
console.log('')

// 测试 2: 蠕形螨的负信号 - 用户描述"剧烈瘙痒"应该降权
console.log('--- 测试 2: 蠕形螨负信号（面部脱毛 + 剧烈瘙痒 → 应降权蠕形螨）---')
var r2 = kb.search({
  species: '犬',
  breed: '法斗',
  bodyPart: '面部',
  complaint: '面部脱毛 剧烈瘙痒 红肿',
  visualFeatures: ['脱毛', '红斑'],
  lesionPattern: '局灶性'
})
r2.forEach(function(r) { console.log('  ' + r.name + ' (score: ' + r.score + ') matched: ' + r.matched.join(', ')) })
console.log('')

// 测试 3: 泛词过滤 - 仅"红肿 脱毛"不应该推出高分候选
console.log('--- 测试 3: 纯泛词（"红肿 脱毛" → 应该结果少或无）---')
var r3 = kb.search({
  species: '犬',
  breed: '',
  bodyPart: '',
  complaint: '红肿 脱毛'
})
console.log('  结果数: ' + r3.length)
r3.forEach(function(r) { console.log('  ' + r.name + ' (score: ' + r.score + ')') })
console.log('')

// 测试 4: 耳朵口语 - "耳朵里面脏脏的黑色的 臭臭的"
console.log('--- 测试 4: 耳朵口语描述 ---')
var r4 = kb.search({
  species: '猫',
  breed: '英短',
  bodyPart: '耳部',
  complaint: '耳朵里面脏脏的 黑色的 臭臭的 一直甩头'
})
r4.forEach(function(r) { console.log('  ' + r.name + ' (score: ' + r.score + ') matched: ' + r.matched.slice(0, 5).join(', ')) })
console.log('')

// 测试 5: 无视觉预检时纯口语
console.log('--- 测试 5: 无预检，纯口语（"肚子上长了好多小红点 痒死了 老挠"）---')
var r5 = kb.search({
  species: '犬',
  breed: '金毛',
  bodyPart: '腹部',
  complaint: '肚子上长了好多小红点 痒死了 老挠 反反复复'
})
r5.forEach(function(r) { console.log('  ' + r.name + ' (score: ' + r.score + ') matched: ' + r.matched.slice(0, 5).join(', ')) })
console.log('')

// 测试 6: buildRagPrompt 精简后的输出长度
console.log('--- 测试 6: buildRagPrompt 输出长度 ---')
var ragPrompt = kb.buildRagPrompt({
  species: '犬',
  breed: '金毛',
  bodyPart: '背部',
  complaint: '背部大面积红肿渗出 突然发作 脱毛 舔舐',
  visualFeatures: ['红肿', '渗出', '脱毛'],
  lesionPattern: '局灶性'
})
console.log('  字符数: ' + ragPrompt.length)
console.log('  内容:\n' + ragPrompt)
console.log('')

console.log('=== 验证完成 ===')
