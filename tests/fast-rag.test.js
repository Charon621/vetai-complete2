const assert = require('assert')
const api = require('../utils/api')

// ============================================================
// buildFastRagDiagnosis：快路径报告的就医建议在急诊/普通下分流（BUG-G10）
// ============================================================
// 回归：whenToSeeVet 原先三元两个分支都返回同一个 vetAdvice（死代码），
// 导致非急诊病例也套用急诊的强烈就医措辞，与 vetWarning 的分流意图不一致。
// 修复后：急诊用强烈就医建议，普通给条件性观察+就医提示。

function makeTop(urgency) {
  return {
    name: '浅表脓皮病（细菌性）',
    score: 10,
    matched: ['视觉:脓疱', '组合:丘疹+脓疱+环形表皮领圈+结痂'],
    recommendedTests: ['皮肤细胞学检查', '细菌培养'],
    typicalFeatures: '丘疹、脓疱、环形表皮领圈、结痂',
    ddx: '需与马拉色菌、过敏继发感染鉴别',
    homeCareSafe: ['保持清洁干燥', '避免舔咬'],
    vetAdvice: '如皮损扩散或精神食欲异常，请尽快线下就医。',
    urgency: urgency,
    report: { uncertainty: '单靠照片不能确诊。' }
  }
}

function makeFeatureData() {
  return {
    visualFeatures: ['脓疱', '结痂'],
    shortObservation: '照片可见丘疹与脓疱',
    lesionPattern: '丘疹脓疱'
  }
}

// 急诊 case：whenToSeeVet 与 vetWarning 都取强烈的 vetAdvice
var urgent = api.buildFastRagDiagnosis(
  [makeTop('urgent')], makeFeatureData(), 'qwen',
  { label: 'Qwen3.7-Plus', model: 'qwen3.7-plus' },
  { species: '犬' }
)
assert.ok(urgent.whenToSeeVet.indexOf('尽快线下就医') >= 0,
  'urgent case whenToSeeVet should carry the strong vet advice')
assert.strictEqual(urgent.whenToSeeVet, urgent.vetWarning,
  'urgent case whenToSeeVet should equal vetWarning (both strong advice)')

// 普通 case：whenToSeeVet 应为条件性观察提示，不应与急诊共用强烈措辞
var normal = api.buildFastRagDiagnosis(
  [makeTop('moderate')], makeFeatureData(), 'qwen',
  { label: 'Qwen3.7-Plus', model: 'qwen3.7-plus' },
  { species: '犬' }
)
assert.ok(normal.whenToSeeVet !== urgent.whenToSeeVet,
  'normal case whenToSeeVet must differ from urgent case (BUG-G10 dead-code fix)')
assert.ok(normal.whenToSeeVet.indexOf('若范围扩大、破溃流脓') >= 0,
  'normal case whenToSeeVet should be a conditional observation + vet hint')
// 普通 case 的 vetWarning 仍保留"请尽快线下就医"的条件性措辞
assert.ok(normal.vetWarning.indexOf('尽快线下就医') >= 0,
  'normal case vetWarning should still advise timely vet visit')

// 无 urgency（缺省）应按普通处理，不应误用急诊措辞
var missing = api.buildFastRagDiagnosis(
  [makeTop(undefined)], makeFeatureData(), 'qwen',
  { label: 'Qwen3.7-Plus', model: 'qwen3.7-plus' },
  { species: '犬' }
)
assert.ok(missing.whenToSeeVet !== urgent.whenToSeeVet,
  'missing urgency should be treated as non-urgent (BUG-G10)')

console.log('buildFastRagDiagnosis (BUG-G10) tests passed')
