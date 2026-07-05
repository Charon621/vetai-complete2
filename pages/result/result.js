var storage = require('../../utils/storage')
var analytics = require('../../utils/analytics')

var REPORT_DISCLAIMER = '本报告由 AI 根据图片和你填写的信息生成，仅用于初步观察和就医沟通参考，不构成确诊、处方或治疗方案。若症状加重、扩散、破溃、流脓或宠物精神食欲异常，请及时就医。'

var URGENCY_MAP = {
  low: { title: '低风险观察', desc: '当前更适合记录变化并保持患处清洁。', icon: '低' },
  moderate: { title: '建议关注', desc: '建议结合病程、瘙痒、掉毛等信息继续观察。', icon: '观' },
  urgent: { title: '建议尽快就医', desc: '如范围扩大、破溃、渗出或明显疼痛，请尽快联系兽医。', icon: '医' },
  emergency: { title: '紧急就医', desc: '如快速扩散、流脓、精神食欲异常或强烈疼痛，请立即就医。', icon: '急' }
}

var SCORE_NOTE = '候选项数值是系统独立可能性评分，不是相加为 100% 的真实概率，也不代表医学确诊概率。'

var FEEDBACK_ISSUE_OPTIONS = [
  { value: 'diagnosis_wrong', label: '方向不准' },
  { value: 'evidence_weak', label: '依据不清' },
  { value: 'advice_unclear', label: '建议难用' },
  { value: 'roi_ignored', label: '圈选没用上' },
  { value: 'risk_level_wrong', label: '风险级别不对' },
  { value: 'other', label: '其他' }
]

var FEEDBACK_VET_OUTCOME_OPTIONS = [
  { value: 'consistent', label: '基本一致' },
  { value: 'partial', label: '部分一致' },
  { value: 'different', label: '不一致' },
  { value: 'unknown', label: '还不确定' }
]

