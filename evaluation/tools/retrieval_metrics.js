#!/usr/bin/env node
/**
 * retrieval_metrics.js — B02 排名度量 / 标签映射消费 / casefile 校验 / 快照构建 的纯函数库。
 *
 * BUG-28（B02-1～B02-4）：旧 recall_probe 只有「任一 expected 命中」一个口径，看不出
 * Top-1 排错、主病/并存角色、病族折叠和版本漂移。本文件把全部新增度量实现为**纯函数**
 * —— 数据进出、不发检索、不调模型、不读网络、不修改产品排序（kb.search 的打分与门槛
 * 一律不经过这里）。recall_probe / compare_rankings / tests 只做装配与 IO。
 *
 * 指标口径（B02 定义，见第2轮路线图 B02-1；在结果解读前不得改）：
 *   top1_expected_set  = I(rank1 ∈ expected_set)
 *   mrr_expected_set   = 1 / 首个 expected 成员的名次；未召回为 0
 *   legacy_expected_hit = 旧口径「列表中存在任一 expected」=（first_expected_rank ≠ null）
 *   角色（primary / coexisting）：只有用例带**独立标注的 role** 才计算；否则一律 NA＋原因，
 *   不把 expected 首项或任一成员擅自解释为主病。permitted_differentials 不扩展主病答案。
 *
 * 边界（必须随报告一起读）：
 *   - expected 只是“该主诉最该想到的方向”集合，不是临床参考标准；
 *   - 标签映射只登记当前 69 张知识卡的标签；KB 外正确标签照常参与集合计分，
 *     映射缺失单列「待映射」（unmapped），不得判成病错或物种错；
 *   - 病族折叠只用于“病族层报告”（unique_family_top3），不改 raw 排名。
 *
 * 运行环境：Node 侧工具（evaluation/ 已被 project.config.json packOptions 排除出主包）。
 */
'use strict'

const crypto = require('crypto')

const SNAPSHOT_SCHEMA_VERSION = 'retrieval-snapshot-v1'
const LABEL_MAP_KIND = 'retrieval_label_map'
const CASEFILE_KIND = 'retrieval_casefile'

const SPLITS = ['development', 'regression', 'independent']
const INPUT_ORIGINS = ['owner_verbatim', 'expert_edited', 'manual_simulation', 'synthetic_challenge']
const FEATURE_ORIGINS = ['real_precheck', 'manual_simulation', 'none', 'unknown']
const EXPOSURE_STATES = ['exposed', 'not_exposed', 'unknown']

// ──────────────────────────────── 基础工具 ────────────────────────────────

function sha256Of(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * 规范化 JSON（B02-4 语义哈希）：
 *   - 对象键一律按字典序排列（键顺序不影响哈希）；
 *   - sortArraySets 中列出的键（默认 aliases）按“集合语义”处理：元素先规范化再按
 *     字符串排序——别名登记顺序不参与哈希；
 *   - 其余数组保留顺序语义（recommendedTests 等有序列表换序应视为内容变化）。
 */
function canonicalJson(value, sortArraySets, parentKey) {
  const sets = sortArraySets || ['aliases']
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    if (parentKey && sets.indexOf(parentKey) >= 0) {
      return value
        .map(function (el) { return JSON.stringify(canonicalJson(el, sets, null)) })
        .sort()
        .map(function (s) { return JSON.parse(s) })
    }
    return value.map(function (el) { return canonicalJson(el, sets, null) })
  }
  if (typeof value === 'object') {
    const out = {}
    Object.keys(value).sort().forEach(function (k) {
      out[k] = canonicalJson(value[k], sets, k)
    })
    return out
  }
  return value
}

function semanticStableStringify(value, sortArraySets) {
  return JSON.stringify(canonicalJson(value, sortArraySets, null))
}

