#!/usr/bin/env node
// tools/run-tests.js — npm test 入口
//
// 取代原 package.json 里 17 段 `&&` 串行链：那条链上任何一个套件失败都会
// 掩盖后面所有套件的结果，CI 只能看到第一个挂掉的。这里顺序跑完全部套件、
// 逐个记录结果，最后输出汇总；任一失败退出码 1，失败套件的输出保持透传
//（stdio: inherit），方便直接在日志里定位。
//
// 套件顺序与原 && 链保持一致；新增测试时在此追加一行即可。

const { spawnSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const SUITES = [
  'tests/ragContracts.test.js',
  'tests/ragReplay.test.js',
  'tests/ragImages.test.js',
  'tests/ragConcepts.test.js',
  'tests/ragObservation.test.js',
  'tests/ragProfiles.test.js',
  'tests/ragRetrieval.test.js',
  'tests/ragAssessment.test.js',
  'tests/ragWorkflow.test.js',
  'tests/ragStorage.test.js',
  'tests/ragView.test.js',
  'tests/ragEvaluation.test.js',
  'tests/ragPages.test.js',
  'tests/structure.test.js',
  'tests/tabBar.test.js',
  'tests/uiInteractions.test.js',
  'tests/greeting.test.js',
  'tests/storage.test.js',
  'tests/kb.test.js',
  'tests/precheck-vocab-contract.test.js',
  'tests/parallel-diagnosis-contract.test.js',
  'tests/card-specific-exams.test.js',
  'tests/feline-card-boundaries.test.js',
  'tests/retrieval-scope-contract.test.js',
  'tests/caseFacts.test.js',
  'tests/lesion-scope-contract.test.js',
  'tests/evaluationTrace.test.js',
  'tests/pairedReplay.test.js',
  'tests/evaluationRecord.test.js',
  'tests/api.test.js',
  'tests/prompt-contract.test.js',
  'tests/api-integration.test.js',
  'tests/fastpath-integration.test.js',
  'tests/diagnosis-output-contract.test.js',
  'tests/species-output-contract.test.js',
  'tests/output-safety.test.js',
  'evaluation/tools/claim_registry.js',
  'tests/chatDoctor.test.js',
  'tests/chatPage.test.js',
  'tests/image.test.js',
  'tests/lesion.test.js',
  'tests/retrievalMetrics.test.js',
  'tests/retrievalExperiments.test.js',
  'tests/knowledgeEvidence.test.js',
  'tests/pythonContract.test.js',
  'tests/cloud-function.test.js',
  'evaluation/tools/kb_audit.js',
  'evaluation/tools/recall_probe.js'
]

const failures = []

for (const suite of SUITES) {
  const res = spawnSync(process.execPath, [path.join(ROOT, suite)], {
    stdio: 'inherit',
    env: process.env
  })
  const failed = res.status !== 0 || res.error
  console.log((failed ? '[FAIL] ' : '[ ok ] ') + suite + '\n')
  if (failed) failures.push(suite)
}

console.log('────────────────────────────────────────')
if (failures.length) {
  console.log('套件总数 ' + SUITES.length + '，失败 ' + failures.length + ' 个：')
  failures.forEach(function (suite) { console.log('  ✗ ' + suite) })
  process.exit(1)
}
console.log('全部 ' + SUITES.length + ' 个套件通过')
