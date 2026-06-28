var storage = require('../../utils/storage')
var analytics = require('../../utils/analytics')

var PAGE_SIZE = 20

var URGENCY_TEXT = {
  low: '低风险观察',
  moderate: '建议关注',
  urgent: '建议就医',
  emergency: '紧急就医'
}

function cleanText(value) {
  if (typeof value !== 'string') return value || ''
  return value.replace(/[*#`]/g, '').replace(/^\s*[-•]\s+/gm, '').trim()
}

function isUsableImagePath(path) {
  if (!path || typeof path !== 'string') return false
  if (path.indexOf('http://127.0.0.1') === 0 && path.indexOf('/__tmp__/') >= 0) return false
  return true
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

function getDateShort(record) {
  var raw = record.timestamp || record.dateStr || ''
  var parsed = Date.parse(String(raw))
  if (!isNaN(parsed)) {
    var d = new Date(parsed)
    return (d.getMonth() + 1) + '/' + d.getDate()
  }
  var match = String(raw).match(/(\d{1,2})[/-](\d{1,2})/)
  if (match) return match[1] + '/' + match[2]
  return ''
}

function isThisMonth(record) {
  var now = new Date()
  var t = getRecordTime(record)
  if (!t) return false
  var d = new Date(t)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function getRecordTime(record) {
  if (typeof record.createdAt === 'number') return record.createdAt
  var parsed = Date.parse(String(record.timestamp || record.dateStr || ''))
  return isNaN(parsed) ? 0 : parsed
}

Page({
  data: {
    records: [],
    filteredRecords: [],
    displayRecords: [],
    searchText: '',
    isSearching: false,
    sortField: 'date',
    sortAsc: false,
    currentPage: 1,
    hasMore: false,
    totalCount: 0,
    showingCount: 0,
    monthlyCount: 0,
    attentionCount: 0,
    recentText: '--'
  },

  onLoad: function () {
    this.loadRecords()
  },

  onShow: function () {
    if (this._loaded) this.loadRecords()
    this._loaded = true
  },

  getRecordTime: getRecordTime,

  loadRecords: function () {
    var records = storage.getHistory()
    var monthlyCount = 0
    var attentionCount = 0
    for (var i = 0; i < records.length; i++) {
      if (isThisMonth(records[i])) monthlyCount++
      if (records[i].urgency === 'urgent' || records[i].urgency === 'emergency') attentionCount++
    }
    var recentText = records.length > 0 ? getDateShort(records[0]) || '最近' : '--'
    this.setData({
      records: records,
      currentPage: 1,
      monthlyCount: monthlyCount,
      attentionCount: attentionCount,
      recentText: recentText
    })
    if (this.data.searchText) this.filterAndDisplay(this.data.searchText)
    else this.sortAndDisplay()
  },

  onSearchInput: function (e) {
    var text = e.detail.value.trim()
    this.setData({ searchText: text, currentPage: 1 })
    this.filterAndDisplay(text)
  },

  onSearchClear: function () {
    this.setData({ searchText: '', isSearching: false, currentPage: 1 })
    this.sortAndDisplay()
  },

  onSearchFocus: function () {
    this.setData({ isSearching: true })
  },

  filterAndDisplay: function (text) {
    if (!text) {
      this.sortAndDisplay()
      return
    }
    var keyword = text.toLowerCase()
    var filtered = this.data.records.filter(function (record) {
      var fields = [
        record.petName, record.disease, record.primaryDiagnosis, record.bodyPartLabel,
        record.complaint, record.petTypeLabel, record.timestamp, record.urgencyLabel
      ].filter(Boolean).map(function (f) { return String(f).toLowerCase() })
      return fields.some(function (f) { return f.indexOf(keyword) >= 0 })
    })
    this.setData({ filteredRecords: filtered })
    this.sortAndDisplay()
  },

  setSort: function (e) {
    var field = e.currentTarget.dataset.field
    var sortAsc = field === this.data.sortField ? !this.data.sortAsc : false
    this.setData({ sortField: field, sortAsc: sortAsc, currentPage: 1 })
    this.sortAndDisplay()
  },

  buildTrendMap: function (records) {
    var urgencyOrder = { low: 0, moderate: 1, urgent: 2, emergency: 3 }
    var groups = {}
    var i, r, key
    for (i = 0; i < records.length; i++) {
      r = records[i]
      key = (r.petName || '') + '||' + (r.bodyPartLabel || '')
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    }
    var trendMap = {}
    Object.keys(groups).forEach(function (k) {
      var group = groups[k].sort(function (a, b) {
        return getRecordTime(b) - getRecordTime(a)
      })
      for (i = 0; i < group.length; i++) {
        if (i === group.length - 1) break
        var curr = group[i]
        var prev = group[i + 1]
        var currLevel = urgencyOrder[curr.urgency] !== undefined ? urgencyOrder[curr.urgency] : 1
        var prevLevel = urgencyOrder[prev.urgency] !== undefined ? urgencyOrder[prev.urgency] : 1
        var diff = currLevel - prevLevel
        if (diff < 0) {
          trendMap[curr.id] = { trend: 'improved', icon: '↓', text: '好转' }
        } else if (diff > 0) {
          trendMap[curr.id] = { trend: 'worsened', icon: '↑', text: '加重' }
        } else {
          trendMap[curr.id] = { trend: 'same', icon: '→', text: '持平' }
        }
      }
    })
    return trendMap
  },

  getSortedSource: function () {
    var source = (this.data.searchText ? this.data.filteredRecords : this.data.records).slice()
    var sortField = this.data.sortField
    var sortAsc = this.data.sortAsc
    var self = this

    var trendMap = self.buildTrendMap(self.data.searchText ? self.data.filteredRecords : self.data.records)

    source.sort(function (a, b) {
      var cmp = 0
      if (sortField === 'date') {
        cmp = self.getRecordTime(b) - self.getRecordTime(a)
      } else if (sortField === 'petName') {
        var nameA = a.petName || '临时问诊'
        var nameB = b.petName || '临时问诊'
        cmp = nameA > nameB ? 1 : nameA < nameB ? -1 : 0
      } else if (sortField === 'urgency') {
        var order = { emergency: 0, urgent: 1, moderate: 2, low: 3 }
        var ua = order[a.urgency] !== undefined ? order[a.urgency] : 2
        var ub = order[b.urgency] !== undefined ? order[b.urgency] : 2
        cmp = ua - ub
      }
      return sortAsc ? -cmp : cmp
    })

    return source.map(function (r) {
      var confidence = normalizePercent(r.confidence)
      if (confidence === null) confidence = normalizePercent(r.primaryDiagnosisProbability)
      var disease = cleanText(r.disease || r.primaryDiagnosis || r.lesionNameCn || '')
      var summary = cleanText(r.possibleMeaning || r.explanation || r.observations || r.careSuggestion || '')
      return Object.assign({}, r, {
        petName: cleanText(r.petName) || '临时问诊',
        disease: disease,
        imagePath: isUsableImagePath(r.imagePath) ? r.imagePath : '',
        bodyPartLabel: cleanText(r.bodyPartLabel),
        modelProviderLabel: cleanText(r.modelProviderLabel),
        dateShort: getDateShort(r),
        urgencyText: URGENCY_TEXT[r.urgency] || '建议关注',
        confidenceText: confidence === null ? '' : confidence + '%',
        summaryText: summary || '点击查看完整初筛报告',
        trendTag: trendMap[r.id] || null
      })
    })
  },

  sortAndDisplay: function () {
    var source = this.getSortedSource()
    var totalCount = source.length
    var displayRecords = source.slice(0, PAGE_SIZE)
    this.setData({
      displayRecords: displayRecords,
      totalCount: totalCount,
      showingCount: displayRecords.length,
      hasMore: totalCount > PAGE_SIZE
    })
  },

  loadMore: function () {
    var source = this.getSortedSource()
    var currentPage = this.data.currentPage + 1
    var end = currentPage * PAGE_SIZE
    var displayRecords = source.slice(0, end)
    this.setData({
      currentPage: currentPage,
      displayRecords: displayRecords,
      showingCount: displayRecords.length,
      hasMore: end < source.length
    })
  },

  onRecordTap: function (e) {
    var id = e.currentTarget.dataset.id
    analytics.track('page_view', { page: 'result_from_history', recordId: id })
    wx.navigateTo({ url: '/pages/result/result?id=' + id })
  },

  clearRecords: function () {
    var self = this
    wx.showModal({
      title: '清空记录',
      content: '将删除当前本机空间下的全部问诊记录。',
      confirmText: '清空',
      confirmColor: '#c76f5a',
      success: function (res) {
        if (!res.confirm) return
        storage.clearHistory()
        self.loadRecords()
      }
    })
  },

  goHome: function () {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
