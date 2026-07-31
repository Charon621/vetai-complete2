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

assert.ok(kb.DISEASE_KB.length >= 60 && kb.DISEASE_KB.length <= 80, 'v3 KB should contain 60-80 cards')

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
  // sources 允许为空数组：rare_warning 类罕见病 / 弱命中时有意不挂通用来源，
  // 前端 sourceList 为空会自动隐藏“临床参考来源”区块，避免不同图片都指向同一组通用链接。
  assert.ok(Array.isArray(card.sources), card.name + ' sources should be an array')
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
}, '蠕形螨病（局灶型）')

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
assert.strictEqual(kb.isPromptWorthyResult(genericResults[0]), false, 'generic top hit should not be prompt-worthy')
assert.strictEqual(kb.buildRagPrompt({
  species: '犬',
  bodyPart: '背部',
  complaint: '红肿 脱毛 瘙痒 结痂'
}), '', 'generic signs alone should not be injected into the RAG prompt')

const dogOralResults = kb.search({
  species: '犬',
  bodyPart: '口腔',
  complaint: '口腔 溃疡 红肿 潮湿 渗出 糜烂 疼痛'
})
assert.notStrictEqual(dogOralResults[0] && dogOralResults[0].name, '急性湿性皮炎（热点）', 'oral ulcers should not force hot spot to top')
assert.strictEqual(kb.buildRagPrompt({
  species: '犬',
  bodyPart: '口腔',
  complaint: '口腔 溃疡 红肿 潮湿 渗出 糜烂 疼痛'
}), '', 'dog oral mucosal ulcers should not be injected into the skin RAG prompt')

expectTop('cat oral eosinophilic granuloma pattern', {
  species: '猫',
  bodyPart: '口腔',
  complaint: '口腔 溃疡 红肿 糜烂 唇部'
}, '嗜酸性肉芽肿复合体')

// ── 组合规则与负信号边界（BUG-M2 补充回归）──

// 预检标准词（visualFeatures）单独驱动时，组合规则也应能命中（纯图片无主诉场景）
const visualOnlyResults = kb.search({
  species: '猫',
  bodyPart: '',
  complaint: '',
  visualFeatures: ['圆形脱毛', '鳞屑', '断毛'],
  lesionPattern: '环形',
  lesionShape: '圆形'
})
assert.ok(visualOnlyResults.length > 0, 'visual-features-only query should hit KB')
assert.strictEqual(visualOnlyResults[0].name, '猫癣', 'ringworm combo should fire from visual features alone')
assert.ok(visualOnlyResults[0].matched.some(function (m) { return String(m).indexOf('组合:') === 0 }),
  'combination rule must fire without complaint text')

// 负信号：蠕形螨（不痒）遇到“剧烈瘙痒”应被降权并标记
const negResults = kb.search({
  species: '犬',
  bodyPart: '面部',
  complaint: '眼周脱毛 皮屑 蠕形螨 剧烈瘙痒'
})
const demodexHit = negResults.filter(function (r) { return r.name.indexOf('蠕形螨') >= 0 })[0]
if (demodexHit) {
  assert.ok(demodexHit.matched.some(function (m) { return String(m).indexOf('负信号:') === 0 }),
    'negative signal should be recorded for contradicted candidates')
}

// 黏膜词表：“嘴巴里面”应触发黏膜过滤，皮肤病不得进入结果
const mouthResults = kb.search({
  species: '犬',
  bodyPart: '',
  complaint: '嘴巴里面破了一块 红肿 渗出'
})
mouthResults.forEach(function (r) {
  assert.notStrictEqual(r.name, '急性湿性皮炎（热点）', 'oral query must not surface hot spot')
})

const ragPrompt = kb.buildRagPrompt({
  species: '猫',
  bodyPart: '面部',
  complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠'
})
assert.strictEqual(kb.isPromptWorthyResult(kb.search({
  species: '猫',
  bodyPart: '面部',
  complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠'
})[0]), true, 'specific ringworm-like evidence should be prompt-worthy')
assert.ok(ragPrompt.indexOf('临床参考核对清单') >= 0, 'RAG prompt should frame hits as review references')
assert.ok(ragPrompt.indexOf('观察依据') >= 0, 'RAG prompt should include evidence')
assert.ok(ragPrompt.indexOf('不确定性') >= 0, 'RAG prompt should include uncertainty')
assert.ok(ragPrompt.indexOf('下一步') >= 0, 'RAG prompt should include next steps')
assert.ok(ragPrompt.indexOf('可以完全不采用') >= 0, 'RAG prompt should allow rejecting weak candidates')
assert.ok(ragPrompt.indexOf('不要写“确诊”') >= 0, 'RAG prompt should preserve safe wording guardrail')

