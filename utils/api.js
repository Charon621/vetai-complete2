var config = require('./config')
var knowledge = require('./knowledge')
var kb = require('./kb')
var analytics = require('./analytics')

var DIAGNOSIS_SCORE_NOTE = '候选项数值是系统独立可能性评分，不是相加为 100% 的真实概率，也不代表医学确诊概率。'

// ============================================================
// 工具函数
// ============================================================

function normalizePercent(value, fallback) {
  if (typeof value === 'string') {
    var parsed = parseFloat(value.replace('%', '').trim())
    if (!Number.isNaN(parsed)) value = parsed
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  if (value > 0 && value <= 1) return Math.max(1, Math.round(value * 100))
  return Math.max(0, Math.min(100, Math.round(value)))
}

function mapSpecies(petInfo) {
  var type = petInfo.petType || petInfo.species || ''
  if (type === 'dog') return '犬'
  if (type === 'cat') return '猫'
  return petInfo.petTypeLabel || type || '未知'
}

function cleanDataUrl(image) {
  if (typeof image !== 'string') return ''
  var trimmed = image.trim()
  if (trimmed.indexOf('data:image/') === 0) return trimmed
  return 'data:image/jpeg;base64,' + trimmed
}

function cleanModelText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[*＊]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .trim()
}

// ============================================================
// 置信度校准（Platt scaling 简化版，基于经验映射）
// ============================================================

/**
 * 将模型原始置信度映射到校准分数
 * 模型普遍过度自信，这里做保守收缩
 */
function calibrateConfidence(raw) {
  if (typeof raw !== 'number' || raw <= 0) return 0
  // 分段线性校准（模拟 Platt scaling）
  if (raw <= 20) return Math.round(raw * 0.6)
  if (raw <= 40) return Math.round(12 + (raw - 20) * 0.7)
  if (raw <= 60) return Math.round(26 + (raw - 40) * 0.8)
  if (raw <= 80) return Math.round(42 + (raw - 60) * 0.85)
  return Math.round(59 + (raw - 80) * 0.9)
}

/**
 * 校准分数 → 自然语言区间
 */
function confidenceToLabel(calibrated) {
  if (calibrated < 25) return '仅参考'
  if (calibrated < 45) return '可能'
  if (calibrated < 70) return '较可能'
  return '高度可能'
}

// ============================================================
// Provider 选择
// ============================================================

var PROVIDERS = {
  qwen: {
    keyField: 'QWEN_API_KEY',
    baseField: 'QWEN_API_BASE',
    modelField: 'QWEN_MODEL',
    labelField: 'QWEN_LABEL',
    defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3.7-plus',
    defaultLabel: 'Qwen3.7-Plus'
  }
}

function normalizeProvider(provider) {
  return 'qwen'
}

function pickProvider(requested) {
  var name = normalizeProvider(requested)
  if (config[PROVIDERS[name].keyField]) return name
  return name
}

function getProviderConfig(name) {
  var p = PROVIDERS[name]
  return {
    apiKey: config[p.keyField] || '',
    apiBase: config[p.baseField] || p.defaultBase,
    model: config[p.modelField] || p.defaultModel,
    label: config[p.labelField] || p.defaultLabel
  }
}

// ============================================================
// Prompt 构建
// ============================================================

function buildSystemPrompt() {
  var parts = [
    '请根据用户上传的宠物皮肤图片和病例信息做初步分析。',
    '只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。',
    '不要开处方，不要给药名或剂量；看不清或无法判断时如实写无法判断。',
    'JSON 字段如下：',
    '{',
    '  "observations": "图片中看到的关键表现",',
    '  "primaryDiagnosis": "最可能的初筛方向",',
    '  "primaryDiagnosisProbability": 0,',
    '  "diagnosisCandidates": [',
    '    { "name": "候选方向", "probability": 0, "reason": "简短理由", "supporting": "支持点", "against": "不确定点" }',
    '  ],',
    '  "lesionNameCn": "皮损表现",',
    '  "confidence": 0,',
    '  "explanation": "简短说明",',
    '  "possibleMeaning": "这些表现可能提示什么",',
    '  "homeCare": "安全的居家观察或护理建议；不含药名剂量",',
    '  "whenToWatch": "什么情况可以继续观察",',
    '  "whenToSeeVet": "什么情况需要线下就医",',
    '  "careSuggestion": "综合建议",',
    '  "vetWarning": "就医警告",',
    '  "urgency": "low|moderate|urgent|emergency",',
    '  "diagnosisProbabilityNote": "候选项数值是独立可能性评分，不是相加为100%的真实概率；仅作初筛参考"',
    '}',
    '',
    '要求：数值字段为 0 到 100；urgency 只能是 low、moderate、urgent、emergency；字符串用中文；不要输出 null；不要使用星号或 Markdown。'
  ]

  // 注入常见病优先规则（防止模型过度诊断罕见病）
  parts.push('')
  parts.push('--- 诊断思路指引 ---')
  parts.push(knowledge.buildCommonFirstPrompt(''))

  return parts.join('\n')
}

