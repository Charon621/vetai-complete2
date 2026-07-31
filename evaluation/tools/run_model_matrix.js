#!/usr/bin/env node
/**
 * BUG-N3：Qwen 场景回归矩阵运行器 —— dry-run 骨架（不发起任何真实模型调用）。
 *
 * 用途：为未来在独立开发集上对比 Qwen 候选版本提供可复现、可追溯的矩阵框架。
 * 本骨架只验证结构与指标口径，不联网、不调用模型、不写病例正文/图片/API Key。
 *
 * 用法：
 *   node evaluation/tools/run_model_matrix.js --dry-run   # 校验结构与指标口径（默认）
 *
 * 约定（遵循项目规则）：
 *   - ES5 风格（var、无箭头函数、无模板字符串）
 *   - 中文注释；新增功能以 BUG-N3 标注
 *   - 生产模型选择门禁：先保证安全指标不回退，再比较 JSON 稳定性与耗时，
 *     最后才看方向性召回；不以通用榜单决定生产模型。
 *   - 只报告带分子/分母与 Wilson 区间的结果，不用小样本点估计做宣传。
 */
'use strict'

var fs = require('fs')
var path = require('path')

var CONFIG_PATH = path.join(__dirname, '..', 'gold_standard', 'benchmark_config.json')
var OUT_DIR = path.join(__dirname, '..', 'runs')

// 指标口径定义：每个模型必须收集这些指标（dry-run 只校验口径存在）
var REQUIRED_METRICS = [
  'precheck_latency_p50', 'precheck_latency_p95',
  'full_latency_p50', 'full_latency_p95',
  'end_to_end_latency_p50', 'end_to_end_latency_p95',
  'timeout_rate',
  'json_direct_parse_rate', 'json_fallback_layer_distribution',
  'field_missing_rate', 'enum_out_of_range_rate',
  'low_quality_correct_reject_rate', 'insufficient_evidence_reject_rate',
  'over_reject_on_readable_rate',
  'high_risk_see_vet_recall', 'dangerous_false_reassurance_rate',
  'dangerous_medication_rate',
  'current_evidence_extraction_rate', 'old_record_pollution_rate', 'correction_apply_rate'
]

// 分层维度：与 benchmark_config.json 的 external_stratification.dimensions 对齐
var STRAT_DIMENSIONS = [
  'species', 'coat_color_group', 'coat_length_group', 'capture_environment',
  'lighting_condition', 'device_type', 'image_distance', 'background_complexity',
  'input_channel', 'conversation_turn_count', 'current_history_conflict', 'photo_quality'
]

function loadConfig() {
  var raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(raw)
}

function validateConfig(cfg) {
  var problems = []
  if (!cfg.external_stratification) {
    problems.push('benchmark_config.json 缺少 external_stratification 块')
  } else {
    var dims = cfg.external_stratification.dimensions || []
    STRAT_DIMENSIONS.forEach(function (d) {
      if (dims.indexOf(d) < 0) problems.push('缺少分层维度: ' + d)
    })
  }
  return problems
}

// 母体：单次运行的记录结构（dry-run 只校验 schema，不真正填充数值）
function createRunRecord(modelId, promptSha, kbVersion, codeCommit) {
  var metrics = {}
  REQUIRED_METRICS.forEach(function (m) { metrics[m] = null })
  var stratification = {}
  STRAT_DIMENSIONS.forEach(function (d) { stratification[d] = {} })
  return {
    model: modelId,
    prompt_version_sha256: promptSha,
    knowledge_snapshot: kbVersion,
    code_commit: codeCommit,
    temperature: null,
    generated_at: null,
    // 每维度指标：{ dimension_value: { numerator, denominator, rate } }
    metrics: metrics,
    stratification: stratification,
    raw_responses: [] // dry-run 不保留原始响应（避免存病例正文）
  }
}

function dryRun(cfg) {
  var problems = validateConfig(cfg)
  var ok = problems.length === 0
  var record = createRunRecord('dry-run-model', 'pending', 'pending', 'pending')

  console.log('=== run_model_matrix.js dry-run ===')
  console.log('配置: ' + CONFIG_PATH)
  console.log('分层维度数: ' + STRAT_DIMENSIONS.length)
  console.log('指标口径数: ' + REQUIRED_METRICS.length)
  console.log('校验结果: ' + (ok ? '通过' : '发现问题 ' + problems.length + ' 项'))
  problems.forEach(function (p) { console.log('  - ' + p) })
  console.log('运行记录 schema 已生成（未含任何真实数值，未发起模型调用）')
  console.log('运行记录将写入: ' + OUT_DIR)
  return { ok: ok, problems: problems, record: record }
}

function main() {
  var args = process.argv.slice(2)
  var isDry = args.indexOf('--dry-run') >= 0 || args.indexOf('--live') < 0
  var cfg = loadConfig()

  if (!isDry) {
    // BUG-N3：live 模式预留 —— 现阶段不实现，避免在冻结集上挑版本或产生未受控成本。
    console.log('live 模式尚未启用。生产选型只允许在独立开发集上运行，且须先跑 dry-run 校验。')
    console.log('请使用 --dry-run 校验结构后再在受控环境启用 live。')
    process.exit(0)
  }

  var result = dryRun(cfg)
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR)
  var outPath = path.join(OUT_DIR, 'run_model_matrix_dryrun_selfcheck.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log('已写入: ' + outPath)

  process.exit(result.ok ? 0 : 1)
}

main()
