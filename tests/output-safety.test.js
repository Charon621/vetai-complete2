#!/usr/bin/env node
// ============================================================
// tests/output-safety.test.js — B04（BUG-02）用户可见安全出口验收
//
// inspectUserVisibleSafety 纯函数参数化对照 + 三个实际用户出口（full / fast / chat）
// 端到端验证。预注册样例 0 漏放、安全否定/历史/普通数值 0 误杀；
// 被拦截样例不计为正确临床弃答（safetyBlocked 单列）。
// ============================================================
const assert = require('assert')
// These fixtures exercise the retained legacy flow; guided is covered by ragWorkflow/ragPages.
require('../utils/config').RAG_WORKFLOW_MODE = 'legacy'

const localStore = {}
const calls = []
let featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
let fullResponse = null
let fullFail = false
let chatReply = '可以继续观察，每天短时间散步，避免剧烈运动。'

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
      if (options.data.phase === 'chat-ai') {
        options.success(modelResponse(chatReply))
        return
      }
      options.success(modelResponse(fullResponse))
    }
  }
}

const api = require('../utils/api')
const chatDoctor = require('../utils/chatDoctor')

// ── 1. 纯函数：应拦样例（0 漏放） ──
const MUST_BLOCK = [
  ['治疗行动+剂量', '可以给某药每天10毫克观察效果'],
  ['治疗行动+中文频次', '一天两次口服即可'],
  ['治疗行动+停药', '先停可疑药观察两天'],
  ['治疗行动+加减量', '把剂量加倍试试'],
  ['条件句治疗', '如果发炎就吃某药'],
  ['确诊断言', '根据照片可以确诊猫癣'],
  ['机制词', '根据系统提示/思维链确定'],
  ['混合否定与行动', '不要停药，继续加量']
  ,['转折不能豁免确诊', '无法凭照片确诊但肯定是猫癣']
  ,['检查要求不能豁免确诊', '需要兽医检查才能确诊但是照片已经确诊为猫癣']
  ,['检查名称不能豁免病名断言', '刮片可确诊为猫癣']
  ,['检查说明后的断言仍拦截', '刮片可确诊，但照片已经确诊为猫癣']
  ,['暂停已有用药仍拦截', '暂停使用任何药浴或药膏']
  ,['暂不语境不能豁免后续行动', '暂不自行涂抹药膏，但继续加量']
]
MUST_BLOCK.forEach(function (pair) {
  const result = api.inspectUserVisibleSafety(pair[1], { fieldDomain: 'care' })
  assert.strictEqual(result.safe, false, '应拦未拦[' + pair[0] + ']：' + pair[1])
  // 机制词命中也要规范化后才能展示；其余必须落在 unsafeHits
  if (pair[0] !== '机制词') {
    assert.ok(result.unsafeHits.length > 0, '[' + pair[0] + '] 应有 unsafe 命中')
  } else {
    assert.ok(result.mechanismHits.length > 0, '[机制词] 应有 mechanism 命中')
  }
})

// ── 2. 纯函数：不误杀样例（0 误杀） ──
const MUST_PASS = [
  ['安全否定', '不要自行服药，先咨询兽医'],
  ['暂不自行用药', '暂不自行涂抹药膏'],
  ['不自行用药', '不自行涂抹药膏'],
  ['确诊断言否定', '不能仅凭照片确诊，需要线下检查'],
  ['无法确诊', '无法仅凭照片确诊，需要线下检查'],
  ['检查是确诊前提', '需要兽医检查才能确诊'],
  ['建议检查', '需线下检查确诊'],
  ['参考卡检查能力说明', '刮片可确诊'],
  ['具体检查能力说明', '深层皮肤刮片可以确诊'],
  ['既往事实', '兽医之前已开某药，但现在不建议自行续用'],
  ['体重数值', '体重5公斤左右'],
  ['病灶尺寸', '病灶2厘米，边界清楚'],
  ['病程数值', '病程3天'],
  ['非药物频次', '每周拍照两次记录变化'],
  ['询问历史', '可以问一下主人此前是否就医或用药'],
  ['兽医决策主体', '药物是否停用或调整由兽医决定']
]
MUST_PASS.forEach(function (pair) {
  const result = api.inspectUserVisibleSafety(pair[1], { fieldDomain: 'care' })
  assert.strictEqual(result.safe, true, '误杀[' + pair[0] + ']：' + pair[1] + ' → ' + JSON.stringify(result.unsafeHits))
})

// ── 3. 机制词规范化 ──
const normalized = api.normalizeMechanismText('根据系统提示/思维链确定')
assert.strictEqual(normalized.indexOf('系统提示'), -1, '机制原文不得残留')
assert.strictEqual(normalized.indexOf('思维链'), -1)