function buildPrompt(petInfo, lesionBoxes) {
  var regionHint = Array.isArray(lesionBoxes) && lesionBoxes.some(Boolean)
    ? '用户圈出的患处坐标 lesion_boxes：' + JSON.stringify(lesionBoxes || [])
    : ''

  var visualPrecheckText = ''
  if (petInfo.visualPrecheck) {
    var pre = petInfo.visualPrecheck
    visualPrecheckText = [
      pre.shortObservation ? '视觉预检观察：' + pre.shortObservation : '',
      pre.visualFeatures && pre.visualFeatures.length ? '视觉预检特征：' + pre.visualFeatures.join('、') : '',
      pre.lesionPattern ? '皮损分布：' + pre.lesionPattern : '',
      pre.lesionShape ? '皮损形态：' + pre.lesionShape : ''
    ].filter(Boolean).join('\n')
  }

  var ragSearchComplaint = [
    petInfo.complaint || '',
    visualPrecheckText
  ].filter(Boolean).join('\n')

  // 知识库检索（RAG）：根据品种/部位/症状匹配相关知识，注入 prompt
  var ragPrompt = kb.buildRagPrompt({
    species: petInfo.species || '',
    breed: petInfo.breed || '',
    bodyPart: petInfo.bodyPartLabel || petInfo.bodyPart || '',
    complaint: ragSearchComplaint
  })

  var lines = [
    '病例信息：',
    '- 动物：' + (petInfo.species || '未知'),
    '- 品种：' + (petInfo.breed || '未知'),
    '- 性别：' + (petInfo.gender || '未知'),
    '- 年龄：' + (petInfo.age || '未知'),
    '- 体重：' + (petInfo.weight ? petInfo.weight + 'kg' : '未知'),
    '- 绝育：' + (petInfo.sterilized || '未知'),
    '- 过敏史：' + (petInfo.allergy || '无'),
    '- 既往病史/用药史：' + (petInfo.medicalHistory || '无'),
    '- 患处部位：' + (petInfo.bodyPartLabel || petInfo.bodyPart || '未知'),
    '- 主人补充描述：' + (petInfo.complaint || '无'),
    visualPrecheckText,
    regionHint
  ]

  if (petInfo.visualRagResults && petInfo.visualRagResults.length) {
    lines.push('')
    lines.push('视觉预检后的知识库候选（未达到快速输出阈值，仅供复核，不可强行采用）：')
    petInfo.visualRagResults.slice(0, 3).forEach(function (r, index) {
      lines.push('[' + (index + 1) + '] ' + r.name + '（匹配度 ' + r.score + '；命中：' + (r.matched || []).join('、') + '）')
      if (r.ddx) lines.push('  鉴别要点：' + r.ddx)
    })
  }

  if (ragPrompt) {
    lines.push('')
    lines.push(ragPrompt)
  }

  return lines.filter(Boolean).join('\n')
}

// ============================================================
// 响应解析
// ============================================================

function getMessageContent(response) {
  if (!response) return ''
  if (typeof response.content === 'string') return response.content

  var choices = response.choices
  if (!choices || !choices.length) return ''

  var choice = choices[0]
  var message = choice.message || choice
  if (!message) return ''

  var content = message.content
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content.map(function (item) {
      if (typeof item === 'string') return item
      if (item && typeof item.text === 'string') return item.text
      if (item && item.type === 'text') return item.text || ''
      return ''
    }).join('\n')
  }

  if (typeof content === 'object' && content !== null) {
    if (typeof content.text === 'string') return content.text
    if (typeof content.value === 'string') return content.value
  }

  return ''
}

/**
 * 从文本中提取平衡的 JSON 对象
 */
function extractJsonObject(text) {
  var start = text.indexOf('{')
  if (start < 0) return null

  var depth = 0
  var inString = false
  var escape = false

  for (var i = start; i < text.length; i++) {
    var ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

/**
 * 下划线 → 驼峰
 */
function underscoreToCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(underscoreToCamel)

  var result = {}
  var keys = Object.keys(obj)
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    var camelKey = key.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase() })
    result[camelKey] = underscoreToCamel(obj[key])
  }
  return result
}

/**
 * 健壮 JSON 解析
 * 返回 { data, level }，level 标记命中了哪一层容错：
 *   1 = 直接解析成功（理想情况）
 *   2 = 提取平衡 JSON 后成功
 *   3 = 修复尾逗号后成功
 *   4 = 提取 result/data 包裹后成功
 *   5 = 兜底（结构化失败，用原始文本包装展示）
 */
