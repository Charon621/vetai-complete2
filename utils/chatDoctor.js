/**
 * chatDoctor.js — AI 驱动的对话式问诊引擎
 *
 * 简化流程（2~3轮到照片）：
 * 新宠物：问候(名字+种类+年龄+性别一次收集) → 主诉(症状+部位AI提取) → 照片 → 诊断 → 追问
 * 已有档案：主诉 → 照片 → 诊断 → 追问
 */

var api = require('./api')

var DRAFT_KEY = 'chat_consultation_draft'

var PHASE = {
  GREETING: 'greeting',
  COMPLAINT: 'complaint',
  PHOTO: 'photo',
  ANALYZING: 'analyzing',
  RESULT: 'result',
  FOLLOW_UP: 'followup',
  DONE: 'done'
}

var TYPE_OPTIONS = [
  { value: 'dog', label: '犬' },
  { value: 'cat', label: '猫' },
  { value: 'rabbit', label: '兔' },
  { value: 'hamster', label: '仓鼠' },
  { value: 'bird', label: '鸟类' },
  { value: 'other', label: '其他' }
]
var GENDER_OPTIONS = [
  { value: 'male', label: '公' },
  { value: 'female', label: '母' },
  { value: 'unknown', label: '不确定' }
]
var AGE_OPTIONS = [
  { value: 'baby', label: '幼年' },
  { value: 'adult', label: '成年' },
  { value: 'senior', label: '老年' },
  { value: 'unknown', label: '不确定' }
]
var BODY_PART_OPTIONS = [
  { value: 'head', label: '头部' }, { value: 'neck', label: '颈部' },
  { value: 'ears', label: '耳部' }, { value: 'back', label: '背部' },
  { value: 'abdomen', label: '腹部' }, { value: 'limbs', label: '四肢' },
  { value: 'paws', label: '爪部' }, { value: 'tail', label: '尾部' },
  { value: 'whole', label: '全身' }, { value: 'other', label: '其他' }
]
// ── 工具函数 ──────────────────────────────────

function createId(p) { return (p || 'msg_') + Date.now().toString(36) + Math.random().toString(36).substr(2, 4) }

function getLabelByValue(options, value) {
  for (var i = 0; i < options.length; i++) { if (options[i].value === value) return options[i].label }
  return ''
}

function hasOption(options, value) {
  return !!getLabelByValue(options, value)
}

function fallbackExtractInfo(phase, userText) {
  var text = String(userText || '').trim()
  var result = {}
  var match

  if (phase === PHASE.GREETING) {
    if (/(狗|犬|金毛|拉布拉多|柯基|泰迪|比熊|柴犬|边牧)/.test(text)) result.petType = 'dog'
    else if (/(猫|英短|美短|布偶|暹罗|狸花)/.test(text)) result.petType = 'cat'
    else if (/兔/.test(text)) result.petType = 'rabbit'
    else if (/(仓鼠|荷兰猪|豚鼠)/.test(text)) result.petType = 'hamster'
    else if (/(鸟|鹦鹉|八哥)/.test(text)) result.petType = 'bird'

    if (/(公的|公猫|公狗|雄性|男孩)/.test(text)) result.gender = 'male'
    else if (/(母的|母猫|母狗|雌性|女孩)/.test(text)) result.gender = 'female'
    else if (/(性别不详|不知道性别)/.test(text)) result.gender = 'unknown'

    if (/(幼年|幼犬|幼猫|幼宠|不到\s*1\s*岁|\d+\s*个月)/.test(text)) result.age = 'baby'
    else if (/(老年|高龄|老猫|老狗|([89]|1\d)\s*岁)/.test(text)) result.age = 'senior'
    else if (/(成年|成犬|成猫|[1-7]\s*岁)/.test(text)) result.age = 'adult'
    else if (/(年龄不详|不知道年龄)/.test(text)) result.age = 'unknown'

    match = text.match(/(?:叫|名字(?:是|叫)?)[：:\s]*([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/)
    if (match) result.petName = match[1].replace(/(?:是只|是一只|它是).*$/, '')
    else if (!result.petType && !result.gender && !result.age && /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,8}$/.test(text)) result.petName = text
    match = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/i)
    if (match) result.weight = match[1]
  } else if (phase === PHASE.COMPLAINT) {
    result.complaint = text
    var bodyPartTerms = [
      ['ears', /(耳朵|耳部|耳廓)/], ['head', /(头部|脸|面部|下巴)/],
      ['neck', /(脖子|颈部)/], ['back', /(背部|背上)/], ['abdomen', /(腹部|肚子|腹股沟)/],
      ['paws', /(爪|脚掌|肉垫|趾间)/], ['limbs', /(腿|四肢|前肢|后肢)/],
      ['tail', /(尾巴|尾部)/], ['whole', /(全身|到处|多处)/]
    ]
    for (var i = 0; i < bodyPartTerms.length; i++) {
      if (bodyPartTerms[i][1].test(text)) { result.bodyPart = bodyPartTerms[i][0]; break }
    }
    var symptomTerms = [
      ['itching', /(瘙痒|很痒|发痒)/], ['scratching', /(抓挠|一直抓|挠)/],
      ['hair_loss', /(掉毛|脱毛|秃)/], ['crusting', /(结痂|痂皮)/],
      ['oozing', /(渗出|流脓|流水|湿润)/], ['redness', /(红肿|发红|红斑)/],
      ['scaling', /(脱屑|皮屑|鳞屑)/], ['lump', /(肿块|包块|疙瘩|结节)/]
    ]
    result.symptoms = []
    for (var j = 0; j < symptomTerms.length; j++) {
      if (symptomTerms[j][1].test(text)) result.symptoms.push(symptomTerms[j][0])
    }
    match = text.match(/(?:持续|已经|大约|约)?\s*(\d+\s*(?:小时|天|周|星期|个月|月|年))/)
    if (match) result.duration = match[1]
  }

  return result
}

