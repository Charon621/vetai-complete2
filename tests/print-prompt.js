const fs = require('fs')
const api = require('../utils/api')

const defaultPetInfo = {
  species: '犬',
  breed: '金毛',
  gender: '未知',
  age: '成年',
  weight: '',
  sterilized: '未知',
  allergy: '',
  medicalHistory: '',
  bodyPart: 'back',
  bodyPartLabel: '背部',
  complaint: '背部局部红肿、脱毛、瘙痒，有少量结痂。'
}

const scenarios = {
  default: defaultPetInfo,
  ringworm: Object.assign({}, defaultPetInfo, {
    species: '猫',
    breed: '田园猫',
    bodyPart: 'face',
    bodyPartLabel: '面部',
    complaint: '面部圆形脱毛，边界比较清楚，有鳞屑和断毛，多宠家庭。'
  }),
  oral: Object.assign({}, defaultPetInfo, {
    species: '犬',
    breed: '未知',
    bodyPart: 'other',
    bodyPartLabel: '口腔',
    complaint: '口腔内红肿，有一处溃疡和糜烂，吃东西疼。'
  })
}

function readPetInfoFromArg() {
  const arg = process.argv[2]
  if (!arg) return scenarios.default
  if (scenarios[arg]) return scenarios[arg]
  const file = arg
  const text = fs.readFileSync(file, 'utf8')
  return Object.assign({}, defaultPetInfo, JSON.parse(text))
}

const petInfo = readPetInfoFromArg()
const prompt = api.buildDebugPrompt(petInfo, petInfo.lesionBoxes || [])

console.log('===== SYSTEM PROMPT =====')
console.log(prompt.systemPrompt)
console.log('\n===== USER PROMPT =====')
console.log(prompt.userPrompt)