function parseModelJson(text) {
  var raw = (text || '').trim()
  if (!raw) throw new Error('模型没有返回内容')

  // 检查是否是拒答
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

  // 1. 直接尝试解析
  try {
    return { data: underscoreToCamel(JSON.parse(withoutFence)), level: 1 }
  } catch (e) {}

  // 2. 提取平衡的 JSON 对象
  var extracted = extractJsonObject(withoutFence)
  if (extracted) {
    try {
      return { data: underscoreToCamel(JSON.parse(extracted)), level: 2 }
    } catch (e) {}

    // 3. 尝试修复尾部逗号
    var fixed = extracted.replace(/,\s*([}\]])/g, '$1')
    try {
      return { data: underscoreToCamel(JSON.parse(fixed)), level: 3 }
    } catch (e) {}
  }

  // 4. 尝试提取包裹
  var wrappedMatch = withoutFence.match(/"(?:result|data|output)"\s*:\s*(\{[\s\S]*\})/i)
  if (wrappedMatch) {
    var wrappedObj = extractJsonObject(wrappedMatch[1])
    if (wrappedObj) {
      try {
        return { data: underscoreToCamel(JSON.parse(wrappedObj)), level: 4 }
      } catch (e) {}
    }
  }

  // 兜底
  console.warn('[VetAI] 模型返回非标准 JSON，已使用兜底展示')
  analytics.trackError('parse', '模型返回非标准 JSON，长度：' + raw.length)
  return {
    data: {
      primaryDiagnosis: '初筛结果',
      primaryDiagnosisProbability: 0,
      diagnosisCandidates: [{
        name: '模型返回了非结构化结果',
        probability: 0,
        reason: raw.slice(0, 800)
      }],
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

/**
 * 护栏：症状红线检查 + 一致性检查
 */
function applyGuardrails(data, petInfo) {
  // 合并所有文本做红线检查
  var allText = [
    data.explanation || '',
    data.possibleMeaning || '',
    data.careSuggestion || '',
    data.vetWarning || '',
    data.observations || '',
    petInfo && petInfo.complaint ? petInfo.complaint : ''
  ].join(' ')

  var redLines = knowledge.checkRedLines(allText)
  if (redLines.length > 0) {
    var maxUrgency = knowledge.getMaxUrgency(data.urgency || 'moderate', redLines)
    if (maxUrgency !== data.urgency) {
      console.log('[VetAI] 红线触发，urgency 从 ' + data.urgency + ' 升级到 ' + maxUrgency)
      data.urgency = maxUrgency
      data.redLineFlags = redLines
    }
  }

  // 一致性检查：urgency=low 但有严重 vetWarning → 强制升级
  if (data.urgency === 'low' && data.vetWarning && data.vetWarning.length > 20) {
    var urgentWords = ['就医', '尽快', '紧急', '立即', '严重']
    for (var i = 0; i < urgentWords.length; i++) {
      if (data.vetWarning.indexOf(urgentWords[i]) >= 0) {
        data.urgency = 'moderate'
        console.log('[VetAI] 一致性检查：urgency=low 但有严重 vetWarning，升级到 moderate')
        break
      }
    }
  }

  // 置信度低时强制 moderate 以上
  var conf = normalizePercent(data.confidence, 0)
  if (conf < 30 && data.urgency === 'low') {
    data.urgency = 'moderate'
  }

  return data
}

/**
 * 清洗诊断名：去掉末尾的"可能""疑似"等语气词，保留括号内的鉴别信息
 */
function cleanDiagName(name) {
  if (!name) return ''
  var s = cleanModelText(name)
  // 只去掉末尾的"可能""疑似""高度可能""较可能"等
  s = s.replace(/(?:高度|较)?可能\s*$/g, '')
  s = s.replace(/疑似\s*$/g, '')
  // 去掉开头的"疑似"
  s = s.replace(/^疑似\s*/g, '')
  // 去掉末尾多余标点
  s = s.replace(/[\s，。、,.]+$/g, '')
  return s.trim() || name.trim()
}

/**
 * 标准化输出结构
 */
function normalizeDiagnosis(data, providerName, providerCfg, petInfo) {
  // 先做护栏
  data = applyGuardrails(data, petInfo)

  var candidates = Array.isArray(data.diagnosisCandidates)
    ? data.diagnosisCandidates.map(function (item) {
      return {
        name: cleanDiagName(item.name || '未明确'),
        probability: normalizePercent(item.probability, 0),
        reason: cleanModelText(item.reason || ''),
        supporting: cleanModelText(item.supporting || ''),
        against: cleanModelText(item.against || '')
      }
    }).slice(0, 5)
    : []

  var primaryDiagnosis = cleanDiagName(data.primaryDiagnosis || (candidates[0] && candidates[0].name) || '未明确')
  var rawConf = normalizePercent(data.confidence, candidates[0] ? candidates[0].probability : 0)
  var calibratedConf = calibrateConfidence(rawConf)
  var confLabel = confidenceToLabel(calibratedConf)

  // 建议分段
  var homeCare = cleanModelText(data.homeCare || data.careSuggestion || '')
  var whenToWatch = cleanModelText(data.whenToWatch || '')
  var whenToSeeVet = cleanModelText(data.whenToSeeVet || data.vetWarning || '')

  // 合并 careSuggestion（兼容旧字段）
  var careSuggestion = cleanModelText(data.careSuggestion || '')
  if (!careSuggestion && (homeCare || whenToWatch)) {
    careSuggestion = [homeCare, whenToWatch].filter(Boolean).join('\n')
  }

  var urgency = ['low', 'moderate', 'urgent', 'emergency'].indexOf(data.urgency) >= 0
    ? data.urgency : 'moderate'

  return {
    // 核心诊断
    lesionType: 'aiMultimodal',
    lesionNameCn: cleanModelText(data.lesionNameCn || '皮肤照片观察'),
    confidence: calibratedConf,
    confidenceRaw: rawConf,
    confidenceLabel: confLabel,
    primaryDiagnosis: primaryDiagnosis,
    primaryDiagnosisProbability: normalizePercent(data.primaryDiagnosisProbability, candidates[0] ? candidates[0].probability : 0),
    diagnosisCandidates: candidates,

    // 分段建议
    homeCare: homeCare,
    whenToWatch: whenToWatch,
    whenToSeeVet: whenToSeeVet,
    careSuggestion: careSuggestion,
    vetWarning: cleanModelText(data.vetWarning || whenToSeeVet || '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。'),

    // 描述
    observations: cleanModelText(data.observations || ''),
    explanation: cleanModelText(data.explanation || data.observations || ''),
    possibleMeaning: cleanModelText(data.possibleMeaning || ''),

    // 严重度
    urgency: urgency,
    redLineFlags: data.redLineFlags || [],

    // 元信息
    diagnosisProbabilityNote: DIAGNOSIS_SCORE_NOTE,
    disclaimer: '本结果根据照片和病例信息自动生成，仅用于宠物皮肤问题初步参考，不能替代线下兽医诊断。',
    modelProvider: providerName,
    modelProviderLabel: providerCfg.label,
    modelName: providerCfg.model,
    generatedAt: new Date().toISOString(),

    // RAG 字段（兼容）
    ragTitle: '初筛诊断说明',
    ragSummary: cleanModelText(data.possibleMeaning || ''),
    ragBasis: cleanModelText(data.explanation || data.observations || ''),
    ragRecommendation: cleanModelText([careSuggestion, data.vetWarning || whenToSeeVet].filter(Boolean).join(' ')),
    ragSources: [],

    // 前端展示映射
    disease: primaryDiagnosis,
    diseaseList: candidates.length > 0 ? candidates : [{
      name: primaryDiagnosis,
      probability: normalizePercent(data.primaryDiagnosisProbability, 0),
      reason: cleanModelText(data.explanation || '')
    }],
    symptoms: cleanModelText(data.explanation || data.observations || ''),
    treatment: careSuggestion,
    urgencyLabel: cleanModelText(data.vetWarning || whenToSeeVet || '建议结合症状变化咨询线下兽医'),
    urgencyDesc: cleanModelText(data.vetWarning || whenToSeeVet || ''),
    yoloConfidence: 0,
    bbox: [],
    detections: [],
    notes: [DIAGNOSIS_SCORE_NOTE, '本结果根据照片和病例信息自动生成，仅用于宠物皮肤问题初步参考，不能替代线下兽医诊断。'].join('\n'),
    isReject: !!data._isReject
  }
}

// ============================================================
// wx.request 封装
// ============================================================

function doRequest(url, apiKey, payload, phase) {
  return new Promise(function (resolve, reject) {
    var startedAt = Date.now()
    var requestPhase = phase || 'model-request'
    if (config.VISION_RAG_TRACE) {
      console.log('[VetAI] request start:', requestPhase)
    }
    wx.request({
      url: url,
      method: 'POST',
      timeout: config.API_TIMEOUT || 180000,
      header: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      data: payload,
      success: function (res) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] request done:', requestPhase, res.statusCode, Date.now() - startedAt + 'ms')
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          var detail = ''
          if (res.data && res.data.error) {
            detail = res.data.error.message || res.data.error.code || ''
          } else if (typeof res.data === 'string') {
            detail = res.data.slice(0, 300)
          }
          var errMsg = '模型接口错误 ' + res.statusCode + (detail ? '：' + detail : '')
          analytics.trackError(res.statusCode >= 500 ? 'model_error' : 'review', errMsg)
          reject(new Error(errMsg))
          return
        }
        resolve(res.data)
      },
      fail: function (err) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] request fail:', requestPhase, (err && err.errMsg) || err, Date.now() - startedAt + 'ms')
        }
        var msg = '网络请求失败：' + (err.errMsg || '请检查网络连接')
        analytics.trackError('network', msg)
        reject(new Error(msg))
      }
    })
  })
}

