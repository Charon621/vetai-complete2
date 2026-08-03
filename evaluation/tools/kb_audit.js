#!/usr/bin/env node
/**
 * 知识库结构审计：对 utils/kb.js 的 66 条知识卡做内容质量与检索行为体检。
 *
 * 边界（evaluation/README.md 与 benchmark_config.json 已明令）：
 *   本工具**不涉及任何参考标签，也不计算诊断准确率**。它只做两类可确定性判定的检查：
 *     1. 知识卡自身的结构问题——字段缺失、别名冲突、条目语义重叠、物种/紧急度分布；
 *     2. 检索函数的行为问题——用固定的合成主诉探针，断言"这句话不该检出那个病"。
 *   探针的期望值来自可判定的检索逻辑（如"下巴上的小疙瘩不应命中肿瘤条目"），
 *   不是临床参考标准，因此与冻结集的泄漏控制无关，可随时运行。
 *
 * 用法：
 *   node evaluation/tools/kb_audit.js
 *   node evaluation/tools/kb_audit.js --out evaluation/runs/kb_audit_$(date +%Y%m%d).json
 *   node evaluation/tools/kb_audit.js --self-test
 *
 * 退出码：0 = 无阻断性问题；1 = 存在 P0 级问题（可用于 CI 门禁）。
 */

'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

global.wx = global.wx || {
  getStorageSync: function () { return [] },
  setStorageSync: function () {},
  request: function () { throw new Error('kb_audit 不应发起网络请求') }
}

const kb = require(path.join(ROOT, 'utils', 'kb'))
const KB_SRC = fs.readFileSync(path.join(ROOT, 'utils', 'kb.js'), 'utf8')

// --------------------------------------------------------------------------
// 参数
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { out: null, selfTest: false, quiet: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--self-test') opts.selfTest = true
    else if (a === '--quiet') opts.quiet = true
    else if (a === '--help' || a === '-h') opts.help = true
  }
  return opts
}

// --------------------------------------------------------------------------
// 检查项
// --------------------------------------------------------------------------

/**
 * 无品种易感性的条目——外伤、叮咬、感染性/机会性疾病等本来就与品种无关，
 * 硬填品种反而会制造假的品种先验。这些条目缺 keywords.breeds 是设计而非缺陷，
 * 列入白名单避免每次审计刷屏、把真正的缺失掩盖掉。
 */
const BREEDLESS_BY_DESIGN = [
  '接触性皮炎',
  '猫浆细胞性足炎',
  '猫注射部位肉瘤',
  '蜱虫叮咬',
  '蚊虫叮咬/昆虫过敏',
  '脓肿/蜂窝织炎',
  '皮肤创伤/擦伤',
  '姬螯螨病（行走的皮屑）',
  '虱感染',
  '细菌性甲感染',
  '真菌性甲感染（甲癣）'
]

/** 字段完整性 */
function checkFieldCompleteness(DB) {
  const fields = ['typicalFeatures', 'ddx', 'urgency', 'category', 'recommendedTests', 'redFlags']
  const kwFields = ['breeds', 'symptoms', 'locations']
  const missing = {}
  fields.forEach(function (f) { missing[f] = [] })
  kwFields.forEach(function (f) { missing['keywords.' + f] = [] })

  DB.forEach(function (d) {
    fields.forEach(function (f) {
      const v = d[f]
      const empty = !v || (Array.isArray(v) && v.length === 0)
      if (empty) missing[f].push(d.name)
    })
    const k = d.keywords || {}
    kwFields.forEach(function (f) {
      if (f === 'breeds' && BREEDLESS_BY_DESIGN.indexOf(d.name) >= 0) return
      if (!(k[f] || []).length) missing['keywords.' + f].push(d.name)
    })
  })
  return missing
}