function cleanText(value) {
  if (typeof value !== 'string') return value || ''
  return value.replace(/[*#`]/g, '').replace(/^\s*[-•]\s+/gm, '').trim()
}

function inferRecordSpecies(record) {
  var text = [
    record && record.petType,
    record && record.petTypeLabel,
    record && record.species
  ].join(' ')
  if (text.indexOf('猫') >= 0 || text.indexOf('cat') >= 0) return 'cat'
  if (text.indexOf('犬') >= 0 || text.indexOf('狗') >= 0 || text.indexOf('dog') >= 0) return 'dog'
  return ''
}

function displayDiagnosisName(name, record) {
  var text = cleanText(name)
  if (text === '皮肤癣菌病（犬猫）') {
    var species = inferRecordSpecies(record || {})
    if (species === 'cat') return '猫癣'
    if (species === 'dog') return '犬癣'
    return '皮肤癣菌病'
  }
  return text
}

function sanitizeReportText(value) {
  var text = cleanText(value)
  if (!text) return ''
  return text
    .replace(/视觉预检特征与本地知识库中的“([^”]+)”方向相符，建议作为候选鉴别方向之一；?/g, '照片表现与“$1”的部分特征相似，建议作为候选鉴别方向之一。')
    .replace(/该结果来自视觉特征预检\s*\+\s*本地临床知识库快速匹配，仅作初筛参考；?/g, '该结果仅作初筛参考；')
    .replace(/知识库匹配：[^\n]*(\n)?/g, '')
    .replace(/本地知识库中的/g, '')
    .replace(/知识库快速匹配/g, '临床特征匹配')
    .replace(/本地临床知识库/g, '临床参考')
    .replace(/知识库/g, '临床参考')
    .trim()
}

function normalizePercent(value) {
  if (typeof value === 'string') {
    var parsed = parseFloat(value.replace('%', '').trim())
    if (!isNaN(parsed)) value = parsed
  }
  if (typeof value !== 'number' || isNaN(value)) return null
  if (value > 0 && value <= 1) return Math.round(value * 100)
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatTimestamp(isoStr) {
  if (!isoStr) return ''
  try {
    return new Date(isoStr).toLocaleString('zh-CN', { hour12: false })
  } catch (e) {
    return isoStr
  }
}

function shortText(value, maxLen) {
  var text = cleanText(value)
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function isUsableImagePath(path) {
  if (!path || typeof path !== 'string') return false
  if (path.indexOf('http://127.0.0.1') === 0 && path.indexOf('/__tmp__/') >= 0) return false
  return true
}

function splitAdvice(value, fallback) {
  var text = cleanText(value)
  if (!text) return fallback ? [fallback] : []
  var parts = text
    .replace(/\n/g, '。')
    .split(/[。；;]\s*/)
    .map(function (item) { return item.trim() })
    .filter(Boolean)
  if (parts.length === 0) return fallback ? [fallback] : []
  return parts.slice(0, 4)
}

function buildSourceList(value) {
  var sources = Array.isArray(value) ? value : []
  var seen = {}
  var out = []
  for (var i = 0; i < sources.length; i++) {
    var source = sources[i]
    var item = {}
    if (typeof source === 'string') {
      item.title = sanitizeReportText(source)
      item.url = ''
      item.tier = ''
    } else if (source && typeof source === 'object') {
      item.title = sanitizeReportText(source.title || source.name || source.url || '')
      item.url = typeof source.url === 'string' ? source.url : ''
      item.tier = typeof source.tier === 'string' ? source.tier : ''
    }
    if (!item.title) continue
    var key = item.url || item.title
    if (seen[key]) continue
    seen[key] = true
    out.push(item)
  }
  return out.slice(0, 4)
}

Page({
  data: {
    recordId: '',
    record: {
      imageItems: [],
      diseaseList: [],
      homeCareList: [],
      watchList: [],
      vetList: [],
      sourceList: []
    },
    severityInfo: URGENCY_MAP.moderate,
    feedbackHelpful: null,
    feedbackVet: null,
    feedbackIssue: '',
    feedbackVetOutcome: '',
    feedbackIssueOptions: FEEDBACK_ISSUE_OPTIONS,
    feedbackVetOutcomeOptions: FEEDBACK_VET_OUTCOME_OPTIONS,
    feedbackSubmitted: false
  },

  onLoad: function (options) {
    if (!options.id) {
      wx.showToast({ title: '缺少记录 ID', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 1200)
      return
    }

    var record = storage.getRecordById(options.id)
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 1200)
      return
    }

    this.setData(Object.assign(this.buildDisplayRecord(record), {
      feedbackHelpful: record.feedback ? record.feedback.helpful : null,
      feedbackVet: record.feedback ? record.feedback.wentToVet : null,
      feedbackIssue: record.feedback ? (record.feedback.issueType || '') : '',
      feedbackVetOutcome: record.feedback ? (record.feedback.vetOutcome || '') : '',
      feedbackSubmitted: !!record.feedback
    }))
  },

  buildDisplayRecord: function (record) {
    var self = this
    var imagePaths = record.imagePaths && record.imagePaths.length
      ? record.imagePaths : (record.imagePath ? [record.imagePath] : [])
    imagePaths = imagePaths.filter(isUsableImagePath)
    var lesionBoxes = Array.isArray(record.lesionBoxes) ? record.lesionBoxes : []
    var imageItems = imagePaths.map(function (path, index) {
      return { path: path, hasLesion: !!lesionBoxes[index] }
    })
    var hasLesion = imageItems.some(function (item) { return item.hasLesion })

    var candidates = Array.isArray(record.diseaseList) && record.diseaseList.length
      ? record.diseaseList : (Array.isArray(record.diagnosisCandidates) ? record.diagnosisCandidates : [])
    var diseaseList = candidates.map(function (item) {
      var percent = normalizePercent(item.probability !== undefined ? item.probability : item.percent)
      return {
        name: displayDiagnosisName(item.name || '未明确', record),
        percent: percent === null ? 0 : percent,
        scoreText: percent === null ? '暂无概率' : percent + '%',
        reason: sanitizeReportText(item.reason || ''),
        supporting: sanitizeReportText(item.supporting || ''),
        against: sanitizeReportText(item.against || '')
      }
    }).slice(0, 5)

    // 置信度取排行第一的疾病概率（均取 AI 原始值，不用本地校准值）
    var confidence = null
    if (diseaseList.length > 0 && diseaseList[0].percent > 0) {
      confidence = diseaseList[0].percent
    }
    if (confidence === null) confidence = normalizePercent(record.primaryDiagnosisProbability)
    var hasConfidence = confidence !== null
    var confidenceText = hasConfidence ? confidence + '%' : '暂无概率数据'

    var modelProviderText = record.modelProviderLabel || record.modelName || ''
    var uncertainty = ''
    for (var i = 0; i < diseaseList.length; i++) {
      if (diseaseList[i].against) {
        uncertainty = diseaseList[i].against
        break
      }
    }
    if (!uncertainty) uncertainty = record.diagnosisProbabilityNote || SCORE_NOTE

    var urgency = record.urgency || 'moderate'

    // 只有通过宠物档案发起的问诊，才展示同档案历史趋势；临时问诊不做“好转/加重”判断。
    var prevRecord = record.profileId && !record.isTemporary ? self.findPreviousRecord(record) : null
    var prevCompare = null
    if (prevRecord) {
      var prevUrgency = prevRecord.urgency || 'moderate'
      var urgencyOrder = { low: 0, moderate: 1, urgent: 2, emergency: 3 }
      var diff = (urgencyOrder[urgency] || 1) - (urgencyOrder[prevUrgency] || 1)
      var trend = diff < 0 ? 'improved' : (diff > 0 ? 'worsened' : 'same')
      var trendText = diff < 0 ? '好转' : (diff > 0 ? '加重' : '持平')
      var trendIcon = diff < 0 ? '↘' : (diff > 0 ? '↗' : '→')
      prevCompare = {
        disease: cleanText(prevRecord.disease || prevRecord.primaryDiagnosis || ''),
        timeAgo: self.formatTimeAgo(prevRecord.generatedAt || prevRecord.timestamp),
        trend: trend,
        trendText: trendText,
        trendIcon: trendIcon
      }
    }

    var display = Object.assign({}, record, {
      disease: displayDiagnosisName(record.disease || record.primaryDiagnosis || record.lesionNameCn || '', record),
      primaryDiagnosis: displayDiagnosisName(record.primaryDiagnosis || '', record),
      possibleMeaning: sanitizeReportText(record.possibleMeaning || ''),
      urgency: urgency,
      imageItems: imageItems,
      hasLesion: hasLesion,
      confidencePercent: hasConfidence ? confidence : 0,
      confidenceText: confidenceText,
      hasConfidence: hasConfidence,
      diseaseList: diseaseList,
      diagnosisProbabilityNote: sanitizeReportText(record.diagnosisProbabilityNote || SCORE_NOTE),
      observationText: shortText(sanitizeReportText(record.observations || record.symptoms || ''), 160),
      supportText: shortText(sanitizeReportText(record.explanation || record.ragBasis || record.possibleMeaning || ''), 160),
      uncertaintyText: shortText(sanitizeReportText(uncertainty), 160),
      modelProviderText: modelProviderText,
      generatedAtText: formatTimestamp(record.generatedAt),
      homeCareList: splitAdvice(record.homeCare || record.careSuggestion || record.treatment, '保持患处干燥清洁'),
      watchList: splitAdvice(record.whenToWatch, '记录 2 到 3 天内范围是否扩大'),
      vetList: splitAdvice(record.whenToSeeVet || record.vetWarning, '如出现快速扩散、流脓、破溃、明显疼痛，应尽快就医'),
      sourceList: buildSourceList(record.ragSources),
      reportDisclaimer: REPORT_DISCLAIMER,
      prevCompare: prevCompare
    })

    return {
      recordId: record.id,
      record: display,
      severityInfo: URGENCY_MAP[urgency] || URGENCY_MAP.moderate
    }
  },

  findPreviousRecord: function (record) {
    var allRecords = storage.getHistory()
    var petKey = record.profileId || record.petName
    var currentTime = record.generatedAt || record.timestamp || new Date().toISOString()
    var prevRecords = allRecords.filter(function (r) {
      if (r.id === record.id) return false
      var rPetKey = r.profileId || r.petName
      if (rPetKey !== petKey) return false
      var rTime = r.generatedAt || r.timestamp || ''
      return rTime < currentTime
    }).sort(function (a, b) {
      var aTime = a.generatedAt || a.timestamp || ''
      var bTime = b.generatedAt || b.timestamp || ''
      return bTime.localeCompare(aTime)
    })
    return prevRecords.length > 0 ? prevRecords[0] : null
  },

  formatTimeAgo: function (isoStr) {
    if (!isoStr) return '之前'
    try {
      var now = new Date()
      var then = new Date(isoStr)
      var diff = now - then
      var days = Math.floor(diff / (1000 * 60 * 60 * 24))
      if (days <= 0) return '今天'
      if (days === 1) return '昨天'
      if (days < 30) return days + '天前'
      if (days < 365) return Math.floor(days / 30) + '个月前'
      return Math.floor(days / 365) + '年前'
    } catch (e) {
      return '之前'
    }
  },

  goBack: function () {
    wx.switchTab({ url: '/pages/index/index' })
  },

  goHistory: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  },

  onFeedbackHelpful: function (e) {
    var helpful = e.currentTarget.dataset.value === 'true'
    if (this.data.feedbackSubmitted) return
    var self = this
    this.setData({
      feedbackHelpful: helpful,
      feedbackIssue: helpful ? '' : this.data.feedbackIssue
    }, function () {
      self._submitFeedback()
    })
    analytics.track('feedback', { recordId: this.data.recordId, action: 'helpful', value: helpful })
  },

  onFeedbackVet: function (e) {
    var vet = e.currentTarget.dataset.value === 'true'
    if (this.data.feedbackSubmitted) return
    var self = this
    this.setData({
      feedbackVet: vet,
      feedbackVetOutcome: vet ? this.data.feedbackVetOutcome : ''
    }, function () {
      self._submitFeedback()
    })
    analytics.track('feedback', { recordId: this.data.recordId, action: 'wentToVet', value: vet })
  },

  onFeedbackIssue: function (e) {
    var issue = e.currentTarget.dataset.value || ''
    if (this.data.feedbackSubmitted) return
    var self = this
    this.setData({ feedbackIssue: issue }, function () {
      self._submitFeedback()
    })
    analytics.track('feedback', { recordId: this.data.recordId, action: 'issueType', value: issue })
  },

  onFeedbackVetOutcome: function (e) {
    var outcome = e.currentTarget.dataset.value || ''
    if (this.data.feedbackSubmitted) return
    var self = this
    this.setData({ feedbackVetOutcome: outcome }, function () {
      self._submitFeedback()
    })
    analytics.track('feedback', { recordId: this.data.recordId, action: 'vetOutcome', value: outcome })
  },

  buildFeedbackSnapshot: function () {
    var record = this.data.record || {}
    var imageItems = record.imageItems || []
    var lesionCount = 0
    for (var i = 0; i < imageItems.length; i++) {
      if (imageItems[i] && imageItems[i].hasLesion) lesionCount++
    }
    return {
      disease: record.disease || '',
      urgency: record.urgency || '',
      confidencePercent: record.confidencePercent || 0,
      modelProvider: record.modelProvider || record.modelProviderText || '',
      ragMatchName: record.ragMatchName || '',
      ragMatchScore: record.ragMatchScore || 0,
      bodyPart: record.bodyPartLabel || record.bodyPart || '',
      petType: record.petTypeLabel || record.petType || '',
      imageCount: imageItems.length,
      lesionCount: lesionCount,
      hasLesion: lesionCount > 0
    }
  },

  _submitFeedback: function () {
    if (this.data.feedbackHelpful === null || this.data.feedbackVet === null) return
    if (this.data.feedbackHelpful === false && !this.data.feedbackIssue) return
    if (this.data.feedbackVet === true && !this.data.feedbackVetOutcome) return
    var result = storage.addFeedback(this.data.recordId, {
      helpful: this.data.feedbackHelpful,
      wentToVet: this.data.feedbackVet,
      issueType: this.data.feedbackHelpful === false ? this.data.feedbackIssue : '',
      vetOutcome: this.data.feedbackVet === true ? this.data.feedbackVetOutcome : '',
      snapshot: this.buildFeedbackSnapshot()
    })
    if (result) {
      this.setData({ feedbackSubmitted: true })
      analytics.track('feedback', {
        recordId: this.data.recordId,
        action: 'submitted',
        helpful: this.data.feedbackHelpful,
        wentToVet: this.data.feedbackVet,
        issueType: this.data.feedbackIssue,
        vetOutcome: this.data.feedbackVetOutcome
      })
      wx.showToast({ title: '感谢反馈', icon: 'success' })
    }
  },

  findHospital: function () {
    wx.getLocation({
      type: 'gcj02',
      success: function (res) {
        wx.openLocation({
          latitude: res.latitude,
          longitude: res.longitude,
          name: '当前位置',
          address: '请在地图中搜索附近宠物医院'
        })
      },
      fail: function () {
        wx.showModal({
          title: '无法获取位置',
          content: '请在系统设置中允许位置权限，或打开地图手动搜索"附近宠物医院"。',
          showCancel: false
        })
      }
    })
  },

  onShareAppMessage: function () {
    var record = this.data.record
    return {
      title: 'VetAI 宠物皮肤初筛报告 · ' + (record.disease || '初筛结果'),
      path: '/pages/index/index',
      imageUrl: record.imageItems && record.imageItems[0] ? record.imageItems[0].path : ''
    }
  },

  saveShareImage: function () {
    var self = this
    var record = self.data.record
    if (!record || !record.disease) {
      wx.showToast({ title: '报告数据不完整', icon: 'none' })
      return
    }

    wx.showLoading({ title: '生成报告图片中', mask: true })
    wx.createSelectorQuery().in(self)
      .select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          wx.hideLoading()
          wx.showToast({ title: '报告生成失败', icon: 'none' })
          return
        }

        var canvas = res[0].node
        var ctx = canvas.getContext('2d')
        var dpr = wx.getSystemInfoSync().pixelRatio || 2
        var W = 750
        var H = 1180
        canvas.width = W * dpr
        canvas.height = H * dpr
        ctx.scale(dpr, dpr)

        /* ── Background ── */
        ctx.fillStyle = '#F7F6F3'
        ctx.fillRect(0, 0, W, H)

        /* ── Header bar ── */
        ctx.fillStyle = '#5B82E8'
        ctx.fillRect(0, 0, W, 142)
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 34px sans-serif'
        ctx.fillText('VetAI 宠物皮肤初筛报告', 42, 56)
        ctx.font = '22px sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.76)'
        ctx.fillText(record.generatedAtText || record.timestamp || '', 42, 94)

        /* ── Card 1: Diagnosis ── */
        self.drawCard(ctx, 34, 174, W - 68, 210)
        ctx.fillStyle = '#8A8A8A'
        ctx.font = '22px sans-serif'
        ctx.fillText('可能问题', 62, 220)
        ctx.fillStyle = '#1A1A1A'
        ctx.font = 'bold 36px sans-serif'
        self.drawLines(ctx, record.disease || '暂无明确结果', 62, 268, W - 250, 40, 2)
        ctx.fillStyle = '#5B82E8'
        ctx.font = 'bold 44px sans-serif'
        ctx.fillText(record.confidenceText || '暂无', W - 210, 280)
        ctx.fillStyle = '#8A8A8A'
        ctx.font = '20px sans-serif'
        ctx.fillText('发生概率', W - 210, 316)

        /* ── Card 2: Observation ── */
        self.drawCard(ctx, 34, 414, W - 68, 214)
        ctx.fillStyle = '#1A1A1A'
        ctx.font = 'bold 28px sans-serif'
        ctx.fillText('观察依据', 62, 462)
        ctx.fillStyle = '#1A1A1A'
        ctx.font = '23px sans-serif'
        self.drawLines(ctx, record.observationText || record.supportText || '暂无观察描述', 62, 504, W - 124, 32, 4)

        /* ── Card 3: Differential Diagnosis ── */
        var y = 658
        if (record.diseaseList && record.diseaseList.length) {
          self.drawCard(ctx, 34, y, W - 68, 260)
          ctx.fillStyle = '#1A1A1A'
          ctx.font = 'bold 28px sans-serif'
          ctx.fillText('鉴别诊断', 62, y + 48)
          for (var i = 0; i < Math.min(record.diseaseList.length, 3); i++) {
            var item = record.diseaseList[i]
            var rowY = y + 88 + i * 54
            ctx.fillStyle = '#1A1A1A'
            ctx.font = 'bold 23px sans-serif'
            ctx.fillText((i + 1) + '. ' + item.name, 62, rowY)
            ctx.fillStyle = '#5B82E8'
            ctx.font = 'bold 24px sans-serif'
            ctx.fillText(item.scoreText, W - 150, rowY)
            ctx.fillStyle = '#E8E6E1'
            self.roundRect(ctx, 62, rowY + 16, W - 170, 8, 4)
            ctx.fill()
            ctx.fillStyle = '#5B82E8'
            self.roundRect(ctx, 62, rowY + 16, Math.max(4, (W - 170) * item.percent / 100), 8, 4)
            ctx.fill()
          }
          y += 294
        }

        /* ── Card 4: Advice ── */
        self.drawCard(ctx, 34, y, W - 68, 210)
        ctx.fillStyle = '#1A1A1A'
        ctx.font = 'bold 28px sans-serif'
        ctx.fillText('护理与就医建议', 62, y + 48)
        ctx.fillStyle = '#1A1A1A'
        ctx.font = '23px sans-serif'
        var advice = (record.homeCareList || []).concat(record.watchList || [], record.vetList || []).slice(0, 4).join('。')
        self.drawLines(ctx, advice, 62, y + 90, W - 124, 32, 4)

        /* ── Disclaimer ── */
        ctx.fillStyle = '#8A8A8A'
        ctx.font = '18px sans-serif'
        self.drawLines(ctx, REPORT_DISCLAIMER, 42, H - 86, W - 84, 24, 2)

        setTimeout(function () {
          wx.canvasToTempFilePath({
            canvas: canvas,
            fileType: 'png',
            quality: 0.92,
            success: function (tempRes) {
              wx.saveImageToPhotosAlbum({
                filePath: tempRes.tempFilePath,
                success: function () {
                  wx.hideLoading()
                  wx.showToast({ title: '已保存到相册', icon: 'success' })
                },
                fail: function () {
                  wx.hideLoading()
                  wx.showToast({ title: '保存失败', icon: 'none' })
                }
              })
            },
            fail: function () {
              wx.hideLoading()
              wx.showToast({ title: '生成图片失败', icon: 'none' })
            }
          })
        }, 200)
      })
  },

  drawCard: function (ctx, x, y, w, h) {
    ctx.fillStyle = '#ffffff'
    this.roundRect(ctx, x, y, w, h, 24)
    ctx.fill()
  },

  drawLines: function (ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var line = ''
    var lines = []
    var chars = String(text || '').split('')
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i]
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = chars[i]
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    for (var j = 0; j < Math.min(lines.length, maxLines); j++) {
      ctx.fillText(lines[j], x, y + j * lineHeight)
    }
  },

  roundRect: function (ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
})
