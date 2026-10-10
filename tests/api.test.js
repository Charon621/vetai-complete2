const assert = require('assert')
const api = require('../utils/api')

// ============================================================
// calibrateConfidence：把模型过度自信的概率压回真实把握
// ============================================================
// 过渡方案：>95 封顶 88；86-95 缓坡映射 85-87（保留排序区分度，BUG-F6）
assert.strictEqual(api.calibrateConfidence(0), 0, 'calibrate 0')
assert.strictEqual(api.calibrateConfidence(50), 50, 'mid values unchanged')
assert.strictEqual(api.calibrateConfidence(80), 80, '80 unchanged')
assert.strictEqual(api.calibrateConfidence(85), 85, '85 unchanged')
assert.strictEqual(api.calibrateConfidence(86), 85, '86 mapped to 85')
assert.strictEqual(api.calibrateConfidence(90), 86, '90 mapped to 86')
assert.strictEqual(api.calibrateConfidence(95), 87, '95 mapped to 87')
assert.strictEqual(api.calibrateConfidence(96), 88, '96 capped to 88')
assert.strictEqual(api.calibrateConfidence(100), 88, '100 capped to 88')
assert.strictEqual(api.calibrateConfidence(-5), 0, 'calibrate negative -> 0')
assert.strictEqual(api.calibrateConfidence('abc'), 0, 'calibrate non-number -> 0')
assert.ok(api.calibrateConfidence(100) < 100, 'never show 100')
// 单调性：更高的原始分不能得到更低的校准分
for (var cal = 1; cal <= 99; cal++) {
  assert.ok(api.calibrateConfidence(cal + 1) >= api.calibrateConfidence(cal),
    'calibration must be monotonic at ' + cal)
}

// ============================================================
// confidenceToLabel：校准值转自然语言区间
// ============================================================
assert.strictEqual(api.confidenceToLabel(10), '仅参考')
assert.strictEqual(api.confidenceToLabel(24), '仅参考')
assert.strictEqual(api.confidenceToLabel(25), '低匹配')
assert.strictEqual(api.confidenceToLabel(44), '低匹配')
assert.strictEqual(api.confidenceToLabel(45), '中等匹配')
assert.strictEqual(api.confidenceToLabel(69), '中等匹配')
assert.strictEqual(api.confidenceToLabel(70), '较高匹配')
assert.strictEqual(api.confidenceToLabel(90), '较高匹配')

// ============================================================
// normalizePercent：百分比字符串 / 小数 / 边界值 / fallback
// ============================================================
assert.strictEqual(api.normalizePercent('80%', 0), 80, 'parse percent string')
assert.strictEqual(api.normalizePercent(0.5, 0), 50, 'decimal 0.5 -> 50')
assert.strictEqual(api.normalizePercent(0.01, 0), 1, 'small decimal -> 1')
assert.strictEqual(api.normalizePercent(1, 0), 1, 'integer 1 means 1%, must not become 100 (BUG-F1)')
assert.strictEqual(api.normalizePercent(150, 0), 100, 'clamp high to 100')
assert.strictEqual(api.normalizePercent(-10, 0), 0, 'clamp low to 0')
assert.strictEqual(api.normalizePercent(undefined, 99), 99, 'fallback on undefined')
assert.strictEqual(api.normalizePercent('abc', 99), 99, 'fallback on NaN string')
assert.strictEqual(api.normalizePercent(0.8, 0), 80, 'decimal 0.8 -> 80')

// ============================================================
// applyGuardrails：只根据当前明确症状升级，不把条件性警告或低置信度当病情严重
// ============================================================