/**
 * 别名冲突：同一个别名被多个条目占用。
 *
 * 同物种同名会造成互相加分，属于真冲突（blocking）。
 * 跨物种同名（如「晒伤」同时属于日光性皮炎（犬）和猫日光性皮炎（猫））
 * 对 search() 检索不构成冲突，但 BUG-L9 之后对 applyExclusionRules() 排除链路
 * 必须按物种消歧——候选别名命中的多张卡会先按宠物物种过滤，无法唯一消歧时
 * 保守保留。因此这里单独列出 crossSpecies，供审计确认消歧行为有探针覆盖，
 * 不再标成 benign。
 */
function checkAliasCollisions(DB) {
  const byName = {}
  DB.forEach(function (d) { byName[d.name] = d })

  const owner = {}
  const collisions = []
  const crossSpecies = []

  function speciesOverlap(a, b) {
    const sa = (byName[a] && byName[a].species) || []
    const sb = (byName[b] && byName[b].species) || []
    return sa.some(function (s) { return sb.indexOf(s) >= 0 })
  }

  DB.forEach(function (d) {
    const keys = [d.name].concat(d.aliases || [])
    keys.forEach(function (a) {
      if (owner[a] && owner[a] !== d.name) {
        const rec = { alias: a, owners: [owner[a], d.name] }
        if (speciesOverlap(owner[a], d.name)) collisions.push(rec)
        else crossSpecies.push(rec)
      } else if (!owner[a]) {
        owner[a] = d.name
      }
    })
  })
  return { blocking: collisions, crossSpecies: crossSpecies }
}

/** 条目名语义重叠（一个名字是另一个的子串，去掉括号后比较） */
function checkNameOverlap(DB) {
  const names = DB.map(function (d) { return d.name })
  const pairs = []
  names.forEach(function (a, i) {
    names.slice(i + 1).forEach(function (b) {
      const sa = a.replace(/[（(].*?[)）]/g, '')
      const sb = b.replace(/[（(].*?[)）]/g, '')
      if (sa && sb && (sa.indexOf(sb) >= 0 || sb.indexOf(sa) >= 0)) {
        pairs.push([a, b])
      }
    })
  })
  return pairs
}

/** 分布统计 */
function checkDistribution(DB) {
  const species = { dogOnly: 0, catOnly: 0, both: 0, none: 0 }
  const urgency = {}
  const category = {}
  DB.forEach(function (d) {
    const s = d.species || []
    const hasDog = s.indexOf('犬') >= 0
    const hasCat = s.indexOf('猫') >= 0
    if (hasDog && hasCat) species.both++
    else if (hasDog) species.dogOnly++
    else if (hasCat) species.catOnly++
    else species.none++
    urgency[d.urgency || 'undefined'] = (urgency[d.urgency || 'undefined'] || 0) + 1
    category[d.category || 'undefined'] = (category[d.category || 'undefined'] || 0) + 1
  })
  return { species: species, urgency: urgency, category: category }
}

/**
 * 症状词表长度离散度：词表越长命中机会越多，是一层没设计过的隐性检索偏置。
 *
 * K4 之后词表长度本身没变（也不该变——词表是知识内容），变的是打分：
 * 每张卡带一个 signWeight 折扣。所以这里同时报两个数：
 *   rawRatio —— 词表长度本身的极差，反映知识内容的不均衡；
 *   effectiveRatio —— 长度 × signWeight 的极差，反映**实际残留**的打分偏置。
 * 判断归一化是否生效，看 effectiveRatio 而不是 rawRatio。
 */
