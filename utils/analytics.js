// ============================================================
// utils/analytics.js
// 轻量埋点 + 错误分级 + 漏斗追踪（本地存储，可上报）
// 事件按本机空间隔离（BUG-K3）；校准样本走独立通道（BUG-L2）
// ============================================================

var storage = require('./storage')

var EVENTS_KEY_BASE = '_analytics_events'
var SAMPLES_KEY_BASE = '_analytics_samples'
var MAX_EVENTS = 200
var MAX_SAMPLES = 300

// 事件 key 跟随当前本机空间，与 user 页“当前空间数据”口径一致（BUG-K3）
function eventsKey() {
  try {
    return EVENTS_KEY_BASE + '_' + storage.getUserScope()
  } catch (e) {
    return EVENTS_KEY_BASE
  }
}

/**
 * 记录一个分析事件
 * 漏斗事件规范（BUG-L1）：upload → submit → modelReturn → viewReport → feedback / share
 * @param {string} event 事件名
 * @param {object} data 附加数据
 */
function track(event, data) {
  try {
    var key = eventsKey()
    var events = wx.getStorageSync(key) || []
    var entry = {
      event: event,
      timestamp: Date.now(),
      dateStr: formatTime(new Date()),
      data: data || {}
    }
    events.push(entry)
    // 超过上限裁掉最早的
    if (events.length > MAX_EVENTS) {
      events = events.slice(events.length - MAX_EVENTS)
    }
    wx.setStorageSync(key, events)
  } catch (e) {
    console.warn('[VetAI] 埋点写入失败', e)
  }
}

/**
 * 漏斗追踪 — 标记某次问诊流程到达的阶段
 */
function trackFunnel(sessionId, stage) {
  track('funnel', { sessionId: sessionId, stage: stage })
}

/**
 * 错误分级上报
 * @param {string} type 错误类型: network / parse / timeout / review / model_error / cloud_function / quality_fallback
 * @param {string} detail 详情
 */
function trackError(type, detail) {
  track('error', { errorType: type, detail: (detail || '').slice(0, 500) })
}

/**
 * 校准样本通道（BUG-L2）：如 imageQuality 的亮度/方差分布，
 * 独立 key、独立上限，不与行为事件抢 200 条配额；样本是设备级数据，不分空间
 */
function trackSample(kind, data) {
  try {
    var key = SAMPLES_KEY_BASE + '_' + kind
    var samples = wx.getStorageSync(key) || []
    samples.push({ timestamp: Date.now(), data: data || {} })
    if (samples.length > MAX_SAMPLES) {
      samples = samples.slice(samples.length - MAX_SAMPLES)
    }
    wx.setStorageSync(key, samples)
  } catch (e) {}
}

function getSamples(kind) {
  try {
    return wx.getStorageSync(SAMPLES_KEY_BASE + '_' + kind) || []
  } catch (e) {
    return []
  }
}

// ============================================================
// 置信度校准（api.js calibrateConfidence 的数据侧，骨架）
// ============================================================

// 校准样本的 trackSample kind：存储 key 为 _analytics_samples_confidenceOutcome，
// 每条结构 { timestamp, data: { confidence: 预测置信度(0-100), outcome: 就医反馈结果 } }，
// outcome 取值对齐 result 页反馈的 vetOutcome：consistent / partial / different
// 当前尚无代码写入该 kind，接入时在反馈提交处补 trackSample 即可
var CALIBRATION_SAMPLE_KIND = 'confidenceOutcome'
var CALIBRATION_MIN_SAMPLES = 30
var CALIBRATION_BUCKET_SIZE = 10

/**
 * 获取置信度校准表，供 api.js calibrateConfidence 按表插值
 * 当前返回 null（样本未积累，保持默认缓坡逻辑，零行为变化）；
 * 未来由 buildCalibrationSamples 聚合的分桶统计生成 [{raw, calibrated}] 升序锚点数组
 * （各桶以桶中点为 raw、以 consistent 占比换算的真实命中率为 calibrated）
 */
function getCalibrationTable() {
  return null
}

