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

const localStore = {}
const calls = []

// 每个用例自己设置：预检返回什么、完整诊断成功还是失败、是否人为延迟
let featureResponse = null
let fullMode = 'ok'
let fullDelayMs = 0

const FULL_REPORT = {
  observations: '背部可见渗出与潮湿',
  primaryDiagnosis: '皮肤癣菌病（犬猫）',
  primaryDiagnosisProbability: 72,
  diagnosisCandidates: [{ name: '皮肤癣菌病（犬猫）', probability: 72, reason: '形态吻合' }],
  lesionNameCn: '环形脱毛斑',
  confidence: 72,
  explanation: '需要真菌检查确认',
  possibleMeaning: '存在感染可能',
  homeCare: '隔离并保持环境清洁',
  whenToWatch: '观察是否扩散',
  whenToSeeVet: '扩散或家人出现皮损时就医',
  careSuggestion: '避免自行用药',
  vetWarning: '建议进行真菌培养',
  urgency: 'moderate',
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

  console.log('fast path integration tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
