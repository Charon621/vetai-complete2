var storage = require('../../utils/storage')
var imageUtil = require('../../utils/image')

var emptyForm = {
  petName: '', petType: '', petTypeLabel: '', breed: '',
  gender: '', genderLabel: '', age: '', ageLabel: '',
  weight: '', sterilized: '', sterilizedLabel: '',
  allergy: '', medicalHistory: '', avatar: ''
}

// 记录时间统一展示为「5 月 7 日」（BUG-UI53）
function formatShortDate(record) {
  var raw = (record && record.createdAt) || (record && record.timestamp) || ''
  var parsed = typeof raw === 'number' ? raw : Date.parse(String(raw))
  if (isNaN(parsed)) return ''
  var d = new Date(parsed)
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'
}

Page({
  data: {
    profiles: [],
    activeProfileId: '',
    showForm: false,
    editingId: '',
    // 聚焦字段 key，驱动 .is-focus（BUG-UI32）；formValid 驱动保存按钮禁用态（BUG-UI36）
    focusKey: '',
    formValid: false,
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
        // BUG-UI53：原先直接拼 timestamp（形如 2025/5/7 14:33:41），秒级时间无意义
        // 且会被两行截断；统一成「5 月 7 日」，与详情页的展示口径一致。
        lastRecordText: lastRecord ? ((lastRecord.disease || lastRecord.primaryDiagnosis || '初筛报告') + '，' + formatShortDate(lastRecord)) : ''
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
    this._syncFormValid()
  },

  // BUG-UI33：showCreateForm 一直是「跳对话页建档」，抽屉里的新建分支永久不可达；
  // 抽屉只保留编辑语义，新建统一走对话建档。
  hideCreateForm: function () {
    this.setData({ showForm: false, editingId: '', focusKey: '', form: Object.assign({}, emptyForm) })
  },

  // BUG-UI35：遮罩/关闭按钮原先直接丢弃已填内容（既往病史上限 300 字），
  // 同一应用删一条记录都要二次确认，这里补脏检查。
  _isFormDirty: function () {
    var form = this.data.form
    var keys = Object.keys(emptyForm)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      if ((form[k] || '') !== (emptyForm[k] || '')) return true
    }
    return false
  },

  onDrawerClose: function () {
    var self = this
    if (!this._isFormDirty()) {
      this.hideCreateForm()
      return
    }
    wx.showModal({
      title: '放弃修改？',
      content: '已填写的内容不会保存。',
      confirmText: '放弃',
      confirmColor: '#9C3A25',
      success: function (res) {
        if (res.confirm) self.hideCreateForm()
      }
    })
  },

  onDrawerMaskTap: function () {
    this.onDrawerClose()
  },

  // BUG-UI32：WXSS 的 :focus 支持不可靠，聚焦态改由数据驱动
  onFieldFocus: function (e) {
    var key = e.currentTarget.dataset.key || ''
    if (key) this.setData({ focusKey: key })
  },

  onFieldBlur: function () {
    if (this.data.focusKey) this.setData({ focusKey: '' })
  },

  // 保存按钮禁用态：四个必填项齐了才可点（BUG-UI36）
  _syncFormValid: function () {
    var form = this.data.form
    var valid = !!(form.petName && form.petType && form.gender && form.age)
    if (valid !== this.data.formValid) this.setData({ formValid: valid })
  },

  onInput: function (e) {
    this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value })
    this._syncFormValid()
  },

  onPetTypeTap: function (e) {
    var item = this.data.petTypeOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.petType': item.value, 'form.petTypeLabel': item.label })
    this._syncFormValid()
  },

  onGenderTap: function (e) {
    var item = this.data.genderOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.gender': item.value, 'form.genderLabel': item.label })
    this._syncFormValid()
  },

  onAgeTap: function (e) {
    var item = this.data.ageOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ 'form.age': item.value, 'form.ageLabel': item.label })
    this._syncFormValid()
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
        var tempPath = res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!tempPath) return
        wx.compressImage({
          src: tempPath,
          quality: 60,
          success: function (cres) { self._saveAvatarFile(cres.tempFilePath) },
          fail: function () { self._saveAvatarFile(tempPath) }
        })
      },
      fail: function (err) {
        // 取消静默；权限拒绝等其他失败给出提示
        var errText = (err && err.errMsg) || ''
        if (errText.indexOf('cancel') >= 0) return
        wx.showToast({ title: '无法打开相册或相机', icon: 'none' })
      }
    })
  },

  // BUG-H5：头像此前直接把 chooseMedia/compressImage 的临时路径写进档案并随
  // saveProfile 持久化，微信临时文件在会话结束后被回收，下次启动头像变裂图。
  // 改为经 saveImagePermanent 落盘到 vetai_saved（与 user 页换头像的
  // prepareImages({savePermanent:true}) 最终链路一致）；落盘失败时退回临时
  // 路径，保证本次会话内仍可预览。cleanupStaleImages 按引用保护 avatar 字段，
  // 换头像后被替换的旧文件会在 7 天后自动回收。
  _saveAvatarFile: function (path) {
    var self = this
    imageUtil.saveImagePermanent(path).then(function (saved) {
      self.setData({ 'form.avatar': (saved && saved.path) || path })
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

    // BUG-UI33：抽屉只服务编辑（新建走对话建档），原先的 addPetProfile 分支已不可达
    var result = storage.updatePetProfile(this.data.editingId, profileData)
    if (!result) {
      wx.showToast({ title: '档案更新失败', icon: 'none' })
      this.loadProfiles()
      return
    }
    wx.showToast({ title: '已更新', icon: 'success' })

    this.setData({ showForm: false, editingId: '', focusKey: '', form: Object.assign({}, emptyForm) })
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
      confirmColor: '#9C3A25',
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