function normalizeExtracted(phase, extracted, userText) {
  extracted = extracted && typeof extracted === 'object' ? extracted : {}
  var fallback = fallbackExtractInfo(phase, userText)
  var result = {}

  if (phase === PHASE.GREETING) {
    result.petName = String(extracted.petName || fallback.petName || '').trim()
    result.petType = hasOption(TYPE_OPTIONS, extracted.petType) ? extracted.petType : (fallback.petType || '')
    result.gender = hasOption(GENDER_OPTIONS, extracted.gender) ? extracted.gender : (fallback.gender || '')
    result.age = hasOption(AGE_OPTIONS, extracted.age) ? extracted.age : (fallback.age || '')
    result.breed = String(extracted.breed || '').trim()
    result.weight = String(extracted.weight || fallback.weight || '').trim()
  } else if (phase === PHASE.COMPLAINT) {
    result.complaint = String(extracted.complaint || fallback.complaint || '').trim()
    result.bodyPart = hasOption(BODY_PART_OPTIONS, extracted.bodyPart) ? extracted.bodyPart : (fallback.bodyPart || '')
    var allowedSymptoms = ['itching', 'hair_loss', 'scratching', 'crusting', 'oozing', 'redness', 'scaling', 'lump']
    var symptoms = Array.isArray(extracted.symptoms) ? extracted.symptoms : fallback.symptoms
    result.symptoms = (symptoms || []).filter(function (item, index, list) {
      return allowedSymptoms.indexOf(item) >= 0 && list.indexOf(item) === index
    })
    result.duration = String(extracted.duration || fallback.duration || '').trim()
  }
  return result
}

// ── AI 辅助函数 ──────────────────────────────────

