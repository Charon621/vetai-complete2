// ============================================================
// utils/knowledge.js
// 诊断护栏：症状红线 + 常见病优先规则
// 知识库检索已迁移至 utils/kb.js（RAG）
// ============================================================

/**
 * 症状红线表 — 匹配到任何一条，强制升级 urgency
 */
var RED_LINE_SYMPTOMS = [
  { keyword: '快速扩散', keywordAlt: ['迅速扩大', '快速蔓延', '扩散迅速'], urgency: 'urgent', desc: '皮损快速扩散' },
  { keyword: '大面积破溃', keywordAlt: ['大面积溃烂', '广泛破溃'], urgency: 'urgent', desc: '大面积皮肤破溃' },
  { keyword: '流脓', keywordAlt: ['脓性分泌物', '脓液', '有脓'], urgency: 'urgent', desc: '脓性分泌物' },
  { keyword: '精神食欲', keywordAlt: ['精神不好', '不吃东西', '食欲下降', '食欲减退', '萎靡'], urgency: 'urgent', desc: '精神食欲异常' },
  { keyword: '面部肿胀', keywordAlt: ['脸部肿胀', '眼周肿胀', '面部水肿'], urgency: 'emergency', desc: '面部/眼周肿胀' },
  { keyword: '呼吸困难', keywordAlt: ['呼吸急促', '呼吸费力', '张口呼吸', '发绀'], urgency: 'emergency', desc: '呼吸困难' },
  { keyword: '剧烈疼痛', keywordAlt: ['明显疼痛', '触碰疼痛', '触碰叫'], urgency: 'urgent', desc: '明显疼痛反应' },
  { keyword: '全身性', keywordAlt: ['全身多处', '全身扩散', '遍布全身'], urgency: 'urgent', desc: '全身性皮损' }
]

/**
 * 检查文本是否触发症状红线
 * 返回触发的红线列表（可能为空）
 */
function checkRedLines(text) {
  if (!text) return []
  var triggered = []
  for (var i = 0; i < RED_LINE_SYMPTOMS.length; i++) {
    var rule = RED_LINE_SYMPTOMS[i]
    var allKeywords = [rule.keyword].concat(rule.keywordAlt || [])
    for (var j = 0; j < allKeywords.length; j++) {
      if (text.indexOf(allKeywords[j]) >= 0) {
        triggered.push({ urgency: rule.urgency, desc: rule.desc, matched: allKeywords[j] })
        break
      }
    }
  }
  return triggered
}

/**
 * 获取最高级别的 urgency
 */
function getMaxUrgency(current, redLines) {
  var levels = { 'low': 0, 'moderate': 1, 'urgent': 2, 'emergency': 3 }
  var max = levels[current] || 1
  for (var i = 0; i < redLines.length; i++) {
    var rl = levels[redLines[i].urgency] || 0
    if (rl > max) max = rl
  }
  var keys = Object.keys(levels)
  for (var k = 0; k < keys.length; k++) {
    if (levels[keys[k]] === max) return keys[k]
  }
  return current
}

/**
 * 常见病优先规则（防止模型过度诊断罕见病）
 */
function buildCommonFirstPrompt(species) {
  // BUG-10：覆盖清单只核对病例证据，去除形态到病名的硬映射与强排除。
  var isCat = species === '猫'
  var isDog = species === '犬'

  if (!isCat && !isDog) {
    return [
      '当前病因初筛能力仅覆盖犬猫；本病例物种未确认或不在已验证范围。',
      '不要套用犬猫疾病清单或给出未验证物种的病因主名。',
      '可以记录照片确实支持的形态、主人已报告的病史和独立分诊建议；必要时先确认动物种类。'
    ].join('\n')
  }

  var checklist = [
    '本清单仅用于内部检查是否遗漏重要方向，不提供固定排序，也不要求把清单中的疾病放入候选。',
    '任何参考方向都可以根据本病例证据降级或全部否定，不得因疾病常见而忽略相反证据或高风险表现。',
    '【部位核对】只核对已获得证据，不用部位名称直接决定疾病。',
    '耳部：结合照片可见分泌物与主人报告的甩头、抓耳等事实，核对耳螨及外耳炎方向；需要耳镜或细胞学区分时明确说明。',
    '爪部或趾间：分别核对过敏、继发感染、接触刺激及外伤可能；舔咬、病程和疼痛属于主人病史，不能伪装成照片所见。',
    '腰背或尾根：核对外寄生虫与过敏等方向的支持和反对证据；没有看见跳蚤不等于已经排除跳蚤相关问题。',
    '面部或下巴：脱毛、鳞屑、黑头等只作为形态证据，不能仅凭部位或一个可见词确定病因。',
    '【形态组合核对】组合用于提出需区分的方向，不作为确诊或硬排除规则。',
    '圆形脱毛、鳞屑或断毛：核对皮肤癣菌病与局部炎症等方向各有什么当前支持、反对及缺失证据；不得仅凭组合排除其他解释。',
    '丘疹、脓疱、表皮环或结痂：核对感染、继发问题及其他可解释形态的方向，不把多个同义形态当成多个独立证据。',
    '脱屑、油脂或红斑：核对酵母相关与其他炎症方向；需要细胞学区分时明确检查需求。',
    '急性潮湿、渗出或舔咬扩大：核对外伤刺激和炎症等方向，不能仅凭模板组合固定主病名。',
    '【病史与多病】考虑原发、继发或并存问题；不同部位与时间的证据分别核对，不强行归为单一疾病。',
    '【高风险核对】结节肿块、不愈溃疡、快速变化或明确全身异常需要保留相应风险和检查建议；不能因为常见方向尚可解释就删掉危险线索。',
    '【证据边界】照片只能支持可见事实。触感、温度、气味、病程、瘙痒与疼痛须有主人报告或检查依据，不能从静态照片补造。',
    '若关键区别只能由尚未获得的触诊、实验室结果或内部视野提供，按系统弃答规则处理病因，保留可支持形态、缺失信息、检查需求与独立分诊。',
    '【候选输出】完整诊断最多2个当前证据允许的候选，不为凑数添加；顺序由本病例证据决定，主名与首候选保持一致。',
    '无法可靠命名病因时，候选留空并说明原因；不要输出隐藏推理，严格遵循系统规定的JSON字段与证据在先的顺序。'
  ]

  if (isCat) {
    checklist.push('猫常见方向覆盖：跳蚤相关或过敏性皮炎、粟粒性表现、皮肤癣菌病、耳螨或外耳炎、下巴痤疮、自损脱毛；仅作遗漏核对，不代表固定排序或本病例结论。')
  } else if (isDog) {
    checklist.push('犬常见方向覆盖：过敏性皮炎、跳蚤相关问题、浅表脓皮病、马拉色菌相关问题、急性湿性皮炎、趾间问题、疥螨或蠕形螨；仅作遗漏核对，不代表固定排序或本病例结论。')
  }

  return checklist.join('\n')
}

module.exports = {
  RED_LINE_SYMPTOMS: RED_LINE_SYMPTOMS,
  checkRedLines: checkRedLines,
  getMaxUrgency: getMaxUrgency,
  buildCommonFirstPrompt: buildCommonFirstPrompt
}