function doCloudRequest(payload, phase) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error('当前环境不支持微信云函数，请检查基础库版本或云开发初始化'))
      return
    }

    var startedAt = Date.now()
    var requestPhase = phase || 'model-request'
    if (config.VISION_RAG_TRACE) {
      console.log('[VetAI] cloud request start:', requestPhase)
    }

    wx.cloud.callFunction({
      name: config.DIAGNOSE_CLOUD_FUNCTION || 'diagnose',
      data: {
        payload: payload,
        phase: requestPhase
      },
      success: function (res) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] cloud request done:', requestPhase, Date.now() - startedAt + 'ms')
        }
        var result = (res && res.result) || {}
        // 兼容旧版云函数：如果云端直接返回 OpenAI/DashScope 原始响应，也按成功处理。
        if (result.choices || (result.data && result.data.choices)) {
          resolve(result.choices ? result : result.data)
          return
        }
        if (!result.success) {
          var raw = ''
          try {
            raw = JSON.stringify(result).slice(0, 300)
          } catch (e) {}
          var msg = result.error || ('云函数请求失败' + (raw && raw !== '{}' ? '：' + raw : '：云端返回为空或格式不匹配'))
          if (result.statusCode) msg += '（' + result.statusCode + '）'
          analytics.trackError('cloud_function', msg)
          reject(new Error(msg))
          return
        }
        resolve(result.data)
      },
      fail: function (err) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] cloud request fail:', requestPhase, (err && err.errMsg) || err, Date.now() - startedAt + 'ms')
        }
        var msg = '云函数调用失败：' + ((err && err.errMsg) || '请检查云开发环境和函数部署')
        analytics.trackError('cloud_function', msg)
        reject(new Error(msg))
      }
    })
  })
}

function requestApi(url, apiKey, payload, phase) {
  if (config.USE_CLOUD_FUNCTION) {
    return doCloudRequest(payload, phase)
  }

  return doRequest(url, apiKey, payload, phase).catch(function (err) {
    var msg = (err && err.message) || ''
    var isNetwork = msg.indexOf('网络请求失败') >= 0
    var isTimeout = msg.indexOf('timeout') >= 0 || msg.indexOf('超时') >= 0
    var isServerError = /模型接口错误 5\d\d/.test(msg)
    if (isTimeout) analytics.trackError('timeout', msg)
    if (!isNetwork && !isServerError && !isTimeout) throw err

    return new Promise(function (resolve) {
      setTimeout(resolve, 1500)
    }).then(function () {
      return doRequest(url, apiKey, payload, (phase || 'model-request') + '-retry')
    })
  })
}

// ============================================================
// 视觉特征驱动 RAG：先提特征，强命中则直接输出知识库版报告
// ============================================================