function buildExtractionPrompt(phase, draft, userText, historyMessages) {
  var context = [
    '你是宠物皮肤病问诊助手。根据用户的回答，提取关键信息。',
    '只输出 JSON 对象，不要解释。',
    '',
    '当前阶段：' + phase,
    '用户说：' + userText
  ]

  if (phase === PHASE.GREETING) {
    context.push('')
    context.push('从用户回答中提取：')
    context.push('- petName: 宠物名字（必须）')
    context.push('- petType: 动物类型（dog/cat/rabbit/hamster/bird/other），必须从这些值中选')
    context.push('- gender: 性别（male/female/unknown），必须从这些值中选')
    context.push('- age: 年龄段（baby/adult/senior/unknown），必须从这些值中选')
    context.push('- breed: 品种（如有）')
    context.push('- weight: 体重（数字，单位kg，如有）')
    context.push('')
    context.push('JSON格式：')
    context.push('{ "petName": "", "petType": "", "gender": "", "age": "", "breed": "", "weight": "" }')
    context.push('')
    context.push('提取规则：')
    context.push('- petName 必填，其他字段尽量提取，没有就留空字符串')
    context.push('- petType 必须是 dog/cat/rabbit/hamster/bird/other 之一')
    context.push('- gender 必须是 male/female/unknown 之一')
    context.push('- age 必须是 baby/adult/senior/unknown 之一')
    context.push('- breed 是品种描述，如"英短""金毛"')
    context.push('- weight 是纯数字，单位统一为kg')
    context.push('')
    context.push('示例：')
    context.push('用户说"糯米" → {"petName":"糯米","petType":"","gender":"","age":"","breed":"","weight":""}')
    context.push('用户说"糯米，猫，3岁，公" → {"petName":"糯米","petType":"cat","gender":"male","age":"adult","breed":"","weight":""}')
    context.push('用户说"不确定名字，是只猫" → {"petName":"","petType":"cat","gender":"","age":"","breed":"","weight":""}')
  } else if (phase === PHASE.COMPLAINT) {
    context.push('')
    context.push('从用户描述中提取皮肤病相关信息：')
    context.push('- complaint: 主诉（原文，必须）')
    context.push('- bodyPart: 皮肤患处部位（head/neck/ears/back/abdomen/limbs/paws/tail/whole/other），必须从这些值中选')
    context.push('- symptoms: 皮肤症状数组，从 [itching, hair_loss, scratching, crusting, oozing, redness, scaling, lump] 中选')
    context.push('- duration: 持续时间描述（如有）')
    context.push('')
    context.push('JSON格式：')
    context.push('{ "complaint": "", "bodyPart": "", "symptoms": [], "duration": "" }')
    context.push('')
    context.push('提取规则：')
    context.push('- complaint 必填，保留用户原始描述')
    context.push('- bodyPart 必须是指定的英文值之一，重点关注皮肤表面部位')
    context.push('- symptoms 是数组，值必须是指定的英文值，专注于皮肤表现')
    context.push('- duration 如“3天”“一周”等，没有就留空')
    context.push('')
    context.push('示例：')
    context.push('用户说"耳朵上有块掉毛" → {"complaint":"耳朵上有块掉毛","bodyPart":"ears","symptoms":["hair_loss"],"duration":""}')
    context.push('用户说"肚子红肿抓了一周" → {"complaint":"肚子红肿抓了一周","bodyPart":"abdomen","symptoms":["redness","scratching"],"duration":"一周"}')
  }

  return context.join('\n')
}

function extractInfoByAI(phase, draft, userText, historyMessages) {
  var prompt = buildExtractionPrompt(phase, draft, userText, historyMessages)

  return api.chatAI([
    { role: 'system', content: '你是信息提取助手，只输出标准JSON，不输出其他内容。' },
    { role: 'user', content: prompt }
  ], {
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    model: 'qwen3.6-flash'
  }).then(function (result) {
    if (!result.success) {
      console.warn('[chatDoctor] AI提取失败:', result.error)
      return fallbackExtractInfo(phase, userText)
    }
    try {
      return normalizeExtracted(phase, JSON.parse(result.text || '{}'), userText)
    } catch (e) {
      console.warn('[chatDoctor] JSON解析失败:', result.text)
      return fallbackExtractInfo(phase, userText)
    }
  }).catch(function (err) {
    console.error('[chatDoctor] AI调用失败:', err)
    return fallbackExtractInfo(phase, userText)
  })
}

