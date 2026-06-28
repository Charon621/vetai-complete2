const assert = require('assert')
const kb = require('../utils/kb')

function topName(query) {
  const results = kb.search(query)
  assert.ok(results.length > 0, 'expected at least one KB hit for ' + JSON.stringify(query))
  return results[0].name
}

function expectTop(label, query, expected) {
  assert.strictEqual(topName(query), expected, label)
}

assert.ok(kb.DISEASE_KB.length >= 40 && kb.DISEASE_KB.length <= 60, 'v1 KB should contain 40-60 cards')

kb.DISEASE_KB.forEach((card) => {
  ;[
    'id',
    'name',
    'aliases',
    'species',
    'category',
    'visualSigns',
    'historySigns',
    'locations',
    'keyDifferentials',
    'recommendedTests',
    'homeCareSafe',
    'vetAdvice',
    'redFlags',
    'report',
    'sources',
    'reviewStatus',
    'version'
  ].forEach((field) => assert.ok(card[field] !== undefined, card.name + ' missing ' + field))

  assert.ok(Array.isArray(card.visualSigns), card.name + ' visualSigns should be an array')
  assert.ok(Array.isArray(card.historySigns), card.name + ' historySigns should be an array')
  assert.ok(Array.isArray(card.keyDifferentials), card.name + ' keyDifferentials should be an array')
  assert.ok(Array.isArray(card.recommendedTests) && card.recommendedTests.length > 0, card.name + ' missing tests')
  assert.ok(Array.isArray(card.homeCareSafe) && card.homeCareSafe.length > 0, card.name + ' missing safe home care')
  assert.ok(Array.isArray(card.redFlags) && card.redFlags.length > 0, card.name + ' missing red flags')
  assert.ok(Array.isArray(card.sources) && card.sources.length > 0, card.name + ' missing sources')
  assert.ok(card.report.possibleDirection && card.report.uncertainty, card.name + ' missing report template')
})

expectTop('cat ringworm pattern', {
  species: '猫',
  bodyPart: '面部',
  complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠 人也有皮损'
}, '猫癣')

expectTop('dog ringworm pattern', {
  species: '犬',
  bodyPart: '面部',
  complaint: '圆形脱毛 鳞屑 断毛 结痂 真菌 犬癣'
}, '犬癣')

expectTop('dog flea pattern', {
  species: '犬',
  bodyPart: '尾根',
  complaint: '腰背尾根剧烈瘙痒 抓挠 黑色颗粒 跳蚤'
}, '跳蚤过敏性皮炎')

expectTop('cat ear mite pattern', {
  species: '猫',
  bodyPart: '耳道',
  complaint: '黑褐色蜡样耳垢 分泌物 甩头 抓耳'
}, '耳螨感染')

expectTop('malassezia skin pattern', {
  species: '犬',
  bodyPart: '爪部',
  complaint: '爪缝油腻 异味 酸臭 发红 褶皱 潮湿'
}, '马拉色菌皮炎')

expectTop('superficial pyoderma pattern', {
  species: '犬',
  bodyPart: '腹部',
  complaint: '丘疹 脓疱 环形表皮领圈 结痂 脱毛'
}, '浅表脓皮病')

expectTop('hot spot pattern', {
  species: '犬',
  bodyPart: '颈部',
  complaint: '突然出现潮湿红肿 渗出 糜烂 毛发粘连 急性'
}, '急性湿性皮炎（热点）')

expectTop('interdigital pattern', {
  species: '犬',
  bodyPart: '趾间',
  complaint: '趾间红肿 潮湿 频繁舔爪 反复 跛行'
}, '趾间脓皮病（趾间炎）')

expectTop('cat miliary dermatitis pattern', {
  species: '猫',
  bodyPart: '背部',
  complaint: '背部小米粒 粟粒 结痂 剧烈瘙痒 跳蚤'
}, '猫粟粒性皮炎（跳蚤过敏）')

