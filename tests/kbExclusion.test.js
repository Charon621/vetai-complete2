// ============================================================
// tests/kbExclusion.test.js
// BUG-P1：排除规则函数测试
// 测试 kb.applyExclusionRules 的物种/部位/年龄排除逻辑
// ============================================================
var assert = require('assert')
var kb = require('../utils/kb')

// 确认 applyExclusionRules 已导出
assert.ok(kb.applyExclusionRules, 'applyExclusionRules 应已导出')

// ============================================================
// 测试 1：物种排除
// ============================================================
;(function testSpeciesExclusion() {
  var candidates = [
    { name: '急性湿性皮炎（热点）', probability: 85 },
    { name: '特应性皮炎（环境过敏）', probability: 70 },
    { name: '猫痤疮', probability: 60 }
  ]
  // 犬：急性湿性皮炎（热点）应保留（species: ['犬']），
  // 猫痤疮应排除（species: ['猫']，与 petInfo.species='犬' 不匹配）
  var petInfo = { species: '犬', petType: 'dog' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  assert.equal(filtered.length, 2, '犬诊断应排除猫特有疾病，保留 2 个候选')
  assert.equal(filtered[0].name, '急性湿性皮炎（热点）', '犬病应保留')
  assert.equal(filtered[1].name, '特应性皮炎（环境过敏）', '通用病应保留')
  // 猫痤疮不应在结果中
  var hasCatAcne = filtered.some(function(c) { return c.name === '猫痤疮' })
  assert.equal(hasCatAcne, false, '猫痤疮应被排除')
  console.log('  PASS 物种排除测试')
})()

// ============================================================
// 测试 2：空候选列表
// ============================================================
;(function testEmptyCandidates() {
  var result = kb.applyExclusionRules([], { species: '犬' })
  assert.deepEqual(result, [], '空候选列表应返回空数组')
  console.log('  PASS 空候选列表测试')
})()

// ============================================================
// 测试 3：无 petInfo
// ============================================================
;(function testNoPetInfo() {
  var candidates = [
    { name: '急性湿性皮炎（热点）', probability: 85 }
  ]
  var result = kb.applyExclusionRules(candidates, null)
  assert.equal(result.length, 1, '无 petInfo 时应返回原候选列表')
  console.log('  PASS 无 petInfo 测试')
})()

// ============================================================
// 测试 4：非数组 candidates
// ============================================================
;(function testNonArrayCandidates() {
  var result = kb.applyExclusionRules('not-an-array', { species: '犬' })
  assert.deepEqual(result, 'not-an-array', '非数组 candidates 应原样返回')
  console.log('  PASS 非数组 candidates 测试')
})()

// ============================================================
// 测试 5：别名匹配排除
// ============================================================
;(function testAliasMatch() {
  var candidates = [
    { name: 'hot spot', probability: 80 }  // 别名，应匹配到急性湿性皮炎（热点）
  ]
  var petInfo = { species: '犬', petType: 'dog' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  // 'hot spot' 是急性湿性皮炎（热点）的别名，species: ['犬']，应保留
  // 这里没有排除条件会排除它
  assert.equal(filtered.length, 1, '别名匹配应保留正确物种的候选')
  console.log('  PASS 别名匹配排除测试')
})()

// ============================================================
// 测试 6：部位排除
// ============================================================
;(function testBodyPartExclusion() {
  var candidates = [
    { name: '耳螨感染', probability: 85 },  // exclusions: ['仅限部位:耳']
    { name: '特应性皮炎（环境过敏）', probability: 70 }
  ]
  var petInfo = { species: '犬', petType: 'dog', bodyPartLabel: '背部', bodyPart: '背部' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  // 耳螨感染仅限耳部，部位为背部时应排除
  var hasEarMites = filtered.some(function(c) { return c.name === '耳螨感染' })
  assert.equal(hasEarMites, false, '耳部疾病在背部部位时应排除')
  assert.equal(filtered.length, 1, '部位排除后应只剩 1 个候选')
  console.log('  PASS 部位排除测试')
})()

// ============================================================
// 测试 7：物种映射（英文名）
// ============================================================
;(function testSpeciesMapping() {
  var candidates = [
    { name: '急性湿性皮炎（热点）', probability: 85 }  // species: ['犬']
  ]
  var petInfo = { species: 'dog', petType: 'dog' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  assert.equal(filtered.length, 1, '英文物种名 dog 应映射为 犬，保留犬病')
  console.log('  PASS 物种映射测试')
})()

// ============================================================
// 测试 8：猫特有疾病排除
// ============================================================
;(function testCatOnlyDisease() {
  var candidates = [
    { name: '猫痤疮', probability: 80 },  // species: ['猫']
    { name: '嗜酸性肉芽肿复合体', probability: 75 },  // species: ['猫']
    { name: '特应性皮炎（环境过敏）', probability: 70 }  // species: ['犬', '猫']
  ]
  // petInfo 为犬
  var petInfo = { species: '犬', petType: 'dog' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  // 猫痤疮和嗜酸性肉芽肿复合体应被排除
  var hasCatAcne = filtered.some(function(c) { return c.name === '猫痤疮' })
  var hasEosinophilic = filtered.some(function(c) { return c.name === '嗜酸性肉芽肿复合体' })
  assert.equal(hasCatAcne, false, '猫痤疮应被排除')
  assert.equal(hasEosinophilic, false, '嗜酸性肉芽肿复合体应被排除')
  assert.equal(filtered.length, 1, '犬诊断应排除猫特有疾病')
  console.log('  PASS 猫特有疾病排除测试')
})()

// ============================================================
// 测试 9：犬特有疾病保留
// ============================================================
;(function testDogOnlyDisease() {
  var candidates = [
    { name: '急性湿性皮炎（热点）', probability: 80 },  // species: ['犬']
    { name: '特应性皮炎（环境过敏）', probability: 70 }  // species: ['犬', '猫']
  ]
  var petInfo = { species: '猫', petType: 'cat' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  // 急性湿性皮炎（热点）species: ['犬']，应排除
  var hasHotSpot = filtered.some(function(c) { return c.name === '急性湿性皮炎（热点）' })
  assert.equal(hasHotSpot, false, '犬特有疾病在猫诊断时应排除')
  assert.equal(filtered.length, 1, '猫诊断应排除犬特有疾病')
  console.log('  PASS 犬特有疾病排除测试')
})()

// ============================================================
// 测试 10：排除不存在的疾病名
// ============================================================
;(function testUnknownDisease() {
  var candidates = [
    { name: '未知疾病', probability: 50 }
  ]
  var petInfo = { species: '犬', petType: 'dog' }
  var filtered = kb.applyExclusionRules(candidates, petInfo)
  assert.equal(filtered.length, 1, '未知疾病名应保留（没有可用的排除规则）')
  console.log('  PASS 未知疾病排除测试')
})()

// ============================================================
// BUG-L8：测试 11——部位父子映射：粗粒度页面入参不得误删合法候选
// ============================================================
;(function testBodyPartParentChildMapping() {
  // 猫痤疮白名单为“下颏/唇”，页面只传粗粒度“头部”，必须保留
  var catAcne = [{ name: '猫痤疮', probability: 80 }]
  var head = kb.applyExclusionRules(catAcne, { species: '猫', bodyPart: 'head', bodyPartLabel: '头部' })
  assert.equal(head.length, 1, '猫+头部+猫痤疮 应保留（下颏/唇是头部子部位）')
  // 蠕形螨病（局灶型）locations 含“前肢/爪部”，四肢输入靠 locations 兜底保留
  var demodex = [{ name: '蠕形螨病（局灶型）', probability: 80 }]
  var limbs = kb.applyExclusionRules(demodex, { species: '犬', bodyPart: 'limbs', bodyPartLabel: '四肢' })
  assert.equal(limbs.length, 1, '犬+四肢+蠕形螨病（局灶型）应保留（locations 含前肢）')
  // 嗜酸性肉芽肿复合体 locations 含“大腿/爪部”，四肢输入保留
  var egc = [{ name: '嗜酸性肉芽肿复合体', probability: 80 }]
  var limbs2 = kb.applyExclusionRules(egc, { species: '猫', bodyPart: 'limbs', bodyPartLabel: '四肢' })
  assert.equal(limbs2.length, 1, '猫+四肢+嗜酸性肉芽肿复合体应保留（locations 含大腿）')
  // 细粒度标签也能归一：视觉/主诉直接传“下颏”应命中头部白名单
  var chin = kb.applyExclusionRules(catAcne, { species: '猫', bodyPartLabel: '下颏' })
  assert.equal(chin.length, 1, '猫+下颏+猫痤疮 应保留（细粒度词归一为头部）')
  console.log('  PASS 部位父子映射测试')
})()

// ============================================================
// BUG-L8：测试 12——部位黑名单/白名单反向语义
// ============================================================
;(function testBodyPartBlacklistSemantics() {
  // 反向用例保留：耳部疾病在背部应排除
  var earMites = [{ name: '耳螨感染', probability: 80 }]
  var back = kb.applyExclusionRules(earMites, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部' })
  assert.equal(back.length, 0, '耳部疾病在背部时应排除（反向用例保持）')
  // 耳部疾病在耳部应保留
  var ears = kb.applyExclusionRules(earMites, { species: '犬', bodyPart: 'ears', bodyPartLabel: '耳部' })
  assert.equal(ears.length, 1, '耳部疾病在耳部时应保留')
  // “其他”不触发白名单硬删除：缺失部位信息不等于不符合
  var other = kb.applyExclusionRules(earMites, { species: '犬', bodyPart: 'other', bodyPartLabel: '其他' })
  assert.equal(other.length, 1, '部位为其他时耳部疾病应保守保留')
  // 猫痤疮在四肢应排除（下颏/唇不在四肢，扩大映射不应放行明显错配）
  var catAcne = [{ name: '猫痤疮', probability: 80 }]
  var limbs = kb.applyExclusionRules(catAcne, { species: '猫', bodyPart: 'limbs', bodyPartLabel: '四肢' })
  assert.equal(limbs.length, 0, '猫痤疮在四肢时应排除（父子映射不得放行错配）')
  console.log('  PASS 部位黑白名单语义测试')
})()

// ============================================================
// BUG-L9：测试 13——跨物种同名别名消歧
// ============================================================
;(function testCrossSpeciesAliasDisambiguation() {
  // 犬病例“晒伤”必须绑犬日光性皮炎（腹部是合法部位），不再错绑猫卡
  var dogSunburn = [{ name: '晒伤', probability: 80 }]
  var dogAbd = kb.applyExclusionRules(dogSunburn, { species: '犬', bodyPart: 'abdomen', bodyPartLabel: '腹部' })
  assert.equal(dogAbd.length, 1, '犬+腹部+晒伤 应保留（别名按物种消歧到犬卡）')
  // 英文别名同样消歧
  var dogSolar = [{ name: 'solar dermatitis', probability: 80 }]
  var dogSolarRes = kb.applyExclusionRules(dogSolar, { species: '犬', bodyPart: 'abdomen', bodyPartLabel: '腹部' })
  assert.equal(dogSolarRes.length, 1, '犬+腹部+solar dermatitis 应保留')
  // 猫病例“晒伤”绑猫日光性皮炎，耳部是合法部位
  var catSunburn = [{ name: '晒伤', probability: 80 }]
  var catEars = kb.applyExclusionRules(catSunburn, { species: '猫', bodyPart: 'ears', bodyPartLabel: '耳部' })
  assert.equal(catEars.length, 1, '猫+耳部+晒伤 应保留（猫日光性皮炎好发耳尖/鼻部）')
  // 猫病例“晒伤”在腹部应被部位门控排除（猫日光性皮炎白名单不含腹部）——这是正确行为
  var catAbd = kb.applyExclusionRules(catSunburn, { species: '猫', bodyPart: 'abdomen', bodyPartLabel: '腹部' })
  assert.equal(catAbd.length, 0, '猫+腹部+晒伤 应排除（部位不符，非物种错绑）')
  // 物种未知时无法唯一消歧 → 保守保留，不硬排除
  var unknownSpecies = kb.applyExclusionRules(dogSunburn, { bodyPart: 'abdomen', bodyPartLabel: '腹部' })
  assert.equal(unknownSpecies.length, 1, '物种未知时同名别名应保守保留')
  // 被移除候选必须带上规范名+别名集合（供上游自由文本清理）
  var catAcne = [{ name: '猫痤疮', probability: 80 }]
  var dog = kb.applyExclusionRules(catAcne, { species: '犬', bodyPart: 'head', bodyPartLabel: '头部' })
  assert.equal(dog.length, 0, '犬病例猫痤疮应排除（物种）')
  assert.ok(Array.isArray(dog.removedNames), '排除后返回数组应带 removedNames')
  assert.ok(dog.removedNames.indexOf('猫痤疮') >= 0, 'removedNames 应含规范名')
  assert.ok(dog.removedNames.indexOf('猫下巴痤疮') >= 0, 'removedNames 应含别名')
  console.log('  PASS 跨物种同名别名消歧测试')
})()

// ============================================================
// BUG-L8：测试 14——年龄规范化（真实页面入参）
// ============================================================
;(function testAgeNormalization() {
  // 急性湿性皮炎（热点）contraindications: ['非年龄:老年']
  var hotSpot = [{ name: '急性湿性皮炎（热点）', probability: 80 }]
  // 页面真实入参：age='senior' + ageLabel='老年' → 规则必须生效
  var senior = kb.applyExclusionRules(hotSpot, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'senior', ageLabel: '老年' })
  assert.equal(senior.length, 0, 'age=senior + ageLabel=老年 应触发非年龄:老年 排除')
  // 中文标签直接传入同样生效（兼容旧调用）
  var seniorCn = kb.applyExclusionRules(hotSpot, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: '老年' })
  assert.equal(seniorCn.length, 0, 'age=老年 应触发排除')
  // 成年不排除
  var adult = kb.applyExclusionRules(hotSpot, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'adult', ageLabel: '成年' })
  assert.equal(adult.length, 1, '成年犬热点应保留')
  // 年龄未知不得触发年龄排除（缺失信息不等于不符合）
  var unknown = kb.applyExclusionRules(hotSpot, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'unknown', ageLabel: '不确定' })
  assert.equal(unknown.length, 1, 'age=unknown 不得触发年龄排除')
  // 缺失年龄不得触发年龄排除
  var missing = kb.applyExclusionRules(hotSpot, { species: '犬', bodyPart: 'back', bodyPartLabel: '背部' })
  assert.equal(missing.length, 1, '缺失年龄不得触发年龄排除')
  console.log('  PASS 年龄规范化测试')
})()

console.log('\\n所有排除规则测试通过')