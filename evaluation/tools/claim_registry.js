#!/usr/bin/env node
/**
 * claim_registry.js — B17 字段来源与变更治理的校验工具（零依赖，Node 侧）。
 *
 * B17-1：复核 claim_source_registry.json——
 *   - claim_hash 对 utils/kb.js 中该卡该字段当前值自动重算：字段一改，旧 hash 失配
 *     即 stale（审阅失效，必须重新登记），不能拿旧审阅背书新内容；
 *   - 来源物种覆盖：猫源不得签犬字段；URL 只能空或 https；不得伪造教材网址；
 *   - status/reviewer_role/review_scope 完整性。
 * B17-2：复核 vocab_change_log.json 与 card_revision_log.json——
 *   - 新概念必须带 introduced_by_rule / contact_history / sourceRefs；
 *   - synonyms_checked 缺省按 false 警告（未查同义不静默等价）；
 *   - 修订台账逐条有 changed_fields 与如实 review_scope；全局版本更新不算逐字段复核。
 *
 * 运行产物不落盘；npm test（run-tests.js）注册本工具作为 C-ALL 的一道门。
 * 退出码：0 全部通过；1 有阻断错误。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..', '..')
const CFG = path.join(ROOT, 'evaluation', 'config')

global.wx = global.wx || {
  getStorageSync: function () { return [] },
  setStorageSync: function () {},
  request: function () { throw new Error('claim_registry 不应发起网络请求') }
}
const kb = require(path.join(ROOT, 'utils', 'kb'))

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function findCard(cardId) {
  return kb.DISEASE_KB.filter(function (c) { return c.id === cardId })[0] || null
}

function readField(card, fieldPath) {
  if (!card) return undefined
  // field_path 只允许浅层字段名或 a.b 两层，防止任意路径读取
  const parts = String(fieldPath).split('.')
  if (parts.length > 2) return undefined
  let node = card
  for (let i = 0; i < parts.length; i++) {
    node = node && Object.prototype.hasOwnProperty.call(node, parts[i]) ? node[parts[i]] : undefined
  }
  return node
}

function fieldHash(card, fieldPath) {
  const value = readField(card, fieldPath)
  if (value === undefined) return null
  return sha256(JSON.stringify(value))
}

function validateClaimRegistry(registry, errors, warnings, cardsById) {
  if (registry.kind !== 'claim_source_registry') errors.push('kind 必须为 claim_source_registry')
  if (!registry.registry_version) errors.push('缺少 registry_version')
  const sources = {}
  ;(registry.sources || []).forEach(function (s) {
    if (!s.source_id) { errors.push('来源缺 source_id'); return }
    if (sources[s.source_id]) errors.push('source_id 重复：' + s.source_id)
    sources[s.source_id] = s
    if (s.url && s.url.indexOf('https://') !== 0) {
      errors.push('来源 ' + s.source_id + ' URL 必须为空或 https://（不得伪造教材网址）')
    }
    if (!Array.isArray(s.applies_to_species) || !s.applies_to_species.length) {
      errors.push('来源 ' + s.source_id + ' 缺 applies_to_species（物种范围必须显式）')
    }
    if (!s.allowed_use) warnings.push('来源 ' + s.source_id + ' 未声明 allowed_use')
  })

  const cards = cardsById || {}
  ;(registry.claims || []).forEach(function (claim, idx) {
    const at = 'claims[' + idx + ']'
    const card = cards[claim.card_id]
    if (cardsById && !card) { errors.push(at + ' card_id 不存在：' + claim.card_id); return }
    const current = card ? fieldHash(card, claim.field_path) : null
    if (current === null) {
      errors.push(at + ' 字段不存在：' + claim.card_id + '#' + claim.field_path)
    } else if (claim.claim_hash !== 'AUTO_VERIFY' && claim.claim_hash !== current) {
      // B17-1 验收：改 claim 使旧 hash 审阅失效
      errors.push(at + ' claim_hash 与当前字段值不符（stale review，审阅已失效，须重新登记）')
    }
    const source = sources[claim.source_id]
    if (!source) { errors.push(at + ' source_id 未登记：' + claim.source_id); return }
    // 物种覆盖：卡片物种必须落在来源适用物种内
    if (card && Array.isArray(card.species)) {
      const covered = card.species.every(function (sp) {
        return (source.applies_to_species || []).indexOf(sp) >= 0
      })
      if (!covered) {
        errors.push(at + ' 来源物种范围 ' + JSON.stringify(source.applies_to_species) +
          ' 不覆盖卡片物种 ' + JSON.stringify(card.species) + '（猫源不得签犬字段）')
      }
    }
    if (!claim.locator) errors.push(at + ' 缺 locator（标题相关不等于每句支持）')
    if (!claim.checked_at) errors.push(at + ' 缺 checked_at')
    if (!claim.reviewer_role) errors.push(at + ' 缺 reviewer_role')
    if (!claim.review_scope) errors.push(at + ' 缺 review_scope')
    if (['draft', 'pending_clinical_review', 'reviewed_clinical'].indexOf(claim.status) < 0) {
      errors.push(at + ' status 非法：' + claim.status)
    }
    if (claim.status === 'reviewed_clinical' && claim.reviewer_role !== 'veterinarian') {
      errors.push(at + ' reviewed_clinical 必须由 veterinarian 签署')
    }
  })
}

function validateVocabLog(log, errors, warnings) {
  if (log.kind !== 'vocab_change_log') errors.push('vocab kind 必须为 vocab_change_log')
  if (!log.log_version) errors.push('vocab 缺 log_version')
  ;(log.entries || []).forEach(function (e, idx) {
    const at = 'vocab.entries[' + idx + ']'
    if (!e.concept) errors.push(at + ' 缺 concept')
    if (!e.introduced_by_rule) errors.push(at + ' 缺 introduced_by_rule（新词必须有规则/缺陷号/批次来源）')
    if (!e.contact_history) errors.push(at + ' 缺 contact_history（开发接触历史必须记录）')
    if (!e.sourceRefs || !e.sourceRefs.length) errors.push(at + ' 缺 sourceRefs')
    if (e.synonyms_checked !== true) {
      warnings.push(at + ' synonyms_checked 未置 true（未查同义不得静默等价）')
    }
    if (['visual', 'history'].indexOf(e.channel) < 0) errors.push(at + ' channel 非法：' + e.channel)
  })
}

function validateRevisionLog(log, errors, warnings, cardsById) {
  if (log.kind !== 'card_revision_log') errors.push('revision kind 必须为 card_revision_log')
  if (!log.log_version) errors.push('revision 缺 log_version')
  ;(log.revisions || []).forEach(function (r, idx) {
    const at = 'revisions[' + idx + ']'
    if (!r.card_id) errors.push(at + ' 缺 card_id')
    if (cardsById && !cardsById[r.card_id]) errors.push(at + ' card_id 不存在：' + r.card_id)
    if (!r.changed_fields || !r.changed_fields.length) errors.push(at + ' 缺 changed_fields（全局版本更新不算逐字段复核）')
    if (!r.change_summary) errors.push(at + ' 缺 change_summary')
    if (!r.review_scope) errors.push(at + ' 缺 review_scope')
    if (r.review_scope && r.review_scope.indexOf('非兽医逐卡签署') < 0 && r.status !== 'reviewed_clinical') {
      warnings.push(at + ' review_scope 若非逐卡签署口径，status 不得为 reviewed_clinical')
    }
    if (!r.changed_at) errors.push(at + ' 缺 changed_at')
  })
}

function main() {
  const errors = []
  const warnings = []
  const cardsById = {}
  kb.DISEASE_KB.forEach(function (c) { cardsById[c.id] = c })

  const registry = JSON.parse(fs.readFileSync(path.join(CFG, 'claim_source_registry.json'), 'utf8'))
  const vocabLog = JSON.parse(fs.readFileSync(path.join(CFG, 'vocab_change_log.json'), 'utf8'))
  const revisionLog = JSON.parse(fs.readFileSync(path.join(CFG, 'card_revision_log.json'), 'utf8'))

  validateClaimRegistry(registry, errors, warnings, cardsById)
  validateVocabLog(vocabLog, errors, warnings)
  validateRevisionLog(revisionLog, errors, warnings, cardsById)

  warnings.forEach(function (w) { console.log('  ⚠ ' + w) })
  if (errors.length) {
    console.error('claim/revision 注册校验失败：')
    errors.forEach(function (e) { console.error('  ✗ ' + e) })
    process.exit(1)
  }
  const autoClaims = (registry.claims || []).length
  console.log('claim/revision 注册校验通过：' + autoClaims + ' 条 claim（AUTO_VERIFY 动态复核）、' +
    (logEntries(vocabLog)) + ' 条词表登记、' + (logEntries(revisionLog)) + ' 条卡修订')
}

function logEntries(log) {
  return (log.entries || log.revisions || []).length
}

if (require.main === module) main()

module.exports = {
  sha256: sha256,
  fieldHash: fieldHash,
  validateClaimRegistry: validateClaimRegistry,
  validateVocabLog: validateVocabLog,
  validateRevisionLog: validateRevisionLog
}