function checkSymptomBalance(DB) {
  const counts = DB.map(function (d) {
    return { name: d.name, n: ((d.keywords || {}).symptoms || []).length }
  }).sort(function (a, b) { return b.n - a.n })
  const total = counts.reduce(function (s, x) { return s + x.n }, 0)
  const max = counts[0]
  const min = counts[counts.length - 1]

  const eff = DB.map(function (d) {
    const n = d.signVocabSize || 1
    return { name: d.name, e: n * (typeof d.signWeight === 'number' ? d.signWeight : 1) }
  }).sort(function (a, b) { return b.e - a.e })
  const effMax = eff[0]
  const effMin = eff[eff.length - 1]

  return {
    mean: +(total / counts.length).toFixed(2),
    max: max,
    min: min,
    ratio: +(max.n / Math.max(1, min.n)).toFixed(2),
    effectiveRatio: +(effMax.e / Math.max(0.01, effMin.e)).toFixed(2),
    signWeightRange: [
      Math.min.apply(null, DB.map(function (d) { return d.signWeight || 1 })),
      Math.max.apply(null, DB.map(function (d) { return d.signWeight || 1 }))
    ],
    top5: counts.slice(0, 5),
    bottom5: counts.slice(-5)
  }
}

/** combo 规则覆盖率；高危类是否有 combo 支撑 */
function checkComboCoverage(DB) {
  const withCombo = []
  // 三个来源：① 仍按病名硬编码的规则；② COMBO_GROUPS 分组规则（K5 后物种条目共享）；
  //          ③ HIGH_RISK_COMBOS 声明式表（K3 给高危/低频条目补的严格门槛）
  const re = /name === '([^']+)'/g
  let m
  while ((m = re.exec(KB_SRC)) !== null) {
    if (withCombo.indexOf(m[1]) < 0) withCombo.push(m[1])
  }
  const groups = kb.COMBO_GROUPS || {}
  Object.keys(groups).forEach(function (key) {
    (groups[key] || []).forEach(function (name) {
      if (withCombo.indexOf(name) < 0) withCombo.push(name)
    })
  })
  ;(kb.HIGH_RISK_COMBOS || []).forEach(function (rule) {
    if (withCombo.indexOf(rule.name) < 0) withCombo.push(rule.name)
  })
  const HIGH_RISK = ['mass', 'autoimmune', 'endocrine', 'rare_warning']
  const highRiskWithout = DB.filter(function (d) {
    if (HIGH_RISK.indexOf(d.category) < 0) return false
    const named = withCombo.indexOf(d.name) >= 0
    const categoryLevel = d.category === 'mass' && KB_SRC.indexOf("category === 'mass'") >= 0
    return !named && !categoryLevel
  }).map(function (d) { return d.name + '[' + d.category + ']' })
  return {
    total: DB.length,
    withCombo: withCombo.length,
    coverage: +(withCombo.length / DB.length * 100).toFixed(1),
    highRiskWithoutCombo: highRiskWithout
  }
}

/**
 * 检索行为探针。
 * expectAbsent：这句主诉不该检出的条目（可判定的错配）。
 * expectPresent：这句主诉应当检出的条目。
 * 期望值来自检索逻辑本身，不是临床参考标准。
 */
