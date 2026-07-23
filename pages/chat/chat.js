var chatDoctor = require('../../utils/chatDoctor')
var storage = require('../../utils/storage')
var api = require('../../utils/api')
var imageUtil = require('../../utils/image')

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
      messages: session.messages.map(formatMessage),
      quickReplies: msgData.quickReplies,
      inputType: msgData.inputType,
      placeholder: msgData.placeholder || '输入消息…',
      draftPetName: session.draft.petName || '',
      showNewBtn: false, restoredNotice: result.restored,
      uploadedPhotos: [], uploadedPhotoBoxes: [], showPhotoActions: false,
      isAnalyzing: false
    })
    this._isProcessing = false
    this._scrollToBottom()
  },

  dismissRestoredNotice: function () { this.setData({ restoredNotice: false }) },

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
    var remaining = 3 - confirmedCount - self.data.uploadedPhotos.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传 3 张照片', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: function (res) {
        var tempPaths = res.tempFilePaths || []
        if (tempPaths.length === 0) return
        wx.showLoading({ title: '处理图片中', mask: true })
        tempPaths.reduce(function (chain, p) {
          return chain.then(function (acc) {
            return imageUtil.processImage(p, self).then(function (b64) {
              acc.push({ path: b64, base64: b64 })
              return acc
            })
          })
        }, Promise.resolve([]))
          .then(function (photoBatch) {
            wx.hideLoading()
            var newPhotos = self.data.uploadedPhotos.concat(photoBatch.map(function (p) { return p.path }))
            var newBoxes = (self.data.uploadedPhotoBoxes || []).concat(photoBatch.map(function () { return null }))
            self.setData({
              uploadedPhotos: newPhotos.slice(0, 3),
              uploadedPhotoBoxes: newBoxes.slice(0, 3),
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
        messages: self.data.messages.concat([formatMessage(userMsg)])
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
          messages: self.data.messages.concat([formatMessage(receiveMsg)]),
          inputType: 'analyzing'
        })
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
      messages: self.data.messages.concat([formatMessage(userMsg)]),
      inputText: '', quickReplies: []
    })
    self._scrollToBottom()

    setTimeout(function () {
      chatDoctor.processUserInput(self._session, text || '', quickReply)
        .then(function (result) {
          self._session = result.session

          if (result.action === 'new') { self._isProcessing = false; self.onNewChat(); return }
          if (result.action === 'report') { self._isProcessing = false; self.onViewReport(); return }

          var newMessages = self.data.messages
          if (result.doctorMsg) {
            appendSessionMessage(self._session, result.doctorMsg)
            newMessages = newMessages.concat([formatMessage(result.doctorMsg)])
          }
          self.setData({ messages: newMessages })
          chatDoctor.saveDraft(self._session)
          self._scrollToBottom()

          var msgData = chatDoctor.getDoctorMessage(result.session.phase, result.session.draft)
          self.setData({
            quickReplies: msgData.quickReplies, inputType: msgData.inputType,
            placeholder: msgData.placeholder || '输入消息…',
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
    var images = (draft.photoBase64s && draft.photoBase64s.length) ? draft.photoBase64s : []

    function doDiagnose(imgList) {
      if (!imgList || imgList.length === 0) {
        self._handleDiagnosisError('没有收到照片，请重新上传')
        return
      }
      api.diagnose(imgList, petInfo, {})
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
              messages: self.data.messages.concat([formatMessage(resultMsg)]),
              isAnalyzing: false, inputType: 'result'
            })
            self._scrollToBottom()

            setTimeout(function () {
              var followMsgData = chatDoctor.getDoctorMessage(chatDoctor.PHASE.FOLLOW_UP, self._session.draft)
              var followMsg = { id: 'followup_' + Date.now(), role: 'doctor', text: followMsgData.text, quickReplies: followMsgData.quickReplies, inputType: followMsgData.inputType, placeholder: followMsgData.placeholder, timestamp: Date.now() }
              self._session.phase = chatDoctor.PHASE.FOLLOW_UP
              appendSessionMessage(self._session, followMsg)
              chatDoctor.saveDraft(self._session)
              self.setData({
                messages: self.data.messages.concat([formatMessage(followMsg)]),
                quickReplies: followMsgData.quickReplies, inputType: 'text',
                placeholder: followMsgData.placeholder, showNewBtn: true
              })
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

    if (images.length > 0) {
      doDiagnose(images)
      return
    }
    // 恢复会话场景：base64 未持久化，从本地文件读回
    if (draft.photoPaths && draft.photoPaths.length) {
      imageUtil.localPathsToBase64(draft.photoPaths)
        .then(function (b64s) { doDiagnose(b64s) })
        .catch(function () { self._handleDiagnosisError('没有收到照片，请重新上传') })
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
      messages: self.data.messages.concat([formatMessage(resultMsg)]),
      isAnalyzing: false, inputType: 'text',
      quickReplies: [{ value: 'new', label: '开始新问诊', field: 'action', key: 'act_new' }]
    })
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

  _scrollToBottom: function () {
    var self = this
    self.setData({ scrollIntoView: '' }, function () {
      setTimeout(function () { self.setData({ scrollIntoView: 'msg-bottom' }) }, 100)
    })
  },

  noop: function () {}
})
