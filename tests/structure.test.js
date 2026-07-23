const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const files = []

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name === '.git') return
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
  assert.doesNotThrow(function () {
    new Function(fs.readFileSync(file, 'utf8'))
  }, 'invalid JavaScript: ' + path.relative(root, file))
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
assert.ok(!/[•·●○▪▫◦‧∙⋅]/.test(visibleUiSource),
  'decorative dot glyph returned to UI markup or styles')

console.log('structure tests passed')
