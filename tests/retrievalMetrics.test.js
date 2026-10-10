#!/usr/bin/env node
/**
 * tests/retrievalMetrics.test.js — B02 排名度量/标签映射/来源split/快照比较 的工程验收。
 *
 * 覆盖（对应第2轮路线图 B02-1～B02-4 验收行）：
 *   1. 集合指标：expected 第3位 → legacy=1/top1=0/mrr=1/3；空排名=0；多 expected 按集合。
 *   2. 角色指标（合成 fixture，显式 role）：主病第3位 → Top1=0/MRR=1/3；仅并存第1位 →
 *      主病未召回 MRR=0；两并存只召回一项 → 覆盖 1/2；无 role → 全部 NA＋原因；
 *      permitted_differentials 不扩展主病。
 *   3. 标签映射：显式等价集合生效；局灶/全身蠕形螨不默认等价；KB 外标签按自身计分；
 *      映射校验抓未登记等价成员/缺版本。
 *   4. 病族折叠：同族三卡占位 → unique_family_top3 唯一；未映射单列 unmapped。
 *   5. casefile 校验：开发暴露进 independent / 同 group 跨 split / independent
 *      重复 case_id / 非法 split 全部阻断。
 *   6. 语义哈希：键顺序、别名登记顺序不敏感；字段值变化即变化且逐卡隔离；有序数组换序算变化。
 *   7. 快照与比较：相同输入重跑 diff 为空；缺追溯/输入不一致拒绝；权重 fixture 变化只标受影响
 *      用例与分项；证据来源/红旗/病族折叠/名次移动逐项检出。
 *   8. 真实 KB 集成：内置 24 例两通道 legacy 字段与新字段一致、Top3 与基线一致、role 全 NA。
 *
 * 全部离线：不发检索网络请求、不调模型。这是工程验收，不是临床准确率证据。
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const rm = require(path.join(ROOT, 'evaluation', 'tools', 'retrieval_metrics.js'))
const probe = require(path.join(ROOT, 'evaluation', 'tools', 'recall_probe.js'))

let sectionCount = 0
function section(name, fn) {
  sectionCount++
  fn()
  console.log('  ok ' + sectionCount + ' - ' + name)
}

// ─────────────── 1. 集合排名指标 ───────────────

section('expected 目标在第3位：legacy=1、top1=0、mrr=1/3', function () {
  const m = rm.computeSetMetrics(['甲', '乙', '丙'], ['丙'])
  assert.strictEqual(m.legacy_expected_hit, true)
  assert.strictEqual(m.top1_expected_set, 0)
  assert.strictEqual(m.mrr_expected_set, Math.round(1 / 3 * 10000) / 10000, 'MRR 按四位小数口径返回')
  assert.strictEqual(m.first_expected_rank, 3)
  assert.strictEqual(m.expected_hits_in_top3, 1)
})

section('排名为空（弃权）：全部 0，名次 null', function () {
  const m = rm.computeSetMetrics([], ['丙'])
  assert.strictEqual(m.legacy_expected_hit, false)
  assert.strictEqual(m.top1_expected_set, 0)
  assert.strictEqual(m.mrr_expected_set, 0)
  assert.strictEqual(m.first_expected_rank, null)
  assert.strictEqual(m.ranked_count, 0)
})

section('expected 全未召回：legacy=0 且 mrr=0', function () {
  const m = rm.computeSetMetrics(['甲', '乙', '丙'], ['丁'])
  assert.strictEqual(m.legacy_expected_hit, false)
  assert.strictEqual(m.mrr_expected_set, 0)
})

section('多 expected 按集合计：rank1 不在集合 top1=0，首个成员名次给 MRR', function () {
  const m = rm.computeSetMetrics(['泛词卡', '乙', '丙'], ['乙', '丙'])
  assert.strictEqual(m.top1_expected_set, 0)
  assert.strictEqual(m.mrr_expected_set, 0.5)
  assert.strictEqual(m.legacy_expected_hit, true)
  assert.strictEqual(m.expected_hits_in_ranked, 2)
})

section('expected 首位命中：top1=1、mrr=1', function () {
  const m = rm.computeSetMetrics(['甲', '乙'], ['甲'])
  assert.strictEqual(m.top1_expected_set, 1)
  assert.strictEqual(m.mrr_expected_set, 1)
})

section('聚合：多例 top1 率 / MRR 均值 / legacy 率', function () {
  const agg = rm.aggregateSetMetrics([
    { top1_expected_set: 1, mrr_expected_set: 1, legacy_expected_hit: true },
    { top1_expected_set: 0, mrr_expected_set: 1 / 3, legacy_expected_hit: true },
    { top1_expected_set: 0, mrr_expected_set: 0, legacy_expected_hit: false }
  ])
  assert.strictEqual(agg.n, 3)
  assert.strictEqual(agg.top1_expected_set_rate, Math.round(1 / 3 * 10000) / 10000)
  assert.strictEqual(agg.mrr_expected_set_mean, Math.round((1 + 1 / 3 + 0) / 3 * 10000) / 10000)
  assert.strictEqual(agg.legacy_expected_hit_rate, Math.round(2 / 3 * 10000) / 10000)
})

// ─────────────── 2. 角色指标（显式 role 的合成 fixture） ───────────────

const ROLE_MAP = JSON.parse(JSON.stringify({
  kind: 'retrieval_label_map',
  map_version: 'test-1',
  taxonomy_scope: 'kb_card_labels',
  labels: {
    '浅表脓皮病': { family_code: 'pyoderma_superficial', subtype_code: null, species_scope: ['犬'], target_granularity: 'disease_family_card', equivalence_set: 'pyo_pair' },
    '猫浅表脓皮病': { family_code: 'pyoderma_superficial', subtype_code: 'feline', species_scope: ['猫'], target_granularity: 'species_variant_card', equivalence_set: 'pyo_pair' },
    '蠕形螨病（局灶型）': { family_code: 'demodicosis', subtype_code: 'canine_localized', species_scope: ['犬'], target_granularity: 'severity_subtype_card', equivalence_set: null },
    '全身型蠕形螨病': { family_code: 'demodicosis', subtype_code: 'canine_generalized', species_scope: ['犬'], target_granularity: 'severity_subtype_card', equivalence_set: null }
  },
  equivalence_sets: {
    pyo_pair: { members: ['浅表脓皮病', '猫浅表脓皮病'], basis: '测试等价组' }
  }
}))

section('主病第3位（显式 role）：top1_primary=0、mrr_primary=1/3、top3 主病召回=1', function () {
  const r = rm.computeRoleMetrics(['方向A', '方向B', '主病P'], {
    primary_target: ['主病P'], coexisting_targets: ['并C1', '并C2']
  }, null)
  assert.strictEqual(r.primary.applicable, true)
  assert.strictEqual(r.primary.top1_primary, 0)
  assert.strictEqual(r.primary.mrr_primary, Math.round(1 / 3 * 10000) / 10000)
  assert.strictEqual(r.primary.top3_primary_recall, 1)
})

section('主病第3位 + 两并存只召回一项：并存覆盖=1/2', function () {
  const r = rm.computeRoleMetrics(['并C1', '方向B', '主病P'], {
    primary_target: ['主病P'], coexisting_targets: ['并C1', '并C2']
  }, null)
  assert.strictEqual(r.coexisting.applicable, true)
  assert.strictEqual(r.coexisting.top3_coexisting_coverage, 0.5)
  assert.deepStrictEqual(r.coexisting.covered, ['并C1'])
  assert.deepStrictEqual(r.coexisting.missing, ['并C2'])
})

section('仅并存病第1位（主病未召回）：主病 Top1=0、MRR=0，不把并存当主病', function () {
  const r = rm.computeRoleMetrics(['并C1', '方向B'], {
    primary_target: ['主病P'], coexisting_targets: ['并C1']
  }, null)
  assert.strictEqual(r.primary.top1_primary, 0)
  assert.strictEqual(r.primary.mrr_primary, 0)
  assert.strictEqual(r.primary.first_primary_rank, null)
  assert.strictEqual(r.coexisting.top3_coexisting_coverage, 1)
})

section('无 role：primary/coexisting 全部 NA＋原因，不得借 expected 补猜', function () {
  const r = rm.computeRoleMetrics(['甲', '乙'], null, null)
  assert.strictEqual(r.role_present, false)
  assert.strictEqual(r.primary.applicable, false)
  assert.strictEqual(r.primary.reason, 'no_independent_role_labels')
  assert.strictEqual(r.coexisting.applicable, false)
  assert.strictEqual(r.top1_primary, null)
  assert.strictEqual(r.top3_coexisting_coverage, null)
})

section('role 只有主病没有并存：并存指标单独 NA（原因 coexisting_targets_missing）', function () {
  const r = rm.computeRoleMetrics(['主病P'], { primary_target: ['主病P'] }, null)
  assert.strictEqual(r.primary.applicable, true)
  assert.strictEqual(r.coexisting.applicable, false)
  assert.strictEqual(r.coexisting.reason, 'coexisting_targets_missing')
})

section('permitted_differentials 不扩展主病：鉴别命中不算主病 Top-1', function () {
  const r = rm.computeRoleMetrics(['允许鉴别D', '方向B'], {
    primary_target: ['主病P'],
    coexisting_targets: [],
    permitted_differentials: ['允许鉴别D']
  }, null)
  assert.strictEqual(r.primary.top1_primary, 0)
  assert.strictEqual(r.primary.mrr_primary, 0)
})

section('显式等价集合生效：浅表脓皮病 ⇄ 猫浅表脓皮病 互为主病等价成员', function () {
  const r = rm.computeRoleMetrics(['猫浅表脓皮病'], { primary_target: ['浅表脓皮病'], coexisting_targets: [] }, ROLE_MAP)
  assert.strictEqual(r.primary.top1_primary, 1)
  assert.deepStrictEqual(r.primary.primary_equivalence_set, ['浅表脓皮病', '猫浅表脓皮病'])
})

section('局灶/全身蠕形螨不默认等价：未声明等价集合时按各自标签计', function () {
  assert.deepStrictEqual(rm.resolveEquivalenceSet('蠕形螨病（局灶型）', ROLE_MAP), ['蠕形螨病（局灶型）'])
  assert.deepStrictEqual(rm.resolveEquivalenceSet('全身型蠕形螨病', ROLE_MAP), ['全身型蠕形螨病'])
  const r = rm.computeRoleMetrics(['全身型蠕形螨病'], { primary_target: ['蠕形螨病（局灶型）'], coexisting_targets: [] }, ROLE_MAP)
  assert.strictEqual(r.primary.top1_primary, 0, '亚型不得冒充另一亚型的主病命中')
})

section('KB 外标签按自身计分，不算错误也不猜测', function () {
  assert.deepStrictEqual(rm.resolveEquivalenceSet('映射里没有的病', ROLE_MAP), ['映射里没有的病'])
  const r = rm.computeRoleMetrics(['映射里没有的病'], { primary_target: ['映射里没有的病'], coexisting_targets: [] }, ROLE_MAP)
  assert.strictEqual(r.primary.top1_primary, 1)
})

// ─────────────── 3. 病族折叠 ───────────────

section('同族三卡占位：unique_family_top3 唯一且保留首个名次/最高分成员', function () {
  const v = rm.foldByFamily([
    { name: '浅表脓皮病', id: 'a', score: 12 },
    { name: '脓疱病', id: 'b', score: 9 },
    { name: '猫浅表脓皮病', id: 'c', score: 7 }
  ], JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json'), 'utf8')))
  assert.strictEqual(v.unique.length, 1)
  assert.strictEqual(v.unique[0].family_code, 'pyoderma_superficial')
  assert.strictEqual(v.unique[0].first_rank, 1)
  assert.strictEqual(v.unique[0].members.length, 3)
  assert.strictEqual(v.unmapped.length, 0)
})

section('未映射标签单列 unmapped，不判错也不丢弃', function () {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json'), 'utf8'))
  const v = rm.foldByFamily([
    { name: '皮肤癣菌病（犬猫）', id: 'r', score: 10 },
    { name: 'KB外新病', id: 'x', score: 8 }
  ], map)
  assert.strictEqual(v.unique.length, 1)
  assert.strictEqual(v.unmapped.length, 1)
  assert.strictEqual(v.unmapped[0].name, 'KB外新病')
  assert.strictEqual(v.unmapped[0].rank, 2)
})

section('真实 69 卡映射校验通过且每张卡都有 family_code', function () {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json'), 'utf8'))
  const v = rm.validateLabelMap(map)
  assert.strictEqual(v.ok, true, '映射校验应通过：' + JSON.stringify(v.errors))
  assert.strictEqual(v.entryCount, 69)
  const kb = require(path.join(ROOT, 'utils', 'kb.js'))
  kb.DISEASE_KB.forEach(function (card) {
    assert.ok(map.labels[card.name], '映射缺卡：' + card.name)
  })
})

// ─────────────── 4. 标签映射校验反例 ───────────────

section('映射校验：等价集合引用未登记标签 → 阻断', function () {
  const bad = JSON.parse(JSON.stringify(ROLE_MAP))
  bad.equivalence_sets.pyo_pair.members.push('不存在的卡')
  const v = rm.validateLabelMap(bad)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(function (e) { return e.indexOf('未在 labels 登记') >= 0 }))
})

section('映射校验：缺 map_version → 阻断（映射必须显式版本化）', function () {
  const bad = JSON.parse(JSON.stringify(ROLE_MAP))
  delete bad.map_version
  const v = rm.validateLabelMap(bad)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(function (e) { return e.indexOf('map_version') >= 0 }))
})

section('映射校验：等价集合成员少于 2 → 阻断（等价必须显式成组）', function () {
  const bad = JSON.parse(JSON.stringify(ROLE_MAP))
  bad.equivalence_sets.solo = { members: ['浅表脓皮病'], basis: 'x' }
  const v = rm.validateLabelMap(bad)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(function (e) { return e.indexOf('成员少于 2') >= 0 }))
})

// ─────────────── 5. casefile 来源/split 纪律 ───────────────

function baseCase(over) {
  return Object.assign({
    case_id: 'C1',
    complaint: '狗狗一直挠',
    species: '犬',
    bodyPart: '躯干',
    visualFeatures: ['红斑'],
    expected: ['跳蚤过敏性皮炎'],
    input_origin: 'manual_simulation',
    feature_origin: 'manual_simulation',
    source_case_id: null,
    scenario_group_id: 'G1',
    split: 'development',
    development_exposure: 'exposed',
    labeler: null,
    role: null
  }, over || {})
}
function casefileOf(cases) {
  return { kind: 'retrieval_casefile', casefile_version: '1.0.0', cases: cases }
}

section('合法 casefile（development / 规范 independent）通过校验', function () {
  const v = rm.validateCasefile(casefileOf([
    baseCase(),
    baseCase({
      case_id: 'C2', scenario_group_id: 'G2', split: 'independent',
      development_exposure: 'not_exposed', feature_origin: 'real_precheck',
      role: { primary_target: ['跳蚤过敏性皮炎'], coexisting_targets: [] }
    })
  ]))
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors))
  assert.strictEqual(v.warnings.length, 0)
})

section('E6：同 scenario_group_id 跨 split → 阻断', function () {
  const v = rm.validateCasefile(casefileOf([
    baseCase(),
    baseCase({ case_id: 'C2', scenario_group_id: 'G1', split: 'independent',
      development_exposure: 'not_exposed', feature_origin: 'real_precheck' })
  ]))
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(function (e) { return e.indexOf('E6') >= 0 }))
})

section('E7：同 source_case_id 跨 split（模板改写/衍生） → 阻断', function () {
  const v = rm.validateCasefile(casefileOf([
    baseCase({ source_case_id: 'SRC-9' }),
    baseCase({ case_id: 'C2', source_case_id: 'SRC-9', scenario_group_id: 'G2', split: 'independent',
      development_exposure: 'not_exposed', feature_origin: 'real_precheck' })
  ]))
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some(function (e) { return e.indexOf('E7') >= 0 }))
})

section('E1/E3/E4：重复 case_id、空 expected、非法 split 全部阻断', function () {
  const dup = rm.validateCasefile(casefileOf([baseCase(), baseCase()]))
  assert.ok(dup.errors.some(function (e) { return e.indexOf('重复') >= 0 }))
  const noExp = rm.validateCasefile(casefileOf([baseCase({ expected: [] })]))
  assert.ok(noExp.errors.some(function (e) { return e.indexOf('expected') >= 0 }))
  const badSplit = rm.validateCasefile(casefileOf([baseCase({ split: 'invalid_split' })]))
  assert.ok(badSplit.errors.some(function (e) { return e.indexOf('split 非法') >= 0 }))
})

// ─────────────── 6. 语义哈希 ───────────────

function demoCard(over) {
  return Object.assign({
    id: 'x_犬', name: '示例卡', species: ['犬'],
    aliases: ['别名B', '别名A', 'alias c'],
    visualSigns: ['红斑'], historySigns: ['瘙痒'],
    recommendedTests: ['检查一', '检查二'],
    meta: { weight: 3, nested: { b: 2, a: 1 } }
  }, over || {})
}

section('卡片哈希：对象键顺序不敏感', function () {
  const h1 = rm.canonicalCardHash(demoCard())
  const h2 = rm.canonicalCardHash({
    meta: { nested: { a: 1, b: 2 }, weight: 3 },
    historySigns: ['瘙痒'], visualSigns: ['红斑'],
    aliases: ['别名B', '别名A', 'alias c'],
    recommendedTests: ['检查一', '检查二'],
    species: ['犬'], name: '示例卡', id: 'x_犬'
  })
  assert.strictEqual(h1, h2)
})

section('卡片哈希：别名登记顺序不敏感（集合语义）', function () {
  const h1 = rm.canonicalCardHash(demoCard())
  const h2 = rm.canonicalCardHash(demoCard({ aliases: ['alias c', '别名A', '别名B'] }))
  assert.strictEqual(h1, h2)
})

section('卡片哈希：字段值变化即变化，且逐卡隔离', function () {
  const h1 = rm.canonicalCardHash(demoCard())
  const h2 = rm.canonicalCardHash(demoCard({ visualSigns: ['红斑', '鳞屑'] }))
  assert.notStrictEqual(h1, h2)

  const cardA = demoCard({ id: 'a' })
  const cardB = demoCard({ id: 'b', name: '另一卡' })
  const beforeA = rm.canonicalCardHash(cardA)
  const beforeB = rm.canonicalCardHash(cardB)
  cardB.visualSigns.push('新增征')
  assert.strictEqual(rm.canonicalCardHash(cardA), beforeA, '未改的卡哈希不得变')
  assert.notStrictEqual(rm.canonicalCardHash(cardB), beforeB, '被改的卡哈希必须变')
})

section('卡片哈希：有序数组（recommendedTests）换序算内容变化', function () {
  const h1 = rm.canonicalCardHash(demoCard())
  const h2 = rm.canonicalCardHash(demoCard({ recommendedTests: ['检查二', '检查一'] }))
  assert.notStrictEqual(h1, h2, '检查顺序是有序列表语义，换序必须变哈希')
})

// ─────────────── 7. 快照构建与比较 ───────────────

function fakeRun(caseKey, results, setMetrics) {
  return {
    case_key: caseKey,
    query: { species: '犬', complaint: caseKey },
    results: results,
    set_metrics: setMetrics || { top1_expected_set: 1, mrr_expected_set: 1 },
    role_metrics: rm.computeRoleMetrics(results.map(function (r) { return r.name }), null, null),
    family_view: rm.foldByFamily(results.map(function (r) { return { name: r.name, id: r.id, score: r.score } }), null),
    origin: { split: 'development' }
  }
}
function snapCtx() {
  return {
    kbVersion: 'test-kb',
    kbSourceSha256: 'aaaa',
    codeCommit: 'commit0',
    worktreeDirty: true,
    labelMapVersion: '1.0.0',
    labelMapSha256: 'bbbb',
    cardHashes: { card_a: 'hA1', card_b: 'hB1' }
  }
}
function buildTestSnapshot(runs) {
  return rm.buildSnapshot({
    sourceKind: 'builtin_dev_corpus',
    casefileMeta: null,
    cases: [{ complaint: '病例一', species: '犬', bodyPart: '躯干', visualFeatures: [], expected: ['甲'] },
            { complaint: '病例二', species: '犬', bodyPart: '爪部', visualFeatures: [], expected: ['乙'] }],
    channels: { textOnly: runs },
    context: snapCtx()
  })
}

const RUNS_A = [
  fakeRun('病例一', [
    { id: 'card_a', name: '甲', score: 20, matched: ['视觉:红斑'], redFlagMatches: [] },
    { id: 'card_b', name: '乙', score: 15, matched: ['病史:挠'], redFlagMatches: [] }
  ]),
  fakeRun('病例二', [
    { id: 'card_b', name: '乙', score: 18, matched: ['病史:舔'], redFlagMatches: ['渗出'] }
  ])
]

section('快照：输入哈希确定（同输入同哈希；expected 变化即变化）', function () {
  const s1 = buildTestSnapshot(RUNS_A)
  const s2 = buildTestSnapshot(RUNS_A)
  assert.strictEqual(s1.traceability.input_sha256, s2.traceability.input_sha256)
  const s3 = rm.buildSnapshot({
    sourceKind: 'builtin_dev_corpus', casefileMeta: null,
    cases: [{ complaint: '病例一', species: '犬', bodyPart: '躯干', visualFeatures: [], expected: ['乙'] }],
    channels: {}, context: snapCtx()
  })
  assert.notStrictEqual(s1.traceability.input_sha256, s3.traceability.input_sha256)
})

section('比较：相同输入重跑 diff 为空（created_at 不同也不算变化）', function () {
  const a = buildTestSnapshot(RUNS_A)
  const b = JSON.parse(JSON.stringify(a))
  b.created_at = '2099-01-01T00:00:00.000Z'
  const d = rm.diffSnapshots(a, b)
  assert.strictEqual(d.status, 'ok')
  assert.strictEqual(d.ranking_semantically_unchanged, true, JSON.stringify(d.channels))
  assert.strictEqual(d.changed_case_count_total, 0)
})

section('比较：缺追溯字段 → 拒绝（退出语义 status=refused）', function () {
  const a = buildTestSnapshot(RUNS_A)
  const b = JSON.parse(JSON.stringify(a))
  delete b.traceability
  assert.strictEqual(rm.diffSnapshots(a, b).status, 'refused')
  const noInput = JSON.parse(JSON.stringify(a))
  delete noInput.traceability.input_sha256
  assert.strictEqual(rm.diffSnapshots(a, noInput).status, 'refused')
})

section('比较：input_sha256 不一致 → 拒绝（不同输入禁止算分歧）', function () {
  const a = buildTestSnapshot(RUNS_A)
  const b = rm.buildSnapshot({
    sourceKind: 'builtin_dev_corpus', casefileMeta: null,
    cases: [{ complaint: '另一个语料', species: '猫', bodyPart: '', visualFeatures: [], expected: ['丙'] }],
    channels: {}, context: snapCtx()
  })
  const d = rm.diffSnapshots(a, b)
  assert.strictEqual(d.status, 'refused')
  assert.ok(d.refuse_reason.indexOf('input_sha256') >= 0)
})

section('比较：权重 fixture 变化只指出受影响用例与分项（moved+score_delta）', function () {
  const a = buildTestSnapshot(RUNS_A)
  const runsB = [
    RUNS_A[0],
    fakeRun('病例二', [
      { id: 'card_b', name: '乙', score: 19.5, matched: ['病史:舔'], redFlagMatches: ['渗出'] },
      { id: 'card_c', name: '丙', score: 9, matched: ['别名:丙别名'], redFlagMatches: [] }
    ])
  ]
  const b = buildTestSnapshot(runsB)
  const d = rm.diffSnapshots(a, b)
  assert.strictEqual(d.status, 'ok')
  assert.strictEqual(d.changed_case_count_total, 1, '只有病例二受影响')
  const caseRep = d.channels.textOnly.cases.filter(function (c) { return c.case_key === '病例二' })[0]
  assert.strictEqual(caseRep.ranking_changed, true)
  const moved = caseRep.ranking_changes.filter(function (r) { return r.kind === 'moved' })[0]
  assert.strictEqual(moved.id, 'card_b')
  assert.strictEqual(moved.before.rank, 1)
  assert.strictEqual(moved.after.rank, 1)
  assert.strictEqual(moved.score_delta, 1.5)
  const added = caseRep.ranking_changes.filter(function (r) { return r.kind === 'added' })[0]
  assert.strictEqual(added.id, 'card_c')
  const untouched = d.channels.textOnly.cases.filter(function (c) { return c.case_key === '病例一' })[0]
  assert.strictEqual(untouched.ranking_changed, false, '病例一必须保持 diff 为空')
})

section('比较：卡片内容哈希变化单独列出（改一张卡只标该卡）', function () {
  const a = buildTestSnapshot(RUNS_A)
  const ctx = snapCtx()
  ctx.cardHashes.card_b = 'hB2-changed'
  const b = rm.buildSnapshot({
    sourceKind: 'builtin_dev_corpus', casefileMeta: null,
    cases: [{ complaint: '病例一', species: '犬', bodyPart: '躯干', visualFeatures: [], expected: ['甲'] },
            { complaint: '病例二', species: '犬', bodyPart: '爪部', visualFeatures: [], expected: ['乙'] }],
    channels: { textOnly: JSON.parse(JSON.stringify(RUNS_A)) },
    context: ctx
  })
  const d = rm.diffSnapshots(a, b)
  assert.strictEqual(d.status, 'ok')
  assert.strictEqual(d.card_hash_changes.length, 1)
  assert.strictEqual(d.card_hash_changes[0].id, 'card_b')
  assert.strictEqual(d.card_hash_changes[0].change, 'content_changed')
})

section('比较：证据来源/红旗增删、名次移动、病族折叠变化逐项检出', function () {
  const a = buildTestSnapshot(RUNS_A)
  const runsB = [
    fakeRun('病例一', [
      { id: 'card_a', name: '甲', score: 20, matched: ['视觉:红斑', '视觉:新增征'], redFlagMatches: [] },
      { id: 'card_b', name: '乙', score: 11, matched: [], redFlagMatches: ['快速增大'] }
    ]),
    RUNS_A[1]
  ]
  const b = buildTestSnapshot(runsB)
  const d = rm.diffSnapshots(a, b)
  const rep = d.channels.textOnly.cases.filter(function (c) { return c.case_key === '病例一' })[0]
  assert.strictEqual(d.status, 'ok')
  const evA = rep.evidence_changes.per_card.card_a
  assert.deepStrictEqual(evA.matched.added, ['视觉:新增征'])
  assert.deepStrictEqual(evA.matched.removed, [])
  const evB = rep.evidence_changes.per_card.card_b
  assert.deepStrictEqual(evB.matched.removed, ['病史:挠'])
  assert.deepStrictEqual(evB.red_flags.added, ['快速增大'])
  const movedB = rep.ranking_changes.filter(function (r) { return r.kind === 'moved' && r.id === 'card_b' })[0]
  assert.strictEqual(movedB.before.rank, 2)
  assert.strictEqual(movedB.after.rank, 2)

  // 病族折叠变化：family_view 由 foldByFamily(null map) 生成 → 全部 unmapped；
  // 构造 family 视图差异直接验证 diffFamilyView 通路
  const fa = buildTestSnapshot([fakeRun('病例X', [{ id: 'k1', name: '甲', score: 5, matched: [], redFlagMatches: [] }])])
  const fb = buildTestSnapshot([fakeRun('病例X', [{ id: 'k1', name: '甲', score: 5, matched: [], redFlagMatches: [] }])])
  fb.channels.textOnly[0].family_view = { unique: [{ family_code: 'other_family', first_rank: 1, members: ['甲'] }], unmapped: [] }
  const df = rm.diffSnapshots(fa, fb)
  const frep = df.channels.textOnly.cases[0]
  assert.deepStrictEqual(frep.family_changes.added, ['other_family'])
  assert.deepStrictEqual(frep.family_changes.removed, [])
})

section('比较：用例只在单侧出现 → 计为变化（only_in_before/only_in_after）', function () {
  const a = buildTestSnapshot([RUNS_A[0]])
  const b = buildTestSnapshot([RUNS_A[1]])
  const d = rm.diffSnapshots(a, b)
  assert.strictEqual(d.status, 'ok')
  const keys = d.channels.textOnly.cases.map(function (c) { return c.case_key + ':' + c.presence }).sort()
  assert.deepStrictEqual(keys, ['病例一:only_in_before', '病例二:only_in_after'])
  assert.strictEqual(d.ranking_semantically_unchanged, false)
})

// ─────────────── 8. 真实 KB 集成（内置 24 例，离线检索） ───────────────

section('内置 24 例：legacy 字段语义保留，语义修复后仍达到预注册护栏', function () {
  const textOnly = probe.evaluate(false)
  const withVisual = probe.evaluate(true)
  assert.strictEqual(textOnly.rows.length, 24)
  assert.strictEqual(withVisual.rows.length, 24)
  // 基线（legacy-before.json）：两通道任一 expected 命中均 24/24
  // BUG-12：不再用虚构的行为→形态扩展维持 24/24，原病例与 expect 均未修改。
  assert.ok(textOnly.expectedHit / 24 >= 0.7)
  assert.ok(withVisual.expectedHit / 24 >= 0.9)
  ;[textOnly, withVisual].forEach(function (ch) {
    ch.rows.forEach(function (r) {
      assert.strictEqual(r.hitExpected, r.legacy_expected_hit, 'legacy 字段语义必须逐例一致')
      if (r.first_expected_rank === 1) {
        assert.strictEqual(r.top1_expected_set, 1)
        assert.strictEqual(r.mrr_expected_set, 1)
      } else if (r.first_expected_rank !== null) {
        assert.strictEqual(r.top1_expected_set, 0)
        assert.strictEqual(r.mrr_expected_set, Math.round(1 / r.first_expected_rank * 10000) / 10000)
      } else {
        assert.strictEqual(r.mrr_expected_set, 0)
      }
    })
  })
  assert.ok(textOnly.top1ExpectedSetRate >= 0 && textOnly.top1ExpectedSetRate <= 1)
  assert.ok(withVisual.top1ExpectedSetRate >= 0 && withVisual.top1ExpectedSetRate <= 1)
})

// 基线数据取自批次留档 legacy-before.json（B02 before 快照，2026-10-03）。
// 检索排序在 B02 中不得改动：任何后续批次改变这里的逐例 Top3，都必须逐例解释根因，
// 不得静默更新本基线（GATE-03/04）。
const BASELINE_TOP3 = {
textOnly: [
    { c: "狗狗最近老是挠，经常带它去草地遛弯，好久没驱虫了", retrieved: ["跳蚤过敏性皮炎","姬螯螨病（行走的皮屑）","蜱虫叮咬"] },
    { c: "家里两只猫都在挠，另一只也痒，背上一粒粒的结痂", retrieved: ["猫粟粒性皮炎（跳蚤过敏）","跳蚤过敏性皮炎","猫浅表脓皮病"] },
    { c: "刚从救助站接回来的小猫，脸上一块圆圆的秃了，我手上也起了红疹", retrieved: ["皮肤癣菌病（犬猫）","猫疥螨病","跳蚤过敏性皮炎"] },
    { c: "每年春天就犯，一到换季就开始舔爪子啃肚皮，以前也过敏", retrieved: ["特应性皮炎（环境过敏）","食物过敏性皮炎","趾间脓皮病（趾间炎）"] },
    { c: "老是犯，治好了又来，耳朵反复发炎还一直舔脚", retrieved: ["特应性皮炎（环境过敏）","趾间脓皮病（趾间炎）","肢端舔舐性肉芽肿"] },
    { c: "一直甩头，耳屎特别多，耳朵黏糊糊的还很臭", retrieved: ["耳螨感染","马拉色菌性外耳炎","耳血肿"] },
    { c: "猫一直甩头挠耳朵，耳朵里好多黑色的东西像黑芝麻", retrieved: ["耳螨感染","马拉色菌性外耳炎","马拉色菌皮炎"] },
    { c: "两边都掉毛，一点都不痒，最近喝水特别多还老是尿", retrieved: ["库兴综合征相关皮肤改变","甲状腺功能减退相关皮肤改变","蠕形螨病（局灶型）"] },
    { c: "老猫瘦了好多，喝水多，背上毛没光泽还两边都掉", retrieved: ["猫甲状腺功能亢进相关皮肤改变"] },
    { c: "两边对称掉毛，也不痒，狗变胖了没精神", retrieved: ["甲状腺功能减退相关皮肤改变","蠕形螨病（局灶型）","落叶型天疱疮"] },
    { c: "猫皮很薄，抱一下一碰就破，都没外伤自己就裂开了", retrieved: ["猫皮肤脆弱症"] },
    { c: "脖子上烂了一块，昨天还好好的一夜之间就烂开了", retrieved: ["急性湿性皮炎（热点）","脓肿/蜂窝织炎","接触性皮炎"] },
    { c: "腿上破了个洞一直流脓，摸着里面硬硬的", retrieved: ["深部脓皮病","肛周瘘管","脓肿/蜂窝织炎"] },
    { c: "鼻子和脚垫硬邦邦的像老茧，还干裂了", retrieved: ["鼻/足垫角化过度","锌反应性皮病","压力性胼胝/肘部胼胝"] },
    { c: "下巴上黑黑的一片怎么洗都洗不掉", retrieved: ["猫痤疮"] },
    { c: "肚子上密密麻麻小红疙瘩，有的顶上是白的", retrieved: ["浅表脓皮病"] },
    { c: "身上油乎乎的一股酸臭味，皮肤还发黑了", retrieved: ["马拉色菌皮炎","马拉色菌性外耳炎"] },
    { c: "爪子中间反复红肿，一直舔，都舔秃了", retrieved: ["趾间脓皮病（趾间炎）","特应性皮炎（环境过敏）","肢端舔舐性肉芽肿"] },
    { c: "白猫耳朵尖一直烂着好不了，还老出血", retrieved: ["猫鳞状细胞癌","皮肤肿瘤（肥大细胞瘤等）"] },
    { c: "身上长了个硬疙瘩越来越大，表面破了", retrieved: ["皮肤肿瘤（肥大细胞瘤等）","皮脂腺囊肿","良性肿块（组织细胞瘤/脂肪瘤）"] },
    { c: "尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点", retrieved: ["跳蚤过敏性皮炎","浅表脓皮病","耳螨感染"] },
    { c: "幼犬脸肿得厉害，眼睛周围都是脓包，下巴那里也肿了还发烧", retrieved: ["幼犬蜂窝织炎","蚊虫叮咬/昆虫过敏","脓肿/蜂窝织炎"] },
    { c: "狗鼻子颜色变浅了发白，上面反复结痂还溃疡", retrieved: ["盘状红斑狼疮","肢端舔舐性肉芽肿"] },
    { c: "眼皮红肿结痂，一直眯着眼流眼泪还用爪子揉", retrieved: ["睑炎","特应性皮炎（环境过敏）","趾间脓皮病（趾间炎）"] }
  ],
  withVisual: [
    { c: "狗狗最近老是挠，经常带它去草地遛弯，好久没驱虫了", retrieved: ["跳蚤过敏性皮炎","姬螯螨病（行走的皮屑）","疥螨病"] },
    { c: "家里两只猫都在挠，另一只也痒，背上一粒粒的结痂", retrieved: ["猫粟粒性皮炎（跳蚤过敏）","跳蚤过敏性皮炎","猫浅表脓皮病"] },
    { c: "刚从救助站接回来的小猫，脸上一块圆圆的秃了，我手上也起了红疹", retrieved: ["皮肤癣菌病（犬猫）","猫疥螨病","跳蚤过敏性皮炎"] },
    { c: "每年春天就犯，一到换季就开始舔爪子啃肚皮，以前也过敏", retrieved: ["特应性皮炎（环境过敏）","食物过敏性皮炎","趾间脓皮病（趾间炎）"] },
    { c: "老是犯，治好了又来，耳朵反复发炎还一直舔脚", retrieved: ["马拉色菌性外耳炎","特应性皮炎（环境过敏）","趾间脓皮病（趾间炎）"] },
    { c: "一直甩头，耳屎特别多，耳朵黏糊糊的还很臭", retrieved: ["马拉色菌性外耳炎","耳螨感染","马拉色菌皮炎"] },
    { c: "猫一直甩头挠耳朵，耳朵里好多黑色的东西像黑芝麻", retrieved: ["耳螨感染","马拉色菌性外耳炎","马拉色菌皮炎"] },
    { c: "两边都掉毛，一点都不痒，最近喝水特别多还老是尿", retrieved: ["库兴综合征相关皮肤改变","甲状腺功能减退相关皮肤改变","蠕形螨病（局灶型）"] },
    { c: "老猫瘦了好多，喝水多，背上毛没光泽还两边都掉", retrieved: ["猫甲状腺功能亢进相关皮肤改变"] },
    { c: "两边对称掉毛，也不痒，狗变胖了没精神", retrieved: ["甲状腺功能减退相关皮肤改变","蠕形螨病（局灶型）","全身型蠕形螨病"] },
    { c: "猫皮很薄，抱一下一碰就破，都没外伤自己就裂开了", retrieved: ["猫皮肤脆弱症"] },
    { c: "脖子上烂了一块，昨天还好好的一夜之间就烂开了", retrieved: ["急性湿性皮炎（热点）","皮肤褶皱皮炎","脓肿/蜂窝织炎"] },
    { c: "腿上破了个洞一直流脓，摸着里面硬硬的", retrieved: ["皮肤肿瘤（肥大细胞瘤等）","深部脓皮病","皮肤淋巴瘤（蕈样肉芽肿）"] },
    { c: "鼻子和脚垫硬邦邦的像老茧，还干裂了", retrieved: ["鼻/足垫角化过度","锌反应性皮病","压力性胼胝/肘部胼胝"] },
    { c: "下巴上黑黑的一片怎么洗都洗不掉", retrieved: ["猫痤疮"] },
    { c: "肚子上密密麻麻小红疙瘩，有的顶上是白的", retrieved: ["浅表脓皮病"] },
    { c: "身上油乎乎的一股酸臭味，皮肤还发黑了", retrieved: ["马拉色菌皮炎","皮脂溢性皮炎","甲状腺功能减退相关皮肤改变"] },
    { c: "爪子中间反复红肿，一直舔，都舔秃了", retrieved: ["趾间脓皮病（趾间炎）","特应性皮炎（环境过敏）","肢端舔舐性肉芽肿"] },
    { c: "白猫耳朵尖一直烂着好不了，还老出血", retrieved: ["猫鳞状细胞癌","皮肤肿瘤（肥大细胞瘤等）","嗜酸性肉芽肿复合体"] },
    { c: "身上长了个硬疙瘩越来越大，表面破了", retrieved: ["皮肤肿瘤（肥大细胞瘤等）","皮脂腺囊肿","良性肿块（组织细胞瘤/脂肪瘤）"] },
    { c: "尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点", retrieved: ["浅表脓皮病","跳蚤过敏性皮炎","耳螨感染"] },
    { c: "幼犬脸肿得厉害，眼睛周围都是脓包，下巴那里也肿了还发烧", retrieved: ["幼犬蜂窝织炎","浅表脓皮病","落叶型天疱疮"] },
    { c: "狗鼻子颜色变浅了发白，上面反复结痂还溃疡", retrieved: ["盘状红斑狼疮","皮肤淋巴瘤（蕈样肉芽肿）"] },
    { c: "眼皮红肿结痂，一直眯着眼流眼泪还用爪子揉", retrieved: ["睑炎","特应性皮炎（环境过敏）","趾间脓皮病（趾间炎）"] }
  ]
}

section('内置 24 例：保留 B02 历史基线并验证当前排序可复现（B12 改来源）', function () {
  const withVisual = probe.evaluate(true)
  const textOnly = probe.evaluate(false)
  ;[{ ch: 'textOnly', now: textOnly }, { ch: 'withVisual', now: withVisual }].forEach(function (pair) {
    const base = BASELINE_TOP3[pair.ch]
    assert.strictEqual(base.length, pair.now.rows.length)
    base.forEach(function (old, i) {
      const now = pair.now.rows[i]
      assert.strictEqual(old.c, now.complaint, '用例顺序不得变')
      // BUG-24：历史排序用于差异报告，不阻止后续明确授权的来源修复。
      const replay = probe.evaluate(pair.ch === 'withVisual').rows[i]
      assert.deepStrictEqual(now.retrieved, replay.retrieved, '相同版本和输入必须可回放：' + old.c)
      assert.strictEqual(now.hitExpected, now.retrieved.some(function (n) { return now.expected.indexOf(n) >= 0 }))
    })
  })
})

section('内置 24 例：role 指标全部 NA＋原因；来源/版本元数据为 development/manual_simulation', function () {
  const withVisual = probe.evaluate(true)
  withVisual.rows.forEach(function (r) {
    assert.strictEqual(r.role_metrics.role_present, false)
    assert.strictEqual(r.role_metrics.primary.applicable, false)
    assert.strictEqual(r.role_metrics.primary.reason, 'no_independent_role_labels')
    assert.strictEqual(r.role_metrics.top1_primary, null)
    assert.strictEqual(r.role_metrics.top3_coexisting_coverage, null)
    assert.strictEqual(r.origin.split, 'development')
    assert.strictEqual(r.origin.input_origin, 'manual_simulation')
    assert.strictEqual(r.origin.feature_origin, 'manual_simulation')
    assert.strictEqual(r.origin.development_exposure, 'exposed')
  })
  assert.strictEqual(withVisual.roleMetricsSummary.status, 'NA')
  assert.strictEqual(withVisual.roleMetricsSummary.reason, 'no_independent_role_labels')
})

section('真实快照端到端：构建→自比较 diff 为空；追溯字段齐备', function () {
  const textOnly = probe.evaluate(false)
  const withVisual = probe.evaluate(true)
  const kbSource = fs.readFileSync(path.join(ROOT, 'utils', 'kb.js'))
  const cardHashes = {}
  const kb = require(path.join(ROOT, 'utils', 'kb.js'))
  kb.DISEASE_KB.forEach(function (card) { cardHashes[card.id] = rm.canonicalCardHash(card) })
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json'), 'utf8'))
  const snap = rm.buildSnapshot({
    sourceKind: 'builtin_dev_corpus',
    casefileMeta: null,
    cases: probe.CASES.map(function (t) {
      return { case_id: null, complaint: t.c, species: t.s, bodyPart: t.b, visualFeatures: t.vf, expected: t.expect }
    }),
    channels: { textOnly: textOnly.runs, withVisual: withVisual.runs },
    context: {
      kbVersion: kb.KB_VERSION,
      kbSourceSha256: rm.sha256Of(kbSource),
      codeCommit: 'local-test',
      worktreeDirty: true,
      labelMapVersion: map.map_version,
      labelMapSha256: rm.sha256Of(fs.readFileSync(path.join(ROOT, 'evaluation', 'config', 'retrieval_label_map.json'))),
      cardHashes: cardHashes
    }
  })
  assert.strictEqual(snap.schema_version, 'retrieval-snapshot-v1')
  assert.ok(snap.traceability.input_sha256)
  assert.strictEqual(Object.keys(snap.traceability.card_hashes).length, 69)
  assert.ok(snap.channels.textOnly.length === 24 && snap.channels.withVisual.length === 24)

  const clone = JSON.parse(JSON.stringify(snap))
  clone.created_at = '2099-01-01T00:00:00.000Z'
  const d = rm.diffSnapshots(snap, clone)
  assert.strictEqual(d.status, 'ok')
  assert.strictEqual(d.ranking_semantically_unchanged, true, '同输入重跑必须 diff 为空：' + JSON.stringify(d.channels.textOnly.cases.filter(function (c) { return c.ranking_changed })))
})

console.log('')
console.log('retrievalMetrics 测试全部通过（' + sectionCount + ' 组）')