// 1. 红线触发：complaint 含"呼吸困难" -> urgency 强制升到 emergency
var redLineData = { urgency: 'low', confidence: 80, vetWarning: '观察', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(redLineData, { complaint: '宠物呼吸困难，精神很差' })
assert.strictEqual(redLineData.urgency, 'emergency', 'red line (呼吸困难) should escalate to emergency')
assert.ok(Array.isArray(redLineData.redLineFlags) && redLineData.redLineFlags.length > 0, 'red line should set flags')

// 2. 条件性模型警告不能被当作当前症状
var conditionalWarningData = { urgency: 'low', confidence: 80, vetWarning: '如出现流脓请尽快就医', observations: '', careSuggestion: '' }
api.applyGuardrails(conditionalWarningData, { complaint: '普通皮疹' })
assert.strictEqual(conditionalWarningData.urgency, 'low', 'conditional model warning must not escalate')

// 3. 低置信度与严重度是不同轴，不能自动升级
var lowConfData = { urgency: 'low', confidence: 20, vetWarning: '观察', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(lowConfData, { complaint: '皮疹' })
assert.strictEqual(lowConfData.urgency, 'low', 'low confidence alone must not escalate urgency')

// 4. 正常数据不应被改动
var normalData = { urgency: 'moderate', confidence: 60, vetWarning: '观察变化', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(normalData, { complaint: '皮疹' })
assert.strictEqual(normalData.urgency, 'moderate', 'normal data should not change urgency')
assert.ok(!normalData.redLineFlags, 'normal data should not set red line flags')

// 5. 高 urgency 不应被降级
var urgentData = { urgency: 'urgent', confidence: 90, vetWarning: '尽快就医', observations: '', careSuggestion: '', complaint: '皮疹' }
api.applyGuardrails(urgentData, { complaint: '皮疹' })
assert.strictEqual(urgentData.urgency, 'urgent', 'urgent should not be downgraded')

// 6. 否定表达不触发
var negatedData = { urgency: 'low', confidence: 60, observations: '', vetWarning: '观察' }
api.applyGuardrails(negatedData, { complaint: '无流脓，精神食欲正常' })
assert.strictEqual(negatedData.urgency, 'low', 'negated red-line symptoms must not escalate')

// 7. 肯定的当前流脓应触发 urgent
var pusData = { urgency: 'low', confidence: 60, observations: '', vetWarning: '观察' }
api.applyGuardrails(pusData, { complaint: '患处正在流脓' })
assert.strictEqual(pusData.urgency, 'urgent', 'current purulent discharge should escalate')

// 8. 同一句中的正常描述不能掩盖另一项明确急症
var mixedData = { urgency: 'low', confidence: 60, observations: '', vetWarning: '观察' }
api.applyGuardrails(mixedData, { complaint: '精神食欲正常，但是现在呼吸困难' })
assert.strictEqual(mixedData.urgency, 'emergency', 'negated clause must not hide a separate emergency clause')

// BUG-01：按真实输入与可观察分诊结果预注册，不复制实现中的否定正则。
// R01-R16 对齐审批单；R14 两种主人观察表达分别验证。只检查工程行为，
// 不能把这些合成主诉的通过率称为临床急症敏感度。
var redLineScopeCases = [
  { id: 'R01 未缓解不否定呼吸困难', complaint: '呼吸困难且没有缓解', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'R02 无瘙痒不否定流脓', complaint: '没有瘙痒而且患处正在流脓', expected: 'urgent', flags: ['流脓'] },
  { id: 'R03 无毛是形态而非否定', complaint: '无毛区快速扩散', expected: 'urgent', flags: ['快速扩散'] },
  { id: 'R04 正常食欲不否定呼吸费力', complaint: '精神食欲正常且现在呼吸费力', expected: 'emergency', flags: ['呼吸费力'] },
  { id: 'R05 明确否定呼吸困难', complaint: '没有呼吸困难，精神食欲正常', expected: 'low', flags: [] },
  { id: 'R06 多个明确否定症状', complaint: '患处没有流脓，也没有快速扩散', expected: 'low', flags: [] },
  { id: 'R07 未来条件问题', complaint: '如果出现呼吸困难要怎么办', expected: 'low', flags: [] },
  { id: 'R08 条件后当前急症', complaint: '如果明天变严重就去医院，但现在呼吸困难', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'R09 历史症状已明确消退', complaint: '前天呼吸困难，现在已经恢复且不再困难', expected: 'low', flags: [] },
  { id: 'R10 已是急症仍留原因', complaint: '当前呼吸困难', initial: 'emergency', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'R11 不扫描护理未来警告', complaint: '普通皮疹', careSuggestion: '若出现呼吸困难请急诊', whenToSeeVet: '若出现呼吸困难请急诊', expected: 'low', flags: [] },
  { id: 'R12 低置信度不等于高紧急度', complaint: '普通皮疹', confidence: 10, expected: 'low', flags: [] },
  { id: 'R13 主人症状不升级宠物', complaint: '我呼吸困难，猫只有脱毛', expected: 'low', flags: [] },
  { id: 'R14a 我家猫仍是宠物', complaint: '我家猫现在呼吸困难', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'R14b 我发现猫仍是宠物', complaint: '我发现猫张口呼吸', expected: 'emergency', flags: ['张口呼吸'] },
  { id: 'R15 否定一症状不否定独立症状', complaint: '没有呼吸困难，但现在张口呼吸', expected: 'emergency', flags: ['张口呼吸'] },
  { id: 'R16 空输入无红线', complaint: '', observations: '', expected: 'low', flags: [] },
  { id: 'X01 多红线取最高等级并保留原因', complaint: '患处正在流脓而且呼吸困难', expected: 'emergency', flags: ['流脓', '呼吸困难'] },
  { id: 'X02 同词先否定后当前肯定', complaint: '刚才没有呼吸困难，现在呼吸困难', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'X03 同词先历史肯定后明确消退', complaint: '刚才呼吸困难，现在没有呼吸困难了', expected: 'low', flags: [] },
  { id: 'X04 当前症状后的求助不是假设', complaint: '呼吸困难怎么办', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'X05 观察中的无关否定不吞肯定事实', complaint: '普通皮疹', observations: '患处没有流脓但正在快速扩散', expected: 'urgent', flags: ['快速扩散'] },
  { id: 'X06 护理的肯定文字也不作为观察', complaint: '普通皮疹', careSuggestion: '呼吸困难需要就医', whenToSeeVet: '面部肿胀需要急诊', expected: 'low', flags: [] },
  // BUG-01：实施复核中发现的8个明确反例；改善不等于消退，作用域不得跨部位/时间/主体。
  { id: 'X07 无连接词的未缓解', complaint: '呼吸困难没有缓解', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'X08 有所缓解仍是当前症状', complaint: '呼吸困难已经有所缓解', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'X09 条件内转折仍是假设', complaint: '如果没有流脓但出现呼吸困难就去医院', expected: 'low', flags: [] },
  { id: 'X10 不同部位的否定不撤销阳性', complaint: '左耳流脓，右耳没有流脓', expected: 'urgent', flags: ['流脓'] },
  { id: 'X11 历史消退不撤销当前症状', complaint: '现在呼吸困难，前天呼吸困难已经消失了', expected: 'emergency', flags: ['呼吸困难'] },
  { id: 'X12 正常副词不制造精神食欲红线', complaint: '精神食欲都很正常', expected: 'low', flags: [] },
  { id: 'X13 条件内正在不等于当前断言', complaint: '如果出现流脓，或者正在张口呼吸的话，就去医院', expected: 'low', flags: [] },
  { id: 'X14 主人抱猫不改变症状主体', complaint: '我抱着猫时呼吸困难，猫只有脱毛', expected: 'low', flags: [] },
  { id: 'X15 后续就医条件不撤销当前急症', complaint: '猫现在呼吸困难如果去医院的话应该挂什么科', expected: 'emergency', flags: ['呼吸困难'] }
]
var redLineScopeFailures = []
redLineScopeCases.forEach(function (testCase) {
  var petInfo = { complaint: testCase.complaint }
  var originalPetInfo = JSON.stringify(petInfo)
  var scopeData = {
    urgency: testCase.initial || 'low',
    confidence: typeof testCase.confidence === 'number' ? testCase.confidence : 60,
    observations: testCase.observations || '',
    careSuggestion: testCase.careSuggestion || '',
    whenToSeeVet: testCase.whenToSeeVet || '',
    vetWarning: '如症状加重请就医'
  }
  var originalObservations = scopeData.observations
  var originalCareSuggestion = scopeData.careSuggestion
  try {
    var scopeResult = api.applyGuardrails(scopeData, petInfo)
    assert.strictEqual(scopeResult, scopeData, testCase.id + ': keep the existing returned report object')
    assert.strictEqual(scopeData.urgency, testCase.expected, testCase.id + ': urgency')
    var scopeFlags = scopeData.redLineFlags || []
    if (testCase.flags.length === 0) {
      assert.strictEqual(scopeFlags.length, 0, testCase.id + ': no current red-line flags')
    } else {
      testCase.flags.forEach(function (expectedMatch) {
        assert.ok(scopeFlags.some(function (flag) {
          return flag.matched === expectedMatch && !!flag.desc && !!flag.urgency
        }), testCase.id + ': preserve the reason for ' + expectedMatch)
      })
    }
    assert.strictEqual(JSON.stringify(petInfo), originalPetInfo, testCase.id + ': do not rewrite owner input')
    assert.strictEqual(scopeData.observations, originalObservations, testCase.id + ': do not rewrite observations')
    assert.strictEqual(scopeData.careSuggestion, originalCareSuggestion, testCase.id + ': do not rewrite care')
  } catch (scopeError) {
    redLineScopeFailures.push(testCase.id + ': ' + scopeError.message)
  }
})
assert.deepStrictEqual(redLineScopeFailures, [], 'BUG-01: registered red-line scope cases must all satisfy the public contract')

// ============================================================
// isStrongVisionRagHit：快路径强命中检查
// ============================================================
// matched 标签约定（BUG-G9）：'视觉预检:词' = 来自照片预检特征，'视觉:词' = 来自主诉文本。
// 强命中要求至少 1 个预检来源非泛词命中，防止主诉文本单独满足组合/别名/视觉通道。
// top1 分数高、证据足、有预检视觉命中 + 组合命中，且 top2 差距大 → 允许快路径
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉预检:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
    { score: 4, matched: ['视觉:红斑'] }
  ]),
  true,
  'strong hit with precheck visual + combo and gap'
)

