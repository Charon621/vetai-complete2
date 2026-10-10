#!/usr/bin/env node
/**
 * 主诉召回探测：用「宠物主人真实会打出来的话」测知识库检索的召回率。
 *
 * 为什么需要它（与 kb_audit.js 的分工）：
 *   kb_audit 检查的是知识卡结构和"这句话不该检出那个病"的安全边界；
 *   本工具测的是相反方向的问题——**该检出的检不出来**。
 *
 *   检索是字面子串匹配（matchedTerms 用 indexOf），所以命中与否取决于
 *   主人的用词能否接上知识库的术语，而不取决于知识卡写得多详细多正确。
 *   条目正文 typicalFeatures / ddx 完全不参与打分，只在命中后注入 prompt。
 *
 * 两条通道分别计分：
 *   textOnly  —— 只有主人文字。受 expandQueryTerms 口语桥接表覆盖度限制。
 *   withVisual —— 叠加视觉预检输出的受控标准词。这是主通道。
 *                visualFeatures 用具体词还是笼统词，结果天差地别：
 *                泛词（脱毛/红斑/结痂等 7 个）权重 1.5 且不计入强证据，
 *                只输出泛词会让整条检索作废。
 *
 * 边界：expected 是"这句主诉在临床上最该被想到的方向"，用于衡量检索召回，
 *       **不是诊断参考标准**，可随时运行；标注工具见 evaluation/reference_data。
 *
 * B02（BUG-28）新增，检索排序/权重/门槛一律不动：
 *   - 评分纯函数抽到 evaluation/tools/retrieval_metrics.js；本文件只装配。
 *   - 逐例新增 top1_expected_set / mrr_expected_set / first_expected_rank，
 *     保留 legacy 口径字段（hitExpected/expectedHit/expectedHitRate）原义不变。
 *   - 内置 24 例无独立主病/并存角色标注，primary/coexisting 指标一律 NA＋原因，
 *     不把 expected 首项或任一成员擅自解释为主病。
 *   - 内置语料显式标注：input_origin=manual_simulation（手写模拟口语，非真实主人
 *     原话）、feature_origin=manual_simulation（vf 为人工模拟预检词，非真实预检）、
 *     split=development、development_exposure=exposed。
 *   - 新 CLI：--casefile <用例文件.json>（走 retrieval_metrics.validateCasefile 纪律校验）、
 *     --snapshot-out <快照.json>（可追溯快照：输入/卡片/词表/配置/源码哈希 + 原始
 *     Top3 与病族折叠 Top3 + score/matched 证据来源）。
 *
 * 用法：
 *   node evaluation/tools/recall_probe.js
 *   node evaluation/tools/recall_probe.js --verbose
 *   node evaluation/tools/recall_probe.js --out evaluation/runs/recall_20260726.json
 *   node evaluation/tools/recall_probe.js --casefile <用例.json> --out <报告.json> --snapshot-out <快照.json>
 */

'use strict'

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..', '..')

global.wx = global.wx || {
  getStorageSync: function () { return [] },
  setStorageSync: function () {},
  request: function () { throw new Error('recall_probe 不应发起网络请求') }
}

const kb = require(path.join(ROOT, 'utils', 'kb'))
const retrievalMetrics = require(path.join(__dirname, 'retrieval_metrics.js'))

const FLOORS = { withVisual: 90, textOnly: 70 }

/**
 * 语料：模拟小程序里主人真实的输入习惯——口语、错别字风格、
 * 夹杂病史与环境信息、几乎不用临床术语。
 *
 * visualFeatures 模拟视觉预检在「按新 prompt 要求输出具体词」时的产物。
 */
