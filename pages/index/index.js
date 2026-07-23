var api = require('../../utils/api')
var config = require('../../utils/config')
var storage = require('../../utils/storage')
var imageUtil = require('../../utils/image')
var analytics = require('../../utils/analytics')

var IMAGE_ROLES = [
  { value: '', label: '' },
  { value: 'overview', label: '整体' },
  { value: 'closeup', label: '近景' },
  { value: 'reference', label: '参照' }
]

Page({
  data: {
    imagePaths: [],
    imageBase64List: [],
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
    modelProviderLabel: 'Qwen3.7-Plus',
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
    this.checkNetwork()
  },

  onShow: function () {},

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
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  chooseImage: function () {
    var self = this
    if (self.data.imagePaths.length >= 5) {
      wx.showToast({ title: '最多 5 张', icon: 'none' })
      return
    }
    var count = Math.max(1, 5 - self.data.imagePaths.length)

    function processTempFiles(tempFiles) {
      var tempPaths = (tempFiles || []).map(function (f) { return f.tempFilePath }).filter(Boolean)
      if (tempPaths.length === 0) return
      wx.showLoading({ title: '处理图片中', mask: true })
      // 直接用临时路径处理，不再 stabilizeTempFile（它会在 DevTools 制造 vetai_tmp 假路径）
      tempPaths.reduce(function (chain, p) {
        return chain.then(function (acc) {
          return imageUtil.processImage(p, self).then(function (b64) {
            acc.push(b64)
            return acc
          })
        })
      }, Promise.resolve([]))
        .then(function (newB64s) {
          // processImage 始终返回 base64 data URL，直接用作显示路径
          var displayPaths = newB64s.filter(Boolean)
          return Promise.all(displayPaths.map(function (path) {
            return imageUtil.checkImageQuality(path, self)
          })).then(function (qualityFlags) {
            wx.hideLoading()
            self.setData({
              imagePaths: self.data.imagePaths.concat(displayPaths).slice(0, 5),
              imageBase64List: self.data.imageBase64List.concat(newB64s).slice(0, 5),
              imageRoles: self.data.imageRoles.concat(displayPaths.map(function () { return '' })).slice(0, 5),
              imageQualityFlags: self.data.imageQualityFlags.concat(qualityFlags).slice(0, 5),
              lesionBoxes: self.data.lesionBoxes.concat(displayPaths.map(function () { return null })).slice(0, 5)
            }, self.refreshUiState.bind(self))
          })
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

  removeImage: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    this.setData({
      imagePaths: this.data.imagePaths.filter(function (_, i) { return i !== idx }),
      imageBase64List: this.data.imageBase64List.filter(function (_, i) { return i !== idx }),
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
      modelProviderLabel: 'Qwen3.7-Plus'
    })
  },

  buildPetInfo: function () {
    return {
      isTemporary: true,
      petName: '临时问诊',
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
      canAddMore: this.data.imagePaths.length < 5,
      canSubmitActive: this.canSubmit(),
      lesionCount: lesionCount,
      formProgress: Math.round((completed / 3) * 100),
      formProgressText: completed + '/3',
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
    var phases = [
      { text: '正在识别皮损特征...', duration: 6000 },
      { text: '正在检索临床特征库...', duration: 6000 },
      { text: '正在综合分析中...', duration: 12000 },
      { text: '报告即将完成，请耐心等待...', duration: 0 }
    ]
    var self = this
    var i = 0
    var elapsed = 0
    this._analyzingTimer = setInterval(function () {
      elapsed += 4000
      if (i < phases.length - 1 && elapsed >= phases[i].duration) {
        i++
        self.setData({ analyzingStep: i, analyzingStepText: phases[i].text })
      }
    }, 4000)
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
          self.data.imageBase64List,
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
          imageRoles: imageBundle.roles
        })
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
