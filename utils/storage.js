var config = require('./config')

var RECORDS_KEY = 'pet_diagnosis_history'
var PROFILES_KEY = 'pet_profiles'
var ACTIVE_PROFILE_KEY = 'active_pet_profile_id'
var USER_KEY = 'vetai_current_user'
var KNOWN_USERS_KEY = 'vetai_known_users'

// 条数上限统一收口到 utils/config.js，兜底值与原定义保持一致
var MAX_RECORDS = config.MAX_RECORDS || 80
var MAX_PROFILES = config.MAX_PROFILES || 20

function safeGet(key, fallback) {
  try {
    return wx.getStorageSync(key) || fallback
  } catch (e) {
    return fallback
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.error('[VetAI] storage save failed:', key, e)
  }
}

function createId(prefix) {
  return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function nowMs() {
  return Date.now()
}

// ============================================================
// 本机数据空间管理（支持多个本机昵称空间）
// ============================================================

function getKnownUsers() {
  return safeGet(KNOWN_USERS_KEY, [])
}

function saveKnownUsers(users) {
  safeSet(KNOWN_USERS_KEY, users)
}

function getCurrentUser() {
  return safeGet(USER_KEY, null)
}

function getUserScope() {
  var user = getCurrentUser()
  return user && user.id ? user.id : 'guest'
}

function getCurrentSpaceInfo() {
  var user = getCurrentUser()
  var scopeId = getUserScope()
  return {
    id: scopeId,
    nickName: user && user.nickName ? user.nickName : '本机游客',
    isGuest: scopeId === 'guest',
    recordsKey: RECORDS_KEY + '_' + scopeId,
    profilesKey: PROFILES_KEY + '_' + scopeId
  }
}

function scopedKey(baseKey) {
  return baseKey + '_' + getUserScope()
}

function getCurrentUserLabel() {
  var user = getCurrentUser()
  return user && user.nickName ? user.nickName : '游客'
}

/**
 * 切换本机数据空间。只有显式传入已知空间 ID 时才恢复旧空间，避免同名昵称误入他人本机数据。
 */
function loginUser(profile) {
  profile = profile || {}
  var nickName = (profile.nickName || '').trim() || '微信用户'

  var knownUsers = getKnownUsers()
  var existing = null
  if (profile.id) {
    for (var i = 0; i < knownUsers.length; i++) {
      if (knownUsers[i].id === profile.id) {
        existing = knownUsers[i]
        break
      }
    }
  }

  var user
  if (existing) {
    // 恢复已有空间 ID，这样切回同一空间能访问原来的数据
    user = {
      id: existing.id,
      nickName: nickName,
      avatarUrl: profile.avatarUrl || existing.avatarUrl || '',
      loginAt: nowText()
    }
    existing.nickName = nickName
    existing.avatarUrl = user.avatarUrl
    saveKnownUsers(knownUsers)
  } else {
    user = {
      id: profile.id || createId('user_'),
      nickName: nickName,
      avatarUrl: profile.avatarUrl || '',
      loginAt: nowText()
    }
    knownUsers.push({ id: user.id, nickName: nickName, avatarUrl: user.avatarUrl })
    saveKnownUsers(knownUsers)
  }

  safeSet(USER_KEY, user)
  return user
}

function logoutUser() {
  wx.removeStorageSync(USER_KEY)
}

// 更新当前本机空间用户的昵称/头像（BUG-C9：此前建好空间后无法改名换头像）。
// 空间 ID 保持不变，记录/档案数据不受影响；knownUsers 列表同步更新。
function updateUser(profile) {
  profile = profile || {}
  var user = getCurrentUser()
  if (!user) return null
  var next = {}
  for (var k in user) {
    if (Object.prototype.hasOwnProperty.call(user, k)) next[k] = user[k]
  }
  if (profile.nickName !== undefined) {
    next.nickName = String(profile.nickName).trim() || user.nickName
  }
  if (profile.avatarUrl !== undefined) next.avatarUrl = profile.avatarUrl
  next.loginAt = nowText()
  var knownUsers = getKnownUsers()
  for (var i = 0; i < knownUsers.length; i++) {
    if (knownUsers[i].id === next.id) {
      knownUsers[i].nickName = next.nickName
      knownUsers[i].avatarUrl = next.avatarUrl
      break
    }
  }
  saveKnownUsers(knownUsers)
  safeSet(USER_KEY, next)
  return next
}

// ============================================================
// 问诊记录
// ============================================================

function getAllRecords() {
  return safeGet(scopedKey(RECORDS_KEY), [])
}

/**
 * 添加问诊记录
 * @param {object} data  记录数据，可包含 imagePath / imagePaths（持久化后的路径）
 */
function addRecord(data) {
  var records = getAllRecords()
  var createdAt = nowMs()
  var timestamp = nowText()
  var record = {
    id: '',
    ownerId: getUserScope(),
    ownerName: getCurrentUserLabel(),
    createdAt: createdAt,
    timestamp: timestamp,
    dateStr: timestamp
  }
  // 合并数据（data 里的字段覆盖默认值）
  var keys = Object.keys(data)
  for (var i = 0; i < keys.length; i++) {
    record[keys[i]] = data[keys[i]]
  }
  // 系统字段一律由本模块重设，不允许被调用方数据覆盖（BUG-K4）。
  // 之前只重置 id/ownerId/createdAt，timestamp/dateStr 仍可被调用方注入，
  // 会污染历史排序与时间展示；这里统一重设，并把晦涩的 id 三元式改为显式赋值。
  record.id = createId()
  record.ownerId = getUserScope()
  record.ownerName = getCurrentUserLabel()
  record.createdAt = createdAt
  record.timestamp = timestamp
  record.dateStr = timestamp

  records.unshift(record)
  // 超出上限丢弃最旧的
  if (records.length > MAX_RECORDS) {
    records = records.slice(0, MAX_RECORDS)
  }
  safeSet(scopedKey(RECORDS_KEY), records)

  if (data.profileId) {
    touchPetProfile(data.profileId)
  }

  return record
}

function getRecordById(id) {
  return getAllRecords().find(function (item) { return item.id === id }) || null
}

function getHistory() {
  return getAllRecords()
}

function deleteRecord(id) {
  safeSet(scopedKey(RECORDS_KEY), getAllRecords().filter(function (item) { return item.id !== id }))
}

function clearHistory() {
  wx.removeStorageSync(scopedKey(RECORDS_KEY))
}

/**
 * 清空当前空间全部档案（一次性移除 key，避免逐个删除的 O(n²) 读写，BUG-K5）
 */
function clearProfiles() {
  wx.removeStorageSync(scopedKey(PROFILES_KEY))
  wx.removeStorageSync(scopedKey(ACTIVE_PROFILE_KEY))
}

// ============================================================
// 反馈闭环（新增）
// ============================================================

/**
 * 为记录添加反馈数据
 * @param {string} recordId
 * @param {object} feedback { helpful: bool, wentToVet: bool|null, vetDiagnosis: string, notes: string }
 */
function addFeedback(recordId, feedback) {
  var records = getAllRecords()
  var found = false
  var updated = records.map(function (item) {
    if (item.id !== recordId) return item
    found = true
    var copy = Object.assign({}, item)
    copy.feedback = Object.assign({}, copy.feedback || {}, feedback)
    copy.feedbackAt = nowText()
    return copy
  })
  if (!found) return null
  safeSet(scopedKey(RECORDS_KEY), updated)
  return updated.find(function (r) { return r.id === recordId })
}

/**
 * 获取带反馈的记录
 */
function getRecordsWithFeedback() {
  return getAllRecords().filter(function (r) { return r.feedback })
}

// ============================================================
// 宠物档案（加上限 MAX_PROFILES）
// ============================================================

function getPetProfiles() {
  return safeGet(scopedKey(PROFILES_KEY), [])
}

function getPetProfileById(id) {
  return getPetProfiles().find(function (item) { return item.id === id }) || null
}

function getActiveProfileId() {
  return safeGet(scopedKey(ACTIVE_PROFILE_KEY), '')
}

function setActiveProfileId(id) {
  safeSet(scopedKey(ACTIVE_PROFILE_KEY), id || '')
}

function addPetProfile(data) {
  var profiles = getPetProfiles()
  if (profiles.length >= MAX_PROFILES) {
    return { error: '档案数量已达上限（' + MAX_PROFILES + ' 个），请先删除不用的档案' }
  }

  var timestamp = nowText()
  var profile = {
    id: createId(),
    ownerId: getUserScope(),
    avatar: data.avatar || '',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp
  }
  var keys = Object.keys(data)
  for (var i = 0; i < keys.length; i++) {
    profile[keys[i]] = data[keys[i]]
  }
  profile.id = profile.id || createId()

  profiles.unshift(profile)
  safeSet(scopedKey(PROFILES_KEY), profiles)
  setActiveProfileId(profile.id)
  return profile
}

/**
 * 更新宠物档案
 * @returns {object|null}  更新后的档案，如果 id 不存在则返回 null
 */
function updatePetProfile(id, data) {
  var timestamp = nowText()
  var found = false
  var updated = null
  var profiles = getPetProfiles().map(function (item) {
    if (item.id !== id) return item
    found = true
    updated = {}
    // 保留原字段
    var origKeys = Object.keys(item)
    for (var k = 0; k < origKeys.length; k++) {
      updated[origKeys[k]] = item[origKeys[k]]
    }
    // 覆盖新字段
    var dataKeys = Object.keys(data)
    for (var j = 0; j < dataKeys.length; j++) {
      updated[dataKeys[j]] = data[dataKeys[j]]
    }
    updated.id = id
    updated.updatedAt = timestamp
    return updated
  })

  if (!found) {
    console.warn('[VetAI] updatePetProfile: id not found:', id)
    return null
  }

  safeSet(scopedKey(PROFILES_KEY), profiles)
  return updated
}

function touchPetProfile(id) {
  var timestamp = nowText()
  var profiles = getPetProfiles().map(function (item) {
    return item.id === id ? Object.assign({}, item, { lastUsedAt: timestamp }) : item
  })
  safeSet(scopedKey(PROFILES_KEY), profiles)
  setActiveProfileId(id)
}

function deletePetProfile(id) {
  safeSet(scopedKey(PROFILES_KEY), getPetProfiles().filter(function (item) { return item.id !== id }))
  if (getActiveProfileId() === id) {
    var next = getPetProfiles()[0]
    setActiveProfileId(next ? next.id : '')
  }
}

module.exports = {
  addRecord: addRecord,
  getRecordById: getRecordById,
  getAllRecords: getAllRecords,
  getHistory: getHistory,
  deleteRecord: deleteRecord,
  clearHistory: clearHistory,
  updateUser: updateUser,
  clearProfiles: clearProfiles,
  addFeedback: addFeedback,
  getRecordsWithFeedback: getRecordsWithFeedback,
  getPetProfiles: getPetProfiles,
  getPetProfileById: getPetProfileById,
  getActiveProfileId: getActiveProfileId,
  setActiveProfileId: setActiveProfileId,
  addPetProfile: addPetProfile,
  updatePetProfile: updatePetProfile,
  touchPetProfile: touchPetProfile,
  deletePetProfile: deletePetProfile,
  getCurrentUser: getCurrentUser,
  getUserScope: getUserScope,
  getCurrentSpaceInfo: getCurrentSpaceInfo,
  getCurrentUserLabel: getCurrentUserLabel,
  loginUser: loginUser,
  logoutUser: logoutUser,
  getKnownUsers: getKnownUsers,
  MAX_PROFILES: MAX_PROFILES,
  MAX_RECORDS: MAX_RECORDS
}