// top1 分数够、预检命中够、证据够，但没有组合或别名且非泛词视觉不足 3 个 → 不够硬
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉预检:毛囊中心红点', '视觉预检:表皮环'] },
    { score: 4, matched: [] }
  ]),
  false,
  'no combo or alias, should not fast-path'
)

// top1 和 top2 分数太接近 → 应该 fallback 到完整模型
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉预检:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
    { score: 8, matched: ['视觉:红斑'] }
  ]),
  false,
  'top2 too close, should not fast-path'
)

// 空结果
assert.strictEqual(api.isStrongVisionRagHit([]), false, 'empty results')

// 3 个及以上非泛词预检视觉命中，即使无组合/别名也算强证据（BUG-E4：纯图片无主诉场景）
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 12, matched: ['视觉预检:圆形脱毛', '视觉预检:断毛', '视觉预检:表皮环', '病史:多宠'] },
    { score: 4, matched: [] }
  ]),
  true,
  'three strong precheck visual hits should qualify without combo/alias'
)
// 泛词不计入强视觉计数（含预检来源）
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 12, matched: ['视觉预检:红肿', '视觉:脱毛', '视觉预检:红斑', '病史:反复'] },
    { score: 4, matched: [] }
  ]),
  false,
  'generic visual signs must not count as strong evidence'
)

