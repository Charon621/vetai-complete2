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
  { keyword: '呼吸困难', keywordAlt: ['呼吸急促', '喘气'], urgency: 'emergency', desc: '呼吸困难' },
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
  var isCat = species === '猫'
  var commonRules = [
    '常见病优先规则：除非图片有非常典型的罕见病证据，否则先按常见皮肤问题解释，不要自作聪明。',
    '瘙痒、抓挠、舔咬、红斑、脱毛、结痂这类普通表现，优先考虑：过敏/特应性皮炎、跳蚤或其他外寄生虫、浅表细菌感染/脓皮病、马拉色菌/酵母过度增殖、外伤或舔咬刺激。',
    '感染和马拉色菌常常是继发问题，不要一看到红肿就直接写罕见免疫病、内分泌病或肿瘤。',
    '跳蚤过敏常见：犬多见尾根、腰背、后躯、腹股沟瘙痒；猫多见头颈、背部、尾根、自咬脱毛或粟粒性结痂。看不到跳蚤也不能排除。',
    '浅表脓皮病常见：丘疹、脓疱、环形表皮领圈、结痂、鳞屑、局部脱毛，常继发于过敏或寄生虫。',
    '爪部/趾间反复舔咬红肿，优先考虑过敏性趾间炎、继发细菌或酵母感染、接触刺激。',
    '耳部黑褐色分泌物或频繁甩头抓耳，优先考虑耳螨、马拉色菌性外耳炎、细菌性外耳炎。',
    '急性潮湿、红肿、渗出、被舔咬扩大的一片，犬优先考虑急性湿性皮炎（热点）或继发感染。',
    '圆形脱毛伴鳞屑，尤其幼猫、多宠家庭或人也有皮损时，才把皮肤癣菌病排前。',
    '只有出现结节肿块、色素快速变化、溃疡不愈、明显全身症状、对称性慢性脱毛等强证据时，才考虑肿瘤、内分泌病、免疫介导病等低基线疾病。',
    '输出候选项 2 到 3 个即可；第一项通常应是最常见且最符合图像的方向。解释要短，别写复杂病理。'
  ]
  if (isCat) {
    commonRules.push('猫的普通皮肤问题优先考虑：跳蚤过敏/粟粒性皮炎、猫癣、耳螨或外耳炎、过敏性皮炎、下巴痤疮、舔咬导致的自损脱毛。')
  } else {
    commonRules.push('犬的普通皮肤问题优先考虑：过敏性皮炎、跳蚤过敏、浅表脓皮病、马拉色菌、热点、趾间炎、疥螨或蠕形螨。')
  }
  return commonRules.join('\n')
}

module.exports = {
  RED_LINE_SYMPTOMS: RED_LINE_SYMPTOMS,
  checkRedLines: checkRedLines,
  getMaxUrgency: getMaxUrgency,
  buildCommonFirstPrompt: buildCommonFirstPrompt
}
