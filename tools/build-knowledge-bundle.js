#!/usr/bin/env node
'use strict'
// 小程序 require() 不能加载 .json，运行时需要的证据台账与当前版本号由本脚本生成为 utils/knowledgeBundle.js。
// JSON 仍是唯一源文件；修改台账或发布新版本后运行 `npm run knowledge:bundle`。
// `--check` 只校验生成文件是否与 JSON 一致，不写文件，供测试与发布前检查使用。
// `--release ID`：发布前用计划中的新版本 ID 生成，使发布包内的 bundle 与发布后的 current-release.json 一致，避免发布后再产生漂移。
const fs = require('fs'), path = require('path')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'utils/knowledgeBundle.js')
const argv = process.argv.slice(2)
const releaseIdx = argv.indexOf('--release')
const RELEASE_OVERRIDE = releaseIdx >= 0 ? argv[releaseIdx + 1] : null

function render() {
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/evidence-ledger.json'), 'utf8'))
  const release = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/current-release.json'), 'utf8'))
  // JS 字符串字面量中 U+2028/U+2029 在旧引擎下是非法字符，统一转义为 \uXXXX
  const releaseId = RELEASE_OVERRIDE || release.id
  const json = JSON.stringify({ ledger: ledger, release: { id: releaseId } }, null, 2)
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029')
  return '// 由 tools/build-knowledge-bundle.js 从 knowledge/*.json 生成，请勿手改。\n' +
    '// 小程序 require 不支持 .json，故以 .js 形式提供证据台账与当前版本号。\n' +
    'module.exports = ' + json + '\n'
}

const text = render()
if (argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== text) {
    console.error('utils/knowledgeBundle.js is out of date; run npm run knowledge:bundle')
    process.exitCode = 1
  } else {
    console.log('utils/knowledgeBundle.js is in sync')
  }
} else {
  fs.writeFileSync(OUT, text)
  console.log('wrote utils/knowledgeBundle.js')
}
