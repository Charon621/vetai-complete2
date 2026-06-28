var api = require('../../utils/api')
var storage = require('../../utils/storage')
var imageUtil = require('../../utils/image')
var lesionUtil = require('../../utils/lesion')
var analytics = require('../../utils/analytics')

var IMAGE_ROLES = [
  { value: '', label: '' },
  { value: 'overview', label: '整体' },
  { value: 'closeup', label: '近景' },
  { value: 'reference', label: '参照' }
]

Page({
  data: {
    profilesCount: 0,
    selectedProfile: null,
    mode: 'quick',
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
    isAnalyzing: false,
    analyzingStep: 0,
    analyzingStepText: '正在识别皮损特征...',
    progressText: '',
    canSubmitActive: false,
    selectedProfileAvatarText: '?',
    selectorVisible: false,
    selectorImageIndex: -1,
    selectorImagePath: '',
    selectorPathPoints: [],
    selectorPointCount: 0,
    selectorCanSave: false,
    selectorModeLabel: '自由圈选',
    selectorStageRect: null,
    selectorImageRect: null,
    selectorImageInfo: null,
    selectorMode: 'freehand',
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
    this.loadProfileSummary()
  },

  onShow: function () {
    this.loadProfileSummary()
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

  loadProfileSummary: function () {
    var profiles = storage.getPetProfiles()
    var selectedProfile = storage.getActivePetProfile()
    var shouldUseProfile = selectedProfile && storage.consumeUseActiveProfileNext()
    if (selectedProfile) {
      selectedProfile.avatarText = selectedProfile.petName ? selectedProfile.petName.slice(0, 1) : '宠'
    }
    this.setData({
      profilesCount: profiles.length,
      selectedProfile: selectedProfile,
      selectedProfileAvatarText: selectedProfile ? selectedProfile.avatarText : '?',
      mode: shouldUseProfile ? 'profile' : (selectedProfile ? (this.data.mode || 'quick') : 'quick')
    }, this.refreshUiState.bind(this))
  },

  goProfile: function () {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  useQuickMode: function () {
    this.setData({ mode: 'quick' }, this.refreshUiState.bind(this))
  },

  useProfileMode: function () {
    if (!this.data.selectedProfile) {
      this.goProfile()
      return
    }
    this.setData({ mode: 'profile' }, this.refreshUiState.bind(this))
  },

  chooseImage: function () {
    var self = this
    if (self.data.imagePaths.length >= 5) {
      wx.showToast({ title: '最多 5 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: Math.max(1, 5 - self.data.imagePaths.length),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function (res) {
        var newPaths = (res.tempFiles || []).map(function (f) { return f.tempFilePath }).filter(Boolean)
        if (newPaths.length === 0) return
        wx.showLoading({ title: '处理图片中', mask: true })
        newPaths.reduce(function (chain, p) {
          return chain.then(function (acc) {
            return imageUtil.processImage(p, self).then(function (b64) {
              acc.push(b64)
              return acc
            })
          })
        }, Promise.resolve([]))
          .then(function (newB64s) {
            return Promise.all(newPaths.map(function (path) {
              return imageUtil.checkImageQuality(path, self)
            })).then(function (qualityFlags) {
              wx.hideLoading()
              self.setData({
                imagePaths: self.data.imagePaths.concat(newPaths).slice(0, 5),
                imageBase64List: self.data.imageBase64List.concat(newB64s).slice(0, 5),
                imageRoles: self.data.imageRoles.concat(newPaths.map(function () { return '' })).slice(0, 5),
                imageQualityFlags: self.data.imageQualityFlags.concat(qualityFlags).slice(0, 5),
                lesionBoxes: self.data.lesionBoxes.concat(newPaths.map(function () { return null })).slice(0, 5)
              }, self.refreshUiState.bind(self))
            })
          })
          .catch(function () {
            wx.hideLoading()
            wx.showToast({ title: '图片处理失败', icon: 'none' })
          })
      }
    })
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

  noop: function () {},

  openLesionSelector: function (e) {
    var self = this
    var idx = parseInt(e.currentTarget.dataset.index)
    var imagePath = self.data.imagePaths[idx]
    if (!imagePath) return
    analytics.track('lesionOpen', { imageIndex: idx, hasExisting: !!self.data.lesionBoxes[idx] })

    var existing = self.data.lesionBoxes[idx]
    var existingMode = existing && existing.type === 'rectangle' ? 'rectangle' : 'freehand'
    var points = existing && Array.isArray(existing.points)
      ? existing.points.map(function (p) {
        return {
          x: Math.max(0, Math.min(100, Math.round((p.x || 0) * 100))),
          y: Math.max(0, Math.min(100, Math.round((p.y || 0) * 100)))
        }
      })
      : []

    wx.getImageInfo({
      src: imagePath,
      success: function (info) {
        self.setData({
          selectorVisible: true,
          selectorImageIndex: idx,
          selectorImagePath: imagePath,
          selectorImageInfo: { width: info.width, height: info.height },
          selectorPathPoints: points,
          selectorPointCount: points.length,
          selectorCanSave: self.canSaveLesion(points, existingMode),
          selectorModeLabel: existingMode === 'rectangle' ? '矩形框选' : '自由圈选',
          selectorStageRect: null,
          selectorMode: existingMode
        }, function () {
          self._canvasData = null
          self.measureSelectorStage(function () {
            self.drawSelectorPath(points)
          })
        })
      },
      fail: function () {
        self.setData({
          selectorVisible: true,
          selectorImageIndex: idx,
          selectorImagePath: imagePath,
          selectorImageInfo: null,
          selectorPathPoints: points,
          selectorPointCount: points.length,
          selectorCanSave: self.canSaveLesion(points, existingMode),
          selectorModeLabel: existingMode === 'rectangle' ? '矩形框选' : '自由圈选',
          selectorStageRect: null,
          selectorMode: existingMode
        }, function () {
          self._canvasData = null
          self.measureSelectorStage(function () {
            self.drawSelectorPath(points)
          })
        })
      }
    })
  },

  measureSelectorStage: function (callback) {
    var self = this
    wx.createSelectorQuery().in(self)
      .select('.lesion-stage')
      .boundingClientRect(function (rect) {
        if (!rect) return
        var info = self.data.selectorImageInfo || {}
        var imageRect = lesionUtil.getAspectFitRect(rect.width, rect.height, info.width, info.height)
        self.setData({ selectorStageRect: rect, selectorImageRect: imageRect })
        lesionUtil.initCanvas(self, 'lesionCanvas').then(function (canvasData) {
          self._canvasData = canvasData
          if (callback) callback(rect)
        })
      })
      .exec()
  },

  drawSelectorPath: function (points) {
    var rect = this.data.selectorStageRect
    if (rect && this._canvasData) {
      lesionUtil.drawPath(this._canvasData, points || this.data.selectorPathPoints, rect.width, rect.height, this.data.selectorMode, this.data.selectorImageRect)
    }
  },

  startDrawLesion: function (e) {
    var self = this
    var touch = e.touches && e.touches[0]
    var begin = function (rect) {
      rect = rect || self.data.selectorStageRect
      var point = lesionUtil.getPoint(touch, rect, self.data.selectorImageRect)
      if (!point) return
      self._isDrawingLesion = true
      lesionUtil.vibrate('light')
      self.setData({
        selectorPathPoints: [point],
        selectorPointCount: 1,
        selectorCanSave: false
      }, function () {
        self.drawSelectorPath([point])
      })
    }
    if (self.data.selectorStageRect) begin(self.data.selectorStageRect)
    else self.measureSelectorStage(begin)
  },

  moveDrawLesion: function (e) {
    var self = this
    if (!self._isDrawingLesion) return
    var rect = self.data.selectorStageRect
    var touch = e.touches && e.touches[0]
    var point = lesionUtil.getPoint(touch, rect, self.data.selectorImageRect)
    if (!point) return

    var points = self.data.selectorPathPoints
    var last = points[points.length - 1]
    if (last && Math.abs(last.x - point.x) < 0.8 && Math.abs(last.y - point.y) < 0.8) return
    var nextPoints = points.concat(point).slice(-260)
    self.setData({
      selectorPathPoints: nextPoints,
      selectorPointCount: nextPoints.length,
      selectorCanSave: self.canSaveLesion(nextPoints, self.data.selectorMode)
    }, function () {
      self.drawSelectorPath(nextPoints)
    })
  },

  endDrawLesion: function () {
    this._isDrawingLesion = false
    this.drawSelectorPath()
  },

  resetLesion: function () {
    var self = this
    self._isDrawingLesion = false
    self.setData({
      selectorPathPoints: [],
      selectorPointCount: 0,
      selectorCanSave: false
    }, function () {
      self.drawSelectorPath([])
    })
  },

  canSaveLesion: function (points, mode) {
    return mode === 'rectangle' ? points.length >= 2 : points.length >= 3
  },

  setLesionMode: function (e) {
    var mode = e.currentTarget.dataset.mode || 'freehand'
    var self = this
    self._isDrawingLesion = false
    self.setData({
      selectorMode: mode,
      selectorModeLabel: mode === 'rectangle' ? '矩形框选' : '自由圈选',
      selectorPathPoints: [],
      selectorPointCount: 0,
      selectorCanSave: false
    }, function () {
      self.drawSelectorPath([])
    })
  },

  saveLesion: function () {
    var idx = this.data.selectorImageIndex
    var points = this.data.selectorPathPoints || []
    if (idx < 0) return
    if (!this.canSaveLesion(points, this.data.selectorMode)) {
      wx.showToast({ title: '请用手指圈出患处', icon: 'none' })
      return
    }
    var boxes = this.data.lesionBoxes.slice()
    var savedBox = lesionUtil.buildLesionBox(points, this.data.selectorMode)
    boxes[idx] = savedBox
    this._canvasData = null
    this._isDrawingLesion = false
    analytics.track('lesionSave', { imageIndex: idx, mode: this.data.selectorMode, pointCount: (points || []).length })
    var self = this
    this.setData({
      lesionBoxes: boxes,
      selectorVisible: false,
      selectorImageIndex: -1,
      selectorImagePath: '',
      selectorPathPoints: [],
      selectorPointCount: 0,
      selectorCanSave: false,
      selectorStageRect: null,
      selectorImageRect: null,
      selectorImageInfo: null
    }, function () {
      self.refreshUiState()
      if (self.data.lesionBoxes[idx]) {
        wx.showToast({ title: '已保存圈选', icon: 'success' })
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    })
  },

  clearLesion: function () {
    var idx = this.data.selectorImageIndex
    if (idx < 0) return
    analytics.track('lesionClear', { imageIndex: idx })
    var boxes = this.data.lesionBoxes.slice()
    boxes[idx] = null
    this._canvasData = null
    this._isDrawingLesion = false
    var self = this
    this.setData({
      lesionBoxes: boxes,
      selectorVisible: false,
      selectorImageIndex: -1,
      selectorImagePath: '',
      selectorPathPoints: [],
      selectorPointCount: 0,
      selectorCanSave: false,
      selectorStageRect: null,
      selectorImageRect: null,
      selectorImageInfo: null
    }, function () {
      self.refreshUiState()
      wx.showToast({ title: '已清除圈选', icon: 'none' })
    })
  },

  closeLesionSelector: function () {
    this._canvasData = null
    this._isDrawingLesion = false
    this.setData({
      selectorVisible: false,
      selectorImageIndex: -1,
      selectorImagePath: '',
      selectorPathPoints: [],
      selectorPointCount: 0,
      selectorCanSave: false,
      selectorStageRect: null,
      selectorImageRect: null,
      selectorImageInfo: null
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
    if (this.data.mode === 'quick') {
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
        lesionBoxes: this.data.lesionBoxes,
        imageRoles: this.data.imageRoles
      }
    }
    var p = this.data.selectedProfile || {}
    return {
      petName: p.petName || '',
      petType: p.petType || '',
      petTypeLabel: p.petTypeLabel || '',
      breed: p.breed || '',
      gender: p.gender || '',
      genderLabel: p.genderLabel || '',
      age: p.age || '',
      ageLabel: p.ageLabel || '',
      sterilized: p.sterilized || '',
      sterilizedLabel: p.sterilizedLabel || '',
      allergy: p.allergy || '',
      medicalHistory: p.medicalHistory || '',
      weight: p.weight || '',
      avatar: p.avatar || '',
      profileId: p.id,
      isTemporary: false,
      bodyPart: this.data.bodyPart,
      bodyPartLabel: this.data.bodyPartLabel,
      complaint: this.data.complaint,
      modelProvider: this.data.modelProvider,
      modelProviderLabel: this.data.modelProviderLabel,
      lesionBoxes: this.data.lesionBoxes,
      imageRoles: this.data.imageRoles
    }
  },

  canSubmit: function () {
    if (this.data.imagePaths.length === 0 || !this.data.bodyPart) return false
    if (this.data.mode === 'quick') {
      return !!(this.data.quickPetType && this.data.quickGender && this.data.quickAge)
    }
    return !!this.data.selectedProfile
  },

  refreshUiState: function () {
    var self = this
    var hasPatient = this.data.mode === 'quick'
      ? !!(this.data.quickPetType && this.data.quickGender && this.data.quickAge)
      : !!this.data.selectedProfile
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
    var steps = [
      '正在识别皮损特征...',
      '正在匹配品种易感病...',
      '正在评估严重程度...',
      '正在生成护理建议...'
    ]
    var self = this
    var i = 0
    this._analyzingTimer = setInterval(function () {
      i = (i + 1) % steps.length
      self.setData({ analyzingStep: i, analyzingStepText: steps[i] })
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
        wx.showModal({ title: '请求失败', content: (err && err.message) || '网络异常', showCancel: false })
      })
  }
})
