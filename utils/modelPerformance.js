// 只记录调用计数、版本、耗时和 token；不记录主诉、图片、病名、用户或请求身份。
var analytics = require('./analytics')

function tokenCount(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null
}

function record(phase, payload, response, elapsedMs, status, promptVersion) {
  var usage = response && response.usage || {}
  var details = usage.completion_tokens_details || usage.output_tokens_details || {}
  var output = tokenCount(usage.completion_tokens !== undefined ? usage.completion_tokens : usage.output_tokens)
  var reasoning = tokenCount(details.reasoning_tokens)
  var choice = response && response.choices && response.choices[0]
  var inputChars = 0, imageCount = 0
  ;(payload.messages || []).forEach(function (message) {
    if (typeof message.content === 'string') inputChars += message.content.length
    else if (Array.isArray(message.content)) message.content.forEach(function (item) {
      if (item.type === 'text') inputChars += String(item.text || '').length
      if (item.type === 'image_url') imageCount++
    })
  })
  analytics.trackSample('modelPerformance', {
    schemaVersion: 1, promptVersion: promptVersion,
    releaseId: require('./knowledgeBundle').release.id,
    phase: phase, status: status, elapsedMs: Math.max(0, elapsedMs),
    inputChars: inputChars, imageCount: imageCount,
    inputTokens: tokenCount(usage.prompt_tokens !== undefined ? usage.prompt_tokens : usage.input_tokens),
    outputTokens: output, reasoningTokens: reasoning,
    answerTokens: output !== null && reasoning !== null && output >= reasoning ? output - reasoning : null,
    requestedTotalBudget: tokenCount(payload.max_completion_tokens),
    requestedThinkingBudget: tokenCount(payload.thinking_budget),
    truncated: !!(choice && choice.finish_reason === 'length')
  })
}

function summarize(samples) {
  var groups = {}
  ;(samples || []).forEach(function (sample) {
    var d = sample.data || sample
    if (!d || d.schemaVersion !== 1 || typeof d.phase !== 'string' || tokenCount(d.elapsedMs) === null) return
    var key = [d.promptVersion, d.releaseId, d.phase].join('/')
    var g = groups[key] || (groups[key] = { calls: 0, failures: 0, truncated: 0, usageSamples: 0,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, reasoningSamples: 0, durations: [] })
    g.calls++; g.failures += Number(d.status !== 'ok'); g.truncated += Number(d.truncated === true)
    g.durations.push(d.elapsedMs)
    if (tokenCount(d.inputTokens) !== null && tokenCount(d.outputTokens) !== null) {
      g.usageSamples++; g.inputTokens += d.inputTokens; g.outputTokens += d.outputTokens
    }
    if (tokenCount(d.reasoningTokens) !== null) { g.reasoningSamples++; g.reasoningTokens += d.reasoningTokens }
  })
  Object.keys(groups).forEach(function (key) {
    var g = groups[key]
    g.durations.sort(function (a, b) { return a - b })
    g.p50Ms = g.durations[Math.ceil(g.calls * 0.5) - 1]
    g.p95Ms = g.durations[Math.ceil(g.calls * 0.95) - 1]
    delete g.durations
  })
  return { scope: 'local_recent_calls_not_population_metrics', groups: groups }
}

module.exports = { record: record, summarize: summarize }
