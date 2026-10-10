var assert = require('assert')
var fs = require('fs')
var path = require('path')
var vm = require('vm')
var component
var timers = new Map()
var nextTimer = 0
var pages = []
var active = 0
var requests = 0
var navigations = 0
var outcome = 'success'
var pendingNavigation
var hideState
var coldTarget = false

function makePage(index, sync) {
  var page = {
    data: JSON.parse(JSON.stringify(component.data)),
    patches: [],
    setData: function (patch) {
      Object.assign(this.data, patch)
      this.patches.push(Object.assign({}, this.data))
    }
  }
  Object.keys(component.methods).forEach(function (name) { page[name] = component.methods[name] })
  if (sync !== false) {
    page.syncSelected(index)
    component.lifetimes.attached.call(page)
  }
  return page
}
var wx = {
  switchTab: function (options) {
    requests++
    if (outcome === 'pending') { pendingNavigation = options; return }
    if (outcome === 'fail') { options.fail(); options.complete(); return }
    var origin = active
    var target = pages[origin].data.list.findIndex(function (item) { return item.pagePath === options.url })
    // 导航回调可能早于渲染交接；不能依赖 complete 才把旧页复位。
    options.complete()
    assert.strictEqual(pages[origin].data.selected, target, 'complete 后旧页仍必须停在终点')
    if (!coldTarget) {
      assert.strictEqual(pages[target].data.selected, target, '缓存目标页必须在 onShow 前就定位完成')
      assert.strictEqual(pages[target].data.switching, false)
    }
    component.pageLifetimes.hide.call(pages[origin])
    hideState = Object.assign({}, pages[origin].data)
    if (coldTarget) {
      component.lifetimes.detached.call(pages[target])
      pages[target] = makePage(target, false)
      assert.strictEqual(pages[target].data.ready, false)
      component.lifetimes.attached.call(pages[target])
      assert.strictEqual(pages[target].patches[0].selected, target, '首次显示前直接定位到目标项')
      assert.strictEqual(pages[target].patches[0].switching, false)
      coldTarget = false
    }
    active = target
    pages[target].syncSelected(target)
    navigations++
  }
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','custom-tab-bar','index.js'),'utf8'),{
  Component: function (value) { component = value },
  wx: wx,
  setTimeout: function (callback) { var id = ++nextTimer; timers.set(id,callback); return id },
  clearTimeout: function (id) { timers.delete(id) }
})
pages.push(makePage(0),makePage(1),makePage(2))
function tap(index) { pages[active].switchTab({currentTarget:{dataset:{index:index}}}) }
function finishSlide() { pages[active].onSlideEnd() }

// BUG-UI74：当前页只滑动一次；hide 不复位可见旧页，目标页不重播。
;[1,2,0,2,1,0].forEach(function (target) {
  var origin = active
  var requestCount = requests
  tap(target)
  assert.strictEqual(active,origin)
  assert.strictEqual(pages[origin].data.slideFrom,origin)
  assert.strictEqual(pages[origin].data.selected,target)
  assert.strictEqual(pages[origin].data.switching,true)
  assert.strictEqual(requests,requestCount,'滑动结束前不切页，避免两页各播一次')
  pages[origin].syncSelected(origin)
  assert.strictEqual(pages[origin].data.switching,true,'重复 onShow 不中途复位')
  tap((target+1)%3)
  assert.strictEqual(pages[origin].data.selected,target,'动效期间连点不反复跳动')
  finishSlide()
  assert.strictEqual(active,target)
  assert.strictEqual(hideState.selected,target,'旧页最后一帧不闪回原位')
  assert.strictEqual(hideState.switching,false)
  assert.strictEqual(pages[target].data.selected,target)
  assert.strictEqual(pages[target].data.switching,false,'目标页不能再播放第二次滑动')
  assert.strictEqual(pages[origin].data.selected,target,'导航完成后旧页也保持终点，避免交接回闪')
  assert.strictEqual(timers.size,0)
  pages[origin].onSlideEnd()
  assert.strictEqual(requests,requestCount+1,'过期动画结束事件不重复导航')
})
assert.strictEqual(navigations,6)

tap(0)
tap(99)
assert.strictEqual(timers.size,0)
assert.strictEqual(requests,6)

// 动画结束事件未派发时，兜底计时器仍只发出一次导航。
tap(1)
var fallback = timers.values().next().value
fallback()
pages[0].onSlideEnd()
assert.strictEqual(active,1)
assert.strictEqual(timers.size,0)
assert.strictEqual(requests,7)

outcome = 'fail'
tap(2)
finishSlide()
assert.strictEqual(active,1)
assert.strictEqual(pages[1].data.selected,1)
assert.strictEqual(pages[1].data.switching,false)
assert.strictEqual(pages[1]._navigating,false)
outcome = 'success'
tap(2)
finishSlide()
assert.strictEqual(active,2)

outcome = 'pending'
tap(0)
finishSlide()
var inFlightRequests = requests
tap(1)
assert.strictEqual(requests,inFlightRequests)
pendingNavigation.fail()
pendingNavigation.complete()
assert.strictEqual(pages[2].data.selected,2)
assert.strictEqual(pages[2]._navigating,false)

// 外部导航或组件销毁不能遗留一个稍后自动切页的计时器。
outcome = 'success'
tap(0)
component.pageLifetimes.hide.call(pages[2])
pages[2].onSlideEnd()
assert.strictEqual(requests,inFlightRequests)
assert.strictEqual(timers.size,0)
pages[2].syncSelected(2)
assert.strictEqual(pages[2].data.selected,2)
assert.strictEqual(pages[2].data.switching,false)
tap(1)
component.lifetimes.detached.call(pages[2])
assert.strictEqual(timers.size,0)
pages[2].syncSelected(2)
assert.strictEqual(pages[2].data.switching,false)

// 首次进入尚未创建过的目标页不先闪现默认选中“检查”。
coldTarget = true
tap(1)
finishSlide()
assert.strictEqual(active,1)
assert.strictEqual(pages[1].data.switching,false)
console.log('tabBar navigation state passed')
