// ============================================================
// tests/cloud-function.test.js
// cloudfunctions/diagnose/index.js 单元测试（不发真实网络请求）：
//   - sanitizePayload 各校验分支（通过 exports.main 传非法 event）
//   - 校验错误白名单原样返回；非白名单异常回通用文案
//   - 模型错误脱敏（500 detail 不透传客户端）
//   - burst 限流（同 openId 60s 内第 21 次被拒）
//   - 每日配额超限拒绝
//   - prompt 版本白名单
//   - requestId 幂等缓存（第二次不再调模型）
//   - QWEN_API_KEY / OPENID 缺失
// mock 方案：
//   - wx-server-sdk：require 云函数前，用 require.resolve 指向
//     cloudfunctions/diagnose/node_modules 下的解析路径，向 require.cache
//     注入假模块（init 空操作 / getWXContext 可控 OPENID / database 可控计数）
//   - https：内建模块无法走 require.cache，直接替换 https.request，
//     返回 EventEmitter 假 req/res，可控 statusCode/body/网络错误并计数
// 直接 node tests/cloud-function.test.js 执行，无测试框架
// ============================================================

const assert = require('assert')
const path = require('path')
const https = require('https')
const EventEmitter = require('events')
process.env.QWEN_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
// Stale model overrides must not prevent the requested Flash model.
process.env.QWEN_FAST_MODELS = 'qwen3.6-flash'
process.env.QWEN_FULL_MODELS = 'qwen3.8-max'

// ---------- 环境变量 ----------
process.env.QWEN_API_KEY = 'test-api-key'

// ---------- mock wx-server-sdk（必须在 require 云函数之前注入） ----------
const cfDir = path.join(__dirname, '..', 'cloudfunctions', 'diagnose')
const sdkPath = require.resolve('wx-server-sdk', { paths: [cfDir] })

let currentOpenId = 'openid-default'
let dailyCount = 1 // 可控的当日配额计数

const fakeDb = {
  createCollection: function () { return Promise.resolve() },
  command: { inc: function (n) { return { __inc: n } } },
  collection: function () {
    return {
      doc: function () {
        return {
          update: function () { return Promise.resolve() },
          set: function () { return Promise.resolve() },
          get: function () { return Promise.resolve({ data: { count: dailyCount } }) }
        }
      }
    }
  }
}

require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: {
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    init: function () {},
    getWXContext: function () { return { OPENID: currentOpenId } },
    database: function () { return fakeDb }
  }
}

// ---------- mock https.request（内建模块直接替换属性） ----------
let httpsCallCount = 0
let lastPayload = null
let lastRequestOptions = null
let httpsShouldError = false
let nextStatusCode = 200
let nextBody = JSON.stringify({ choices: [{ message: { content: 'ok' } }] })

https.request = function (options, callback) {
  httpsCallCount++
  lastRequestOptions = options
  const req = new EventEmitter()
  req.write = function (body) { lastPayload = JSON.parse(body) }
  req.destroy = function () {}
  req.end = function () {
    process.nextTick(function () {
      if (httpsShouldError) {
        req.emit('error', new Error('socket hang up (mock)'))
        return
      }
      const res = new EventEmitter()
      res.statusCode = nextStatusCode
      res.setEncoding = function () {}
      callback(res)
      res.emit('data', nextBody)
      res.emit('end')
    })
  }
  return req
}

const cloudFn = require('../cloudfunctions/diagnose/index.js')

const PHASE_FAST = 'chat-ai'          // models: qwen3.8-flash/qwen3.8-flash, maxImages 0
const PHASE_VISION = 'vision-precheck' // model: qwen3.8-flash, maxImages 2

function validEvent(extra) {
  return Object.assign({
    phase: PHASE_FAST,
    payload: {
      model: 'qwen3.8-flash',
      messages: [{ role: 'user', content: '你好' }]
    }
  }, extra || {})
}