// ============================================================
// K1：隆起性皮损口语词分流（丘疹 vs 肿块互斥）
// 回归此前缺陷：裸词“疙瘩”被无条件扩展为肿块/结节，
// 使「下巴上有小疙瘩」把肿瘤条目推成 Top-1 并注入 prompt。
// ============================================================

function promptWorthyNames(query) {
  return kb.search(query).filter(kb.isPromptWorthyResult).map(function (r) { return r.name })
}

const smallBumpNames = promptWorthyNames({
  species: '犬', breed: '泰迪', bodyPart: '下巴', complaint: '下巴上有小疙瘩'
})
assert.ok(smallBumpNames.indexOf('皮肤肿瘤（肥大细胞瘤等）') < 0,
  'small colloquial bump must not inject tumor card')

const papuleNames = promptWorthyNames({
  species: '犬', breed: '泰迪', bodyPart: '腹部', complaint: '起了好多小红疙瘩，密密麻麻的'
})
assert.ok(papuleNames.indexOf('皮肤肿瘤（肥大细胞瘤等）') < 0,
  'papule wording must not inject tumor card')

// 反向保护：真正的硬块主诉仍须命中肿瘤方向，修复不能矫枉过正
const realMassNames = promptWorthyNames({
  species: '犬', breed: '金毛', bodyPart: '躯干', complaint: '身上有个硬疙瘩越来越大，表面破溃了'
})
assert.ok(realMassNames.indexOf('皮肤肿瘤（肥大细胞瘤等）') >= 0,
  'genuine hard mass must still surface tumor card')

// 单发隆起（量词"一个/长了个"）属肿块方向：单发 vs 多发是关键鉴别，不能因 K1 丢失召回
;['脖子上长了个疙瘩', '背上有个疙瘩', '腿上鼓了个包', '有个包，不痛不痒但在变大'].forEach(function (complaint) {
  const names = promptWorthyNames({
    species: '犬', breed: '金毛', bodyPart: '躯干', complaint: complaint
  })
  assert.ok(names.indexOf('皮肤肿瘤（肥大细胞瘤等）') >= 0 || names.indexOf('皮脂腺囊肿') >= 0,
    'single lump wording must retain mass recall: ' + complaint)
})

// 词族互斥：同一句里丘疹词优先，不得同时注入肿块
const expandedPapule = kb.expandQueryTerms('起了好多小红疙瘩')
assert.ok(expandedPapule.indexOf('丘疹') >= 0, 'papule wording should expand to 丘疹')
assert.ok(expandedPapule.indexOf('肿块') < 0, 'papule wording must not also expand to 肿块')

// ============================================================
// K2：主诉按描述对象分段（主人自身症状 ≠ 宠物皮损）
// ============================================================

const split = kb.splitComplaintBySubject('痒得很厉害一直抓，耳朵边缘和肘部结痂，我手上也起小疙瘩痒')
assert.ok(split.petComplaint.indexOf('我手上') < 0, 'owner-subject sentence must be stripped from pet complaint')
assert.ok(split.petComplaint.indexOf('耳朵边缘') >= 0, 'pet-subject sentences must be retained')
assert.strictEqual(split.zoonosisHint, true, 'owner symptoms should raise zoonosis hint')

const scabiesQuery = {
  species: '犬', breed: '田园犬', bodyPart: '耳部',
  complaint: '痒得很厉害一直抓，耳朵边缘和肘部结痂，我手上也起小疙瘩痒'
}
const scabiesNames = promptWorthyNames(scabiesQuery)
assert.ok(scabiesNames.indexOf('皮肤肿瘤（肥大细胞瘤等）') < 0,
  'owner rash must not be read as a pet mass')
assert.ok(scabiesNames.indexOf('疥螨病') >= 0,
  'owner rash is a zoonosis clue and should surface scabies')

// 无主人症状时不应凭空加分
const noOwnerSplit = kb.splitComplaintBySubject('耳朵边缘结痂，痒得厉害')
assert.strictEqual(noOwnerSplit.zoonosisHint, false, 'pet-only complaint must not set zoonosis hint')

// ============================================================
// K5：物种细分条目继承母条目的组合规则
// ============================================================

const felineScabies = promptWorthyNames({
  species: '猫', breed: '英短', bodyPart: '耳部', complaint: '痒得不行一直挠，耳朵边缘结痂'
})
assert.ok(felineScabies.indexOf('猫疥螨病') >= 0,
  'feline scabies should inherit combo rule and stay prompt-worthy')