const CASES = [
  // ── 有病史线索的（检验病史类口语桥接）──
  { c: '狗狗最近老是挠，经常带它去草地遛弯，好久没驱虫了', s: '犬', b: '躯干',
    vf: ['红斑', '结痂'], expect: ['跳蚤过敏性皮炎', '疥螨病', '姬螯螨病（行走的皮屑）'] },
  { c: '家里两只猫都在挠，另一只也痒，背上一粒粒的结痂', s: '猫', b: '背部',
    vf: ['粟粒', '结痂'], expect: ['猫粟粒性皮炎（跳蚤过敏）', '跳蚤过敏性皮炎'] },
  { c: '刚从救助站接回来的小猫，脸上一块圆圆的秃了，我手上也起了红疹', s: '猫', b: '面部',
    vf: ['圆形脱毛', '鳞屑', '断毛'], expect: ['皮肤癣菌病（犬猫）'] },
  { c: '每年春天就犯，一到换季就开始舔爪子啃肚皮，以前也过敏', s: '犬', b: '爪部',
    vf: ['红斑', '色素沉着'], expect: ['特应性皮炎（环境过敏）', '食物过敏性皮炎'] },
  { c: '老是犯，治好了又来，耳朵反复发炎还一直舔脚', s: '犬', b: '耳部',
    vf: ['油腻', '异味'], expect: ['特应性皮炎（环境过敏）', '马拉色菌性外耳炎', '食物过敏性皮炎'] },
  { c: '一直甩头，耳屎特别多，耳朵黏糊糊的还很臭', s: '犬', b: '耳部',
    vf: ['黄褐色', '油腻', '耳垢'], expect: ['马拉色菌性外耳炎', '耳螨感染', '细菌性外耳炎'] },
  { c: '猫一直甩头挠耳朵，耳朵里好多黑色的东西像黑芝麻', s: '猫', b: '耳部',
    vf: ['黑褐色', '蜡样', '耳垢'], expect: ['耳螨感染'] },

  // ── 内分泌/免疫方向（检验高危 combo 与病史桥接）──
  { c: '两边都掉毛，一点都不痒，最近喝水特别多还老是尿', s: '犬', b: '躯干',
    vf: ['对称脱毛', '皮肤变薄'], expect: ['库兴综合征相关皮肤改变', '甲状腺功能减退相关皮肤改变'] },
  { c: '老猫瘦了好多，喝水多，背上毛没光泽还两边都掉', s: '猫', b: '躯干',
    vf: ['对称脱毛', '毛发粗乱'], expect: ['猫甲状腺功能亢进相关皮肤改变'] },
  { c: '两边对称掉毛，也不痒，狗变胖了没精神', s: '犬', b: '躯干',
    vf: ['对称脱毛', '色素沉着'], expect: ['甲状腺功能减退相关皮肤改变'] },
  { c: '猫皮很薄，抱一下一碰就破，都没外伤自己就裂开了', s: '猫', b: '背部',
    vf: ['撕裂', '皮肤变薄'], expect: ['猫皮肤脆弱症'] },

  // ── 形态口语（检验形态类桥接）──
  { c: '脖子上烂了一块，昨天还好好的一夜之间就烂开了', s: '犬', b: '颈部',
    vf: ['渗出', '潮湿', '糜烂'], expect: ['急性湿性皮炎（热点）'] },
  { c: '腿上破了个洞一直流脓，摸着里面硬硬的', s: '犬', b: '腿部',
    vf: ['瘘管', '结节', '脓液'], expect: ['深部脓皮病', '脓肿/蜂窝织炎'] },
  { c: '鼻子和脚垫硬邦邦的像老茧，还干裂了', s: '犬', b: '鼻部',
    vf: ['角化', '增厚', '裂纹'], expect: ['鼻/足垫角化过度', '锌反应性皮病'] },
  { c: '下巴上黑黑的一片怎么洗都洗不掉', s: '猫', b: '下巴',
    vf: ['黑点', '粉刺', '黑头'], expect: ['猫痤疮'] },
  { c: '肚子上密密麻麻小红疙瘩，有的顶上是白的', s: '犬', b: '腹部',
    vf: ['丘疹', '脓疱', '表皮环'], expect: ['浅表脓皮病', '脓疱病'] },
  { c: '身上油乎乎的一股酸臭味，皮肤还发黑了', s: '犬', b: '躯干',
    vf: ['油腻', '色素沉着', '增厚'], expect: ['马拉色菌皮炎', '皮脂溢性皮炎'] },
  { c: '爪子中间反复红肿，一直舔，都舔秃了', s: '犬', b: '爪部',
    vf: ['红肿', '脱毛'], expect: ['趾间脓皮病（趾间炎）', '特应性皮炎（环境过敏）'] },
  { c: '白猫耳朵尖一直烂着好不了，还老出血', s: '猫', b: '耳部',
    vf: ['溃疡', '出血', '增生'], expect: ['猫鳞状细胞癌', '猫日光性皮炎'] },
  { c: '身上长了个硬疙瘩越来越大，表面破了', s: '犬', b: '躯干',
    vf: ['肿块', '溃疡'], expect: ['皮肤肿瘤（肥大细胞瘤等）'] },
  { c: '尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点', s: '犬', b: '腰部',
    vf: ['结痂', '黑色颗粒'], expect: ['跳蚤过敏性皮炎'] },
  { c: '幼犬脸肿得厉害，眼睛周围都是脓包，下巴那里也肿了还发烧', s: '犬', b: '面部',
    vf: ['肿胀', '脓疱结痂', '淋巴结肿大'], expect: ['幼犬蜂窝织炎'] },
  { c: '狗鼻子颜色变浅了发白，上面反复结痂还溃疡', s: '犬', b: '鼻部',
    vf: ['色素脱失', '结痂', '溃疡'], expect: ['盘状红斑狼疮', '日光性皮炎'] },
  { c: '眼皮红肿结痂，一直眯着眼流眼泪还用爪子揉', s: '犬', b: '眼周',
    vf: ['眼睑红肿', '眼周结痂'], expect: ['睑炎'] }
]

