#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const ROOT = path.resolve(__dirname,'../..')
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
function evidenceHash(ledger, claim) {
  return hash((claim.evidence || []).map(id => {
    const span=ledger.spans.find(s=>s.id===id)
    return {span:span,source:span && ledger.sources.find(s=>s.id===span.source_id)}
  }))
}
function audit(ledger, cards, today) {
  today = today || new Date().toISOString().slice(0,10)
  const errors=[], warnings=[], ids=new Set(), sourceIds=new Set(), spanIds=new Set(), counts={source_verified:0,partial_support:0,pending:0}
  if(!ledger || ![1,2].includes(ledger.schema_version) || !ledger.version || !Array.isArray(ledger.claims) || !Array.isArray(ledger.sources) || !Array.isArray(ledger.spans))return {ok:false,errors:['Invalid evidence schema'],warnings}
  if(ledger.schema_version===1)warnings.push('Legacy evidence schema: per-page species scope may be absent; retained for historical restore')
  ledger.sources.forEach(s=>{
    if(!s.id||sourceIds.has(s.id))errors.push('Duplicate/missing source ID');sourceIds.add(s.id)
    if(!/^https:\/\//.test(s.url||'') || !s.title || !s.version || !s.retrieved_on || !s.review_due)errors.push('Incomplete source: '+s.id)
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s.review_due||''))errors.push('Invalid review date: '+s.id)
    else if(s.review_due<today)warnings.push('Source review overdue: '+s.id)
  })
  ledger.spans.forEach(s=>{
    if(!s.id||spanIds.has(s.id))errors.push('Duplicate/missing span ID');spanIds.add(s.id)
    if(!sourceIds.has(s.source_id)||!s.section||!Number.isInteger(s.pdf_page)||s.pdf_page<1||(ledger.schema_version>=2 && (!Array.isArray(s.species)||!s.species.length||s.species.some(v=>!['犬','猫'].includes(v)))))errors.push('Invalid locator: '+s.id)
  })
  ledger.claims.forEach(c=>{
    if(!c.id||ids.has(c.id))errors.push('Duplicate/missing claim ID');ids.add(c.id)
    const card=cards.find(k=>k.id===c.card_id && k.name===c.card_name)
    if(!card || !Object.prototype.hasOwnProperty.call(card,c.field))errors.push('Unknown card/field: '+c.id)
    else {
      if(hash(card[c.field])!==c.field_sha256)errors.push('Stale field binding: '+c.id)
      if(!JSON.stringify(card[c.field]).includes(c.original_fragment)||!c.original_fragment)errors.push('Missing bound statement: '+c.id)
      if(!c.applicability || !Array.isArray(c.applicability.species)||!c.applicability.species.length||c.applicability.species.some(s=>!card.species.includes(s)))errors.push('Species scope mismatch: '+c.id)
    }
    if(!Object.prototype.hasOwnProperty.call(counts,c.status))errors.push('Invalid claim status: '+c.id);else counts[c.status]++
    if(!Array.isArray(c.evidence)||c.evidence.some(id=>!spanIds.has(id)))errors.push('Broken source binding: '+c.id)
    if(evidenceHash(ledger,c)!==c.evidence_sha256)errors.push('Stale evidence binding: '+c.id)
    if(c.status==='source_verified'&&(!c.evidence||!c.evidence.length))errors.push('Verified claim without evidence: '+c.id)
    if(ledger.schema_version>=2 && c.status==='source_verified' && c.applicability && Array.isArray(c.applicability.species) && c.applicability.species.some(species => !(c.evidence || []).some(id => ledger.spans.some(s=>s.id===id && Array.isArray(s.species) && s.species.includes(species)))))errors.push('Evidence species coverage gap: '+c.id)
    if(!c.applicability||!Array.isArray(c.applicability.conditions)||!c.applicability.conditions.length||!c.limitation)errors.push('Missing applicability/limitation: '+c.id)
    if(!c.review||c.review.decision!==c.status||!c.review.reviewer||!c.review.reviewed_on||!c.review.role)errors.push('Missing review record: '+c.id)
    if(c.review && c.review.clinical_signed_at && (!c.review.clinical_reviewer||c.review.role!=='veterinary_review'))errors.push('Unsupported clinical signature: '+c.id)
    if(!Array.isArray(c.history)||!c.history.length)errors.push('Missing history: '+c.id)
    if(c.status!=='source_verified')warnings.push(c.status+': '+c.id)
  })
  return {ok:!errors.length,version:ledger.version,scenario:ledger.scenario,card_count:cards.length,cards_with_claims:new Set(ledger.claims.map(c=>c.card_id)).size,claim_count:ledger.claims.length,counts,errors,warnings}
}
if(require.main===module){const result=audit(require('../../knowledge/evidence-ledger.json'),require('../../utils/kb').DISEASE_KB);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1}
module.exports={audit,hash,evidenceHash}