function buildDoctorMessagePrompt(phase, draft, historyMessages, userText) {
  var context = [
    '你是VetAI的宠物皮肤病问诊助手，用自然对话方式收集病例信息。',
    '根据当前阶段和已收集信息，生成下一个问题。',
    '要求：语气亲切、简洁、口语化，专注于皮肤问题，不要机械提问，不要一次问太多。',
    ''
  ]

  var petName = draft.petName || '宝贝'

  if (phase === PHASE.GREETING) {
    context.push('当前阶段：初次见面，正在收集宠物档案')
    context.push('目标：获取宠物的名字、种类、年龄、性别（缺什么问什么，已收集的信息不要再问）')
    if (draft.petName) context.push('已知：名字=' + draft.petName)
    if (draft.petTypeLabel) context.push('已知：种类=' + draft.petTypeLabel)
    if (draft.ageLabel) context.push('已知：年龄=' + draft.ageLabel)
    if (draft.genderLabel) context.push('已知：性别=' + draft.genderLabel)
    context.push('')
    context.push('只询问还缺少的字段，用一句话自然表达。如果名字、种类、年龄、性别都已齐全，就自然过渡到询问今天的皮肤问题（例如："好的，那今天皮肤怎么了？哪个部位有问题？"）。')
  } else if (phase === PHASE.COMPLAINT) {
    context.push('当前阶段：了解皮肤问题主诉')
    context.push('目标：获取今天的皮肤问题、患处部位、症状表现')
    if (draft.petName) context.push('宠物名字：' + draft.petName)
    if (draft.petTypeLabel) context.push('动物类型：' + draft.petTypeLabel)
    if (draft.ageLabel) context.push('年龄：' + draft.ageLabel)
    if (draft.genderLabel) context.push('性别：' + draft.genderLabel)
    context.push('')
    context.push('生成一个自然的问题，询问今天的皮肤问题。')
    context.push('例如："好的。今天' + petName + '的皮肤怎么了？哪个部位有问题？"')
  } else if (phase === PHASE.PHOTO) {
    context.push('当前阶段：收集患处照片')
    context.push('目标：让用户上传皮肤患处照片')
    if (draft.complaint) context.push('主诉：' + draft.complaint)
    if (draft.bodyPartLabel) context.push('患处：' + draft.bodyPartLabel)
    context.push('')
    context.push('生成一个请求照片的问题。')
    context.push('例如："明白了。能拍张患处的照片给我看看吗？"')
  } else if (phase === PHASE.FOLLOW_UP) {
    context.push('当前阶段：诊断完成后的追问')
    if (userText) {
      context.push('用户刚才问：' + userText)
    }
    if (draft.diagnosisResult && draft.diagnosisResult.success && draft.diagnosisResult.data) {
      var diag = draft.diagnosisResult.data
      context.push('诊断结果：' + (diag.disease || diag.primaryDiagnosis || '未知'))
      if (diag.possibleMeaning) context.push('说明：' + diag.possibleMeaning)
      if (diag.homeCare) context.push('护理建议：' + diag.homeCare)
      if (diag.whenToSeeVet) context.push('就医建议：' + diag.whenToSeeVet)
    }
    context.push('')
    if (userText) {
      context.push('根据诊断结果，用简洁亲切的语气回答用户的问题。不超过3句话。')
      context.push('如果问题超出皮肤诊断范围，建议用户咨询兽医。')
    } else {
      context.push('生成一个简短的追问，询问是否还有其他问题。')
    }
  }

  context.push('')
  context.push('语气要求：亲切、口语化、像朋友聊天，避免机械提问和"请提供""请描述"等正式措辞。')
  context.push('参考语气：')
  context.push('- 初次见面："你好呀，我是VetAI皮肤病问诊助手～你家宝贝叫什么名字？是什么小动物呢？"')
  context.push('- 追问主诉："好的～今天宝贝的皮肤怎么了？哪个部位有问题呀？"')
  context.push('- 请求照片："明白了，能拍张患处的照片给我看看吗？"')
  context.push('')
  context.push('只输出问题文本，不要前缀、不要解释。')

  return context.join('\n')
}

function generateDoctorMessageByAI(phase, draft, historyMessages, userText) {
  var prompt = buildDoctorMessagePrompt(phase, draft, historyMessages, userText)
  var isFollowUp = phase === PHASE.FOLLOW_UP && userText

  return api.chatAI([
    { role: 'system', content: isFollowUp ? '你是宠物医院问诊助手，根据诊断结果回答用户问题。回答简洁亲切，不超过3句话。' : '你是宠物医院问诊助手，生成自然亲切的对话问题。只输出问题文本，不要前缀和解释。' },
    { role: 'user', content: prompt }
  ], {
    temperature: 0.7,
    max_tokens: isFollowUp ? 200 : 80,
    model: 'qwen3.6-flash'
  }).then(function (result) {
    if (!result.success) {
      console.warn('[chatDoctor] AI生成失败:', result.error)
      return null
    }
    return result.text.trim()
  }).catch(function (err) {
    console.error('[chatDoctor] AI调用失败:', err)
    return null
  })
}

// ── 工具函数 ──────────────────────────────────

// ── 草稿存取 ──────────────────────────────────