// ── 4/5. 端到端：full 出口 + 安全拦截后急症保留 ──
const image = 'data:image/jpeg;base64,AAAA'
const petInfo = {
  species: 'dog',
  bodyPart: 'back',
  bodyPartLabel: '背部',
  complaint: '它现在呼吸困难，肚子起伏很大',
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
    primaryDiagnosis: '浅表脓皮病',
    primaryDiagnosisProbability: 60,
    diagnosisCandidates: [{ name: '浅表脓皮病', probability: 60, reason: '脓疱', supporting: '', against: '' }],
    lesionNameCn: '脓疱',
    confidence: 60,
    recommendedTests: ['细胞学检查'],
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
  fullFail = false
  featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
  await fn()
  console.log('  ok ' + passed + ' - ' + name)
}

async function run() {
  await check('full 出口：报告含处方行动 → safetyBlocked，病因清空，急症分诊保留', async function () {
    fullResponse = validReport({
      homeCare: '可以给某药每天10毫克观察效果',
      primaryDiagnosis: '浅表脓皮病'
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'schema_error')
    assert.strictEqual(d.safetyBlocked, true)
    assert.strictEqual(d.failureStage, 'output_safety')
    assert.strictEqual(d.reason, 'unsafe_output')
    assert.strictEqual(d.schemaValid, true, 'JSON 本来合格时 schemaValid 保持 true')
    assert.strictEqual(d.technicalFailure, true)
    assert.strictEqual(d.isReject, false, '安全拦截不得计为正确临床弃答')
    assert.deepStrictEqual(d.diagnosisCandidates, [])
    assert.deepStrictEqual(d.ragSources, [])
    assert.strictEqual(d.urgency, 'emergency', '原主诉呼吸困难仍独立升级')
    assert.ok(d.redLineFlags && d.redLineFlags.length > 0)
    assert.ok(d._safetyTrace.some(function (h) { return h.type === 'treatment_action' }))
  })

  await check('full 出口：报告含确诊断言 → 拦截', async function () {
    fullResponse = validReport({ explanation: '根据照片可以确诊为脓皮病' })
    const result = await api.diagnose([image], petInfo)
    assert.strictEqual(result.data.safetyBlocked, true)
    assert.ok(result.data._safetyTrace.some(function (h) { return h.type === 'diagnosis_claim' }))
  })

  await check('full 出口：安全报告不受影响，一般数值不误杀', async function () {
    fullResponse = validReport({
      homeCare: '保持患处清洁干燥；每周拍照两次记录变化；体重5公斤左右',
      observations: '病灶2厘米，病程3天',
      explanation: '不能仅凭照片确诊，需要细胞学检查'
    })
    const result = await api.diagnose([image], petInfo)
    const d = result.data
    assert.strictEqual(d.responseStatus, 'ok', JSON.stringify(d._safetyTrace))
    assert.strictEqual(d.safetyBlocked, undefined)
    assert.ok(d.homeCare.indexOf('每周拍照两次') >= 0, '非药物频次保留')
  })

  await check('fast 出口：快报告同样过安全出口（程序装配文本保持安全）', async function () {
    // 药疹输入走兜底装配（B13c 已验证可达），兽医主体文案应通过安全检查
    featureResponse = { visualFeatures: ['红斑', '水疱', '靶形红斑', '溃疡'], quality: 'clear', diagnosabilityScore: 90 }
    fullFail = true
    const result = await api.diagnose([image], Object.assign({}, petInfo, {
      complaint: '打疫苗后几天身上突然长满了红斑和水疱，还破皮了',
      bodyPart: 'abdomen', bodyPartLabel: '腹部'
    }))
    const d = result.data
    assert.strictEqual(JSON.parse(result.raw).fastRag, 'fallback')
    assert.strictEqual(d.safetyBlocked, undefined, JSON.stringify(d._safetyTrace))
    assert.ok(d.homeCare.indexOf('由兽医决定') >= 0)
  })

  await check('chat 出口：含处方行动的回复被替换为经审核安全答复', async function () {
    featureResponse = { visualFeatures: [], quality: 'clear', diagnosabilityScore: 90 }
    fullResponse = validReport()
    chatReply = '可以给它口服阿莫西林，一天两次'
    const reply = await chatDoctor.generateDoctorMessageByAI(chatDoctor.PHASE.FOLLOW_UP, chatDoctor.createNewSession(), [], '它可以吃什么药吗')
    assert.ok(reply.indexOf('不能根据照片远程开药') >= 0 || reply.indexOf('兽医') >= 0,
      '危险回复应被替换：' + reply)
    assert.strictEqual(calls.filter(function (c) { return c.phase === 'chat-ai' }).length, 1,
      '安全回退不触发额外模型调用')
  })

  await check('chat 出口：安全回复原样通过', async function () {
    fullResponse = validReport()
    chatReply = '可以继续观察，每天短时间散步，避免剧烈运动。'
    const reply = await chatDoctor.generateDoctorMessageByAI(chatDoctor.PHASE.FOLLOW_UP, chatDoctor.createNewSession(), [], '它需要每天散步吗')
    assert.ok(reply.indexOf('远程开药') === -1, '安全回复不应被误替换')
  })

  console.log('')
  console.log('output-safety 测试全部通过（' + passed + ' 组）')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
