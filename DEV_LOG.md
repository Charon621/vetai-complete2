# VetAI 开发记录

> 最后更新：2026-06-12

## 项目概述

宠物皮肤病 AI 问诊微信小程序。用户上传宠物皮肤照片，AI 多模态大模型分析后返回初筛报告。

- **AppID**: `wxb4e65cab13830884`
- **基础库**: 3.16.0
- **运行方式**: 微信开发者工具编译，前端直连大模型 API（无后端服务器）

---

## 架构决策

### 前端直连大模型（2026-06-12 决定）

**弃用方案：**
- ~~微信云函数 diagnose~~（已删除）
- ~~本地 FastAPI 后端~~
- ~~Cloudflare Workers~~
- ~~trycloudflare.com 隧道~~

**当前方案：** 小程序前端通过 `wx.request` 直连官方 API。

**理由：** 简化部署，不需要服务器，本地测试方便。

**限制：**
- 真机运行需要在微信公众平台配置 request 合法域名（需已认证的小程序）
- 未认证的个人号只能在开发者工具的「真机调试」模式下绕过域名校验
- API Key 写在前端代码里，不适合公开分发，仅适合本地测试或小范围使用

---

## 当前配置

### API 配置（utils/config.js）

| 厂商 | API Key | 模型 | 端点 |
|------|---------|------|------|
| 千问 Qwen（当前） | `见 utils/config.js，本地测试用` | `qwen3.7-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |

- 当前模型：**Qwen3.7-Plus**
- 混合思考模式：关闭，优先识别速度
- 请求超时：180 秒

### 真机域名白名单

需要在微信公众平台 → 开发管理 → 服务器域名 → request 合法域名 中添加：
- `https://dashscope.aliyuncs.com`

---

## 项目结构

```
vetai-complete2/
├── app.js                    # App 入口（已移除云开发初始化）
├── app.json                  # 路由、tabBar 配置
├── app.wxss                  # 全局样式（设计系统）
├── project.config.json       # 项目配置（已移除云函数配置）
├── project.private.config.json
├── sitemap.json
├── images/                   # tabBar 图标等
├── pages/
│   ├── index/                # 首页：上传照片、填写信息、提交问诊
│   ├── profile/              # 宠物档案：创建/选择/删除
│   ├── result/               # 诊断结果（子包）：展示报告、分享/保存图片
│   ├── detail/               # 历史记录列表
│   └── user/                 # 我的：本地登录、统计
├── utils/
│   ├── config.js             # API Key、模型、端点配置
│   ├── api.js                # 核心：wx.request 直连大模型、prompt 构建、响应解析
│   ├── storage.js            # 本地存储（按用户隔离，最多 80 条记录）
│   ├── analytics.js          # 埋点与行为追踪
│   ├── knowledge.js          # 知识库：物种/品种映射等
│   ├── image.js              # 图片处理与转换
│   └── lesion.js             # 病灶区域标注与处理
└── DEV_LOG.md                # 本文件
```

---

## 核心模块说明

### utils/api.js

**主函数：** `diagnose(imageBase64List, petInfo)`

流程：
1. 校验图片（空检查）
2. 选择 Provider（优先用户选择，回退另一个有 key 的）
3. 构建 Prompt（包含宠物信息、部位、描述、圈选信息）
4. 用 `wx.request` POST 到 API（OpenAI 兼容格式）
5. 解析响应（`getMessageContent` → `parseModelJson`）
6. 标准化结果（`normalizeDiagnosis`）
7. 返回 `{ success, data, raw }` 或 `{ success: false, error }`

**图片处理（index.js）：**
- 压缩质量：25%
- 超过 1280px 的图片用 Canvas 2D 缩放后再压缩
- 最多 5 张图，提交前检查总大小

**JSON 解析容错：**
1. 直接 parse
2. 提取 `{...}` 后 parse
3. 修复尾逗号后 parse
4. 提取 `result/data` 包裹后 parse
5. 兜底：把原始文本包装成结构化结果

### utils/storage.js

