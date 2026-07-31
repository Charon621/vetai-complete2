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

// ============================================================
// isStrongVisionRagHit：快路径强命中检查
// ============================================================
// top1 分数高、证据足、有组合命中，且 top2 差距大 → 允许快路径
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
    { score: 4, matched: ['视觉:红斑'] }
  ]),
  true,
  'strong hit with combo and gap'
)

// top1 分数够、证据够，但没有组合或别名 → 不够硬
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉:红斑', '视觉:脱毛'] },
    { score: 4, matched: [] }
  ]),
  false,
  'no combo or alias, should not fast-path'
)

// top1 和 top2 分数太接近 → 应该 fallback 到完整模型
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 10, matched: ['视觉:圆形脱毛', '组合:圆形脱毛+鳞屑/结痂+断毛'] },
    { score: 8, matched: ['视觉:红斑'] }
  ]),
  false,
  'top2 too close, should not fast-path'
)

// 空结果
assert.strictEqual(api.isStrongVisionRagHit([]), false, 'empty results')

// 3 个及以上非泛词视觉命中，即使无组合/别名也算强证据（BUG-E4：纯图片无主诉场景）
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 12, matched: ['视觉:圆形脱毛', '视觉:断毛', '视觉:表皮环', '病史:多宠'] },
    { score: 4, matched: [] }
  ]),
  true,
  'three strong visual hits should qualify without combo/alias'
)
// 泛词不计入强视觉计数
assert.strictEqual(
  api.isStrongVisionRagHit([
    { score: 12, matched: ['视觉:红肿', '视觉:脱毛', '视觉:红斑', '病史:反复'] },
    { score: 4, matched: [] }
  ]),
  false,
  'generic visual signs must not count as strong evidence'
)

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
