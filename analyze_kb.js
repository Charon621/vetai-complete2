// 词表对齐诊断 v2
var kb = require('./utils/kb')
var VISUAL_VOCAB = kb.VISUAL_VOCAB
var HISTORY_VOCAB = kb.HISTORY_VOCAB
var DB = kb.DISEASE_KB

console.log('=== 词表对齐诊断 v2 ===')
console.log('视觉受控词表:', VISUAL_VOCAB.length, '词')
console.log('病史词表:', HISTORY_VOCAB.length, '词')
console.log('')

console.log('--- A. 分流后视觉可命中度 ---')
var weak = []
DB.forEach(function(d){
  if ((d.visualSigns||[]).length <= 1) weak.push(d.name + ' [视觉词: ' + (d.visualSigns||[]).join(',') + ']')
})
console.log('视觉词<=1 的疾病数: ' + weak.length)
weak.forEach(function(w){ console.log('  - ' + w) })
console.log('')

console.log('--- B. 知识库视觉词是否都在受控词表内 ---')
var VSET = {}; VISUAL_VOCAB.forEach(function(w){VSET[w]=true})
var HSET = {}; HISTORY_VOCAB.forEach(function(w){HSET[w]=true})
var uncovered = {}
DB.forEach(function(d){
  (d.visualSigns||[]).forEach(function(s){
    if (!VSET[s] && !HSET[s]) uncovered[s] = (uncovered[s]||0)+1
  })
})
var ul = Object.keys(uncovered).sort(function(a,b){return uncovered[b]-uncovered[a]})
console.log('未覆盖视觉词数: ' + ul.length)
ul.forEach(function(s){ console.log('  ' + s + ' (' + uncovered[s] + '个病)') })
console.log('')

console.log('--- C. 受控词表死词（无病使用）---')
var dead = VISUAL_VOCAB.filter(function(v){
  return !DB.some(function(d){ return (d.visualSigns||[]).some(function(s){ return s.indexOf(v)>=0||v.indexOf(s)>=0 }) })
})
console.log('死词数: ' + dead.length)
console.log('死词: ' + dead.join(' '))
console.log('')
console.log('=== 完成 ===')