function buildFeaturePrompt(petInfo, lesionBoxes) {
  var regionHint = Array.isArray(lesionBoxes) && lesionBoxes.some(Boolean)
    ? '用户圈出的患处坐标 lesion_boxes：' + JSON.stringify(lesionBoxes || [])
    : ''

  return [
    '请只提取宠物皮肤照片中的客观视觉特征，用于本地知识库检索。',
    '不要诊断疾病，不要给治疗建议。',
    'visualFeatures 请优先从以下标准词中选择，必要时可补充少量图片中确实存在的词：',
    '脱毛、圆形脱毛、红斑、红肿、鳞屑、结痂、断毛、渗出、潮湿、脓疱、丘疹、破溃、溃疡、肿块、结节、色素沉着、油腻、异味、舔舐、舔爪、搔抓、瘙痒、黑色颗粒、耳垢、对称、环形、多发、局灶、全身。',
    '如果看到圆形或环形脱毛并伴鳞屑/结痂/断毛，visualFeatures 必须包含“圆形脱毛”“鳞屑”或“结痂”等标准词。',
    '只输出一个合法 JSON 对象，不要 Markdown，不要解释前后缀。',
    'JSON 字段：',
    '{',
    '  "visualFeatures": ["脱毛/红斑/结痂/渗出/肿块/鳞屑/脓疱/破溃/色素沉着等"],',
    '  "bodyPartGuess": "图片中最可能的患处部位，如面部/耳部/背部/腹部/爪部/尾部/全身/未知",',
    '  "lesionPattern": "局灶性/多发性/弥漫性/环形/对称性/湿润/干燥/未知",',
    '  "lesionShape": "圆形/环形/不规则/边界清楚/边界不清/小丘疹多发/未知",',
    '  "shortObservation": "不超过40字的客观描述",',
    '  "quality": "clear|unclear"',
    '}',
    '',
    '病例上下文：',
    '- 动物：' + (petInfo.species || '未知'),
    '- 品种：' + (petInfo.breed || '未知'),
    '- 用户选择部位：' + (petInfo.bodyPartLabel || petInfo.bodyPart || '未知'),
    '- 用户补充描述：' + (petInfo.complaint || '无'),
    regionHint
  ].filter(Boolean).join('\n')
}

function extractVisualFeatures(images, petInfo, lesionBoxes, providerCfg) {
  var content = [{ type: 'text', text: buildFeaturePrompt(petInfo, lesionBoxes) }]
  var imageRoles = (petInfo && petInfo.imageRoles) || []
  var selected = selectVisionRagImages(images, imageRoles)
  for (var i = 0; i < selected.length; i++) {
    var role = selected[i].role || 'unspecified'
    var roleLabel = role === 'overview' ? '（整体外观照）' :
                    role === 'closeup' ? '（近景特写）' :
                    role === 'reference' ? '（参照物对比）' :
                    role === 'roi' ? '（患处 ROI 放大 2x）' : ''
    if (roleLabel) content.push({ type: 'text', text: '图片 ' + (i + 1) + roleLabel + '：' })
    content.push({ type: 'image_url', image_url: { url: selected[i].image } })
  }

  var payload = {
    model: providerCfg.model,
    messages: [
      { role: 'system', content: '你是宠物皮肤照片的视觉特征提取器。只提取客观可见特征，不做疾病诊断。' },
      { role: 'user', content: content }
    ],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_object' }
  }
  payload.enable_thinking = false

  return requestApi(providerCfg.apiBase, providerCfg.apiKey, payload, 'vision-precheck')
    .then(function (response) {
      var parsed = parseModelJson(getMessageContent(response))
      var data = parsed.data || {}
      var features = Array.isArray(data.visualFeatures) ? data.visualFeatures : []
      features = features.map(cleanModelText).filter(Boolean).slice(0, 12)
      return {
        visualFeatures: features,
        bodyPartGuess: cleanModelText(data.bodyPartGuess || ''),
        lesionPattern: cleanModelText(data.lesionPattern || ''),
        lesionShape: cleanModelText(data.lesionShape || ''),
        shortObservation: cleanModelText(data.shortObservation || data.observations || ''),
        quality: cleanModelText(data.quality || ''),
        parseLevel: parsed.level,
        usage: response.usage || null
      }
    })
}

function selectVisionRagImages(images, imageRoles) {
  var maxImages = config.VISION_RAG_MAX_IMAGES || 2
  var items = (images || []).map(function (image, index) {
    return { image: image, role: imageRoles[index] || '', index: index }
  }).filter(function (item) { return !!item.image })

  var preferred = []
  ;['roi', 'closeup', 'overview', 'reference', ''].forEach(function (role) {
    items.forEach(function (item) {
      if (preferred.length >= maxImages) return
      if (item._used) return
      if (role ? item.role === role : true) {
        item._used = true
        preferred.push(item)
      }
    })
  })

  return preferred.slice(0, maxImages)
}

function buildVisionRagQuery(petInfo, featureData) {
  var featureText = [
    petInfo.complaint || '',
    featureData.shortObservation || '',
    featureData.lesionPattern || '',
    featureData.lesionShape || '',
    (featureData.visualFeatures || []).join(' ')
  ].filter(Boolean).join(' ')

  return {
    species: petInfo.species || '',
    breed: petInfo.breed || '',
    bodyPart: petInfo.bodyPartLabel || petInfo.bodyPart || featureData.bodyPartGuess || '',
    complaint: featureText
  }
}

function countMatchedType(hit, typePrefix) {
  if (!hit || !Array.isArray(hit.matched)) return 0
  return hit.matched.filter(function (item) {
    return String(item).indexOf(typePrefix) === 0
  }).length
}