/** 卡片内容语义哈希：键序与别名登记顺序不敏感，字段值变化即变化（B02-4 验收口径）。 */
function canonicalCardHash(card) {
  return sha256Of(semanticStableStringify(card, ['aliases']))
}

function uniq(arr) {
  const out = []
  const seen = {}
  ;(arr || []).forEach(function (x) {
    const k = String(x)
    if (!seen[k]) { seen[k] = true; out.push(k) }
  })
  return out
}

function round4(x) {
  return Math.round(x * 10000) / 10000
}

// ──────────────────────────────── B02-1 集合排名指标 ────────────────────────────────

/**
 * expected 集合口径的排名指标。rankedNames 是按名次排序的标签（canonical name）列表；
 * expected 是期望方向数组（重复项自动去重）。空排名（弃权）时全部为 0、名次为 null。
 */
function computeSetMetrics(rankedNames, expected) {
  const ranked = (rankedNames || []).map(String)
  const expectedSet = uniq(expected)
  let firstExpectedRank = null
  let mrr = 0
  let hitsInRanked = 0
  let hitsInTop3 = 0
  for (let i = 0; i < ranked.length; i++) {
    if (expectedSet.indexOf(ranked[i]) >= 0) {
      hitsInRanked++
      if (firstExpectedRank === null) {
        firstExpectedRank = i + 1
        mrr = 1 / (i + 1)
      }
      if (i < 3) hitsInTop3++
    }
  }
  return {
    expected_set: expectedSet,
    ranked_count: ranked.length,
    legacy_expected_hit: firstExpectedRank !== null,
    top1_expected_set: ranked.length > 0 && expectedSet.indexOf(ranked[0]) >= 0 ? 1 : 0,
    mrr_expected_set: round4(mrr),
    first_expected_rank: firstExpectedRank,
    expected_hits_in_ranked: hitsInRanked,
    expected_hits_in_top3: hitsInTop3
  }
}

/** 多例聚合：mean(top1)、mean(mrr)、legacy 命中率。rows 来自 computeSetMetrics 展开后的逐例行。 */
function aggregateSetMetrics(rows) {
  const n = rows.length
  if (!n) return { n: 0, top1_expected_set_rate: null, mrr_expected_set_mean: null, legacy_expected_hit_rate: null }
  let top1 = 0
  let mrr = 0
  let legacy = 0
  rows.forEach(function (r) {
    top1 += r.top1_expected_set ? 1 : 0
    mrr += r.mrr_expected_set
    legacy += r.legacy_expected_hit ? 1 : 0
  })
  return {
    n: n,
    top1_expected_set_rate: round4(top1 / n),
    mrr_expected_set_mean: round4(mrr / n),
    legacy_expected_hit_rate: round4(legacy / n)
  }
}

// ──────────────────────── B02-1/B02-2 角色（primary/coexisting）指标 ────────────────────────

/**
 * 把一个标签解析为“计分等价集合”。规则（B02-2 定义）：
 *   - 只有映射里显式声明 equivalence_set 的标签才扩展到等价成员；
 *   - 父子卡/亚型/物种专卡**不默认等价**：未声明等价集合的标签返回它自身；
 *   - KB 外（映射未登记）标签按其自身计分，不算错误也不猜测。
 */
function resolveEquivalenceSet(label, labelMap) {
  if (!labelMap || !labelMap.labels || !Object.prototype.hasOwnProperty.call(labelMap.labels, label)) {
    return [label]
  }
  const entry = labelMap.labels[label]
  const setName = entry && entry.equivalence_set
  if (!setName || !labelMap.equivalence_sets || !labelMap.equivalence_sets[setName]) {
    return [label]
  }
  const members = labelMap.equivalence_sets[setName].members
  return members && members.length ? uniq(members) : [label]
}

function naBlock(reason) {
  return { applicable: false, reason: reason, value: null }
}

