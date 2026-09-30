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
console.log('UI interaction tests passed')
