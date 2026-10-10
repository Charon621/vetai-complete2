// BUG-UI64/66/69/71：覆盖来源整理、长按删除、头像映射及字体加载契约。
var assert = require('assert')
var fs = require('fs')
var stored = {}
var definition
var action
var modal
var navigations = []
var fontOptions
global.wx = {
  env: { USER_DATA_PATH: '/user-data' },
  getStorageSync: function (key) { return stored[key] },
  setStorageSync: function (key, value) { stored[key] = value },
  removeStorageSync: function (key) { delete stored[key] },
  showToast: function () {},
  showActionSheet: function (options) { action = options },
  showModal: function (options) { modal = options },
  navigateTo: function (options) { navigations.push(options.url) },
  loadFontFace: function (options) { fontOptions = options; options.success() }
}
global.Page = function (value) { definition = value }
function createPage() {
  var page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(page.data, patch) }
  return page
}
function event(id) { return { currentTarget: { dataset: { id: id } } } }

require('../pages/detail/detail')
var detail = createPage()
stored.pet_diagnosis_history_guest = [
  {id: 'photo', disease: '照片检查', urgency: 'urgent'},
  {id: 'chat', source: 'chat', disease: '对话检查', urgency: 'moderate'}
]
var reloads = 0
detail.loadRecords = function () { reloads++ }
detail.onRecordTouchStart()
detail.onRecordLongPress(event('photo'))
assert.strictEqual(action.itemList[0], '删除这条记录')
assert.strictEqual(stored.pet_diagnosis_history_guest.length, 2, '长按菜单不直接删除')
detail.onRecordTap(event('photo'))
assert.strictEqual(navigations.length, 0, '长按松手不打开详情')
action.success({tapIndex: 0})
assert.strictEqual(modal.confirmText, '删除')
modal.success({confirm: false})
assert.strictEqual(stored.pet_diagnosis_history_guest.length, 2, '取消确认保留记录')
detail.onRecordTouchStart()
detail.onRecordLongPress(event('photo'))
action.success({tapIndex: 0})
modal.success({confirm: true})
assert.strictEqual(stored.pet_diagnosis_history_guest.length, 1)
assert.strictEqual(stored.pet_diagnosis_history_guest[0].id, 'chat')
assert.strictEqual(reloads, 1, '确认删除后刷新列表')
// 取消长按菜单后，新一次触摸仍可正常短按进入报告。
detail.onRecordTouchStart()
detail.onRecordLongPress(event('chat'))
detail.onRecordTouchStart()
detail.onRecordTap(event('chat'))
assert.strictEqual(navigations[0], '/pages/chat/report/report?id=chat')
var previousAction = action
detail.onRecordLongPress(event(''))
assert.strictEqual(action, previousAction, '无 ID 不弹删除菜单')

stored.pet_profiles_guest = [
  {id: 'one', petName: '豆豆', avatar: '/user-data/avatar.jpg'},
  {id: 'two', petName: '团团'}
]
detail.loadPets()
assert.strictEqual(detail.data.pets[0].avatar, '/user-data/avatar.jpg')
assert.strictEqual(detail.data.pets[1].avatar, '')
assert.strictEqual(detail.data.pets[1].initial, '团')
require('../pages/index/index')
// definition 会被后续 require 的页面覆盖，index 的定义在此快照备用（BUG-UI75 分页回归用）
var indexDefinition = definition
var indexPage = createPage()
indexPage.loadProfiles()
assert.strictEqual(indexPage.data.displayProfiles[0].avatar, '/user-data/avatar.jpg')
assert.strictEqual(indexPage.data.displayProfiles[1].avatar, '')

