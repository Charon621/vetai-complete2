const assert = require('assert')

let pageDefinition = null
const stored = {}

global.wx = {
  env: { USER_DATA_PATH: '/user-data' },
  getStorageSync: function (key) { return stored[key] },
  setStorageSync: function (key, value) { stored[key] = value },
  removeStorageSync: function (key) { delete stored[key] },
  showToast: function () {},
  navigateBack: function () {},
  switchTab: function () {}
}
global.Page = function (definition) {
  pageDefinition = definition
}

const imageUtil = require('../utils/image')
const chatDoctor = require('../utils/chatDoctor')
require('../pages/chat/chat')

function createPage(data) {
  const page = Object.assign({}, pageDefinition)
  page.data = Object.assign({}, pageDefinition.data, data || {})
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(function (key) {
      page.data[key] = patch[key]
    })
    if (callback) callback()
  }
  page._scrollToBottom = function () {}
  return page
}

async function run() {
  const restoredPage = createPage()
  restoredPage._session = {
    messages: [
      { id: 'old-doctor', role: 'doctor', text: '**先观察**\n* 留意渗液', timestamp: 1 },
      { id: 'old-user', role: 'user', text: '我输入的 * 应保留', timestamp: 2 }
    ]
  }
  const restoredMessages = restoredPage._formatMessages()
  assert.strictEqual(restoredMessages[0].text, '先观察\n留意渗液',
    'saved doctor messages should also display without markdown syntax')
  assert.strictEqual(restoredMessages[1].text, '我输入的 * 应保留',
    'the display cleanup must not alter the user message')

  const firstBox = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
  const secondBox = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }
  const existingBox = { x: 0.6, y: 0.6, width: 0.2, height: 0.2 }

  const page = createPage({
    uploadedPhotos: ['data:image/jpeg;base64,ONE', 'data:image/jpeg;base64,TWO'],
    uploadedPhotoBoxes: [firstBox, secondBox],
    showPhotoActions: true,
    selectorImageIndex: 1
  })
  page._session = {
    phase: chatDoctor.PHASE.COMPLAINT,
    draft: {
      photoPaths: ['/user-data/existing.jpg'],
      photoBase64s: ['data:image/jpeg;base64,EXISTING'],
      lesionBoxes: [existingBox]
    },
    messages: []
  }

  page.onRemovePhoto({ currentTarget: { dataset: { index: 0 } } })
  assert.deepStrictEqual(page.data.uploadedPhotos, ['data:image/jpeg;base64,TWO'])
  assert.deepStrictEqual(page.data.uploadedPhotoBoxes, [secondBox],
    'removing a pending photo must remove its matching lesion box')

  page.data.selectorImageIndex = 0
  const replacementBox = { x: 0.4, y: 0.4, width: 0.3, height: 0.3 }
  page.onLesionSave({ detail: { box: replacementBox } })
  assert.deepStrictEqual(page.data.uploadedPhotoBoxes, [replacementBox],
    'pending lesion edits must stay with the pending batch')
  assert.deepStrictEqual(page._session.draft.lesionBoxes, [existingBox],
    'editing a pending photo must not overwrite a previously confirmed photo')

  imageUtil.saveImagesPermanent = function () {
    return Promise.resolve([{ path: '/user-data/new.jpg', newlySaved: true }])
  }
  page.onConfirmPhotos()
  await new Promise(function (resolve) { setTimeout(resolve, 0) })

  assert.deepStrictEqual(page._session.draft.photoPaths,
    ['/user-data/existing.jpg', '/user-data/new.jpg'])
  assert.deepStrictEqual(page._session.draft.lesionBoxes,
    [existingBox, replacementBox],
    'confirmed photos and lesion boxes must preserve the same ordering')
  assert.deepStrictEqual(page.data.uploadedPhotoBoxes, [])
  assert.ok(page.data.messages[page.data.messages.length - 1].text.indexOf('猫、狗') >= 0,
    'photo-first flow should ask only for species when it is unknown')

  const readyPage = createPage({
    uploadedPhotos: ['data:image/jpeg;base64,READY'],
    uploadedPhotoBoxes: [null], showPhotoActions: true
  })
  readyPage._session = {
    phase: chatDoctor.PHASE.COMPLAINT,
    draft: { petType: 'cat', complaint: '耳朵发红', photoPaths: [], photoBase64s: [], lesionBoxes: [] },
    messages: []
  }
  let diagnosisStarted = false
  readyPage._runDiagnosis = function () { diagnosisStarted = true }
  readyPage.onConfirmPhotos()
  await new Promise(function (resolve) { setTimeout(resolve, 550) })
  assert.strictEqual(readyPage._session.phase, chatDoctor.PHASE.ANALYZING,
    'with known species, uploading photos should start analysis without a forced questionnaire')
  assert.strictEqual(diagnosisStarted, true)

  const failedPage = createPage()
  failedPage._session = {
    phase: chatDoctor.PHASE.ANALYZING,
    draft: { petType: 'cat', photoPaths: ['/user-data/old.jpg'], pendingPhotoAnalysis: true },
    messages: []
  }
  failedPage._handleDiagnosisError('服务暂时不可用')
  assert.strictEqual(failedPage._session.phase, chatDoctor.PHASE.COMPLAINT,
    'a failed photo analysis must return to interactive text consultation')
  assert.strictEqual(failedPage._session.draft.pendingPhotoAnalysis, false)
  assert.strictEqual(failedPage.data.inputType, 'text')

  let chooseImageCalled = false
  wx.chooseImage = function () { chooseImageCalled = true }
  // 照片上限已随 BUG-C3 与首页统一为 config.MAX_IMAGES（当前 5），断言跟随配置而不是写死张数
  const maxImages = require('../utils/config').MAX_IMAGES
  page._session.draft.photoPaths = []
  for (let i = 0; i < maxImages; i++) {
    page._session.draft.photoPaths.push('/user-data/photo_' + i + '.jpg')
  }
  page.onUploadPhoto()
  assert.strictEqual(chooseImageCalled, false,
    'the chat page must enforce the config.MAX_IMAGES photo limit across confirmed and pending batches')

  // 自定义导航栏返回按钮（chat.json navigationStyle: custom）：
  // 有历史栈 → navigateBack；无历史栈（直接打开/分享进入）→ 回首页 tab
  let navigateBackCalled = false
  let switchTabCalled = false
  global.getCurrentPages = function () { return [{}, {}] }
  wx.navigateBack = function () { navigateBackCalled = true }
  wx.switchTab = function () { switchTabCalled = true }
  page.onBackTap()
  assert.strictEqual(navigateBackCalled, true, 'back with history should navigateBack')
  assert.strictEqual(switchTabCalled, false, 'back with history must not switchTab')
  global.getCurrentPages = function () { return [{}] }
  navigateBackCalled = false
  page.onBackTap()
  assert.strictEqual(switchTabCalled, true, 'back without history should switchTab to index')
  assert.strictEqual(navigateBackCalled, false, 'back without history must not navigateBack')

  console.log('chat page tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
