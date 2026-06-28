App({
  onLaunch: function () {
    // 初始化微信云开发，用云函数代理模型请求，避免 API Key 暴露在前端包里。
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0gc4m26t135ca759',
        traceUser: true
      })
    } else {
      console.warn('[VetAI] 当前基础库不支持 wx.cloud')
    }

    // 检测暗色模式
    this.initDarkMode()
  },

  globalData: {
    isDarkMode: false,
    systemInfo: null,
    analyticsEvents: []
  },

  initDarkMode: function () {
    try {
      var sysInfo = wx.getSystemInfoSync()
      this.globalData.systemInfo = sysInfo
      var theme = sysInfo.theme || 'light'
      this.globalData.isDarkMode = theme === 'dark'

      // 监听主题变化
      var self = this
      if (wx.onThemeChange) {
        wx.onThemeChange(function (res) {
          self.globalData.isDarkMode = res.theme === 'dark'
        })
      }
    } catch (e) {
      console.warn('[VetAI] 系统信息获取失败', e)
    }
  },

  isDarkMode: function () {
    return this.globalData.isDarkMode
  }
})
