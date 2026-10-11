var storage = require('../../utils/storage')
var analytics = require('../../utils/analytics')
var textUtil = require('../../utils/text')
var reportViewModel=require('../../utils/reportViewModel')

var PAGE_SIZE = 20

var URGENCY_TEXT = {
  low: '低风险观察',
  moderate: '建议关注',
  urgent: '建议就医',
  emergency: '紧急就医'
}

function confidenceLevelText(percent) {
  if (percent === null) return ''
  if (percent >= 70) return '匹配较高'
  if (percent >= 40) return '匹配中等'
  return '匹配较低'
}

function getMonthLabel(record) {
  var t = getRecordTime(record)
  if (!t) return '更早'
  var d = new Date(t)
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月'
}

function getDayNum(record) {
  var t = getRecordTime(record)
  if (!t) return '--'
  return ('0' + new Date(t).getDate()).slice(-2)
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
    recentText: '--',
    monthGroups: [],
    pets: [],
    activeProfileId: '',
    searchOpen: false,
    searchFocus: false
  },

  onLoad: function () {
    this.loadPets()
    this.loadRecords()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncSelected(1)
    }
    if (this._loaded) {
      this.loadPets()
      this.loadRecords()
    }
    this._loaded = true
  },

  onHide: function () {
    if (this._searchFocusTimer) clearTimeout(this._searchFocusTimer)
    this._searchFocusTimer = null
    if (this.data.searchFocus) this.setData({ searchFocus: false })
  },

  onUnload: function () {
    if (this._searchFocusTimer) clearTimeout(this._searchFocusTimer)
  },

  loadPets: function () {
    var profiles = storage.getPetProfiles() || []
    var activeId = storage.getActiveProfileId ? storage.getActiveProfileId() : ''
    this.setData({
      pets: profiles.map(function (p) {
        return {
          id: p.id,
          petName: p.petName || '未命名',
          initial: (p.petName || '宠').charAt(0),
          // BUG-UI69：健康档案与首页一致显示宠物真实头像
          avatar: p.avatar || '',
          meta: [p.petTypeLabel, p.breed, p.ageLabel].filter(Boolean).join('，')
        }
      }),
      activeProfileId: activeId
    })
  },

  switchPet: function (e) {
    var id = e.currentTarget.dataset.id
    if (!id || id === this.data.activeProfileId) {
      // 点当前宠物 → 去编辑档案
      wx.navigateTo({ url: '/pages/profile/profile' })
      return
    }
    if (storage.setActiveProfileId) storage.setActiveProfileId(id)
    this.setData({ activeProfileId: id })
    // BUG-UI49：此前只改了高亮，列表仍是全量记录，看着像筛选其实没筛；
    // 现在切换宠物会按 profileId 重新过滤记录与统计。
    this.loadRecords()
    wx.showToast({ title: '已切换宠物', icon: 'none' })
  },

  goProfiles: function () {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // BUG-UI50：搜索栏收起后过滤仍然生效，输入框却没了，记录看起来像凭空少了；
  // 关闭搜索即清空关键词。
  toggleSearch: function () {
    if (this._searchFocusTimer) clearTimeout(this._searchFocusTimer)
    if (this.data.searchOpen) {
      this.setData({ searchOpen: false, searchFocus: false })
      this.onSearchClear()
      return
    }
    this.setData({ searchOpen: true })
    var self = this
    this._searchFocusTimer = setTimeout(function () {
      self._searchFocusTimer = null
      if (self.data.searchOpen) self.setData({ searchFocus: true })
    }, 270)
  },

  getRecordTime: getRecordTime,

  // BUG-UI49：记录按当前档案过滤；未归属档案的临时问诊始终保留
  loadRecords: function () {
    var activeId = this.data.activeProfileId
    var all = storage.getHistory()
    var records = activeId
      ? all.filter(function (item) { return item.profileId === activeId || !item.profileId })
      : all
    var monthlyCount = 0
    var attentionCount = 0
    for (var i = 0; i < records.length; i++) {
      if (isThisMonth(records[i])) monthlyCount++
      if (records[i].urgency === 'urgent' || records[i].urgency === 'emergency') attentionCount++
    }
    var recentText = records.length > 0 ? getDateShort(records[0]) || '最近' : '--'
    this.setData({
      records: records,
      totalCount: all.length,
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
      // 只对“同一档案同一部位”做趋势；临时问诊没有档案归属，
      // 不同宠物的记录会因同名“临时问诊”被串成假趋势，必须排除（BUG-J4）
      if (!r.profileId || r.isTemporary) continue
      key = r.profileId + '||' + (r.bodyPartLabel || '')
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

    // 未按档案过滤时（"全部"或含临时问诊）才在 meta 行展示宠物名
    var showPetName = !this.data.activeProfileId

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
      var newView=r.assessment?reportViewModel.build(r):null
      var confidence = textUtil.normalizePercent(r.confidence, null)
      if (confidence === null) confidence = textUtil.normalizePercent(r.primaryDiagnosisProbability, null)
      var disease = cleanText(r.disease || r.primaryDiagnosis || r.lesionNameCn || '')
      var summary = cleanText(r.possibleMeaning || r.explanation || r.observations || r.careSuggestion || '')
      if(newView){confidence=null;disease=newView.title;summary=newView.summary}
      var matchText = confidenceLevelText(confidence)
      // BUG-UI49：列表里混装多只宠物（含临时问诊）时，每条都要标出宠物名，
      // 否则用户无法判断这条记录属于谁；已按单一档案过滤时不再重复宠物名。
      var petLabel = cleanText(r.petName) || '临时问诊'
      var metaLine = [
        showPetName ? petLabel : '',
        cleanText(r.bodyPartLabel),
        r.source === 'chat' ? '对话问诊' : '拍照初筛',
        matchText
      ].filter(Boolean).join('，')
      return Object.assign({}, r, {
        petName: cleanText(r.petName) || '临时问诊',
        disease: disease,
        imagePath: isUsableImagePath(r.imagePath) ? r.imagePath : '',
        bodyPartLabel: cleanText(r.bodyPartLabel),
        modelProviderLabel: cleanText(r.modelProviderLabel),
        dateShort: getDateShort(r),
        dayNum: getDayNum(r),
        monthLabel: getMonthLabel(r),
        sourceLabel: r.source === 'chat' ? '对话问诊' : '拍照初筛',
        metaLine: metaLine,
        urgencyText: newView?newView.riskText:URGENCY_TEXT[r.urgency] || '建议关注',
        confidenceText: confidence === null ? '' : confidence + '%',
        matchText: matchText,
        summaryText: summary || '点击查看完整初筛报告',
        trendTag: trendMap[r.id] || null
      })
    })
  },

  // 时间轴：把已分页的记录按月份分组
  groupByMonth: function (list) {
    var groups = []
    var map = {}
    list.forEach(function (it) {
      var key = it.monthLabel || '更早'
      if (!map[key]) {
        map[key] = { monthLabel: key, items: [] }
        groups.push(map[key])
      }
      map[key].items.push(it)
    })
    return groups
  },

  sortAndDisplay: function () {
    var source = this.getSortedSource()
    var totalCount = source.length
    var displayRecords = source.slice(0, PAGE_SIZE)
    this.setData({
      displayRecords: displayRecords,
      monthGroups: this.groupByMonth(displayRecords),
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
      monthGroups: this.groupByMonth(displayRecords),
      showingCount: displayRecords.length,
      hasMore: end < source.length
    })
  },

  // BUG-UI66：每次新手势清理长按标记，长按后的松手不触发详情跳转
  onRecordTouchStart: function () {
    this._longPressedRecordId = ''
  },

  onRecordTap: function (e) {
    var id = e.currentTarget.dataset.id
    if (this._longPressedRecordId === id) {
      this._longPressedRecordId = ''
      return
    }
    var record = storage.getRecordById(id)
    analytics.track('page_view', { page: 'result_from_history', recordId: id })
    // 对话式问诊的记录跳简要报告页，其他跳完整报告页
    if (record && record.source === 'chat') {
      wx.navigateTo({ url: '/pages/chat/report/report?id=' + id })
    } else {
      wx.navigateTo({ url: '/pages/result/result?id=' + id })
    }
  },

  // 单条删除记录（BUG-C8：此前只有清空全部，无法删除单条）
  onDeleteRecord: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条问诊记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#9C3A25',
      success: function (res) {
        if (!res.confirm) return
        storage.deleteRecord(id)
        self.loadRecords()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // BUG-UI66：删除移入长按菜单，二次确认沿用现有删除逻辑
  onRecordLongPress: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    if (!id) return
    this._longPressedRecordId = id
    wx.showActionSheet({
      itemList: ['删除这条记录'],
      itemColor: '#9C3A25',
      success: function (res) {
        if (res.tapIndex === 0) {
          self.onDeleteRecord({ currentTarget: { dataset: { id: id } } })
        }
      }
    })
  },

  clearRecords: function () {
    var self = this
    wx.showModal({
      title: '清空记录',
      content: '将删除当前本机空间下的全部问诊记录。',
      confirmText: '清空',
      confirmColor: '#9C3A25',
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
