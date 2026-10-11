var recordEvidence = require('../../utils/recordEvidence')
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
    id: msg.id, role: msg.role,
    text: msg.role === 'doctor' ? chatDoctor.toPlainDoctorText(msg.text) : (msg.text || ''),
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
    showProfilePicker: false, pickerClosing: false, profiles: [],
    composerFocused: false,
    statusBarHeight: 20,
    isAnalyzing: false, draftPetName: '',
    showProgress: false, progressText: '', showSkip: false,
    restoredNotice: false, scrollIntoView: '',
    menuRight: 0,
    uploadedPhotos: [], uploadedPhotoBoxes: [], showPhotoActions: false,
    selectorVisible: false, selectorImageIndex: -1, selectorImagePath: '',
    selectorInitialBox: null
  },

  _session: null, _isProcessing: false,

  onLoad: function () {
    var statusBarHeight = 20
    var menuRight = 0
    try {
      var winInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      statusBarHeight = winInfo.statusBarHeight || 20
      // 右上角胶囊按钮：custom 导航下微信仍悬浮显示，需预留其宽度，
      // 否则自绘 header 右侧按钮会被胶囊遮挡/挤出屏幕
      var menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      if (menuRect && menuRect.width && winInfo.windowWidth) {
        menuRight = winInfo.windowWidth - menuRect.left
      }
    } catch (e) {}
    this.setData({ statusBarHeight: statusBarHeight, menuRight: menuRight })

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
      // BUG-C14：诊断在飞行中时同样不能重建会话（与 onNewChat 同一竞态）；
      // 保留标记不消费，等分析结束后的下次 onShow 再开始新对话
      if (this._isProcessing || this.data.isAnalyzing) {
        wx.showToast({ title: '正在分析中，请稍候', icon: 'none' })
        return
      }
      wx.removeStorageSync('chat_start_new')
      chatDoctor.clearDraft()
      this._session = null
      this.checkProfilesAndStart()
      return
    }
    // 追问阶段回到页面：保持底部输入可用（新问诊/历史按钮常驻顶部）
  },

  onUnload: function () {
    this._analysisClosed=true
    if (this._pickerTimer) clearTimeout(this._pickerTimer)
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
        pickerClosing: false,
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
    this.dismissProfilePicker(profile || null, true)
  },

  onPickNewProfile: function () {
    this.dismissProfilePicker(null, true)
  },

  closeProfilePicker: function () {
    this.dismissProfilePicker(null, false)
  },

  dismissProfilePicker: function (profile, picked) {
    if (!this.data.showProfilePicker || this.data.pickerClosing) return
    this.setData({ pickerClosing: true })
    if (picked || !this._session) this.initChat(profile)
    var self = this
    this._pickerTimer = setTimeout(function () {
      self._pickerTimer = null
      self.setData({ showProfilePicker: false, pickerClosing: false })
    }, 240)
  },

  // ── 初始化对话 ──────────────────────────────

  initChat: function (profile) {
    var result = profile ? chatDoctor.initSessionWithProfile(profile) : chatDoctor.initSession()
    var session = result.session
    this._session = session
    this._uploadedPhotoBase64 = []
    var msgData = chatDoctor.getDoctorMessage(session.phase, session.draft)
    this.setData({
      messages: this._formatMessages(),
      quickReplies: msgData.quickReplies,
      inputType: msgData.inputType,
      placeholder: msgData.placeholder || '输入消息…',
      draftPetName: session.draft.petName || '',
      restoredNotice: result.restored,
      uploadedPhotos: [], uploadedPhotoBoxes: [], showPhotoActions: false,
      isAnalyzing: false
    })
    this._updateProgress()
    this._isProcessing = false
    this._scrollToBottom()
  },

  dismissRestoredNotice: function () { this.setData({ restoredNotice: false }) },

  // 历史记录：跳档案 tab（detail 页按来源区分「对话问诊/拍照初筛」展示）
  goHistory: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  },

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
  onInputFocus: function () { this.setData({ composerFocused: true }) },
  onInputBlur: function () { this.setData({ composerFocused: false }) },

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
            // base64 只放实例变量、不进 setData（对齐首页 BUG-B2）；展示用 vetai_tmp
            // 本地路径，避免 MB 级字符串进 data 卡渲染。
            if (!self._uploadedPhotoBase64) self._uploadedPhotoBase64 = []
            var base64List = photoBatch.map(function (p) { return p.base64 })
            var persistTasks = base64List.map(function (b64) {
              return imageUtil.base64ToLocalFile(b64, b64, 'vetai_tmp')
            })
            Promise.all(persistTasks).then(function (localPaths) {
              var newPhotos = self.data.uploadedPhotos.concat(localPaths.map(function (lp, i) {
                return lp && lp.indexOf('data:') !== 0 ? lp : base64List[i]
              }))
              var newBoxes = (self.data.uploadedPhotoBoxes || []).concat(photoBatch.map(function () { return null }))
              self._uploadedPhotoBase64 = self._uploadedPhotoBase64.concat(base64List)
              self.setData({
                uploadedPhotos: newPhotos.slice(0, MAX_CHAT_PHOTOS),
                uploadedPhotoBoxes: newBoxes.slice(0, MAX_CHAT_PHOTOS),
                showPhotoActions: true
              })
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
    // base64 取自实例变量（uploadedPhotos 里存的是本地展示路径），
    // 落盘/诊断仍用 base64，展示路径只在图片展示时使用。
    var base64s = (self._uploadedPhotoBase64 || []).slice(0, photos.length)
    var photoBatch = photos.map(function (p, i) { return { path: p, base64: base64s[i] || p } })
    var photoBoxes = (self.data.uploadedPhotoBoxes || []).slice(0, photos.length)
    self.setData({ showPhotoActions: false, uploadedPhotos: [], uploadedPhotoBoxes: [] })
    self._uploadedPhotoBase64 = []
    self._isProcessing = true

    // 把 base64 图片落盘为本地文件，避免把大体积 base64 写进会话消息 / localStorage（10MB 配额风险）
    function commit(finalPaths) {
      var existingPathCount = self._session.draft.photoPaths.length
      var boxes = self._session.draft.lesionBoxes || []
      while (boxes.length < existingPathCount) boxes.push(null)
      self._session.draft.photoPaths = self._session.draft.photoPaths.concat(finalPaths)
      self._session.draft.pendingPhotoAnalysis = !self._session.draft.petType
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

      if (self._session.draft.petType) {
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
        self._session.phase = chatDoctor.PHASE.COMPLAINT
        var askType = {
          id: 'doc_' + Date.now(), role: 'doctor',
          text: '照片收到了。先告诉我是猫、狗还是其他动物，我再结合照片分析。',
          quickReplies: chatDoctor.getReaskQuickReplies(self._session.draft),
          inputType: 'text', placeholder: '告诉我宠物种类…', timestamp: Date.now()
        }
        appendSessionMessage(self._session, askType)
        chatDoctor.saveDraft(self._session)
        self.setData({
          messages: self._formatMessages(), quickReplies: askType.quickReplies,
          inputType: 'text', placeholder: askType.placeholder
        })
        self._updateProgress()
        self._scrollToBottom()
        self._isProcessing = false
      }
    }

    imageUtil.saveImagesPermanent(photoBatch.map(function (p) { return p.base64 }))
      .then(function (savedInfos) {
        var localPaths = savedInfos.map(function (s) { return s.path || '' }).filter(Boolean)
        // 落盘到 vetai_saved 成功用永久路径；部分失败时退化为选图阶段已落盘的
        // vetai_tmp 本地路径（由 cleanupStaleImages 按引用保护），保证功能不中断
        commit(localPaths.length === photoBatch.length ? localPaths : photoBatch.map(function (p) { return p.path }))
      })
      .catch(function () {
        commit(photoBatch.map(function (p) { return p.path }))
      })
  },

  onCancelPhotos: function () {
    this._uploadedPhotoBase64 = []
    this.setData({ showPhotoActions: false, uploadedPhotos: [], uploadedPhotoBoxes: [] })
  },

  onRemovePhoto: function (e) {
    var idx = parseInt(e.currentTarget.dataset.index)
    var photos = this.data.uploadedPhotos.filter(function (_, i) { return i !== idx })
    var boxes = (this.data.uploadedPhotoBoxes || []).filter(function (_, i) { return i !== idx })
    this._uploadedPhotoBase64 = (this._uploadedPhotoBase64 || []).filter(function (_, i) { return i !== idx })
    this.setData({
      uploadedPhotos: photos,
      uploadedPhotoBoxes: boxes,
      showPhotoActions: photos.length > 0
    })
  },

  // ── 圈选患处 ──────────────────────────────

  // BUG-UI25：待上传的照片原先不能点开看大图，用户无法确认拍清楚没有
  onPreviewPhoto: function (e) {
    var photos = this.data.uploadedPhotos || []
    if (!photos.length) return
    var idx = parseInt(e.currentTarget.dataset.index, 10)
    if (isNaN(idx) || idx < 0 || idx >= photos.length) idx = 0
    wx.previewImage({ current: photos[idx], urls: photos })
  },

  // BUG-UI25：对话里的照片也支持点开看大图
  onPreviewMessageImage: function (e) {
    var src = e.currentTarget.dataset.src
    if (!src) return
    wx.previewImage({ current: src, urls: [src] })
  },

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
            draftPetName: result.session.draft.petName || ''
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
    if(self.data.isAnalyzing)return
    var session = self._session
    var ownerScope = storage.getUserScope()
    self._diagnosisOwnerScope=ownerScope
    function cancelled(){return self._analysisClosed || self._session!==session || storage.getUserScope()!==ownerScope}
    self._diagnosisCancelled=cancelled
    var draft = self._session.draft
    self.setData({ isAnalyzing: true })

    var petInfo = chatDoctor.buildPetInfoForDiagnose(draft)
    // BUG-C10：恢复会话后补图，photoBase64s 只含新图（saveDraft 持久化时清空 base64），
    // 与 photoPaths 数量不一致时若直接用 photoBase64s 会丢旧照片；改为按 photoPaths 全量读回。
    var images = (draft.photoBase64s && draft.photoBase64s.length) ? draft.photoBase64s : []
    var pathCount = (draft.photoPaths && draft.photoPaths.length) ? draft.photoPaths.length : 0
    var needReload = pathCount > 0 && images.length !== pathCount

    function doDiagnose(imgList) {
      if(cancelled())return
      if (!imgList || imgList.length === 0) {
        self._handleDiagnosisError('没有收到照片，请重新上传')
        return
      }
      // 与首页链路对齐：圈选了患处就裁 ROI 放大图一起送模型（BUG-C4）
      var manifest = imageUtil.createImageManifest(draft.photoPaths || imgList, petInfo.imageRoles || [], draft.lesionBoxes || [])
      imageUtil.cropAllLesionRegions(draft.photoPaths || [], draft.lesionBoxes || [], self, manifest)
        .catch(function () { return [] })
        .then(function (roiImages) {
          if(cancelled())return
          var bundle = imageUtil.buildModelImageBundle(imgList, petInfo.imageRoles || [], roiImages || [], manifest)
          self._diagnosisBundle=bundle
          var requestPetInfo = Object.assign({}, petInfo, {
            imageRoles: bundle.roles,
            imageManifest: bundle.manifest,
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
          return api.diagnose(bundle.images, requestPetInfo, {ownerScope:ownerScope,isCancelled:cancelled})
        })
        .then(function (result) {
          if(cancelled())return
          if (!result || !result.success) {
            // BUG-UI45：统一走 api.friendlyError，避免 raw errMsg（cloud.callFunction:fail 等）
            // 以及「知识库」这类内部机制词直接出现在用户可见气泡里
            self._handleDiagnosisError(api.friendlyError((result && result.error) || ''))
            return
          }
          self._session.draft.diagnosisResult = result
          self._saveProfileAndRecord(result, function () {
            if(cancelled())return
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
              if(cancelled())return
              var followMsgData = chatDoctor.getDoctorMessage(chatDoctor.PHASE.FOLLOW_UP, self._session.draft)
              var followMsg = { id: 'followup_' + Date.now(), role: 'doctor', text: followMsgData.text, quickReplies: followMsgData.quickReplies, inputType: followMsgData.inputType, placeholder: followMsgData.placeholder, timestamp: Date.now() }
              self._session.phase = chatDoctor.PHASE.FOLLOW_UP
              appendSessionMessage(self._session, followMsg)
              chatDoctor.saveDraft(self._session)
              self.setData({
                messages: self._formatMessages(),
                quickReplies: followMsgData.quickReplies, inputType: 'text',
                placeholder: followMsgData.placeholder
              })
              self._updateProgress()
              self._scrollToBottom()
              self._isProcessing = false
            }, 1500)
          })
        })
        .catch(function (err) {
          if(cancelled())return
          console.error('[chat] diagnose failed:', err)
          // BUG-UI45：同样走友好化，原先只有含 timeout 的串被替换，其余 raw errMsg 直接透出
          self._handleDiagnosisError(api.friendlyError(err))
        })
    }

    if (needReload) {
      // 恢复会话/补图场景：photoBase64s 与 photoPaths 数量不一致，
      // 从本地文件全量读回，避免只送新照片而丢失旧照片（BUG-C10）
      imageUtil.localPathsToBase64(draft.photoPaths, {preservePositions:true})
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
    self._session.draft.pendingPhotoAnalysis = false
    self._session.phase = chatDoctor.PHASE.COMPLAINT
    chatDoctor.saveDraft(self._session)

    var resultMsg = {
      id: 'result_' + Date.now(), role: 'doctor',
      text: '抱歉，照片分析出了点问题：' + errMsg + '\n\n你可以继续描述或提问，也可以重新添加照片。',
      timestamp: Date.now()
    }
    appendSessionMessage(self._session, resultMsg)
    chatDoctor.saveDraft(self._session)
    self.setData({
      messages: self._formatMessages(),
      isAnalyzing: false, inputType: 'text',
      quickReplies: [], placeholder: '继续描述或提问…'
    })
    self._updateProgress()
    self._scrollToBottom()
    self._isProcessing = false
  },

  // ── 保存档案和记录 ──────────────────────────────

  _saveProfileAndRecord: function (diagnosisResult, callback) {
    var self = this
    if(self._diagnosisCancelled && self._diagnosisCancelled())return
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
      if(self._diagnosisCancelled && self._diagnosisCancelled())return
      var localPaths = savedInfos.map(function (s) { return s.path || '' })
      if(localPaths.some(function(p){return !p}))throw Error('照片未完整保存')
      return imageUtil.persistAssessmentImages(d,self._diagnosisBundle||{}).then(function(sentInfos){
        if(self._diagnosisCancelled && self._diagnosisCancelled())return
        self._imageProtection=imageUtil.protectImagePaths(localPaths.concat(sentInfos.map(function(s){return s.path})))
        self._commitRecord(draft, d, localPaths, callback)
      })
    }).catch(function () {
      if(self._diagnosisCancelled && self._diagnosisCancelled())return
      self.setData({isAnalyzing:false,hasPendingResult:true});self._isProcessing=false
      wx.showModal({title:'照片保存失败',content:'本次初筛结果保留在本页，请重试保存。',showCancel:false})
    })
  },

  _commitRecord: function (draft, d, imagePaths, callback) {
    if(this._diagnosisCancelled && this._diagnosisCancelled())return
    // 同一会话重新诊断（如追问阶段补图）时替换旧记录，避免一次问诊产生多条记录（BUG-C6）
    var ownerScope=this._diagnosisOwnerScope || storage.getUserScope()
    var replaceId=typeof draft.recordId==='string' && draft.recordId && storage.getRecordById(draft.recordId) ? draft.recordId : ''
    var commit = storage.commitRecord(Object.assign(recordEvidence.fields(d), {
      profileId: draft.profileId || '',
      petName: draft.petName || '未命名宠物', petType: draft.petType, petTypeLabel: draft.petTypeLabel,
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
      modelProvider: d.modelProvider || 'qwen', modelProviderLabel: d.modelProviderLabel || 'Qwen3.8-Flash',
      isTemporary: !draft.profileId, source: 'chat'
    }), {ownerScope:ownerScope,replaceId:replaceId})
    if(!commit.success){this.setData({isAnalyzing:false,hasPendingResult:true});this._isProcessing=false;wx.showModal({title:'保存失败',content:'原记录和本次初筛均已保留，请检查存储空间后重试。',showCancel:false});return}
    draft.recordId = commit.record.id
    if(this._imageProtection)imageUtil.releaseImagePaths(this._imageProtection)
    if(!chatDoctor.saveDraft(this._session,ownerScope)){wx.showToast({title:'记录已保存，聊天草稿保存失败，可从档案重开',icon:'none'})}
    if (callback) callback()
  },
  onRetrySave: function(){
    var self=this,result=self._session.draft.diagnosisResult
    if(!result||!result.success)return
    self._saveProfileAndRecord(result,function(){self.setData({hasPendingResult:false});wx.navigateTo({url:'/pages/chat/report/report?id='+self._session.draft.recordId})})
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
    // BUG-C14：诊断在飞行中时禁止重建会话——_runDiagnosis 的闭包通过
    // self._session 动态取值，此时替换 _session 会把旧问诊的结果/错误写进
    // 新会话的 draft 并向其追加消息。快捷回复路径在进入前已复位 _isProcessing，
    // 不会被这里拦住；拦截的是顶部「新问诊」按钮这条无防护入口。
    if (this._isProcessing || this.data.isAnalyzing) {
      wx.showToast({ title: '正在分析中，请稍候', icon: 'none' })
      return
    }
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

  // 多轮对话没有固定题数，也不需要“跳过这题”的问卷式入口。
  _updateProgress: function () {
    this.setData({ showProgress: false, showSkip: false, progressText: '' })
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
