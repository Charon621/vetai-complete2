const assert = require('assert')
const local = {}
global.wx = { getStorageSync: k => local[k] || [], setStorageSync: (k, v) => { local[k] = v } }
const api = require('../utils/api'), kb = require('../utils/kb')
const analytics = require('../utils/analytics'), perf = require('../utils/modelPerformance')

// 压缩不允许丢失逐条结论、物种范围过滤、限制、审核身份或精确来源定位。
for (const scenario of require('../evaluation/datasets/report_performance_scenarios.json').cases) {
  const query = scenario.query
  const hits = kb.search(query).filter(kb.isPromptWorthyResult)
  const prompt = api.buildDebugPrompt(query, []).userPrompt
  const start = prompt.indexOf('=== 临床参考核对清单')
  if (scenario.expected === 'no_references') { assert.strictEqual(start, -1, scenario.id); continue }
  assert(start >= 0, scenario.id)
  const context = JSON.parse(prompt.slice(start).split('\n')[1])
  assert.strictEqual(context.cards.length, hits.length)
  context.cards.forEach((card, i) => {
    assert.strictEqual(card.typicalFeatures, hits[i].typicalFeatures)
    assert.strictEqual(card.differentiators, hits[i].ddx)
    assert.deepStrictEqual(card.evidence.map(e => ({ ...e, sources: e.sourceRefs.map(n => context.sources[n]), sourceRefs: undefined })),
      hits[i].evidenceBindings.map(e => ({ claimId: e.claimId, status: e.status, statement: e.statement,
        conditions: e.conditions, limitation: e.limitation, sources: e.sources, reviewRole: e.review.role, sourceRefs: undefined })))
  })
  if (scenario.expected === 'bound_references') assert(context.cards.some(c => c.evidence.length), '样例必须实际覆盖有台账的参考卡')
}

// 缺 usage 不是消耗 0；有 reasoning=0 时也必须保留。
const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: '禁止进入统计的病例内容' },
  { type: 'image_url', image_url: { url: 'private-photo' } }] }], max_completion_tokens: 6144, thinking_budget: 2048 }
perf.record('full-diagnosis', payload, { usage: { prompt_tokens: 600, completion_tokens: 1400,
  completion_tokens_details: { reasoning_tokens: 400 } }, choices: [{ finish_reason: 'length' }] }, 3200, 'ok', api.PROMPT_VERSION)
perf.record('full-diagnosis', payload, { usage: { prompt_tokens: 0, completion_tokens: 0,
  completion_tokens_details: { reasoning_tokens: 0 } } }, 100, 'ok', api.PROMPT_VERSION)
perf.record('full-diagnosis', payload, null, 5000, 'network_error', api.PROMPT_VERSION)
const samples = analytics.getSamples('modelPerformance')
assert.strictEqual(samples[0].data.answerTokens, 1000)
assert.strictEqual(samples[1].data.reasoningTokens, 0)
assert.strictEqual(samples[2].data.outputTokens, null)
assert(!JSON.stringify(samples).includes('禁止进入统计'))
assert(!JSON.stringify(samples).includes('private-photo'))
const summary = Object.values(perf.summarize(samples).groups)[0]
assert.deepStrictEqual(summary, { calls: 3, failures: 1, truncated: 1, usageSamples: 2,
  inputTokens: 600, outputTokens: 1400, reasoningTokens: 400, reasoningSamples: 2, p50Ms: 3200, p95Ms: 5000 })

// provider 宣告截断，即便 JSON 完整也不能伪装为正常报告；红线仍保留。
const report = {
  imageFindings: [{ imageIndex: 1, role: 'unspecified', observation: '局部脱毛', quality: 'clear', usable: true }],
  observations: '局部脱毛', evidenceFor: ['圆形脱毛', '断毛'], evidenceAgainst: [], missingInformation: [],
  abstainReason: '', diagnosisCandidates: [{ name: '皮肤癣菌病', probability: 50, reason: '形态支持', supporting: '断毛', against: '待检查' }],
  primaryDiagnosis: '皮肤癣菌病', primaryDiagnosisProbability: 50, confidence: 50, lesionNameCn: '脱毛斑',
  recommendedTests: ['真菌检查'], urgencyEvidence: [], urgency: 'moderate', explanation: '待线下检查',
  possibleMeaning: '局部皮肤问题', homeCare: '避免抓挠', whenToWatch: '观察变化', whenToSeeVet: '扩散时就医', diagnosisProbabilityNote: ''
}
let finish = 'length'
global.wx.cloud = { callFunction(options) {
  assert.strictEqual(options.data.payload.max_completion_tokens, 6144)
  assert.strictEqual(options.data.payload.thinking_budget, 2048)
  options.success({ result: { success: true, data: { choices: [{ finish_reason: finish, message: { content: JSON.stringify(report) } }] } } })
} }
async function run() {
  const pet = { species: '犬', useKnowledgeBase: false, complaint: '现在呼吸困难' }
  const truncated = await api.diagnose(['data:image/jpeg;base64,AAAA'], pet)
  assert.strictEqual(truncated.data.responseStatus, 'schema_error')
  assert.strictEqual(truncated.data.technicalFailure, true)
  assert.deepStrictEqual(truncated.data.diagnosisCandidates, [])
  assert.deepStrictEqual(truncated.data.ragSources, [])
  assert.strictEqual(truncated.data.urgency, 'emergency')
  finish = 'stop'
  const complete = await api.diagnose(['data:image/jpeg;base64,AAAA'], pet)
  assert.strictEqual(complete.data.responseStatus, 'ok')
  assert(complete.data.diagnosisProbabilityNote.includes('未经临床校准'), '固定说明必须由程序补回')
  // 云函数永不回调也要留下超时样本；之后的迟到响应不得重复计数。
  const originalSet = global.setTimeout, originalClear = global.clearTimeout
  let timeout, pending
  const beforeTimeout = analytics.getSamples('modelPerformance').length
  global.setTimeout = callback => { timeout = callback; return 1 }
  global.clearTimeout = () => {}
  global.wx.cloud.callFunction = options => { pending = options }
  try {
    const promise = api.diagnose(['data:image/jpeg;base64,AAAA'], pet)
    timeout()
    const result = await promise
    assert.strictEqual(result.success, false)
    assert.strictEqual(analytics.getSamples('modelPerformance').length, beforeTimeout + 1)
    assert.strictEqual(analytics.getSamples('modelPerformance').slice(-1)[0].data.status, 'timeout')
    pending.success({ result: { success: true, data: { choices: [{ message: { content: JSON.stringify(report) } }] } } })
    assert.strictEqual(analytics.getSamples('modelPerformance').length, beforeTimeout + 1)
  } finally {
    global.setTimeout = originalSet; global.clearTimeout = originalClear
  }
  console.log('report performance contracts passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
