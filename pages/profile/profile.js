var storage = require('../../utils/storage')

var emptyForm = {
  petName: '', petType: '', petTypeLabel: '', breed: '',
  gender: '', genderLabel: '', age: '', ageLabel: '',
  weight: '', sterilized: '', sterilizedLabel: '',
  allergy: '', medicalHistory: '', avatar: ''
}

Page({
  data: {
    profiles: [],
    activeProfileId: '',
    showForm: false,
    editingId: '',
    form: Object.assign({}, emptyForm),
    petTypeOptions: [
      { value: 'dog', label: '犬' },
      { value: 'cat', label: '猫' },
      { value: 'rabbit', label: '兔' },
      { value: 'hamster', label: '仓鼠' },
      { value: 'bird', label: '鸟类' },
      { value: 'other', label: '其他' }
    ],
    genderOptions: [
      { value: 'male', label: '公' },
      { value: 'female', label: '母' },
      { value: 'unknown', label: '不确定' }
    ],
    ageOptions: [
      { value: 'baby', label: '幼年' },
      { value: 'adult', label: '成年' },
      { value: 'senior', label: '老年' },
      { value: 'unknown', label: '不确定' }
    ],
    sterilizedOptions: [
      { value: 'yes', label: '已绝育' },
      { value: 'no', label: '未绝育' },
      { value: 'unknown', label: '不确定' }
    ]
  },

  onLoad: function () {
    this.loadProfiles()
  },

  onShow: function () {
    if (this._loaded) this.loadProfiles()
    this._loaded = true
  },

  noop: function () {},

  loadProfiles: function () {
    var history = storage.getHistory()
    var profiles = storage.getPetProfiles().map(function (item) {
      var lastRecord = null
      for (var i = 0; i < history.length; i++) {
        // 只按 profileId 归属，不再用 petName 兜底：同名宠物会错配记录（BUG-K1）
        if (history[i] && history[i].profileId && item.id && history[i].profileId === item.id) {
          lastRecord = history[i]
          break
        }
      }
      return Object.assign({}, item, {
        avatarText: item.petName ? item.petName.slice(0, 1) : '宠',
        lastRecordText: lastRecord ? ((lastRecord.disease || lastRecord.primaryDiagnosis || '初筛报告') + '，' + (lastRecord.timestamp || '')) : ''
      })
    })
    this.setData({
      profiles: profiles,
      activeProfileId: storage.getActiveProfileId(),
      showForm: this.data.showForm
    })
  },

  showCreateForm: function () {
    // 设置标记，chat 页 onShow 检测到后开始新对话
    wx.setStorageSync('chat_start_new', true)
    wx.navigateTo({ url: '/pages/chat/chat' })
  },

  showEditForm: function (e) {
    var id = e.currentTarget.dataset.id
    var profile = storage.getPetProfileById(id)
    if (!profile) return
    this.setData({
      showForm: true,
      editingId: id,
      form: {
        petName: profile.petName || '',
        petType: profile.petType || '',
        petTypeLabel: profile.petTypeLabel || '',
        breed: profile.breed || '',
        gender: profile.gender || '',
        genderLabel: profile.genderLabel || '',
        age: profile.age || '',
        ageLabel: profile.ageLabel || '',
        weight: profile.weight || '',
        sterilized: profile.sterilized || '',
        sterilizedLabel: profile.sterilizedLabel || '',
        allergy: profile.allergy || '',
        medicalHistory: profile.medicalHistory || '',
        avatar: profile.avatar || ''
      }
    })
  },

  hideCreateForm: function () {
    this.setData({ showForm: false, editingId: '', form: Object.assign({}, emptyForm) })
  },

  onInput: function (e) {
    this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value })
  },

  onPetTypeTap: function (e) {
    var item = this.data.petTypeOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.petType': item.value, 'form.petTypeLabel': item.label })
  },

  onGenderTap: function (e) {
    var item = this.data.genderOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.gender': item.value, 'form.genderLabel': item.label })
  },

  onAgeTap: function (e) {
    var item = this.data.ageOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.age': item.value, 'form.ageLabel': item.label })
  },

  onSterilizedChange: function (e) {
    var item = this.data.sterilizedOptions[parseInt(e.detail.value)]
    if (!item) return
    this.setData({ 'form.sterilized': item.value, 'form.sterilizedLabel': item.label })
  },

  chooseAvatar: function () {
    var self = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function (res) {
        var tempPath = res.tempFiles[0].tempFilePath
        wx.compressImage({
          src: tempPath,
          quality: 60,
          success: function (cres) { self.setData({ 'form.avatar': cres.tempFilePath }) },
          fail: function () { self.setData({ 'form.avatar': tempPath }) }
        })
      }
    })
  },

  removeAvatar: function () {
    this.setData({ 'form.avatar': '' })
  },

  saveProfile: function () {
    var form = this.data.form
    if (!form.petName || !form.petType || !form.gender || !form.age) {
      wx.showToast({ title: '请填写名字、种类、性别和年龄', icon: 'none' })
      return
    }
    var weight = form.weight.trim()
    if (weight) {
      var w = parseFloat(weight)
      if (isNaN(w) || w <= 0 || w > 200) {
        wx.showToast({ title: '体重请输入 0-200 之间的数字', icon: 'none' })
        return
      }
    }
    var profileData = Object.assign({}, form, {
      petName: form.petName.trim(),
      breed: form.breed.trim(),
      weight: form.weight.trim(),
      allergy: form.allergy.trim(),
      medicalHistory: form.medicalHistory.trim()
    })

    if (this.data.editingId) {
      var result = storage.updatePetProfile(this.data.editingId, profileData)
      if (!result) {
        wx.showToast({ title: '档案更新失败', icon: 'none' })
        this.loadProfiles()
        return
      }
      wx.showToast({ title: '已更新', icon: 'success' })
    } else {
      var profile = storage.addPetProfile(profileData)
      if (profile.error) {
        wx.showToast({ title: profile.error, icon: 'none' })
        return
      }
      this.setData({ activeProfileId: profile.id })
      wx.showToast({ title: '已创建', icon: 'success' })
    }

    this.setData({ showForm: false, editingId: '', form: Object.assign({}, emptyForm) })
    this.loadProfiles()
  },

  selectProfile: function (e) {
    var id = e.currentTarget.dataset.id
    storage.setActiveProfileId(id)
    this.setData({ activeProfileId: id })
    wx.showToast({ title: '已选择档案', icon: 'success' })
    setTimeout(function () {
      if (getCurrentPages().length > 1) wx.navigateBack()
    }, 350)
  },

  deleteProfile: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除档案',
      content: '删除后不会删除已有问诊记录，但首页不再使用这个档案。',
      confirmText: '删除',
      confirmColor: '#c76f5a',
      success: function (res) {
        if (!res.confirm) return
        storage.deletePetProfile(id)
        self.loadProfiles()
      }
    })
  },

  goBack: function () {
    wx.navigateBack()
  }
})
