const assert = require('assert')

const localStore = {}
const calls = []
let featureResponse = {
  visualFeatures: ['圆形脱毛', '鳞屑', '断毛', '结痂'],
  bodyPartGuess: '面部',
  lesionPattern: '环形',
  lesionShape: '圆形',
  shortObservation: '面部圆形脱毛，伴鳞屑、断毛和结痂',
  quality: 'clear',
  diagnosabilityScore: 92,
  diagnosabilityReason: '光线和对焦清晰'
}

function modelResponse(data) {
  return {
    result: {
      success: true,
      data: {
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { total_tokens: 100 }
      }
    }
  }
}

global.wx = {
  getStorageSync: function (key) { return localStore[key] },
  setStorageSync: function (key, value) { localStore[key] = value },
  cloud: {
    callFunction: function (options) {
      calls.push(options.data)
      if (options.data.phase === 'vision-precheck') {
        options.success(modelResponse(featureResponse))
        return
      }
      options.success(modelResponse({
        observations: '面部可见圆形脱毛和鳞屑',
        primaryDiagnosis: '皮肤癣菌病（犬猫）',
        primaryDiagnosisProbability: 72,
        diagnosisCandidates: [{ name: '皮肤癣菌病（犬猫）', probability: 72, reason: '形态吻合' }],
        lesionNameCn: '环形脱毛斑',
        confidence: 72,
        explanation: '需要真菌检查确认',
        possibleMeaning: '存在感染可能',
        homeCare: '隔离并保持环境清洁',
        whenToWatch: '观察是否扩散',
        whenToSeeVet: '扩散或家人出现皮损时就医',
        careSuggestion: '避免自行用药',
        vetWarning: '建议进行真菌培养',
        urgency: 'moderate',
        ragSources: []
      }))
    }
  }
}

const api = require('../utils/api')

async function run() {
  const image = 'data:image/jpeg;base64,AAAA'
  const petInfo = {
    species: 'cat',
    bodyPart: 'head',
    bodyPartLabel: '面部',
    complaint: '圆形脱毛 鳞屑 断毛 结痂 多宠',
    modelProvider: 'qwen',
    useKnowledgeBase: true
  }

  let result = await api.diagnose([image], petInfo)
  assert.strictEqual(result.success, true, 'knowledge-enabled diagnosis should complete')
  assert.strictEqual(calls[0].phase, 'vision-precheck', 'knowledge mode should run visual precheck first')
  if (calls.some(function (call) { return call.phase === 'full-diagnosis' })) {
    const fullCall = calls.find(function (call) { return call.phase === 'full-diagnosis' })
    const prompt = fullCall.payload.messages[1].content[0].text
    assert.ok(prompt.indexOf('临床参考核对清单') >= 0,
      'weak fast-path result should still inject specific KB references into full diagnosis')
  } else {
    assert.ok(result.data._ragMatchName, 'fast KB path should expose the matched knowledge card')
    assert.ok(result.data._ragMatchScore > 0, 'fast KB path should expose a positive match score')
  }

  // 兼容旧模型响应：新增的可诊断性分数字段缺失时，不应把清晰图片误判为 0 分并拒绝分析。
  calls.length = 0
  featureResponse = {
    visualFeatures: ['圆形脱毛', '鳞屑', '断毛', '结痂'],
    bodyPartGuess: '面部',
    lesionPattern: '环形',
    lesionShape: '圆形',
    shortObservation: '面部圆形脱毛，伴鳞屑、断毛和结痂',
    quality: 'clear'
  }
  result = await api.diagnose([image], petInfo)
  assert.strictEqual(result.success, true, 'legacy clear precheck response should still complete')
  assert.notStrictEqual(result.data._isReject, true,
    'missing diagnosabilityScore must not reject an otherwise clear image')

  calls.length = 0
  result = await api.diagnose([image], Object.assign({}, petInfo, { useKnowledgeBase: false }))
  assert.strictEqual(result.success, true, 'knowledge-disabled diagnosis should still complete')
  assert.deepStrictEqual(calls.map(function (call) { return call.phase }), ['full-diagnosis'],
    'knowledge-disabled mode should skip visual RAG precheck')
  const noKbPrompt = calls[0].payload.messages[1].content[0].text
  assert.ok(noKbPrompt.indexOf('临床参考核对清单') < 0,
    'knowledge-disabled mode must not inject KB references')

  calls.length = 0
  const chatResult = await api.chatAI([{ role: 'user', content: '你好' }], {
    response_format: { type: 'json_object' }
  })
  assert.strictEqual(chatResult.success, true)
  assert.strictEqual(calls[0].phase, 'chat-ai')
  assert.deepStrictEqual(calls[0].payload.response_format, { type: 'json_object' })

  console.log('api integration tests passed')
}

run().catch(function (error) {
  console.error(error)
  process.exit(1)
})