/**
 * 角色（主病/并存病）指标。role 为 null 或缺 primary/coexisting 时，对应指标 NA＋原因，
 * 绝不回退到 expected 集合代替角色（B02-1 验收：不把 expected 擅自解释为主病）。
 *
 * role 结构（与 casefile 的 role 字段一致）：
 *   { primary_target: [标签], coexisting_targets: [标签], permitted_differentials: [标签] }
 *
 * 返回：
 *   primary.top1_primary       = I(rank1 ∈ primary 等价集合)
 *   primary.mrr_primary        = 1 / 首个 primary 等价成员名次；未召回 0
 *   primary.top3_primary_recall= Top-3 内出现任一 primary 等价成员（等价成员互为
 *                                同一疾病的不同显示，按“是否出现”计，不按成员数摊分）
 *   coexisting.top3_coexisting_coverage = |Top-3 内覆盖的并存目标| / |并存目标数|，
 *                                每个并存目标按其等价集合“是否出现”判覆盖
 */
function computeRoleMetrics(rankedNames, role, labelMap) {
  const ranked = (rankedNames || []).map(String)
  const top3 = ranked.slice(0, 3)

  const result = {
    role_present: !!(role && (role.primary_target || role.coexisting_targets)),
    permitted_differentials_note: 'permitted_differentials 不扩展主病/并存答案，仅作候选容许度参考，本批不参与计分',
    primary: naBlock('no_independent_primary_label'),
    coexisting: naBlock('no_independent_coexisting_labels'),
    top1_primary: null,
    mrr_primary: null,
    top3_primary_recall: null,
    top3_coexisting_coverage: null
  }

  const hasPrimary = !!(role && Array.isArray(role.primary_target) && uniq(role.primary_target).length)
  const hasCoexisting = !!(role && Array.isArray(role.coexisting_targets) && uniq(role.coexisting_targets).length)
  if (!hasPrimary && !hasCoexisting) {
    result.primary = naBlock('no_independent_role_labels')
    result.coexisting = naBlock('no_independent_role_labels')
    return result
  }

  if (hasPrimary) {
    const primarySet = uniq(role.primary_target).reduce(function (acc, t) {
      return acc.concat(resolveEquivalenceSet(t, labelMap))
    }, [])
    primarySet.sort()
    let firstRank = null
    let mrr = 0
    let inTop3 = false
    for (let i = 0; i < ranked.length; i++) {
      if (primarySet.indexOf(ranked[i]) >= 0) {
        if (firstRank === null) { firstRank = i + 1; mrr = 1 / (i + 1) }
        if (i < 3) inTop3 = true
      }
    }
    result.primary = {
      applicable: true,
      reason: null,
      primary_equivalence_set: primarySet,
      first_primary_rank: firstRank,
      top1_primary: ranked.length > 0 && primarySet.indexOf(ranked[0]) >= 0 ? 1 : 0,
      mrr_primary: round4(mrr),
      top3_primary_recall: inTop3 ? 1 : 0
    }
    result.top1_primary = result.primary.top1_primary
    result.mrr_primary = result.primary.mrr_primary
    result.top3_primary_recall = result.primary.top3_primary_recall
  } else {
    result.primary = naBlock('primary_target_missing')
  }

  if (hasCoexisting) {
    const covered = []
    const missing = []
    uniq(role.coexisting_targets).forEach(function (t) {
      const set = resolveEquivalenceSet(t, labelMap)
      const found = top3.some(function (name) { return set.indexOf(name) >= 0 })
      if (found) covered.push(t)
      else missing.push(t)
    })
    result.coexisting = {
      applicable: true,
      reason: null,
      targets: uniq(role.coexisting_targets),
      covered: covered,
      missing: missing,
      top3_coexisting_coverage: round4(covered.length / uniq(role.coexisting_targets).length)
    }
    result.top3_coexisting_coverage = result.coexisting.top3_coexisting_coverage
  } else {
    result.coexisting = naBlock('coexisting_targets_missing')
  }

  return result
}

