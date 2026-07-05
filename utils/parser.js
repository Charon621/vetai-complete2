// ============================================================
// utils/parser.js
// JSON 解析、置信度校准、输出归一化（从 api.js 拆分）
// ============================================================

var knowledge = require('./knowledge')
var kb = require('./kb')
var promptUtil = require('./prompt')

var DIAGNOSIS_SCORE_NOTE = '候选项数值是系统独立可能性评分，不是相加为 100% 的真实概率，也不代表医学确诊概率。'

// ── 工具函数 ──

function normalizePercent(value, fallback) {
  if (typeof value === 'string') {
    var parsed = parseFloat(value.replace('%', '').trim())
    if (!Number.isNaN(parsed)) value = parsed
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  if (value > 0 && value <= 1) return Math.max(1, Math.round(value * 100))
  return Math.max(0, Math.min(100, Math.round(value)))
}

// ── 置信度校准（Platt scaling 简化版）──

function calibrateConfidence(raw) {
  if (typeof raw !== 'number' || raw <= 0) return 0
  if (raw <= 20) return Math.round(raw * 0.6)
  if (raw <= 40) return Math.round(12 + (raw - 20) * 0.7)
  if (raw <= 60) return Math.round(26 + (raw - 40) * 0.8)
  if (raw <= 80) return Math.round(42 + (raw - 60) * 0.85)
  return Math.round(59 + (raw - 80) * 0.9)
}

function confidenceToLabel(calibrated) {
  if (calibrated < 25) return '仅参考'
  if (calibrated < 45) return '可能'
  if (calibrated < 70) return '较可能'
  return '高度可能'
}

// ── JSON 提取 ──

function extractJsonObject(text) {
  var start = text.indexOf('{')
  if (start < 0) return null
  var depth = 0, inString = false, escape = false
  for (var i = start; i < text.length; i++) {
    var ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function underscoreToCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(underscoreToCamel)
  var result = {}
  Object.keys(obj).forEach(function (key) {
    var camelKey = key.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase() })
    result[camelKey] = underscoreToCamel(obj[key])
  })
  return result
}

// ── 健壮 JSON 解析 ──

function parseModelJson(text) {
  var raw = (text || '').trim()
  if (!raw) throw new Error('模型没有返回内容')

  if (raw.indexOf('无法判断') >= 0 && raw.indexOf('请重拍') >= 0) {
    return {
      data: {
        primaryDiagnosis: '无法判断',
        primaryDiagnosisProbability: 0,
        diagnosisCandidates: [],
        lesionNameCn: '图片质量不足',
        confidence: 0,
        explanation: '',
        possibleMeaning: '',
        careSuggestion: '请重新拍摄更清晰的照片。确保光线充足、对焦准确、距离15-30cm。',
        vetWarning: '',
        urgency: 'low',
        diagnosisProbabilityNote: '图片质量不足，无法进行分析。',
        _isReject: true
      },
      level: 0
    }
  }

  var withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try { return { data: underscoreToCamel(JSON.parse(withoutFence)), level: 1 } } catch (e) {}

  var extracted = extractJsonObject(withoutFence)
  if (extracted) {
    try { return { data: underscoreToCamel(JSON.parse(extracted)), level: 2 } } catch (e) {}
    var fixed = extracted.replace(/,\s*([}\]])/g, '$1')
    try { return { data: underscoreToCamel(JSON.parse(fixed)), level: 3 } } catch (e) {}
  }

  var wrappedMatch = withoutFence.match(/"(?:result|data|output)"\s*:\s*(\{[\s\S]*\})/i)
  if (wrappedMatch) {
    var wrappedObj = extractJsonObject(wrappedMatch[1])
    if (wrappedObj) {
      try { return { data: underscoreToCamel(JSON.parse(wrappedObj)), level: 4 } } catch (e) {}
    }
  }

  console.warn('[VetAI] 模型返回非标准 JSON，已使用兜底展示')
  return {
    data: {
      primaryDiagnosis: '初筛结果',
      primaryDiagnosisProbability: 0,
      diagnosisCandidates: [{ name: '模型返回了非结构化结果', probability: 0, reason: raw.slice(0, 800) }],
      lesionNameCn: '未能结构化解析',
      confidence: 0,
      explanation: raw.slice(0, 1200),
      possibleMeaning: '',
      careSuggestion: '建议补充更清晰的近景和整体位置照片后重试，必要时咨询线下兽医。',
      vetWarning: '如出现快速扩散、破溃流脓、明显疼痛、精神食欲下降，请尽快线下就医。',
      urgency: 'moderate',
      diagnosisProbabilityNote: '模型未返回标准 JSON，以上为原始文本兜底展示。'
    },
    level: 5
  }
}

