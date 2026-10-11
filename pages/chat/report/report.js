var storage = require('../../../utils/storage')
var chatDoctor = require('../../../utils/chatDoctor')
var reportViewModel=require('../../../utils/reportViewModel')
var reportActions=require('../../../utils/reportActions')
var reportPresentation=require('../../../utils/reportPresentation')

Page({
  data: {
    record: null,
    displayRecord: null,
    notFound: false
  },

  onLoad: function (options) {
    if (!options.id) {
      this.setData({ notFound: true })
      return
    }
    var record = storage.getRecordById(options.id)
    if (!record) {
      this.setData({ notFound: true })
      return
    }
    this.setData({ record: record, displayRecord: this._buildDisplay(record) })
  },

  _buildDisplay: function (record) {
    var d = record || {}
    var assessmentView = d.assessment ? reportViewModel.build(d) : null
    if (assessmentView) d = reportPresentation.prepare(d, assessmentView)
    var lines = []

    // 诊断结论
    var diagnosis = d.disease || d.primaryDiagnosis || '未能明确判断'
    lines.push({ label: '初步判断', value: diagnosis })

    if (!assessmentView && typeof d.confidence === 'number') {
      lines.push({
        label: '参考把握',
        value: (d.confidenceLabel ? d.confidenceLabel + ' ' : '') + d.confidence + '%'
      })
    }

    if (Array.isArray(d.diagnosisCandidates) && d.diagnosisCandidates.length > 1) {
      var candidates = d.diagnosisCandidates.slice(0, 3).map(function (item) {
        return (item.name || '未明确') + (typeof item.probability === 'number' ? ' ' + item.probability + '%' : '')
      })
      lines.push({ label: '鉴别方向', value: candidates.join('\n') })
    }

    // 简要描述
    if (d.possibleMeaning) {
      lines.push({ label: '说明', value: chatDoctor.cleanText(d.possibleMeaning) })
    }
    if (assessmentView && d.observations) lines.push({label:'客观观察', value:d.observations})
    if (assessmentView && d.explanation) lines.push({label:'判断依据', value:d.explanation})
    if (assessmentView && d.diagnosisProbabilityNote) lines.push({label:'待核对信息', value:d.diagnosisProbabilityNote})

    // 护理建议
    if (d.homeCare || d.careSuggestion) {
      var care = chatDoctor.splitAdvice(d.homeCare || d.careSuggestion)
      lines.push({ label: '日常护理', value: care.join('\n') })
    }

    // 何时就医
    if (d.whenToSeeVet || d.vetWarning) {
      var vet = chatDoctor.splitAdvice(d.whenToSeeVet || d.vetWarning)
      lines.push({ label: '何时就医', value: vet.join('\n') })
    }

    // 患处和症状
    if (d.bodyPartLabel) {
      lines.push({ label: '患处', value: d.bodyPartLabel })
    }
    if (d.complaint) {
      lines.push({ label: '主人描述', value: d.complaint })
    }

    if (d.ragMatchName || d.ragSummary) {
      lines.push({
        // 口径统一：用户可见文案不提“知识库”等内部机制（BUG-J3）
        label: '临床特征核对',
        value: chatDoctor.cleanText(d.ragSummary || ('匹配参考：' + d.ragMatchName))
      })
    }
    if (Array.isArray(d.ragSources) && d.ragSources.length > 0) {
      var sourceTitles = d.ragSources.slice(0, 4).map(function (source) {
        return source && source.title ? source.title : ''
      }).filter(Boolean)
      if (sourceTitles.length > 0) lines.push({ label: '参考来源', value: sourceTitles.join('\n') })
    }

    // 紧急程度
    var urgencyText = ''
    if (assessmentView) urgencyText = assessmentView.riskText
    else if (d.urgency === 'emergency') urgencyText = '紧急'
    else if (d.urgency === 'urgent') urgencyText = '建议尽快就诊'
    else if (d.urgency === 'moderate') urgencyText = '建议关注'
    else urgencyText = '观察即可'
    if (urgencyText) lines.push({ label: '紧急程度', value: urgencyText })

    // 照片
    var photos = []
    if (d.imagePaths && d.imagePaths.length > 0) {
      photos = d.imagePaths
    } else if (d.imagePath) {
      photos = [d.imagePath]
    }

    return {
      id: d.id || '',
      petName: d.petName || '宠物',
      petTypeLabel: d.petTypeLabel || '',
      breed: d.breed || '',
      dateStr: d.dateStr || '',
      lines: lines,
      photos: photos,
      urgency: d.urgency || 'low',
      urgencyText: urgencyText,
      assessmentView: assessmentView
    }
  },

  onDeepenAnalysis: function(){var self=this;reportActions.deepen(self,self.data.record,function(record){self.setData({record:record,displayRecord:self._buildDisplay(record)})})},
  onRetryAnalysis: function(){var self=this;reportActions.retry(self,self.data.record,function(record){self.setData({record:record,displayRecord:self._buildDisplay(record)})})},
  saveShareImage: function(){reportActions.exportImage(this,this.data.record)},
  onUnload: function(){this._reportClosed=true},
  onBack: function () {
    // BUG-UI24：作为入口页（冷启动/被微信恢复）时没有上一页，navigateBack 无反应
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  // BUG-UI25：患处照片原先不可点开，用户无法确认自己拍清楚没有
  onPreviewPhoto: function (e) {
    var d = this.data.displayRecord
    if (!d || !d.photos || d.photos.length === 0) return
    var index = parseInt(e.currentTarget.dataset.index, 10)
    if (isNaN(index) || index < 0 || index >= d.photos.length) index = 0
    wx.previewImage({ current: d.photos[index], urls: d.photos })
  },

  goHistory: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  }
})