// ──────────────────────── B02-2 病族折叠（只读视图，不改排名） ────────────────────────

/**
 * 把按名次排序的检索条目折叠到病族视图。
 * rankedEntries: [{name, id?, score?}...]（名次即数组序）。
 * 映射未登记的标签进入 unmapped 单列（不判错、不丢弃，照常出现在 raw 列表里）。
 */
function foldByFamily(rankedEntries, labelMap) {
  const entries = rankedEntries || []
  const families = []
  const familyIndex = {}
  const unmapped = []
  entries.forEach(function (e, idx) {
    const name = String(e.name)
    const entry = labelMap && labelMap.labels ? labelMap.labels[name] : null
    if (!entry) {
      unmapped.push({ name: name, id: e.id || null, score: e.score === undefined ? null : e.score, rank: idx + 1 })
      return
    }
    const code = entry.family_code
    if (familyIndex[code] === undefined) {
      familyIndex[code] = families.length
      families.push({
        family_code: code,
        first_rank: idx + 1,
        best_name: name,
        best_id: e.id || null,
        best_score: e.score === undefined ? null : e.score,
        members: [name]
      })
    } else {
      families[familyIndex[code]].members.push(name)
    }
  })
  return { unique: families, unmapped: unmapped }
}

// ──────────────────────── B02-2 标签映射装载与校验 ────────────────────────

/**
 * 校验 retrieval_label_map.json 的结构与纪律。返回 {ok, errors, warnings, version, entryCount}。
 * 纪律：等价集合成员必须全部是已登记标签；subtypes/亚型不得借等价集合偷偷等价。
 */
function validateLabelMap(map) {
  const errors = []
  const warnings = []
  if (!map || typeof map !== 'object') return { ok: false, errors: ['label_map 不是对象'], warnings, version: null, entryCount: 0 }
  if (map.kind !== LABEL_MAP_KIND) errors.push('kind 必须为 ' + LABEL_MAP_KIND)
  if (!map.map_version) errors.push('缺少 map_version（映射必须显式版本化）')
  const labels = map.labels
  if (!labels || typeof labels !== 'object' || !Object.keys(labels).length) {
    errors.push('labels 缺失或为空')
  }
  const eqSets = map.equivalence_sets || {}
  Object.keys(labels).forEach(function (name) {
    const e = labels[name]
    if (!e || typeof e !== 'object') { errors.push('标签 ' + name + ' 条目不是对象'); return }
    if (!e.family_code) errors.push('标签 ' + name + ' 缺 family_code')
    if (!e.species_scope || (Array.isArray(e.species_scope) && !e.species_scope.length)) {
      errors.push('标签 ' + name + ' 缺 species_scope')
    }
    if (!e.target_granularity) errors.push('标签 ' + name + ' 缺 target_granularity')
    if (e.equivalence_set && !eqSets[e.equivalence_set]) {
      errors.push('标签 ' + name + ' 引用了未定义的等价集合 ' + e.equivalence_set)
    }
  })
  Object.keys(eqSets).forEach(function (setName) {
    const members = eqSets[setName] && eqSets[setName].members
    if (!Array.isArray(members) || members.length < 2) {
      errors.push('等价集合 ' + setName + ' 成员少于 2 个（等价必须显式成组声明）')
      return
    }
    members.forEach(function (m) {
      if (!labels[m]) errors.push('等价集合 ' + setName + ' 成员 ' + m + ' 未在 labels 登记')
    })
  })
  if (map.taxonomy_scope !== 'kb_card_labels') {
    warnings.push('taxonomy_scope 应为 kb_card_labels：本映射只登记知识卡标签，不代表“所有正确答案”')
  }
  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    version: map.map_version || null,
    entryCount: labels ? Object.keys(labels).length : 0
  }
}

// ──────────────────────── B02-3 casefile 校验（来源 / 分组校验） ────────────────────────