const PROBES = [
  {
    id: 'colloquial-bump-not-tumor',
    severity: 'P0',
    desc: '口语「小疙瘩」不应被读作肿块/结节而命中肿瘤条目',
    query: { species: '犬', breed: '泰迪', bodyPart: '下巴', complaint: '下巴上有小疙瘩' },
    expectAbsent: ['皮肤肿瘤（肥大细胞瘤等）']
  },
  {
    id: 'owner-symptom-not-pet-lesion',
    severity: 'P0',
    desc: '主人自身症状不应被当作宠物皮损（且应作为人畜共患线索）',
    query: { species: '犬', breed: '田园犬', bodyPart: '耳部', complaint: '痒得很厉害一直抓，耳朵边缘和肘部结痂，我手上也起小疙瘩痒' },
    expectAbsent: ['皮肤肿瘤（肥大细胞瘤等）'],
    expectPresent: ['疥螨病']
  },
  {
    id: 'papules-not-mass',
    severity: 'P0',
    desc: '「小红疙瘩」应指向丘疹/脓疱方向，不应同时注入肿块',
    query: { species: '犬', breed: '泰迪', bodyPart: '腹部', complaint: '起了好多小红疙瘩，密密麻麻的' },
    expectAbsent: ['皮肤肿瘤（肥大细胞瘤等）']
  },
  {
    id: 'true-mass-still-hits',
    severity: 'P1',
    desc: '真正的硬块主诉仍应命中肿瘤条目（修复不能矫枉过正）',
    query: { species: '犬', breed: '金毛', bodyPart: '躯干', complaint: '身上有个硬疙瘩越来越大，表面破溃了' },
    expectPresent: ['皮肤肿瘤（肥大细胞瘤等）']
  },
  {
    id: 'feline-scabies-parity',
    severity: 'P1',
    desc: '猫疥螨应与犬疥螨有同等召回（combo 规则不应只绑犬条目）',
    query: { species: '猫', breed: '英短', bodyPart: '耳部', complaint: '痒得不行一直挠，耳朵边缘结痂' },
    expectPresent: ['猫疥螨病']
  },
  {
    id: 'generic-complaint-abstains',
    severity: 'P1',
    desc: '泛词主诉不应有条目进入 prompt（证据不足不注入）',
    query: { species: '犬', breed: '泰迪', bodyPart: '腹部', complaint: '有点痒，红红的' },
    expectNoPromptWorthy: true
  },
  {
    id: 'species-filter-holds',
    severity: 'P1',
    desc: '犬专属条目不应出现在猫的检索结果中',
    query: { species: '猫', breed: '英短', bodyPart: '背部', complaint: '突然烂了一块，湿湿的渗水，一直舔' },
    expectAbsent: ['急性湿性皮炎（热点）', '浅表脓皮病', '疥螨病']
  },
  // ── K3：高危/低频条目的组合门槛，两个方向都要守 ──
  {
    id: 'high-risk-fires-on-evidence',
    severity: 'P1',
    desc: '证据齐备时高危条目应被召回（此前 autoimmune/endocrine 无 combo，该敏感的不敏感）',
    query: { species: '犬', breed: '腊肠', bodyPart: '躯干', complaint: '躯干两侧对称掉毛，皮肤变薄，喝水多尿多，肚子变大' },
    expectPresent: ['库兴综合征相关皮肤改变']
  },
  {
    id: 'high-risk-abstains-on-generic',
    severity: 'P0',
    desc: '泛词主诉不得把免疫病/内分泌病/罕见病推进 prompt',
    query: { species: '犬', breed: '泰迪', bodyPart: '躯干', complaint: '身上有点掉毛，有结痂' },
    expectAbsent: ['落叶型天疱疮', '红斑型天疱疮', '盘状红斑狼疮', '库兴综合征相关皮肤改变', '雪纳瑞粉刺综合征']
  },
  {
    id: 'pyoderma-not-duplicated',
    severity: 'P1',
    desc: 'K7 合并后，典型脓皮病主诉不应再有两条同实体条目占用 top3',
    query: { species: '犬', breed: '法斗', bodyPart: '腹部', complaint: '肚子上很多小红疙瘩和脓疱，有结痂，掉毛' },
    expectPresent: ['浅表脓皮病'],
    expectAbsent: ['毛囊炎']
  }
]

function runProbes() {
  return PROBES.map(function (p) {
    const results = kb.search(p.query) || []
    const names = results.map(function (r) { return r.name })
    const worthy = results.filter(kb.isPromptWorthyResult)
    const worthyNames = worthy.map(function (r) { return r.name })

    const violations = []
    ;(p.expectAbsent || []).forEach(function (n) {
      if (worthyNames.indexOf(n) >= 0) {
        const hit = worthy.filter(function (r) { return r.name === n })[0]
        violations.push('不应入 prompt 却入了: ' + n + ' (score=' + (hit.score || 0).toFixed(1) +
          ', urgency=' + hit.urgency + ')')
      }
    })
    ;(p.expectPresent || []).forEach(function (n) {
      if (worthyNames.indexOf(n) < 0) {
        const inTop = names.indexOf(n) >= 0
        violations.push('应入 prompt 却未入: ' + n + (inTop ? '（在结果里但未过 worthy 阈值）' : '（未进前三）'))
      }
    })
    if (p.expectNoPromptWorthy && worthy.length > 0) {
      violations.push('泛词主诉不应有条目入 prompt，实际有 ' + worthy.length + ' 条')
    }

    return {
      id: p.id,
      severity: p.severity,
      desc: p.desc,
      complaint: p.query.complaint,
      top3: results.slice(0, 3).map(function (r) {
        return {
          name: r.name,
          score: +(r.score || 0).toFixed(1),
          promptWorthy: kb.isPromptWorthyResult(r),
          urgency: r.urgency
        }
      }),
      pass: violations.length === 0,
      violations: violations
    }
  })
}