function saveDraft(d) {
  try {
    // 避免把大体积 base64 写进 localStorage（10MB 配额）：
    //  - draft.photoBase64s：上传时已落盘为本地路径，base64 仅用于当次诊断，不持久化
    //  - messages[].images：使用本地路径；极端兜底残留的 base64 也一并清除
    function isBase64Image(value) {
      return typeof value === 'string' && value.indexOf('data:image') === 0
    }
    var hasBase64 = !!(d && d.draft && d.draft.photoBase64s && d.draft.photoBase64s.length)
    if (!hasBase64 && d && d.draft && Array.isArray(d.draft.photoPaths)) {
      hasBase64 = d.draft.photoPaths.some(isBase64Image)
    }
    if (!hasBase64 && d && Array.isArray(d.messages)) {
      for (var i = 0; i < d.messages.length; i++) {
        var imgs = d.messages[i] && d.messages[i].images
        if (Array.isArray(imgs)) {
          for (var j = 0; j < imgs.length; j++) {
            if (isBase64Image(imgs[j])) { hasBase64 = true; break }
          }
          if (hasBase64) break
        }
        if (d.messages[i] && isBase64Image(d.messages[i].image)) {
          hasBase64 = true
          break
        }
      }
    }
    if (!hasBase64) {
      wx.setStorageSync(DRAFT_KEY, d)
      return
    }
    var safe = {}
    for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) safe[k] = d[k] }
    if (safe.draft) {
      var nd = {}
      for (var dk in safe.draft) { if (Object.prototype.hasOwnProperty.call(safe.draft, dk)) nd[dk] = safe.draft[dk] }
      nd.photoBase64s = []
      if (Array.isArray(nd.photoPaths)) {
        var keptPaths = []
        var keptBoxes = []
        for (var pi = 0; pi < nd.photoPaths.length; pi++) {
          if (isBase64Image(nd.photoPaths[pi])) continue
          keptPaths.push(nd.photoPaths[pi])
          if (Array.isArray(nd.lesionBoxes)) keptBoxes.push(nd.lesionBoxes[pi] || null)
        }
        nd.photoPaths = keptPaths
        if (Array.isArray(nd.lesionBoxes)) nd.lesionBoxes = keptBoxes
      }
      safe.draft = nd
    }
    if (Array.isArray(safe.messages)) {
      safe.messages = safe.messages.map(function (m) {
        if (!m || !Array.isArray(m.images)) return m
        var clean = m.images.filter(function (img) { return !isBase64Image(img) })
        var cleanSingle = isBase64Image(m.image) ? '' : m.image
        if (clean.length === m.images.length && cleanSingle === m.image) return m
        var nm = {}
        for (var mk in m) { if (Object.prototype.hasOwnProperty.call(m, mk)) nm[mk] = m[mk] }
        nm.images = clean
        nm.image = cleanSingle
        return nm
      })
    }
    wx.setStorageSync(DRAFT_KEY, safe)
  } catch (e) {}
}
function loadDraft() { try { return wx.getStorageSync(DRAFT_KEY) || null } catch (e) { return null } }
function clearDraft() { try { wx.removeStorageSync(DRAFT_KEY) } catch (e) {} }

// ── 会话创建 ──────────────────────────────────

function createEmptyDraft() {
  return {
    petName: '', petType: '', petTypeLabel: '', breed: '',
    gender: '', genderLabel: '', age: '', ageLabel: '',
    weight: '', sterilized: '', sterilizedLabel: '',
    allergy: '', medicalHistory: '', avatar: '', profileId: '',
    complaint: '', bodyPart: '', bodyPartLabel: '',
    symptoms: [], duration: '', medication: '',
    photoPaths: [], photoBase64s: [], lesionBoxes: [],
    diagnosisResult: null, recordId: ''
  }
}

function createNewSession() {
  return { phase: PHASE.GREETING, draft: createEmptyDraft(), messages: [], startedAt: Date.now(), hasProfile: false }
}

function createSessionWithProfile(profile) {
  var s = createNewSession()
  s.phase = PHASE.COMPLAINT
  s.hasProfile = true
  var d = s.draft
  d.petName = profile.petName || ''; d.petType = profile.petType || ''; d.petTypeLabel = profile.petTypeLabel || ''
  d.breed = profile.breed || ''; d.gender = profile.gender || ''; d.genderLabel = profile.genderLabel || ''
  d.age = profile.age || ''; d.ageLabel = profile.ageLabel || ''; d.weight = profile.weight || ''
  d.sterilized = profile.sterilized || ''; d.sterilizedLabel = profile.sterilizedLabel || ''
  d.allergy = profile.allergy || ''; d.medicalHistory = profile.medicalHistory || ''
  d.avatar = profile.avatar || ''; d.profileId = profile.id || ''
  return s
}

// ── 医生消息（兼容旧逻辑 + AI生成）──────────────────────────────────

function getDoctorMessage(phase, draft) {
  var name = draft.petName || '宝贝'

  switch (phase) {
    case PHASE.GREETING:
      return {
        text: '你好，我是VetAI皮肤病问诊助手。你家宝贝叫什么名字？是什么动物？多大了？',
        quickReplies: TYPE_OPTIONS.map(function (o) { return { value: o.value, label: o.label, field: 'petType', key: 'petType_' + o.value } }),
        inputType: 'text',
        placeholder: '如「糯米，猫，3岁，公」'
      }

    case PHASE.COMPLAINT:
      return {
        text: '好的。今天' + name + '的皮肤怎么了？哪个部位有问题？',
        quickReplies: [],
        inputType: 'text',
        placeholder: '描述皮肤问题…'
      }

    case PHASE.PHOTO:
      return {
        text: '明白了。能拍张患处的照片给我看看吗？',
        quickReplies: [],
        inputType: 'photo',
        placeholder: ''
      }

    case PHASE.ANALYZING:
      return { text: '收到，我看看…', quickReplies: [], inputType: 'analyzing', placeholder: '' }

    case PHASE.RESULT:
      return { text: formatResultMessage(draft), quickReplies: [], inputType: 'result', placeholder: '' }

    case PHASE.FOLLOW_UP:
      return {
        text: '还有其他想问的吗？',
        quickReplies: [
          { value: 'new', label: '新问诊', field: 'action', key: 'act_new' },
          { value: 'report', label: '看报告', field: 'action', key: 'act_report' }
        ],
        inputType: 'text',
        placeholder: '继续问，或选上方操作…'
      }

    default:
      return { text: '', quickReplies: [], inputType: 'text', placeholder: '' }
  }
}