/**
 * 校验检索用例文件。硬阻断（errors，任一命中即拒绝加载）：
 *   E1 case_id 缺失/重复             E2 complaint 为空          E3 expected 为空
 *   E6 同 scenario_group_id 跨 split  E7 同 source_case_id 跨 split（同源/改写样本必须同组同split）
 * 警告（warnings，不阻断）：
 *   W3 input_origin=synthetic_challenge（允许保留的压力组，报告须单独列出）
 */
function validateCasefile(casefile) {
  const errors = []
  const warnings = []
  if (!casefile || typeof casefile !== 'object') {
    return { ok: false, errors: ['casefile 不是对象'], warnings: [], caseCount: 0 }
  }
  if (casefile.kind !== CASEFILE_KIND) errors.push('kind 必须为 ' + CASEFILE_KIND)
  if (!casefile.casefile_version) errors.push('缺少 casefile_version')
  const cases = casefile.cases
  if (!Array.isArray(cases) || !cases.length) errors.push('cases 缺失或为空')

  const seenCaseIds = {}
  const groupSplits = {}
  const sourceSplits = {}
  ;(cases || []).forEach(function (c, idx) {
    const at = 'cases[' + idx + ']'
    if (!c || typeof c !== 'object') { errors.push(at + ' 不是对象'); return }
    if (!c.case_id) { errors.push(at + ' 缺 case_id') } else {
      if (seenCaseIds[c.case_id]) errors.push(at + ' case_id 重复：' + c.case_id)
      seenCaseIds[c.case_id] = true
    }
    if (!c.complaint || !String(c.complaint).trim()) errors.push(at + ' 缺 complaint')
    if (!Array.isArray(c.expected) || !c.expected.length) errors.push(at + ' expected 必须为非空数组')
    if (SPLITS.indexOf(c.split) < 0) errors.push(at + ' split 非法：' + c.split + '（允许 ' + SPLITS.join('/') + '）')
    if (c.input_origin && INPUT_ORIGINS.indexOf(c.input_origin) < 0) {
      errors.push(at + ' input_origin 非法：' + c.input_origin)
    }
    if (c.feature_origin && FEATURE_ORIGINS.indexOf(c.feature_origin) < 0) {
      errors.push(at + ' feature_origin 非法：' + c.feature_origin)
    }
    if (c.development_exposure && EXPOSURE_STATES.indexOf(c.development_exposure) < 0) {
      errors.push(at + ' development_exposure 非法：' + c.development_exposure)
    }
    if (c.input_origin === 'synthetic_challenge') {
      warnings.push(at + '（' + c.case_id + '）synthetic_challenge 压力组，报告须单独列出，不得混入口语成绩（W3）')
    }
    if (c.scenario_group_id) {
      groupSplits[c.scenario_group_id] = groupSplits[c.scenario_group_id] || {}
      groupSplits[c.scenario_group_id][c.split] = true
    }
    if (c.source_case_id) {
      sourceSplits[c.source_case_id] = sourceSplits[c.source_case_id] || {}
      sourceSplits[c.source_case_id][c.split] = true
    }
  })
  Object.keys(groupSplits).forEach(function (g) {
    if (Object.keys(groupSplits[g]).length > 1) {
      errors.push('scenario_group_id ' + g + ' 跨 split 出现（E6）：同组用例必须同 split')
    }
  })
  Object.keys(sourceSplits).forEach(function (s) {
    if (Object.keys(sourceSplits[s]).length > 1) {
      errors.push('source_case_id ' + s + ' 跨 split 出现（E7）：同源/派生用例必须绑定同组同 split')
    }
  })
  return { ok: errors.length === 0, errors: errors, warnings: warnings, caseCount: cases ? cases.length : 0 }
}

// ──────────────────────── B02-4 快照构建 ────────────────────────────────

