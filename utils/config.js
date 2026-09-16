// ============================================================
// VetAI 前端直连大模型 API 配置
// ⚠️  API Key 仅用于本地开发测试，请勿提交到公开仓库！
// ============================================================

module.exports = {
  // ---------- 千问 DashScope（多模态视觉模型）----------
  // 正式使用时不要在小程序前端保存 API Key。默认走微信云函数代理。
  USE_CLOUD_FUNCTION: true,
  DIAGNOSE_CLOUD_FUNCTION: 'diagnose',
  CLOUD_ENV: 'cloud1-d0gc4m26t135ca759',
  QWEN_API_KEY: '',
  QWEN_API_BASE: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  // DashScope 多模态视觉模型名：尽量贴近官网直出，关闭混合思考模式
  QWEN_MODEL: 'qwen3.7-plus',
  QWEN_LABEL: 'Qwen3.7-Plus',
  // 关闭思考模式，响应更快
  QWEN_ENABLE_THINKING: false,

  // ---------- 视觉特征驱动 RAG ----------
  // 总开关：开启时接入本地皮肤病知识库；关闭时只走模型诊断，不注入知识库、不走知识库快路径
  USE_KNOWLEDGE_BASE: true,
  // 快路径（BUG-G8：2026-07-31 起启用）。视觉预检强命中知识库时
  // 立即出报告（约 3-5s），不再等 plus 完整诊断；门槛严格：
  // score≥8 + 症状匹配≥2 + top2 间隔≥3 + 组合规则/别名/3 个非泛词视觉特征。
  // 未达强命中标准时仍走完整诊断，行为与之前一致。
  VISION_RAG_FAST_PATH: true,
  VISION_RAG_TRACE: true,
  VISION_RAG_MAX_IMAGES: 2,
  VISION_RAG_MIN_SCORE: 8,
  VISION_RAG_MIN_SYMPTOM_MATCHES: 2,
  // 预检模型：轻量快速，用于视觉特征提取；完整诊断仍用 QWEN_MODEL
  QWEN_PRECHECK_MODEL: 'qwen3.6-flash',

  // ---------- 请求超时（毫秒，与 app.json networkTimeout 保持一致）----------
  API_TIMEOUT: 60000,
  PRECHECK_TIMEOUT: 18000,
  // 输出限长提速：延迟≈输出 token 数÷出字速度，schema 已同步限字，900 足够容纳完整报告
  MODEL_MAX_TOKENS: 900,

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

  // 正式版不要打印模型原始响应，避免泄露病例描述
  DEBUG_LOGS: false
}
