#!/usr/bin/env node
// ============================================================
// tests/species-output-contract.test.js — B05（BUG-05）验收
//
// 通过 mock 云函数驱动真实 api.diagnose 出口：
//   猫+已审犬瘟热候选被排 / 犬+该候选保留 / 猫+未知新病名保留并记 unresolved /
//   仅犬KB卡但未获临床限定的概念不硬删 / 双候选一个不适用时保留另一个并同步主名 /
//   全部不适用时病因清空 / 兔输入只做形态与分诊但原主诉急症仍升级 /
//   「我家猫」不得被映射为 other / 别名精确识别。
// 物种限制表只含经临床复核的条目（当前仅犬瘟热），不随 KB 卡覆盖扩大。
// ============================================================

const assert = require('assert')
// These fixtures exercise the retained legacy flow; guided is covered by ragWorkflow/ragPages.
require('../utils/config').RAG_WORKFLOW_MODE = 'legacy'

const localStore = {}
const calls = []
let featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
let fullResponse = null

function modelResponse(data) {
  return {
    result: {
      success: true,
      data: {
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { total_tokens: 100 }
      }
    }
  }
}

global.wx = {
  getStorageSync: function (key) { return localStore[key] },
  setStorageSync: function (key, value) { localStore[key] = value },
  cloud: {
    callFunction: function (options) {
      calls.push(options.data)
      if (options.data.phase === 'vision-precheck') {
        options.success(modelResponse(featureResponse))
        return
      }
      options.success(modelResponse(fullResponse))
    }
  }
}

const api = require('../utils/api')

const image = 'data:image/jpeg;base64,AAAA'
const basePetInfo = {
  bodyPart: 'back',
  bodyPartLabel: '背部',
  complaint: '背部掉毛',
  modelProvider: 'qwen',
  useKnowledgeBase: true
}

function validReport(over) {
  return Object.assign({
    imageFindings: [{ imageIndex: 1, role: 'overview', observation: '背部脱毛', quality: 'clear', usable: true }],
    observations: '背部脱毛',
    evidenceFor: ['脱毛区域'],
    evidenceAgainst: [],
    missingInformation: [],
    abstainReason: '',
    primaryDiagnosis: '',
    primaryDiagnosisProbability: 60,
    diagnosisCandidates: [],
    lesionNameCn: '脱毛斑',
    confidence: 60,
    recommendedTests: [],
    urgencyEvidence: [],
    urgency: 'moderate',
    explanation: '',
    possibleMeaning: '',
    homeCare: '',
    whenToWatch: '',
    whenToSeeVet: '扩散时就医',
    diagnosisProbabilityNote: '匹配分说明'
  }, over || {})
}

let passed = 0
async function check(name, fn) {
  passed++
  calls.length = 0
  featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
  await fn()
  console.log('  ok ' + passed + ' - ' + name)
}

