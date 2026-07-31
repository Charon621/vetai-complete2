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
 *       **不是诊断参考标准**，与 evaluation/gold_standard 的冻结集无关，可随时运行。
 *
 * 用法：
 *   node evaluation/tools/recall_probe.js
 *   node evaluation/tools/recall_probe.js --verbose
 *   node evaluation/tools/recall_probe.js --out evaluation/runs/recall_20260726.json
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

// 检索结果的 name 是按物种渲染的显示名（如「皮肤癣菌病（犬猫）」在猫场景显示为「猫癣」），
// 判定命中时必须换回条目正名，否则会把正确召回误判为漏召回。
const CANONICAL_BY_ID = {}
kb.DISEASE_KB.forEach(function (card) { CANONICAL_BY_ID[card.id] = card.name })

function canonicalNames(results) {
  return results.map(function (r) { return CANONICAL_BY_ID[r.id] || r.name })
}

function evaluate(useVisual) {
  let hitAny = 0
  let hitExpected = 0
  const rows = []

  CASES.forEach(function (t) {
    const query = { species: t.s, breed: '', bodyPart: t.b, complaint: t.c }
    if (useVisual) query.visualFeatures = t.vf
    const worthy = (kb.search(query) || []).filter(kb.isPromptWorthyResult)
    const names = canonicalNames(worthy)
    const matched = names.filter(function (n) { return t.expect.indexOf(n) >= 0 })

    if (names.length) hitAny++
    if (matched.length) hitExpected++

    rows.push({
      complaint: t.c,
      expected: t.expect,
      retrieved: names,
      hitExpected: matched.length > 0,
      abstained: names.length === 0
    })
  })

  return {
    total: CASES.length,
    anyHit: hitAny,
    expectedHit: hitExpected,
    anyHitRate: +(hitAny / CASES.length * 100).toFixed(1),
    expectedHitRate: +(hitExpected / CASES.length * 100).toFixed(1),
    rows: rows
  }
}

function main() {
  const argv = process.argv
  const verbose = argv.indexOf('--verbose') >= 0
  const outIdx = argv.indexOf('--out')
  const out = outIdx >= 0 ? argv[outIdx + 1] : null

  const textOnly = evaluate(false)
  const withVisual = evaluate(true)

  console.log('主诉召回探测 — KB_VERSION=' + kb.KB_VERSION + '，语料 ' + CASES.length + ' 条真实口语主诉')
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
      withVisual: withVisual
    }, null, 2), 'utf8')
    console.log('已写入: ' + out)
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

if (require.main === module) main()

module.exports = { CASES: CASES, evaluate: evaluate }
