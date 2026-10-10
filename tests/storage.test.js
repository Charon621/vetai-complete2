const assert = require('assert')

const data = {}
global.wx = {
  getStorageSync: function (key) { return data[key] },
  setStorageSync: function (key, value) { data[key] = value },
  removeStorageSync: function (key) { delete data[key] }
}

const storage = require('../utils/storage')

const guestRecord = storage.addRecord({ petName: '游客宠物', disease: '测试记录' })
assert.strictEqual(storage.getHistory().length, 1)
assert.strictEqual(storage.getRecordById(guestRecord.id).ownerId, 'guest')

const user = storage.loginUser({ nickName: '测试用户' })
assert.ok(user.id)
assert.strictEqual(storage.getHistory().length, 0, 'new user space should not leak guest records')

const profile = storage.addPetProfile({ petName: '奶糖', petType: 'cat' })
assert.ok(profile.id)
assert.strictEqual(storage.getActiveProfileId(), profile.id)
assert.strictEqual(storage.getPetProfileById(profile.id).petName, '奶糖')

const updated = storage.updatePetProfile(profile.id, { petName: '奶糖二号', weight: '4.5' })
assert.strictEqual(updated.petName, '奶糖二号')
assert.strictEqual(storage.getPetProfileById(profile.id).weight, '4.5')

const userRecord = storage.addRecord({ profileId: profile.id, petName: '奶糖二号', disease: '外耳炎' })
assert.strictEqual(storage.getHistory().length, 1)
const feedbackRecord = storage.addFeedback(userRecord.id, { helpful: true, notes: '方向一致' })
assert.strictEqual(feedbackRecord.feedback.helpful, true)
assert.strictEqual(storage.getRecordsWithFeedback().length, 1)

storage.logoutUser()
assert.strictEqual(storage.getHistory().length, 1, 'logout should return to isolated guest history')
assert.strictEqual(storage.getHistory()[0].id, guestRecord.id)

storage.loginUser({ id: user.id, nickName: '测试用户' })
assert.strictEqual(storage.getHistory()[0].id, userRecord.id, 'known local space should be restorable by id')
assert.strictEqual(storage.getPetProfileById(profile.id).petName, '奶糖二号')

storage.deletePetProfile(profile.id)
assert.strictEqual(storage.getPetProfileById(profile.id), null)
assert.strictEqual(storage.getActiveProfileId(), '')

storage.deleteRecord(userRecord.id)
assert.strictEqual(storage.getHistory().length, 0)

console.log('storage tests passed')
