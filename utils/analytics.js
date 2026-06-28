// ============================================================
// utils/analytics.js
// 轻量埋点 + 错误分级 + 漏斗追踪（本地存储，可上报）
// ============================================================

var MAX_EVENTS = 200

/**
 * 记录一个分析事件
 * @param {string} event 事件名: upload / submit / modelReturn / share / feedback / error
 * @param {object} data 附加数据
 */
function track(event, data) {
  try {
    var events = wx.getStorageSync('_analytics_events') || []
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
    wx.setStorageSync('_analytics_events', events)
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
 * @param {string} type 错误类型: network / parse / timeout / review / model_error
 * @param {string} detail 详情
 */
function trackError(type, detail) {
  track('error', { errorType: type, detail: (detail || '').slice(0, 500) })
}

/**
 * 获取所有事件（供调试/上报用）
 */
function getEvents() {
  try {
    return wx.getStorageSync('_analytics_events') || []
  } catch (e) {
    return []
  }
}

/**
 * 清空事件
 */
function clearEvents() {
  try {
    wx.removeStorageSync('_analytics_events')
  } catch (e) {}
}

/**
 * 获取汇总统计
 */
function getSummary() {
  var events = getEvents()
  var summary = {
    total: events.length,
    upload: 0,
    submit: 0,
    modelReturn: 0,
    share: 0,
    feedback: 0,
    error: 0,
    errorTypes: { network: 0, parse: 0, timeout: 0, review: 0, model_error: 0 },
    lastEvent: null
  }
  for (var i = 0; i < events.length; i++) {
    var e = events[i]
    if (summary[e.event] !== undefined) summary[e.event]++
    if (e.event === 'error' && e.data && e.data.errorType) {
      if (summary.errorTypes[e.data.errorType] !== undefined) {
        summary.errorTypes[e.data.errorType]++
      }
    }
  }
  if (events.length > 0) {
    summary.lastEvent = events[events.length - 1]
  }
  return summary
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
  getEvents: getEvents,
  clearEvents: clearEvents,
  getSummary: getSummary
}
