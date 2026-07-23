var config = require('./config')
var knowledge = require('./knowledge')
var kb = require('./kb')
var analytics = require('./analytics')
var textUtil = require('./text')

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

var cleanModelText = textUtil.cleanModelText

// ============================================================
// 置信度校准（Platt scaling 简化版，基于经验映射）
// ============================================================

/**
 * 将模型原始置信度映射到校准分数
 * 模型普遍过度自信，这里做保守收缩
 */
function calibrateConfidence(raw) {
  if (typeof raw !== 'number' || raw <= 0) return 0
  // 过渡方案（评估集就绪前的保守做法）：
  // 只对明显过高的自报概率做封顶，压制“100% 满屏”的伪精确；
  // 其余原样返回——没有评估数据支撑更激进的收缩，避免把所有概率压得太狠。
  // 待 golden set 建立后替换为 Platt scaling / isotonic regression（UPGRADE_PLAN §4.5 / §8.1）。
  if (raw > 95) return 88
  if (raw > 85) return 85
  return raw
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

function getPrecheckProviderConfig(name) {
  var cfg = getProviderConfig(name)
  if (config.QWEN_PRECHECK_MODEL) {
    cfg.model = config.QWEN_PRECHECK_MODEL
  }
  return cfg
}

// ============================================================
// Prompt 构建
// ============================================================

function buildSystemPrompt(petInfo) {
  petInfo = petInfo || {}
  var species = mapSpecies(petInfo)
  var isMucosal = petInfo.skinKbExcluded === true || isMucosalOrOralCase(petInfo, null)

  var parts = []

  // === 角色块 ===
  parts.push('=== 角色 ===')
  parts.push('你是资深兽医皮肤科初筛助手，服务对象为非专业宠物主人。')
  parts.push('职责：根据照片和病史给出供参考的病名方向，不做确诊，不开处方。')
  parts.push('用词通俗，避免专业术语直接抛给用户；不确定时如实说明。')
  parts.push('')

  // === 任务块 ===
  parts.push('=== 任务 ===')
  parts.push('请根据用户上传的宠物皮肤、体表或可见口腔黏膜图片和病例信息做初步分析。')
  parts.push('多图时先逐图描述所见，再综合判断，不要只看一张就下结论。')
  if (isMucosal) {
    parts.push('注意：当前图片/部位疑似口腔、牙龈、舌头或其他黏膜问题，不要套用普通皮肤病名称（如热点、湿性皮炎、褶皱皮炎）；应按口腔/黏膜病变初筛，并建议线下口腔/牙科或兽医检查。')
  }
  parts.push('')

  // === 格式块 ===
  parts.push('=== 输出格式 ===')
  parts.push('只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。')
  parts.push('JSON 字段如下：')
  parts.push('{')
  parts.push('  "observations": "按 部位→形态→颜色→边界→分布 的顺序客观描述图片所见",')
  parts.push('  "primaryDiagnosis": "最可能的初筛方向",')
  parts.push('  "primaryDiagnosisProbability": 0,')
  parts.push('  "diagnosisCandidates": [')
  parts.push('    { "name": "候选方向", "probability": 0, "reason": "简短理由", "supporting": "支持点", "against": "不确定点" }')
  parts.push('  ],')
  parts.push('  "lesionNameCn": "皮损表现",')
  parts.push('  "confidence": 0,')
  parts.push('  "explanation": "简短说明",')
  parts.push('  "possibleMeaning": "这些表现可能提示什么",')
  parts.push('  "homeCare": "安全的居家观察或护理建议；不含药名剂量",')
  parts.push('  "whenToWatch": "什么情况可以继续观察",')
  parts.push('  "whenToSeeVet": "什么情况需要线下就医",')
  parts.push('  "careSuggestion": "综合建议",')
  parts.push('  "vetWarning": "就医警告",')
  parts.push('  "urgency": "low|moderate|urgent|emergency",')
  parts.push('  "diagnosisProbabilityNote": "候选项数值是独立可能性评分，不是相加为100%的真实概率；仅作初筛参考",')
  parts.push('  "ragSources": [{ "title": "权威教科书或指南名称", "url": "可选的链接" }]')
  parts.push('}')
  parts.push('')
  parts.push('要求：数值字段为 0 到 100；urgency 只能是 low、moderate、urgent、emergency；字符串用中文；不要输出 null；不要使用星号或 Markdown。')
  parts.push('observations 顺序规则：先写患处部位（如左耳廓/腹部/趾间），再写皮损形态（如丘疹/脓疱/圆形脱毛/结痂/鳞屑），然后颜色（如红/灰白/黑褐）、边界是否清晰、分布范围（如局灶/对称/弥漫）；用自然语言连成一两句，不超过 80 字。示例："左耳廓见圆形脱毛区，表面灰白鳞屑，边界较清，局部断毛。"')
  parts.push('ragSources 规则：（1）只填入与本次诊断直接相关的权威兽医皮肤科参考来源，精确到具体章节或专题（例如“Merck 兽医手册 - 犬猫皮肤癣菌病”而非泛泛的“Merck 兽医手册”）；（2）不要对每种诊断都列同一组通用手册首页或诊断总论页，不同诊断应指向不同专题；（3）不确定真实链接就只给标题、url 留空，绝不要编造 URL；（4）没有把握就留空数组。')
  parts.push('')

  // === 约束块 ===
  parts.push('=== 约束 ===')
  parts.push('1. 不要开处方，不要给药名或剂量。')
  parts.push('2. 不要使用“确诊”“明确是”“一定是”等措辞，用“初步考虑”“可能”“倾向于”。')
  parts.push('3. 不要编造图中未见的症状；observations 只写图片确实看到的。')
  parts.push('4. 看不清或无法判断时如实写无法判断，不要硬猜。')
  parts.push('5. 用户可见字段里不要提到“知识库”“RAG”“本地库”“检索结果”等内部机制；可以直接写照片表现、病史线索、候选方向、鉴别点和建议检查。')
  parts.push('')

  // === 先验块（场景化必查清单）===
  parts.push('=== 诊断思路指引（必查清单）===')
  parts.push(knowledge.buildCommonFirstPrompt(species))

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

  var mucosalCase = petInfo.skinKbExcluded === true || isMucosalOrOralCase(petInfo, null)
  var shouldUseRagPrompt = petInfo.disableKnowledgeBase !== true && petInfo.disableRagPrompt !== true && petInfo.skinKbExcluded !== true
  var visualRagCandidates = shouldUseRagPrompt && petInfo.visualRagResults
    ? petInfo.visualRagResults.filter(kb.isPromptWorthyResult)
    : []
  var ragSearchComplaint = [
    petInfo.complaint || '',
    visualPrecheckText
  ].filter(Boolean).join('\n')

  // 知识库检索（RAG）：根据品种/部位/症状匹配相关知识，注入 prompt
  var precheckData = petInfo.visualPrecheck || {}
  var ragPrompt = shouldUseRagPrompt && !visualRagCandidates.length ? kb.buildRagPrompt({
    species: petInfo.species || '',
    breed: petInfo.breed || '',
    bodyPart: petInfo.bodyPartLabel || petInfo.bodyPart || '',
    complaint: ragSearchComplaint,
    visualFeatures: precheckData.visualFeatures || [],
    lesionPattern: precheckData.lesionPattern || '',
    lesionShape: precheckData.lesionShape || ''
  }) : ''

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
    mucosalCase ? '注意：当前图片/部位疑似口腔、牙龈、舌头或其他黏膜问题，不要套用普通皮肤病名称；请按口腔/黏膜病变思路描述初筛方向、风险和线下检查建议。' : '',
    regionHint
  ]

  if (visualRagCandidates.length) {
    lines.push('')
    lines.push('临床参考（复核用，可全部否定）：')
    visualRagCandidates.slice(0, 3).forEach(function (r, index) {
      var line = '[' + (index + 1) + '] ' + r.name
      if (r.typicalFeatures) line += '：' + r.typicalFeatures
      lines.push(line)
      if (r.ddx) lines.push('  鉴别：' + (typeof r.ddx === 'string' ? r.ddx.split('；')[0] : r.ddx))
    })
    lines.push('规则：照片+部位+病史同时吻合才采用；不吻合可全部否定。')
  }

  if (ragPrompt) {
    lines.push('')
    lines.push(ragPrompt)
  }

  return lines.filter(Boolean).join('\n')
}

