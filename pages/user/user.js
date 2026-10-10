var storage = require('../../utils/storage')
var analytics = require('../../utils/analytics')
var chatDoctor = require('../../utils/chatDoctor')
var imageUtil = require('../../utils/image')
var config = require('../../utils/config')

var ISSUE_LABELS = {
  diagnosis_wrong: '诊断方向不准',
  evidence_weak: '依据不清',
  advice_unclear: '建议难用',
  roi_ignored: '圈选没用上',
  risk_level_wrong: '风险级别不对',
  other: '其他'
}

var VET_OUTCOME_LABELS = {
  consistent: '基本一致',
  partial: '部分一致',
  different: '不一致',
  unknown: '还不确定'
}

function pct(num, den) {
  return den > 0 ? Math.round(num / den * 100) : 0
}

function labelOf(map, key) {
  return map[key] || (key || '未填')
}

function bump(map, key) {
  key = key || 'unknown'
  map[key] = (map[key] || 0) + 1
}

function mapToList(map, labels) {
  var list = []
  for (var key in map) {
    list.push({ key: key, label: labelOf(labels || {}, key), count: map[key] })
  }
  return list.sort(function (a, b) { return b.count - a.count })
}

function recentText(records) {
  if (!records || !records.length) return '--'
  // 优先用数字时间戳 createdAt；旧记录回退解析本地化字符串
  var raw = records[0].createdAt || records[0].timestamp || records[0].dateStr || ''
  var parsed = typeof raw === 'number' ? raw : Date.parse(String(raw))
  if (!isNaN(parsed)) {
    var d = new Date(parsed)
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  }
  return '最近'
}

