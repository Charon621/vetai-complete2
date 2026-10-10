# VetAI 项目说明

宠物皮肤病 AI 初筛微信小程序。用户拍照、圈选患处、填写信息，经微信云函数代理调用 Qwen 多模态模型生成初筛报告。

通用维护与输出约定见 [AGENTS.md](AGENTS.md)，知识更新操作见 [docs/knowledge-operations.md](docs/knowledge-operations.md)。修改知识、证据或检索时须同步执行其中的维护流程。

- 仓库：本目录（GitHub 私有 Charon621/vetai-complete2），当前分支以 `git status` 为准
- 形态：原生微信小程序，无框架，后端是微信云函数
- 模型：阿里云 qwen3.8-flash（Qwen3.8-Flash）用于所有阶段；完整报告开启 medium 思考，预检与问诊关闭思考

## 目录结构

pages/ 下有 index（拍照初筛）、chat（对话问诊）、result（完整报告）、chat/report（简版报告）、detail（档案时间线）、profile（宠物档案）、user（我的）。

utils/ 是逻辑层：api.js（诊断编排）、chatDoctor.js（对话状态机）、kb.js（知识库 RAG）、image.js（图片与 ROI）、lesion.js（圈选）、storage.js（本机空间隔离）、knowledge.js（红线规则）、config.js（配置）、analytics.js（埋点）、text.js（文本处理）、greeting.js（首页问候语）、fontFace.js/fontData.js（内置衬线字体）、caseFacts.js（结构化病例事实）、evidenceScope.js（证据分段与否定识别）、knowledgeEvidence.js（证据台账读取）、knowledgeBundle.js（生成文件，勿手改）、retrievalMonitor.js（检索运行计数，不含主诉与照片）、retrievalWeights.js（检索权重与哈希）、diagnosisDecision.js（诊断终态裁决）、recordEvidence.js（最终证据字段）、evaluationTrace.js（显式注入的离线追踪，默认 no-op）。hybridRetrieval.js（BM25 + RRF 混合检索）目前只被评测脚本与测试使用，运行路径仍是规则检索。

knowledge/ 是证据台账 `evidence-ledger.json` 与当前版本指针 `current-release.json`。版本包保存在仓库外。小程序不能 require JSON，运行时读取生成文件 `utils/knowledgeBundle.js`，修改台账后需运行 `npm run knowledge:bundle`。

cloudfunctions/diagnose/ 是唯一云函数，负责三阶段代理、限流、幂等和 payload 校验。

tests/ 是无框架 Node 测试，实际执行清单见 `tools/run-tests.js`；evaluation/ 是评估体系与工具。

## 常用命令

```bash
npm test                             # tools/run-tests.js 逐项运行测试与审计再汇总，纯本地不需要 API Key
node tests/kb.test.js                 # 也可以单跑某一个
npm run audit:kb                      # KB 结构与行为探针
npm run probe:recall                  # 口语主诉召回探测
npm run audit:evidence                # 证据绑定与来源审计
npm run eval:retrieval                # 同题库检索策略对照
npm run knowledge:status              # 本地知识版本与文件漂移检查
npm run knowledge:plan -- --from <上一版本ID>   # 查看知识变更范围与受影响结论
npm run knowledge:publish -- --id <新版本ID> --reason "<说明>"   # 建立可回退的本地版本包
npm run knowledge:bundle              # 修改台账或发布后重新生成小程序台账 bundle
npm run knowledge:bundle -- --check   # 只校验 bundle 的台账内容与 JSON 是否一致
npm run knowledge:restore -- --id <版本ID>      # 回退到历史版本（先检查未发布修改）
npm run knowledge:monitor             # 证据失效、复查日期与可选本地样本检查
npm run build:icons                   # 由 @phosphor-icons/core 生成图标 SVG
```

## 代码约定

- 小程序运行代码沿用现有 ES5 风格：用 var，不用箭头函数或模板字符串。Node 工具、测试和云函数遵循各自现有风格及配置的运行环境，不将此前端约定强加到全仓库
- 使用中文注释；有实际 BUG/问题编号时可在相关修复注释中引用，无编号时写清原因，不编造编号
- 前端不得出现 API Key，utils/config.js 的 QWEN_API_KEY 保持空字符串，密钥只在云函数侧
- 小程序本地用户文件使用 wx.env.USER_DATA_PATH，不硬编码设备绝对路径；Node 工具的文件路径按 AGENTS.md 的跨平台输出约定处理
- 产品界面与面向宠物主的报告文案不得出现"知识库""RAG""提示词"这类内部机制词；项目文档、开发说明与维护报告可以使用

## 注意点

- 主包有 2048KB 限制：evaluation/、tests/、tools/、docs/、node_modules/ 必须留在 project.config.json 的 packOptions.ignore 里。新增大型目录后先查打包体积
- 云函数改完要在微信开发者工具里手动"上传并部署"，git push 不会同步
- 动手前先 git status，仓库经常有未提交的改动
- UI 以微信开发者工具的实际渲染为准，不主动扩大任务范围修改视觉；用户明确要求的视觉修改可直接执行，无需重复确认

## 输出约定

遵循 [AGENTS.md](AGENTS.md) 的输出目录优先级和文件分类，不在此重复维护平台路径。实际生成交付物时附文件或文件夹路径。