- 数据按用户 ID 隔离（`guest` 或自定义 ID）
- 问诊记录上限 80 条（超出自动丢弃最旧的）
- 宠物档案无上限
- 使用 `wx.getStorageSync` / `wx.setStorageSync`

---

## 已完成的改进

### 2026-06-12 改造

- [x] 移除微信云函数，改为前端直连大模型 API
- [x] 删除 `cloudfunctions/` 目录
- [x] 删除废弃的 `utils/prompt.js`
- [x] 修复 `wx.getUserProfile` 废弃问题（改用 showModal 输入昵称）
- [x] 图片自动缩放（Canvas 2D，> 1280px 自动缩小）
- [x] 图片压缩质量从 45% 降到 25%
- [x] 增强 JSON 解析（多轮容错）
- [x] 增强响应内容提取（兼容不同厂商格式）
- [x] 修复 `project.config.json` 乱码
- [x] 添加调试日志开关（正式版默认关闭原始响应日志）
- [x] 诊断结果分享/导出（Canvas 2D 生成卡片图，保存到相册 + 微信转发）
- [x] 默认模型改为 Qwen3.7-Plus，关闭混合思考模式，prompt 缩减为最小 JSON 格式约束

### 2026-06-12 第二轮改进

- [x] 代码重构：index.js 拆分为独立模块
  - `utils/image.js` — 图片压缩、缩放、base64 转换
  - `utils/lesion.js` — 患处圈选（Canvas 2D）
  - index.js 从 600+ 行精简到 ~370 行
- [x] Canvas API 升级：患处圈选从旧版 `wx.createCanvasContext` 升级到 Canvas 2D
- [x] 宠物档案可编辑 + 头像
  - 新增「编辑」按钮，可修改已有档案
  - 新增头像上传（点击圆形区域选择图片）
  - storage.js 支持 avatar 字段
- [x] 历史记录搜索
  - 详情页新增搜索栏
  - 支持按宠物名、疾病、部位、日期等关键词搜索
  - 显示「匹配数/总数」

---

## 待做事项（按优先级）

### 高优先
- [ ] 真机域名白名单配置（需要已认证的小程序）— 已完成临时方案：真机调试模式

### 中优先
- [x] 历史记录分页加载（detail.js 已实现 `loadMore`，每页 20 条）
- [x] 修复 tabBar 图标（「我的」tab 已使用独立的 `tab-user.png`）

### 低优先
- [ ] 暗色模式
- [ ] 治疗跟进（同一问题多次拍照对比）
- [ ] 导出 PDF 报告
- [ ] 图片内容审核
- [ ] 使用统计和错误追踪

---

## 已知问题

1. **真机网络请求失败**：未配置域名白名单时，真机上 `dashscope.aliyuncs.com` 会被拦截。需要在微信公众平台配置 request 合法域名。

2. **API Key 安全**：Key 写在前端 config.js 里，代码泄露会导致 Key 被盗用。生产环境必须移到后端代理。

---

## 2026-06-18 第三轮改进

- [x] 修复图片处理并发竞态：选多张图时改为串行处理，避免共用 `#resizeCanvas` 互相覆盖
- [x] prompt 最小化后 `max_tokens` 调整为 1800，减少生成耗时
- [x] 请求超时统一为 180s（与 app.json 一致），网络/5xx 错误自动重试 1 次（1.5s 退避），4xx 不重试
- [x] 图片压缩失败时回退到 Canvas 2D 缩放，不再直接读未压缩原图撑爆请求
- [x] 诊断失败时清理本次新写入磁盘的持久化图片，避免孤儿文件堆积
- [x] 统一 modelProvider 默认值为 `glm`（api.js 兜底与 UI 一致）
- [x] DEV_LOG 同步：分页加载 / tabBar 图标 / Canvas 2D 升级均已标记完成


---

## 开发者工具设置提醒

每次打开项目时确认：
- ✅ 详情 → 本地设置 → 勾选「不校验合法域名...」
- ✅ 编译模式选「普通编译」
- 调试器 → Console 面板可以看 `[VetAI]` 开头的 API 调试日志