require('../pages/result/result')
var resultPage = createPage()
var sources = [
  {title: 'https 来源', url: 'https://www.example.com:8443/a/b?q=1#anchor', tier: '临床参考'},
  {title: 'http 来源', url: 'http://docs.example.org/path'},
  {title: '相对链接', url: '/reference/local'},
  '纯文字来源',
  {title: '重复网址', url: 'http://docs.example.org/path'}
]
var unchanged = JSON.stringify(sources)
var display = resultPage.buildDisplayRecord({id: 'qa', urgency: 'urgent', ragSources: sources})
assert.strictEqual(display.record.sourceList.length, 4)
assert.strictEqual(display.record.sourceList[0].domain, 'example.com')
assert.strictEqual(display.record.sourceList[0].url, sources[0].url, '域名显示不丢失原链接')
assert.strictEqual(display.record.sourceList[1].domain, 'docs.example.org')
assert.strictEqual(display.record.sourceList[2].domain, '')
assert.strictEqual(display.record.sourceList[3].domain, '')
assert.strictEqual(JSON.stringify(sources), unchanged, '显示整理不修改原始记录')

var fontData = require('../utils/fontData')
assert.strictEqual(Buffer.from(fontData.base64, 'base64').slice(0, 4).toString(), 'wOFF')
require('../utils/fontFace').loadSerif()
assert.ok(fontOptions.source.indexOf('data:font/woff;base64,') === 0)
assert.strictEqual(fontOptions.global, true)

// ============================================================
// BUG-UI75：档案多于 5 只时 showActionSheet 的 itemList 超 6 项上限直接 fail
//（且此前无 fail 兜底），用户点「选择宠物」无任何反应。
// 回归契约：降级为分页 ActionSheet——每页 3 只 + 上一页/下一页，
// 「临时问诊（不选宠物）」常驻末位；翻页往返与选择映射都正确。
// ============================================================
stored.pet_profiles_guest = []
for (var pi = 0; pi < 7; pi++) {
  stored.pet_profiles_guest.push({ id: 'p' + pi, petName: '宠物' + pi })
}
var pagerPage = Object.assign({}, indexDefinition)
pagerPage.data = JSON.parse(JSON.stringify(indexDefinition.data))
pagerPage.setData = function (patch, callback) {
  Object.assign(pagerPage.data, patch)
  if (typeof callback === 'function') callback()
}
pagerPage.loadProfiles()
pagerPage.onSelectPet()
assert.ok(action && Array.isArray(action.itemList), '多档案时应弹出分页 ActionSheet')

var visitedPages = 0
while (true) {
  assert.ok(action.itemList.length <= 6, '每页 itemList 不得超过 6 项上限')
  assert.strictEqual(action.itemList[action.itemList.length - 1], '临时问诊（不选宠物）',
    '「临时问诊」必须常驻每页末位')
  visitedPages++
  var nextIdx = action.itemList.indexOf('下一页（还有 ' + (7 - visitedPages * 3) + ' 只）')
  if (nextIdx < 0) break
  action.success({ tapIndex: nextIdx })
}
assert.strictEqual(visitedPages, 3, '7 只宠物应分 3 页（3+3+1）')

// 末页应有「上一页」且恰好剩 1 只
assert.strictEqual(action.itemList[0], '上一页')
assert.strictEqual(action.itemList[1], '宠物6')
action.success({ tapIndex: 1 })
assert.strictEqual(pagerPage.data.hasSelectedPet, true)
assert.strictEqual(pagerPage.data.selectedPetName, '宠物6')

// 「临时问诊」清空选中；「上一页」可往返
pagerPage.onSelectPet()
var tempIdx = action.itemList.indexOf('临时问诊（不选宠物）')
action.success({ tapIndex: tempIdx })
assert.strictEqual(pagerPage.data.hasSelectedPet, false)
pagerPage.onSelectPet()
action.success({ tapIndex: action.itemList.indexOf('上一页') })
assert.strictEqual(action.itemList[action.itemList.length - 1], '临时问诊（不选宠物）')
var petIdx = action.itemList.indexOf('宠物2')
assert.ok(petIdx > 0, '第 1 页应包含第 4 只宠物（start=3，0 基）')
action.success({ tapIndex: petIdx })
assert.strictEqual(pagerPage.data.selectedPetName, '宠物2')

console.log('UI interaction tests passed')