/**
 * B02-3：内置 24 例的来源/版本纪律标注。
 * 这些是开发语料，不是真实主人原话或真实预检输出，并记录为已接触的开发语料——
 * 探针自首次提交（14bcd5e）起就在仓库里，v1→v11 迭代期间被反复接触。
 */
const CASE_ORIGIN = {
  input_origin: 'manual_simulation',
  feature_origin: 'manual_simulation',
  source_case_id: null,
  scenario_group_id: 'builtin_dev_corpus_24',
  split: 'development',
  development_exposure: 'exposed',
  exposure_note: '自首次提交(14bcd5e)起即为开发语料，v1→v11 迭代期间反复接触；不得当作 未接触用例或真实临床样本。',
  labeler: null,
  labeler_note: '项目组历史手写；无独立专家标注。',
}

// casefile 用例 → 探针内部格式（保留 casefile 的来源/版本/角色元数据）
function casefileToProbeCase(c) {
  return { c: c.complaint, s: c.species, b: c.bodyPart || '', vf: c.visualFeatures || [],
    expect: c.expected, case_id: c.case_id, origin: c, role: c.role || null }
}

// 检索结果的 name 是按物种渲染的显示名（如「皮肤癣菌病（犬猫）」在猫场景显示为「猫癣」），
// 判定命中时必须换回条目正名，否则会把正确召回误判为漏召回。
const CANONICAL_BY_ID = {}
kb.DISEASE_KB.forEach(function (card) { CANONICAL_BY_ID[card.id] = card.name })

function canonicalNames(results) {
  return results.map(function (r) { return CANONICAL_BY_ID[r.id] || r.name })
}

function buildQuery(t, useVisual) {
  const query = { species: t.s, breed: '', bodyPart: t.b, complaint: t.c }
  if (useVisual) query.visualFeatures = t.vf
  return query
}

/**
 * 单通道评测。legacy 字段（expectedHit/hitExpected/abstained 等）语义与 B02 前完全一致；
 * 新增字段全部来自 retrieval_metrics 纯函数，只读消费检索结果，不改排序与门槛。
 */
