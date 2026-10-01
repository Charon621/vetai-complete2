# VetAI 项目说明

宠物皮肤病 AI 初筛微信小程序。用户拍照、圈选患处、填写信息，经微信云函数代理调用 Qwen 多模态模型生成初筛报告。

- 仓库：本目录（GitHub 私有 Charon621/vetai-complete2），当前分支 release/v3.0
- 形态：原生微信小程序，无框架，后端是微信云函数
- 模型：阿里云 qwen3.8-flash（Qwen3.8-Flash）用于所有阶段；完整报告开启 medium 思考，预检与问诊关闭思考

## 目录结构

pages/ 下有 index（拍照初筛）、chat（对话问诊）、result（完整报告）、chat/report（简版报告）、detail（档案时间线）、profile（宠物档案）、user（我的）。

utils/ 是逻辑层：api.js（诊断编排）、chatDoctor.js（对话状态机）、kb.js（知识库 RAG）、image.js（图片与 ROI）、lesion.js（圈选）、storage.js（本机空间隔离）、knowledge.js（红线规则）、config.js（配置）、analytics.js（埋点）、text.js（文本处理）。

cloudfunctions/diagnose/ 是唯一云函数，负责三阶段代理、限流、幂等和 payload 校验。

tests/ 是 11 个无框架 node 测试，evaluation/ 是评估体系与工具。

## 常用命令

```bash
npm test                              # 全部：11 个测试脚本 + KB 审计 + 召回探测，纯本地不需要 API Key
node tests/kb.test.js                 # 也可以单跑某一个
npm run audit:kb                      # KB 结构与行为探针
npm run probe:recall                  # 口语主诉召回探测
```

## 代码约定

- ES5 风格：用 var，不用箭头函数，不用模板字符串，跟全仓库保持一致
- 中文注释；修复在注释里用 BUG-编号 标注
- 前端不得出现 API Key，utils/config.js 的 QWEN_API_KEY 保持空字符串，密钥只在云函数侧
- 路径引用走 wx.env.USER_DATA_PATH，不硬编码绝对路径
- 用户可见文案不得出现"知识库""RAG""提示词"这类内部机制词

## 注意点

- 主包有 2048KB 限制：evaluation/、tests/、tools/、docs/、node_modules/ 必须留在 project.config.json 的 packOptions.ignore 里。新增大型目录后先查打包体积
- 云函数改完要在微信开发者工具里手动"上传并部署"，git push 不会同步
- 动手前先 git status，仓库经常有未提交的改动
- UI 已定稿，以微信开发者工具的实际渲染为准。视觉部分不要再改动，需要删改先问用户

## 输出约定

交付文件（docx、pdf、图片、预览 HTML 等）统一放 `E:\.hermes\` 下的中文分类目录，不放仓库里，回复末尾附上文件夹路径。输出位置以本文件为准。