function isStrongVisionRagHit(results) {
  if (!results || !results.length) return false
  var top = results[0]
  var minScore = config.VISION_RAG_MIN_SCORE || 8
  var minSymptoms = config.VISION_RAG_MIN_SYMPTOM_MATCHES || 2
  var symptomMatches = countMatchedType(top, '症状:') + countMatchedType(top, '别名:')
  if (top.score < minScore) return false
  if (symptomMatches < minSymptoms) return false

  // 症状/别名命中足够多时，说明视觉特征和知识库已经对齐，可以快速输出。
  if (top.score >= 12 || symptomMatches >= 3) return true

  // Top1 没有明显优势且证据不够密时，仍交给完整 AI 诊断，避免相似病被规则检索误带偏。
  if (results[1] && top.score - results[1].score < 2 && top.score < 12) return false
  return true
}

function scoreToFastProbability(score, rank) {
  var base = Math.min(78, 42 + score * 3)
  return Math.max(20, Math.round(base - rank * 8))
}

function buildFastRagDiagnosis(results, featureData, providerName, providerCfg, petInfo) {
  var top = results[0]
  var candidates = results.slice(0, 3).map(function (hit, index) {
    return {
      name: hit.name,
      probability: scoreToFastProbability(hit.score, index),
      reason: [
        hit.matched && hit.matched.length ? '命中：' + hit.matched.join('、') : '',
        hit.typicalFeatures ? '典型特征：' + hit.typicalFeatures : ''
      ].filter(Boolean).join('；'),
      supporting: hit.typicalFeatures || '',
      against: hit.ddx || ''
    }
  })

  var features = (featureData.visualFeatures || []).join('、')
  var observation = featureData.shortObservation || (features ? '照片可见：' + features : '照片特征已完成预检')
  var explanation = [
    observation,
    features ? '视觉预检特征：' + features : '',
    top.matched && top.matched.length ? '知识库匹配：' + top.matched.join('、') : '',
    top.typicalFeatures ? '参考特征：' + top.typicalFeatures : '',
    top.ddx ? '鉴别要点：' + top.ddx : ''
  ].filter(Boolean).join('\n')

  return normalizeDiagnosis({
    observations: observation,
    primaryDiagnosis: top.name,
    primaryDiagnosisProbability: candidates[0] ? candidates[0].probability : 50,
    diagnosisCandidates: candidates,
    lesionNameCn: featureData.lesionPattern || top.name,
    confidence: candidates[0] ? candidates[0].probability : 50,
    explanation: explanation,
    possibleMeaning: '视觉预检特征与本地知识库中的“' + top.name + '”高度匹配，建议作为优先鉴别方向。',
    homeCare: '保持患处清洁干燥，避免反复舔咬和抓挠；暂不自行使用人用药或不明药膏。',
    whenToWatch: '若范围稳定、无明显疼痛渗出、精神食欲正常，可记录照片并持续观察变化。',
    whenToSeeVet: top.urgency === 'urgent' || top.urgency === 'emergency'
      ? '该方向存在较高就医必要性，建议尽快联系线下兽医进一步检查。'
      : '如皮损扩大、破溃流脓、明显疼痛、持续瘙痒或精神食欲异常，应线下就医。',
    careSuggestion: '该结果来自视觉特征预检 + 本地知识库快速匹配，仅作初筛参考；如症状变化或不确定，请线下就医。',
    vetWarning: top.urgency === 'urgent' || top.urgency === 'emergency'
      ? '建议尽快线下就医确认。'
      : '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。',
    urgency: top.urgency || 'moderate',
    diagnosisProbabilityNote: DIAGNOSIS_SCORE_NOTE
  }, providerName, providerCfg, petInfo)
}

function diagnoseWithVisionRag(images, petInfo, providerName, providerCfg) {
  var lesionBoxes = (petInfo && petInfo.lesionBoxes) || []
  if (config.VISION_RAG_TRACE) {
    console.log('[VetAI] visionRag start: extracting visual features')
  }
  return extractVisualFeatures(images, petInfo, lesionBoxes, providerCfg)
    .then(function (featureData) {
      var ragQuery = buildVisionRagQuery(petInfo, featureData)
      var results = kb.search(ragQuery)
      if (config.DEBUG_LOGS) {
        console.log('[VetAI] 视觉预检特征：', JSON.stringify(featureData))
        console.log('[VetAI] 视觉 RAG 检索：', results.length ? results.map(function (r) { return r.name + '(' + r.score + ')' }).join(', ') : '无匹配')
      }

      if (!isStrongVisionRagHit(results)) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] visionRag fallback: weak or no hit', {
            topName: results[0] ? results[0].name : '',
            topScore: results[0] ? results[0].score : 0,
            secondScore: results[1] ? results[1].score : 0,
            symptomMatches: results[0] ? countMatchedType(results[0], '症状:') + countMatchedType(results[0], '别名:') : 0,
            featureCount: featureData.visualFeatures.length,
            visualFeatures: featureData.visualFeatures,
            lesionPattern: featureData.lesionPattern,
            lesionShape: featureData.lesionShape,
            topMatched: results[0] ? results[0].matched : []
          })
        }
        analytics.track('visionRag', {
          hit: false,
          topScore: results[0] ? results[0].score : 0,
          featureCount: featureData.visualFeatures.length
        })
        return {
          success: false,
          fallback: true,
          visualPrecheck: featureData,
          visualRagResults: results
        }
      }

      var data = buildFastRagDiagnosis(results, featureData, providerName, providerCfg, petInfo)
      data.ragTitle = '知识库快速匹配'
      data.ragSummary = featureData.shortObservation || data.ragSummary
      data.ragBasis = results[0].typicalFeatures || data.ragBasis
      data.ragRecommendation = results[0].ddx || data.ragRecommendation
      data.ragSources = results.map(function (r) { return r.name })
      data._fastRag = true
      data._visualFeatures = featureData.visualFeatures

      analytics.track('visionRag', {
        hit: true,
        topName: results[0].name,
        topScore: results[0].score,
        featureCount: featureData.visualFeatures.length
      })

      if (config.VISION_RAG_TRACE) {
        console.log('[VetAI] fastRag hit:', {
          topName: results[0].name,
          topScore: results[0].score,
          secondScore: results[1] ? results[1].score : 0,
          symptomMatches: countMatchedType(results[0], '症状:') + countMatchedType(results[0], '别名:'),
          featureCount: featureData.visualFeatures.length,
          visualFeatures: featureData.visualFeatures,
          lesionPattern: featureData.lesionPattern,
          lesionShape: featureData.lesionShape,
          topMatched: results[0].matched
        })
      }

      return {
        success: true,
        data: data,
        raw: JSON.stringify({
          provider: providerName,
          model: providerCfg.model,
          images: images.length,
          fastRag: true,
          visualFeatures: featureData.visualFeatures,
          ragTop: results[0].name,
          ragScore: results[0].score,
          usage: featureData.usage || null
        })
      }
    })
}

