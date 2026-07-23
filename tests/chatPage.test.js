const assert = require('assert')

let pageDefinition = null
const stored = {}

global.wx = {
  env: { USER_DATA_PATH: '/user-data' },
  getStorageSync: function (key) { return stored[key] },
  setStorageSync: function (key, value) { stored[key] = value },
  removeStorageSync: function (key) { delete stored[key] },
  showToast: function () {}
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

  let chooseImageCalled = false
  wx.chooseImage = function () { chooseImageCalled = true }
  page._session.draft.photoPaths = ['/user-data/a.jpg', '/user-data/b.jpg', '/user-data/c.jpg']
  page.onUploadPhoto()
  assert.strictEqual(chooseImageCalled, false,
    'the chat page must enforce the three-photo limit across confirmed and pending batches')

  console.log('chat page tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
