// ============================================================
// utils/prompt.js
// Prompt 构建模块（从 api.js 拆分）
// ============================================================

var knowledge = require('./knowledge')
var kb = require('./kb')

// ── 辅助函数 ──

function cleanModelText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[*＊]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .trim()
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
  var lc = text.toLowerCase()
  for (var i = 0; i < oralTerms.length; i++) {
    if (lc.indexOf(oralTerms[i]) >= 0) return true
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

// ── System Prompt ──

function buildSystemPrompt() {
  var parts = [
    '请根据用户上传的宠物皮肤、体表或可见口腔黏膜图片和病例信息做初步分析。',
    '只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。',
    '不要开处方，不要给药名或剂量；看不清或无法判断时如实写无法判断。',
    '如果图片显示的是口腔、牙龈、舌头或黏膜溃疡/破损，不要套用普通皮肤病名称（如热点、湿性皮炎、褶皱皮炎）；应按口腔/黏膜病变初筛，并建议线下口腔/牙科或兽医检查。',
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
  parts.push('')
  parts.push('--- 诊断思路指引 ---')
  parts.push(knowledge.buildCommonFirstPrompt(''))
  parts.push('')
  parts.push('用户可见字段里不要提到"知识库""RAG""本地库""检索结果"等内部机制；可以直接写照片表现、病史线索、候选方向、鉴别点和建议检查。')
  return parts.join('\n')
}

// ── User Prompt ──

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
  var ragSearchComplaint = [petInfo.complaint || '', visualPrecheckText].filter(Boolean).join('\n')
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

// ── 视觉特征提取 Prompt ──

function buildFeaturePrompt(petInfo, lesionBoxes) {
  var regionHint = Array.isArray(lesionBoxes) && lesionBoxes.some(Boolean)
    ? '用户圈出的患处坐标 lesion_boxes：' + JSON.stringify(lesionBoxes || [])
    : ''

  // 视觉标准词表来自知识库受控词表，确保提取端和检索端严格对齐
  var vocabText = (kb.VISUAL_VOCAB_GROUPS
    ? Object.keys(kb.VISUAL_VOCAB_GROUPS).map(function (k) { return '  ' + kb.VISUAL_VOCAB_GROUPS[k].join('、') }).join('\n')
    : (kb.VISUAL_VOCAB || []).join('、'))

  return [
    '请只提取宠物皮肤、体表或可见口腔黏膜照片中的客观视觉特征，用于判断是否适合皮肤知识库检索。',
    '不要诊断疾病，不要给治疗建议。',
    'visualFeatures 必须只从下列标准词中选择（图片里确实看到的才选）。这些是检索用的受控词表，不要用同义词或自创词：',
    vocabText,
    '注意：只报告图片能看到的形态特征。不要输出"瘙痒/疼痛/慢性/反复"等图片看不出的主观或病史信息。',
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

// ── Debug ──

function buildDebugPrompt(petInfo, lesionBoxes) {
  petInfo = petInfo || {}
  return {
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildPrompt(petInfo, lesionBoxes || [])
  }
}

module.exports = {
  buildSystemPrompt: buildSystemPrompt,
  buildPrompt: buildPrompt,
  buildFeaturePrompt: buildFeaturePrompt,
  buildDebugPrompt: buildDebugPrompt,
  cleanModelText: cleanModelText,
  isMucosalOrOralCase: isMucosalOrOralCase,
  effectiveBodyPartForRag: effectiveBodyPartForRag
}
