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
  var isDog = species === '犬'

  var checklist = [
    '【必查1·部位特征】患处部位是否与该部位高发病一致？',
    '  · 耳部→耳螨/马拉色菌性外耳炎/细菌性外耳炎（黑褐色分泌物或频繁甩头抓耳）',
    '  · 爪部/趾间→过敏性趾间炎/继发细菌或酵母感染/接触刺激（反复舔咬红肿）',
    '  · 腰背/尾根→跳蚤过敏（犬多见尾根、腰背、后躯、腹股沟瘙痒；猫多见头颈、背部、尾根）',
    '  · 面部→猫癣（猫，圆形脱毛+鳞屑）；下巴→猫痤疮（黑头+粉刺）',
    '【必查2·症状组合】视觉特征组合是否指向特定病种？',
    '  · 圆形脱毛+灰白鳞屑+断毛→皮肤癣菌病（幼猫和多宠家庭高发，人可被传染，不要写成毛囊炎或痤疮）',
    '  · 丘疹+脓疱+环形表皮领圈+结痂+鳞屑+局部脱毛→浅表脓皮病（常继发于过敏或寄生虫）',
    '  · 脱屑+油脂+红斑→马拉色菌/酵母过度增殖',
    '  · 急性潮湿+红肿+渗出+舔咬扩大→急性湿性皮炎（热点，犬多见）',
    '【必查3·常见病优先】先按高发常见皮肤病解释，除非图片有非常典型的罕见病证据，否则不要把低频病排在第一。',
    '  · 感染和马拉色菌常常是继发问题，不要一看到红肿就直接写罕见免疫病、内分泌病或肿瘤。',
    '  · 瘙痒、抓挠、舔咬、红斑、脱毛、结痂这类普通表现，优先考虑：过敏/特应性皮炎、跳蚤或其他外寄生虫、浅表细菌感染/脓皮病、马拉色菌、外伤或舔咬刺激。看不到跳蚤也不能排除跳蚤过敏。',
    '【必查4·罕见病触发】只有出现以下强证据才考虑肿瘤、内分泌病、免疫介导病等低频疾病：',
    '  · 结节肿块、色素快速变化、溃疡不愈、对称性慢性脱毛、明显全身症状',
    '【必查5·鉴别点】候选项之间必须给出可区分的鉴别要点，不要只列病名。',
    '  · 输出候选项 2 到 3 个即可；第一项应是最常见且最符合图像的方向。解释要短，别写复杂病理。'
  ]

  if (isCat) {
    checklist.push('')
    checklist.push('猫高发病优先序列：猫癣/皮肤癣菌病 > 跳蚤过敏/粟粒性皮炎 > 耳螨 > 马拉色菌 > 猫痤疮 > 过敏性皮炎。')
    checklist.push('猫普通皮肤问题优先考虑：跳蚤过敏/粟粒性皮炎、猫癣、耳螨或外耳炎、过敏性皮炎、下巴痤疮、舔咬导致的自损脱毛。')
  } else if (isDog) {
    checklist.push('')
    checklist.push('犬高发病优先序列：浅表脓皮病 > 特应性皮炎/过敏 > 跳蚤过敏 > 马拉色菌 > 蠕形螨/疥螨 > 热点 > 趾间炎。')
    checklist.push('犬普通皮肤问题优先考虑：过敏性皮炎、跳蚤过敏、浅表脓皮病、马拉色菌、热点、趾间炎、疥螨或蠕形螨。')
  } else {
    checklist.push('')
    checklist.push('高发病通用参考：过敏/特应性皮炎、跳蚤或外寄生虫、浅表细菌感染/脓皮病、马拉色菌/酵母过度增殖。')
  }

  return checklist.join('\n')
}

module.exports = {
  RED_LINE_SYMPTOMS: RED_LINE_SYMPTOMS,
  checkRedLines: checkRedLines,
  getMaxUrgency: getMaxUrgency,
  buildCommonFirstPrompt: buildCommonFirstPrompt
}