/**
 * 组装可追溯检索快照。调用方（recall_probe）负责真实检索并把 runs 传进来；
 * 这里只做组装与哈希，保证纯函数可测。
 *
 * options: {
 *   sourceKind: 'builtin_dev_corpus' | 'casefile',
 *   casefileMeta: {path, sha256, casefile_version} | null,
 *   cases: [{case_id?, complaint, species, bodyPart, visualFeatures, expected, split?...}],
 *   channels: { textOnly: [...perCaseRun], withVisual: [...perCaseRun] },
 *   context: {kbVersion, kbSourceSha256, codeCommit, worktreeDirty,
 *             labelMapVersion, labelMapSha256, cardHashes: {cardId: hash}}
 * }
 * perCaseRun: {case_key, query, results:[{id,name,canonicalName,score,matched,redFlagMatches,urgency}],
 *              set_metrics, role_metrics, family_view}
 */
function buildSnapshot(options) {
  const cases = options.cases || []
  const inputSha256 = sha256Of(semanticStableStringify(cases, ['aliases']))
  const ctx = options.context || {}
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    tool: 'recall_probe',
    created_at: new Date().toISOString(),
    corpus: {
      source_kind: options.sourceKind,
      case_count: cases.length,
      casefile_meta: options.casefileMeta || null
    },
    traceability: {
      input_sha256: inputSha256,
      input_case_count: cases.length,
      kb_version: ctx.kbVersion || null,
      weight_version: ctx.weightVersion || null,
      weight_hash: ctx.weightHash || null,
      kb_source_sha256: ctx.kbSourceSha256 || null,
      code_commit: ctx.codeCommit || null,
      worktree_dirty: ctx.worktreeDirty === undefined ? null : ctx.worktreeDirty,
      label_map_version: ctx.labelMapVersion || null,
      label_map_sha256: ctx.labelMapSha256 || null,
      card_hashes: ctx.cardHashes || {}
    },
    channels: options.channels || {}
  }
}

// ──────────────────────── B02-4 快照比较（diffSnapshots） ────────────────────────

function refuse(reason) {
  return { status: 'refused', refuse_reason: reason }
}

function compareRankEntryLists(beforeList, afterList) {
  const changes = []
  const beforeById = {}
  const afterById = {}
  ;(beforeList || []).forEach(function (r, i) {
    const key = r.id || r.name
    beforeById[key] = { rank: i + 1, entry: r }
  })
  ;(afterList || []).forEach(function (r, i) {
    const key = r.id || r.name
    afterById[key] = { rank: i + 1, entry: r }
  })
  Object.keys(beforeById).forEach(function (key) {
    const b = beforeById[key]
    if (!afterById[key]) {
      changes.push({ kind: 'removed', name: b.entry.name, id: b.entry.id || null,
        before: { rank: b.rank, score: b.entry.score }, after: null })
      return
    }
    const a = afterById[key]
    const rankChanged = a.rank !== b.rank
    const scoreDelta = round4((a.entry.score || 0) - (b.entry.score || 0))
    if (rankChanged || scoreDelta !== 0) {
      changes.push({ kind: 'moved', name: b.entry.name, id: b.entry.id || null,
        before: { rank: b.rank, score: b.entry.score },
        after: { rank: a.rank, score: a.entry.score },
        score_delta: scoreDelta })
    }
  })
  Object.keys(afterById).forEach(function (key) {
    if (!beforeById[key]) {
      const a = afterById[key]
      changes.push({ kind: 'added', name: a.entry.name, id: a.entry.id || null,
        before: null, after: { rank: a.rank, score: a.entry.score } })
    }
  })
  return changes
}

function diffStringArray(beforeArr, afterArr) {
  const b = uniq(beforeArr || [])
  const a = uniq(afterArr || [])
  return {
    added: a.filter(function (x) { return b.indexOf(x) < 0 }),
    removed: b.filter(function (x) { return a.indexOf(x) < 0 })
  }
}

