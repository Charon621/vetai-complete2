#!/usr/bin/env node
/**
 * 线上路径探针：主诉 → caseFacts → clinicalConcepts → ragRetrieval → ragAssessment，
 * 与小程序 guided 链路同一组函数，不调用模型。
 *
 * 为什么需要它（与 recall_probe 的分工）：
 *   recall_probe 测的是 kb.search(原始主诉)，guided 链路并不直接走这条路——主诉先被
 *   抽成事实、再按原话校验转成概念，口语词在这一步可能被丢掉；照片与文字证据还会按
 *   病灶分组分别排序。recall_probe 全绿不代表线上候选正确，反之亦然。
 *
 * 口径：
 *   textOnly  —— 只有主人文字，模拟用户不拍照或照片看不出特征。
 *   withPhoto —— 叠加 recall_probe 语料里人工模拟的视觉词，按“照片清晰可见”注入，
 *                病灶归属与线上一致为 unknown。真实模型可能输出“可能可见”，
 *                因此 withPhoto 的点名率是上限，不是线上实测。
 *   点名（named）—— 报告主标题直接写病名；可能方向（tentative）—— 只列方向不点名。
 *   点名错误 = 点名病名不在期望集合内，是快报告最需要压低的数字。
 *
 * 语料均为开发期接触过的合成/模拟数据，结果不是临床准确率。
 *
 * 用法：
 *   node evaluation/tools/guided_probe.js
 *   node evaluation/tools/guided_probe.js --verbose
 *   node evaluation/tools/guided_probe.js --out <仓库外路径.json>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..', '..')

global.wx = global.wx || {
  getStorageSync: function () { return [] },
  setStorageSync: function () {},
  request: function () { throw new Error('guided_probe 不应发起网络请求') }
}

const cf = require(path.join(ROOT, 'utils', 'caseFacts'))
const concepts = require(path.join(ROOT, 'utils', 'clinicalConcepts'))
const contracts = require(path.join(ROOT, 'utils', 'ragContracts'))
const retrieval = require(path.join(ROOT, 'utils', 'ragRetrieval'))
const assessment = require(path.join(ROOT, 'utils', 'ragAssessment'))
const recall = require('./recall_probe')
const bank = require(path.join(ROOT, 'evaluation', 'datasets', 'retrieval_scenarios.json'))

// 固定回归：线上曾出现或复现过的错误，任何一条失败即退出码 1。
const PINNED = [
  { id: 'flea-colloquial-tailbase', c: '尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点', s: '犬', b: '腰部', vf: [],
    mustInclude: ['跳蚤过敏性皮炎'], mustExclude: ['耳螨感染'], mustNotName: true,
    note: '口语“黑色小点/一粒粒”须进入检索；尾部病灶不得给出耳部专属卡；纯文字不点名' },
  { id: 'flea-colloquial-tailbase-cat', c: '尾巴根那里一直挠，摸着一粒粒的，还看到黑色小点', s: '猫', b: '尾部', vf: [],
    mustInclude: ['跳蚤过敏性皮炎'], mustExclude: ['耳螨感染'], mustNotName: true, note: '同上，猫' },
  { id: 'ringworm-photo-named', c: '脸上掉毛', s: '猫', b: '头部', vf: ['圆形脱毛', '鳞屑'],
    mustName: '皮肤癣菌病（犬猫）', note: '照片清晰可见的特异表现仍应点名，快报告不能被规则误伤' },
  { id: 'pyoderma-epidermal-collarette-named', c: '肚子上起了小红疙瘩', s: '犬', b: '腹部', vf: ['表皮环', '脓疱', '鳞屑'],
    mustName: '浅表脓皮病', note: '表皮环是本组独有的照片证据，天疱疮只共享脓疱时不构成并列' }
]

function run(item, withPhoto) {
  const draft = {}
  cf.updateDraft(draft, item.c, null, 'probe')
  const owner = concepts.fromOwnerContext(draft.evidenceContext, 'probe')
  const words = withPhoto ? (item.vf || []) : []
  const photo = words.map(function (word, i) {
    const row = concepts.lookup(word, 'photo')
    return row && { evidenceId: 'probe:photo:0:' + i, conceptId: row.conceptId, rawText: row.term, assertion: 'present', certainty: 'clear', observed: true, source: 'photo', subject: 'pet', temporality: 'current', imageId: 'probe:image:0', sourceImageId: 'probe:image:0', lesionId: 'unknown', site: 'unknown', supersedes: [] }
  }).filter(Boolean)
  const manifest = photo.length ? [{ imageId: 'probe:image:0', sourceImageId: 'probe:image:0', role: 'unspecified', lesionId: 'unknown', isSent: true, sentImageIndex: 0 }] : []
  const snapshot = contracts.snapshot({ snapshotId: 'probe:snapshot', facts: photo.concat(owner), manifest: manifest, imageQuality: photo.length ? [{ imageId: 'probe:image:0', quality: 'clear', observation: 'probe' }] : [], provenanceStatus: 'complete' })
  const info = { species: item.s, bodyPartLabel: item.b || '' }
  const a = assessment.build(snapshot, retrieval.rank(snapshot, info), info, { runId: 'probe' })
  const all = [], named = []
  a.scopeResults.forEach(function (s) {
    s.candidates.forEach(function (c) {
      if (all.indexOf(c.name) < 0) all.push(c.name)
      if (c.evidenceTier === 'named' && named.indexOf(c.name) < 0) named.push(c.name)
    })
  })
  return { ownerConcepts: owner.map(function (f) { return f.conceptId }), candidates: all, named: named, outcome: named.length ? 'named' : all.length ? 'tentative' : 'none' }
}

function summarize(rows) {
  const answerable = rows.filter(function (r) { return r.expected.length })
  const count = function (list, fn) { return list.filter(fn).length }
  return {
    total: rows.length,
    answerable: answerable.length,
    named: count(rows, function (r) { return r.outcome === 'named' }),
    tentative: count(rows, function (r) { return r.outcome === 'tentative' }),
    none: count(rows, function (r) { return r.outcome === 'none' }),
    namedCorrect: count(answerable, function (r) { return r.outcome === 'named' && r.expected.indexOf(r.named[0]) >= 0 }),
    namedWrong: count(rows, function (r) { return r.outcome === 'named' && r.expected.indexOf(r.named[0]) < 0 }),
    expectedInCandidates: count(answerable, function (r) { return r.candidates.some(function (n) { return r.expected.indexOf(n) >= 0 }) })
  }
}

function evaluate() {
  const channels = {}
  const corpora = {
    recall: recall.CASES.map(function (t, i) { return { id: 'recall-' + (i + 1), c: t.c, s: t.s, b: t.b, vf: t.vf, expected: t.expect } }),
    scenarios: bank.cases.map(function (c) { return { id: c.case_id, c: c.query.complaint, s: c.query.species, b: c.query.bodyPart, vf: c.query.visualFeatures || [], expected: c.expected_relevant_cards } })
  }
  Object.keys(corpora).forEach(function (name) {
    ;[['textOnly', false], ['withPhoto', true]].forEach(function (pair) {
      if (pair[1] && name === 'scenarios') return // 该题库没有视觉词，withPhoto 与 textOnly 相同
      const rows = corpora[name].map(function (item) { return Object.assign({ id: item.id, complaint: item.c, expected: item.expected }, run(item, pair[1])) })
      channels[name + '/' + pair[0]] = { summary: summarize(rows), rows: rows }
    })
  })
  const pinned = PINNED.map(function (p) {
    const r = run(p, true), failures = []
    ;(p.mustInclude || []).forEach(function (n) { if (r.candidates.indexOf(n) < 0) failures.push('缺少候选 ' + n) })
    ;(p.mustExclude || []).forEach(function (n) { if (r.candidates.indexOf(n) >= 0) failures.push('不应出现 ' + n) })
    if (p.mustNotName && r.named.length) failures.push('不应点名，实际点名 ' + r.named.join('、'))
    if (p.mustName && r.named[0] !== p.mustName) failures.push('应点名 ' + p.mustName + '，实际 ' + (r.named[0] || r.outcome))
    return Object.assign({ id: p.id, note: p.note, pass: !failures.length, failures: failures }, r)
  })
  return {
    tool: 'guided_probe',
    rankPolicyVersion: retrieval.POLICY.version,
    conceptVersion: concepts.VERSION,
    scenarioBankVersion: bank.version,
    scope: 'synthetic_development_exposed_not_clinical',
    photo_simulation: 'manual_visual_words_as_clear_findings_upper_bound',
    model_calls: 0,
    channels: channels,
    pinned: pinned
  }
}

function main() {
  const args = process.argv.slice(2)
  const verbose = args.indexOf('--verbose') >= 0
  const outIndex = args.indexOf('--out')
  const report = evaluate()
  console.log('\nguided 线上路径探针 — rankPolicy=' + report.rankPolicyVersion + '，不调用模型，合成语料非临床指标\n')
  console.log('语料/通道'.padEnd(22) + '点名  可能方向  无候选  点名正确  点名错误  期望在候选')
  Object.keys(report.channels).forEach(function (key) {
    const s = report.channels[key].summary
    console.log(key.padEnd(24) + [s.named, s.tentative, s.none, s.namedCorrect, s.namedWrong, s.expectedInCandidates + '/' + s.answerable].map(function (v) { return String(v).padEnd(9) }).join(' '))
    if (verbose) report.channels[key].rows.forEach(function (r) {
      console.log('    ' + (r.outcome === 'named' ? (r.expected.indexOf(r.named[0]) >= 0 ? '✓点名 ' : '✗点名 ') : r.outcome === 'tentative' ? '·方向 ' : '-无   ') + r.id + ' 「' + r.complaint + '」 → ' + (r.candidates.join(' | ') || '(无)'))
    })
  })
  console.log('\n固定回归：')
  report.pinned.forEach(function (p) { console.log('  ' + (p.pass ? '✓' : '✗') + ' ' + p.id + (p.pass ? '' : ' — ' + p.failures.join('；'))) })
  if (outIndex >= 0 && args[outIndex + 1]) {
    fs.writeFileSync(path.resolve(args[outIndex + 1]), JSON.stringify(report, null, 2))
    console.log('\n报告已写入 ' + path.resolve(args[outIndex + 1]))
  }
  if (report.pinned.some(function (p) { return !p.pass })) process.exit(1)
}

if (require.main === module) main()

module.exports = { evaluate: evaluate, run: run, PINNED: PINNED }
