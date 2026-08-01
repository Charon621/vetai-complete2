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

console.log('\\n所有排除规则测试通过')