function buildDebugPrompt(petInfo, lesionBoxes) {
  petInfo = petInfo || {}
  return {
    systemPrompt: buildSystemPrompt(petInfo),
    userPrompt: buildPrompt(petInfo, lesionBoxes || [])
  }
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

function cleanUserVisibleText(value) {
  return cleanModelText(value)
    .replace(/视觉预检特征与本地知识库中的“([^”]+)”方向相符，建议作为候选鉴别方向之一；?/g, '照片表现与“$1”的部分特征相似，建议作为候选鉴别方向之一。')
    .replace(/该结果来自视觉特征预检\s*\+\s*本地临床知识库快速匹配，仅作初筛参考；?/g, '该结果仅作初筛参考；')
    .replace(/知识库匹配：[^\n]*(\n)?/g, '')
    .replace(/本地临床知识库/g, '临床特征')
    .replace(/本地知识库/g, '临床特征')
    .replace(/知识库快速匹配/g, '临床特征匹配')
    .replace(/知识库/g, '临床特征')
    .replace(/\bRAG\b/gi, '临床参考')
    .trim()
}

function normalizeRagSources(sources) {
  var list = Array.isArray(sources) ? sources : []
  var seen = {}
  var out = []
  for (var i = 0; i < list.length; i++) {
    var source = list[i]
    var item = {}
    if (typeof source === 'string') {
      item.title = cleanUserVisibleText(source)
      item.url = ''
      item.tier = ''
    } else if (source && typeof source === 'object') {
      item.title = cleanUserVisibleText(source.title || source.name || source.url || '')
      item.url = typeof source.url === 'string' ? source.url : ''
      item.tier = typeof source.tier === 'string' ? source.tier : ''
    }
    if (!item.title) continue
    var key = item.url || item.title
    if (seen[key]) continue
    seen[key] = true
    out.push(item)
  }
  return out.slice(0, 6)
}

function collectSourcesFromResults(results) {
  var sources = []
  ;(results || []).forEach(function (result) {
    ;(result.sources || []).forEach(function (source) {
      sources.push(source)
    })
  })
  return normalizeRagSources(sources)
}

/**
 * 标准化输出结构
 */
function normalizeDiagnosis(data, providerName, providerCfg, petInfo) {
  // 先做护栏
  data = applyGuardrails(data, petInfo)

  var candidates = Array.isArray(data.diagnosisCandidates)
    ? data.diagnosisCandidates.map(function (item) {
      var itemName = displayDiagnosisForSpecies(cleanDiagName(item.name || '未明确'), petInfo && petInfo.species)
      return {
        name: itemName,
        probability: calibrateConfidence(normalizePercent(item.probability, 0)),
        reason: cleanUserVisibleText(item.reason || ''),
        supporting: cleanUserVisibleText(item.supporting || ''),
        against: cleanUserVisibleText(item.against || '')
      }
    }).slice(0, 5)
    : []

  var primaryDiagnosis = displayDiagnosisForSpecies(cleanDiagName(data.primaryDiagnosis || (candidates[0] && candidates[0].name) || '未明确'), petInfo && petInfo.species)
  var rawConf = normalizePercent(data.confidence, candidates[0] ? candidates[0].probability : 0)
  var calibratedConf = calibrateConfidence(rawConf)
  var confLabel = confidenceToLabel(calibratedConf)

  // 建议分段
  var homeCare = cleanUserVisibleText(data.homeCare || data.careSuggestion || '')
  var whenToWatch = cleanUserVisibleText(data.whenToWatch || '')
  var whenToSeeVet = cleanUserVisibleText(data.whenToSeeVet || data.vetWarning || '')

  // 合并 careSuggestion（兼容旧字段）
  var careSuggestion = cleanUserVisibleText(data.careSuggestion || '')
  if (!careSuggestion && (homeCare || whenToWatch)) {
    careSuggestion = [homeCare, whenToWatch].filter(Boolean).join('\n')
  }

  var urgency = ['low', 'moderate', 'urgent', 'emergency'].indexOf(data.urgency) >= 0
    ? data.urgency : 'moderate'

  return {
    // 核心诊断
    lesionType: 'aiMultimodal',
    lesionNameCn: displayDiagnosisForSpecies(cleanUserVisibleText(data.lesionNameCn || '皮肤照片观察'), petInfo && petInfo.species),
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
    vetWarning: cleanUserVisibleText(data.vetWarning || whenToSeeVet || '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。'),

    // 描述
    observations: cleanUserVisibleText(data.observations || ''),
    explanation: cleanUserVisibleText(data.explanation || data.observations || ''),
    possibleMeaning: cleanUserVisibleText(data.possibleMeaning || ''),

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
    ragSummary: cleanUserVisibleText(data.possibleMeaning || ''),
    ragBasis: cleanUserVisibleText(data.explanation || data.observations || ''),
    ragRecommendation: cleanUserVisibleText([careSuggestion, data.vetWarning || whenToSeeVet].filter(Boolean).join(' ')),
    ragSources: normalizeRagSources(data.ragSources),

    // 前端展示映射
    disease: primaryDiagnosis,
    diseaseList: candidates.length > 0 ? candidates : [{
      name: primaryDiagnosis,
      probability: normalizePercent(data.primaryDiagnosisProbability, 0),
      reason: cleanUserVisibleText(data.explanation || '')
    }],
    symptoms: cleanUserVisibleText(data.explanation || data.observations || ''),
    treatment: careSuggestion,
    urgencyLabel: cleanUserVisibleText(data.vetWarning || whenToSeeVet || '建议结合症状变化咨询线下兽医'),
    urgencyDesc: cleanUserVisibleText(data.vetWarning || whenToSeeVet || ''),
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

function getRequestTimeout(phase) {
  if (phase === 'vision-precheck') return config.PRECHECK_TIMEOUT || 18000
  return config.API_TIMEOUT || 45000
}

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
      timeout: getRequestTimeout(requestPhase),
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
      timeout: getRequestTimeout(requestPhase),
      data: {
        payload: payload,
        phase: requestPhase,
        timeoutMs: getRequestTimeout(requestPhase)
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

// 按分组生成视觉受控词表文本，帮助模型分类选词
function buildVisualVocabText(petInfo) {
  var groups = kb.VISUAL_VOCAB_GROUPS
  if (!groups) {
    return (kb.VISUAL_VOCAB || []).join('、')
  }
  
  var bodyPart = (petInfo && petInfo.bodyPart) || ''
  var complaint = (petInfo && petInfo.complaint) || ''
  var text = (bodyPart + ' ' + complaint).toLowerCase()
  
  // 核心组：总是给
  var coreGroups = ['颜色', '鳞屑结痂', '丘疹脓疱', '分布形态']
  
  // 条件组：根据部位和主诉选择性给
  var selectedGroups = coreGroups.slice()
  
  // 耳部 → 渗出分泌 + 可见寄生虫
  if (text.indexOf('耳') >= 0) {
    selectedGroups.push('渗出分泌', '可见寄生虫')
  }
  
  // 爪部/趾间 → 增厚质地 + 特殊结构
  if (text.indexOf('爪') >= 0 || text.indexOf('趾') >= 0 || text.indexOf('脚') >= 0) {
    selectedGroups.push('增厚质地', '特殊结构')
  }
  
  // 肿块/包/疙瘩 → 肿物
  if (text.indexOf('肿') >= 0 || text.indexOf('包') >= 0 || text.indexOf('疙瘩') >= 0 || text.indexOf('结节') >= 0) {
    selectedGroups.push('肿物')
  }
  
  // 口腔/黏膜 → 精简模式（只核心组）
  if (text.indexOf('口') >= 0 || text.indexOf('嘴') >= 0 || text.indexOf('牙') >= 0 || text.indexOf('舌') >= 0 || text.indexOf('黏膜') >= 0) {
    // 已经是核心组了，不加其他
  } else {
    // 非黏膜情况：补上常见的毛发、渗出、破损、肿物
    if (selectedGroups.indexOf('毛发') < 0) selectedGroups.push('毛发')
    if (selectedGroups.indexOf('渗出分泌') < 0) selectedGroups.push('渗出分泌')
    if (selectedGroups.indexOf('破损溃疡') < 0) selectedGroups.push('破损溃疡')
  }
  
  var groupLabels = {
    毛发: '毛发', 颜色: '颜色/红斑', 鳞屑结痂: '鳞屑结痂', 丘疹脓疱: '丘疹脓疱',
    渗出分泌: '渗出分泌', 破损溃疡: '破损溃疡', 增厚质地: '增厚质地', 肿物: '肿物',
    特殊结构: '特殊结构', 可见寄生虫: '可见虫体', 分布形态: '分布形态'
  }
  var lines = []
  for (var i = 0; i < selectedGroups.length; i++) {
    var key = selectedGroups[i]
    if (groups[key] && groups[key].length > 0) {
      var label = groupLabels[key] || key
      lines.push('  【' + label + '】' + groups[key].join('、'))
    }
  }
  return lines.join('\n')
}

function buildFeaturePrompt(petInfo, lesionBoxes) {
  var regionHint = Array.isArray(lesionBoxes) && lesionBoxes.some(Boolean)
    ? '用户圈出的患处坐标 lesion_boxes：' + JSON.stringify(lesionBoxes || [])
    : ''

  // 视觉标准词表来自知识库受控词表，确保提取端和检索端严格对齐
  var vocabText = buildVisualVocabText(petInfo)

  return [
    '请只提取宠物皮肤、体表或可见口腔黏膜照片中的客观视觉特征，用于判断是否适合皮肤知识库检索。',
    '不要诊断疾病，不要给治疗建议。',
    'visualFeatures 必须只从下列标准词中选择（图片里确实看到的才选，看不到就不选）。这些是检索用的受控词表，不要用同义词或自创词：',
    vocabText,
    '注意：只报告图片能看到的形态特征。不要输出"瘙痒/疼痛/慢性/反复"等图片看不出的主观或病史信息（这些由主人描述提供）。',
    '如果看到圆形或环形脱毛并伴鳞屑/结痂/断毛，visualFeatures 必须包含"圆形脱毛""鳞屑"或"结痂"等标准词。',
    '如果图片主体是口腔、牙龈、舌头或黏膜，bodyPartGuess 必须写"口腔/牙龈/舌头/黏膜"之一，visualFeatures 必须包含对应词，不要把它归为普通皮肤潮湿或热点。',
    '只输出一个合法 JSON 对象，不要 Markdown，不要解释前后缀。',
    'JSON 字段：',
    '{',
    '  "visualFeatures": ["脱毛/红斑/结痂/渗出/肿块/鳞屑/脓疱/破溃/色素沉着等"],',
    '  "bodyPartGuess": "图片中最可能的患处部位，如面部/耳部/背部/腹部/爪部/尾部/口腔/牙龈/舌头/黏膜/全身/未知",',
    '  "lesionPattern": "局灶性/多发性/弥漫性/环形/对称性/湿润/干燥/未知",',
    '  "lesionShape": "圆形/环形/不规则/边界清楚/边界不清/小丘疹多发/未知",',
    '  "shortObservation": "不超过40字的客观描述",',
    '  "quality": "clear|unclear",',
    '  "diagnosabilityScore": 0-100,',
    '  "diagnosabilityReason": "简短说明，如光线充足、病灶清晰则给高分；模糊、过远、过暗、主体不明确则给低分"',
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
      { role: 'system', content: '你是宠物皮肤、体表和可见口腔黏膜照片的视觉特征提取器。只提取客观可见特征，不做疾病诊断。' },
      { role: 'user', content: content }
    ],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_object' }
  }
  payload.enable_thinking = false

  return requestApi(providerCfg.apiBase, providerCfg.apiKey, payload, 'vision-precheck')
    .then(function (response) {
      var text = getMessageContent(response)
      var parsed = parseModelJson(text)
      var data = parsed.data || {}
      var features = Array.isArray(data.visualFeatures) ? data.visualFeatures : []
      features = features.map(cleanModelText).filter(Boolean).slice(0, 12)
      var quality = cleanModelText(data.quality || '')
      var diagnosabilityScore = null
      if (typeof data.diagnosabilityScore === 'number' && !Number.isNaN(data.diagnosabilityScore)) {
        diagnosabilityScore = data.diagnosabilityScore
      } else if (typeof data.diagnosabilityScore === 'string') {
        var parsedScore = parseFloat(data.diagnosabilityScore)
        if (!Number.isNaN(parsedScore)) diagnosabilityScore = parsedScore
      }
      // 兼容尚未返回新增字段的旧模型/缓存响应：不能把“缺字段”当成 0 分，
      // 否则所有原本可正常分析的图片都会被误拒绝。明确 unclear 时仍按低分处理。
      if (diagnosabilityScore === null) {
        diagnosabilityScore = quality === 'unclear' ? 0 : 60
      }
      // 如果模型明确返回 unclear，兜底 diagnosabilityScore 不超过 50
      if (quality === 'unclear' && diagnosabilityScore > 50) diagnosabilityScore = 50
      return {
        visualFeatures: features,
        bodyPartGuess: cleanModelText(data.bodyPartGuess || ''),
        lesionPattern: cleanModelText(data.lesionPattern || ''),
        lesionShape: cleanModelText(data.lesionShape || ''),
        shortObservation: cleanModelText(data.shortObservation || data.observations || ''),
        quality: quality,
        diagnosabilityScore: Math.max(0, Math.min(100, Math.round(diagnosabilityScore))),
        diagnosabilityReason: cleanModelText(data.diagnosabilityReason || ''),
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
    bodyPart: effectiveBodyPartForRag(petInfo, featureData),
    complaint: featureText,
    visualFeatures: featureData.visualFeatures || [],
    lesionPattern: featureData.lesionPattern || '',
    lesionShape: featureData.lesionShape || ''
  }
}

function textHasAny(text, terms) {
  text = String(text || '').toLowerCase()
  for (var i = 0; i < terms.length; i++) {
    if (text.indexOf(terms[i]) >= 0) return true
  }
  return false
}

function isGenericBodyPart(value) {
  return ['其他', 'other', '未知', 'unknown', ''].indexOf(String(value || '').toLowerCase()) >= 0
}

function effectiveBodyPartForRag(petInfo, featureData) {
  var selected = (petInfo && (petInfo.bodyPartLabel || petInfo.bodyPart)) || ''
  if (!selected || isGenericBodyPart(selected)) return (featureData && featureData.bodyPartGuess) || selected
  return selected
}

function isMucosalOrOralCase(petInfo, featureData) {
  var oralTerms = ['口腔', '口内', '嘴里', '牙龈', '舌', '舌头', '黏膜', '粘膜', '口唇内侧', 'oral', 'mouth', 'gum', 'tongue', 'mucosa']
  var text = [
    petInfo && petInfo.bodyPart,
    petInfo && petInfo.bodyPartLabel,
    petInfo && petInfo.complaint,
    featureData && featureData.bodyPartGuess,
    featureData && featureData.shortObservation,
    featureData && featureData.lesionPattern,
    featureData && featureData.lesionShape,
    featureData && featureData.visualFeatures ? featureData.visualFeatures.join(' ') : ''
  ].filter(Boolean).join(' ')
  return textHasAny(text, oralTerms)
}

function buildKbAttributionResults(petInfo) {
  petInfo = petInfo || {}
  if (petInfo.visualRagResults && petInfo.visualRagResults.length) {
    var visualResults = petInfo.visualRagResults.filter(kb.isPromptWorthyResult)
    if (visualResults.length) return visualResults
  }

  var pre = petInfo.visualPrecheck || {}
  var visualText = [
    pre.shortObservation || '',
    pre.lesionPattern || '',
    pre.lesionShape || '',
    pre.visualFeatures && pre.visualFeatures.length ? pre.visualFeatures.join(' ') : ''
  ].filter(Boolean).join(' ')

  return kb.search({
    species: petInfo.species || '',
    breed: petInfo.breed || '',
    bodyPart: effectiveBodyPartForRag(petInfo, pre),
    complaint: [petInfo.complaint || '', visualText].filter(Boolean).join('\n'),
    visualFeatures: pre.visualFeatures || [],
    lesionPattern: pre.lesionPattern || '',
    lesionShape: pre.lesionShape || ''
  }).filter(kb.isPromptWorthyResult)
}

function countMatchedType(hit, typePrefix) {
  if (!hit || !Array.isArray(hit.matched)) return 0
  return hit.matched.filter(function (item) {
    return String(item).indexOf(typePrefix) === 0
  }).length
}

function countEvidenceMatches(hit) {
  return countMatchedType(hit, '视觉:') +
    countMatchedType(hit, '病史:') +
    countMatchedType(hit, '别名:') +
    countMatchedType(hit, '组合:')
}

function displayDiagnosisForSpecies(name, species) {
  if (name === '皮肤癣菌病（犬猫）' || name === '皮肤癣菌病') {
    if (species === '猫') return '猫癣'
    if (species === '犬') return '犬癣'
    return '皮肤癣菌病'
  }
  return name
}

function isStrongVisionRagHit(results) {
  if (!results || !results.length) return false
  var top = results[0]
  var second = results[1]
  var minScore = config.VISION_RAG_MIN_SCORE || 8
  var minSymptoms = config.VISION_RAG_MIN_SYMPTOM_MATCHES || 2
  var evidenceMatches = countEvidenceMatches(top)
  if (top.score < minScore) return false
  if (evidenceMatches < minSymptoms) return false

  // top2 间隔检查：如果 top2 分数接近，说明存在显著混淆，
  // 应 fallback 到完整模型，让大模型做区分，而不是快路径直接定一个模棱两可的答案。
  if (second && second.score >= 5 && (top.score - second.score) < 3) return false

  // 强证据要求：至少有一项组合规则命中（该病特有的多条件组合），
  // 或者至少有一项别名命中（用户/模型直接提到该病名）。
  // 单纯泛视觉词（如"红肿"）命中不够硬，不能单独触发快路径。
  var hasCombo = top.matched && top.matched.some(function (m) {
    return String(m).indexOf('组合:') === 0
  })
  var hasAlias = top.matched && top.matched.some(function (m) {
    return String(m).indexOf('别名:') === 0
  })
  if (!hasCombo && !hasAlias) return false

  return true
}

function scoreToFastProbability(score, rank) {
  var base = Math.min(78, 42 + score * 3)
  return Math.max(20, Math.round(base - rank * 8))
}

function buildFastRagDiagnosis(results, featureData, providerName, providerCfg, petInfo) {
  var top = results[0]
  var topDisplayName = displayDiagnosisForSpecies(top.name, petInfo && petInfo.species)
  var candidates = results.slice(0, 3).map(function (hit, index) {
    var hitName = displayDiagnosisForSpecies(hit.name, petInfo && petInfo.species)
    return {
      name: hitName,
      probability: scoreToFastProbability(hit.score, index),
      reason: [
        hit.matched && hit.matched.length ? '观察依据：' + hit.matched.join('、') : '',
        hit.recommendedTests && hit.recommendedTests.length ? '建议检查：' + hit.recommendedTests.slice(0, 2).join('、') : '',
        hit.typicalFeatures ? '典型特征：' + hit.typicalFeatures : ''
      ].filter(Boolean).join('；'),
      supporting: hit.typicalFeatures || '',
      against: (hit.report && hit.report.uncertainty) || hit.ddx || ''
    }
  })

  var features = (featureData.visualFeatures || []).join('、')
  var observation = featureData.shortObservation || (features ? '照片可见：' + features : '照片特征已完成预检')
  var explanation = [
    observation,
    features ? '视觉预检特征：' + features : '',
    top.matched && top.matched.length ? '支持线索：' + top.matched.join('、') : '',
    top.typicalFeatures ? '参考特征：' + top.typicalFeatures : '',
    top.ddx ? '鉴别要点：' + top.ddx : '',
    top.recommendedTests && top.recommendedTests.length ? '建议检查：' + top.recommendedTests.slice(0, 4).join('、') : ''
  ].filter(Boolean).join('\n')
  var safeHomeCare = top.homeCareSafe && top.homeCareSafe.length
    ? top.homeCareSafe.slice(0, 4).join('；')
    : '保持患处清洁干燥，避免反复舔咬和抓挠；暂不自行使用人用药或不明药膏。'
  var vetAdvice = top.vetAdvice || '如皮损扩大、破溃流脓、明显疼痛、持续瘙痒或精神食欲异常，应线下就医。'
  var uncertainty = (top.report && top.report.uncertainty) || '单靠照片不能确诊，需要结合病史、体检和必要的实验室检查。'
  var sourceList = collectSourcesFromResults([top])

  return normalizeDiagnosis({
    observations: observation,
    primaryDiagnosis: topDisplayName,
    primaryDiagnosisProbability: candidates[0] ? candidates[0].probability : 50,
    diagnosisCandidates: candidates,
    lesionNameCn: featureData.lesionPattern || topDisplayName,
    confidence: candidates[0] ? candidates[0].probability : 50,
    explanation: explanation,
    possibleMeaning: '照片表现与“' + topDisplayName + '”的部分特征相似，建议作为候选鉴别方向之一；' + uncertainty,
    homeCare: safeHomeCare,
    whenToWatch: '若范围稳定、无明显疼痛渗出、精神食欲正常，可记录照片并持续观察变化。',
    whenToSeeVet: top.urgency === 'urgent' || top.urgency === 'emergency'
      ? vetAdvice
      : vetAdvice,
    careSuggestion: '该结果仅作初筛参考；下一步可结合线下检查确认：' + ((top.recommendedTests || []).slice(0, 3).join('、') || '皮肤/耳道基础检查') + '。',
    vetWarning: top.urgency === 'urgent' || top.urgency === 'emergency'
      ? vetAdvice
      : '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。',
    urgency: top.urgency || 'moderate',
    diagnosisProbabilityNote: DIAGNOSIS_SCORE_NOTE,
    ragSources: sourceList
  }, providerName, providerCfg, petInfo)
}

function diagnoseWithVisionRag(images, petInfo, providerName, providerCfg) {
  var lesionBoxes = (petInfo && petInfo.lesionBoxes) || []
  if (config.VISION_RAG_TRACE) {
    console.log('[VetAI] visionRag start: extracting visual features')
  }
  var precheckCfg = getPrecheckProviderConfig(providerName)
  return extractVisualFeatures(images, petInfo, lesionBoxes, precheckCfg)
    .then(function (featureData) {
      if (isMucosalOrOralCase(petInfo, featureData)) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] visionRag fallback: oral/mucosal case, skip skin KB fast path')
        }
        analytics.track('visionRag', {
          hit: false,
          reason: 'oral_mucosal',
          featureCount: featureData.visualFeatures.length
        })
        return {
          success: false,
          fallback: true,
          skinKbExcluded: true,
          visualPrecheck: featureData,
          visualRagResults: []
        }
      }

      // 图片可诊断性检查：如果预检模型认为图片质量不足以提取可靠视觉特征，
      // 直接拒绝，不消耗完整诊断调用，也不输出胡猜结果。
      var score = featureData.diagnosabilityScore || 0
      var reason = featureData.diagnosabilityReason || ''
      if (featureData.quality === 'unclear' || score < 40) {
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] visionRag reject: image not diagnosable', {
            quality: featureData.quality,
            diagnosabilityScore: score,
            diagnosabilityReason: reason
          })
        }
        analytics.track('visionRag', {
          hit: false,
          reason: 'image_not_diagnosable',
          quality: featureData.quality,
          diagnosabilityScore: score
        })
        var rejectData = normalizeDiagnosis({
          observations: '图片质量不足，无法提取可靠视觉特征',
          primaryDiagnosis: '无法判断',
          primaryDiagnosisProbability: 0,
          diagnosisCandidates: [],
          lesionNameCn: '图片质量不足',
          confidence: 0,
          explanation: '照片过暗、过远、模糊或主体不明确，AI 无法可靠识别皮肤特征。',
          possibleMeaning: '',
          homeCare: '请重新拍摄更清晰的照片：确保光线充足、对焦准确、病灶占据画面主要位置。',
          whenToWatch: '重新拍摄后，若病灶表现清楚可再次分析。',
          whenToSeeVet: '如宠物状态明显异常，请直接联系线下兽医。',
          careSuggestion: '请重新拍摄照片后再试。',
          vetWarning: '如症状加重、扩散、破溃、流脓、明显疼痛或精神食欲异常，请尽快线下就医。',
          urgency: 'low',
          diagnosisProbabilityNote: '图片质量不足，无法进行分析。',
          ragSources: [],
          _isReject: true
        }, providerName, providerCfg, petInfo)
        return {
          success: true,
          data: rejectData,
          raw: JSON.stringify({
            provider: providerName,
            model: providerCfg.model,
            images: images.length,
            reject: true,
            reason: 'image_not_diagnosable',
            quality: featureData.quality,
            diagnosabilityScore: score,
            diagnosabilityReason: reason,
            usage: featureData.usage || null
          })
        }
      }

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
            evidenceMatches: results[0] ? countEvidenceMatches(results[0]) : 0,
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
      data.ragTitle = '临床特征匹配'
      data.ragSummary = featureData.shortObservation || data.ragSummary
      data.ragBasis = results[0].typicalFeatures || data.ragBasis
      data.ragRecommendation = results[0].ddx || data.ragRecommendation
      data.ragSources = collectSourcesFromResults(results)
      data._fastRag = true
      data._visualFeatures = featureData.visualFeatures
      data._ragMatchName = results[0].name
      data._ragMatchScore = results[0].score
      data._ragMatched = results[0].matched || []

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
          evidenceMatches: countEvidenceMatches(results[0]),
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
  var systemPrompt = buildSystemPrompt(petInfo)

  // RAG 调试日志：查看知识库检索结果
  if (config.DEBUG_LOGS && petInfo.disableKnowledgeBase !== true) {
    var precheck = petInfo.visualPrecheck || {}
    var ragResults = kb.search({
      species: petInfo.species || '',
      breed: petInfo.breed || '',
      bodyPart: petInfo.bodyPartLabel || petInfo.bodyPart || '',
      complaint: petInfo.complaint || '',
      visualFeatures: precheck.visualFeatures || [],
      lesionPattern: precheck.lesionPattern || '',
      lesionShape: precheck.lesionShape || ''
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
    max_tokens: (options && options.max_tokens) || config.MODEL_MAX_TOKENS || 1600
  }

  payload.enable_thinking = config.QWEN_ENABLE_THINKING === true

  // 启用 JSON 模式，确保稳定快速的结构化输出
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

      // 记录本次诊断对应的 KB 检索结果（供反馈闭环使用）
      var kbResults = buildKbAttributionResults(petInfo)
      data._ragMatchName = kbResults[0] ? kbResults[0].name : ''
      data._ragMatchScore = kbResults[0] ? kbResults[0].score : 0
      data._ragMatched = kbResults[0] ? (kbResults[0].matched || []) : []

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

var _diagnosing = false

function friendlyError(raw) {
  var msg = (typeof raw === 'string' ? raw : '') || (raw && raw.message) || ''
  if (!msg) return '未知错误，请稍后重试'
  if (msg.indexOf('正在分析中') >= 0) return msg
  if (msg.indexOf('full-diagnosis DashScope request timeout') >= 0) return 'AI 完整诊断响应超时，请减少图片数量或稍后重试'
  if (msg.indexOf('vision-precheck DashScope request timeout') >= 0) return '视觉预检响应超时，已建议关闭知识库后重试'
  if (msg.indexOf('DashScope request timeout') >= 0) return 'AI 模型响应超时，请减少图片数量或稍后重试'
  if (msg.indexOf('云端返回为空') >= 0 || msg.indexOf('格式不匹配') >= 0) return '服务响应异常，请稍后重试'
  if (msg.indexOf('云函数调用失败') >= 0) {
    if (msg.indexOf('timeout') >= 0 || msg.indexOf('超时') >= 0 || msg.indexOf('FUNCTIONS_TIME_LIMIT') >= 0) {
      return '请求超时，图像分析需要较长时间，请重试'
    }
    return '服务连接异常，请检查网络后重试'
  }
  if (msg.indexOf('网络请求失败') >= 0 || msg.indexOf('网络异常') >= 0) return '网络连接异常，请检查网络后重试'
  if (msg.indexOf('模型接口错误') >= 0 || msg.indexOf('5') === 0) return 'AI 服务暂时不可用，请稍后重试'
  if (msg.indexOf('timeout') >= 0 || msg.indexOf('超时') >= 0) return '请求超时，您的网络可能较慢，请重试'
  if (msg.indexOf('当前环境不支持') >= 0) return '当前微信版本暂不支持此功能，请更新到最新版'
  if (msg.indexOf('API Key') >= 0 || msg.indexOf('请填写') >= 0) return '服务未配置完成，请联系开发者'
  if (msg.indexOf('请至少上传') >= 0) return msg
  return '操作失败，请稍后重试'
}

function diagnose(imageBase64List, petInfo, options) {
  if (_diagnosing) {
    return Promise.resolve({ success: false, error: '正在分析中，请稍候' })
  }
  _diagnosing = true

  // 与首页 UI 的 5 张上限一致（config.MAX_IMAGES）
  var maxModelImages = config.MAX_MODEL_IMAGES || config.MAX_IMAGES || 5
  var images = (Array.isArray(imageBase64List) ? imageBase64List : [])
    .map(cleanDataUrl)
    .filter(Boolean)
    .slice(0, maxModelImages)

  var _finish = function (result) { _diagnosing = false; return result }

  if (images.length === 0) {
    return Promise.resolve({ success: false, error: '请至少上传一张图片' }).then(_finish)
  }

  var requested = (petInfo && petInfo.modelProvider) || 'qwen'
  var providerName = pickProvider(requested)
  var providerCfg = getProviderConfig(providerName)

  if (!config.USE_CLOUD_FUNCTION && !providerCfg.apiKey) {
    return Promise.resolve({
      success: false,
      error: '请在 utils/config.js 中填写 ' + providerCfg.label + ' 的 API Key，或启用微信云函数代理。'
    }).then(_finish)
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
  var useKnowledgeBase = petInfo && typeof petInfo.useKnowledgeBase === 'boolean'
    ? petInfo.useKnowledgeBase
    : config.USE_KNOWLEDGE_BASE !== false

  var requestPetInfoForPrompt = Object.assign({}, petInfoForPrompt, {
    imageRoles: (petInfo && petInfo.imageRoles) || [],
    lesionBoxes: (petInfo && petInfo.lesionBoxes) || [],
    disableKnowledgeBase: useKnowledgeBase !== true,
    disableRagPrompt: useKnowledgeBase !== true
  })

  if (requestPetInfoForPrompt.disableKnowledgeBase !== true && config.VISION_RAG_FAST_PATH !== false) {
    return diagnoseWithVisionRag(images, requestPetInfoForPrompt, providerName, providerCfg)
      .then(function (fastResult) {
        if (fastResult && fastResult.success) return fastResult
        if (fastResult && fastResult.fallback) {
          return runFullDiagnosis(images, Object.assign({}, requestPetInfoForPrompt, {
            visualPrecheck: fastResult.visualPrecheck,
            visualRagResults: fastResult.visualRagResults,
            skinKbExcluded: fastResult.skinKbExcluded === true
          }), providerName, providerCfg, options)
        }
        return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err)
        if (config.VISION_RAG_TRACE) {
          console.log('[VetAI] visionRag fallback: precheck failed', msg)
        } else if (config.DEBUG_LOGS) {
          console.log('[VetAI] 视觉 RAG 预检失败，回退完整诊断：', msg)
        }
        return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
      })
      .catch(function (err) {
        return {
          success: false,
          error: friendlyError(err)
        }
      })
      .then(_finish)
  }

  return runFullDiagnosis(images, requestPetInfoForPrompt, providerName, providerCfg, options)
    .catch(function (err) {
      return {
        success: false,
        error: friendlyError(err)
      }
    })
    .then(_finish)
}

// ============================================================
// AI 对话生成（智能建档）
// ============================================================

function chatAI(messages, options) {
  if (!messages || messages.length === 0) {
    return Promise.reject(new Error('消息历史为空'))
  }

  options = options || {}
  var providerName = pickProvider('qwen')
  var providerCfg = getProviderConfig(providerName)

  if (!config.USE_CLOUD_FUNCTION && !providerCfg.apiKey) {
    return Promise.reject(new Error('未配置 API Key'))
  }

  var model = options.model || config.QWEN_PRECHECK_MODEL || providerCfg.model

  var payload = {
    model: model,
    messages: messages,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    max_tokens: options.max_tokens || 300
  }

  payload.enable_thinking = false

  if (options.response_format) {
    payload.response_format = options.response_format
  }

  return requestApi(providerCfg.apiBase, providerCfg.apiKey, payload, 'chat-ai')
    .then(function (response) {
      var text = getMessageContent(response)
      return {
        success: true,
        text: text,
        usage: response.usage || null
      }
    })
    .catch(function (err) {
      return {
        success: false,
        error: friendlyError(err)
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
  chatAI: chatAI,
  buildDebugPrompt: buildDebugPrompt,
  calibrateConfidence: calibrateConfidence,
  confidenceToLabel: confidenceToLabel,
  applyGuardrails: applyGuardrails,
  normalizePercent: normalizePercent,
  isStrongVisionRagHit: isStrongVisionRagHit,
  friendlyError: friendlyError
}
