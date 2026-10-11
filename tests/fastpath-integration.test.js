// ============================================================
// tests/fastpath-integration.test.js
// 快路径编排的端到端测试（2026-10-01 新增）
//
// 门槛纯函数（区分度、高危方向、概率标定）由 tests/api.test.js 覆盖；
// 这里只验证「编排」三条分支，它们此前没有任何自动化覆盖：
//   ① 区分度足够 → 预检侧立即出报告，不等完整诊断；
//   ② 够格但只是险胜（区分度不足）→ 不抢跑，等完整诊断出结论；
//   ③ 险胜病例 + 完整诊断拿不到结果 → 用预检侧那份报告兜底，
//      而不是把一个失败结构丢给已经等了十几秒的用户。
// ============================================================

const assert = require('assert')
// These fixtures exercise the retained legacy flow; guided is covered by ragWorkflow/ragPages.
require('../utils/config').RAG_WORKFLOW_MODE = 'legacy'

const localStore = {}
const calls = []

// 每个用例自己设置：预检返回什么、完整诊断成功还是失败、是否人为延迟
let featureResponse = null
let fullMode = 'ok'
let fullDelayMs = 0

// B03：完整诊断 mock 必须满足 v2 输出契约（schema 校验不过会走 schema_error 出口）
const FULL_REPORT = {
  imageFindings: [{ imageIndex: 1, role: 'overview', observation: '背部渗出潮湿', quality: 'clear', usable: true }],
  observations: '背部可见渗出与潮湿',
  evidenceFor: ['圆形脱毛区域渗出'],
  evidenceAgainst: ['未见明显脓疱'],
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
  whenToSeeVet: '扩散或家人出现皮损时就医',
  careSuggestion: '避免自行用药',
  vetWarning: '建议进行真菌培养',
  diagnosisProbabilityNote: '匹配分说明',
  ragSources: []
}

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
      const respond = function () {
        if (fullMode === 'fail') {
          options.fail({ errMsg: 'cloud.callFunction:fail timeout' })
          return
        }
        options.success(modelResponse(FULL_REPORT))
      }
      if (fullDelayMs > 0) {
        // 人为延迟，用来证明抢跑病例确实没有在等完整诊断；
        // unref 保证残留定时器不会拖住测试进程。
        const timer = setTimeout(respond, fullDelayMs)
        if (timer.unref) timer.unref()
        return
      }
      respond()
    }
  }
}

const api = require('../utils/api')

// 埋点写进本机空间的 key（_analytics_events_<scope>），key 名随存储实现变化，
// 所以按前缀找而不是硬编码。
function eventsFor(name) {
  const key = Object.keys(localStore).filter(function (k) {
    return k.indexOf('_analytics_events') === 0
  })[0]
  const list = (key && localStore[key]) || []
  return list.filter(function (entry) { return entry.event === name })
}

function clearEvents() {
  Object.keys(localStore).forEach(function (key) {
    if (key.indexOf('_analytics_events') === 0) localStore[key] = []
  })
}

