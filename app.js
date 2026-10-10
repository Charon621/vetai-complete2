var config = require('./utils/config')
var imageUtil = require('./utils/image')
var fontFace = require('./utils/fontFace')

App({
  onLaunch: function () {
    // 初始化微信云开发，用云函数代理模型请求，避免 API Key 暴露在前端包里。
    // 环境 id 统一从 config.CLOUD_ENV 读取，避免两处硬编码失同步（BUG-A3）
    if (wx.cloud) {
      wx.cloud.init({
        env: config.CLOUD_ENV,
        traceUser: true
      })
    } else {
      console.warn('[VetAI] 当前基础库不支持 wx.cloud')
    }

    // BUG-UI58：真机安卓没有中文衬线，设计系统的宋体整套会掉回黑体。
    // 内置子集字体在这一步异步加载，失败也不影响功能（字体栈会自动回落）。
    fontFace.loadSerif()

    // 检测暗色模式
    this.initDarkMode()

    // 异步回收未被任何记录/档案/草稿引用且超期的本地图片（BUG-H3）
    setTimeout(function () {
      try {
        imageUtil.cleanupStaleImages()
      } catch (e) {
        console.warn('[VetAI] 图片清理失败', e)
      }
    }, 3000)
  },

  globalData: {
    isDarkMode: false,
    systemInfo: null,
    analyticsEvents: []
  },

  initDarkMode: function () {
    try {
      // wx.getSystemInfoSync 已废弃，优先用拆分后的新 API（BUG-A1）
      var appBase = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null
      var sysInfo = appBase || wx.getSystemInfoSync()
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