Object.keys(kb.COMBO_GROUPS).forEach(function (groupKey) {
  kb.COMBO_GROUPS[groupKey].forEach(function (name) {
    assert.ok(kb.DISEASE_KB.some(function (card) { return card.name === name }),
      'COMBO_GROUPS references unknown card: ' + name)
  })
})

// ============================================================
// 报告来源：按诊断名反查知识卡来源（KB 未强命中时的回退）
// ============================================================

assert.strictEqual(typeof kb.getSourcesForDiagnosisNames, 'function', 'source lookup must be exported')

const atopySources = kb.getSourcesForDiagnosisNames(['特应性皮炎'], '犬')
assert.ok(atopySources.length > 0, 'a named diagnosis must resolve to clinical sources')
atopySources.forEach(function (source) {
  assert.ok(source.title, 'source needs a title')
  assert.ok(!source.url || source.url.indexOf('http') === 0, 'source url must be real or empty')
})

// 来源必须随诊断变化，不能退化成"每份报告同一组通用链接"
const ringwormTitle = kb.getSourcesForDiagnosisNames(['皮肤癣菌病（犬猫）'], '猫')[0].title
const earMiteTitle = kb.getSourcesForDiagnosisNames(['耳螨感染'], '犬')[0].title
const tumorTitle = kb.getSourcesForDiagnosisNames(['皮肤肿瘤（肥大细胞瘤等）'], '犬')[0].title
assert.ok(ringwormTitle !== earMiteTitle && earMiteTitle !== tumorTitle && ringwormTitle !== tumorTitle,
  'different diagnoses must resolve to different sources')

// 无法匹配到知识卡时不得编造来源
assert.strictEqual(kb.getSourcesForDiagnosisNames(['无法可靠判断'], '犬').length, 0,
  'unmatched diagnosis must not fabricate sources')
assert.strictEqual(kb.getSourcesForDiagnosisNames([], '犬').length, 0, 'empty input yields no sources')
assert.strictEqual(kb.getSourcesForDiagnosisNames(['特应性皮炎'], '猫').every(function (s) { return !!s.title }), true,
  'species filter must still return well-formed sources')

// ============================================================
// K8：品种先验访问器
// ============================================================

assert.strictEqual(typeof kb.getBreedSusceptibility, 'function', 'breed accessor must be exported')
const goldenPriors = kb.getBreedSusceptibility('犬', '金毛')
assert.ok(goldenPriors.length > 0 && goldenPriors.length <= 5,
  'popular breed priors must be truncated to a usable list')
assert.strictEqual(kb.getBreedSusceptibility('犬', '').length, 0, 'empty breed yields no priors')
// 泛化词不构成品种先验
const genericBreed = kb.getBreedSusceptibility('犬', '犬不分品种')
assert.ok(genericBreed.indexOf('跳蚤过敏性皮炎') < 0, 'generic breed placeholder must not count as a prior')
// 物种过滤：犬的品种不应带出猫专属条目
kb.getBreedSusceptibility('犬', '金毛').forEach(function (name) {
  const card = kb.DISEASE_KB.filter(function (c) { return c.name === name })[0]
  assert.ok(card.species.indexOf('犬') >= 0, 'breed priors must respect species: ' + name)
})

// ============================================================
// K3：高危/低频条目必须有组合门槛，且两个方向都要守住
// ============================================================

assert.ok(Array.isArray(kb.HIGH_RISK_COMBOS) && kb.HIGH_RISK_COMBOS.length > 0,
  'HIGH_RISK_COMBOS must be exported')

kb.HIGH_RISK_COMBOS.forEach(function (rule) {
  assert.ok(kb.DISEASE_KB.some(function (card) { return card.name === rule.name }),
    'HIGH_RISK_COMBOS references unknown card: ' + rule.name)
  assert.ok(Array.isArray(rule.requireAll) && rule.requireAll.length >= 2,
    rule.name + ' high-risk combo must require at least two evidence groups')
  rule.requireAll.forEach(function (group) {
    assert.ok(Array.isArray(group) && group.length > 0,
      rule.name + ' high-risk combo has an empty evidence group')
  })
})

// 每个高危类条目都要有 combo 支撑（命名规则、分组规则或高危表三者之一）
const namedCombo = []
Object.keys(kb.COMBO_GROUPS).forEach(function (k) {
  kb.COMBO_GROUPS[k].forEach(function (n) { namedCombo.push(n) })
})
kb.HIGH_RISK_COMBOS.forEach(function (r) { namedCombo.push(r.name) })