// BUG-G9 回归：证据全部来自主诉文本（组合+视觉全无'视觉预检:'前缀）→ 不得快路径
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 15.8, matched: ['视觉:圆形脱毛', '视觉:结痂', '视觉:断毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
    { score: 4, matched: [] }
  ]),
  false,
  'complaint-only evidence must not fast-path even with combo'
)

// BUG-G9 回归：预检只返回泛词（照片侧无特征性证据）+ 主诉组合/别名命中 → 不得快路径
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 19, matched: ['部位:面部', '视觉预检:结痂', '病史:剧烈瘙痒', '组合:主人也出现症状', '组合:剧痒+传人/好发部位'] },
    { score: 9, matched: ['部位:面部', '视觉预检:结痂', '组合:主人也出现症状'] }
  ]),
  false,
  'generic-only precheck features must not fast-path'
)

// BUG-G9 边界：预检命中只有 1 个非泛词、无组合/别名 → strongVisualHits<3 不快路径
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉预检:毛囊中心红点', '视觉:表皮环', '病史:反复'] },
    { score: 4, matched: [] }
  ]),
  false,
  'one precheck hit without combo/alias is not enough'
)

// ============================================================
// diagnoseStrongVisionRagGates：逐关诊断，与 isStrongVisionRagHit 结论一致
// 不短路：列出全部未通过关卡，gate 取第一个失败项（顺序同原判定）
// ============================================================
var gatePass = api.diagnoseStrongVisionRagGates([
  { score: 10, matched: ['视觉预检:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
  { score: 4, matched: ['视觉:红斑'] }
])
assert.strictEqual(gatePass.ok, true, 'gate diagnosis passes the canonical strong hit')
assert.strictEqual(gatePass.gate, '', 'passing case has no failing gate')
assert.deepStrictEqual(gatePass.failed, [], 'passing case has empty failed list')

assert.deepStrictEqual(api.diagnoseStrongVisionRagGates([]).failed, ['no_result'], 'empty results → no_result')
assert.strictEqual(api.diagnoseStrongVisionRagGates([{ score: 20, siteConflict: true, matched: [] }]).gate,
  'site_conflict', 'site conflict short-circuits')
assert.strictEqual(api.diagnoseStrongVisionRagGates([{ score: 20, retrieval: { fastPathEligible: false }, matched: [] }]).gate,
  'retrieval_ineligible', 'retrieval veto short-circuits')

// 预检只给泛词 + 主诉组合命中：分数够，但照片证据与强证据两关同时失败，且全部列出
var gateGeneric = api.diagnoseStrongVisionRagGates([
  { score: 19, matched: ['部位:面部', '视觉预检:结痂', '病史:剧烈瘙痒', '组合:主人也出现症状', '组合:剧痒+传人/好发部位'] },
  { score: 9, matched: ['部位:面部', '视觉预检:结痂', '组合:主人也出现症状'] }
])
assert.strictEqual(gateGeneric.ok, false, 'generic-only precheck fails')
assert.strictEqual(gateGeneric.gate, 'precheck_hits', 'first failing gate is the photo-evidence floor')
assert.ok(gateGeneric.failed.indexOf('discriminative') >= 0, 'all failing gates are listed, not just the first')
assert.strictEqual(gateGeneric.precheckHits, 0, 'metrics are reported alongside the verdict')

// 分差不足与分数不足同时出现时，按原判定顺序 score 在前、gap 在后
var gateClose = api.diagnoseStrongVisionRagGates([
  { score: 7, matched: ['视觉预检:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
  { score: 6, matched: ['视觉:红斑'] }
])
assert.strictEqual(gateClose.gate, 'score', 'score is checked before gap')
assert.ok(gateClose.failed.indexOf('gap') >= 0, 'gap failure is still recorded')
assert.strictEqual(gateClose.scoreGap, 1, 'score gap is reported')

// ============================================================
// countDiscriminativeVisualHits / isFastRagHighRiskResult / shouldResolveFastRag
// 区分度门槛（2026-10-01）：Top1 的证据必须至少有一个是"别的候选没有"的词
// ============================================================
// 区分度 = Top1 的非泛视觉词里，不在 Top2/Top3 视觉词表中的个数。
// 圆形脱毛被 top2 共享（不算），断毛/表皮环为独有 → 2（鳞屑是泛词，先被排除）
var fastStrong = [
  { score: 18, category: 'fungal', urgency: 'moderate', visualSigns: ['圆形脱毛', '断毛', '表皮环'],
    matched: ['视觉预检:圆形脱毛', '视觉预检:断毛', '视觉预检:表皮环', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
  { score: 8, category: 'parasite', urgency: 'low', visualSigns: ['圆形脱毛', '剧痒'],
    matched: ['视觉预检:圆形脱毛'] }
]
assert.strictEqual(api.countDiscriminativeVisualHits(fastStrong), 2, 'shared word excluded, two unique words')
assert.strictEqual(api.countDiscriminativeVisualHits([]), 0, 'empty results have no discriminative hits')
assert.strictEqual(api.countDiscriminativeVisualHits(null), 0, 'null results have no discriminative hits')
assert.strictEqual(api.isStrongVisionRagHit(fastStrong), true, 'discriminative strong hit still fast-paths')
assert.strictEqual(api.shouldResolveFastRag(fastStrong), true, 'discriminative 2 + low-risk category resolves eagerly')

// 实测中仅有的 2 个错误触发的形态：Top1 的证据全是候选共有的通用词（结节/溃疡）→ 区分度 0
var fastSharedWords = [
  { score: 19, category: 'mass', urgency: 'urgent', visualSigns: ['结节', '溃疡'],
    matched: ['视觉预检:结节', '视觉预检:溃疡', '病史:不愈', '组合:肿块+增大/不愈/破溃'] },
  { score: 9, category: 'allergy', urgency: 'moderate', visualSigns: ['结节', '溃疡'],
    matched: ['视觉预检:结节'] }
]
assert.strictEqual(api.countDiscriminativeVisualHits(fastSharedWords), 0, 'only shared words → discriminative 0')
assert.strictEqual(api.isStrongVisionRagHit(fastSharedWords), false, 'zero discriminative must not fast-path')
assert.strictEqual(api.shouldResolveFastRag(fastSharedWords), false, 'zero discriminative never resolves eagerly')

// 高危方向：肿瘤/自身免疫/内分泌/罕见病，或 urgency 为 urgent/emergency → 不抢跑
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'mass', urgency: 'moderate' }), true, 'mass is high risk')
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'autoimmune', urgency: 'low' }), true, 'autoimmune is high risk')
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'endocrine', urgency: 'moderate' }), true, 'endocrine is high risk')
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'rare_warning', urgency: 'low' }), true, 'rare_warning is high risk')
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'bacterial', urgency: 'urgent' }), true, 'urgent urgency is high risk')
assert.strictEqual(api.isFastRagHighRiskResult({ category: 'bacterial', urgency: 'moderate' }), false, 'common moderate case is not high risk')
assert.strictEqual(api.isFastRagHighRiskResult(null), true, 'missing result is treated as high risk')
assert.strictEqual(api.shouldResolveFastRag([
  { score: 18, category: 'mass', urgency: 'moderate', visualSigns: ['肿块', '破溃'],
    matched: ['视觉预检:肿块', '视觉预检:破溃', '视觉预检:结节'] },
  { score: 6, category: 'allergy', urgency: 'low', visualSigns: [], matched: [] }
]), false, 'high-risk category must not fast-path even with discriminative evidence')