Page({
  data: {
    user: null,
    profilesCount: 0,
    recordsCount: 0,
    feedbackCount: 0,
    feedbackSummary: null,
    kbAccuracyList: [],
    upgradeSignals: null,
    currentSpaceId: 'guest',
    currentSpaceName: '本机访客',
    knownUsersCount: 0,
    storageModeText: '仅本机保存',
    recentText: '--',
    isDarkMode: false,
    // BUG-UI38：开发者面板门禁，默认关闭
    isDev: !!config.SHOW_DEV_PANEL,
    // BUG-UI39：版本号原先硬编码 '2.0'，与 package.json 的 3.0.0 矛盾
    appVersion: config.APP_VERSION || '3.0.0',
    expandedSection: null
  },

  onLoad: function () {
    var app = getApp()
    this.setData({ isDarkMode: app.isDarkMode() })
    this.loadUserData()
    this._loaded = true
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncSelected(2)
    }
    if (this._loaded) this.loadUserData()
    var app = getApp()
    this.setData({ isDarkMode: app.isDarkMode() })
  },

  loadUserData: function () {
    var user = storage.getCurrentUser()
    var space = storage.getCurrentSpaceInfo()
    var knownUsers = storage.getKnownUsers()
    var records = storage.getHistory()
    this.setData({
      user: user ? Object.assign({}, user, {
        avatarText: user.nickName ? user.nickName.slice(0, 1) : '我'
      }) : null,
      currentSpaceId: space.id,
      currentSpaceName: space.nickName,
      knownUsersCount: knownUsers.length,
      storageModeText: space.isGuest ? '访客空间，仅保存在本机' : '本机昵称空间，仅保存在本机',
      profilesCount: storage.getPetProfiles().length,
      recordsCount: records.length,
      feedbackCount: storage.getRecordsWithFeedback().length,
      feedbackSummary: this.buildFeedbackSummary(),
      kbAccuracyList: this.buildKbAccuracyList(),
      upgradeSignals: this.buildUpgradeSignals(),
      recentText: recentText(records)
    })
  },

  // 本机空间切换：入口在账户区，普通用户可见。
  // showActionSheet 的 itemList 上限 6 项，所以「本机其他空间」最多列 4 个；
  // 当前所在空间不再重复出现在列表里。
  switchSpace: function () {
    var self = this
    var current = storage.getCurrentUser()
    var others = storage.getKnownUsers().filter(function (u) {
      return !current || u.id !== current.id
    }).slice(0, 4)

    var items = ['新建本机空间']
    var actions = [function () { self.showNicknameInput() }]

    if (current) {
      items.push('切回本机访客')
      actions.push(function () {
        storage.logoutUser()
        self.loadUserData()
        wx.showToast({ title: '已切回访客', icon: 'success' })
      })
    }

    others.forEach(function (u) {
      items.push(u.nickName || '未命名空间')
      actions.push(function () {
        storage.loginUser({ nickName: u.nickName, id: u.id, avatarUrl: u.avatarUrl || '' })
        self.loadUserData()
        wx.showToast({ title: '已切换空间', icon: 'success' })
      })
    })

    wx.showActionSheet({
      itemList: items,
      success: function (res) {
        var fn = actions[res.tapIndex]
        if (fn) fn()
      }
    })
  },

  // ── 空间资料编辑（BUG-C9：建好空间后改名/换头像）──────────────

  // 更换本机空间头像：选图 → 压缩落盘（本地文件，不占 storage 配额）→ 更新
  onEditAvatar: function () {
    var self = this
    if (!storage.getCurrentUser()) {
      wx.showToast({ title: '请先新建本机空间', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: function (res) {
        var tempPath = (res.tempFilePaths || [])[0]
        if (!tempPath) return
        wx.showLoading({ title: '处理中', mask: true })
        imageUtil.prepareImages([tempPath], {
          existingCount: 0, maxCount: 1,
          pageContext: self, savePermanent: true, checkQuality: false
        }).then(function (batch) {
          wx.hideLoading()
          if (!batch || !batch.length) {
            wx.showToast({ title: '图片处理失败，请重试', icon: 'none' })
            return
          }
          var item = batch[0]
          storage.updateUser({ avatarUrl: item.displayPath || item.base64 || '' })
          self.loadUserData()
          wx.showToast({ title: '已更新头像', icon: 'success' })
        }).catch(function () {
          wx.hideLoading()
          wx.showToast({ title: '图片处理失败，请重试', icon: 'none' })
        })
      }
    })
  },

  // 修改本机空间昵称：空间 ID 不变，记录数据不受影响
  onRenameSpace: function () {
    var self = this
    var user = storage.getCurrentUser()
    if (!user) {
      wx.showToast({ title: '请先新建本机空间', icon: 'none' })
      return
    }
    wx.showModal({
      title: '修改空间昵称',
      content: '输入新的昵称（仅本机显示，不影响已有记录数据）',
      editable: true,
      placeholderText: user.nickName || '本机空间',
      confirmText: '保存',
      success: function (res) {
        if (!res.confirm) return
        var nickName = (res.content || '').trim()
        if (!nickName) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        if (nickName === user.nickName) return
        // 重名检查（排除自己），延续 BUG-K2 的空间可区分原则
        var dup = storage.getKnownUsers().filter(function (u) {
          return u.id !== user.id && (u.nickName || '') === nickName
        })[0]
        if (dup) {
          wx.showToast({ title: '该昵称已被其他空间使用', icon: 'none' })
          return
        }
        storage.updateUser({ nickName: nickName })
        self.loadUserData()
        wx.showToast({ title: '已更新', icon: 'success' })
      }
    })
  },

  showNicknameInput: function () {
    var self = this
    wx.showModal({
      title: '设置本机空间',
      content: '输入一个昵称，用来区分本机上的不同数据空间。不是账号登录，也不会同步到云端。',
      editable: true,
      placeholderText: '例如：我的手机',
      confirmText: '保存',
      success: function (res) {
        if (!res.confirm) return
        var nickName = (res.content || '').trim() || '本机用户'
        // 同名空间处理（BUG-K2）：已存在同名时提供“切换到已有”选项，
        // 避免 knownUsers 里出现无法区分的重名条目
        var dup = storage.getKnownUsers().filter(function (u) {
          return (u.nickName || '') === nickName
        })[0]
        if (dup) {
          wx.showModal({
            title: '已有同名空间',
            content: '本机已存在名为“' + nickName + '”的空间。切换到它，还是新建一个？',
            confirmText: '切换到它',
            cancelText: '新建',
            success: function (choice) {
              if (choice.confirm) {
                storage.loginUser({ nickName: nickName, id: dup.id, avatarUrl: dup.avatarUrl || '' })
              } else {
                storage.loginUser({ nickName: nickName + '(新)' })
              }
              self.loadUserData()
              wx.showToast({ title: '已保存', icon: 'success' })
            }
          })
          return
        }
        storage.loginUser({ nickName: nickName })
        self.loadUserData()
        wx.showToast({ title: '已保存', icon: 'success' })
      }
    })
  },

  logout: function () {
    var self = this
    wx.showModal({
      title: '切回本机访客',
      content: '将切回默认本机访客空间。其他本机空间的数据仍保留在设备中。',
      confirmText: '切换',
      confirmColor: '#9C3A25',
      success: function (res) {
        if (!res.confirm) return
        storage.logoutUser()
        self.loadUserData()
      }
    })
  },

  showStorageHelp: function () {
    var space = storage.getCurrentSpaceInfo()
    wx.showModal({
      title: '隐私与数据',
      content: '当前空间：' + space.nickName +
        '\n空间 ID：' + space.id +
        '\n记录 Key：' + space.recordsKey +
        '\n档案 Key：' + space.profilesKey +
        '\n\n当前版本没有云端账号；记录和档案只按本机空间分开保存，换手机或重装后不会同步。',
      showCancel: false
    })
  },

  toggleSection: function (e) {
    var key = e.currentTarget.dataset.key
    this.setData({
      expandedSection: this.data.expandedSection === key ? null : key
    })
  },

  // 承接原档案页的「清空所有记录」，收进「数据与隐私」
  clearRecords: function () {
    var self = this
    wx.showModal({
      title: '清空记录',
      content: '将删除当前本机空间下的全部问诊记录，宠物档案保留。',
      confirmText: '清空',
      confirmColor: '#9C3A25',
      success: function (res) {
        if (!res.confirm) return
        storage.clearHistory()
        self.loadUserData()
        wx.showToast({ title: '已清空记录', icon: 'none' })
      }
    })
  },

  // 底部紧急提示条：查找附近宠物医院（与 result 页等价实现）
  findHospital: function () {
    wx.chooseLocation({
      success: function (res) {
        if (res && res.latitude) {
          wx.openLocation({ latitude: res.latitude, longitude: res.longitude, name: res.name || '宠物医院', address: res.address || '', scale: 15 })
        }
      },
      fail: function (err) {
        // BUG-UI78：用户取消选点不再二次拉起定位授权（与 result 页口径一致）
        var msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') >= 0) return
        wx.getLocation({
          type: 'gcj02',
          success: function (loc) {
            // 这里打开的是当前位置而不是医院 POI，命名必须诚实，避免误导
            wx.openLocation({ latitude: loc.latitude, longitude: loc.longitude, name: '当前位置', address: '请在地图中搜索附近宠物医院', scale: 14 })
          },
          fail: function () {
            wx.showToast({ title: '需要定位权限才能查找医院', icon: 'none' })
          }
        })
      }
    })
  },

  exportData: function () {
    var records = storage.getHistory().map(function (r) {
      // rawResponse 体积大且属调试数据，导出时剔除，降低剪贴板截断风险（BUG-K6）
      var copy = Object.assign({}, r)
      delete copy.rawResponse
      return copy
    })
    var profiles = storage.getPetProfiles()
    var data = JSON.stringify({ profiles: profiles, records: records, exportedAt: new Date().toISOString() }, null, 2)
    if (data.length > 800 * 1024) {
      // 进一步瘦身：去掉缩进
      data = JSON.stringify({ profiles: profiles, records: records, exportedAt: new Date().toISOString() })
    }
    wx.setClipboardData({
      data: data,
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
        analytics.track('export', { records: records.length, profiles: profiles.length })
      },
      fail: function () {
        wx.showToast({ title: '导出失败，数据量过大', icon: 'none' })
      }
    })
  },

  clearData: function () {
    var self = this
    wx.showModal({
      title: '清除数据',
      content: '将删除当前本机空间的全部记录、档案、聊天草稿和反馈数据。此操作不可恢复。',
      confirmText: '清除',
      confirmColor: '#9C3A25',
      success: function (res) {
        if (!res.confirm) return
        storage.clearHistory()
        // 整 key 移除，避免逐个删除的 O(n²) 读写；同时清掉聊天草稿（BUG-K5）
        storage.clearProfiles()
        chatDoctor.clearDraft()
        analytics.clearEvents()
        self.loadUserData()
        wx.showToast({ title: '已清除', icon: 'success' })
      }
    })
  },

  goProfiles: function () {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goRecords: function () {
    wx.switchTab({ url: '/pages/detail/detail' })
  },

  buildFeedbackSummary: function () {
    var records = storage.getRecordsWithFeedback()
    if (records.length === 0) return null
    var helpful = 0, notHelpful = 0, wentVet = 0, notVet = 0
    var vetConsistent = 0, vetPartial = 0, vetDifferent = 0, vetUnknown = 0
    var issueMap = {}
    var vetOutcomeMap = {}
    for (var i = 0; i < records.length; i++) {
      var fb = records[i].feedback || {}
      if (fb.helpful === true) helpful++
      else if (fb.helpful === false) {
        notHelpful++
        bump(issueMap, fb.issueType || 'other')
      }
      if (fb.wentToVet === true) wentVet++
      else if (fb.wentToVet === false) notVet++
      if (fb.vetOutcome) {
        bump(vetOutcomeMap, fb.vetOutcome)
        if (fb.vetOutcome === 'consistent') vetConsistent++
        else if (fb.vetOutcome === 'partial') vetPartial++
        else if (fb.vetOutcome === 'different') vetDifferent++
        else if (fb.vetOutcome === 'unknown') vetUnknown++
      }
    }
    return {
      total: records.length,
      helpful: helpful,
      notHelpful: notHelpful,
      wentVet: wentVet,
      notVet: notVet,
      vetConsistent: vetConsistent,
      vetPartial: vetPartial,
      vetDifferent: vetDifferent,
      vetUnknown: vetUnknown,
      helpfulRate: pct(helpful, helpful + notHelpful),
      issueRate: pct(notHelpful, helpful + notHelpful),
      vetAlignedRate: pct(vetConsistent + vetPartial, vetConsistent + vetPartial + vetDifferent),
      issueList: mapToList(issueMap, ISSUE_LABELS),
      vetOutcomeList: mapToList(vetOutcomeMap, VET_OUTCOME_LABELS)
    }
  },

  buildKbAccuracyList: function () {
    var records = storage.getRecordsWithFeedback()
    var kbMap = {}
    for (var i = 0; i < records.length; i++) {
      var r = records[i]
      var name = r.ragMatchName || r.primaryDiagnosis || r.disease || ''
      if (!name) continue
      if (!kbMap[name]) kbMap[name] = { name: name, helpful: 0, notHelpful: 0, vetDifferent: 0, total: 0, issues: {} }
      kbMap[name].total++
      var fb = r.feedback || {}
      if (fb.helpful === true) kbMap[name].helpful++
      else if (fb.helpful === false) {
        kbMap[name].notHelpful++
        bump(kbMap[name].issues, fb.issueType || 'other')
      }
      if (fb.vetOutcome === 'different') kbMap[name].vetDifferent++
    }
    var list = []
    for (var key in kbMap) {
      if (kbMap[key].total > 0) {
        var item = kbMap[key]
        var issues = mapToList(item.issues, ISSUE_LABELS)
        item.helpfulRate = pct(item.helpful, item.helpful + item.notHelpful)
        item.mainIssueLabel = issues[0] ? issues[0].label : '暂无集中问题'
        list.push(item)
      }
    }
    return list.sort(function (a, b) {
      if (b.notHelpful !== a.notHelpful) return b.notHelpful - a.notHelpful
      if (b.vetDifferent !== a.vetDifferent) return b.vetDifferent - a.vetDifferent
      return b.total - a.total
    }).slice(0, 10)
  },

  buildUpgradeSignals: function () {
    var records = storage.getRecordsWithFeedback()
    if (records.length === 0) return null
    var issueMap = {}
    var segmentMap = {}
    var modelMap = {}
    var reviewCases = []

    for (var i = 0; i < records.length; i++) {
      var r = records[i]
      var fb = r.feedback || {}
      var snapshot = fb.snapshot || {}
      var model = snapshot.modelProvider || r.modelProviderLabel || r.modelName || r.modelProvider || 'unknown'
      if (!modelMap[model]) modelMap[model] = { name: model, total: 0, helpful: 0, notHelpful: 0, vetDifferent: 0 }
      modelMap[model].total++
      if (fb.helpful === true) modelMap[model].helpful++
      if (fb.helpful === false) modelMap[model].notHelpful++
      if (fb.vetOutcome === 'different') modelMap[model].vetDifferent++

      if (fb.helpful === false) bump(issueMap, fb.issueType || 'other')

      var isReviewCase = fb.helpful === false || fb.vetOutcome === 'different'
      if (isReviewCase) {
        var name = r.ragMatchName || snapshot.ragMatchName || r.primaryDiagnosis || r.disease || '未命名方向'
        var bodyPart = r.bodyPartLabel || snapshot.bodyPart || r.bodyPart || '未标注部位'
        var segKey = name + '|' + bodyPart
        if (!segmentMap[segKey]) {
          segmentMap[segKey] = { name: name, bodyPart: bodyPart, total: 0, notHelpful: 0, vetDifferent: 0, issues: {} }
        }
        segmentMap[segKey].total++
        if (fb.helpful === false) {
          segmentMap[segKey].notHelpful++
          bump(segmentMap[segKey].issues, fb.issueType || 'other')
        }
        if (fb.vetOutcome === 'different') segmentMap[segKey].vetDifferent++
        reviewCases.push({
          id: r.id,
          disease: r.primaryDiagnosis || r.disease || snapshot.disease || '',
          kb: name,
          bodyPart: bodyPart,
          urgency: r.urgency || snapshot.urgency || '',
          issueLabel: labelOf(ISSUE_LABELS, fb.issueType || ''),
          vetOutcomeLabel: labelOf(VET_OUTCOME_LABELS, fb.vetOutcome || ''),
          confidence: snapshot.confidencePercent || r.primaryDiagnosisProbability || r.confidence || ''
        })
      }
    }

    var weakSegments = []
    for (var key in segmentMap) {
      var seg = segmentMap[key]
      var issues = mapToList(seg.issues, ISSUE_LABELS)
      seg.mainIssueLabel = issues[0] ? issues[0].label : '暂无集中问题'
      weakSegments.push(seg)
    }
    weakSegments = weakSegments.sort(function (a, b) {
      if (b.vetDifferent !== a.vetDifferent) return b.vetDifferent - a.vetDifferent
      if (b.notHelpful !== a.notHelpful) return b.notHelpful - a.notHelpful
      return b.total - a.total
    }).slice(0, 5)

    var modelList = []
    for (var modelKey in modelMap) {
      var m = modelMap[modelKey]
      m.helpfulRate = pct(m.helpful, m.helpful + m.notHelpful)
      modelList.push(m)
    }

    return {
      topIssues: mapToList(issueMap, ISSUE_LABELS).slice(0, 5),
      weakSegments: weakSegments,
      modelList: modelList.sort(function (a, b) { return b.total - a.total }).slice(0, 5),
      reviewCases: reviewCases.slice(0, 8)
    }
  },

  exportFeedbackData: function () {
    var records = storage.getRecordsWithFeedback()
    if (records.length === 0) {
      wx.showToast({ title: '暂无反馈数据', icon: 'none' })
      return
    }
    var lines = ['=== VetAI 反馈闭环复盘包 ===', '导出时间: ' + new Date().toLocaleString('zh-CN'), '']
    var summary = this.buildFeedbackSummary()
    if (summary) {
      lines.push('--- 核心 KPI ---')
      lines.push('总反馈: ' + summary.total)
      lines.push('有帮助率: ' + summary.helpfulRate + '% (' + summary.helpful + '/' + (summary.helpful + summary.notHelpful) + ')')
      lines.push('问题反馈率: ' + summary.issueRate + '% (' + summary.notHelpful + '/' + (summary.helpful + summary.notHelpful) + ')')
      lines.push('就医样本: 已就医' + summary.wentVet + ', 未就医' + summary.notVet)
      lines.push('兽医方向一致率: ' + summary.vetAlignedRate + '% (一致/部分一致 ' + (summary.vetConsistent + summary.vetPartial) + ', 不一致 ' + summary.vetDifferent + ')')
      if (summary.issueList.length > 0) {
        lines.push('主要问题: ' + summary.issueList.map(function (item) { return item.label + item.count + '次' }).join('；'))
      }
      if (summary.vetOutcomeList.length > 0) {
        lines.push('兽医结论: ' + summary.vetOutcomeList.map(function (item) { return item.label + item.count + '次' }).join('；'))
      }
      lines.push('')
    }

    var signals = this.buildUpgradeSignals()
    if (signals) {
      lines.push('--- 升级优先级 ---')
      if (signals.topIssues.length > 0) {
        lines.push('优先排查问题: ' + signals.topIssues.map(function (item) { return item.label + item.count + '次' }).join('；'))
      }
      if (signals.weakSegments.length > 0) {
        lines.push('优先复盘 KB/部位组合:')
        for (var s = 0; s < signals.weakSegments.length; s++) {
          var seg = signals.weakSegments[s]
          lines.push('  - ' + seg.name + ' / ' + seg.bodyPart + ': 无帮助' + seg.notHelpful + ', 兽医不一致' + seg.vetDifferent + ', 主问题=' + seg.mainIssueLabel)
        }
      }
      if (signals.modelList.length > 0) {
        lines.push('模型表现:')
        for (var m = 0; m < signals.modelList.length; m++) {
          var model = signals.modelList[m]
          lines.push('  - ' + model.name + ': 样本' + model.total + ', 有帮助率' + model.helpfulRate + '%, 无帮助' + model.notHelpful + ', 兽医不一致' + model.vetDifferent)
        }
      }
      lines.push('')
    }

    var kbList = this.buildKbAccuracyList()
    if (kbList.length > 0) {
      lines.push('--- KB 匹配反馈 ---')
      for (var k = 0; k < kbList.length; k++) {
        var item = kbList[k]
        lines.push(item.name + ': 样本' + item.total + ', 有帮助率' + item.helpfulRate + '%, 无帮助' + item.notHelpful + ', 兽医不一致' + item.vetDifferent + ', 主问题=' + item.mainIssueLabel)
      }
      lines.push('')
    }

    if (signals && signals.reviewCases.length > 0) {
      lines.push('--- 优先人工复盘病例 ---')
      for (var c = 0; c < signals.reviewCases.length; c++) {
        var rc = signals.reviewCases[c]
        lines.push('[' + rc.id + '] ' + rc.disease + ' / KB=' + rc.kb + ' / 部位=' + rc.bodyPart + ' / 问题=' + rc.issueLabel + ' / 兽医=' + rc.vetOutcomeLabel + ' / 置信=' + rc.confidence)
      }
      lines.push('')
    }

    lines.push('--- 详细记录 ---')
    for (var i = 0; i < records.length; i++) {
      var r = records[i]
      var fb = r.feedback || {}
      var snap = fb.snapshot || {}
      lines.push('')
      lines.push('[' + (r.generatedAt || r.timestamp || '') + ']')
      lines.push('  诊断: ' + (r.primaryDiagnosis || r.disease || ''))
      lines.push('  KB匹配: ' + (r.ragMatchName || '无'))
      lines.push('  有帮助: ' + (fb.helpful === true ? '是' : fb.helpful === false ? '否' : '未填'))
      lines.push('  主要问题: ' + labelOf(ISSUE_LABELS, fb.issueType || ''))
      lines.push('  已就医: ' + (fb.wentToVet === true ? '是' : fb.wentToVet === false ? '否' : '未填'))
      lines.push('  兽医结论: ' + labelOf(VET_OUTCOME_LABELS, fb.vetOutcome || ''))
      lines.push('  上下文: 模型=' + (snap.modelProvider || r.modelProviderLabel || r.modelName || '') +
        ', 风险=' + (snap.urgency || r.urgency || '') +
        ', 置信=' + (snap.confidencePercent || r.primaryDiagnosisProbability || r.confidence || '') +
        ', 图片=' + (snap.imageCount || (r.imagePaths ? r.imagePaths.length : 0)) +
        ', 圈选=' + (snap.lesionCount || 0))
      lines.push('  品种: ' + (r.breed || '') + ' 部位: ' + (r.bodyPartLabel || '') + ' 主诉: ' + (r.complaint || ''))
    }
    wx.setClipboardData({
      data: lines.join('\n'),
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
        analytics.track('exportFeedback', { count: records.length })
      }
    })
  },

  exportAnalyticsEvents: function () {
    var events = analytics.getEvents()
    if (events.length === 0) {
      wx.showToast({ title: '暂无埋点数据', icon: 'none' })
      return
    }
    var summary = analytics.getSummary()
    var lines = ['=== VetAI 埋点日志 ===', '导出时间: ' + new Date().toLocaleString('zh-CN'), '']
    lines.push('汇总: 总事件' + summary.total + ', upload=' + summary.upload + ', submit=' + summary.submit + ', modelReturn=' + summary.modelReturn + ', feedback=' + summary.feedback + ', error=' + summary.error)
    // 快路径漏斗：结局分布 + 门槛逐关失败分布 + 预检耗时，用于定位命中率低的根因
    var rag = analytics.summarizeVisionRag(events)
    if (rag.total > 0) {
      lines.push('快路径: 共' + rag.total + '单, 抢跑命中=' + rag.hit + ', 结局=' + JSON.stringify(rag.byReason))
      lines.push('门槛首个失败=' + JSON.stringify(rag.gateFirst) + ', 门槛任一失败=' + JSON.stringify(rag.gateAny))
      if (rag.precheckMs) {
        lines.push('预检耗时: ' + rag.precheckMs.count + '单, p50=' + rag.precheckMs.p50 + 'ms, p90=' + rag.precheckMs.p90 + 'ms')
      }
    }
    lines.push('')
    for (var i = events.length - 1; i >= 0; i--) {
      var e = events[i]
      lines.push('[' + e.dateStr + '] ' + e.event + ' ' + JSON.stringify(e.data))
    }
    wx.setClipboardData({
      data: lines.join('\n'),
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
      }
    })
  }
})