expectTop('feline acne pattern', {
  species: '猫',
  bodyPart: '下巴',
  complaint: '下巴黑点 黑头 粉刺 红肿 结痂'
}, '猫痤疮')

expectTop('cat SCC warning pattern', {
  species: '猫',
  breed: '白猫',
  bodyPart: '耳尖',
  complaint: '白色猫耳尖慢性不愈溃疡 增生 出血'
}, '猫鳞状细胞癌')

expectTop('injection site sarcoma pattern', {
  species: '猫',
  bodyPart: '肩胛',
  complaint: '注射部位 疫苗后 皮下硬结节 持续增大 无痛'
}, '猫注射部位肉瘤')

expectTop('tick bite pattern', {
  species: '犬',
  bodyPart: '耳部',
  complaint: '户外回来发现蜱虫虫体附着 叮咬 周围红肿硬结'
}, '蜱虫叮咬')

expectTop('insect bite pattern', {
  species: '犬',
  bodyPart: '鼻部',
  complaint: '户外后突然鼻部肿胀 红肿 突起 夏天 蚊虫叮咬'
}, '蚊虫叮咬/昆虫过敏')

expectTop('food allergy pattern', {
  species: '犬',
  bodyPart: '耳部',
  complaint: '全年反复瘙痒 耳炎 腹泻 呕吐 食物过敏'
}, '食物过敏性皮炎')

expectTop('atopic dermatitis pattern', {
  species: '犬',
  breed: '金毛',
  bodyPart: '爪部',
  complaint: '季节性反复瘙痒 舔爪 腹侧红斑 环境过敏'
}, '特应性皮炎（环境过敏）')

expectTop('contact dermatitis pattern', {
  species: '犬',
  bodyPart: '腹部',
  complaint: '清洁剂接触后突然腹部红肿 瘙痒 水疱 糜烂'
}, '接触性皮炎')

expectTop('dog demodicosis pattern', {
  species: '犬',
  bodyPart: '面部',
  complaint: '眼周前肢对称脱毛 皮屑 不痒 慢性 蠕形螨'
}, '蠕形螨病')

expectTop('dog sarcoptic mange pattern', {
  species: '犬',
  bodyPart: '耳缘',
  complaint: '耳缘肘部剧烈瘙痒 结痂 增厚 人也有瘙痒 疥螨'
}, '疥螨病')

expectTop('bacterial otitis pattern', {
  species: '犬',
  bodyPart: '耳道',
  complaint: '耳道脓性分泌物 红肿 疼痛 甩头 臭味'
}, '细菌性外耳炎')

expectTop('skin tumor warning pattern', {
  species: '犬',
  bodyPart: '躯干',
  complaint: '皮肤肿块 结节 持续增大 溃疡 不愈 出血'
}, '皮肤肿瘤（肥大细胞瘤等）')

const genericResults = kb.search({
  species: '犬',
  bodyPart: '背部',
  complaint: '红肿 脱毛 瘙痒 结痂'
})
assert.ok(genericResults.length > 0, 'generic signs may still return common candidates')
assert.notStrictEqual(genericResults[0].name, '犬癣', 'generic signs alone should not force ringworm to top')
assert.notStrictEqual(genericResults[0].category, 'mass', 'generic signs alone should not force a mass/tumor warning to top')

const ragPrompt = kb.buildRagPrompt({
  species: '猫',
  bodyPart: '面部',
  complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠'
})
assert.ok(ragPrompt.indexOf('观察依据') >= 0, 'RAG prompt should include evidence')
assert.ok(ragPrompt.indexOf('不确定性') >= 0, 'RAG prompt should include uncertainty')
assert.ok(ragPrompt.indexOf('下一步') >= 0, 'RAG prompt should include next steps')
assert.ok(ragPrompt.indexOf('不要写“确诊”') >= 0, 'RAG prompt should preserve safe wording guardrail')

console.log('kb tests passed')
