// v7 底栏：Phosphor 图标 + 文字，选中换实心陶土图标。
// selected 由各 tab 页 onShow 同步；点击时先滑动一次再切页（BUG-UI74）。
// 切页完成后才复位已隐藏的旧实例，新实例直接定位，不重播滑动。
// hidden（BUG-UI56）：拍照初筛流程是 index 页内的 step 状态、不切页，
// 底栏原本一直压在「生成初筛报告」按钮上；流程里把它收起来。
// BUG-UI74：记录目标位置供新实例初始化，避免先显示默认“检查”再跳到目标。
var currentTabIndex = 0

Component({
  data: {
    selected: 0,
    ready: false,
    switching: false,
    slideFrom: 0,
    hidden: false,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '检查',
        icon: '/assets/icons/paw-print-light-mute.svg',
        iconOn: '/assets/icons/paw-print-fill-clay.svg'
      },
      {
        pagePath: '/pages/detail/detail',
        text: '档案',
        icon: '/assets/icons/notebook-light-mute.svg',
        iconOn: '/assets/icons/notebook-fill-clay.svg'
      },
      {
        pagePath: '/pages/user/user',
        text: '我的',
        icon: '/assets/icons/user-light-mute.svg',
        iconOn: '/assets/icons/user-fill-clay.svg'
      }
    ]
  },

  lifetimes: {
    attached: function () {
      var index = this._pageIndex !== undefined ? this._pageIndex : currentTabIndex
      this.setData({ selected: index, slideFrom: index, switching: false, ready: true })
    },
    detached: function () {
      this._cancelSlide()
    }
  },

  pageLifetimes: {
    hide: function () {
      // 外部导航打断尚未结束的滑动时，取消待发出的切页。
      // 不在这里写选中态：hide 回调发生时旧页可能仍有一帧可见。
      if (this._pendingTab) this._cancelSlide()
    }
  },

  methods: {
    syncSelected: function (index) {
      this._pageIndex = index
      // 同一页重复同步时不打断正在播放的本次点击动画。
      if (this._navigating) return
      currentTabIndex = index
      if (!this.data.ready || this.data.selected !== index || this.data.switching) {
        this.setData({ selected: index, slideFrom: index, switching: false, ready: true })
      }
    },

    onSlideEnd: function () {
      this._finishSlide()
    },

    _cancelSlide: function () {
      if (this._slideTimer) clearTimeout(this._slideTimer)
      this._slideTimer = null
      this._pendingTab = null
      this._navigating = false
    },

    _finishSlide: function () {
      var pending = this._pendingTab
      if (!pending) return
      if (this._slideTimer) clearTimeout(this._slideTimer)
      this._slideTimer = null
      this._pendingTab = null
      this.setData({ switching: false })
      currentTabIndex = pending.index
      var self = this
      wx.switchTab({
        url: pending.item.pagePath,
        fail: function () {
          currentTabIndex = pending.origin
          self.setData({ selected: pending.origin, slideFrom: pending.origin, switching: false })
        },
        complete: function () {
          // 此时旧页已隐藏；准备下次返回，不能在 hide 中提前复位。
          self.setData({ selected: pending.origin, slideFrom: pending.origin, switching: false })
          self._navigating = false
        }
      })
    },

    switchTab: function (e) {
      var index = Number(e.currentTarget.dataset.index)
      var item = this.data.list[index]
      if (!item || this._navigating) return
      var origin = this._pageIndex !== undefined ? this._pageIndex : this.data.selected
      if (index === origin) return
      this._navigating = true
      this._pendingTab = { origin: origin, index: index, item: item }
      this.setData({ selected: index, slideFrom: origin, switching: true })
      var self = this
      // 动画结束事件优先；少数环境不派发该事件时 220ms 兜底，不重复导航。
      this._slideTimer = setTimeout(function () { self._finishSlide() }, 220)
    }
  }
})