/**
 * 聚合校准样本（骨架，纯读取，不写存储）
 * 按（预测置信度区间, 实际反馈结果）分桶统计，供未来生成校准表
 * @returns {Array|null} 每桶 { rangeMin, rangeMax, total, consistent, partial, different, hitRate }；
 *                       样本不足（< 30 条有效样本）返回 null
 */
function buildCalibrationSamples() {
  var samples = getSamples(CALIBRATION_SAMPLE_KIND)
  // 只保留字段完整的有效样本
  var valid = []
  for (var i = 0; i < samples.length; i++) {
    var d = samples[i] && samples[i].data
    if (d && typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 100 && d.outcome) {
      valid.push(d)
    }
  }
  if (valid.length < CALIBRATION_MIN_SAMPLES) return null

  // 按置信度每 10 分一桶（0-9, 10-19, ..., 90-100）聚合反馈结果
  var buckets = {}
  for (var j = 0; j < valid.length; j++) {
    var s = valid[j]
    var idx = Math.min(9, Math.floor(s.confidence / CALIBRATION_BUCKET_SIZE))
    if (!buckets[idx]) {
      buckets[idx] = {
        rangeMin: idx * CALIBRATION_BUCKET_SIZE,
        rangeMax: idx === 9 ? 100 : (idx + 1) * CALIBRATION_BUCKET_SIZE - 1,
        total: 0, consistent: 0, partial: 0, different: 0
      }
    }
    var b = buckets[idx]
    b.total++
    if (s.outcome === 'consistent') b.consistent++
    else if (s.outcome === 'partial') b.partial++
    else if (s.outcome === 'different') b.different++
  }

  // 输出按区间升序的统计数组；hitRate = 一致占比（partial 计半次命中）
  var result = []
  var keys = Object.keys(buckets).sort(function (a, b) { return Number(a) - Number(b) })
  for (var k = 0; k < keys.length; k++) {
    var bucket = buckets[keys[k]]
    bucket.hitRate = bucket.total > 0
      ? Math.round(((bucket.consistent + bucket.partial * 0.5) / bucket.total) * 100)
      : 0
    result.push(bucket)
  }
  return result
}

/**
 * 获取所有事件（供调试/上报用）
 */
function getEvents() {
  try {
    return wx.getStorageSync(eventsKey()) || []
  } catch (e) {
    return []
  }
}

/**
 * 清空事件
 */
function clearEvents() {
  try {
    wx.removeStorageSync(eventsKey())
  } catch (e) {}
}

/**
 * 获取汇总统计
 * byEvent 动态统计全部事件名，白名单字段仅为兼容旧调用（BUG-L1）
 */
function getSummary() {
  var events = getEvents()
  var byEvent = {}
  var errorTypes = {}
  for (var i = 0; i < events.length; i++) {
    var e = events[i]
    byEvent[e.event] = (byEvent[e.event] || 0) + 1
    if (e.event === 'error' && e.data && e.data.errorType) {
      errorTypes[e.data.errorType] = (errorTypes[e.data.errorType] || 0) + 1
    }
  }
  return {
    total: events.length,
    byEvent: byEvent,
    upload: byEvent.upload || 0,
    submit: byEvent.submit || 0,
    modelReturn: byEvent.modelReturn || 0,
    share: byEvent.share || 0,
    feedback: byEvent.feedback || 0,
    error: byEvent.error || 0,
    errorTypes: errorTypes,
    lastEvent: events.length > 0 ? events[events.length - 1] : null
  }
}

function formatTime(date) {
  var y = date.getFullYear()
  var m = padZero(date.getMonth() + 1)
  var d = padZero(date.getDate())
  var h = padZero(date.getHours())
  var min = padZero(date.getMinutes())
  var s = padZero(date.getSeconds())
  return y + '-' + m + '-' + d + ' ' + h + ':' + min + ':' + s
}

function padZero(n) {
  return n < 10 ? '0' + n : '' + n
}

module.exports = {
  track: track,
  trackFunnel: trackFunnel,
  trackError: trackError,
  trackSample: trackSample,
  getSamples: getSamples,
  getCalibrationTable: getCalibrationTable,
  buildCalibrationSamples: buildCalibrationSamples,
  getEvents: getEvents,
  clearEvents: clearEvents,
  getSummary: getSummary
}