// --------------------------------------------------------------------------
// BUG-L8/BUG-L9：排除规则行为探针（真实入口 applyExclusionRules）
// 与上面的 search 探针互补：search 测“该不该检索到”，这里测“排除后该不该留”。
// --------------------------------------------------------------------------
const EXCLUSION_PROBES = [
  // 部位父子映射：粗粒度页面入参不得误删合法候选
  { id: 'loc-cat-acne-head', desc: '猫+头部+猫痤疮 应保留（下颏/唇是头部子部位）', petInfo: { species: '猫', bodyPart: 'head', bodyPartLabel: '头部' }, candidate: '猫痤疮', expectKept: true },
  { id: 'loc-demodex-limbs', desc: '犬+四肢+蠕形螨病（局灶型）应保留（locations 含前肢/爪部）', petInfo: { species: '犬', bodyPart: 'limbs', bodyPartLabel: '四肢' }, candidate: '蠕形螨病（局灶型）', expectKept: true },
  { id: 'loc-egc-limbs', desc: '猫+四肢+嗜酸性肉芽肿复合体应保留（locations 含大腿/爪部）', petInfo: { species: '猫', bodyPart: 'limbs', bodyPartLabel: '四肢' }, candidate: '嗜酸性肉芽肿复合体', expectKept: true },
  // 反向用例保留：黑/白名单语义不能被父子映射放宽
  { id: 'loc-ear-back-excluded', desc: '犬+背部+耳螨感染应排除（反向用例保持）', petInfo: { species: '犬', bodyPart: 'back', bodyPartLabel: '背部' }, candidate: '耳螨感染', expectKept: false },
  { id: 'loc-ear-ears-kept', desc: '犬+耳部+耳螨感染应保留', petInfo: { species: '犬', bodyPart: 'ears', bodyPartLabel: '耳部' }, candidate: '耳螨感染', expectKept: true },
  // 跨物种同名消歧
  { id: 'alias-sunburn-dog', desc: '犬+腹部+晒伤 应绑犬日光性皮炎并保留', petInfo: { species: '犬', bodyPart: 'abdomen', bodyPartLabel: '腹部' }, candidate: '晒伤', expectKept: true },
  { id: 'alias-solar-dermatitis-dog', desc: '犬+腹部+solar dermatitis 应保留', petInfo: { species: '犬', bodyPart: 'abdomen', bodyPartLabel: '腹部' }, candidate: 'solar dermatitis', expectKept: true },
  { id: 'alias-sunburn-cat-ears', desc: '猫+耳部+晒伤 应绑猫日光性皮炎并保留', petInfo: { species: '猫', bodyPart: 'ears', bodyPartLabel: '耳部' }, candidate: '晒伤', expectKept: true },
  // 年龄规范化（真实页面入参）
  { id: 'age-senior-excluded', desc: '犬+背部+age=senior+老年 热点应排除（非年龄:老年 生效）', petInfo: { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'senior', ageLabel: '老年' }, candidate: '急性湿性皮炎（热点）', expectKept: false },
  { id: 'age-adult-kept', desc: '犬+背部+成年 热点应保留', petInfo: { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'adult', ageLabel: '成年' }, candidate: '急性湿性皮炎（热点）', expectKept: true },
  { id: 'age-unknown-kept', desc: '犬+背部+年龄未知 热点应保留（缺失≠不符合）', petInfo: { species: '犬', bodyPart: 'back', bodyPartLabel: '背部', age: 'unknown', ageLabel: '不确定' }, candidate: '急性湿性皮炎（热点）', expectKept: true },
  { id: 'age-missing-kept', desc: '犬+背部+缺失年龄 热点应保留', petInfo: { species: '犬', bodyPart: 'back', bodyPartLabel: '背部' }, candidate: '急性湿性皮炎（热点）', expectKept: true }
]

