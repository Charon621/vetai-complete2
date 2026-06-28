# VetAI 开发记录

> 最后更新：2026-06-28

## 项目概述

宠物皮肤病 AI 初筛微信小程序。用户上传宠物皮肤照片、填写基础信息并可圈选患处，系统调用多模态模型生成初筛报告。

- **AppID**: `wxb4e65cab13830884`
- **云开发环境**: `cloud1-d0gc4m26t135ca759`
- **基础库**: 3.16.0
- **当前分支**: `main`
- **GitHub**: `https://github.com/Charon621/vetai-complete2`

---

## 当前架构

### 微信云函数代理大模型

**当前方案：**

小程序前端通过 `wx.cloud.callFunction` 调用云函数 `diagnose`，云函数从环境变量读取 `QWEN_API_KEY`，再请求 DashScope / Qwen 兼容接口。

```
小程序前端
  -> wx.cloud.callFunction('diagnose')
  -> cloudfunctions/diagnose
  -> DashScope Qwen API
```

**理由：**
- API Key 不再打包进小程序前端。
- 不需要自建服务器、域名或 HTTPS 证书。
- 体验版和正式版用户调用同一套云端环境变量。

**注意：**
- 云函数配置里必须存在环境变量 `QWEN_API_KEY`。
- 云函数超时时间建议设置为 `180` 秒。
- 修改 `cloudfunctions/diagnose` 后，需要在微信开发者工具里右键云函数目录并选择“上传并部署：云端安装依赖”。

---

## 当前配置

### 前端配置（utils/config.js）

| 配置 | 当前值 | 说明 |
|------|--------|------|
| `USE_CLOUD_FUNCTION` | `true` | 默认走微信云函数代理 |
| `DIAGNOSE_CLOUD_FUNCTION` | `diagnose` | 云函数名称 |
| `CLOUD_ENV` | `cloud1-d0gc4m26t135ca759` | 云开发环境 |
| `QWEN_API_KEY` | 空字符串 | 前端不保存密钥 |
| `QWEN_MODEL` | `qwen3.7-plus` | 当前模型 |
| `QWEN_ENABLE_THINKING` | `false` | 关闭混合思考 |

### 云函数环境变量

| Key | Value |
|-----|-------|
| `QWEN_API_KEY` | DashScope API Key |
| `QWEN_API_BASE` | 可选，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |

---

## 项目结构

```
vetai-complete2/
├── app.js                    # App 入口，初始化微信云开发
├── app.json                  # 路由、tabBar 配置
├── app.wxss                  # 全局样式
├── project.config.json       # 小程序项目配置，含 cloudfunctionRoot
├── sitemap.json
├── cloudfunctions/
│   └── diagnose/             # 云函数：服务端代理 DashScope / Qwen 请求
├── images/                   # tabBar 图标等
├── pages/
│   ├── index/                # 首页：上传照片、填写信息、提交初筛
│   ├── profile/              # 宠物档案
│   ├── result/               # 结果报告
│   ├── detail/               # 历史记录
│   └── user/                 # 我的
├── utils/
│   ├── config.js             # 前端配置，无明文 API Key
│   ├── api.js                # prompt、RAG、云函数调用、响应解析
│   ├── kb.js                 # 本地宠物皮肤病 RAG 知识库
│   ├── knowledge.js          # 红线症状、常见病优先规则
│   ├── storage.js            # 本地存储
│   ├── analytics.js          # 本地埋点
│   ├── image.js              # 图片处理与 ROI 裁剪
│   └── lesion.js             # 患处圈选
└── DEV_LOG.md
```

`项目总论/` 为暂存参考资料，当前不参与小程序运行，也不纳入 Git 版本管理。

---

## 核心流程

### utils/api.js

主函数：`diagnose(imageBase64List, petInfo)`

流程：
1. 清洗并限制图片数量。
2. 标准化宠物信息。
3. 若启用视觉 RAG 快路径：
   - 调云函数做视觉特征提取。
   - 用 `utils/kb.js` 本地知识库检索。
   - 强命中则生成知识库版快速报告。
   - 弱命中则回退完整模型诊断。
4. 完整诊断时构建系统 prompt、病例 prompt 和图片消息。
5. 通过云函数 `diagnose` 请求 Qwen。
6. 解析 JSON，标准化报告字段。
7. 应用红线症状和紧急度护栏。

### cloudfunctions/diagnose

职责：
- 从 `process.env.QWEN_API_KEY` 读取 API Key。
- 请求 DashScope OpenAI-compatible endpoint。
- 统一返回 `{ success, data }` 或 `{ success: false, error }`。

---

## 已完成事项

### 2026-06-28

- [x] 恢复并接入微信云开发云函数 `diagnose`
- [x] 前端默认从直连 API 改为 `wx.cloud.callFunction`
- [x] 移除前端明文 DashScope API Key
- [x] `app.js` 初始化云开发环境
- [x] `project.config.json` 增加 `cloudfunctionRoot`
- [x] 云函数改为读取环境变量 `QWEN_API_KEY`
- [x] 修复云函数返回格式兼容问题
- [x] 初始化 Git 仓库并提交初始版本
- [x] 推送到 GitHub 私有仓库 `Charon621/vetai-complete2`

### 既有功能

- [x] 图片上传、压缩和多图角色标记
- [x] 患处自由圈选 / 矩形圈选
- [x] ROI 裁剪增强
- [x] 本地 RAG 知识库和视觉预检快路径
- [x] 红线症状与紧急度护栏
- [x] 宠物档案管理
- [x] 历史记录、搜索、分页
- [x] 诊断结果分享 / 保存图片

---

## Git 使用约定

当前远程仓库：

```
origin -> https://github.com/Charon621/vetai-complete2.git
```

常用同步命令：

```
git status
git add .
git commit -m "描述这次修改"
git push
```

另一台电脑下载：

```
git clone https://github.com/Charon621/vetai-complete2.git
```

---

## 注意事项

1. **不要把 API Key 写回 `utils/config.js`。**
2. 修改云函数代码后，GitHub 推送不会自动更新微信云端函数，需要在微信开发者工具手动部署云函数。
3. 修改前端页面或配置后，若要让体验版用户使用，需要重新上传体验版。
4. 当前 `wx.cloud.callFunction` 传 base64 图片有体积限制；多图或大图后续建议改为“先传云存储，再让云函数处理”。