async function run() {
  // ============================================================
  // 环境与身份
  // ============================================================
  delete process.env.QWEN_API_KEY
  let res = await cloudFn.main(validEvent())
  assert.strictEqual(res.success, false)
  assert.strictEqual(res.error, '云函数环境变量 QWEN_API_KEY 未配置', 'missing api key message')
  process.env.QWEN_API_KEY = 'test-api-key'

  currentOpenId = ''
  res = await cloudFn.main(validEvent())
  assert.strictEqual(res.error, '无法验证调用者身份', 'missing openid rejected')

  // ============================================================
  // sanitizePayload 各校验分支（白名单错误必须原样返回）
  // ============================================================
  currentOpenId = 'sanitize-user'

  res = await cloudFn.main({ phase: 'unknown-phase', payload: {} })
  assert.strictEqual(res.error, '不支持的请求阶段', 'unsupported phase')

  res = await cloudFn.main({ phase: PHASE_FAST, payload: null })
  assert.strictEqual(res.error, '请求参数不完整', 'missing payload')

  res = await cloudFn.main({ phase: PHASE_FAST, payload: { model: 'qwen3.8-flash', messages: [] } })
  assert.strictEqual(res.error, '请求参数不完整', 'empty messages')

  res = await cloudFn.main({
    phase: PHASE_FAST,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'user', content: 'x'.repeat(3400000) }] }
  })
  assert.strictEqual(res.error, '请求体过大', 'oversized event body')

  res = await cloudFn.main({
    phase: PHASE_FAST,
    payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
  })
  assert.strictEqual(res.error, '模型不在允许列表', 'model allowlist enforced')

  res = await cloudFn.main({
    phase: PHASE_FAST,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'hacker', content: 'hi' }] }
  })
  assert.strictEqual(res.error, '消息角色不合法', 'illegal role')

  res = await cloudFn.main({
    phase: PHASE_FAST,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'user', content: 'x'.repeat(30001) }] }
  })
  assert.strictEqual(res.error, '文本内容过长', 'text too long (string content)')

  const nineItems = []
  for (let i = 0; i < 9; i++) nineItems.push({ type: 'text', text: 'a' })
  res = await cloudFn.main({
    phase: PHASE_VISION,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'user', content: nineItems }] }
  })
  assert.strictEqual(res.error, '消息内容格式不合法', 'content array > 8 items')

  res = await cloudFn.main({
    phase: PHASE_VISION,
    payload: {
      model: 'qwen3.8-flash',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.com/a.jpg' } }] }]
    }
  })
  assert.strictEqual(res.error, '只允许内嵌的 JPEG/PNG/WebP 图片', 'external image url rejected')

  const imgItem = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }
  res = await cloudFn.main({
    phase: PHASE_VISION,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'user', content: [imgItem, imgItem, imgItem] }] }
  })
  assert.strictEqual(res.error, '图片数量超限', 'image count over phase limit')

  res = await cloudFn.main({
    phase: PHASE_VISION,
    payload: { model: 'qwen3.8-flash', messages: [{ role: 'user', content: [{ type: 'video' }] }] }
  })
  assert.strictEqual(res.error, '不支持的消息内容类型', 'unsupported content type')

  assert.strictEqual(httpsCallCount, 0, 'validation failures must never reach the model')

  // 新完整报告模型必须通过服务器白名单，图片和 JSON 约束仍保留。
  currentOpenId = 'new-report-model-user'
  res = await cloudFn.main({
    phase: 'full-diagnosis',
    payload: {
      model: 'qwen3.8-flash',
      messages: [{ role: 'user', content: [imgItem, imgItem] }],
      enable_thinking: false,
      reasoning_effort: 'max',
      max_tokens: 100000
    }
  })
  assert.strictEqual(res.success, true, 'Qwen Flash report model accepted with images')
  assert.strictEqual(lastPayload.model, 'qwen3.8-flash', 'report model forwarded unchanged')
  assert.deepStrictEqual(lastPayload.messages[1].content, [imgItem, imgItem], 'both report images forwarded')
  assert.deepStrictEqual(lastPayload.response_format, { type: 'json_object' }, 'report JSON mode retained')
  assert.strictEqual(lastPayload.enable_thinking, true, 'server report thinking enabled')
  assert.strictEqual(lastPayload.thinking_budget, 2048, 'server defaults to an explicit thinking budget')
  assert.ok(!('reasoning_effort' in lastPayload), 'server must not send conflicting budget and effort')
  assert.strictEqual(lastPayload.max_completion_tokens, 6144, 'old client receives default combined budget')
  assert.ok(!('max_tokens' in lastPayload), 'full report must use combined budget')
  assert.strictEqual(lastRequestOptions.hostname, 'dashscope.aliyuncs.com', 'Alibaba host')
  assert.strictEqual(lastRequestOptions.path, '/compatible-mode/v1/chat/completions', 'Alibaba endpoint')
  assert.strictEqual(lastRequestOptions.headers.Authorization, 'Bearer test-api-key', 'new server credential used')
  assert.ok(!('thinking' in lastPayload), 'no DeepSeek-only thinking parameter')
  // 同时传入旧参数、异常档位和超大预算也不能绕过服务器限额。
  for (const [total, thinking, expectedTotal, expectedThinking] of [
    [999999, 999999, 8192, 4096], [1, 999999, 3072, 1024], [6144, 2048, 6144, 2048],
    ['invalid', -1, 6144, 2048], [4096.9, 512.8, 4096, 512]
  ]) {
    currentOpenId = 'budget-' + String(total)
    const event = validEvent({ phase: 'full-diagnosis' })
    Object.assign(event.payload, { max_tokens: 999999, max_completion_tokens: total, thinking_budget: thinking, reasoning_effort: 'xhigh' })
    const result = await cloudFn.main(event)
    assert.strictEqual(result.success, true)
    assert.strictEqual(lastPayload.max_completion_tokens, expectedTotal)
    assert.strictEqual(lastPayload.thinking_budget, expectedThinking)
    assert.ok(!('max_tokens' in lastPayload) && !('reasoning_effort' in lastPayload))
  }
  for (const phase of ['vision-precheck', 'chat-ai']) {
    currentOpenId = 'thinking-policy-' + phase
    const event = validEvent({ phase })
    event.payload.enable_thinking = true
    event.payload.reasoning_effort = 'max'
    const result = await cloudFn.main(event)
    assert.strictEqual(result.success, true)
    assert.strictEqual(lastPayload.enable_thinking, false, phase + ' thinking forced disabled')
    assert.ok(!('reasoning_effort' in lastPayload), phase + ' does not carry an effort')
  }

  // ============================================================
  // 非白名单异常 -> 通用文案（不泄露内部错误）
  // ============================================================
  currentOpenId = 'network-error-user'
  httpsShouldError = true
  res = await cloudFn.main(validEvent())
  assert.strictEqual(res.success, false)
  assert.strictEqual(res.error, '诊断服务暂时不可用，请稍后重试', 'non-whitelisted error uses generic message')
  assert.ok(JSON.stringify(res).indexOf('socket hang up') < 0, 'internal error detail must not leak')
  httpsShouldError = false

  // ============================================================
  // 模型错误脱敏：500 + error detail 只回通用文案
  // ============================================================
  currentOpenId = 'model-error-user'
  nextStatusCode = 500
  nextBody = JSON.stringify({ error: { message: 'secret upstream detail', code: 'InternalError.SECRET' } })
  res = await cloudFn.main(validEvent())
  assert.strictEqual(res.success, false)
  assert.strictEqual(res.statusCode, 500, 'status code surfaced for retry strategy')
  assert.strictEqual(res.error, '模型服务暂时不可用，请稍后重试', 'model error uses generic message')
  assert.ok(JSON.stringify(res).indexOf('secret upstream detail') < 0, 'upstream detail must not leak')
  nextStatusCode = 200
  nextBody = JSON.stringify({ choices: [{ message: { content: 'ok' } }] })

  // ============================================================
  // prompt 版本白名单
  // ============================================================
  currentOpenId = 'prompt-version-user'
  res = await cloudFn.main(validEvent({ promptVersion: 'vetai-derm-v0.0.1' }))
  assert.strictEqual(res.error, '客户端提示词版本不受支持，请更新小程序', 'unknown prompt version rejected')

  res = await cloudFn.main(validEvent({ promptVersion: 'vetai-derm-v2.0.0' }))
  assert.strictEqual(res.success, true, 'previous prompt version remains compatible')
  assert.strictEqual(res.promptVersion, 'vetai-derm-v2.1.0', 'server echoes its prompt version')

  res = await cloudFn.main(validEvent({ promptVersion: require('../utils/api').PROMPT_VERSION }))
  assert.strictEqual(res.success, true, 'actual client prompt version accepted')

  currentOpenId = 'rag-observation-version-user'
  res = await cloudFn.main(validEvent({phase:'vision-precheck',promptVersion:'vetai-rag-observation-v1',payload:{model:'qwen3.8-flash',messages:[{role:'user',content:'synthetic'}],max_tokens:9000}}))
  assert.strictEqual(res.success,true,'new observation version accepted')
  assert.strictEqual(lastPayload.max_tokens,1400,'new structured observation has bounded independent budget')
  currentOpenId = 'legacy-observation-version-user'
  res = await cloudFn.main(validEvent({phase:'vision-precheck',payload:{model:'qwen3.8-flash',messages:[{role:'user',content:'synthetic'}],max_tokens:9000}}))
  assert.strictEqual(res.success,true)
  assert.strictEqual(lastPayload.max_tokens,700,'legacy precheck cap preserved')

  // ============================================================
  // 幂等：同 openId+requestId 第二次命中缓存，模型只调一次
  // ============================================================
  currentOpenId = 'idempotent-user'
  const beforeCalls = httpsCallCount
  const first = await cloudFn.main(validEvent({ requestId: 'req-001' }))
  assert.strictEqual(first.success, true, 'first idempotent call succeeds')
  const second = await cloudFn.main(validEvent({ requestId: 'req-001' }))
  assert.strictEqual(second.success, true, 'second idempotent call succeeds')
  assert.strictEqual(httpsCallCount - beforeCalls, 1, 'model called exactly once for same requestId')
  assert.deepStrictEqual(second, first, 'cached response returned verbatim')

  // 不同 requestId 不命中缓存
  await cloudFn.main(validEvent({ requestId: 'req-002' }))
  assert.strictEqual(httpsCallCount - beforeCalls, 2, 'different requestId triggers a new model call')

  // ============================================================
  // burst 限流：同 openId 60s 内第 21 次被拒
  // ============================================================
  currentOpenId = 'burst-user'
  for (let i = 0; i < 20; i++) {
    const r = await cloudFn.main({ phase: 'unknown-phase', payload: {} })
    assert.strictEqual(r.error, '不支持的请求阶段', 'call ' + (i + 1) + ' passes burst gate')
  }
  res = await cloudFn.main({ phase: 'unknown-phase', payload: {} })
  assert.strictEqual(res.error, '请求过于频繁，请稍后再试', '21st call within 60s is burst-limited')

  // 其他 openId 不受影响
  currentOpenId = 'burst-user-b'
  res = await cloudFn.main({ phase: 'unknown-phase', payload: {} })
  assert.strictEqual(res.error, '不支持的请求阶段', 'burst limit is per-openId')

  // ============================================================
  // 每日配额超限
  // ============================================================
  currentOpenId = 'quota-user'
  dailyCount = 61
  res = await cloudFn.main(validEvent())
  assert.strictEqual(res.error, '今日使用次数已达上限，请明天再试', 'daily quota enforced via database count')
  dailyCount = 1

  console.log('cloud function tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