async function run() {
  // ── 1. 猫 + 已审犬瘟热候选：移除，另一候选保留，主名同步 ──
  await check('猫 + 犬瘟热候选被排（species_incompatible），另一候选保留且主名同步', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [
        { name: '犬瘟热（硬足垫）', probability: 70, reason: '足垫增厚', supporting: '', against: '' },
        { name: '落叶型天疱疮', probability: 55, reason: '脓疱结痂', supporting: '', against: '' }
      ],
      primaryDiagnosis: '犬瘟热（硬足垫）',
      confidence: 70
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'cat' }))
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.diagnosisCandidates.length, 1)
    assert.strictEqual(d.diagnosisCandidates[0].name, '落叶型天疱疮')
    assert.strictEqual(d.primaryDiagnosis, '落叶型天疱疮', '主名必须同步到保留的首候选')
    assert.deepStrictEqual(d._speciesFilter.removed, [
      { name: '犬瘟热（硬足垫）', conceptId: 'canine_distemper', reason: 'species_incompatible' }
    ])
    // BUG-09 正确行为：保留候选应附程序附加来源
    assert.ok(d.ragSources.length > 0)
  })

  // ── 2. 犬 + 犬瘟热候选：保留 ──
  await check('犬 + 犬瘟热候选保留', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '犬瘟热（硬足垫）', probability: 70, reason: '足垫增厚', supporting: '', against: '' }],
      primaryDiagnosis: '犬瘟热（硬足垫）',
      confidence: 70
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'dog' }))
    assert.strictEqual(result.data.responseStatus, 'ok')
    assert.strictEqual(result.data.diagnosisCandidates.length, 1)
    assert.deepStrictEqual(result.data._speciesFilter.removed, [])
  })

  // ── 3. 猫 + 未知新病名：保留并记 unresolved（不硬删） ──
  await check('猫 + KB外/未知新病名保留（KB外概念不因未命中卡而判错或硬删）', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '模型新命名的少见病', probability: 60, reason: '形态', supporting: '', against: '' }],
      primaryDiagnosis: '模型新命名的少见病',
      confidence: 60
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'cat' }))
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.diagnosisCandidates.length, 1)
    assert.strictEqual(d.diagnosisCandidates[0].name, '模型新命名的少见病')
    assert.deepStrictEqual(d._speciesFilter.removed, [])
  })

  // ── 4. 仅犬 KB 卡但未获临床限定：猫病例不硬删 ──
  await check('浅表脓皮病（仅犬KB卡、未入限制表）在猫病例保留不硬删', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '浅表脓皮病', probability: 60, reason: '脓疱', supporting: '', against: '' }],
      primaryDiagnosis: '浅表脓皮病',
      confidence: 60
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'cat' }))
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.diagnosisCandidates.length, 1, '未获临床限定的概念不得硬删')
    assert.deepStrictEqual(d._speciesFilter.removed, [])
  })

  // ── 5. 复合名（含已审概念但无法精确匹配）：unresolved_concept 保留 ──
  await check('复合/带后缀病名含犬瘟热 → 记 unresolved_concept，保留候选不盲删', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '犬瘟热（硬足垫）相关角化过度', probability: 50, reason: '描述', supporting: '', against: '' }],
      primaryDiagnosis: '犬瘟热（硬足垫）相关角化过度',
      confidence: 50
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'cat' }))
    const d = result.data
    assert.strictEqual(d.diagnosisCandidates.length, 1, '无法无歧义匹配的复合名不得盲删')
    assert.strictEqual(d._speciesFilter.unresolved.length, 1)
    assert.strictEqual(d._speciesFilter.unresolved[0].conceptId, 'canine_distemper')
  })

  // ── 6. 别名精确识别 ──
  await check('别名「犬瘟」精确识别并按限制表处理', async function () {
    const resolved = api.resolveSpeciesRestriction('犬瘟')
    assert.ok(resolved && !resolved.ambiguous && resolved.rule.conceptId === 'canine_distemper')
    const notMatch = api.resolveSpeciesRestriction('马拉色菌皮炎')
    assert.strictEqual(notMatch, null)
  })

  // ── 7. 全部候选都不适用 → 病因清空（clinical_abstain） ──
  await check('猫 + 全部候选都是犬瘟热 → 病因清空（clinical_abstain）', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '犬瘟热（硬足垫）', probability: 70, reason: 'x', supporting: '', against: '' }],
      primaryDiagnosis: '犬瘟热（硬足垫）',
      confidence: 70
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'cat' }))
    const d = result.data
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.abstainCode, 'evidence_insufficient')
    assert.deepStrictEqual(d.diagnosisCandidates, [])
    assert.strictEqual(d.primaryDiagnosis, '无法可靠判断')
    assert.deepStrictEqual(d.ragSources, [])
  })

  // ── 8. 兔输入：能力边界弃答，形态/分诊保留，原主诉急症仍升级 ──
  await check('兔输入：capability_unsupported；形态/分诊保留；原主诉呼吸困难仍 emergency', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '皮肤肿瘤（肥大细胞瘤等）', probability: 60, reason: '肿块', supporting: '', against: '' }],
      primaryDiagnosis: '皮肤肿瘤（肥大细胞瘤等）',
      confidence: 60
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, {
      species: '兔',
      complaint: '它现在呼吸困难，肚子起伏很大'
    }))
    const d = result.data
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.abstainCode, 'capability_unsupported')
    assert.strictEqual(d.answerScope, 'morphology_and_triage')
    assert.strictEqual(d.speciesScope, 'other')
    assert.strictEqual(d.speciesText, '兔')
    assert.deepStrictEqual(d.diagnosisCandidates, [], '兔不得保留犬猫病因主名')
    assert.strictEqual(d.primaryDiagnosis, '无法可靠判断')
    assert.deepStrictEqual(d.ragSources, [])
    // 独立分诊不削弱：原主诉急症升级保留
    assert.strictEqual(d.urgency, 'emergency')
    assert.ok(d.redLineFlags && d.redLineFlags.length > 0, '红线证据必须保留')
    assert.strictEqual(d.lesionNameCn, '脱毛斑', '可见形态字段保留')
    assert.ok(d.missingInformation.length >= 0 && d.recommendedTests.length >= 0, '缺失信息/检查字段保留')
  })

  // ── 9. species 未提供（unknown）：能力边界，不猜物种 ──
  await check('species 缺失 → unknown 走能力边界，不猜犬猫', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '浅表脓皮病', probability: 60, reason: 'x', supporting: '', against: '' }],
      primaryDiagnosis: '浅表脓皮病',
      confidence: 60
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, { species: '' }))
    const d = result.data
    assert.strictEqual(d.speciesScope, 'unknown')
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.abstainCode, 'capability_unsupported')
  })

  // ── 10. 「我家猫」不得映射为 other：物种字段说了算，主诉文本不影响 scope ──
  await check('「我家猫」主诉 + species=猫 → 保持 cat，不进能力边界', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '落叶型天疱疮', probability: 55, reason: 'x', supporting: '', against: '' }],
      primaryDiagnosis: '落叶型天疱疮',
      confidence: 55
    })
    const result = await api.diagnose([image], Object.assign({}, basePetInfo, {
      species: '猫',
      complaint: '我家猫脸上秃了一块'
    }))
    const d = result.data
    assert.strictEqual(d.speciesScope, 'cat')
    assert.strictEqual(d.speciesText, '猫')
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.answerScope, 'etiology_screening')
  })

  // ── 11. prompt 边界段：非犬猫不注入犬猫清单 ──
  await check('兔病例的完整 prompt 不含犬猫高发病清单，含能力边界段', async function () {
    fullResponse = validReport()
    await api.diagnose([image], Object.assign({}, basePetInfo, { species: '兔' }))
    const fullCall = calls.find(function (c) { return c.phase === 'full-diagnosis' })
    // 能力边界段在 system 消息，覆盖清单也在 system——拼接全部消息文本检查
    const joinMessages = function (call) {
      return call.payload.messages.map(function (m) {
        if (typeof m.content === 'string') return m.content
        return (m.content || []).map(function (c) { return c.text || '' }).join('\n')
      }).join('\n')
    }
    const allText = joinMessages(fullCall)
    assert.ok(allText.indexOf('当前病因初筛能力仅覆盖犬猫') >= 0, '必须注入能力边界段')
    assert.ok(allText.indexOf('必查1·部位特征') === -1, '不得注入犬猫高发病清单')
    // 犬猫病例仍保留清单
    calls.length = 0
    await api.diagnose([image], Object.assign({}, basePetInfo, { species: 'dog' }))
    const dogCall = calls.find(function (c) { return c.phase === 'full-diagnosis' })
    const dogAllText = joinMessages(dogCall)
    assert.ok(dogAllText.indexOf('【部位核对】') >= 0, '犬病例保留证据核对清单')
    assert.ok(dogAllText.indexOf('当前病因初筛能力仅覆盖犬猫') === -1, '犬病例不注入能力边界段')
  })

  console.log('')
  console.log('species-output-contract 测试全部通过（' + passed + ' 组）')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
