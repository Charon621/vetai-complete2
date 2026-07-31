// v4 定稿底栏：纯文字 + 青柠下划线（无图标）。
// selected 由各 tab 页 onShow 里 getTabBar().setData 同步，
// 这里点击只负责 switchTab，避免先高亮后跳转的闪烁。
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '检查' },
      { pagePath: '/pages/detail/detail', text: '档案' },
      { pagePath: '/pages/user/user', text: '我的' }
    ]
  },

  methods: {
    switchTab: function (e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.list[index]
      if (!item) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