function formatResultMessage(draft) {
  var r = draft.diagnosisResult
  if (!r || !r.success) {
    return '抱歉，分析出了点问题。可以重新拍几张照片试试，或者多描述一些细节。'
  }
  var d = r.data || {}
  var lines = []
  var diagnosis = d.disease || d.primaryDiagnosis || d.lesionNameCn || '未能明确判断'
  lines.push('根据照片和描述，初步考虑可能是「' + diagnosis + '」。')
  if (d.possibleMeaning) { lines.push(''); lines.push(cleanText(d.possibleMeaning)) }
  if (d.homeCare || d.careSuggestion) {
    lines.push(''); lines.push('日常护理：')
    var care = splitAdvice(d.homeCare || d.careSuggestion)
    for (var i = 0; i < care.length && i < 3; i++) { lines.push(care[i]) }
  }
  if (d.whenToSeeVet || d.vetWarning) {
    lines.push(''); lines.push('出现这些情况建议就诊：')
    var vet = splitAdvice(d.whenToSeeVet || d.vetWarning)
    for (var j = 0; j < vet.length && j < 2; j++) { lines.push(vet[j]) }
  }
  lines.push(''); lines.push('以上仅供参考，不能替代兽医面诊。')
  return lines.join('\n')
}

// ── 输入处理（AI 驱动）──────────────────────────────────

// 关键字段缺失时，按"还差哪个字段"给出对应的快捷选项，避免让 AI 重复问已知信息
function getReaskQuickReplies(draft) {
  if (!draft.petType) {
    return TYPE_OPTIONS.map(function (o) { return { value: o.value, label: o.label, field: 'petType', key: 'petType_' + o.value } })
  }
  if (!draft.gender) {
    return GENDER_OPTIONS.map(function (o) { return { value: o.value, label: o.label, field: 'gender', key: 'gender_' + o.value } })
  }
  if (!draft.age) {
    return AGE_OPTIONS.map(function (o) { return { value: o.value, label: o.label, field: 'age', key: 'age_' + o.value } })
  }
  return []
}