function diffFamilyView(beforeView, afterView) {
  const bCodes = (beforeView && beforeView.unique ? beforeView.unique : []).map(function (f) { return f.family_code })
  const aCodes = (afterView && afterView.unique ? afterView.unique : []).map(function (f) { return f.family_code })
  return {
    added: aCodes.filter(function (c) { return bCodes.indexOf(c) < 0 }),
    removed: bCodes.filter(function (c) { return aCodes.indexOf(c) < 0 })
  }
}

/**
 * 比较两份快照（B02-4）。纪律：
 *   - 任一侧缺 schema_version / traceability / input_sha256 → status=refused（不允许作版本比较）；
 *   - 两侧 input_sha256 不一致 → refused（不是同输入比较，分歧不可归因）；
 *   - created_at 等非语义字段不参与比较；版本哈希变化作为元数据记录，本身不算排名变化。
 * 返回 {status, ...}；status='ok' 时 changed_case_count=0 即“同输入重跑 diff 为空”。
 */
function diffSnapshots(before, after) {
  if (!before || !before.traceability || !before.schema_version) return refuse('before 快照缺 schema_version/traceability，无追溯字段不允许作版本比较')
  if (!after || !after.traceability || !after.schema_version) return refuse('after 快照缺 schema_version/traceability，无追溯字段不允许作版本比较')
  if (before.schema_version !== after.schema_version) return refuse('schema_version 不一致：' + before.schema_version + ' vs ' + after.schema_version)
  if (!before.traceability.input_sha256 || !after.traceability.input_sha256) return refuse('快照缺 input_sha256，无法确认同输入')
  if (before.traceability.input_sha256 !== after.traceability.input_sha256) return refuse('input_sha256 不一致：两份快照不是同一输入，禁止计算排名分歧')

  const t = before.traceability
  const versions = {
    weight_configuration: { before: t.weight_hash || null, after: after.traceability.weight_hash || null,
      changed: t.weight_hash !== after.traceability.weight_hash || t.weight_version !== after.traceability.weight_version },
    kb_version: { before: t.kb_version || null, after: after.traceability.kb_version || null,
      changed: t.kb_version !== after.traceability.kb_version },
    kb_source_sha256: { before: t.kb_source_sha256 || null, after: after.traceability.kb_source_sha256 || null,
      changed: t.kb_source_sha256 !== after.traceability.kb_source_sha256 },
    code_commit: { before: t.code_commit || null, after: after.traceability.code_commit || null,
      changed: t.code_commit !== after.traceability.code_commit },
    label_map: { before: t.label_map_version || null, after: after.traceability.label_map_version || null,
      changed: t.label_map_version !== after.traceability.label_map_version ||
               t.label_map_sha256 !== after.traceability.label_map_sha256 }
  }

  const cardHashChanges = []
  const bCards = t.card_hashes || {}
  const aCards = after.traceability.card_hashes || {}
  Object.keys(bCards).forEach(function (id) {
    if (!aCards[id]) cardHashChanges.push({ id: id, change: 'removed' })
    else if (aCards[id] !== bCards[id]) cardHashChanges.push({ id: id, change: 'content_changed', before: bCards[id], after: aCards[id] })
  })
  Object.keys(aCards).forEach(function (id) {
    if (!bCards[id]) cardHashChanges.push({ id: id, change: 'added' })
  })

  const perCase = []
  let changedCount = 0
  const bCh = before.channels || {}
  const aCh = after.channels || {}
  const channelNames = uniq(Object.keys(bCh).concat(Object.keys(aCh)))
  const channelReports = {}

  channelNames.forEach(function (ch) {
    const bRows = bCh[ch] || []
    const aRows = aCh[ch] || []
    const bByKey = {}
    const aByKey = {}
    bRows.forEach(function (r) { bByKey[r.case_key] = r })
    aRows.forEach(function (r) { aByKey[r.case_key] = r })
    const rows = []
    let chChanged = 0
    Object.keys(bByKey).forEach(function (key) {
      const b = bByKey[key]
      if (!aByKey[key]) {
        rows.push({ case_key: key, presence: 'only_in_before', ranking_changed: true })
        chChanged++
        return
      }
      const a = aByKey[key]
      const ranking = compareRankEntryLists(b.results, a.results)
      // 证据来源逐卡比较：matched（带来源前缀）与 redFlagMatches 的增删
      const bById = {}
      const aById = {}
      ;(b.results || []).forEach(function (r) { bById[r.id || r.name] = r })
      ;(a.results || []).forEach(function (r) { aById[r.id || r.name] = r })
      const evidencePerCard = {}
      Object.keys(bById).forEach(function (id) {
        if (!aById[id]) return
        const dM = diffStringArray(bById[id].matched, aById[id].matched)
        const dR = diffStringArray(bById[id].redFlagMatches, aById[id].redFlagMatches)
        if (dM.added.length || dM.removed.length || dR.added.length || dR.removed.length) {
          evidencePerCard[id] = { name: bById[id].name, matched: dM, red_flags: dR }
        }
      })
      const evidence = { per_card: evidencePerCard }
      const family = diffFamilyView(b.family_view, a.family_view)
      const setDiff = {
        top1_expected_set: b.set_metrics.top1_expected_set !== a.set_metrics.top1_expected_set
          ? { before: b.set_metrics.top1_expected_set, after: a.set_metrics.top1_expected_set } : null,
        mrr_expected_set: b.set_metrics.mrr_expected_set !== a.set_metrics.mrr_expected_set
          ? { before: b.set_metrics.mrr_expected_set, after: a.set_metrics.mrr_expected_set } : null
      }
      const caseChanged = ranking.length > 0 ||
        Object.keys(evidencePerCard).length > 0 ||
        family.added.length > 0 || family.removed.length > 0 ||
        !!setDiff.top1_expected_set || !!setDiff.mrr_expected_set
      if (caseChanged) chChanged++
      rows.push({
        case_key: key,
        presence: 'both',
        ranking_changed: caseChanged,
        ranking_changes: ranking,
        evidence_changes: evidence,
        family_changes: family,
        set_metrics_diff: setDiff
      })
    })
    Object.keys(aByKey).forEach(function (key) {
      if (!bByKey[key]) {
        rows.push({ case_key: key, presence: 'only_in_after', ranking_changed: true })
        chChanged++
      }
    })
    changedCount += chChanged
    channelReports[ch] = { case_count: rows.length, changed_case_count: chChanged, cases: rows }
  })

  return {
    status: 'ok',
    refuse_reason: null,
    versions: versions,
    input_sha256_equal: true,
    card_hash_changes: cardHashChanges,
    channels: channelReports,
    changed_case_count_total: changedCount,
    ranking_semantically_unchanged: changedCount === 0 && cardHashChanges.length === 0
  }
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION: SNAPSHOT_SCHEMA_VERSION,
  LABEL_MAP_KIND: LABEL_MAP_KIND,
  CASEFILE_KIND: CASEFILE_KIND,
  SPLITS: SPLITS,
  sha256Of: sha256Of,
  canonicalJson: canonicalJson,
  semanticStableStringify: semanticStableStringify,
  canonicalCardHash: canonicalCardHash,
  computeSetMetrics: computeSetMetrics,
  aggregateSetMetrics: aggregateSetMetrics,
  resolveEquivalenceSet: resolveEquivalenceSet,
  computeRoleMetrics: computeRoleMetrics,
  foldByFamily: foldByFamily,
  validateLabelMap: validateLabelMap,
  validateCasefile: validateCasefile,
  buildSnapshot: buildSnapshot,
  diffSnapshots: diffSnapshots,
  compareRankEntryLists: compareRankEntryLists
}
