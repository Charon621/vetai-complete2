var api = require('../../utils/api')
var config = require('../../utils/config')
var storage = require('../../utils/storage')
var imageUtil = require('../../utils/image')
var analytics = require('../../utils/analytics')
var greetingUtil = require('../../utils/greeting')

var IMAGE_ROLES = [
  { value: '', label: '' },
  { value: 'overview', label: '整体' },
  { value: 'closeup', label: '近景' },
  { value: 'reference', label: '参照' }
]

// 上传照片上限统一读配置，与聊天页保持一致（BUG-C3）
var MAX_IMAGES = config.MAX_IMAGES || 5

var URGENCY_STATUS = {
  low: '居家观察',
  moderate: '建议尽快复查',
  urgent: '建议尽快就诊',
  emergency: '需立即就医'
}

var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

var URGENCY_CARE = {
  low: '按报告建议居家护理，症状有变化随时再拍一张对比',
  moderate: '按报告建议护理患处，观察症状有没有减轻',
  urgent: '尽快安排就诊，就诊前保持患处清洁干燥',
  emergency: '请立即就医，途中避免让TA抓挠患处'
}

Page({
  data: {
    step: 'home',
    todayText: '',
    greeting: null,
    profiles: [],
    displayProfiles: [],
    hasSelectedPet: false,
    selectedPetName: '',
    selectedPetInitial: '',
    selectedProfileId: '',
    selectedBreed: '',
    lastCheck: null,
    imagePaths: [],
    imageRoles: [],
    imageQualityFlags: [],
    lesionBoxes: [],
    previewItems: [],
    canAddMore: true,
    bodyPart: '',
    bodyPartLabel: '',
    complaint: '',
    quickPetType: '',
    quickPetTypeLabel: '',
    quickGender: '',
    quickGenderLabel: '',
    quickAge: '',
    quickAgeLabel: '',
    modelProvider: 'qwen',
    modelProviderLabel: 'Qwen3.8-Flash',
    useKnowledgeBase: config.USE_KNOWLEDGE_BASE !== false,
    isAnalyzing: false,
    analyzingStep: 0,
    analyzingStepText: '正在识别皮损特征...',
    progressText: '',
    canSubmitActive: false,
    selectorVisible: false,
    selectorImageIndex: -1,
    selectorImagePath: '',
    selectorInitialBox: null,
    lesionCount: 0,
    formProgress: 0,
    formProgressText: '0/3',
    formCompleted: 0,
    submitHint: '请先补充病例信息',
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
    bodyPartOptions: [
      { value: 'head', label: '头部' },
      { value: 'neck', label: '颈部' },
      { value: 'ears', label: '耳部' },
      { value: 'back', label: '背部' },
      { value: 'abdomen', label: '腹部' },
      { value: 'limbs', label: '四肢' },
      { value: 'paws', label: '爪部' },
      { value: 'tail', label: '尾部' },
      { value: 'whole', label: '全身' },
      { value: 'other', label: '其他' }
    ]
  },

  onLoad: function () {
    // base64 只存实例变量，不进 setData：5 张 MB 级字符串进 data 会卡渲染（BUG-B2）
    this._imageBase64List = []
    this.setData({ todayText: this._buildTodayText() })
    this.checkNetwork()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncSelected(0)
    }
    // 回到本页时按当前 step 同步底栏显隐（BUG-UI56）
    this._syncTabBar()
    this.loadProfiles()
    this.loadLastCheck()
    this.refreshGreeting()
  },

  // 拍照初筛流程是页内 step、不切页，底栏原本一直压着提交按钮；
  // 进入流程收起底栏，回到首页再显示（BUG-UI56）
  _syncTabBar: function () {
    if (typeof this.getTabBar !== 'function' || !this.getTabBar()) return
    var hidden = this.data.step === 'capture'
    if (this.getTabBar().data.hidden !== hidden) {
      this.getTabBar().setData({ hidden: hidden })
    }
  },

  _buildTodayText: function () {
    var d = new Date()
    return (d.getMonth() + 1) + '月' + d.getDate() + '日　' + WEEKDAYS[d.getDay()]
  },

  // 首页问候语随选中宠物的最近一次检查变化（首检 / 复查追问 / 默认）
  refreshGreeting: function () {
    var profileId = this.data.selectedProfileId
    var hist = storage.getHistory() || []
    var record = profileId
      ? hist.filter(function (r) { return r.profileId === profileId })[0]
      : hist[0]
    this.setData({
      greeting: greetingUtil.buildGreeting({
        petName: this.data.selectedPetName,
        record: record || null
      })
    })
  },

  loadProfiles: function () {
    var profiles = storage.getPetProfiles() || []
    var activeId = storage.getActiveProfileId ? storage.getActiveProfileId() : ''
    var displayProfiles = profiles.slice(0, 3).map(function (p) {
      // BUG-UI69：首页宠物头像优先显示已保存照片
      return { id: p.id || '', initial: (p.petName || '宠').charAt(0), name: p.petName || '未命名', avatar: p.avatar || '' }
    })
    this.setData({ profiles: profiles, displayProfiles: displayProfiles })
    // 首次进入且用户未手动选过宠物时，自动带入当前档案
    if (!this._petTouched && !this.data.selectedProfileId && activeId) {
      var active = profiles.filter(function (p) { return p.id === activeId })[0]
      if (active) this._applyProfile(active)
    }
  },

  loadLastCheck: function () {
    var hist = storage.getHistory() || []
    if (!hist.length) {
      this.setData({ lastCheck: null })
      return
    }
    var r = hist[0]
    var urgency = r.urgency || 'moderate'
    var d = new Date(typeof r.createdAt === 'number' ? r.createdAt : (r.generatedAt || r.timestamp))
    this.setData({
      lastCheck: {
        dateShort: this._formatShortDate(r.createdAt || r.timestamp),
        dateText: isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '月' + d.getDate() + '日',
        disease: r.disease || r.lesionNameCn || r.primaryDiagnosis || '初筛结果',
        urgency: urgency,
        statusText: URGENCY_STATUS[urgency] || '已完成',
        careTip: URGENCY_CARE[urgency] || '',
        imagePath: r.imagePath || (r.imagePaths && r.imagePaths[0]) || ''
      }
    })
  },

  _formatShortDate: function (v) {
    var d = v ? new Date(v) : new Date()
    if (isNaN(d.getTime())) return '--'
    function pad (n) { return ('0' + n).slice(-2) }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },

  startCapture: function () {
    this.setData({ step: 'capture' }, function () {
      this.refreshUiState()
      this._syncTabBar()
    }.bind(this))
  },

  backHome: function () {
    this.setData({ step: 'home' }, this._syncTabBar.bind(this))
  },

  goRecords: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  },

  goLastRecord: function () {
    var hist = storage.getHistory() || []
    if (!hist.length) return
    wx.navigateTo({ url: '/pages/result/result?id=' + hist[0].id })
  },

  addPet: function () {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  onSelectPet: function () {
    var self = this
    this._petTouched = true
    var profiles = this.data.profiles || []
    if (!profiles.length) {
      wx.showModal({
        title: '还没有宠物档案',
        content: '去创建一个宠物档案，检查记录就能归到TA名下。',
        confirmText: '去创建',
        success: function (res) {
          if (res.confirm) wx.navigateTo({ url: '/pages/profile/profile' })
        }
      })
      return
    }
    var names = profiles.map(function (p) { return p.petName || '未命名' })
    names.push('临时问诊（不选宠物）')
    wx.showActionSheet({
      itemList: names,
      success: function (res) {
        if (res.tapIndex === profiles.length) {
          self._clearSelectedProfile()
        } else {
          self._applyProfile(profiles[res.tapIndex])
        }
      }
    })
  },

  _applyProfile: function (p) {
    if (!p) return
    var name = p.petName || '未命名'
    var self = this
    this.setData({
      hasSelectedPet: true,
      selectedPetName: name,
      selectedPetInitial: name.charAt(0),
      selectedProfileId: p.id || '',
      selectedBreed: p.breed || '',
      quickPetType: p.petType || '',
      quickPetTypeLabel: p.petTypeLabel || '',
      quickGender: p.gender || '',
      quickGenderLabel: p.genderLabel || '',
      quickAge: p.age || '',
      quickAgeLabel: p.ageLabel || ''
    }, function () {
      self.refreshUiState()
      self.refreshGreeting()
    })
  },

  _clearSelectedProfile: function () {
    this.setData({
      hasSelectedPet: false,
      selectedPetName: '',
      selectedPetInitial: '',
      selectedProfileId: '',
      selectedBreed: ''
    }, this.refreshGreeting.bind(this))
  },

  checkNetwork: function () {
    wx.getNetworkType({
      success: function (res) {
        if (res.networkType === 'none') {
          wx.showModal({ title: '网络不可用', content: '皮肤初筛需要联网生成报告。', showCancel: false })
        }
      }
    })
  },

  goChat: function () {
    wx.navigateTo({ url: '/pages/chat/chat' })
  },

  chooseImage: function () {
    var self = this
    if (self.data.imagePaths.length >= MAX_IMAGES) {
      wx.showToast({ title: '最多 ' + MAX_IMAGES + ' 张', icon: 'none' })
      return
    }
    var count = Math.max(1, MAX_IMAGES - self.data.imagePaths.length)

    function processTempFiles(tempFiles) {
      var tempPaths = (tempFiles || []).map(function (f) { return f.tempFilePath }).filter(Boolean)
      if (tempPaths.length === 0) return
      wx.showLoading({ title: '处理图片中', mask: true })
      // 直接用临时路径处理，不再 stabilizeTempFile（它会在 DevTools 制造 vetai_tmp 假路径）；
      // 逐张转码→选图时落盘（BUG-B2）→批量质检（BUG-B3）公共链路已提取到 prepareImages
      imageUtil.prepareImages(tempPaths, {
        existingCount: self.data.imagePaths.length,
        maxCount: MAX_IMAGES,
        pageContext: self
      })
        .then(function (newItems) {
          wx.hideLoading()
          var displayPaths = newItems.map(function (item) { return item.displayPath })
          var qualityFlags = newItems.map(function (item) { return item.quality })
          self._imageBase64List = self._imageBase64List
            .concat(newItems.map(function (item) { return item.base64 }))
            .slice(0, MAX_IMAGES)
          analytics.track('upload', {
            added: displayPaths.length,
            total: Math.min(MAX_IMAGES, self.data.imagePaths.length + displayPaths.length)
          })
          self.setData({
            imagePaths: self.data.imagePaths.concat(displayPaths).slice(0, MAX_IMAGES),
            imageRoles: self.data.imageRoles.concat(displayPaths.map(function () { return '' })).slice(0, MAX_IMAGES),
            imageQualityFlags: self.data.imageQualityFlags.concat(qualityFlags).slice(0, MAX_IMAGES),
            lesionBoxes: self.data.lesionBoxes.concat(displayPaths.map(function () { return null })).slice(0, MAX_IMAGES)
          }, self.refreshUiState.bind(self))
        })
        .catch(function (err) {
          wx.hideLoading()
          console.error('[VetAI] 图片处理失败:', err)
          var errMsg = '图片处理失败'
          var errText = (err && err.errMsg) || (err && err.message) || String(err)
          if (errText.indexOf('timeout') >= 0) {
            errMsg = '图片处理超时，请减少一次上传数量或换一张小图'
          } else if (errText.indexOf('compressImage') >= 0) {
            errMsg = '图片压缩失败，可能是特殊格式，请尝试截图后上传'
          } else if (errText.indexOf('readFile') >= 0 && errText.indexOf('not found') >= 0) {
            errMsg = '图片文件未找到，请从相册重新选择或在真机上测试'
          } else if (errText.indexOf('readFile') >= 0) {
            errMsg = '图片读取失败，请重新选择'
          } else if (errText.indexOf('getImageInfo') >= 0) {
            errMsg = '无法识别图片信息，请换一张试试'
          }
          wx.showToast({ title: errMsg, icon: 'none' })
        })
    }

    function doChooseImage() {
      // 微信开发者工具部分版本 chooseMedia 返回的临时路径不是真实文件，
      // 且 getDeviceInfo/getSystemInfo 在不同版本里表现不稳定，统一使用 chooseImage 保证能弹出选择器
      wx.chooseImage({
        count: count,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: function (res) {
          var tempFiles = (res.tempFilePaths || []).map(function (p) { return { tempFilePath: p } })
          processTempFiles(tempFiles)
        },
        fail: function (err) {
          console.error('[VetAI] chooseImage failed:', err)
          wx.showToast({ title: '无法打开相册或相机', icon: 'none' })
        }
      })
    }

    doChooseImage()
  },

  // BUG-UI25：拍完的照片原先不能点开看大图，用户无法确认是否拍清楚
  previewImage: function (e) {
    var paths = this.data.imagePaths || []
    if (!paths.length) return
    var idx = parseInt(e.currentTarget.dataset.index, 10)
    if (isNaN(idx) || idx < 0 || idx >= paths.length) idx = 0
    wx.previewImage({ current: paths[idx], urls: paths })
  },

  removeImage: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    this._imageBase64List = (this._imageBase64List || []).filter(function (_, i) { return i !== idx })
    this.setData({
      imagePaths: this.data.imagePaths.filter(function (_, i) { return i !== idx }),
      imageRoles: this.data.imageRoles.filter(function (_, i) { return i !== idx }),
      imageQualityFlags: this.data.imageQualityFlags.filter(function (_, i) { return i !== idx }),
      lesionBoxes: this.data.lesionBoxes.filter(function (_, i) { return i !== idx })
    }, this.refreshUiState.bind(this))
  },

  cycleImageRole: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var roles = this.data.imageRoles.slice()
    var cur = roles[idx] || ''
    var next = ''
    for (var i = 0; i < IMAGE_ROLES.length; i++) {
      if (IMAGE_ROLES[i].value === cur) {
        next = IMAGE_ROLES[(i + 1) % IMAGE_ROLES.length].value
        break
      }
    }
    roles[idx] = next
    this.setData({ imageRoles: roles }, this.refreshUiState.bind(this))
  },

  openLesionSelector: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var imagePath = this.data.imagePaths[idx]
    if (!imagePath) return
    analytics.track('lesionOpen', { imageIndex: idx, hasExisting: !!this.data.lesionBoxes[idx] })
    this.setData({
      selectorVisible: true,
      selectorImageIndex: idx,
      selectorImagePath: imagePath,
      selectorInitialBox: this.data.lesionBoxes[idx] || null
    })
  },

  onLesionSave: function (e) {
    var idx = this.data.selectorImageIndex
    if (idx < 0) {
      this._closeLesionSelector()
      return
    }
    var boxes = this.data.lesionBoxes.slice()
    boxes[idx] = e.detail.box
    analytics.track('lesionSave', { imageIndex: idx, mode: e.detail.mode, pointCount: e.detail.pointCount })
    var self = this
    this.setData({ lesionBoxes: boxes }, function () {
      self._closeLesionSelector()
      self.refreshUiState()
      if (self.data.lesionBoxes[idx]) {
        wx.showToast({ title: '已保存圈选', icon: 'success' })
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    })
  },

  onLesionClear: function () {
    var idx = this.data.selectorImageIndex
    if (idx >= 0) {
      analytics.track('lesionClear', { imageIndex: idx })
      var boxes = this.data.lesionBoxes.slice()
      boxes[idx] = null
      this.setData({ lesionBoxes: boxes }, this.refreshUiState.bind(this))
    }
    this._closeLesionSelector()
    wx.showToast({ title: '已清除圈选', icon: 'none' })
  },

  onLesionClose: function () {
    this._closeLesionSelector()
  },

  _closeLesionSelector: function () {
    this.setData({
      selectorVisible: false,
      selectorImageIndex: -1,
      selectorImagePath: '',
      selectorInitialBox: null
    })
  },

  onBodyPartTap: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var item = this.data.bodyPartOptions[idx]
    this.setData({ bodyPart: item.value, bodyPartLabel: item.label }, this.refreshUiState.bind(this))
  },

  onComplaintInput: function (e) {
    this.setData({ complaint: e.detail.value })
  },

  onQuickPetTypeTap: function (e) {
    var item = this.data.petTypeOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ quickPetType: item.value, quickPetTypeLabel: item.label }, this.refreshUiState.bind(this))
  },

  onQuickGenderTap: function (e) {
    var item = this.data.genderOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ quickGender: item.value, quickGenderLabel: item.label }, this.refreshUiState.bind(this))
  },

  onQuickAgeTap: function (e) {
    var item = this.data.ageOptions[parseInt(e.currentTarget.dataset.index)]
    this.setData({ quickAge: item.value, quickAgeLabel: item.label }, this.refreshUiState.bind(this))
  },

  onModelProviderTap: function () {
    this.setData({
      modelProvider: 'qwen',
      modelProviderLabel: 'Qwen3.8-Flash'
    })
  },

  buildPetInfo: function () {
    var hasProfile = !!this.data.selectedProfileId
    return {
      isTemporary: !hasProfile,
      profileId: this.data.selectedProfileId || '',
      petName: hasProfile ? this.data.selectedPetName : '临时问诊',
      breed: this.data.selectedBreed || '',
      petType: this.data.quickPetType,
      petTypeLabel: this.data.quickPetTypeLabel,
      gender: this.data.quickGender,
      genderLabel: this.data.quickGenderLabel,
      age: this.data.quickAge,
      ageLabel: this.data.quickAgeLabel,
      bodyPart: this.data.bodyPart,
      bodyPartLabel: this.data.bodyPartLabel,
      complaint: this.data.complaint,
      modelProvider: this.data.modelProvider,
      modelProviderLabel: this.data.modelProviderLabel,
      useKnowledgeBase: this.data.useKnowledgeBase,
      lesionBoxes: this.data.lesionBoxes,
      imageRoles: this.data.imageRoles
    }
  },

  canSubmit: function () {
    if (this.data.imagePaths.length === 0 || !this.data.bodyPart) return false
    return !!(this.data.quickPetType && this.data.quickGender && this.data.quickAge)
  },

  refreshUiState: function () {
    var self = this
    var hasPatient = !!(this.data.quickPetType && this.data.quickGender && this.data.quickAge)
    var hasImages = this.data.imagePaths.length > 0
    var hasBodyPart = !!this.data.bodyPart
    var completed = (hasPatient ? 1 : 0) + (hasImages ? 1 : 0) + (hasBodyPart ? 1 : 0)
    var lesionCount = this.data.lesionBoxes.filter(function (box) { return !!box }).length
    var submitHint = this.canSubmit()
      ? '可以生成初筛报告'
      : (!hasImages ? '先拍照或上传皮肤照片' : (!hasPatient ? '补充宠物基础信息' : '选择患处部位'))
    this.setData({
      canAddMore: this.data.imagePaths.length < MAX_IMAGES,
      canSubmitActive: this.canSubmit(),
      lesionCount: lesionCount,
      formProgress: Math.round((completed / 3) * 100),
      formProgressText: completed + '/3',
      formCompleted: completed,
      submitHint: submitHint,
      previewItems: this.data.imagePaths.map(function (path, i) {
        var role = self.data.imageRoles[i] || ''
        var roleItem = IMAGE_ROLES.filter(function (r) { return r.value === role })[0]
        var quality = self.data.imageQualityFlags[i] || null
        var hasBox = !!self.data.lesionBoxes[i]
        return {
          path: path,
          role: role,
          roleLabel: roleItem ? roleItem.label : '',
          indexLabel: ('0' + (i + 1)).slice(-2),
          qualityScore: quality ? quality.score : 0,
          qualityText: quality && quality.score < 65 ? '建议重拍' : '',
          hasBox: hasBox,
          lesionStatusText: hasBox ? '已保存圈选' : '未圈选患处'
        }
      })
    })
  },

  _startAnalyzingTimer: function () {
    // at 为累计时间阈值：到达即切换文案；1s 检查一次，避免旧实现里
    // “累计 vs 单阶段时长”语义混用导致的切换延迟（BUG-B4）
    var phases = [
      { text: '正在识别皮损特征...', at: 0 },
      { text: '正在检索临床特征库...', at: 6000 },
      { text: '正在综合分析中...', at: 12000 },
      { text: '报告即将完成，请耐心等待...', at: 24000 }
    ]
    var self = this
    var i = 0
    var elapsed = 0
    this._analyzingTimer = setInterval(function () {
      elapsed += 1000
      while (i < phases.length - 1 && elapsed >= phases[i + 1].at) {
        i++
        self.setData({ analyzingStep: i, analyzingStepText: phases[i].text })
      }
    }, 1000)
  },

  _stopAnalyzingTimer: function () {
    if (this._analyzingTimer) {
      clearInterval(this._analyzingTimer)
      this._analyzingTimer = null
    }
  },

  onSubmit: function () {
    if (this.data.isAnalyzing) return
    if (!this.canSubmit()) {
      wx.showToast({ title: '请补全信息和照片', icon: 'none' })
      return
    }
    var self = this
    var petInfo = self.buildPetInfo()
    analytics.track('submit', {
      imageCount: self.data.imagePaths.length,
      lesionCount: self.data.lesionBoxes.filter(Boolean).length,
      hasComplaint: !!self.data.complaint
    })
    self.setData({ isAnalyzing: true, analyzingStep: 0, analyzingStepText: '正在识别皮损特征...' })
    self._startAnalyzingTimer()

    Promise.all([
      imageUtil.saveImagesPermanent(self.data.imagePaths),
      imageUtil.cropAllLesionRegions(self.data.imagePaths, self.data.lesionBoxes, self)
    ])
      .then(function (bundle) {
        var saved = bundle[0]
        var roiImages = bundle[1]
        analytics.track('roiCrop', { total: self.data.lesionBoxes.filter(Boolean).length, cropped: roiImages.length })
        var imageBundle = imageUtil.buildModelImageBundle(
          self._imageBase64List || [],
          self.data.imageRoles,
          roiImages || []
        )
        var requestImages = imageBundle.images
        var sizeWarnings = imageUtil.checkImageSizes(requestImages)
        var paths = saved.map(function (s) { return s.path })
        var saveFailed = saved.some(function (s) { return s && s.saveFailed })
        if (saveFailed || paths.some(function (path) { return !path })) {
          imageUtil.cleanupSavedFiles(saved)
          self.setData({ isAnalyzing: false }); self._stopAnalyzingTimer()
          wx.showModal({
            title: '图片保存失败',
            content: '开发者工具没有成功保存本次图片，请重新选择照片后再试。',
            showCancel: false
          })
          return Promise.reject(new Error('__handled__'))
        }
        if (sizeWarnings.length > 0) {
          imageUtil.cleanupSavedFiles(saved)
          self.setData({ isAnalyzing: false }); self._stopAnalyzingTimer()
          wx.showModal({
            title: '图片过大',
            content: sizeWarnings[0] + '。请减少图片数量或重新拍摄更清晰但更小的照片。',
            showCancel: false
          })
          return Promise.reject(new Error('__handled__'))
        }
        var requestPetInfo = Object.assign({}, petInfo, {
          imageRoles: imageBundle.roles,
          totalImageCount: self.data.imagePaths.length
        })
        // 超出模型上限的图片不再静默丢弃，明确告知用户（BUG-B1）
        if (imageBundle.droppedCount > 0) {
          wx.showToast({
            title: 'AI 本次分析 ' + imageBundle.images.length + ' 张关键照片，其余仅存档',
            icon: 'none',
            duration: 2500
          })
        }
        return api.diagnose(requestImages, requestPetInfo)
          .then(function (res) {
            if (res.success) {
              setTimeout(function () {
                self.setData({ isAnalyzing: false, imagePaths: paths }); self._stopAnalyzingTimer()
                var d = res.data
                var record = storage.addRecord({
                  petName: petInfo.petName, petType: petInfo.petType,
                  petTypeLabel: petInfo.petTypeLabel, breed: petInfo.breed,
                  gender: petInfo.gender, genderLabel: petInfo.genderLabel,
                  age: petInfo.age, ageLabel: petInfo.ageLabel,
                  sterilized: petInfo.sterilized, sterilizedLabel: petInfo.sterilizedLabel,
                  allergy: petInfo.allergy, medicalHistory: petInfo.medicalHistory,
                  weight: petInfo.weight, avatar: petInfo.avatar,
                  profileId: petInfo.profileId, isTemporary: !!petInfo.isTemporary,
                  bodyPart: petInfo.bodyPart, bodyPartLabel: petInfo.bodyPartLabel,
                  complaint: petInfo.complaint,
                  modelProvider: d.modelProvider, modelProviderLabel: d.modelProviderLabel,
                  lesionBoxes: self.data.lesionBoxes, imagePath: paths[0] || '', imagePaths: paths,
                  lesionType: d.lesionType, lesionNameCn: d.lesionNameCn,
                  confidence: d.confidence, confidenceRaw: d.confidenceRaw,
                  confidenceLabel: d.confidenceLabel,
                  primaryDiagnosis: d.primaryDiagnosis,
                  primaryDiagnosisProbability: d.primaryDiagnosisProbability,
                  diagnosisCandidates: d.diagnosisCandidates,
                  observations: d.observations, explanation: d.explanation,
                  possibleMeaning: d.possibleMeaning,
                  homeCare: d.homeCare, whenToWatch: d.whenToWatch,
                  whenToSeeVet: d.whenToSeeVet,
                  careSuggestion: d.careSuggestion, vetWarning: d.vetWarning,
                  urgency: d.urgency, redLineFlags: d.redLineFlags,
                  diagnosisProbabilityNote: d.diagnosisProbabilityNote,
                  disclaimer: d.disclaimer, modelName: d.modelName,
                  generatedAt: d.generatedAt,
                  ragTitle: d.ragTitle, ragSummary: d.ragSummary,
                  ragBasis: d.ragBasis, ragRecommendation: d.ragRecommendation,
                  ragSources: d.ragSources,
                  disease: d.disease, diseaseList: d.diseaseList,
                  symptoms: d.symptoms, treatment: d.treatment,
                  urgencyLabel: d.urgencyLabel, urgencyDesc: d.urgencyDesc,
                  ragMatchName: d._ragMatchName || '', ragMatchScore: d._ragMatchScore || 0,
                  ragMatched: d._ragMatched || [],
                  yoloConfidence: 0, bbox: [], detections: [],
                  notes: d.notes, rawResponse: res.raw
                })
                wx.navigateTo({ url: '/pages/result/result?id=' + record.id })
              }, 300)
            } else {
              imageUtil.cleanupSavedFiles(saved)
              self.setData({ isAnalyzing: false }); self._stopAnalyzingTimer()
              wx.showModal({ title: '分析失败', content: res.error || '请重试', showCancel: false })
            }
          })
      })
      .catch(function (err) {
        if (err && err.message === '__handled__') return
        self.setData({ isAnalyzing: false }); self._stopAnalyzingTimer()
        wx.showModal({ title: '请求失败', content: api.friendlyError(err && err.message) || '网络异常', showCancel: false })
      })
  }
})
