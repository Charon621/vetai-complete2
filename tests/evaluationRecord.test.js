const assert = require('assert'), fields = require('../utils/recordEvidence').fields
const raw = { responseStatus: 'clinical_abstain', abstainReason: '需要重拍', evidenceFor: ['红斑'], evidenceAgainst: [], missingInformation: ['近照'], recommendedTests: ['现场检查'], traceReference: 'offline-trace:test', rawResponse: 'PRIVATE', apiKey: 'SECRET' }
const record = fields(raw), serialized = JSON.stringify(record)
assert(!serialized.includes('PRIVATE')); assert(!serialized.includes('SECRET')); assert.strictEqual(record.responseStatus, 'clinical_abstain')
const store = {}; global.wx = { getStorageSync(k) { return store[k] }, setStorageSync(k, v) { store[k] = v }, removeStorageSync(k) { delete store[k] } }
const storage = require('../utils/storage'), saved = storage.addRecord(Object.assign(record, { petType: '猫', imagePaths: [], diagnosis: '无法确定' }))
assert(saved); const recovered = storage.getAllRecords()[0]; assert.strictEqual(recovered.abstainReason, '需要重拍'); assert.deepStrictEqual(recovered.recommendedTests, ['现场检查'])
const huge = fields({ responseStatus: 'bad', recommendedTests: new Array(100).fill('x'.repeat(1000)), abstainReason: 'x'.repeat(5000) })
assert.strictEqual(huge.responseStatus, 'unknown'); assert.strictEqual(huge.recommendedTests.length, 24); assert(JSON.stringify(huge).length < 7000)
console.log('record evidence persistence and bounds passed')
