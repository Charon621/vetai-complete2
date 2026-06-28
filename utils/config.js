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
  QWEN_ENABLE_THINKING: false,

  // ---------- 视觉特征驱动 RAG ----------
  // 先让视觉模型提取简短特征，再检索本地知识库。强命中时直接生成知识库版报告；
  // 未命中或弱命中时，自动回退到完整 AI 诊断。
  VISION_RAG_FAST_PATH: true,
  VISION_RAG_TRACE: true,
  VISION_RAG_MAX_IMAGES: 2,
  VISION_RAG_MIN_SCORE: 8,
  VISION_RAG_MIN_SYMPTOM_MATCHES: 2,

  // ---------- 请求超时（毫秒，与 app.json networkTimeout 保持一致）----------
  API_TIMEOUT: 180000,

  // ---------- 图片限制 ----------
  MAX_IMAGES: 5,
  // 发送给模型的总图片上限。保留最多 5 张原图，病灶 ROI 最多补 1 张。
  MAX_MODEL_IMAGES: 6,
  MAX_ROI_IMAGES: 1,
  // 单张 base64 最大长度（约 4 MB），超过会提示压缩
  MAX_BASE64_LENGTH: 4 * 1024 * 1024,

  // 正式版不要打印模型原始响应，避免泄露病例描述
  DEBUG_LOGS: false
}