function processUserInput(session, text, quickReply) {
  var draft = session.draft
  var phase = session.phase
  var action = null

  if (quickReply) {
    if (quickReply.field === 'petType') { draft.petType = quickReply.value; draft.petTypeLabel = quickReply.label }
    else if (quickReply.field === 'gender') { draft.gender = quickReply.value; draft.genderLabel = quickReply.label }
    else if (quickReply.field === 'age') { draft.age = quickReply.value; draft.ageLabel = quickReply.label }
    else if (quickReply.field === 'bodyPart') { draft.bodyPart = quickReply.value; draft.bodyPartLabel = quickReply.label }
    else if (quickReply.field === 'action') {
      action = quickReply.value
      return Promise.resolve({ session: session, doctorMsg: null, error: null, action: action })
    }
  }

  if (!text || !text.trim()) {
    return Promise.resolve({ session: session, doctorMsg: null, error: null })
  }

  text = text.trim()

  // 诊断后的追问不做病例字段提取；快捷选项已经本地落值，也无需再调用模型。
  var extractionPromise = phase === PHASE.FOLLOW_UP || quickReply
    ? Promise.resolve({})
    : extractInfoByAI(phase, draft, text, session.messages || [])

  return extractionPromise
    .then(function (extracted) {
      // FOLLOW_UP 不需要提取信息，直接生成回复
      if (phase === PHASE.FOLLOW_UP) {
        return generateDoctorMessageByAI(PHASE.FOLLOW_UP, draft, session.messages || [], text)
          .then(function (aiText) {
            var msgData = getDoctorMessage(PHASE.FOLLOW_UP, draft)
            if (aiText) msgData.text = aiText
            return {
              session: session,
              doctorMsg: {
                id: createId(), role: 'doctor', text: msgData.text,
                quickReplies: msgData.quickReplies, inputType: msgData.inputType,
                placeholder: msgData.placeholder, timestamp: Date.now()
              },
              error: null
            }
          })
      }
      if (phase === PHASE.GREETING) {
        if (extracted.petName) draft.petName = extracted.petName
        if (extracted.petType) {
          draft.petType = extracted.petType
          draft.petTypeLabel = getLabelByValue(TYPE_OPTIONS, extracted.petType)
        }
        if (extracted.gender) {
          draft.gender = extracted.gender
          draft.genderLabel = getLabelByValue(GENDER_OPTIONS, extracted.gender)
        }
        if (extracted.age) {
          draft.age = extracted.age
          draft.ageLabel = getLabelByValue(AGE_OPTIONS, extracted.age)
        }
        if (extracted.breed) draft.breed = extracted.breed
        if (extracted.weight) draft.weight = extracted.weight
      } else if (phase === PHASE.COMPLAINT) {
        if (extracted.complaint) draft.complaint = extracted.complaint
        if (extracted.bodyPart) {
          draft.bodyPart = extracted.bodyPart
          draft.bodyPartLabel = getLabelByValue(BODY_PART_OPTIONS, extracted.bodyPart)
        }
        if (extracted.symptoms && extracted.symptoms.length > 0) {
          draft.symptoms = extracted.symptoms
        }
        if (extracted.duration) draft.duration = extracted.duration
      }

      var nextPhase = phase
      var error = null

      switch (phase) {
        case PHASE.GREETING:
          if (!draft.petName) {
            error = '能告诉我你家宝贝的名字吗？'
          } else if (!draft.petType) {
            error = (draft.petName || '宝贝') + '是什么小动物呢？猫、狗、还是其他？'
          } else if (!draft.gender) {
            error = (draft.petName || '宝贝') + '是公的还是母的？'
          } else if (!draft.age) {
            error = (draft.petName || '宝贝') + '大概多大了？幼年、成年还是老年？'
          } else {
            nextPhase = PHASE.COMPLAINT
          }
          break

        case PHASE.COMPLAINT:
          if (!draft.complaint) {
            error = '说说今天什么问题？'
          } else if (draft.photoPaths && draft.photoPaths.length > 0) {
            nextPhase = PHASE.ANALYZING
          } else {
            nextPhase = PHASE.PHOTO
          }
          break

        case PHASE.PHOTO:
          if (draft.photoPaths.length === 0) {
            error = '请先拍照或上传照片，我才能帮你分析'
          } else {
            nextPhase = PHASE.ANALYZING
          }
          break

        case PHASE.ANALYZING:
          break

        case PHASE.RESULT:
          nextPhase = PHASE.FOLLOW_UP
          break

        case PHASE.FOLLOW_UP:
          break
      }

      session.phase = nextPhase
      saveDraft(session)

      // 关键字段缺失（GREETING/COMPLAINT/PHOTO）：直接用明确提示追问，不走 AI
      // —— 既省一次模型调用，也避免 AI 重复询问已收集到的信息
      if (error) {
        var retryData = getDoctorMessage(phase, draft)
        retryData.quickReplies = getReaskQuickReplies(draft)
        return Promise.resolve({
          session: session,
          doctorMsg: {
            id: createId(),
            role: 'doctor',
            text: error,
            quickReplies: retryData.quickReplies,
            inputType: retryData.inputType,
            placeholder: retryData.placeholder,
            timestamp: Date.now()
          },
          error: error
        })
      }

      if (nextPhase === PHASE.PHOTO || nextPhase === PHASE.ANALYZING || nextPhase === PHASE.RESULT) {
        var msgData = getDoctorMessage(nextPhase, draft)
        return {
          session: session,
          doctorMsg: {
            id: createId(),
            role: 'doctor',
            text: msgData.text,
            quickReplies: msgData.quickReplies,
            inputType: msgData.inputType,
            placeholder: msgData.placeholder,
            timestamp: Date.now()
          },
          error: null
        }
      }

      return generateDoctorMessageByAI(nextPhase, draft, session.messages || [], text)
        .then(function (aiText) {
          var msgData = getDoctorMessage(nextPhase, draft)
          if (aiText) msgData.text = aiText
          return {
            session: session,
            doctorMsg: {
              id: createId(),
              role: 'doctor',
              text: msgData.text,
              quickReplies: msgData.quickReplies,
              inputType: msgData.inputType,
              placeholder: msgData.placeholder,
              timestamp: Date.now()
            },
            error: null
          }
        })
    })
    .catch(function (err) {
      console.error('[chatDoctor] processUserInput 失败:', err)
      session.phase = phase
      var fallbackData = getDoctorMessage(phase, draft)
      return {
        session: session,
        doctorMsg: {
          id: createId(),
          role: 'doctor',
          text: '抱歉，我没理解。能再说一遍吗？',
          quickReplies: fallbackData.quickReplies,
          inputType: fallbackData.inputType,
          placeholder: fallbackData.placeholder,
          timestamp: Date.now()
        },
        error: '处理失败'
      }
    })
}

