// ============================================================
// VetAI 前端直连大模型 API 配置
// ⚠️  API Key 仅用于本地开发测试，请勿提交到公开仓库！
// ============================================================

module.exports = {
  // 应用版本号：与 package.json 保持一致，「关于 VetAI」直接读取（BUG-UI39）
  APP_VERSION: '3.0.0',

  // ---------- 阿里云百炼（多模态视觉模型）----------
  // 正式使用时不要在小程序前端保存 API Key。默认走微信云函数代理。
  USE_CLOUD_FUNCTION: true,
  DIAGNOSE_CLOUD_FUNCTION: 'diagnose',
  CLOUD_ENV: 'cloud1-d0gc4m26t135ca759',
  QWEN_API_KEY: '',
  QWEN_API_BASE: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  // 预检与完整报告均使用 Qwen3.8-Flash
  QWEN_MODEL: 'qwen3.8-flash',
  QWEN_LABEL: 'Qwen3.8-Flash',
  // 完整报告限定思考预算；预检与问诊关闭思考
  QWEN_ENABLE_THINKING: true,
  QWEN_THINKING_BUDGET: 2048,

  // ---------- 视觉特征驱动 RAG ----------
  // 总开关：开启时接入本地皮肤病知识库；关闭时只走模型诊断，不注入知识库、不走知识库快路径
  USE_KNOWLEDGE_BASE: true,
  // 恢复原诊断流程：并行预检与完整报告，强命中才走原快路径。guided 仅显式试验使用。
  RAG_WORKFLOW_MODE: 'legacy',
  // 快路径（BUG-G8：2026-07-31 起启用；BUG-G9 收紧证据来源；2026-10-01 加区分度门槛）。
  // 视觉预检强命中知识库时立即出报告（约 3-5s），不再等完整诊断；门槛严格：
  // score≥8 + 非泛词证据≥2 + top2 间隔≥VISION_RAG_MIN_GAP + 组合规则/别名/3 个非泛词视觉特征，
  // 且至少 VISION_RAG_MIN_PRECHECK_HITS 个非泛词视觉命中来自视觉预检（照片侧）——
  // 组合规则、别名、主诉侧视觉词都可能被主诉文本单独命中，只有预检特征能证明照片里
  // 确实看到了该病的特征性表现。未达强命中标准时仍走完整诊断，行为与之前一致。
  //
  // 2026-10-01 实测（99 例）发现上面这套门槛量的是"预检模型报了几个词"，不是"有多确定"：
  // 预检输出 2 个词时触发率 13%、3 个词 84.8%、6 个词 100%，而判对率不随之上升；
  // 仅有的 2 个错误触发，Top1 的证据全是"别的候选也有"的通用词（区分度为 0）。
  // 因此新增区分度硬门槛，并把"是否抢跑"与"是否够格"拆开：
  //   够格（isStrongVisionRagHit）= 原门槛 + 区分度 ≥ VISION_RAG_MIN_DISCRIMINATIVE
  //   抢跑（shouldResolveFastRag）= 区分度 ≥ VISION_RAG_MIN_DISCRIMINATIVE_EAGER 且非高危方向
  // 区分度=1 的病例交给并行跑着的完整诊断出结论（知识库归因照旧保留），只损失几秒速度。
  VISION_RAG_FAST_PATH: true,
  VISION_RAG_TRACE: true,
  VISION_RAG_MAX_IMAGES: 2,
  VISION_RAG_MIN_SCORE: 8,
  VISION_RAG_MIN_SYMPTOM_MATCHES: 2,
  VISION_RAG_MIN_PRECHECK_HITS: 1,
  // Top1 至少要有几个"不在 Top2/Top3 视觉词表里"的非泛视觉词。0 = 关闭该检查。
  VISION_RAG_MIN_DISCRIMINATIVE: 1,
  // 立即出报告所需的最小区分度（低于它则等完整诊断落地后出结论）。0 = 一律立即出报告。
  VISION_RAG_MIN_DISCRIMINATIVE_EAGER: 2,
  // Top1 与 Top2 的最小检索分间隔。原来硬编码 3，只相当于"少命中一个词"，
  // 实测出现间隔 3.4 就放行的病例；提到 5 让"两卡接近"真正能挡住快路径。
  VISION_RAG_MIN_GAP: 5,
  // 预检模型：轻量快速，用于视觉特征提取；完整诊断仍用 QWEN_MODEL
  QWEN_PRECHECK_MODEL: 'qwen3.8-flash',

  // ---------- 请求超时（毫秒，与 app.json networkTimeout 保持一致）----------
  API_TIMEOUT: 60000,
  PRECHECK_TIMEOUT: 18000,
  // max_completion_tokens 限制思考与正文总量；2048 思考预算后仍留 4096 给完整 JSON。
  MODEL_MAX_COMPLETION_TOKENS: 6144,

  // ---------- 图片限制 ----------
  MAX_IMAGES: 5,
  // 发送给模型的总图片上限。最多 1 张原图 + 1 张病灶 ROI，或 2 张原图。
  MAX_MODEL_IMAGES: 2,
  MAX_ROI_IMAGES: 1,
  // 送模型图片统一降采样：长边不超过 1024px、质量 0.7，
  // 皮肤病灶判断基本无损（细节由 ROI 放大图兜底），上传与模型视觉编码都更快
  MODEL_IMAGE_MAX_DIM: 1024,
  MODEL_IMAGE_QUALITY: 0.7,
  // 单张 base64 最大长度（约 1.2 MB），超过会提示重拍/减少图片。
  MAX_BASE64_LENGTH: 1.2 * 1024 * 1024,

  // ---------- 本地存储上限（utils/storage.js 使用）----------
  // 问诊记录 / 宠物档案条数上限，超出后淘汰最旧条目
  MAX_RECORDS: 80,
  MAX_PROFILES: 20,

  // ---------- 功能门控（默认全部关闭，开启前置条件见对应设计文档）----------
  // 流式输出：诊断结果分块渐进展示。依赖云函数 HTTP 触发改造
  // （wx.cloud.callFunction 不支持流式返回），方案见 docs/streaming-design.md
  ENABLE_STREAM_DIAGNOSE: false,
  // 多模型投票：并行调用第二模型 provider 做交叉验证，分歧时标记「需医生确认」。
  // 需先接入第二模型 provider（utils/api.js PROVIDERS 目前仅 qwen）
  ENABLE_MULTI_MODEL_VOTE: false,
  // 开发者面板：控制「我的」页里的开发者选项（反馈分析、埋点导出、本机空间切换）。
  // BUG-UI38：此前该面板对普通用户完全可见（门禁只是个假条件），发布版必须保持 false。
  SHOW_DEV_PANEL: false,

  // 正式版不要打印模型原始响应，避免泄露病例描述
  DEBUG_LOGS: false
}