const HIGH_RISK_CATEGORIES = ['autoimmune', 'endocrine', 'rare_warning']
kb.DISEASE_KB.forEach(function (card) {
  if (HIGH_RISK_CATEGORIES.indexOf(card.category) < 0) return
  assert.ok(namedCombo.indexOf(card.name) >= 0,
    'high-risk card without any combo gate: ' + card.name + '[' + card.category + ']')
})

// 正向：证据齐备时应召回
assert.ok(promptWorthyNames({
  species: '犬', breed: '腊肠', bodyPart: '躯干',
  complaint: '躯干两侧对称掉毛，皮肤变薄，喝水多尿多，肚子变大'
}).indexOf('库兴综合征相关皮肤改变') >= 0, 'cushing should be recalled when its evidence combo is complete')

// 反向：泛词不得把低频病推进 prompt
;[
  { species: '犬', breed: '泰迪', bodyPart: '躯干', complaint: '身上有点掉毛，有结痂' },
  { species: '猫', breed: '英短', bodyPart: '背部', complaint: '掉毛，皮屑有点多' },
  { species: '犬', breed: '雪纳瑞', bodyPart: '腹部', complaint: '肚子有点红' }
].forEach(function (q) {
  promptWorthyNames(q).forEach(function (name) {
    const card = kb.DISEASE_KB.filter(function (c) { return c.name === name })[0]
    assert.ok(HIGH_RISK_CATEGORIES.indexOf(card.category) < 0,
      'generic complaint must not inject high-risk card: ' + name + ' ← ' + q.complaint)
  })
})

// ============================================================
// K4：症状词表长度归一化
// ============================================================

kb.DISEASE_KB.forEach(function (card) {
  assert.strictEqual(typeof card.signWeight, 'number', card.name + ' missing signWeight')
  assert.ok(card.signWeight >= 0.6 && card.signWeight <= 1.25,
    card.name + ' signWeight out of sane range: ' + card.signWeight)
  assert.ok(card.signVocabSize > 0, card.name + ' has an empty sign vocabulary')
})

// 长词表必须拿到比短词表更低的权重，否则归一化没起作用
const bySize = kb.DISEASE_KB.slice().sort(function (a, b) { return b.signVocabSize - a.signVocabSize })
assert.ok(bySize[0].signWeight < bySize[bySize.length - 1].signWeight,
  'longest vocabulary must be discounted relative to the shortest')

// 残留偏置必须显著小于原始词表长度极差
const effs = kb.DISEASE_KB.map(function (c) { return c.signVocabSize * c.signWeight })
const sizes = kb.DISEASE_KB.map(function (c) { return c.signVocabSize })
const rawRatio = Math.max.apply(null, sizes) / Math.min.apply(null, sizes)
const effRatio = Math.max.apply(null, effs) / Math.min.apply(null, effs)
assert.ok(effRatio < rawRatio * 0.75,
  'normalization must materially reduce length bias (raw ' + rawRatio.toFixed(2) +
  'x, effective ' + effRatio.toFixed(2) + 'x)')

// ============================================================
// K6：别名唯一性（同物种内不得重名）
// ============================================================

const aliasOwner = {}
kb.DISEASE_KB.forEach(function (card) {
  ;[card.name].concat(card.aliases || []).forEach(function (alias) {
    const prev = aliasOwner[alias]
    if (prev) {
      const shared = prev.species.filter(function (s) { return card.species.indexOf(s) >= 0 })
      assert.strictEqual(shared.length, 0,
        'alias 「' + alias + '」 is shared by ' + prev.name + ' and ' + card.name +
        ' within species ' + shared.join('/') + ' — they would both score on one complaint')
    } else {
      aliasOwner[alias] = card
    }
  })
})

// ============================================================
// K7：重复条目已合并
// ============================================================

assert.ok(!kb.DISEASE_KB.some(function (c) { return c.name === '毛囊炎' }),
  '毛囊炎 should be merged into 浅表脓皮病')
const pyoderma = kb.DISEASE_KB.filter(function (c) { return c.name === '浅表脓皮病' })[0]
assert.ok(pyoderma.aliases.indexOf('毛囊炎') >= 0,
  'merged entry must retain 毛囊炎 as an alias so the old term still resolves')
assert.ok(pyoderma.breeds.indexOf('贵宾') >= 0,
  'merged entry must absorb breeds from the folded-in card')

console.log('kb tests passed')