function runFullDiagnosis(images, petInfo, providerName, providerCfg, options) {
  var lesionBoxes = (petInfo && petInfo.lesionBoxes) || []
  var prompt = buildPrompt(petInfo, lesionBoxes)
  var systemPrompt = buildSystemPrompt()

  // RAG 调试日志：查看知识库检索结果
  if (config.DEBUG_LOGS) {
    var ragResults = kb.search({
      species: petInfo.species || '',
      breed: petInfo.breed || '',
      bodyPart: petInfo.bodyPartLabel || petInfo.bodyPart || '',
      complaint: petInfo.complaint || ''
    })
    console.log('[VetAI] RAG 检索结果：', ragResults.length ? ragResults.map(function(r) { return r.name + '(' + r.score + ')' }).join(', ') : '无匹配')
    console.log('[VetAI] 完整用户 Prompt：\n', prompt)
  }

  // user content 只承载病例信息 + 图片，system prompt 单独走 system role，
  // 模型对 system role 的 "只输出 JSON / 禁止处方" 等约束遵循度更高
  var content = [{ type: 'text', text: prompt }]

  // 标注每张图的角色
  var imageRoles = (petInfo && petInfo.imageRoles) || []
  for (var i = 0; i < images.length; i++) {
    var role = imageRoles[i] || 'unspecified'
    var roleLabel = role === 'overview' ? '（整体外观照）' :
                    role === 'closeup' ? '（近景特写）' :
                    role === 'reference' ? '（参照物对比）' :
                    role === 'roi' ? '（患处 ROI 放大 2x）' : ''
    if (roleLabel) {
      content.push({ type: 'text', text: '图片 ' + (i + 1) + roleLabel + '：' })
    }
    content.push({
      type: 'image_url',
      image_url: { url: images[i] }
    })
  }

  var payload = {
    model: providerCfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content }
    ],
    temperature: (options && options.temperature) || 0.1,
    max_tokens: 4096
  }

  payload.enable_thinking = config.QWEN_ENABLE_THINKING === true

  // 启用 JSON 模式，减少 Markdown/说明文字导致的解析兜底
  payload.response_format = { type: 'json_object' }

  return requestApi(providerCfg.apiBase, providerCfg.apiKey, payload, 'full-diagnosis')
    .then(function (response) {
      if (config.DEBUG_LOGS) {
        console.log('[VetAI] ' + providerName + ' 原始响应：', JSON.stringify(response).slice(0, 800))
      }
      var text = getMessageContent(response)
      if (config.DEBUG_LOGS) {
        console.log('[VetAI] 提取的文本内容：', text.slice(0, 500))
      }
      var parsed = parseModelJson(text)
      var data = normalizeDiagnosis(parsed.data, providerName, providerCfg, petInfo)

      analytics.track('modelReturn', {
        provider: providerName,
        model: providerCfg.model,
        urgency: data.urgency,
        confidence: data.confidence,
        imageCount: images.length,
        isReject: !!data.isReject,
        parseLevel: parsed.level  // 1=直接成功 … 5=兜底，>2 都值得关注
      })

      return {
        success: true,
        data: data,
        raw: JSON.stringify({
          provider: providerName,
          model: providerCfg.model,
          images: images.length,
          usage: response.usage || null
        })
      }
    })
}

// ============================================================
// 主入口：diagnose
// ============================================================

