var storage = require('../../utils/storage')
var analytics = require('../../utils/analytics')

function recentText(records) {
  if (!records || !records.length) return '--'
  var raw = records[0].timestamp || records[0].dateStr || ''
  var parsed = Date.parse(String(raw))
  if (!isNaN(parsed)) {
    var d = new Date(parsed)
    return (d.getMonth() + 1) + '/' + d.getDate()
  }
  return '最近'
}

Page({
  data: {
    user: null,
    profilesCount: 0,
    recordsCount: 0,
    feedbackCount: 0,
    currentSpaceId: 'guest',
    currentSpaceName: '本机访客',
    knownUsersCount: 0,
    storageModeText: '仅本机保存',
    recentText: '--',
    isDarkMode: false,
    appVersion: '2.0',
    expandedSection: null
  },

  onLoad: function () {
    var app = getApp()
    this.setData({ isDarkMode: app.isDarkMode() })
    this.loadUserData()
    this._loaded = true
  },

  onShow: function () {
    if (this._loaded) this.loadUserData()
    var app = getApp()
    this.setData({ isDarkMode: app.isDarkMode() })
  },

  loadUserData: function () {
    var user = storage.getCurrentUser()
    var space = storage.getCurrentSpaceInfo()
    var knownUsers = storage.getKnownUsers()
    var records = storage.getHistory()
    this.setData({
      user: user ? Object.assign({}, user, {
        avatarText: user.nickName ? user.nickName.slice(0, 1) : '我'
      }) : null,
      currentSpaceId: space.id,
      currentSpaceName: space.nickName,
      knownUsersCount: knownUsers.length,
      storageModeText: space.isGuest ? '访客空间，仅保存在本机' : '本机昵称空间，仅保存在本机',
      profilesCount: storage.getPetProfiles().length,
      recordsCount: records.length,
      feedbackCount: storage.getRecordsWithFeedback().length,
      recentText: recentText(records)
    })
  },

  switchSpace: function () {
    var self = this
    var knownUsers = storage.getKnownUsers()
    var items = ['新建本机空间', '切回本机访客'].concat(knownUsers.map(function (u) {
      return u.nickName || '未命名空间'
    }))
    wx.showActionSheet({
      itemList: items,
      success: function (res) {
        if (res.tapIndex === 0) {
          self.showNicknameInput()
          return
        }
        if (res.tapIndex === 1) {
          storage.logoutUser()
          self.loadUserData()
          wx.showToast({ title: '已切回访客', icon: 'success' })
          return
        }
        var selected = knownUsers[res.tapIndex - 2]
        if (!selected) return
        storage.loginUser({ nickName: selected.nickName, id: selected.id, avatarUrl: selected.avatarUrl || '' })
        self.loadUserData()
        wx.showToast({ title: '已切换空间', icon: 'success' })
      }
    })
  },

  login: function () {
    this.switchSpace()
  },

  showNicknameInput: function () {
    var self = this
    wx.showModal({
      title: '设置本机空间',
      content: '输入一个昵称，用来区分本机上的不同数据空间。不是账号登录，也不会同步到云端。',
      editable: true,
      placeholderText: '例如：我的手机',
      confirmText: '保存',
      success: function (res) {
        if (!res.confirm) return
        var nickName = (res.content || '').trim() || '本机用户'
        storage.loginUser({ nickName: nickName })
        self.loadUserData()
        wx.showToast({ title: '已保存', icon: 'success' })
      }
    })
  },

  logout: function () {
    var self = this
    wx.showModal({
      title: '切回本机访客',
      content: '将切回默认本机访客空间。其他本机空间的数据仍保留在设备中。',
      confirmText: '切换',
      confirmColor: '#c76f5a',
      success: function (res) {
        if (!res.confirm) return
        storage.logoutUser()
        self.loadUserData()
      }
    })
  },

  showStorageHelp: function () {
    var space = storage.getCurrentSpaceInfo()
    wx.showModal({
      title: '隐私与数据',
      content: '当前空间：' + space.nickName +
        '\n空间 ID：' + space.id +
        '\n记录 Key：' + space.recordsKey +
        '\n档案 Key：' + space.profilesKey +
        '\n\n当前版本没有云端账号；记录和档案只按本机空间分开保存，换手机或重装后不会同步。',
      showCancel: false
    })
  },

  toggleSection: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({
      expandedSection: this.data.expandedSection === key ? null : key
    })
  },

  exportData: function () {
    var records = storage.getHistory()
    var profiles = storage.getPetProfiles()
    var data = JSON.stringify({ profiles: profiles, records: records, exportedAt: new Date().toISOString() }, null, 2)
    wx.setClipboardData({
      data: data,
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
        analytics.track('export', { records: records.length, profiles: profiles.length })
      }
    })
  },

  clearData: function () {
    var self = this
    wx.showModal({
      title: '清除数据',
      content: '将删除当前本机空间的全部记录、档案和反馈数据。此操作不可恢复。',
      confirmText: '清除',
      confirmColor: '#b3261e',
      success: function (res) {
        if (!res.confirm) return
        storage.clearHistory()
        var profiles = storage.getPetProfiles()
        profiles.forEach(function (p) { storage.deletePetProfile(p.id) })
        analytics.clearEvents()
        self.loadUserData()
        wx.showToast({ title: '已清除', icon: 'success' })
      }
    })
  },

  goProfiles: function () {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goRecords: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  }
})