function evaluate(useVisual, options) {
  const cases = (options && options.cases) || CASES
  const defaultOrigin = (options && options.defaultOrigin) || CASE_ORIGIN
  const labelMap = (options && options.labelMap) || null

  let hitAny = 0
  let hitExpected = 0
  const rows = []
  const runs = []

  cases.forEach(function (t) {
    const query = buildQuery(t, useVisual)
    const worthy = (kb.search(query) || []).filter(kb.isPromptWorthyResult)
    const names = canonicalNames(worthy)
    const matched = names.filter(function (n) { return t.expect.indexOf(n) >= 0 })

    if (names.length) hitAny++
    if (matched.length) hitExpected++

    // B02-1：expected 集合口径（Top-1 / MRR / 首个名次）
    const setMetrics = retrievalMetrics.computeSetMetrics(names, t.expect)
    // B02-1：角色指标——内置语料无 role，全部 NA；casefile 用例可带独立标注
    const roleMetrics = retrievalMetrics.computeRoleMetrics(names, t.role || null, labelMap)
    // B02-2：病族折叠视图（只读，不改 raw 排名）
    const familyView = retrievalMetrics.foldByFamily(
      names.map(function (n, i) {
        return { name: n, id: worthy[i] ? worthy[i].id : null, score: worthy[i] ? worthy[i].score : null }
      }), labelMap)
    const origin = t.origin || defaultOrigin

    rows.push({
      complaint: t.c,
      expected: t.expect,
      retrieved: names,
      hitExpected: matched.length > 0,
      abstained: names.length === 0,
      // ── B02 新增字段 ──
      case_key: t.case_id || t.c,
      origin: origin,
      legacy_expected_hit: matched.length > 0,
      top1_expected_set: setMetrics.top1_expected_set,
      mrr_expected_set: setMetrics.mrr_expected_set,
      first_expected_rank: setMetrics.first_expected_rank,
      expected_hits_in_top3: setMetrics.expected_hits_in_top3,
      role_metrics: {
        role_present: roleMetrics.role_present,
        primary: roleMetrics.primary,
        coexisting: roleMetrics.coexisting,
        top1_primary: roleMetrics.top1_primary,
        mrr_primary: roleMetrics.mrr_primary,
        top3_primary_recall: roleMetrics.top3_primary_recall,
        top3_coexisting_coverage: roleMetrics.top3_coexisting_coverage
      },
      unique_family_top3: familyView.unique.map(function (f) {
        return { family_code: f.family_code, best_name: f.best_name, first_rank: f.first_rank }
      }),
      unmapped_labels: familyView.unmapped.map(function (u) { return u.name })
    })

    // B02-4：快照逐例运行明细（score/matched 证据来源全量留档）
    runs.push({
      case_key: t.case_id || t.c,
      query: query,
      results: worthy.map(function (r) {
        return {
          id: r.id,
          name: r.name,
          canonicalName: r.canonicalName,
          score: r.score,
          matched: r.matched,
          redFlagMatches: r.redFlagMatches,
          urgency: r.urgency
        }
      }),
      set_metrics: setMetrics,
      role_metrics: roleMetrics,
      family_view: familyView,
      origin: origin
    })
  })

  // B02-1：新增聚合（legacy 聚合字段原样保留）
  const agg = retrievalMetrics.aggregateSetMetrics(rows)

  return {
    total: cases.length,
    anyHit: hitAny,
    expectedHit: hitExpected,
    anyHitRate: +(hitAny / cases.length * 100).toFixed(1),
    expectedHitRate: +(hitExpected / cases.length * 100).toFixed(1),
    // ── B02 新增聚合 ──
    top1ExpectedSetRate: agg.top1_expected_set_rate,
    mrrExpectedSetMean: agg.mrr_expected_set_mean,
    legacyExpectedHitRate: agg.legacy_expected_hit_rate,
    roleMetricsSummary: summarizeRoleMetrics(rows),
    singleReferenceConfusion: computeSingleReferenceConfusion(rows),
    rows: rows,
    runs: runs
  }
}

/**
 * B02-1 角色指标汇总：全部用例都没有独立 role 标注时如实 NA＋原因；
 * 有标注的用例（casefile）才聚合 primary/coexisting，并报告 label coverage。
 */