async function run() {
  const image = 'data:image/jpeg;base64,AAAA'

  // ---------- ① 区分度足够：立即出报告 ----------
  // 猫面部圆形脱毛/鳞屑/断毛/结痂 → 猫癣 23.6，区分度 2（预检词都不在 Top2/Top3 词表里）
  clearEvents()
  calls.length = 0
  featureResponse = {
    visualFeatures: ['圆形脱毛', '鳞屑', '断毛', '结痂'],
    bodyPartGuess: '面部',
    lesionPattern: '环形',
    lesionShape: '圆形',
    shortObservation: '面部圆形脱毛，伴鳞屑、断毛和结痂',
    quality: 'clear',
    diagnosabilityScore: 92
  }
  fullMode = 'ok'
  fullDelayMs = 1500

  const fastPetInfo = {
    species: 'cat',
    bodyPart: 'head',
    bodyPartLabel: '面部',
    complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  }

  const startedAt = Date.now()
  let result = await api.diagnose([image], fastPetInfo)
  const elapsed = Date.now() - startedAt

  assert.strictEqual(result.success, true, 'eager 病例应当成功返回')
  assert.strictEqual(result.data._fastRag, true,
    '区分度足够的病例应当交付知识库快路径报告（_fastRag 标记）')
  assert.ok(elapsed < 1000,
    'eager 病例不得等待完整诊断（实测 ' + elapsed + 'ms，完整诊断被人为延迟 1500ms）')
  assert.deepStrictEqual(calls.map(function (call) { return call.phase }),
    ['vision-precheck', 'full-diagnosis'],
    '快路径抢跑不应取消并行发出的完整诊断')
  assert.ok(result.data.ragSources.length > 0, '快路径报告必须带知识库来源')
  assert.strictEqual(result.data.ragTitle, '临床特征匹配', '快路径报告标题与其他报告区分开')
  const fastRaw = JSON.parse(result.raw)
  assert.strictEqual(fastRaw.fastRag, true, 'raw 应标记本次走了快路径')
  assert.ok(fastRaw.discriminative >= 2, 'raw 应记录区分度，供线上回收标定')
  assert.strictEqual(eventsFor('visionRag').filter(function (e) { return e.data.hit === true }).length, 1,
    '抢跑应产生一条 visionRag{hit:true} 埋点')

  // 后面的用例：清掉上面那个还在飞的完整诊断响应
  fullDelayMs = 0

  // ---------- ② 险胜：不抢跑，等完整诊断 ----------
  // 犬背部渗出/潮湿/糜烂 → 急性湿性皮炎（热点）14.9，区分度 1（Top2/Top3 也带这些词）
  clearEvents()
  calls.length = 0
  featureResponse = {
    visualFeatures: ['渗出', '潮湿', '糜烂'],
    bodyPartGuess: '背部',
    lesionPattern: '',
    lesionShape: '',
    shortObservation: '背部潮湿渗出',
    quality: 'clear',
    diagnosabilityScore: 90
  }
  fullMode = 'ok'

  result = await api.diagnose([image], {
    species: 'dog',
    bodyPart: 'back',
    bodyPartLabel: '背部',
    complaint: '背上湿湿的，掉毛',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  })

  assert.strictEqual(result.success, true, '险胜病例仍应由完整诊断给出结论')
  assert.notStrictEqual(result.data._fastRag, true,
    '区分度不足的病例不得抢跑（应等完整诊断）')
  // 完整诊断路径会把诊断名按物种显示（displayDiagnosisForSpecies）：
  // '皮肤癣菌病（犬猫）' 在犬身上显示为 '犬癣'，这正是完整诊断侧的独有行为，
  // 快路径只会给知识卡显示名（此处是 '急性湿性皮炎（热点）'）。
  assert.strictEqual(result.data.primaryDiagnosis, '犬癣',
    '险胜病例的结论应来自完整诊断，而不是预检侧的候选')
  const deferredEvents = eventsFor('visionRag').filter(function (e) { return e.data.hit === false })
  assert.strictEqual(deferredEvents.length, 1, '被推迟的病例应产生 visionRag{hit:false} 埋点')
  assert.strictEqual(deferredEvents[0].data.reason, 'borderline_defer',
    '推迟原因应可区分于「完全没命中」')
  assert.strictEqual(eventsFor('fastRagDeferred').length, 1,
    '推迟病例落地后应记录完整诊断与预检结论是否一致')

  // ---------- ③ 险胜 + 完整诊断失败：用预检报告兜底 ----------
  clearEvents()
  calls.length = 0
  fullMode = 'fail'

  result = await api.diagnose([image], {
    species: 'dog',
    bodyPart: 'back',
    bodyPartLabel: '背部',
    complaint: '背上湿湿的，掉毛',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  })

  assert.strictEqual(result.success, true,
    '完整诊断失败时，用户仍应拿到预检侧那份已算好的知识库报告')
  assert.strictEqual(result.data._fastRag, true, '兜底交付的应是快路径报告')
  assert.strictEqual(result.data.ragTitle, '临床特征匹配', '兜底报告标题与快路径一致')
  assert.strictEqual(JSON.parse(result.raw).fastRag, 'fallback',
    'raw 应标记这是兜底交付，便于线上区分抢跑与兜底')
  const fallbackEvents = eventsFor('fastRagFallback')
  assert.strictEqual(fallbackEvents.length, 1, '兜底应产生 fastRagFallback 埋点')
  assert.ok(fallbackEvents[0].data.reason === 'full_diagnosis_error' ||
            fallbackEvents[0].data.reason === 'full_diagnosis_unavailable',
    '兜底原因应记录完整诊断为何拿不到结果')


  // ---------- ④ B13c（BUG-27）：药疹卡的护理主体 —— 装配与兜底两个可达出口 ----------
  // 药疹属 urgent/autoimmune 高危方向，永不抢跑（KEEP-08）；其 homeCareSafe 只会经
  // 快报告装配进入用户视野：full 失败时由 deferred 兜底交付。两个断言分别覆盖：
  //   ④a full 失败 → 兜底交付的报告必须是兽医主体文案，无自行停药指令；
  //   ④b full 成功 → 高危卡不得抢跑（不交付快报告），交付的完整报告同样不得泄漏旧文案。
  calls.length = 0
  clearEvents()
  featureResponse = {
    visualFeatures: ['红斑', '水疱', '靶形红斑', '溃疡'],
    bodyPartGuess: '腹部',
    lesionPattern: '多发',
    lesionShape: '斑点',
    shortObservation: '躯干多发红斑水疱，部分破皮',
    quality: 'clear',
    diagnosabilityScore: 90
  }
  const drugPetInfo = {
    species: 'dog',
    bodyPart: 'abdomen',
    bodyPartLabel: '腹部',
    complaint: '打疫苗后几天身上突然长满了红斑和水疱，还破皮了',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  }

  // ④a full 失败 → deferred 兜底交付快装配报告
  fullMode = 'fail'
  fullDelayMs = 0
  result = await api.diagnose([image], drugPetInfo)
  assert.strictEqual(result.success, true, '药疹病例 full 失败时仍应兜底交付')
  assert.strictEqual(JSON.parse(result.raw).fastRag, 'fallback', '药疹病例应走兜底出口')
  assert.strictEqual(result.data._ragMatchName, '药疹/多形性红斑',
    'mock 输入应让药疹卡成为兜底报告的主名（否则本用例不可达）')
  assert.ok(result.data.homeCare.indexOf('立即联系开药兽医') >= 0 &&
            result.data.homeCare.indexOf('由兽医决定') >= 0,
    '兜底出口的药疹护理必须由兽医决定停药/调药：' + result.data.homeCare)
  assert.strictEqual(result.data.homeCare.indexOf('先停用'), -1,
    '兜底出口不得出现主人自行停药指令')

  fullMode = 'ok'
  fullDelayMs = 0
  clearEvents()
  calls.length = 0
  // ④b full 成功 → 高危卡不抢跑，完整报告交付，同样无旧文案泄漏
  fullMode = 'ok'
  result = await api.diagnose([image], drugPetInfo)
  assert.strictEqual(result.success, true)
  assert.notStrictEqual(result.data._fastRag, true,
    '药疹属高危方向，即使强命中也不得抢跑交付快报告（KEEP-08）')
  assert.strictEqual(result.data.homeCare.indexOf('先停用'), -1,
    '完整出口不得出现自行停药指令')
  assert.strictEqual(eventsFor('visionRag').filter(function (e) {
    return e.data.hit === false && e.data.highRisk === true && e.data.topName === '药疹/多形性红斑'
  }).length, 1, '高危缓发应如实埋点（hit=false + highRisk=true）')


  // ---------- ⑤ B11（BUG-23）：鉴别原文保真 —— 快报告不得丢安全/检查句 ----------
  // 睑炎卡旧派生只送第一条鉴别，丢掉「眼部疼痛或角膜风险需要线下检查」；
  // 修复后检索结果 ddx=原文，快报告 explanation 的鉴别要点必须含该句。
  calls.length = 0
  clearEvents()
  featureResponse = {
    visualFeatures: ['眼睑红肿', '眼周结痂'],
    bodyPartGuess: '眼周',
    lesionPattern: '局灶',
    lesionShape: '不规则',
    shortObservation: '眼睑边缘红肿结痂',
    quality: 'clear',
    diagnosabilityScore: 90
  }
  fullMode = 'fail'
  fullDelayMs = 0
  result = await api.diagnose([image], {
    species: 'dog',
    bodyPart: 'eye',
    bodyPartLabel: '眼周',
    complaint: '眼皮红肿结痂，一直眯着眼流泪',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  })
  assert.strictEqual(result.success, true, '睑炎病例应兜底交付')
  assert.strictEqual(result.data._ragMatchName, '睑炎',
    'mock 输入应让睑炎成为主名（否则本用例不可达）')
  assert.ok(result.data.explanation.indexOf('眼部疼痛或角膜风险') >= 0,
    '快报告的鉴别要点必须含此前被丢弃的眼部疼痛安全句：' + result.data.explanation)

  fullMode = 'ok'
  fullDelayMs = 0

  // ---------- ⑥ 门槛未过：逐关埋点 ----------
  // 预检只给泛词（红斑/瘙痒类），快路径不可能够格；埋点须记下具体卡在哪一关，
  // 而不是笼统的 strong_gate_failed，否则线上无法区分预检问题与知识卡区分度问题。
  calls.length = 0
  clearEvents()
  featureResponse = {
    visualFeatures: ['红斑'],
    bodyPartGuess: '腹部',
    lesionPattern: '',
    lesionShape: '',
    shortObservation: '腹部皮肤发红',
    quality: 'clear',
    diagnosabilityScore: 80
  }
  result = await api.diagnose([image], {
    species: 'dog',
    bodyPart: 'abdomen',
    bodyPartLabel: '腹部',
    complaint: '肚子红',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  })
  assert.strictEqual(result.success, true, '门槛未过的病例由完整诊断交付')
  assert.notStrictEqual(result.data._fastRag, true, '门槛未过不得走快路径')
  // mock 里预检同步先回，因此结局必然是 gate_failed，而不是 precheck_late
  const gateEvents = eventsFor('visionRag')
  assert.strictEqual(gateEvents.length, 1, '门槛未过应产生且只产生一条 visionRag 埋点')
  assert.strictEqual(gateEvents[0].data.reason, 'gate_failed', '结局应为门槛未过：' + JSON.stringify(gateEvents[0].data))
  assert.ok(gateEvents[0].data.gate, 'gate_failed 必须带首个失败关卡')
  assert.ok(Array.isArray(gateEvents[0].data.failedGates) && gateEvents[0].data.failedGates.length > 0,
    'gate_failed 必须带全部失败关卡')
  assert.strictEqual(gateEvents[0].data.failedGates[0], gateEvents[0].data.gate, '首个失败关卡与列表首项一致')
  assert.strictEqual(typeof gateEvents[0].data.precheckMs, 'number', '埋点须带预检耗时')

  // ---------- ⑦ 导出汇总：按结局与关卡聚合 ----------
  const analytics = require('../utils/analytics')
  const rag = analytics.summarizeVisionRag([
    { event: 'visionRag', data: { hit: true, precheckMs: 3000 } },
    { event: 'visionRag', data: { hit: false, reason: 'gate_failed', gate: 'precheck_hits', failedGates: ['precheck_hits', 'discriminative'], precheckMs: 4000 } },
    { event: 'visionRag', data: { hit: false, reason: 'gate_failed', gate: 'gap', failedGates: ['gap', 'discriminative'], precheckMs: 5000 } },
    { event: 'visionRag', data: { hit: false, reason: 'borderline_defer' } },
    { event: 'submit', data: {} }
  ])
  assert.strictEqual(rag.total, 4, '只统计 visionRag 事件')
  assert.strictEqual(rag.hit, 1)
  assert.deepStrictEqual(rag.byReason, { hit: 1, gate_failed: 2, borderline_defer: 1 })
  assert.deepStrictEqual(rag.gateFirst, { precheck_hits: 1, gap: 1 })
  assert.deepStrictEqual(rag.gateAny, { precheck_hits: 1, discriminative: 2, gap: 1 })
  assert.deepStrictEqual(rag.precheckMs, { count: 3, p50: 4000, p90: 4000 })
  assert.strictEqual(analytics.summarizeVisionRag(null).total, 0, '空输入安全')

  console.log('fast path integration tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
