// ============================================================
// components/lesion-selector
// 患处圈选浮层（自由圈选 + 矩形框选）
// 页面通过 visible/imagePath/initialBox 控制，
// 通过 save/clear/close 事件回收结果，存储逻辑留在页面侧。
// ============================================================

var lesionUtil = require('../../utils/lesion')

Component({
  options: {
    // 需要消费 app.wxss 的 vet-btn / vet-label 等全局类
    styleIsolation: 'apply-shared'
  },

  properties: {
    visible: { type: Boolean, value: false },
    imagePath: { type: String, value: '' },
    initialBox: { type: Object, value: null }
  },

  data: {
    mode: 'freehand',
    modeLabel: '自由圈选',
    pointCount: 0,
    canSave: false,
    stageRect: null,
    imageRect: null,
    imageInfo: null
  },

  observers: {
    'visible': function (visible) {
      if (visible) this._open()
    }
  },

  lifetimes: {
    detached: function () {
      this._canvasData = null
      this._isDrawing = false
      this._points = []
    }
  },

  methods: {
    noop: function () {},

    _open: function () {
      var self = this
      var existing = this.data.initialBox
      var mode = existing && existing.type === 'rectangle' ? 'rectangle' : 'freehand'
      var points = existing && Array.isArray(existing.points)
        ? existing.points.map(function (p) {
          return {
            x: Math.max(0, Math.min(100, Math.round((p.x || 0) * 100))),
            y: Math.max(0, Math.min(100, Math.round((p.y || 0) * 100)))
          }
        })
        : []

      var init = function (info) {
        self._canvasData = null
        self._isDrawing = false
        // 路径点只存实例变量，不进 setData（高频 touchmove 下避免大数组传输，BUG-I3）
        self._points = points
        self.setData({
          mode: mode,
          modeLabel: mode === 'rectangle' ? '矩形框选' : '自由圈选',
          pointCount: points.length,
          canSave: self._canSave(points, mode),
          stageRect: null,
          imageRect: null,
          imageInfo: info
        }, function () {
          self._measure(function () {
            self._draw(points)
          })
        })
      }

      if (this.data.imagePath) {
        wx.getImageInfo({
          src: this.data.imagePath,
          success: function (info) {
            init({ width: info.width, height: info.height })
          },
          fail: function () {
            init(null)
          }
        })
      } else {
        init(null)
      }
    },

    _measure: function (callback) {
      var self = this
      wx.createSelectorQuery().in(this)
        .select('.lesion-stage')
        .boundingClientRect(function (rect) {
          if (!rect) return
          var info = self.data.imageInfo || {}
          var imageRect = lesionUtil.getAspectFitRect(rect.width, rect.height, info.width, info.height)
          self.setData({ stageRect: rect, imageRect: imageRect })
          lesionUtil.initCanvas(self, 'lesionCanvas').then(function (canvasData) {
            self._canvasData = canvasData
            if (callback) callback(rect)
          })
        })
        .exec()
    },

    _draw: function (points) {
      var rect = this.data.stageRect
      if (rect && this._canvasData) {
        lesionUtil.drawPath(this._canvasData, points || this._points || [], rect.width, rect.height, this.data.mode, this.data.imageRect)
      }
    },

    onTouchStart: function (e) {
      var self = this
      var touch = e.touches && e.touches[0]
      var begin = function (rect) {
        rect = rect || self.data.stageRect
        var point = lesionUtil.getPoint(touch, rect, self.data.imageRect)
        if (!point) return
        self._isDrawing = true
        lesionUtil.vibrate('light')
        self._points = [point]
        self.setData({
          pointCount: 1,
          canSave: false
        }, function () {
          self._draw(self._points)
        })
      }
      if (self.data.stageRect) begin(self.data.stageRect)
      else self._measure(begin)
    },

    onTouchMove: function (e) {
      var self = this
      if (!self._isDrawing) return
      var touch = e.touches && e.touches[0]
      var point = lesionUtil.getPoint(touch, self.data.stageRect, self.data.imageRect)
      if (!point) return

      var points = self._points || []
      var last = points[points.length - 1]
      if (last && Math.abs(last.x - point.x) < 0.8 && Math.abs(last.y - point.y) < 0.8) return
      self._points = points.concat(point).slice(-260)

      // 重绘和 setData 都按 16ms 节流，降低低端机 touchmove 卡顿（BUG-I3）
      var now = Date.now()
      if (self._lastDrawAt && now - self._lastDrawAt < 16) return
      self._lastDrawAt = now
      self.setData({
        pointCount: self._points.length,
        canSave: self._canSave(self._points, self.data.mode)
      })
      self._draw(self._points)
    },

    onTouchEnd: function () {
      this._isDrawing = false
      // 补齐节流期间可能漏掉的最后一帧状态
      this.setData({
        pointCount: (this._points || []).length,
        canSave: this._canSave(this._points || [], this.data.mode)
      })
      this._draw()
    },

    _canSave: function (points, mode) {
      return mode === 'rectangle' ? points.length >= 2 : points.length >= 3
    },

    onModeTap: function (e) {
      var mode = e.currentTarget.dataset.mode || 'freehand'
      var self = this
      self._isDrawing = false
      self._points = []
      self.setData({
        mode: mode,
        modeLabel: mode === 'rectangle' ? '矩形框选' : '自由圈选',
        pointCount: 0,
        canSave: false
      }, function () {
        self._draw([])
      })
    },

    onResetTap: function () {
      var self = this
      self._isDrawing = false
      self._points = []
      self.setData({
        pointCount: 0,
        canSave: false
      }, function () {
        self._draw([])
      })
    },

    onSaveTap: function () {
      var points = this._points || []
      if (!this._canSave(points, this.data.mode)) {
        wx.showToast({ title: '请用手指圈出患处', icon: 'none' })
        return
      }
      var box = lesionUtil.buildLesionBox(points, this.data.mode)
      var mode = this.data.mode
      this._teardown()
      this.triggerEvent('save', { box: box, mode: mode, pointCount: points.length })
    },

    onClearTap: function () {
      this._teardown()
      this.triggerEvent('clear')
    },

    onCloseTap: function () {
      this._teardown()
      this.triggerEvent('close')
    },

    _teardown: function () {
      this._canvasData = null
      this._isDrawing = false
      this._points = []
      this.setData({
        pointCount: 0,
        canSave: false,
        stageRect: null,
        imageRect: null,
        imageInfo: null
      })
    }
  }
})