// ── 文本清洗 ──

function cleanModelText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[*＊]/g, '').replace(/^\s*[-•]\s+/gm, '').trim()
}

function cleanUserVisibleText(value) {
  return cleanModelText(value)
    .replace(/视觉预检特征与本地知识库中的"([^"]+)"方向相符，建议作为候选鉴别方向之一；?/g, '照片表现与"$1"的部分特征相似，建议作为候选鉴别方向之一。')
    .replace(/该结果来自视觉特征预检\s*\+\s*本地临床知识库快速匹配，仅作初筛参考；?/g, '该结果仅作初筛参考；')
    .replace(/知识库匹配：[^\n]*(\n)?/g, '')
    .replace(/本地临床知识库/g, '临床特征')
    .replace(/本地知识库/g, '临床特征')
    .replace(/知识库快速匹配/g, '临床特征匹配')
    .replace(/知识库/g, '临床特征')
    .replace(/\bRAG\b/gi, '临床参考')
    .trim()
}

function cleanDiagName(name) {
  if (!name) return ''
  var s = cleanModelText(name)
  s = s.replace(/(?:高度|较)?可能\s*$/g, '')
  s = s.replace(/疑似\s*$/g, '')
  s = s.replace(/^疑似\s*/g, '')
  s = s.replace(/[\s，。、,.]+$/g, '')
  return s.trim() || name.trim()
}

function displayDiagnosisForSpecies(name, species) {
  if (name === '皮肤癣菌病（犬猫）' || name === '皮肤癣菌病') {
    if (species === '猫') return '猫癣'
    if (species === '犬') return '犬癣'
    return '皮肤癣菌病'
  }
  return name
}

// ── 护栏 ──

function applyGuardrails(data, petInfo) {
  var allText = [
    data.explanation || '', data.possibleMeaning || '',
    data.careSuggestion || '', data.vetWarning || '',
    data.observations || '',
    petInfo && petInfo.complaint ? petInfo.complaint : ''
  ].join(' ')

  var redLines = knowledge.checkRedLines(allText)
  if (redLines.length > 0) {
    var maxUrgency = knowledge.getMaxUrgency(data.urgency || 'moderate', redLines)
    if (maxUrgency !== data.urgency) {
      data.urgency = maxUrgency
      data.redLineFlags = redLines
    }
  }

  if (data.urgency === 'low' && data.vetWarning && data.vetWarning.length > 20) {
    var urgentWords = ['就医', '尽快', '紧急', '立即', '严重']
    for (var i = 0; i < urgentWords.length; i++) {
      if (data.vetWarning.indexOf(urgentWords[i]) >= 0) {
        data.urgency = 'moderate'
        break
      }
    }
  }

  var conf = normalizePercent(data.confidence, 0)
  if (conf < 30 && data.urgency === 'low') data.urgency = 'moderate'

  return data
}

// ── RAG Sources 归一化 ──

function normalizeRagSources(sources) {
  var list = Array.isArray(sources) ? sources : []
  var seen = {}, out = []
  list.forEach(function (source) {
    var item = {}
    if (typeof source === 'string') {
      item.title = cleanUserVisibleText(source); item.url = ''; item.tier = ''
    } else if (source && typeof source === 'object') {
      item.title = cleanUserVisibleText(source.title || source.name || source.url || '')
      item.url = typeof source.url === 'string' ? source.url : ''
      item.tier = typeof source.tier === 'string' ? source.tier : ''
    }
    if (!item.title) return
    var key = item.url || item.title
    if (seen[key]) return
    seen[key] = true
    out.push(item)
  })
  return out.slice(0, 6)
}

function collectSourcesFromResults(results) {
  var sources = []
  ;(results || []).forEach(function (r) {
    ;(r.sources || []).forEach(function (s) { sources.push(s) })
  })
  return normalizeRagSources(sources)
}

// ── 标准化输出 ──

