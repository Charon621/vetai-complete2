// BUG-11/13/14：有限、可追溯的中文作用域适配；歧义为 unknown，不补阳性。
var SITE_RE = /左耳|右耳|耳部|耳朵|耳廓|耳道|腹部|肚皮|背部|腰背|尾根|尾巴|面部|脸上|眼周|眼皮|眼睑|下巴|左爪|右爪|爪部|脚垫|肉垫|趾间|口腔|口内|嘴里|嘴巴里面|口唇内侧|黏膜|牙龈|舌头|舌面|肛周|鼻部|全身/
function fragments(text) {
  var raw = String(text || ''), cuts = [0], re = /[，,。；;、\n？！?!]|\s+|(?:而|但是|但|也)(?=我|主人|家人|猫|狗|它|没有|没|不)|(?=现在|目前|以前|过去|去年)|(?=背部另|腹部另|另一处|另外一处)|(?=还有|并且|没有|未见|无瘙痒|不痒|没红|没皮|没甩|没抓|没挠|只(?:是|有|耳)|仅)/g, m
  while ((m = re.exec(raw))) {
    // “有没有”中的否定片段不能被切成“没有”，否则不确定会被当作阴性。
    if (!(raw.slice(m.index - 1, m.index + 2) === '有没有')) { cuts.push(m.index); cuts.push(m.index + m[0].length) }
    if (!m[0].length) re.lastIndex++
  }
  // BUG-15：无标点的部位转移也建立独立片段，不能跨病灶凑组合。
  var sites = /左耳|右耳|腹部|背部|左爪|右爪|爪部|口腔|牙龈|舌面/g, siteMatch, seenSite = false
  while ((siteMatch=sites.exec(raw))) { if (seenSite) cuts.push(siteMatch.index); seenSite=true }
  cuts.push(raw.length); cuts = cuts.sort(function (a,b) { return a-b }).filter(function (n,i,a) { return i===0 || n!==a[i-1] })
  var out = [], subject = 'pet', time = 'current', site = ''
  for (var i=0;i<cuts.length-1;i++) {
    var start=cuts[i],end=cuts[i+1],part=raw.slice(start,end)
    if (!part.trim() || /^[，,。；;、\n？！?!而但也]+$/.test(part)) continue
    if (/(我的|我家|我们家的)?[猫狗犬]|宠物|它|他家猫/.test(part) && !/^我(?:手|身|腿|脚|皮肤)/.test(part)) subject='pet'
    if (/朋友的|邻居的|别人家的|他家的|另一只宠物/.test(part)) subject='other_animal'
    if (/(?:我|主人|家人|孩子|小孩)(?:的)?(?:手|身|腿|脚|皮肤|胳膊|脖|肚|背)|^我(?:也|很|痒|抱|没有|没)|^我$/.test(part) && !/^我的[猫狗]/.test(part)) subject='owner'
    if (/以前|过去|去年|曾经|之前/.test(part)) time='past'
    if (/现在|目前|今天|刚刚|新起/.test(part)) time='current'
    var found=part.match(SITE_RE);if(found)site=found[0]
    var assertion=/会不会|是不是|是否|如果|假如|万一|可能|不确定|不知道|怀疑|没注意|有没有|看不清|无法判断|怎么办|[吗么]$/.test(part.trim())?'uncertain':/没有|未见|否认|不伴|没(?:有|见|怎么|甩|抓|挠|红|皮)|不(?:痒|痛|疼|红|挠|甩|抓)|无(?:瘙痒|痛|红|皮损|溃疡)/.test(part)?'absent':'present'
    out.push({text:part,subject:subject,assertion:assertion,temporality:time,site:site,lesionId:site||'unspecified',evidenceSpan:{start:start,end:end,text:part},source:'owner_text'})
  }
  return out
}
function negativeState(text) {
  var states=[]
  if (/不痒|无瘙痒|不瘙痒|一点.*不痒|不抓也不挠/.test(text)) states.push('不痒')
  if (/不疼|不痛|无痛|没有痛感/.test(text)) states.push('无痛')
  if (/没(?:做|打|有)?驱虫|好久没驱虫|驱虫过期|忘了驱虫/.test(text)) states.push('驱虫不规律')
  if (/未接种|没打疫苗/.test(text)) states.push('未接种疫苗')
  return states
}
function currentPetText(text) {
  return fragments(text).filter(function(f){return f.subject==='pet'&&f.temporality==='current'&&f.assertion!=='uncertain'}).map(function(f){return f.assertion==='present'?f.text:negativeState(f.text).join(' ')}).join('，')
}
function splitSubject(text) {
  var parts=fragments(text),owner=parts.filter(function(f){return f.subject==='owner'&&f.temporality==='current'&&f.assertion==='present'&&/痒|疹|皮损|掉皮|结痂|脱毛/.test(f.text)})
  return {petComplaint:parts.filter(function(f){return f.subject==='pet'}).map(function(f){return f.text}).join('，'),zoonosisHint:owner.length>0,ownerEvidence:owner,fragments:parts}
}
module.exports={fragments:fragments,negativeState:negativeState,currentPetText:currentPetText,splitSubject:splitSubject}
