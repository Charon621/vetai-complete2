var kb=require('./kb'),concepts=require('./clinicalConcepts'),profiles=require('./retrievalProfileBundle'),contracts=require('./ragContracts'),weights=require('./retrievalWeights').weights
// 工程门限，与旧快路径阈值独立；未证明新排序更好时保留规则顺序。
var POLICY={version:'rag-rank-v2',defaultStrategy:'rules',poolLimit:8,displayLimit:3,minDistinctSupport:2,minClearSpecificSupport:1,possibleFactor:0.25}
function eligible(f,snapshot) {
  if(f.subject!=='pet'||f.temporality!=='current'||!f.observed||f.certainty==='indeterminate'||f.assertion==='unknown')return false
  if(f.source==='photo' && snapshot.imageQuality.some(function(q){return q.imageId===f.imageId&&q.quality==='unusable'}))return false
  return !!concepts.lookup(f.conceptId,f.source)
}
function scopeKey(f) {
  if(f.lesionId && ['unknown','unspecified'].indexOf(f.lesionId)<0)return f.lesionId
  return f.source==='photo' ? 'unassigned:'+ (f.sourceImageId || 'legacy') : 'owner:'+ (f.site || 'unknown')
}
function groupFacts(snapshot) {
  var grouped={}
  snapshot.facts.forEach(function(f){var key=scopeKey(f);if(!grouped[key])grouped[key]=[];grouped[key].push(f)})
  return Object.keys(grouped).sort().map(function(key){return {lesionId:key,facts:grouped[key],site:grouped[key][0].site||'unknown'}})
}
// 部位冲突只用于所有部位都能归入区域的卡（如耳螨只在耳部、尾根腺炎在尾背），取其区域并集；含头部、全身、躯干等不归区域的部位时不锁定，病灶部位未知时也不排除。
var REGIONS={ear:['耳'],tail:['尾','臀','肛','会阴','屁股'],back:['背','腰'],belly:['腹','腋','胸'],limb:['腿','肢','肘','腕','跗'],paw:['爪','足','趾','脚','甲','垫'],eye:['眼','睑'],nose:['鼻'],mouth:['唇','口','嘴','下巴','下颌','颏'],neck:['颈','脖']}
function regionsOf(text) {
  text=String(text||'')
  return Object.keys(REGIONS).filter(function(key){return REGIONS[key].some(function(word){return text.indexOf(word)>=0})})
}
function lockedRegions(card) {
  var locations=card.locations||[],out=[]
  for(var i=0;i<locations.length;i++){var r=regionsOf(locations[i]);if(!r.length)return [];r.forEach(function(k){if(out.indexOf(k)<0)out.push(k)})}
  return out
}
function siteConflict(card,sites) {
  var regions=lockedRegions(card),mapped=sites.map(regionsOf)
  return regions.length>0 && mapped.length>0 && mapped.every(function(r){return r.length>0&&!r.some(function(k){return regions.indexOf(k)>=0})})
}
function knownSites(facts,petInfo) {
  var sites=facts.map(function(f){return f.site}).filter(function(s,i,all){return s&&s!=='unknown'&&all.indexOf(s)===i})
  var form=petInfo.bodyPartLabel||petInfo.bodyPart||''
  return sites.length?sites:(form?[form]:[])
}
function binding(profile,condition) {return {profileId:profile.profileId,cardId:profile.cardId,conditionId:condition.conditionId,field:condition.field,sourceFieldHash:condition.sourceFieldHash,evidenceStatus:condition.evidenceStatus}}
function ancestors(id) {var out=[id],row=concepts.lookup(id);while(row&&row.parentId){out.push(row.parentId);row=concepts.lookup(row.parentId)}return out}
function rank(snapshot,petInfo,options) {
  options=options||{}
  var validation=contracts.validateSnapshot(snapshot)
  if(!validation.valid)throw Error(validation.code)
  var species=petInfo.species==='cat'?'猫':petInfo.species==='dog'?'犬':petInfo.species || '',strategy=options.strategy||POLICY.defaultStrategy
  var scopes=groupFacts(snapshot)
  return {strategy:strategy,policyVersion:POLICY.version,profileVersion:profiles.version,scopes:scopes.map(function(scope) {
    var facts=scope.facts.filter(function(f){return eligible(f,snapshot)}),present=facts.filter(function(f){return f.assertion==='present'}),negative=facts.filter(function(f){return f.assertion==='absent'})
    var terms=present.map(function(f){return concepts.lookup(f.conceptId).term}),photo=present.filter(function(f){return f.source==='photo'}).map(function(f){return concepts.lookup(f.conceptId).term})
    var query={species:species,bodyPart:scope.site==='unknown'?'':scope.site,complaint:present.filter(function(f){return f.source==='owner_text'}).map(function(f){return concepts.lookup(f.conceptId).term}).join(' '),visualFeatures:photo}
    // 主人否定不生成照片阴性；保留显式负证据。
    query.complaint+=' '+negative.map(function(f){return '未见'+concepts.lookup(f.conceptId).term}).join(' ')
    var rules=(species==='猫'||species==='犬')?kb.searchCandidates(query):[],ruleIndex={},byCard={},sites=knownSites(present,petInfo)
    rules.forEach(function(hit,index){ruleIndex[hit.id]={index:index,score:hit.score,hit:hit}})
    if(species!=='猫'&&species!=='犬')return {lesionId:scope.lesionId,site:scope.site,candidates:[],pool:[],coverage:'out_of_scope'}
    ;(options.profiles || profiles.profiles).forEach(function(profile) {
      if(profile.species.indexOf(species)<0)return
      var card=kb.DISEASE_KB.filter(function(c){return c.id===profile.cardId})[0]
      if(!card)return
      if(kb.isMucosalQuery(query) && !kb.isMucosalQuery({bodyPart:card.locations.join(' '),complaint:card.name}))return
      var supports=[],conflicts=[],missing=[],bindings=[],seen={}
      profile.conceptGroups.forEach(function(condition) {
        var hits=present.filter(function(f){return ancestors(f.conceptId).indexOf(condition.conceptId)>=0})
        var contra=negative.filter(function(f){return f.conceptId===condition.conceptId})
        hits.forEach(function(f) {
          if(seen[f.conceptId])return
          seen[f.conceptId]=true
          var concept=concepts.lookup(condition.conceptId),weight=f.source==='photo'?(concept.generic?weights.photoGeneric:weights.photoSpecific):(condition.field==='historySigns'?weights.history:concept.generic?weights.textGeneric:weights.textSpecific)
          if(f.certainty==='possible')weight*=POLICY.possibleFactor
          supports.push({evidenceId:f.evidenceId,conceptId:f.conceptId,conditionId:condition.conditionId,weight:weight,soft:f.certainty==='possible',specific:!concept.generic,knowledgeBinding:binding(profile,condition)})
          bindings.push(binding(profile,condition))
        })
        contra.forEach(function(f){conflicts.push({evidenceId:f.evidenceId,conceptId:f.conceptId,conditionId:condition.conditionId,weight:f.certainty==='clear'?weights.negativePenalty:0,knowledgeBinding:binding(profile,condition)})})
      })
      // 上下位只保留更具体的一项，不重复累计。
      supports=supports.filter(function(s){return !supports.some(function(other){return other.conceptId!==s.conceptId&&ancestors(other.conceptId).slice(1).indexOf(s.conceptId)>=0})})
      var combinations=[],rule=ruleIndex[card.id]
      ;(rule&&rule.hit.comboEvidence||[]).forEach(function(combo){
        var groups=combo.actualMatchedConditions||[],ids=[]
        var complete=groups.length>1&&groups.every(function(group){var hit=present.filter(function(f){return f.certainty==='clear'&&group.some(function(term){var c=concepts.lookup(term);return c&&ancestors(f.conceptId).indexOf(c.conceptId)>=0})})[0];if(hit)ids.push(hit.evidenceId);return !!hit})
        if(complete)combinations.push({ruleId:combo.ruleId,supportEvidenceIds:ids.filter(function(id,i,all){return all.indexOf(id)===i})})
      })
      var specific=supports.filter(function(s){return s.specific&&!s.soft}).length,score=supports.reduce(function(n,s){return n+s.weight},0)-conflicts.reduce(function(n,c){return n+c.weight},0)+(combinations.length?3:0)
      if(!supports.length)return
      missing=card.recommendedTests.slice(0,3)
      var channels=[]
      if(ruleIndex[card.id])channels.push('rules')
      if(profile.retrievalTexts.some(function(text){return terms.some(function(term){return text.indexOf(term)>=0})}))channels.push('profile_text')
      if(!channels.length)return
      var mismatch=siteConflict(card,sites)
      var candidate={cardId:card.id,name:card.name,lesionId:scope.lesionId,rankScore:Math.round(score*100)/100,retrievalScore:ruleIndex[card.id]?ruleIndex[card.id].score:0,supports:supports,conflicts:conflicts,combinations:combinations,missing:missing,role:profile.role,retrievalChannels:channels,knowledgeBindings:bindings,siteConflict:mismatch,eligible:!mismatch && supports.length>=POLICY.minDistinctSupport && specific>=POLICY.minClearSpecificSupport && score>0,ruleOrder:ruleIndex[card.id]?ruleIndex[card.id].index:999,referenceKnowledge:card.typicalFeatures,ddx:card.ddxSource||'',sourceStatus:profile.evidenceStatus}
      if(!byCard[card.id] || candidate.rankScore>byCard[card.id].rankScore)byCard[card.id]=candidate
    })
    var pool=Object.keys(byCard).map(function(id){return byCard[id]})
    pool.sort(function(a,b){return strategy==='concept' ? b.rankScore-a.rankScore || a.ruleOrder-b.ruleOrder || a.cardId.localeCompare(b.cardId) : a.ruleOrder-b.ruleOrder || b.rankScore-a.rankScore || a.cardId.localeCompare(b.cardId)})
    pool=pool.slice(0,options.poolLimit||POLICY.poolLimit)
    return {lesionId:scope.lesionId,site:scope.site,pool:pool,candidates:pool.filter(function(c){return c.eligible}).slice(0,POLICY.displayLimit),coverage:pool.length?'covered':'no_supported_card'}
  })}
}
module.exports={POLICY:POLICY,rank:rank,groupFacts:groupFacts,eligible:eligible,scopeKey:scopeKey,lockedRegions:lockedRegions,siteConflict:siteConflict}