function runExclusionProbes() {
  return EXCLUSION_PROBES.map(function (p) {
    const kept = kb.applyExclusionRules([{ name: p.candidate, probability: 80 }], p.petInfo)
    const pass = (kept.length > 0) === p.expectKept
    return {
      id: p.id,
      desc: p.desc,
      pass: pass,
      kept: kept.length > 0,
      violations: pass ? [] : ['候选应' + (p.expectKept ? '保留' : '排除') + '但实际' + (kept.length > 0 ? '保留' : '排除')]
    }
  })
}

/**
 * BUG-L8：规则/locations 一致性——有部位白名单的卡，其自身 keywords.locations
 * 声明的位置（经同义词归一：下巴→下颏、唇部→唇 等，再归一到受控父枚举）
 * 不得被自己的白名单误删。用任一合法父枚举构造页面可表达输入做黑盒验证。
 * 失败项计入 P0，作为 KB 门禁的一部分。
 */
function checkLocationConsistency(DB) {
  const issues = []
  const labelMap = { head: '头部', neck: '颈部', ears: '耳部', back: '背部', abdomen: '腹部', limbs: '四肢', paws: '爪部', tail: '尾部', whole: '全身', other: '其他' }
  DB.forEach(function (card) {
    const exclusions = card.exclusions || []
    const allowedParts = exclusions
      .filter(function (r) { return r.indexOf('仅限部位:') === 0 })
      .map(function (r) { return r.slice(5) })
    if (!allowedParts.length) return
    const locations = (card.keywords && card.keywords.locations) || []
    // 合法枚举集合 = 白名单词归一 ∪ locations 词归一
    const legal = {}
    allowedParts.concat(locations).forEach(function (w) {
      kb.normalizeBodyPartWord(w).forEach(function (parent) { legal[parent] = true })
    })
    const parents = Object.keys(legal)
    if (!parents.length) {
      issues.push({ name: card.name, reason: '白名单与 locations 都无法归一到受控枚举' })
      return
    }
    // 任一合法父枚举输入下卡片都应保留
    let kept = false
    parents.forEach(function (parent) {
      if (kept) return
      const petInfo = {
        species: (card.species && card.species[0]) || '',
        bodyPart: parent,
        bodyPartLabel: labelMap[parent] || parent
      }
      const res = kb.applyExclusionRules([{ name: card.name, probability: 80 }], petInfo)
      kept = res.length > 0
    })
    if (!kept) issues.push({ name: card.name, reason: '自身合法位置被白名单误删：合法枚举 ' + parents.join('/') })
  })
  return issues
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function audit() {
  const DB = kb.DISEASE_KB
  const probes = runProbes()
  const failedP0 = probes.filter(function (p) { return !p.pass && p.severity === 'P0' })
  const exclusionProbes = runExclusionProbes()
  const failedExclusion = exclusionProbes.filter(function (p) { return !p.pass })
  const locationIssues = checkLocationConsistency(DB)
  const p0Failures = failedP0.length + failedExclusion.length + locationIssues.length

  return {
    tool: 'kb_audit',
    kbVersion: kb.KB_VERSION,
    entryCount: DB.length,
    fieldCompleteness: checkFieldCompleteness(DB),
    aliasCollisions: checkAliasCollisions(DB),
    nameOverlap: checkNameOverlap(DB),
    distribution: checkDistribution(DB),
    symptomBalance: checkSymptomBalance(DB),
    comboCoverage: checkComboCoverage(DB),
    hasBreedSusceptibilityAccessor: typeof kb.getBreedSusceptibility === 'function',
    probes: probes,
    exclusionProbes: exclusionProbes,
    locationConsistencyIssues: locationIssues,
    summary: {
      probesTotal: probes.length + exclusionProbes.length,
      probesPassed: probes.filter(function (p) { return p.pass }).length + exclusionProbes.filter(function (p) { return p.pass }).length,
      p0Failures: p0Failures,
      blocking: p0Failures > 0
    }
  }
}

function printReport(r) {
  console.log('知识库审计 — KB_VERSION=' + r.kbVersion + '，条目 ' + r.entryCount)
  console.log('')

  console.log('[字段完整性]')
  let anyMissing = false
  Object.keys(r.fieldCompleteness).forEach(function (f) {
    const list = r.fieldCompleteness[f]
    if (!list.length) return
    anyMissing = true
    console.log('  缺 ' + f + '：' + list.length + ' 条' +
      (list.length <= 12 ? ' → ' + list.join('、') : ''))
  })
  if (!anyMissing) console.log('  全部字段无缺失')
  console.log('')

  console.log('[别名冲突] ' + r.aliasCollisions.blocking.length + ' 处（同物种，会互相加分）')
  r.aliasCollisions.blocking.forEach(function (c) {
    console.log('  ! 「' + c.alias + '」→ ' + c.owners.join(' / '))
  })
  if (r.aliasCollisions.crossSpecies.length) {
    console.log('  跨物种同名 ' + r.aliasCollisions.crossSpecies.length +
      ' 处（BUG-L9 已按物种消歧，见排除探针）：')
    r.aliasCollisions.crossSpecies.forEach(function (c) {
      console.log('    · 「' + c.alias + '」→ ' + c.owners.join(' / '))
    })
  }
  console.log('')

  console.log('[条目语义重叠] ' + r.nameOverlap.length + ' 对')
  r.nameOverlap.forEach(function (p) { console.log('  ~ ' + p[0] + ' ⇄ ' + p[1]) })
  console.log('')

  console.log('[分布] 仅犬 ' + r.distribution.species.dogOnly +
    ' / 仅猫 ' + r.distribution.species.catOnly +
    ' / 通用 ' + r.distribution.species.both +
    ' / 未标 ' + r.distribution.species.none)
  console.log('  urgency: ' + JSON.stringify(r.distribution.urgency))
  console.log('')

  console.log('[症状词表均衡] 均值 ' + r.symptomBalance.mean +
    '，词表长度极差 ' + r.symptomBalance.ratio + 'x' +
    '（' + r.symptomBalance.max.name + ' ' + r.symptomBalance.max.n +
    ' vs ' + r.symptomBalance.min.name + ' ' + r.symptomBalance.min.n + '）')
  console.log('  K4 归一化后实际残留偏置 ' + r.symptomBalance.effectiveRatio + 'x' +
    '（signWeight ' + r.symptomBalance.signWeightRange[0] +
    ' ~ ' + r.symptomBalance.signWeightRange[1] + '）')
  console.log('')

  console.log('[combo 覆盖] ' + r.comboCoverage.withCombo + '/' + r.comboCoverage.total +
    ' = ' + r.comboCoverage.coverage + '%')
  if (r.comboCoverage.highRiskWithoutCombo.length) {
    console.log('  无 combo 的高危条目 ' + r.comboCoverage.highRiskWithoutCombo.length + ' 个：')
    console.log('    ' + r.comboCoverage.highRiskWithoutCombo.join('、'))
  }
  console.log('')

  console.log('[品种先验访问器] getBreedSusceptibility: ' +
    (r.hasBreedSusceptibilityAccessor ? '已实现' : '未实现（B2 品种先验注入将不生效）'))
  console.log('')

  console.log('[检索行为探针] ' + r.summary.probesPassed + '/' + r.summary.probesTotal + ' 通过')
  r.probes.forEach(function (p) {
    console.log('  ' + (p.pass ? '✓' : '✗') + ' [' + p.severity + '] ' + p.id + ' — ' + p.desc)
    if (!p.pass) {
      console.log('     主诉：' + p.complaint)
      console.log('     top3：' + p.top3.map(function (t) {
        return t.name + '(' + t.score + (t.promptWorthy ? '入' : '未入') + ')'
      }).join(' | '))
      p.violations.forEach(function (v) { console.log('     → ' + v) })
    }
  })
  console.log('')
  console.log('[排除规则行为探针] ' + r.exclusionProbes.filter(function (p) { return p.pass }).length +
    '/' + r.exclusionProbes.length + ' 通过（部位父子映射/跨物种消歧/年龄规范化）')
  r.exclusionProbes.forEach(function (p) {
    console.log('  ' + (p.pass ? '✓' : '✗') + ' ' + p.id + ' — ' + p.desc)
    if (!p.pass) p.violations.forEach(function (v) { console.log('     → ' + v) })
  })
  console.log('')
  console.log('[规则/locations 一致性] ' +
    (r.locationConsistencyIssues.length === 0 ? '全部有白名单的卡均未被自身白名单误删' :
      r.locationConsistencyIssues.length + ' 处问题'))
  r.locationConsistencyIssues.forEach(function (iss) {
    console.log('  ✗ ' + iss.name + ' — ' + iss.reason)
  })
  console.log('')

  if (r.summary.blocking) {
    console.log('结论：存在 ' + r.summary.p0Failures + ' 个 P0 级失败，阻断快路径解冻。')
  } else {
    console.log('结论：无 P0 级失败。')
  }
}

function selfTest() {
  const checks = []
  function assert(name, cond) {
    checks.push({ name: name, pass: !!cond })
  }
  const DB = kb.DISEASE_KB
  assert('知识库非空', DB && DB.length > 0)
  assert('search 返回数组', Array.isArray(kb.search({ species: '犬', complaint: '红肿' })))
  assert('isPromptWorthyResult 是函数', typeof kb.isPromptWorthyResult === 'function')
  assert('别名冲突检测可运行', Array.isArray(checkAliasCollisions(DB).blocking))
  assert('别名冲突区分跨物种', Array.isArray(checkAliasCollisions(DB).crossSpecies))
  assert('探针可运行', runProbes().length === PROBES.length)
  assert('探针含 P0 项', PROBES.some(function (p) { return p.severity === 'P0' }))
  assert('排除行为探针可运行', runExclusionProbes().length === EXCLUSION_PROBES.length)
  assert('排除行为探针全绿', runExclusionProbes().every(function (p) { return p.pass }))
  assert('locations 一致性审计可运行', Array.isArray(checkLocationConsistency(DB)))
  assert('locations 一致性无失败', checkLocationConsistency(DB).length === 0)

  checks.forEach(function (c) {
    console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name)
  })
  const failed = checks.filter(function (c) { return !c.pass }).length
  console.log(failed ? '自检失败 ' + failed + ' 项' : '自检全部通过')
  return failed === 0
}

function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log('用法: node evaluation/tools/kb_audit.js [--out FILE] [--self-test] [--quiet]')
    process.exit(0)
  }
  if (opts.selfTest) {
    process.exit(selfTest() ? 0 : 1)
  }

  const report = audit()
  if (!opts.quiet) printReport(report)

  if (opts.out) {
    const dir = path.dirname(opts.out)
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2), 'utf8')
    console.log('审计日志已写入: ' + opts.out)
  }

  process.exit(report.summary.blocking ? 1 : 0)
}

if (require.main === module) main()

module.exports = {
  audit: audit,
  runProbes: runProbes,
  PROBES: PROBES,
  EXCLUSION_PROBES: EXCLUSION_PROBES,
  runExclusionProbes: runExclusionProbes,
  checkLocationConsistency: checkLocationConsistency,
  checkAliasCollisions: checkAliasCollisions,
  checkComboCoverage: checkComboCoverage
}
