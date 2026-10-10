const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const files = []

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name === '.git') return
    // 独立协作网页使用 ESM/TypeScript，由其类型检查和构建校验；必须排除小程序打包。
    if (dir === root && entry.name === 'collaboration-web') {
      const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
      assert.ok(projectConfig.packOptions.ignore.some(function (item) {
        return item.type === 'folder' && item.value === 'collaboration-web'
      }), 'collaboration website must be excluded from mini-program packaging')
      return
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else files.push(fullPath)
  })
}

walk(root)

files.filter(function (file) { return file.endsWith('.json') }).forEach(function (file) {
  assert.doesNotThrow(function () {
    JSON.parse(fs.readFileSync(file, 'utf8'))
  }, 'invalid JSON: ' + path.relative(root, file))
})

files.filter(function (file) { return file.endsWith('.js') }).forEach(function (file) {
  // CLI 工具的首行 shebang 是合法 Node 脚本（Node 自身会剥离），
  // 但放进 new Function 的函数体会被当成语法错误，这里先剥离再校验。
  const source = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*/, '')
  assert.doesNotThrow(function () {
    new Function(source)
  }, 'invalid JavaScript: ' + path.relative(root, file))
})

// WXML 标签必须配平。开发者工具报的 "expect end-tag block., near view"
// 就是这类结构错误，而它只在编译期暴露；这条断言把它提前到测试里（BUG-UI55）。
const WXML_VOID_TAGS = new Set(['image', 'input', 'icon', 'progress', 'slider', 'switch', 'import', 'include'])
files.filter(function (file) { return file.endsWith('.wxml') }).forEach(function (file) {
  const markup = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  let failure = ''
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let tagMatch
  while ((tagMatch = tagPattern.exec(markup))) {
    const closing = tagMatch[1] === '/'
    const name = tagMatch[2]
    const selfClosing = tagMatch[4] === '/'
    if (closing) {
      const open = stack.pop()
      if (open !== name) {
        failure = '</' + name + '> 与 <' + (open || '无') + '> 不匹配'
        break
      }
    } else if (!selfClosing && !WXML_VOID_TAGS.has(name)) {
      stack.push(name)
    }
  }
  if (failure) assert.fail(path.relative(root, file) + ' 标签不配平: ' + failure)
  if (stack.length) assert.fail(path.relative(root, file) + ' 未闭合标签: ' + stack.join(' > '))
})

files.filter(function (file) { return file.endsWith('.wxml') }).forEach(function (file) {
  const markup = fs.readFileSync(file, 'utf8')
  const scriptPath = file.replace(/\.wxml$/, '.js')
  const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : ''
  const eventPattern = /\b(?:bind|catch)(?:tap|input|change|confirm|submit|touchstart|touchmove|touchend|longpress)\s*=\s*["']([^"'{}]+)["']/g
  const handlers = []
  let match
  while ((match = eventPattern.exec(markup))) handlers.push(match[1])
  Array.from(new Set(handlers)).forEach(function (handler) {
    const escaped = handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.ok(new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*function\\b').test(script),
      path.relative(root, file) + ' binds missing handler ' + handler)
  })
})

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const registeredPages = app.pages.concat((app.subPackages || []).reduce(function (all, subPackage) {
  return all.concat(subPackage.pages.map(function (page) { return subPackage.root + '/' + page }))
}, []))

registeredPages.forEach(function (page) {
  ;['.js', '.json', '.wxml', '.wxss'].forEach(function (extension) {
    assert.ok(fs.existsSync(path.join(root, page + extension)), 'missing page file: ' + page + extension)
  })
})

const uiSource = files.filter(function (file) {
  return file.endsWith('.wxml') || file.endsWith('.wxss')
}).map(function (file) { return fs.readFileSync(file, 'utf8') }).join('\n')
const visibleUiSource = uiSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')

assert.ok(!/section-title-bar|triage-sev-bar|class=["'][^"']*\bsev-bar\b/.test(uiSource),
  'decorative vertical color rail returned')
assert.ok(!/border-left:\s*[3-9]rpx\s+solid\s+(?:var\(--(?:brand|accent|sev)|#[0-9a-f])/i.test(uiSource),
  'thick colored left border returned')
assert.ok(!/advice-indicator|proof-dot|meta-dot|chat-header-sub::before|analyzing-pulse/.test(uiSource),
  'decorative dot indicator returned')
// BUG-UI63：允许报告来源句中的语义分隔，继续禁止其他装饰点号。
assert.ok(!/[•·●○▪▫◦‧∙⋅]/.test(visibleUiSource.replace('AI 生成 · 仅供参考', 'AI 生成，仅供参考')),
  'decorative dot glyph returned to UI markup or styles')

// v7：不画分割线 —— 页面样式里不允许出现 border-top/bottom/left/right 的实线分隔，
// 也不允许恢复 vet-divider 分割线组件（层次只靠留白、底色和卡片）
const pageStyleSource = files.filter(function (file) {
  return file.endsWith('.wxss')
}).map(function (file) { return fs.readFileSync(file, 'utf8') }).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
assert.ok(!/border-(?:top|bottom|left|right)\s*:\s*[^;]*solid/i.test(pageStyleSource),
  'solid divider border returned to page styles')
assert.ok(!/vet-divider/.test(uiSource), 'vet-divider rule returned')

// 页面引用的 /assets 图片必须真实存在（图标由 tools/build-icons.js 生成）
files.filter(function (file) { return file.endsWith('.wxml') || file.endsWith('.js') })
  .filter(function (file) { return file.indexOf(path.sep + 'tests' + path.sep) < 0 && file.indexOf(path.sep + 'tools' + path.sep) < 0 })
  .forEach(function (file) {
    const source = fs.readFileSync(file, 'utf8')
    const assetPattern = /\/assets\/[\w\-./]+\.(?:svg|png|jpg)/g
    let assetMatch
    while ((assetMatch = assetPattern.exec(source))) {
      assert.ok(fs.existsSync(path.join(root, assetMatch[0])),
        path.relative(root, file) + ' references missing asset ' + assetMatch[0])
    }
  })

console.log('structure tests passed')