// ============================================================
// fastRagTopProbability / scoreToFastProbability：快路径匹配分
// 2026-10-01 起由证据质量（区分度+证据条数+与次优差距）决定，上限 60 →「中等匹配」，
// 不再出现"55/55 个触发案例全部 78% 较高匹配"（含判错的那 2 例）
// ============================================================
// 38 + 区分度2×4 + 证据4×2 + 间隔10→5 = 59
assert.strictEqual(api.fastRagTopProbability(fastStrong), 59, 'top probability driven by evidence quality')
assert.strictEqual(api.fastRagTopProbability([]), 30, 'empty results fall back to floor')
// 区分度 0 但证据多、间隔大：38 + 0 + 8 + 5 = 51
assert.strictEqual(api.fastRagTopProbability(fastSharedWords), 51, 'no discriminative evidence lowers the score')
// 上限 60：区分度 3、证据 5、间隔 ≥12 → 38+12+10+8=68 → 夹到 60
var fastMax = [
  { score: 30, category: 'fungal', urgency: 'moderate', visualSigns: ['甲词', '乙词', '丙词'],
    matched: ['视觉预检:甲词', '视觉预检:乙词', '视觉预检:丙词', '病史:丁', '组合:戊'] },
  { score: 6, category: 'allergy', urgency: 'low', visualSigns: [], matched: [] }
]
assert.strictEqual(api.fastRagTopProbability(fastMax), 60, 'clamped at the 60 cap')
assert.ok(api.fastRagTopProbability(fastMax) < 70, 'fast path must never reach 「较高匹配」(>=70)')