function summarizeRoleMetrics(rows) {
  const withRole = rows.filter(function (r) { return r.role_metrics && r.role_metrics.role_present })
  if (!withRole.length) {
    return {
      status: 'NA',
      reason: 'no_independent_role_labels',
      label_coverage: { with_primary_or_coexisting: 0, total: rows.length },
      note: 'expected 仅为方向集合，无独立主病/并存角色标注；top1_primary/mrr_primary/top3_primary_recall/top3_coexisting_coverage 均 NA，不把 expected 首项或任一成员擅自解释为主病。'
    }
  }
  const primaryRows = withRole.filter(function (r) { return r.role_metrics.primary.applicable })
  const coexistingRows = withRole.filter(function (r) { return r.role_metrics.coexisting.applicable })
  function mean(arr, field) {
    if (!arr.length) return null
    let s = 0
    arr.forEach(function (r) { s += r.role_metrics[field] || 0 })
    return Math.round(s / arr.length * 10000) / 10000
  }
  return {
    status: 'computed_on_role_annotated_cases_only',
    label_coverage: {
      with_primary_or_coexisting: withRole.length,
      with_primary: primaryRows.length,
      with_coexisting: coexistingRows.length,
      total: rows.length
    },
    top1_primary_mean: mean(primaryRows, 'top1_primary'),
    mrr_primary_mean: mean(primaryRows, 'mrr_primary'),
    top3_primary_recall_mean: mean(primaryRows, 'top3_primary_recall'),
    top3_coexisting_coverage_mean: mean(coexistingRows, 'top3_coexisting_coverage'),
    note: '仅对带独立角色标注的用例聚合；无标注用例保持 NA，不并入分母冒充成绩。'
  }
}

/**
 * B02-1：单 expected 用例的检索混淆（开发集诊断，不是临床混淆矩阵）。
 * 多 expected 用例无主病口径，不参与，防止强选参考。
 */
function computeSingleReferenceConfusion(rows) {
  let n = 0
  let top1Correct = 0
  let abstained = 0
  const misdirected = {}
  rows.forEach(function (r) {
    if (r.expected.length !== 1) return
    n++
    if (!r.retrieved.length) { abstained++; return }
    if (r.retrieved[0] === r.expected[0]) top1Correct++
    else misdirected[r.retrieved[0]] = (misdirected[r.retrieved[0]] || 0) + 1
  })
  return {
    single_reference_cases: n,
    top1_correct: top1Correct,
    abstained: abstained,
    misdirected_top1: misdirected,
    note: '仅单 expected 用例的检索混淆开发诊断；多 expected 用例未定主次，不得强选参考作临床主病矩阵。'
  }
}

// ──────────────────────── B02-4 快照上下文 ────────────────────────

function loadLabelMap() {
  const p = path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json')
  if (!fs.existsSync(p)) return { map: null, meta: { present: false } }
  const map = JSON.parse(fs.readFileSync(p, 'utf8'))
  const check = retrievalMetrics.validateLabelMap(map)
  if (!check.ok) {
    console.error('retrieval_label_map.json 校验失败：')
    check.errors.forEach(function (e) { console.error('  ✗ ' + e) })
    process.exit(2)
  }
  return {
    map: map,
    meta: {
      present: true,
      path: 'evaluation/config/retrieval_label_map.json',
      version: check.version,
      entry_count: check.entryCount,
      sha256: retrievalMetrics.sha256Of(fs.readFileSync(p))
    }
  }
}

