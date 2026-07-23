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
  // 开启两步视觉 RAG 快路径：强命中时直接输出知识库版报告，跳过完整模型调用
  VISION_RAG_FAST_PATH: true,
  VISION_RAG_TRACE: false,
  VISION_RAG_MAX_IMAGES: 2,
  VISION_RAG_MIN_SCORE: 8,
  VISION_RAG_MIN_SYMPTOM_MATCHES: 2,
  // 预检模型：轻量快速，用于视觉特征提取；完整诊断仍用 QWEN_MODEL
  QWEN_PRECHECK_MODEL: 'qwen3.6-flash',

  // ---------- 请求超时（毫秒，与 app.json networkTimeout 保持一致）----------
  API_TIMEOUT: 60000,
  PRECHECK_TIMEOUT: 18000,
  MODEL_MAX_TOKENS: 1600,

  // ---------- 图片限制 ----------
  MAX_IMAGES: 5,
  // 发送给模型的总图片上限。最多 1 张原图 + 1 张病灶 ROI，或 2 张原图。
  MAX_MODEL_IMAGES: 2,
  MAX_ROI_IMAGES: 1,
  // 单张 base64 最大长度（约 1.2 MB），超过会提示重拍/减少图片。
  MAX_BASE64_LENGTH: 1.2 * 1024 * 1024,

  // 正式版不要打印模型原始响应，避免泄露病例描述
  DEBUG_LOGS: false
}
