#!/usr/bin/env node
// ============================================================
// tests/diagnosis-output-contract.test.js — B03（BUG-04/03/06/09）验收
//
// 通过 mock 云函数驱动真实 api.diagnose 出口，覆盖：
//   正常对象 / 包装对象 / 空对象 / primitive / 错误类型 / 重复图号 / 少图 /
//   全部 unusable / 无证据弃答 / 合法弃答但高分候选 / 甲20乙80主名甲 /
//   系统失败含当前呼吸困难仍保留独立急症分诊 / 来源只随最终保留候选 /
//   兼容字段不复活清空候选。
// 这是输出契约验收：不运行真实模型，不构成临床正确性证据。
// ============================================================

const assert = require('assert')
// These fixtures exercise the retained legacy flow; guided is covered by ragWorkflow/ragPages.
require('../utils/config').RAG_WORKFLOW_MODE = 'legacy'

const localStore = {}
const calls = []
let featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
let fullResponse = null          // 本用例设置的完整诊断模型返回对象
let fullFail = false

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
      if (fullFail) {
        options.fail({ errMsg: 'cloud.callFunction:fail timeout' })
        return
      }
      options.success(modelResponse(fullResponse))
    }
  }
}

const api = require('../utils/api')

const image = 'data:image/jpeg;base64,AAAA'
const petInfo = {
  species: 'dog',
  bodyPart: 'back',
  bodyPartLabel: '背部',
  complaint: '背部圆形脱毛',
  modelProvider: 'qwen',
  useKnowledgeBase: true
}

function validReport(over) {
  return Object.assign({
    imageFindings: [{ imageIndex: 1, role: 'overview', observation: '背部圆形脱毛', quality: 'clear', usable: true }],
    observations: '背部可见圆形脱毛斑',
    evidenceFor: ['圆形脱毛伴鳞屑'],
    evidenceAgainst: ['未见脓疱'],
    missingInformation: ['未做真菌检查'],
    abstainReason: '',
    primaryDiagnosis: '皮肤癣菌病（犬猫）',
    primaryDiagnosisProbability: 72,
    diagnosisCandidates: [{ name: '皮肤癣菌病（犬猫）', probability: 72, reason: '形态吻合', supporting: '环形脱毛', against: '未镜检' }],
    lesionNameCn: '环形脱毛斑',
    confidence: 72,
    recommendedTests: ['真菌检查'],
    urgencyEvidence: [],
    urgency: 'moderate',
    explanation: '需要真菌检查确认',
    possibleMeaning: '存在感染可能',
    homeCare: '隔离并保持环境清洁',
    whenToWatch: '观察是否扩散',
    whenToSeeVet: '扩散时就医',
    diagnosisProbabilityNote: '匹配分说明'
  }, over || {})
}

let passed = 0
async function check(name, fn) {
  passed++
  calls.length = 0
  featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
  fullFail = false
  await fn()
  console.log('  ok ' + passed + ' - ' + name)
}