// 显式给出 top 匹配分时按其比例缩放各候选
assert.strictEqual(api.scoreToFastProbability(18, 18, 59), 59, 'top candidate keeps the top probability')
assert.strictEqual(api.scoreToFastProbability(8, 18, 59), 26, 'second candidate scaled by score ratio')
assert.strictEqual(api.scoreToFastProbability(2, 10, 59), 20, 'floor at 20')
assert.ok(api.scoreToFastProbability(20, 10, 59) <= 60, 'never exceeds the 60 cap')
// 未传第三参时按检索分回退，但同样受 60 上限约束
assert.strictEqual(api.scoreToFastProbability(16.7, 16.7), 60, 'fallback capped at 60')
assert.strictEqual(api.scoreToFastProbability(10, 0), 20, 'zero top score falls back to floor')

// ============================================================
// matchedTextForDisplay：内部标签不外泄到用户可见文本
// ============================================================
assert.strictEqual(
  api.matchedTextForDisplay(['视觉预检:圆形脱毛', '组合:主人也出现症状', '部位:背部', '病史:多宠']),
  '圆形脱毛、主人也出现症状、背部、多宠',
  'strip evidence type prefixes for user-visible text'
)
assert.strictEqual(
  api.matchedTextForDisplay(['视觉:脱毛', '负信号:-2']),
  '脱毛',
  'negative-signal entries are demotion markers, must be dropped'
)
assert.strictEqual(api.matchedTextForDisplay([]), '', 'empty matched yields empty text')

