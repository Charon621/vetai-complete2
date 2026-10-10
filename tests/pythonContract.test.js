#!/usr/bin/env node
// tests/pythonContract.test.js — 把 Python 评测契约自检纳入 npm test（B14 起生效）。
//
// 评测侧契约（validate_annotations / reference_candidates / test_reference_contract）
// 是 Python 工具；此前只靠手工运行，npm test 探不到回归。这里逐个 spawn 运行，
// 任一非零退出即失败。Windows 上命令名是 python，CI（ubuntu）优先 python3。

const { spawnSync } = require('child_process')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')

function runPython(args) {
  for (const exe of ['python3', 'python']) {
    const res = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8' })
    if (res.error && res.error.code === 'ENOENT') continue // 该机器没有这个命令名
    // Windows 的 python3 可能是 Microsoft Store 别名 stub：退出码 9009 + 提示语
    if (res.status === 9009 || (res.stderr || '').indexOf('Python was not found') >= 0) continue
    return { exe: exe, res: res }
  }
  throw new Error('未找到可用的 python/python3：评测契约自检无法运行')
}

const CHECKS = [
  ['validate_annotations self-test', ['evaluation/tools/validate_annotations.py', '--self-test']],
  ['reference_candidates self-test', ['evaluation/tools/reference_candidates.py', '--self-test']],
  ['reference contract tests', ['evaluation/tests/test_reference_contract.py']],
  ['attempt accounting tests', ['evaluation/tests/test_attempt_accounting.py']],
  ['system scorer self-test', ['evaluation/tools/score_system_outputs.py', '--self-test']],
  ['animal join tests', ['evaluation/tests/test_animal_join.py']]
]

for (const [name, args] of CHECKS) {
  const { exe, res } = runPython(args)
  assert.strictEqual(res.status, 0,
    name + ' 失败（' + exe + '）\nstdout: ' + res.stdout + '\nstderr: ' + res.stderr)
  console.log('  ok - ' + name + ' (' + exe + ')')
}

console.log('python contract tests passed')
