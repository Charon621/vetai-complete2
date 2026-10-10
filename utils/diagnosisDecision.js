// BUG-07：单一终态裁决，系统故障不等同坏图；不改变既有 eager 资格。
function preQuality(status, pre) {
  if (status !== 'ok' || !pre || pre.parseLevel === 5) return 'unknown'
  return pre.quality === 'unclear' || pre.diagnosabilityScore < 40 ? 'unusable' : 'usable'
}
function fullQuality(status, full) {
  if (status !== 'ok' || !full) return 'unknown'
  var findings = full.imageFindings || []
  if (!findings.length) return 'unknown'
  return findings.every(function (f) { return f.usable === false }) ? 'unusable' : 'usable'
}
function decideDiagnosis(input) {
  var p = preQuality(input.precheckStatus, input.precheck)
  var f = fullQuality(input.fullStatus, input.full)
  if (p !== 'unknown' && f !== 'unknown' && p !== f) return { action: 'abstain', reason: 'quality_conflict' }
  if (p === 'unusable' || f === 'unusable') return { action: 'abstain', reason: 'image_unusable' }
  if (input.fullStatus === 'ok') return { action: 'full', reason: 'full_terminal' }
  if (input.fullStatus === 'clinical_abstain') return { action: 'full', reason: 'clinical_abstain' }
  if (p === 'usable' && input.deferredFast) return { action: 'fallback', reason: 'full_unavailable' }
  return { action: 'failure', reason: 'system_failure' }
}
function waitPrecheckTerminal(promise, deadlineMs, timers) {
  var clock = timers || { set: setTimeout, clear: clearTimeout }
  return new Promise(function (resolve) {
    var done = false
    var timer = clock.set(function () { finish({ status: 'timeout', data: null }) }, deadlineMs)
    function finish(value) { if (done) return; done = true; clock.clear(timer); resolve(value) }
    promise.then(function (data) { finish({ status: data.parseLevel === 5 ? 'schema_error' : 'ok', data: data }) }, function () { finish({ status: 'provider_error', data: null }) })
  })
}
module.exports = { decideDiagnosis: decideDiagnosis, waitPrecheckTerminal: waitPrecheckTerminal }
