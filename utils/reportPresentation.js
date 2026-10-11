// Main-package adapter shared by both report pages, including the chat subpackage.
function unique(items) {
  return items.filter(function (item, index, all) { return item && all.indexOf(item) === index })
}
function prepare(record, view) {
  var scopes = view.scopes || [], full = view.supplemental
  var morphology = [], candidates = [], supports = [], conflicts = [], missing = []
  scopes.forEach(function (scope) {
    morphology = morphology.concat(scope.morphology || [])
    ;(scope.candidates || []).forEach(function (candidate) {
      candidates.push({name:candidate.name, supporting:(candidate.supports || []).join('；'), against:(candidate.conflicts || []).join('；')})
      supports = supports.concat(candidate.supports || [])
      conflicts = conflicts.concat(candidate.conflicts || [])
      missing = missing.concat(candidate.missing || [])
    })
  })
  if (full) {
    candidates = (full.modelSuggestions || []).map(function (candidate) {
      return {name:candidate.name, reason:candidate.note || '', supporting:candidate.supporting || '', against:candidate.against || ''}
    })
    supports = (full.evidenceFor || []).concat(candidates.map(function (candidate) { return candidate.supporting }))
    conflicts = (full.evidenceAgainst || []).concat(candidates.map(function (candidate) { return candidate.against }))
    missing = full.missingInformation || []
  }
  candidates = candidates.filter(function (candidate, index, all) {
    return all.map(function (item) { return item.name }).indexOf(candidate.name) === index
  })
  morphology = unique(morphology)
  var tests = full && full.recommendedTests || []
  var uncertainty = unique(conflicts).concat(unique(missing).length ? ['待补充：' + unique(missing).join('、')] : [])
  return Object.assign({}, record, {
    disease:candidates.length ? candidates[0].name : morphology.join('、') || view.title,
    primaryDiagnosis:candidates.length ? candidates[0].name : '',
    lesionNameCn:morphology.join('、'),
    diseaseList:candidates,
    diagnosisCandidates:candidates,
    confidence:null,
    primaryDiagnosisProbability:null,
    observations:morphology.join('；') || record.observations || '',
    explanation:unique(supports).join('；'),
    possibleMeaning:full && full.text || view.nextActionText || (candidates.length ? '照片表现可参考这些方向，结合检查进一步核对。' : view.summary),
    diagnosisProbabilityNote:uncertainty.join('；') || (view.limitations || []).join('；'),
    homeCare:full && full.homeCare || '拍照记录患处变化，避免反复抓挠。',
    whenToWatch:full && full.whenToWatch || '记录患处范围、抓挠以及精神食欲的变化。',
    whenToSeeVet:(full && full.whenToSeeVet || view.riskText || '') + (tests.length ? ' 建议检查：' + tests.join('、') + '。' : ''),
    urgency:view.urgency || 'unknown'
  })
}
module.exports = {prepare:prepare}