function normalizeDiagnosis(data, providerLabel, model, petInfo) {
  data = applyGuardrails(data, petInfo)

  var candidates = Array.isArray(data.diagnosisCandidates)
    ? data.diagnosisCandidates.map(function (item) {
      return {
        name: displayDiagnosisForSpecies(cleanDiagName(item.name || '未明确'), petInfo && petInfo.species),
        probability: normalizePercent(item.probability, 0),
        reason: cleanUserVisibleText(item.reason || ''),
        supporting: cleanUserVisibleText(item.supporting || ''),
        against: cleanUserVisibleText(item.against || '')
      }
    }).slice(0, 5)
    : []

  var primaryDiagnosis = displayDiagnosisForSpecies(
    cleanDiagName(data.primaryDiagnosis || (candidates[0] && candidates[0].name) || '未明确'),
    petInfo && petInfo.species
  )
  var rawConf = normalizePercent(data.confidence, candidates[0] ? candidates[0].probability : 0)
  var calibratedConf = calibrateConfidence(rawConf)
  var confLabel = confidenceToLabel(calibratedConf)

  var homeCare = cleanUserVisibleText(data.homeCare || data.careSuggestion || '')
  var whenToWatch = cleanUserVisibleText(data.whenToWatch || '')
  var whenToSeeVet = cleanUserVisibleText(data.whenToSeeVet || data.vetWarning || '')
  var careSuggestion = cleanUserVisibleText(data.careSuggestion || '')
  if (!careSuggestion && (homeCare || whenToWatch)) {
    careSuggestion = [homeCare, whenToWatch].filter(Boolean).join('\n')
  }
  var urgency = ['low', 'moderate', 'urgent', 'emergency'].indexOf(data.urgency) >= 0 ? data.urgency : 'moderate'

  return {
    lesionType: 'aiMultimodal',
    lesionNameCn: displayDiagnosisForSpecies(cleanUserVisibleText(data.lesionNameCn || '皮肤照片观察'), petInfo && petInfo.species),
    confidence: calibratedConf, confidenceRaw: rawConf, confidenceLabel: confLabel,
    primaryDiagnosis: primaryDiagnosis,
    primaryDiagnosisProbability: normalizePercent(data.primaryDiagnosisProbability, candidates[0] ? candidates[0].probability : 0),
    diagnosisCandidates: candidates,
    homeCare: homeCare, whenToWatch: whenToWatch, whenToSeeVet: whenToSeeVet,
    careSuggestion: careSuggestion,
    vetWarning: cleanUserVisibleText(data.vetWarning || whenToSeeVet || '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。'),
    observations: cleanUserVisibleText(data.observations || ''),
    explanation: cleanUserVisibleText(data.explanation || data.observations || ''),
    possibleMeaning: cleanUserVisibleText(data.possibleMeaning || ''),
    urgency: urgency, redLineFlags: data.redLineFlags || [],
    diagnosisProbabilityNote: DIAGNOSIS_SCORE_NOTE,
    disclaimer: '本结果根据照片和病例信息自动生成，仅用于宠物皮肤问题初步参考，不能替代线下兽医诊断。',
    modelProvider: 'qwen', modelProviderLabel: providerLabel, modelName: model,
    generatedAt: new Date().toISOString(),
    ragTitle: '初筛诊断说明',
    ragSummary: cleanUserVisibleText(data.possibleMeaning || ''),
    ragBasis: cleanUserVisibleText(data.explanation || data.observations || ''),
    ragRecommendation: cleanUserVisibleText([careSuggestion, data.vetWarning || whenToSeeVet].filter(Boolean).join(' ')),
    ragSources: normalizeRagSources(data.ragSources),
    disease: primaryDiagnosis,
    diseaseList: candidates.length > 0 ? candidates : [{ name: primaryDiagnosis, probability: normalizePercent(data.primaryDiagnosisProbability, 0), reason: cleanUserVisibleText(data.explanation || '') }],
    symptoms: cleanUserVisibleText(data.explanation || data.observations || ''),
    treatment: careSuggestion,
    urgencyLabel: cleanUserVisibleText(data.vetWarning || whenToSeeVet || '建议结合症状变化咨询线下兽医'),
    urgencyDesc: cleanUserVisibleText(data.vetWarning || whenToSeeVet || ''),
    yoloConfidence: 0, bbox: [], detections: [],
    notes: [DIAGNOSIS_SCORE_NOTE, '本结果根据照片和病例信息自动生成，仅用于宠物皮肤问题初步参考，不能替代线下兽医诊断。'].join('\n'),
    isReject: !!data._isReject
  }
}

module.exports = {
  parseModelJson: parseModelJson,
  normalizeDiagnosis: normalizeDiagnosis,
  calibrateConfidence: calibrateConfidence,
  confidenceToLabel: confidenceToLabel,
  normalizePercent: normalizePercent,
  cleanModelText: cleanModelText,
  cleanUserVisibleText: cleanUserVisibleText,
  cleanDiagName: cleanDiagName,
  normalizeRagSources: normalizeRagSources,
  collectSourcesFromResults: collectSourcesFromResults,
  DIAGNOSIS_SCORE_NOTE: DIAGNOSIS_SCORE_NOTE
}