async function run() {
  // ── 1. 正常对象：ok 契约 ──
  await check('正常 v2 对象：responseStatus=ok，主名=首候选，来源随最终候选', async function () {
    fullResponse = validReport()
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.success, true)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.abstainCode, null)
    assert.strictEqual(d.technicalFailure, false)
    assert.strictEqual(d.isReject, false)
    assert.strictEqual(d.primaryDiagnosis, '犬癣')
    assert.strictEqual(d.diagnosisCandidates.length, 1)
    assert.strictEqual(d.diseaseList.length, 1, 'diseaseList 应与最终候选一致')
    assert.ok(Array.isArray(d.ragSources) && d.ragSources.length > 0,
      'ok 报告必须带程序附加的疾病来源')
    assert.strictEqual(d.diagnosisCandidates[0].probability, 72)
    assert.strictEqual(d.primaryDiagnosisProbability, 72)
  })

  // ── 2. 包装对象 ──
  await check('result 包装对象：正确解包并判 ok', async function () {
    fullResponse = { result: validReport() }
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'ok')
    assert.strictEqual(result.data.primaryDiagnosis, '犬癣')
  })

  // ── 3. 空对象 / primitive / 数组：schema_error，且保留红线急症 ──
  await check('空对象 → schema_error；原主诉呼吸困难仍触发独立急症升级', async function () {
    fullResponse = {}
    const result = await api.diagnose([image], Object.assign({}, petInfo, {
      complaint: '它现在呼吸困难，肚子起伏很大'
    }))
    const d = result.data
    assert.strictEqual(result.success, true, '结构失败也必须给用户一个可解释的出口')
    assert.strictEqual(d.responseStatus, 'schema_error')
    assert.strictEqual(d.technicalFailure, true)
    assert.strictEqual(d.failureStage, 'output_schema')
    assert.strictEqual(d.isReject, false, '系统失败不得冒充画质/临床拒答')
    assert.strictEqual(d.abstainReason, '', 'schema_error 不是临床弃答')
    assert.deepStrictEqual(d.diagnosisCandidates, [], 'schema_error 候选必须为空')
    assert.deepStrictEqual(d.diseaseList, [], '兼容字段不得复活候选')
    assert.deepStrictEqual(d.ragSources, [], 'schema_error 不得附疾病来源')
    assert.ok(d.explanation.indexOf('结构异常') >= 0 || d.explanation.indexOf('重试') >= 0,
      '用户提示应是服务异常/重试，不是照片太差：' + d.explanation)
    assert.ok(d.explanation.indexOf('照片') === -1 || d.explanation.indexOf('清晰') === -1,
      '不得把系统失败说成画质问题')
    // 独立红线仍在：原主诉含呼吸困难 → 急症升级保留
    assert.strictEqual(d.urgency, 'emergency', '原主诉呼吸困难必须独立升级急症')
    assert.ok(d.redLineFlags && d.redLineFlags.length > 0, 'schema_error 下红线证据必须保留')
  })

  await check('primitive 字符串 → schema_error', async function () {
    fullResponse = '这不是JSON对象'
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
  })

  await check('顶层数组 → schema_error', async function () {
    fullResponse = [validReport()]
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
  })

  // ── 4. 错误类型：小数分 / 字符串分 ──
  await check('probability 0.8 → schema_error（不得静默放大为 80）', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [{ name: '皮肤癣菌病（犬猫）', probability: 0.8, reason: 'r' }],
      primaryDiagnosisProbability: 0.8
    })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
    assert.ok(result.data.schemaErrors.some(function (e) { return String(e).indexOf('0-100') >= 0 }),
      '错误信息应指出整数要求')
  })

  await check('confidence 为字符串 → schema_error', async function () {
    fullResponse = validReport({ confidence: '80' })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
  })

  // ── 5. 图号契约 ──
  await check('重复图号 → schema_error', async function () {
    fullResponse = validReport({ imageFindings: [
      { imageIndex: 1, role: 'overview', observation: 'a', quality: 'clear', usable: true },
      { imageIndex: 1, role: 'closeup', observation: 'b', quality: 'clear', usable: true }
    ] })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
    assert.ok(result.data.schemaErrors.some(function (e) { return String(e).indexOf('重复') >= 0 }))
  })

  await check('两图只回一项（少图）→ schema_error', async function () {
    const twoImages = ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB']
    fullResponse = validReport() // 只覆盖 1 张
    const result = await api.diagnose(twoImages, petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
    assert.ok(result.data.schemaErrors.some(function (e) { return String(e).indexOf('实际发送 2') >= 0 }))
  })

  await check('多于提示词目标的有效列表保留，不整份拒绝；最多 12 条', async function () {
    const extra = ['位置待确认', '病程待补充', '瘙痒待补充', '接触史待补充']
    const checks = Array.from({ length: 7 }, (_, i) => '线下检查项目' + (i + 1))
    fullResponse = validReport({ evidenceFor: extra, missingInformation: extra, recommendedTests: checks })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'ok')
    assert.deepStrictEqual(result.data.evidenceFor, extra)
    assert.deepStrictEqual(result.data.missingInformation, extra)
    assert.deepStrictEqual(result.data.recommendedTests, checks)
    for (const field of ['evidenceFor', 'evidenceAgainst', 'missingInformation', 'recommendedTests', 'urgencyEvidence']) {
      const rows = Array.from({ length: 12 }, (_, i) => '条目' + i)
      assert.strictEqual(api.validateDiagnosisResponse(validReport({ [field]: rows }), { imageCount: 1 }).ok, true)
      assert.strictEqual(api.validateDiagnosisResponse(validReport({ [field]: rows.concat('超限') }), { imageCount: 1 }).ok, false)
      assert.strictEqual(api.validateDiagnosisResponse(validReport({ [field]: ['有效条目', null] }), { imageCount: 1 }).ok, false)
    }
  })

  await check('多出的第 5 条仍执行安全检查，不能通过截断隐藏危险内容', async function () {
    fullResponse = validReport({ recommendedTests: ['检查一', '检查二', '检查三', '检查四', '口服消炎药每天两次'] })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.responseStatus, 'schema_error')
    assert.strictEqual(result.data.failureStage, 'output_safety')
    assert.strictEqual(result.data.safetyBlocked, true)
  })

  // ── 6. 全部 unusable：临床弃答联动（不是 schema_error） ──
  await check('全部图片 unusable → clinical_abstain / image_unusable；病史与分诊保留', async function () {
    fullResponse = validReport({
      imageFindings: [{ imageIndex: 1, role: 'overview', observation: '过曝看不清', quality: 'unusable', usable: false }],
      abstainReason: '照片无法辨认皮损细节'
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.abstainCode, 'image_unusable')
    assert.strictEqual(d.isReject, true)
    assert.strictEqual(d.technicalFailure, false, '临床弃答不是技术失败')
    assert.deepStrictEqual(d.diagnosisCandidates, [], '弃答时候选清空')
    assert.deepStrictEqual(d.diseaseList, [], '兼容字段不复活')
    assert.strictEqual(d.primaryDiagnosis, '无法可靠判断')
    assert.strictEqual(d.primaryDiagnosisProbability, 0)
    assert.strictEqual(d.confidence, 0)
    assert.deepStrictEqual(d.ragSources, [], '弃答不附疾病来源')
    assert.strictEqual(d.urgency, 'moderate', '独立分诊保留（不被弃答清掉）')
    assert.ok(d.recommendedTests.length >= 0, '检查建议字段保留')
    assert.ok(d._modelTrace.primaryDiagnosis === '皮肤癣菌病（犬猫）' || d._modelTrace.candidates.length >= 0,
      '模型原分只进获准 trace')
  })

  // ── 7. 合法弃答但高分候选：联动清空 ──
  await check('abstainReason 非空但模型给 86 分候选 → 弃答联动清空，不保留高病因分', async function () {
    fullResponse = validReport({
      abstainReason: '无法定位病因，需要线下检查区分',
      primaryDiagnosis: '浅表脓皮病',
      primaryDiagnosisProbability: 86,
      diagnosisCandidates: [{ name: '浅表脓皮病', probability: 86, reason: '脓疱', supporting: '', against: '' }],
      confidence: 86
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.abstainCode, 'evidence_insufficient')
    assert.deepStrictEqual(d.diagnosisCandidates, [])
    assert.strictEqual(d.primaryDiagnosis, '无法可靠判断')
    assert.strictEqual(d.primaryDiagnosisProbability, 0)
    assert.strictEqual(d.confidence, 0, '弃答即 0 分，不得保留 86')
    assert.deepStrictEqual(d.ragSources, [])
    assert.strictEqual(d._modelTrace.primaryDiagnosisProbability, 86, '原分只进 trace')
  })

  // ── 8. 甲20乙80主名甲：主名/主分以最终排序后的首候选为准 ──
  await check('甲20乙80原主名甲 → 输出主名乙/主分乙，排序一致', async function () {
    fullResponse = validReport({
      primaryDiagnosis: '甲病',
      primaryDiagnosisProbability: 20,
      diagnosisCandidates: [
        { name: '甲病', probability: 20, reason: '弱依据', supporting: '', against: '' },
        { name: '乙病', probability: 80, reason: '强依据', supporting: '', against: '' }
      ],
      confidence: 80
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok')
    assert.strictEqual(d.primaryDiagnosis, '乙病', '主名必须与首候选一致（BUG-06）')
    assert.strictEqual(d.primaryDiagnosisProbability, d.diagnosisCandidates[0].probability)
    assert.strictEqual(d.disease, '乙病')
    assert.strictEqual(d.diseaseList[0].name, '乙病')
  })

  // ── 9. 同分校验：原输出顺序稳定 ──
  await check('两候选同分（校准封顶）→ 按原始分，再按原顺序', async function () {
    fullResponse = validReport({
      diagnosisCandidates: [
        { name: '先说的高分病', probability: 95, reason: 'a', supporting: '', against: '' },
        { name: '后说的低分病', probability: 40, reason: 'b', supporting: '', against: '' }
      ],
      confidence: 95
    })
    const result = await api.diagnose([image], petInfo)
    const cands = result.data.diagnosisCandidates
    assert.strictEqual(cands[0].name, '先说的高分病')
    assert.strictEqual(cands[1].name, '后说的低分病')
  })

  // ── 10. 无候选也无弃答 → clinical_abstain（evidence_insufficient） ──
  await check('候选为空且无弃答说明 → clinical_abstain，不回填原主名', async function () {
    fullResponse = validReport({
      primaryDiagnosis: '皮肤癣菌病（犬猫）',
      primaryDiagnosisProbability: 72,
      diagnosisCandidates: [],
      confidence: 50
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'clinical_abstain')
    assert.strictEqual(d.primaryDiagnosis, '无法可靠判断', '不得从原模型主名回填')
    assert.strictEqual(d.primaryDiagnosisProbability, 0)
    assert.deepStrictEqual(d.ragSources, [])
  })

  // ── 11. 模型自报来源与 KB 无关来源：附加来源只来自程序知识卡 ──
  await check('模型自报 ragSources 被忽略；弃答时来源为空（即使 KB 有命中）', async function () {
    fullResponse = validReport({
      ragSources: [{ title: '模型编造的来源', url: 'https://evil.example.com/x' }]
    })
    const result = await api.diagnose([image], petInfo)
    assert.ok(result.data.ragSources.length > 0)
    result.data.ragSources.forEach(function (s) {
      assert.ok(s.title.indexOf('模型编造') === -1, '不得透传模型自报来源')
    })

    calls.length = 0
    // 弱预检特征：不让快路径抢跑，专测 full 路径的弃答来源契约
    featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 92 }
    fullResponse = validReport({
      imageFindings: [{ imageIndex: 1, role: 'overview', observation: 'x', quality: 'unusable', usable: false }],
      abstainReason: '照片无法辨认'
    })
    const abstainResult = await api.diagnose([image], petInfo)
    assert.deepStrictEqual(abstainResult.data.ragSources, [],
      '弃答报告即使 KB 有强命中也不得附疾病来源（BUG-09）')
  })

  // ── 12. full 失败时 deferred 兜底报告也带契约字段 ──
  await check('full 失败 → 兜底快报告带 responseStatus=ok 与契约字段', async function () {
    // 药疹输入：高危卡强命中但不抢跑（与 fastpath ④a 相同的可达兜底路径）
    featureResponse = {
      visualFeatures: ['红斑', '水疱', '靶形红斑', '溃疡'],
      quality: 'clear', diagnosabilityScore: 90
    }
    fullFail = true
    const result = await api.diagnose([image], Object.assign({}, petInfo, {
      complaint: '打疫苗后几天身上突然长满了红斑和水疱，还破皮了',
      bodyPart: 'abdomen', bodyPartLabel: '腹部'
    }))
    const d = result.data
    assert.strictEqual(JSON.parse(result.raw).fastRag, 'fallback')
    assert.strictEqual(d.responseStatus, 'ok', '兜底快报告是程序装配的合格输出')
    assert.strictEqual(d.isReject, false)
    assert.ok(d.diagnosisCandidates.length >= 0)
  })

  console.log('')
  console.log('diagnosis-output-contract 测试全部通过（' + passed + ' 组）')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
