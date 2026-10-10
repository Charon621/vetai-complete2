#!/usr/bin/env node
/**
 * compare_rankings.js — B02-4：两份检索快照的逐例比较（只读，不调权重、不改排序）。
 *
 * 用法（实施 B02 后可用；此前该命令不存在）：
 *   node evaluation/tools/compare_rankings.js --before <基线快照.json> --after <新快照.json> --out <E盘diff.json>
 *
 * 纪律（BUG-28/B02-4）：
 *   - 任一侧缺 schema_version / traceability / input_sha256 → 拒绝比较（退出码 2）；
 *   - 两份快照 input_sha256 不一致 → 拒绝比较（不同输入的分歧不可归因）；
 *   - created_at 等非语义字段不参与比较；版本哈希变化记为元数据，本身不算排名变化；
 *   - 退出码：0=排名语义未变；1=存在排名/分差/证据/病族折叠变化；2=拒绝比较。
 *
 * 输出逐例：added/removed/moved（含 from→to 名次与分差）、matched 证据来源增删、
 * redFlagMatches 增删、病族折叠 Top3 变化、Top-1/MRR 集合指标变化。
 * 全部落盘由 --out 指定（放 E 盘批次留档目录，不写 evaluation/runs）。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const rm = require(path.join(__dirname, 'retrieval_metrics.js'))

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--before') out.before = argv[++i]
    else if (argv[i] === '--after') out.after = argv[++i]
    else if (argv[i] === '--out') out.out = argv[++i]
  }
  return out
}

function loadSnapshot(p, label) {
  if (!p) {
    console.error('缺少 --' + label + ' 参数')
    process.exit(2)
  }
  if (!fs.existsSync(p)) {
    console.error('快照不存在：' + p)
    process.exit(2)
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    console.error('快照 JSON 解析失败（' + label + '）：' + e.message)
    process.exit(2)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const before = loadSnapshot(args.before, 'before')
  const after = loadSnapshot(args.after, 'after')

  const diff = rm.diffSnapshots(before, after)

  if (diff.status === 'refused') {
    console.error('比较被拒绝：' + diff.refuse_reason)
    if (args.out) {
      const dir = path.dirname(args.out)
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(args.out, JSON.stringify(diff, null, 2), 'utf8')
      console.error('拒绝原因已写入: ' + args.out)
    }
    process.exit(2)
  }

  if (args.out) {
    const dir = path.dirname(args.out)
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(diff, null, 2), 'utf8')
  }

  // 控制台摘要
  console.log('快照比较（同输入 ' + (diff.input_sha256_equal ? 'input_sha256 一致' : '不一致') + '）')
  console.log('  卡片内容变化: ' + diff.card_hash_changes.length + ' 张' +
    (diff.card_hash_changes.length ? ' → ' + diff.card_hash_changes.map(function (c) { return c.id + '(' + c.change + ')' }).join(', ') : ''))
  console.log('  版本元数据: ' + JSON.stringify({
    kb_version_changed: diff.versions.kb_version.changed,
    kb_source_changed: diff.versions.kb_source_sha256.changed,
    code_commit_changed: diff.versions.code_commit.changed,
    label_map_changed: diff.versions.label_map.changed
  }))
  Object.keys(diff.channels).forEach(function (ch) {
    const rep = diff.channels[ch]
    console.log('  通道 ' + ch + ': ' + rep.case_count + ' 例，变化 ' + rep.changed_case_count + ' 例')
    rep.cases.forEach(function (c) {
      if (!c.ranking_changed) return
      console.log('    ~ ' + c.case_key + (c.presence !== 'both' ? '（' + c.presence + '）' : ''))
      ;(c.ranking_changes || []).forEach(function (r) {
        if (r.kind === 'removed') console.log('        - 移出: ' + r.name + '（原第' + r.before.rank + '位, ' + r.before.score + '分）')
        else if (r.kind === 'added') console.log('        + 新入: ' + r.name + '（第' + r.after.rank + '位, ' + r.after.score + '分）')
        else console.log('        * 移动: ' + r.name + ' 第' + r.before.rank + '→' + r.after.rank + '位, ' + r.before.score + '→' + r.after.score + '分（Δ' + r.score_delta + '）')
      })
      Object.keys(c.evidence_changes.per_card || {}).forEach(function (id) {
        const d = c.evidence_changes.per_card[id]
        if (d.matched.added.length) console.log('        证据新增[' + d.name + ']: ' + d.matched.added.join(' | '))
        if (d.matched.removed.length) console.log('        证据移除[' + d.name + ']: ' + d.matched.removed.join(' | '))
        if (d.red_flags.added.length) console.log('        红旗新增[' + d.name + ']: ' + d.red_flags.added.join(' | '))
        if (d.red_flags.removed.length) console.log('        红旗移除[' + d.name + ']: ' + d.red_flags.removed.join(' | '))
      })
      if (c.family_changes.added.length || c.family_changes.removed.length) {
        console.log('        病族折叠变化: +' + c.family_changes.added.join(',') + ' -' + c.family_changes.removed.join(','))
      }
    })
  })
  console.log('结论: ' + (diff.ranking_semantically_unchanged ? '同输入重跑，排名语义无变化（diff 为空）' : '存在 ' + diff.changed_case_count_total + ' 例次排名/证据/病族变化'))

  if (args.out) console.log('已写入: ' + args.out)
  process.exit(diff.ranking_semantically_unchanged ? 0 : 1)
}

if (require.main === module) main()

module.exports = { main: main }
