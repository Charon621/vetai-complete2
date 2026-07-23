const assert = require('assert')
const api = require('../utils/api')

// ============================================================
// calibrateConfidence：把模型过度自信的概率压回真实把握
// ============================================================
// 过渡方案：只封顶 >85 的过高值，其余原样返回
assert.strictEqual(api.calibrateConfidence(0), 0, 'calibrate 0')
assert.strictEqual(api.calibrateConfidence(50), 50, 'mid values unchanged')
assert.strictEqual(api.calibrateConfidence(80), 80, '80 unchanged')
assert.strictEqual(api.calibrateConfidence(85), 85, '85 unchanged')
assert.strictEqual(api.calibrateConfidence(86), 85, '86 capped to 85')
assert.strictEqual(api.calibrateConfidence(90), 85, '90 capped to 85')
assert.strictEqual(api.calibrateConfidence(95), 85, '95 capped to 85')
assert.strictEqual(api.calibrateConfidence(96), 88, '96 capped to 88')
assert.strictEqual(api.calibrateConfidence(100), 88, '100 capped to 88')
assert.strictEqual(api.calibrateConfidence(-5), 0, 'calibrate negative -> 0')
assert.strictEqual(api.calibrateConfidence('abc'), 0, 'calibrate non-number -> 0')
assert.ok(api.calibrateConfidence(100) < 100, 'never show 100')

// ============================================================
// confidenceToLabel：校准值转自然语言区间
// ============================================================
assert.strictEqual(api.confidenceToLabel(10), '仅参考')
assert.strictEqual(api.confidenceToLabel(24), '仅参考')
assert.strictEqual(api.confidenceToLabel(25), '可能')
assert.strictEqual(api.confidenceToLabel(44), '可能')
assert.strictEqual(api.confidenceToLabel(45), '较可能')
assert.strictEqual(api.confidenceToLabel(69), '较可能')
assert.strictEqual(api.confidenceToLabel(70), '高度可能')
assert.strictEqual(api.confidenceToLabel(90), '高度可能')

// ============================================================
// normalizePercent：百分比字符串 / 小数 / 边界值 / fallback
// ============================================================
assert.strictEqual(api.normalizePercent('80%', 0), 80, 'parse percent string')
assert.strictEqual(api.normalizePercent(0.5, 0), 50, 'decimal 0.5 -> 50')
assert.strictEqual(api.normalizePercent(0.01, 0), 1, 'small decimal -> 1')
assert.strictEqual(api.normalizePercent(150, 0), 100, 'clamp high to 100')
assert.strictEqual(api.normalizePercent(-10, 0), 0, 'clamp low to 0')
assert.strictEqual(api.normalizePercent(undefined, 99), 99, 'fallback on undefined')
assert.strictEqual(api.normalizePercent('abc', 99), 99, 'fallback on NaN string')
assert.strictEqual(api.normalizePercent(0.8, 0), 80, 'decimal 0.8 -> 80')

// ============================================================
// applyGuardrails：急救红线 / 一致性检查 / 低置信度升级
// ============================================================

// 1. 红线触发：complaint 含"呼吸困难" -> urgency 强制升到 emergency
var redLineData = { urgency: 'low', confidence: 80, vetWarning: '观察', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(redLineData, { complaint: '宠物呼吸困难，精神很差' })
assert.strictEqual(redLineData.urgency, 'emergency', 'red line (呼吸困难) should escalate to emergency')
assert.ok(Array.isArray(redLineData.redLineFlags) && redLineData.redLineFlags.length > 0, 'red line should set flags')

// 2. 一致性检查：urgency=low + vetWarning 含"尽快/严重" -> moderate
var inconsistentData = { urgency: 'low', confidence: 80, vetWarning: '如症状持续加重，建议尽快就医，情况需要关注', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(inconsistentData, { complaint: '普通皮疹' })
assert.strictEqual(inconsistentData.urgency, 'moderate', 'low + severe vetWarning should escalate to moderate')

// 3. 低置信度：confidence<30 + urgency=low -> moderate
var lowConfData = { urgency: 'low', confidence: 20, vetWarning: '观察', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(lowConfData, { complaint: '皮疹' })
assert.strictEqual(lowConfData.urgency, 'moderate', 'low confidence + low urgency should escalate')

// 4. 正常数据不应被改动
var normalData = { urgency: 'moderate', confidence: 60, vetWarning: '观察变化', observations: '', careSuggestion: '', complaint: '' }
api.applyGuardrails(normalData, { complaint: '皮疹' })
assert.strictEqual(normalData.urgency, 'moderate', 'normal data should not change urgency')
assert.ok(!normalData.redLineFlags, 'normal data should not set red line flags')

// 5. 高 urgency 不应被降级
var urgentData = { urgency: 'urgent', confidence: 90, vetWarning: '尽快就医', observations: '', careSuggestion: '', complaint: '皮疹' }
api.applyGuardrails(urgentData, { complaint: '皮疹' })
assert.strictEqual(urgentData.urgency, 'urgent', 'urgent should not be downgraded')

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

console.log('api tests passed')
