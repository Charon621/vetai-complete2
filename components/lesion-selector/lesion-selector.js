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
    pathPoints: [],
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
        self.setData({
          mode: mode,
          modeLabel: mode === 'rectangle' ? '矩形框选' : '自由圈选',
          pathPoints: points,
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
        lesionUtil.drawPath(this._canvasData, points || this.data.pathPoints, rect.width, rect.height, this.data.mode, this.data.imageRect)
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
        self.setData({
          pathPoints: [point],
          pointCount: 1,
          canSave: false
        }, function () {
          self._draw([point])
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

      var points = self.data.pathPoints
      var last = points[points.length - 1]
      if (last && Math.abs(last.x - point.x) < 0.8 && Math.abs(last.y - point.y) < 0.8) return
      var nextPoints = points.concat(point).slice(-260)
      self.setData({
        pathPoints: nextPoints,
        pointCount: nextPoints.length,
        canSave: self._canSave(nextPoints, self.data.mode)
      }, function () {
        self._draw(nextPoints)
      })
    },

    onTouchEnd: function () {
      this._isDrawing = false
      this._draw()
    },

    _canSave: function (points, mode) {
      return mode === 'rectangle' ? points.length >= 2 : points.length >= 3
    },

    onModeTap: function (e) {
      var mode = e.currentTarget.dataset.mode || 'freehand'
      var self = this
      self._isDrawing = false
      self.setData({
        mode: mode,
        modeLabel: mode === 'rectangle' ? '矩形框选' : '自由圈选',
        pathPoints: [],
        pointCount: 0,
        canSave: false
      }, function () {
        self._draw([])
      })
    },

    onResetTap: function () {
      var self = this
      self._isDrawing = false
      self.setData({
        pathPoints: [],
        pointCount: 0,
        canSave: false
      }, function () {
        self._draw([])
      })
    },

    onSaveTap: function () {
      var points = this.data.pathPoints || []
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
      this.setData({
        pathPoints: [],
        pointCount: 0,
        canSave: false,
        stageRect: null,
        imageRect: null,
        imageInfo: null
      })
    }
  }
})