function gitContext() {
  // 本地只读 git 查询；失败（无 git/非仓库）时置 null，不阻塞探测。
  const cp = require('child_process')
  const out = { codeCommit: null, worktreeDirty: null }
  try {
    out.codeCommit = cp.execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch (e) { /* 保持 null */ }
  try {
    const st = cp.execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
    out.worktreeDirty = st.trim().length > 0
  } catch (e) { /* 保持 null */ }
  return out
}

function buildCardHashes() {
  const hashes = {}
  kb.DISEASE_KB.forEach(function (card) {
    hashes[card.id] = retrievalMetrics.canonicalCardHash(card)
  })
  return hashes
}

function buildSnapshotContext(labelMapMeta) {
  const git = gitContext()
  const kbSourcePath = path.join(ROOT, 'utils', 'kb.js')
  return {
    kbVersion: kb.KB_VERSION,
    weightVersion: kb.WEIGHT_VERSION,
    weightHash: kb.WEIGHT_HASH,
    kbSourceSha256: retrievalMetrics.sha256Of(fs.readFileSync(kbSourcePath)),
    codeCommit: git.codeCommit,
    worktreeDirty: git.worktreeDirty,
    labelMapVersion: labelMapMeta.present ? labelMapMeta.version : null,
    labelMapSha256: labelMapMeta.present ? labelMapMeta.sha256 : null,
    cardHashes: buildCardHashes()
  }
}

function main() {
  const argv = process.argv
  const verbose = argv.indexOf('--verbose') >= 0
  const outIdx = argv.indexOf('--out')
  const out = outIdx >= 0 ? argv[outIdx + 1] : null
  const casefileIdx = argv.indexOf('--casefile')
  const casefilePath = casefileIdx >= 0 ? argv[casefileIdx + 1] : null
  const snapIdx = argv.indexOf('--snapshot-out')
  const snapshotOut = snapIdx >= 0 ? argv[snapIdx + 1] : null

  // B02-3：casefile 加载与纪律校验；校验不过拒绝运行（退出码 2）
  let probeCases = CASES
  let defaultOrigin = CASE_ORIGIN
  let corpus = {
    source_kind: 'builtin_dev_corpus',
    case_count: CASES.length,
    casefile_meta: null,
    origin_note: '内置 24 例：manual_simulation 口语 + 人工模拟预检词；development 语料，已暴露。'
  }
  let casefileMeta = null
  if (casefilePath) {
    if (!fs.existsSync(casefilePath)) {
      console.error('casefile 不存在：' + casefilePath)
      process.exit(2)
    }
    const casefile = JSON.parse(fs.readFileSync(casefilePath, 'utf8'))
    const check = retrievalMetrics.validateCasefile(casefile)
    if (!check.ok) {
      console.error('casefile 校验失败（' + check.errors.length + ' 个硬阻断）：')
      check.errors.forEach(function (e) { console.error('  ✗ ' + e) })
      check.warnings.forEach(function (w) { console.error('  ⚠ ' + w) })
      process.exit(2)
    }
    if (check.warnings.length) {
      console.log('casefile 警告：')
      check.warnings.forEach(function (w) { console.log('  ⚠ ' + w) })
    }
    probeCases = casefile.cases.map(casefileToProbeCase)
    defaultOrigin = null
    casefileMeta = {
      path: casefilePath,
      casefile_version: casefile.casefile_version || null,
      sha256: retrievalMetrics.sha256Of(fs.readFileSync(casefilePath)),
      case_count: probeCases.length
    }
    corpus = { source_kind: 'casefile', case_count: probeCases.length, casefile_meta: casefileMeta, origin_note: '用例来源/版本元数据逐例随行。' }
  }

  const labelMapMeta = loadLabelMap()

  const options = { cases: probeCases, defaultOrigin: defaultOrigin, labelMap: labelMapMeta.map }
  const textOnly = evaluate(false, options)
  const withVisual = evaluate(true, options)

  console.log('主诉召回探测 — KB_VERSION=' + kb.KB_VERSION + '，语料 ' + probeCases.length + ' 条真实口语主诉')
  console.log('')
  console.log('通道                命中任意条目      命中期望方向')
  console.log('─'.repeat(56))
  console.log('仅主人文字          ' +
    (textOnly.anyHit + '/' + textOnly.total + ' = ' + textOnly.anyHitRate + '%').padEnd(18) +
    textOnly.expectedHit + '/' + textOnly.total + ' = ' + textOnly.expectedHitRate + '%')
  console.log('文字 + 视觉预检     ' +
    (withVisual.anyHit + '/' + withVisual.total + ' = ' + withVisual.anyHitRate + '%').padEnd(18) +
    withVisual.expectedHit + '/' + withVisual.total + ' = ' + withVisual.expectedHitRate + '%')
  console.log('')
  // B02-1：集合口径汇总（legacy 口径不变，只是多报两个数字）
  console.log('B02 集合指标（开发集诊断，非临床准确率）：')
  console.log('  仅主人文字      Top-1∈expected集合 ' + pct(textOnly.top1ExpectedSetRate) +
    '，MRR ' + textOnly.mrrExpectedSetMean +
    '，role指标 ' + textOnly.roleMetricsSummary.status)
  console.log('  文字 + 视觉预检 Top-1∈expected集合 ' + pct(withVisual.top1ExpectedSetRate) +
    '，MRR ' + withVisual.mrrExpectedSetMean +
    '，role指标 ' + withVisual.roleMetricsSummary.status)
  console.log('')

  const misses = withVisual.rows.filter(function (r) { return !r.hitExpected })
  if (misses.length) {
    console.log('主通道仍未命中期望方向的 ' + misses.length + ' 条：')
    misses.forEach(function (r) {
      console.log('  ✗ 「' + r.complaint + '」')
      console.log('      期望: ' + r.expected.join(' / '))
      console.log('      实际: ' + (r.retrieved.length ? r.retrieved.join(' | ') : '（弃权，无条目入 prompt）'))
    })
    console.log('')
  }

  if (verbose) {
    console.log('全部明细（主通道）：')
    withVisual.rows.forEach(function (r) {
      console.log('  ' + (r.hitExpected ? '✓' : '✗') + ' ' + r.complaint)
      console.log('      → ' + (r.retrieved.join(' | ') || '弃权'))
      console.log('      Top-1集合=' + r.top1_expected_set + ' MRR=' + r.mrr_expected_set +
        ' 病族折叠=' + r.unique_family_top3.map(function (f) { return f.family_code }).join(' / '))
    })
    console.log('')
  }

  if (out) {
    const dir = path.dirname(out)
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(out, JSON.stringify({
      tool: 'recall_probe',
      kbVersion: kb.KB_VERSION,
      floors: FLOORS,
      textOnly: textOnly,
      withVisual: withVisual,
      // ── B02 新增报告字段 ──
      corpus: corpus,
      label_map: labelMapMeta.present
        ? { version: labelMapMeta.version, path: labelMapMeta.path, entry_count: labelMapMeta.entry_count }
        : { present: false },
      metrics_note: 'top1/mrr/role/病族折叠均为 B02 新增开发集诊断口径；expected 非临床参考标准，role 未标注即 NA；24 例为已暴露开发语料（manual_simulation），不代表真实预检或临床成绩。'
    }, null, 2), 'utf8')
    console.log('已写入: ' + out)
  }

  // B02-4：可追溯快照（输入/卡片/词表/配置/源码哈希 + 逐例原始结果与病族折叠）
  if (snapshotOut) {
    const snapshot = retrievalMetrics.buildSnapshot({
      sourceKind: corpus.source_kind,
      casefileMeta: casefileMeta,
      cases: probeCases.map(function (t) {
        return {
          case_id: t.case_id || null,
          complaint: t.c,
          species: t.s,
          bodyPart: t.b,
          visualFeatures: t.vf || [],
          expected: t.expect
        }
      }),
      channels: { textOnly: textOnly.runs, withVisual: withVisual.runs },
      context: buildSnapshotContext(labelMapMeta)
    })
    const snapDir = path.dirname(snapshotOut)
    if (snapDir && !fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true })
    fs.writeFileSync(snapshotOut, JSON.stringify(snapshot, null, 2), 'utf8')
    console.log('已写入快照: ' + snapshotOut)
  }

  // 回归下限：当前实测 主通道 100% / 纯文字 79.2%，下限留出余量。
  // 这不是准确率指标，只是"检索还能不能把该想到的方向捞出来"的护栏——
  // 词表、阈值、权重任何一处改动把召回打回去，这里会直接失败。
  const failures = []
  if (withVisual.expectedHitRate < FLOORS.withVisual) {
    failures.push('主通道命中期望方向 ' + withVisual.expectedHitRate + '% < 下限 ' + FLOORS.withVisual + '%')
  }
  if (textOnly.expectedHitRate < FLOORS.textOnly) {
    failures.push('纯文字命中期望方向 ' + textOnly.expectedHitRate + '% < 下限 ' + FLOORS.textOnly + '%')
  }
  if (failures.length) {
    console.log('召回回归失败：')
    failures.forEach(function (f) { console.log('  ✗ ' + f) })
    process.exit(1)
  }
  console.log('召回未低于回归下限（主通道 ≥' + FLOORS.withVisual + '%，纯文字 ≥' + FLOORS.textOnly + '%）。')
}

function pct(rate) {
  return rate === null ? 'NA' : (+(rate * 100).toFixed(1) + '%')
}

if (require.main === module) main()

module.exports = { CASES: CASES, CASE_ORIGIN: CASE_ORIGIN, evaluate: evaluate }