// ── 会话初始化 ──────────────────────────────

function initSession() {
  var draft = loadDraft()
  if (draft && draft.phase && draft.phase !== PHASE.DONE && draft.draft && draft.draft.petName) {
    if (draft.phase === PHASE.ANALYZING) draft.phase = PHASE.PHOTO
    if (draft.phase === PHASE.RESULT) {
      draft.phase = draft.draft.diagnosisResult && draft.draft.diagnosisResult.success
        ? PHASE.FOLLOW_UP
        : PHASE.PHOTO
    }
    if (!Array.isArray(draft.messages)) draft.messages = []
    return { session: draft, restored: true }
  }
  var session = createNewSession()
  var msgData = getDoctorMessage(PHASE.GREETING, session.draft)
  session.messages = [{ id: createId(), role: 'doctor', text: msgData.text, quickReplies: msgData.quickReplies, inputType: msgData.inputType, placeholder: msgData.placeholder, timestamp: Date.now() }]
  saveDraft(session)
  return { session: session, restored: false }
}

function initSessionWithProfile(profile) {
  var session = createSessionWithProfile(profile)
  var msgData = getDoctorMessage(PHASE.COMPLAINT, session.draft)
  session.messages = [{ id: createId(), role: 'doctor', text: msgData.text, quickReplies: msgData.quickReplies, inputType: msgData.inputType, placeholder: msgData.placeholder, timestamp: Date.now() }]
  saveDraft(session)
  return { session: session, restored: false }
}

function quickReplyToText(qr) { return qr.label }
function canSaveProfile(d) { return !!(d.petName && d.petType && d.gender && d.age) }

function buildPetInfoForDiagnose(draft) {
  return {
    species: draft.petType, petType: draft.petType, petTypeLabel: draft.petTypeLabel,
    breed: draft.breed, gender: draft.gender, genderLabel: draft.genderLabel,
    age: draft.age, ageLabel: draft.ageLabel, weight: draft.weight,
    sterilized: draft.sterilized, sterilizedLabel: draft.sterilizedLabel,
    allergy: draft.allergy, medicalHistory: draft.medicalHistory,
    bodyPart: draft.bodyPart, bodyPartLabel: draft.bodyPartLabel,
    complaint: buildComplaintText(draft),
    imageRoles: draft.photoPaths.map(function () { return '' }),
    lesionBoxes: draft.lesionBoxes, modelProvider: 'qwen', useKnowledgeBase: true
  }
}

function buildComplaintText(draft) {
  var parts = [draft.complaint]
  if (draft.bodyPartLabel) parts.push('患处：' + draft.bodyPartLabel)
  if (draft.symptoms && draft.symptoms.length > 0) {
    var labels = { 'itching': '瘙痒', 'hair_loss': '掉毛', 'scratching': '抓挠', 'crusting': '结痂', 'oozing': '渗出', 'redness': '红肿', 'scaling': '脱屑', 'lump': '肿块' }
    parts.push('症状：' + draft.symptoms.map(function (s) { return labels[s] || s }).join('、'))
  }
  if (draft.duration) parts.push('持续时间：' + draft.duration)
  if (draft.medication) parts.push('用药：' + draft.medication)
  return parts.filter(Boolean).join('；')
}

function cleanText(text) {
  if (!text) return ''
  return text.replace(/^[•·●◆■▪▫\-\*\d+\.、\)]+\s*/gm, '').replace(/[•·●◆■▪▫]/g, '').trim()
}

function splitAdvice(text) {
  if (!text) return []
  var lines = text.split(/[\n；;]+/)
  var result = []
  for (var i = 0; i < lines.length; i++) { var l = cleanText(lines[i]); if (l && l.length > 1) result.push(l) }
  return result
}

module.exports = {
  PHASE: PHASE,
  TYPE_OPTIONS: TYPE_OPTIONS, GENDER_OPTIONS: GENDER_OPTIONS, AGE_OPTIONS: AGE_OPTIONS,
  BODY_PART_OPTIONS: BODY_PART_OPTIONS,
  createNewSession: createNewSession, createSessionWithProfile: createSessionWithProfile,
  initSession: initSession, initSessionWithProfile: initSessionWithProfile,
  processUserInput: processUserInput, getDoctorMessage: getDoctorMessage,
  formatResultMessage: formatResultMessage, saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
  canSaveProfile: canSaveProfile, quickReplyToText: quickReplyToText,
  buildPetInfoForDiagnose: buildPetInfoForDiagnose, buildComplaintText: buildComplaintText,
  cleanText: cleanText, splitAdvice: splitAdvice
}