function diagnose(imageBase64List, petInfo, options) {
  // 与首页 UI 的 5 张上限一致（config.MAX_IMAGES）
  var maxModelImages = config.MAX_MODEL_IMAGES || config.MAX_IMAGES || 5
  var images = (Array.isArray(imageBase64List) ? imageBase64List : [])
    .map(cleanDataUrl)
    .filter(Boolean)
    .slice(0, maxModelImages)

  if (images.length === 0) {
    return Promise.resolve({ success: false, error: '请至少上传一张图片' })
  }

  var requested = (petInfo && petInfo.modelProvider) || 'qwen'
  var providerName = pickProvider(requested)
  var providerCfg = getProviderConfig(providerName)

  if (!config.USE_CLOUD_FUNCTION && !providerCfg.apiKey) {
    return Promise.resolve({
      success: false,
      error: '请在 utils/config.js 中填写 ' + providerCfg.label + ' 的 API Key，或启用微信云函数代理。'
    })
  }

  var petInfoForPrompt = {
    species: mapSpecies(petInfo || {}),
    breed: (petInfo && petInfo.breed) || '',
    gender: (petInfo && (petInfo.genderLabel || petInfo.gender)) || '未知',
    age: (petInfo && (petInfo.ageLabel || petInfo.age)) || '未知',
    weight: (petInfo && petInfo.weight) || '',
    sterilized: (petInfo && (petInfo.sterilizedLabel || petInfo.sterilized)) || '',
    allergy: (petInfo && petInfo.allergy) || '',
    medicalHistory: (petInfo && petInfo.medicalHistory) || '',
    bodyPart: (petInfo && petInfo.bodyPart) || '',
    bodyPartLabel: (petInfo && petInfo.bodyPartLabel) || '',
    complaint: (petInfo && petInfo.complaint) || ''
  }
  var requestPetInfoForPrompt = Object.assign({}, petInfoForPrompt, {
    imageRoles: (petInfo && petInfo.imageRoles) || [],
    lesionBoxes: (petInfo && petInfo.lesionBoxes) || []
  })

  if (config.VISION_RAG_FAST_PATH !== false) {
    return diagnoseWithVisionRag(images, requestPetInfoForPrompt, providerName, providerCfg)
      .then(function (fastResult) {
        if (fastResult && fastResult.success) return fastResult
        if (fastResult && fastResult.fallback) {
          return runFullDiagnosis(images, Object.assign({}, requestPetInfoForPrompt, {
            visualPrecheck: fastResult.visualPrecheck,
            visualRagResults: fastResult.visualRagResults
          }), providerName, providerCfg, options)
        }
        return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
      })
      .catch(function (err) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] visionRag fallback: precheck failed', err && err.message ? err.message : err)
        } else if (config.DEBUG_LOGS) {
          console.log('[VetAI] 视觉 RAG 预检失败，回退完整诊断：', err && err.message ? err.message : err)
        }
        return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
      })
      .catch(function (err) {
        return {
          success: false,
          error: err && err.message ? err.message : '调用大模型 API 失败，请检查 API Key 和网络'
        }
      })
  }

  return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
    .catch(function (err) {
      return {
        success: false,
        error: err && err.message ? err.message : '调用大模型 API 失败，请检查 API Key 和网络'
      }
    })
}

// ============================================================
// 多模型集成（自一致性投票）
// 同一输入采样 N 次，对主诊断做多数投票，对候选概率取均值
// ============================================================

function diagnoseMulti(imageBase64List, petInfo, options) {
  options = options || {}
  var samples = options.samples || 3
  var temperature = options.temperature !== undefined ? options.temperature : 0.3

  // 并行发起 N 次请求
  var promises = []
  for (var i = 0; i < samples; i++) {
    promises.push(
      diagnose(imageBase64List, Object.assign({}, petInfo, { modelProvider: 'qwen' }), { temperature: temperature })
        .then(function (res) {
          if (!res.success) return null
          return res.data
        })
        .catch(function () { return null })
    )
  }

  return Promise.all(promises).then(function (results) {
    var valid = results.filter(function (r) { return r !== null })
    if (valid.length === 0) {
      return { success: false, error: '多模型投票全部失败' }
    }

    // 如果只有一次成功，直接返回
    if (valid.length === 1) {
      return { success: true, data: valid[0], raw: JSON.stringify({ multiVote: true, validCount: 1 }) }
    }

    // 主诊断投票：统计每个 primaryDiagnosis 出现次数
    var diagCount = {}
    var diagUrgency = {}
    for (var i = 0; i < valid.length; i++) {
      var d = valid[i].primaryDiagnosis || '未明确'
      diagCount[d] = (diagCount[d] || 0) + 1
      diagUrgency[d] = valid[i].urgency || 'moderate'
    }

    // 找出出现次数最多的诊断
    var bestDiag = ''
    var bestCount = 0
    var diagKeys = Object.keys(diagCount)
    for (var i = 0; i < diagKeys.length; i++) {
      if (diagCount[diagKeys[i]] > bestCount) {
        bestCount = diagCount[diagKeys[i]]
        bestDiag = diagKeys[i]
      }
    }

    // 找到投票结果对应的完整数据
    var winner = null
    for (var i = 0; i < valid.length; i++) {
      if (valid[i].primaryDiagnosis === bestDiag) {
        winner = valid[i]
        break
      }
    }

    // 对候选概率取均值
    var mergedCandidates = {}
    for (var i = 0; i < valid.length; i++) {
      var cands = valid[i].diagnosisCandidates || []
      for (var j = 0; j < cands.length; j++) {
        var name = cands[j].name
        if (!mergedCandidates[name]) {
          mergedCandidates[name] = { name: name, totalProb: 0, count: 0, reason: cands[j].reason }
        }
        mergedCandidates[name].totalProb += cands[j].probability || 0
        mergedCandidates[name].count++
      }
    }

    var avgCandidates = Object.keys(mergedCandidates).map(function (name) {
      var item = mergedCandidates[name]
      return {
        name: name,
        probability: Math.round(item.totalProb / item.count),
        reason: item.reason
      }
    }).sort(function (a, b) { return b.probability - a.probability }).slice(0, 5)

    // 合并结果
    var merged = Object.assign({}, winner, {
      primaryDiagnosis: bestDiag,
      diagnosisCandidates: avgCandidates,
      _multiVote: true,
      _voteCount: bestCount + '/' + valid.length
    })

    return {
      success: true,
      data: merged,
      raw: JSON.stringify({
        multiVote: true,
        validCount: valid.length,
        totalSamples: samples,
        winner: bestDiag,
        voteCount: bestCount + '/' + valid.length
      })
    }
  })
}

module.exports = {
  diagnose: diagnose,
  diagnoseMulti: diagnoseMulti,
  calibrateConfidence: calibrateConfidence,
  confidenceToLabel: confidenceToLabel
}
