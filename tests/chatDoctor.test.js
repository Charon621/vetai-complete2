const assert = require('assert')

let storedDraft = null
global.wx = {
  getStorageSync: function () { return storedDraft },
  setStorageSync: function (key, value) { storedDraft = value },
  removeStorageSync: function () { storedDraft = null }
}

const api = require('../utils/api')
const chatDoctor = require('../utils/chatDoctor')

async function run() {
  let calls = []
  api.chatAI = function (messages, options) {
    calls.push({ messages: messages, options: options })
    if (options && options.response_format) {
      return Promise.resolve({
        success: true,
        text: JSON.stringify({
          petName: '奶糖', petType: 'cat', gender: 'male', age: 'adult', breed: '英短', weight: '4.5'
        })
      })
    }
    return Promise.resolve({ success: true, text: '好的，今天奶糖的皮肤怎么了？' })
  }

  let session = chatDoctor.createNewSession()
  let result = await chatDoctor.processUserInput(session, '奶糖，英短公猫，3岁，4.5公斤', null)
  assert.strictEqual(result.session.phase, chatDoctor.PHASE.COMPLAINT, 'complete profile should enter complaint phase')
  assert.strictEqual(result.session.draft.petName, '奶糖')
  assert.strictEqual(result.session.draft.petType, 'cat')
  assert.strictEqual(result.session.draft.gender, 'male')
  assert.strictEqual(result.session.draft.age, 'adult')
  assert.strictEqual(calls.length, 2, 'profile input should use one extraction and one response call')

  // 用户提前上传照片后补充主诉，应直接进入分析，不再重复索要照片。
  calls = []
  session.phase = chatDoctor.PHASE.COMPLAINT
  session.draft.photoPaths = ['wxfile://lesion.jpg']
  session.draft.photoBase64s = ['data:image/jpeg;base64,AAAA']
  api.chatAI = function () {
    calls.push(true)
    return Promise.resolve({
      success: true,
      text: JSON.stringify({
        complaint: '耳朵发红瘙痒3天', bodyPart: 'ears', symptoms: ['itching', 'redness'], duration: '3天'
      })
    })
  }
  result = await chatDoctor.processUserInput(session, '耳朵发红瘙痒3天', null)
  assert.strictEqual(result.session.phase, chatDoctor.PHASE.ANALYZING, 'existing photo plus complaint should start analysis')
  assert.strictEqual(result.session.draft.bodyPart, 'ears')
  assert.deepStrictEqual(result.session.draft.symptoms, ['itching', 'redness'])
  assert.strictEqual(calls.length, 1, 'complaint-to-analysis should only extract once')

  // 诊断后的追问只需生成回答，不应先做一次无用的信息提取。
  calls = []
  session.phase = chatDoctor.PHASE.FOLLOW_UP
  session.draft.diagnosisResult = { success: true, data: { primaryDiagnosis: '外耳炎' } }
  api.chatAI = function () {
    calls.push(true)
    return Promise.resolve({ success: true, text: '先保持耳道干燥，不要自行使用人用滴耳液。' })
  }
  result = await chatDoctor.processUserInput(session, '现在能洗澡吗？', null)
  assert.strictEqual(calls.length, 1, 'follow-up should make exactly one model call')
  assert.ok(result.doctorMsg.text.indexOf('保持耳道干燥') >= 0)

  // 模型不可用时，基础信息和主诉仍可由本地规则推进，避免对话完全卡死。
  api.chatAI = function () { return Promise.resolve({ success: false, error: 'offline' }) }
  session = chatDoctor.createNewSession()
  result = await chatDoctor.processUserInput(session, '我家宠物叫奶糖，是只3岁公猫', null)
  assert.strictEqual(result.session.phase, chatDoctor.PHASE.COMPLAINT, 'local fallback should parse common profile wording')
  assert.strictEqual(result.session.draft.petName, '奶糖')
  assert.strictEqual(result.session.draft.petType, 'cat')
  assert.strictEqual(result.session.draft.gender, 'male')
  assert.strictEqual(result.session.draft.age, 'adult')

  result.session.draft.photoPaths = []
  result = await chatDoctor.processUserInput(result.session, '背上发红掉毛，已经3天了', null)
  assert.strictEqual(result.session.phase, chatDoctor.PHASE.PHOTO, 'local complaint fallback should reach photo phase')
  assert.strictEqual(result.session.draft.bodyPart, 'back')
  assert.ok(result.session.draft.symptoms.indexOf('redness') >= 0)
  assert.ok(result.session.draft.symptoms.indexOf('hair_loss') >= 0)

  // 草稿保存应保留消息历史，但不得把 base64 图片写入本地存储。
  storedDraft = null
  session.messages = [
    {
      id: 'm1', role: 'user', text: '看看照片',
      image: 'data:image/jpeg;base64,AAAA',
      images: ['data:image/jpeg;base64,BBBB', 'wxfile://safe.jpg']
    },
    { id: 'm2', role: 'doctor', text: '收到', images: [] }
  ]
  session.draft.photoBase64s = ['data:image/jpeg;base64,CCCC']
  session.draft.photoPaths = ['data:image/jpeg;base64,DDDD', 'wxfile://safe.jpg']
  session.draft.lesionBoxes = [{ x: 0.1 }, { x: 0.2 }]
  chatDoctor.saveDraft(session)
  assert.ok(storedDraft, 'draft should be saved')
  assert.strictEqual(storedDraft.messages.length, 2, 'conversation history should be persisted')
  assert.deepStrictEqual(storedDraft.messages[0].images, ['wxfile://safe.jpg'])
  assert.strictEqual(storedDraft.messages[0].image, '')
  assert.deepStrictEqual(storedDraft.draft.photoBase64s, [])
  assert.deepStrictEqual(storedDraft.draft.photoPaths, ['wxfile://safe.jpg'])
  assert.deepStrictEqual(storedDraft.draft.lesionBoxes, [{ x: 0.2 }])

  const petInfo = chatDoctor.buildPetInfoForDiagnose(session.draft)
  assert.strictEqual(petInfo.useKnowledgeBase, true, 'chat diagnosis must explicitly enable the knowledge base')

  storedDraft = {
    phase: chatDoctor.PHASE.RESULT,
    draft: Object.assign({}, session.draft, {
      petName: '奶糖',
      diagnosisResult: { success: true, data: { primaryDiagnosis: '外耳炎' } }
    }),
    messages: session.messages
  }
  let restored = chatDoctor.initSession()
  assert.strictEqual(restored.restored, true)
  assert.strictEqual(restored.session.phase, chatDoctor.PHASE.FOLLOW_UP,
    'successful result interrupted during restore should remain interactive')

  storedDraft.phase = chatDoctor.PHASE.RESULT
  storedDraft.draft.diagnosisResult = { success: false, error: 'timeout' }
  restored = chatDoctor.initSession()
  assert.strictEqual(restored.session.phase, chatDoctor.PHASE.PHOTO,
    'failed result interrupted during restore should allow a photo retry')

  console.log('chatDoctor tests passed')
}

run().catch(function (err) {
  console.error(err)
  process.exit(1)
})
