var chatDoctor = require('../../utils/chatDoctor')
var storage = require('../../utils/storage')
var api = require('../../utils/api')
var imageUtil = require('../../utils/image')
var config = require('../../utils/config')
var analytics = require('../../utils/analytics')

// 聊天流与首页统一照片上限（BUG-C3）；真正送模型的张数由 MAX_MODEL_IMAGES 控制
var MAX_CHAT_PHOTOS = config.MAX_IMAGES || 5

function formatTime(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  var h = d.getHours()
  var m = d.getMinutes()
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m)
}

function formatMessage(msg) {
  if (!msg) return null
  return {
    id: msg.id, role: msg.role, text: msg.text || '',
    image: msg.image || '', images: msg.images || [],
    quickReplies: msg.quickReplies || [],
    isUser: msg.role === 'user', isDoctor: msg.role === 'doctor',
    timeText: formatTime(msg.timestamp)
  }
}

function appendSessionMessage(session, msg) {
  if (!session || !msg) return
  if (!Array.isArray(session.messages)) session.messages = []
  for (var i = 0; i < session.messages.length; i++) {
    if (session.messages[i] && session.messages[i].id === msg.id) return
  }
  session.messages.push(msg)
}

Page({
  data: {
    messages: [], inputText: '', quickReplies: [],
    inputType: 'text', placeholder: '输入消息…',
    showProfilePicker: false, profiles: [],
    statusBarHeight: 20,
    isAnalyzing: false, draftPetName: '',
    showProgress: false, progressText: '',
    showNewBtn: false, restoredNotice: false, scrollIntoView: '',
    uploadedPhotos: [], uploadedPhotoBoxes: [], showPhotoActions: false,
    selectorVisible: false, selectorImageIndex: -1, selectorImagePath: '',
    selectorInitialBox: null
  },

  _session: null, _isProcessing: false,

  onLoad: function () {
    var statusBarHeight = 20
    try {
      statusBarHeight = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).statusBarHeight || 20
    } catch (e) {}
    this.setData({ statusBarHeight: statusBarHeight })

    // 首次从档案页进入时，onLoad 会早于 onShow；在这里消费标记，避免初始化两次。
    if (wx.getStorageSync('chat_start_new')) {
      wx.removeStorageSync('chat_start_new')
      chatDoctor.clearDraft()
    }
    this.checkProfilesAndStart()
  },

  onShow: function () {
    // 检查是否需要开始新对话（从档案页"新建档案"跳来）
    if (wx.getStorageSync('chat_start_new')) {
      wx.removeStorageSync('chat_start_new')
      chatDoctor.clearDraft()
      this._session = null
      this.checkProfilesAndStart()
      return
    }
    if (this._session && this._session.phase === chatDoctor.PHASE.FOLLOW_UP) {
      this.setData({ showNewBtn: true })
    }
  },

  // ── 档案选择 ──────────────────────────────

  checkProfilesAndStart: function () {
    var self = this
    var savedSession = chatDoctor.loadDraft()
    if (savedSession && savedSession.phase && savedSession.draft && savedSession.draft.petName) {
      self.initChat(null)
      return
    }
    var profiles = storage.getPetProfiles()
    if (profiles && profiles.length > 0) {
      self.setData({
        showProfilePicker: true,
        profiles: profiles.map(function (p) {
          return {
            id: p.id, petName: p.petName,
            petTypeLabel: p.petTypeLabel || '', breed: p.breed || '',
            ageLabel: p.ageLabel || '', avatar: p.avatar || '',
            avatarText: p.petName ? p.petName.slice(0, 1) : '宠'
          }
        })
      })
    } else {
      self.initChat(null)
    }
  },

  onPickProfile: function (e) {
    var id = e.currentTarget.dataset.id
    var profile = storage.getPetProfileById(id)
    this.setData({ showProfilePicker: false })
    this.initChat(profile || null)
  },

  onPickNewProfile: function () {
    this.setData({ showProfilePicker: false })
    this.initChat(null)
  },

  closeProfilePicker: function () {
    this.setData({ showProfilePicker: false })
    if (!this._session) this.initChat(null)
  },

  // ── 初始化对话 ──────────────────────────────

  initChat: function (profile) {
    var result = profile ? chatDoctor.initSessionWithProfile(profile) : chatDoctor.initSession()
    var session = result.session
    this._session = session
    var msgData = chatDoctor.getDoctorMessage(session.phase, session.draft)
    this.setData({
      messages: this._formatMessages(),
      quickReplies: msgData.quickReplies,
      inputType: msgData.inputType,
      placeholder: msgData.placeholder || '输入消息…',
      draftPetName: session.draft.petName || '',
      showNewBtn: false, restoredNotice: result.restored,
      uploadedPhotos: [], uploadedPhotoBoxes: [], showPhotoActions: false,
      isAnalyzing: false
    })
    this._updateProgress()
    this._isProcessing = false
    this._scrollToBottom()
  },

  dismissRestoredNotice: function () { this.setData({ restoredNotice: false }) },

  // 自定义导航栏返回按钮（chat.json navigationStyle: custom，系统不渲染返回键）
  onBackTap: function () {
    var pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  // ── 输入处理 ──────────────────────────────

  onInput: function (e) { this.setData({ inputText: e.detail.value }) },

  onSendText: function () {
    if (this._isProcessing) return
    var text = this.data.inputText.trim()
    if (!text) return
    this._sendUserMessage(text, null, null)
  },

  onQuickReplyTap: function (e) {
    if (this._isProcessing) return
    var idx = parseInt(e.currentTarget.dataset.index)
    var qr = this.data.quickReplies[idx]
    if (!qr) return
    if (qr.field === 'action') {
      if (qr.value === 'new') this.onNewChat()
      else if (qr.value === 'report') this.onViewReport()
      return
    }
    this._sendUserMessage(chatDoctor.quickReplyToText(qr), qr, null)
  },

  // ── 照片上传 ──────────────────────────────

  onUploadPhoto: function () {
    var self = this
    if (self._isProcessing) return
    var confirmedCount = self._session && self._session.draft && Array.isArray(self._session.draft.photoPaths)
      ? self._session.draft.photoPaths.length
      : 0
    var remaining = MAX_CHAT_PHOTOS - confirmedCount - self.data.uploadedPhotos.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传 ' + MAX_CHAT_PHOTOS + ' 张照片', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: function (res) {
        var tempPaths = res.tempFilePaths || []
        if (tempPaths.length === 0) return
        wx.showLoading({ title: '处理图片中', mask: true })
        // 逐张转码链路复用 prepareImages；聊天流选图阶段不落盘不质检，
        // 确认发送时才在 onConfirmPhotos 里批量落盘（保持原行为）
        imageUtil.prepareImages(tempPaths, {
          existingCount: confirmedCount + self.data.uploadedPhotos.length,
          maxCount: MAX_CHAT_PHOTOS,
          pageContext: self,
          savePermanent: false,
          checkQuality: false
        })
          .then(function (photoBatch) {
            wx.hideLoading()
            analytics.track('upload', { added: photoBatch.length, source: 'chat' })
            var newPhotos = self.data.uploadedPhotos.concat(photoBatch.map(function (p) { return p.base64 }))
            var newBoxes = (self.data.uploadedPhotoBoxes || []).concat(photoBatch.map(function () { return null }))
            self.setData({
              uploadedPhotos: newPhotos.slice(0, MAX_CHAT_PHOTOS),
              uploadedPhotoBoxes: newBoxes.slice(0, MAX_CHAT_PHOTOS),
              showPhotoActions: true
            })
          })
          .catch(function (err) {
            wx.hideLoading()
            var errText = (err && err.errMsg) || String(err)
            if (errText.indexOf('cancel') < 0) {
              console.error('[chat] photo process failed:', err)
              wx.showToast({ title: '图片处理失败，请重试', icon: 'none' })
            }
          })
      },
      fail: function (err) {
        var errText = (err && err.errMsg) || ''
        if (errText.indexOf('cancel') < 0) {
          console.error('[chat] chooseImage failed:', err)
        }
      }
    })
  },

  onConfirmPhotos: function () {
    var self = this
    if (self._isProcessing) return
    var photos = self.data.uploadedPhotos
    if (photos.length === 0) return
    var photoBatch = photos.map(function (p) { return { path: p, base64: p } })
    var photoBoxes = (self.data.uploadedPhotoBoxes || []).slice(0, photos.length)
    self.setData({ showPhotoActions: false, uploadedPhotos: [], uploadedPhotoBoxes: [] })
    self._isProcessing = true

    // 把 base64 图片落盘为本地文件，避免把大体积 base64 写进会话消息 / localStorage（10MB 配额风险）
    function commit(finalPaths) {
      var existingPathCount = self._session.draft.photoPaths.length
      var boxes = self._session.draft.lesionBoxes || []
      while (boxes.length < existingPathCount) boxes.push(null)
      self._session.draft.photoPaths = self._session.draft.photoPaths.concat(finalPaths)
      // photoBase64s 仅保留在内存中用于当次诊断，不持久化
      self._session.draft.photoBase64s = self._session.draft.photoBase64s.concat(photoBatch.map(function (p) { return p.base64 }))
      self._session.draft.lesionBoxes = boxes.concat(finalPaths.map(function (_, i) {
        return photoBoxes[i] || null
      }))

      var userMsg = {
        id: 'user_' + Date.now(), role: 'user', text: '',
        images: finalPaths,
        timestamp: Date.now()
      }
      appendSessionMessage(self._session, userMsg)
      self.setData({
        messages: self._formatMessages()
      })
      self._scrollToBottom()

      if (self._session.phase !== chatDoctor.PHASE.COMPLAINT && self._session.phase !== chatDoctor.PHASE.GREETING) {
        var receiveMsg = {
          id: 'doc_' + Date.now(), role: 'doctor',
          text: '收到，我看看照片…',
          timestamp: Date.now()
        }
        appendSessionMessage(self._session, receiveMsg)
        self.setData({
          messages: self._formatMessages(),
          inputType: 'analyzing'
        })
        self._updateProgress()
        self._scrollToBottom()

        self._session.phase = chatDoctor.PHASE.ANALYZING
        chatDoctor.saveDraft(self._session)

        setTimeout(function () {
          self._runDiagnosis()
        }, 500)
      } else {
        chatDoctor.saveDraft(self._session)
        self._isProcessing = false
        wx.showToast({ title: '已收到照片，请先描述问题', icon: 'none' })
      }
    }

    imageUtil.saveImagesPermanent(photoBatch.map(function (p) { return p.base64 }))
      .then(function (savedInfos) {
        var localPaths = savedInfos.map(function (s) { return s.path || '' }).filter(Boolean)
        // 落盘成功用本地路径；否则退化为原始 base64，保证功能不中断
        commit(localPaths.length === photoBatch.length ? localPaths : photoBatch.map(function (p) { return p.path }))
      })
      .catch(function () {
        commit(photoBatch.map(function (p) { return p.path }))
      })
  },

  onCancelPhotos: function () {
    this.setData({ showPhotoActions: false, uploadedPhotos: [], uploadedPhotoBoxes: [] })
  },

  onRemovePhoto: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var photos = this.data.uploadedPhotos.filter(function (_, i) { return i !== idx })
    var boxes = (this.data.uploadedPhotoBoxes || []).filter(function (_, i) { return i !== idx })
    this.setData({
      uploadedPhotos: photos,
      uploadedPhotoBoxes: boxes,
      showPhotoActions: photos.length > 0
    })
  },

  // ── 圈选患处 ──────────────────────────────

  onOpenLesionSelector: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var photos = this.data.uploadedPhotos
    if (!photos[idx]) return
    var existing = this.data.uploadedPhotoBoxes ? this.data.uploadedPhotoBoxes[idx] : null
    this.setData({
      selectorVisible: true,
      selectorImageIndex: idx,
      selectorImagePath: photos[idx],
      selectorInitialBox: existing || null
    })
  },

  onLesionSave: function (e) {
    var idx = this.data.selectorImageIndex
    if (idx < 0) {
      this._closeLesionSelector()
      return
    }
    if (this.data.uploadedPhotos[idx]) {
      var boxes = (this.data.uploadedPhotoBoxes || []).slice()
      while (boxes.length <= idx) boxes.push(null)
      boxes[idx] = e.detail.box
      this.setData({ uploadedPhotoBoxes: boxes })
    }
    this._closeLesionSelector()
    wx.showToast({ title: '已圈选', icon: 'success' })
  },

  onLesionClear: function () {
    var idx = this.data.selectorImageIndex
    if (idx >= 0 && this.data.uploadedPhotos[idx]) {
      var boxes = (this.data.uploadedPhotoBoxes || []).slice()
      boxes[idx] = null
      this.setData({ uploadedPhotoBoxes: boxes })
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


  // ── 核心发送逻辑 ────────────────────────────

  _sendUserMessage: function (text, quickReply, imagePath, photoBatch) {
    var self = this
    if (self._isProcessing) return
    self._isProcessing = true

    var userMsg = {
      id: 'user_' + Date.now(), role: 'user', text: text,
      image: imagePath || '',
      images: photoBatch ? photoBatch.map(function (p) { return p.path }) : [],
      timestamp: Date.now()
    }
    appendSessionMessage(self._session, userMsg)
    self.setData({
      messages: self._formatMessages(),
      inputText: '', quickReplies: []
    })
    self._scrollToBottom()

    setTimeout(function () {
      chatDoctor.processUserInput(self._session, text || '', quickReply)
        .then(function (result) {
          self._session = result.session

          if (result.action === 'new') { self._isProcessing = false; self.onNewChat(); return }
          if (result.action === 'report') { self._isProcessing = false; self.onViewReport(); return }

          if (result.doctorMsg) {
            appendSessionMessage(self._session, result.doctorMsg)
          }
          self.setData({ messages: self._formatMessages() })
          self._updateProgress()
          chatDoctor.saveDraft(self._session)
          self._scrollToBottom()

          // 页面级快捷选项以 doctorMsg 为准：错误追问时 doctorMsg 携带的是
          // “缺哪个字段问哪个”的选项，不能被阶段默认选项（如宠物种类）覆盖（BUG-C1）
          var msgData = chatDoctor.getDoctorMessage(result.session.phase, result.session.draft)
          var uiSource = result.doctorMsg || msgData
          self.setData({
            quickReplies: uiSource.quickReplies || [],
            inputType: uiSource.inputType || msgData.inputType,
            placeholder: uiSource.placeholder || msgData.placeholder || '输入消息…',
            draftPetName: result.session.draft.petName || '', showNewBtn: false
          })

          if (result.session.phase === chatDoctor.PHASE.ANALYZING) {
            self._runDiagnosis()
            return
          }
          self._isProcessing = false
        })
        .catch(function (err) {
          console.error('[chat] processUserInput error:', err)
          self._isProcessing = false
          wx.showToast({ title: '处理失败，请重试', icon: 'none' })
        })
    }, 350)
  },

  // ── 诊断分析 ──────────────────────────────

  _runDiagnosis: function () {
    var self = this
    var draft = self._session.draft
    self.setData({ isAnalyzing: true })

    var petInfo = chatDoctor.buildPetInfoForDiagnose(draft)
    // BUG-C10：恢复会话后补图，photoBase64s 只含新图（saveDraft 持久化时清空 base64），
    // 与 photoPaths 数量不一致时若直接用 photoBase64s 会丢旧照片；改为按 photoPaths 全量读回。
    var images = (draft.photoBase64s && draft.photoBase64s.length) ? draft.photoBase64s : []
    var pathCount = (draft.photoPaths && draft.photoPaths.length) ? draft.photoPaths.length : 0
    var needReload = pathCount > 0 && images.length !== pathCount

    function doDiagnose(imgList) {
      if (!imgList || imgList.length === 0) {
        self._handleDiagnosisError('没有收到照片，请重新上传')
        return
      }
      // 与首页链路对齐：圈选了患处就裁 ROI 放大图一起送模型（BUG-C4）
      imageUtil.cropAllLesionRegions(draft.photoPaths || [], draft.lesionBoxes || [], self)
        .catch(function () { return [] })
        .then(function (roiImages) {
          var bundle = imageUtil.buildModelImageBundle(imgList, petInfo.imageRoles || [], roiImages || [])
          var requestPetInfo = Object.assign({}, petInfo, {
            imageRoles: bundle.roles,
            totalImageCount: imgList.length
          })
          if (bundle.droppedCount > 0) {
            wx.showToast({
              title: 'AI 本次分析 ' + bundle.images.length + ' 张关键照片',
              icon: 'none',
              duration: 2000
            })
          }
          analytics.track('submit', { imageCount: imgList.length, source: 'chat' })
          return api.diagnose(bundle.images, requestPetInfo, {})
        })
        .then(function (result) {
          if (!result || !result.success) {
            self._handleDiagnosisError((result && result.error) || '分析失败，请重试')
            return
          }
          self._session.draft.diagnosisResult = result
          self._saveProfileAndRecord(result, function () {
            self._session.phase = chatDoctor.PHASE.RESULT
            chatDoctor.saveDraft(self._session)

            var msgData = chatDoctor.getDoctorMessage(chatDoctor.PHASE.RESULT, self._session.draft)
            var resultMsg = { id: 'result_' + Date.now(), role: 'doctor', text: msgData.text, quickReplies: [], inputType: 'result', timestamp: Date.now() }
            appendSessionMessage(self._session, resultMsg)
            chatDoctor.saveDraft(self._session)

            self.setData({
              messages: self._formatMessages(),
              isAnalyzing: false, inputType: 'result'
            })
            self._updateProgress()
            self._scrollToBottom()

            setTimeout(function () {
              var followMsgData = chatDoctor.getDoctorMessage(chatDoctor.PHASE.FOLLOW_UP, self._session.draft)
              var followMsg = { id: 'followup_' + Date.now(), role: 'doctor', text: followMsgData.text, quickReplies: followMsgData.quickReplies, inputType: followMsgData.inputType, placeholder: followMsgData.placeholder, timestamp: Date.now() }
              self._session.phase = chatDoctor.PHASE.FOLLOW_UP
              appendSessionMessage(self._session, followMsg)
              chatDoctor.saveDraft(self._session)
              self.setData({
                messages: self._formatMessages(),
                quickReplies: followMsgData.quickReplies, inputType: 'text',
                placeholder: followMsgData.placeholder, showNewBtn: true
              })
              self._updateProgress()
              self._scrollToBottom()
              self._isProcessing = false
            }, 1500)
          })
        })
        .catch(function (err) {
          console.error('[chat] diagnose failed:', err)
          var errMsg = (err && err.errMsg) || (err && err.message) || '网络异常，请重试'
          if (errMsg.indexOf('timeout') >= 0) errMsg = '分析超时，请重试'
          self._handleDiagnosisError(errMsg)
        })
    }

    if (needReload) {
      // 恢复会话/补图场景：photoBase64s 与 photoPaths 数量不一致，
      // 从本地文件全量读回，避免只送新照片而丢失旧照片（BUG-C10）
      imageUtil.localPathsToBase64(draft.photoPaths)
        .then(function (b64s) { doDiagnose(b64s) })
        .catch(function () { self._handleDiagnosisError('没有收到照片，请重新上传') })
      return
    }
    if (images.length > 0) {
      doDiagnose(images)
      return
    }
    self._handleDiagnosisError('没有收到照片，请重新上传')
  },

  _handleDiagnosisError: function (errMsg) {
    var self = this
    self._session.draft.diagnosisResult = { success: false, error: errMsg }
    self._session.phase = chatDoctor.PHASE.RESULT
    chatDoctor.saveDraft(self._session)

    var resultMsg = {
      id: 'result_' + Date.now(), role: 'doctor',
      text: '抱歉，分析出了点问题：' + errMsg + '\n\n可以重新拍几张照片试试，或者多描述一些细节。',
      timestamp: Date.now()
    }
    appendSessionMessage(self._session, resultMsg)
    chatDoctor.saveDraft(self._session)
    self.setData({
      messages: self._formatMessages(),
      isAnalyzing: false, inputType: 'text',
      quickReplies: [{ value: 'new', label: '开始新问诊', field: 'action', key: 'act_new' }]
    })
    self._updateProgress()
    self._scrollToBottom()
    self._isProcessing = false
  },

  // ── 保存档案和记录 ──────────────────────────────

  _saveProfileAndRecord: function (diagnosisResult, callback) {
    var self = this
    var draft = self._session.draft

    // 保存档案（新建的才存）
    if (!draft.profileId && chatDoctor.canSaveProfile(draft)) {
      var profile = storage.addPetProfile({
        petName: draft.petName, petType: draft.petType, petTypeLabel: draft.petTypeLabel,
        breed: draft.breed, gender: draft.gender, genderLabel: draft.genderLabel,
        age: draft.age, ageLabel: draft.ageLabel, weight: draft.weight,
        sterilized: draft.sterilized, sterilizedLabel: draft.sterilizedLabel,
        allergy: draft.allergy, medicalHistory: draft.medicalHistory, avatar: draft.avatar || ''
      })
      if (profile && profile.id) {
        draft.profileId = profile.id
        storage.setActiveProfileId(profile.id)
      }
    }

    // 保存问诊记录（完整字段，与 index.js 一致）
    var d = (diagnosisResult && diagnosisResult.data) || {}

    // 先把 base64 图片持久化到本地用户目录，避免把大体积 base64 直接写进
    // localStorage 撑爆 10MB 配额；持久化失败则退化为存原始路径，保证记录不丢
    var rawImages = (draft.photoPaths && draft.photoPaths.length) ? draft.photoPaths : []
    if (rawImages.length === 0) {
      self._commitRecord(draft, d, [], callback)
      return
    }
    imageUtil.saveImagesPermanent(rawImages).then(function (savedInfos) {
      var localPaths = savedInfos.map(function (s) { return s.path || '' }).filter(Boolean)
      self._commitRecord(draft, d, localPaths.length ? localPaths : rawImages, callback)
    }).catch(function () {
      self._commitRecord(draft, d, rawImages, callback)
    })
  },

  _commitRecord: function (draft, d, imagePaths, callback) {
    // 同一会话重新诊断（如追问阶段补图）时替换旧记录，避免一次问诊产生多条记录（BUG-C6）
    if (typeof draft.recordId === 'string' && draft.recordId && storage.getRecordById(draft.recordId)) {
      storage.deleteRecord(draft.recordId)
    }
    var record = storage.addRecord({
      profileId: draft.profileId || '',
      petName: draft.petName, petType: draft.petType, petTypeLabel: draft.petTypeLabel,
      species: draft.petType, breed: draft.breed,
      gender: draft.gender, genderLabel: draft.genderLabel,
      age: draft.age, ageLabel: draft.ageLabel,
      weight: draft.weight, sterilized: draft.sterilized, sterilizedLabel: draft.sterilizedLabel,
      allergy: draft.allergy, medicalHistory: draft.medicalHistory, avatar: draft.avatar,
      bodyPart: draft.bodyPart, bodyPartLabel: draft.bodyPartLabel,
      complaint: chatDoctor.buildComplaintText(draft),
      imagePaths: imagePaths, lesionBoxes: draft.lesionBoxes,
      disease: d.disease || d.primaryDiagnosis || '',
      primaryDiagnosis: d.primaryDiagnosis || d.disease || '',
      primaryDiagnosisProbability: d.primaryDiagnosisProbability,
      diagnosisCandidates: d.diagnosisCandidates || [],
      lesionType: d.lesionType || '', lesionNameCn: d.lesionNameCn || '',
      confidence: d.confidence, confidenceRaw: d.confidenceRaw,
      confidenceLabel: d.confidenceLabel || '',
      homeCare: d.homeCare || d.careSuggestion || '',
      whenToWatch: d.whenToWatch || '',
      whenToSeeVet: d.whenToSeeVet || d.vetWarning || '',
      careSuggestion: d.careSuggestion || '', vetWarning: d.vetWarning || '',
      observations: d.observations || '', explanation: d.explanation || '',
      possibleMeaning: d.possibleMeaning || '',
      urgency: d.urgency || 'low', urgencyLabel: d.urgencyLabel || '',
      urgencyDesc: d.urgencyDesc || '', redLineFlags: d.redLineFlags || [],
      diagnosisProbabilityNote: d.diagnosisProbabilityNote || '',
      disclaimer: d.disclaimer || '', modelName: d.modelName || '', generatedAt: d.generatedAt || '',
      ragTitle: d.ragTitle || '', ragSummary: d.ragSummary || '',
      ragBasis: d.ragBasis || '', ragRecommendation: d.ragRecommendation || '',
      ragSources: d.ragSources || [],
      ragMatchName: d._ragMatchName || '', ragMatchScore: d._ragMatchScore || 0,
      ragMatched: d._ragMatched || [],
      modelProvider: d.modelProvider || 'qwen', modelProviderLabel: d.modelProviderLabel || 'Qwen3.7-Plus',
      isTemporary: !draft.profileId, source: 'chat'
    })
    if (record && record.id) draft.recordId = record.id
    chatDoctor.saveDraft(this._session)
    if (callback) callback()
  },

  // ── 查看报告 ──────────────────────────────

  onViewReport: function () {
    var recordId = this._session && this._session.draft && this._session.draft.recordId
    if (!recordId) { wx.showToast({ title: '暂无报告', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/chat/report/report?id=' + recordId })
  },

  // ── 新建问诊 ──────────────────────────────

  onNewChat: function () {
    var self = this
    wx.showModal({
      title: '开始新问诊',
      content: '将清空当前对话，开始新的问诊。',
      confirmText: '新建',
      success: function (res) {
        if (!res.confirm) return
        chatDoctor.clearDraft()
        self._session = null
        self.checkProfilesAndStart()
      }
    })
  },

  // 从会话消息重建渲染列表；同分钟只在分组首条显示居中时间戳（2b）
  _formatMessages: function () {
    var msgs = (this._session && this._session.messages) || []
    var out = []
    var lastTime = ''
    for (var i = 0; i < msgs.length; i++) {
      var f = formatMessage(msgs[i])
      if (!f) continue
      f.showTime = !!f.timeText && f.timeText !== lastTime
      if (f.timeText) lastTime = f.timeText
      out.push(f)
    }
    return out
  },

  // 问诊进度：仅在提问阶段展示「已问 N / 约 5 个问题」
  _updateProgress: function () {
    var phase = this._session && this._session.phase
    var questioning = phase === chatDoctor.PHASE.GREETING || phase === chatDoctor.PHASE.COMPLAINT
    var count = 0
    var msgs = (this._session && this._session.messages) || []
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role === 'doctor' && (msgs[i].text || '').length) count++
    }
    this.setData({
      showProgress: questioning && count > 0,
      progressText: '已问 ' + Math.min(count, 5) + ' / 约 5 个问题'
    })
  },

  onSkipQuestion: function () {
    if (this._isProcessing) return
    this._sendUserMessage('这个不太清楚，先跳过', null, null)
  },

  _scrollToBottom: function () {
    var self = this
    self.setData({ scrollIntoView: '' }, function () {
      setTimeout(function () { self.setData({ scrollIntoView: 'msg-bottom' }) }, 100)
    })
  },

  noop: function () {}
})
