// ============================================================
// 首页问候语：按宠物最近一次检查动态生成
// 1. 没有检查记录        → 给团子 / 做第一次皮肤检查
// 2. 30 天内结果需关注以上 → 团子的耳朵， / 好些了吗？
// 3. 其他情况            → 团子 / 哪里不舒服？
// 纯函数，不依赖 wx，便于 node 测试
// ============================================================

var PART_WORDS = {
  head: '头',
  neck: '脖子',
  ears: '耳朵',
  back: '背',
  abdomen: '肚子',
  limbs: '腿',
  paws: '爪子',
  tail: '尾巴'
}

var RECHECK_URGENCY = { moderate: true, urgent: true, emergency: true }
var RECHECK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function recordTime(record) {
  if (!record) return 0
  if (typeof record.createdAt === 'number') return record.createdAt
  var t = Date.parse(String(record.generatedAt || record.timestamp || ''))
  return isNaN(t) ? 0 : t
}

function pickName(petName, record) {
  if (petName) return petName
  var recName = record && record.petName
  if (recName && recName !== '临时问诊') return recName
  return 'TA'
}

/**
 * @param {object} opts
 * @param {string} opts.petName  当前选中宠物名，可空
 * @param {object} opts.record   该宠物最近一条检查记录，可空
 * @param {number} opts.now      当前毫秒时间戳（测试注入）
 * @returns {{mode, pre, name, post, line2, sub}}
 */
function buildGreeting(opts) {
  opts = opts || {}
  var record = opts.record || null
  var now = typeof opts.now === 'number' ? opts.now : Date.now()
  var name = pickName(opts.petName, record)

  if (!record) {
    return {
      mode: 'first',
      pre: '给',
      name: name,
      post: '',
      line2: '做第一次皮肤检查',
      sub: '拍一张患处照片，AI 帮你看看'
    }
  }

  var t = recordTime(record)
  var recent = t > 0 && now - t <= RECHECK_WINDOW_MS
  if (recent && RECHECK_URGENCY[record.urgency]) {
    var d = new Date(t)
    return {
      mode: 'recheck',
      pre: '',
      name: name,
      post: '的' + (PART_WORDS[record.bodyPart] || '皮肤') + '，',
      line2: '好些了吗？',
      sub: '上次检查在' + (d.getMonth() + 1) + '月' + d.getDate() + '日，再拍一张对比看看'
    }
  }

  return {
    mode: 'default',
    pre: '',
    name: name,
    post: '',
    line2: '哪里不舒服？',
    sub: '拍一张患处，AI 帮你看看'
  }
}

module.exports = {
  buildGreeting: buildGreeting
}