// ============================================================
// isMucosalOrOralCase：口腔/黏膜识别词表边界（BUG-D4）
// ============================================================
assert.strictEqual(api.isMucosalOrOralCase({ complaint: '牙龈红肿出血' }, null), true, 'gum case is mucosal')
assert.strictEqual(api.isMucosalOrOralCase({ bodyPartLabel: '口腔' }, null), true, 'oral body part is mucosal')
assert.strictEqual(api.isMucosalOrOralCase({ complaint: '舌头上有白点' }, null), true, 'tongue case is mucosal')
assert.strictEqual(api.isMucosalOrOralCase({ complaint: '背部舔舐后红肿脱毛' }, null), false, 'licking skin must not be mucosal')
assert.strictEqual(api.isMucosalOrOralCase({ complaint: '口周皮肤发红掉毛' }, null), false, 'perioral skin must not be mucosal')

// ============================================================
// parseModelJson：合法 JSON 里含拒答关键词不得被误杀（BUG-F2）
// ============================================================
var abstainJson = JSON.stringify({
  primaryDiagnosis: '无法可靠判断',
  abstainReason: '关键部位不可见，无法判断',
  homeCare: '光线充足时请重拍后再试',
  urgency: 'low'
})
var abstainParsed = api.parseModelJson(abstainJson)
assert.strictEqual(abstainParsed.level, 1, 'valid JSON with reject keywords must parse normally')
assert.strictEqual(abstainParsed.data.abstainReason, '关键部位不可见，无法判断', 'structured abstain must survive')

// 纯文本拒答仍走拒答通道
var plainReject = api.parseModelJson('图片模糊无法判断，请重拍后再试')
assert.strictEqual(plainReject.level, 0, 'plain-text reject should hit reject channel')
assert.strictEqual(plainReject.data._isReject, true)

console.log('api tests passed')
