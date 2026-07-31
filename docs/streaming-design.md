# VetAI 诊断流式输出（SSE）设计文档

> 状态：设计稿（未实施）。对应门控开关：`utils/config.js` → `ENABLE_STREAM_DIAGNOSE`（默认 `false`）。
> 本文档描述启用流式输出所需的完整改造方案；在改造完成并验证前，开关必须保持关闭，线上行为不变。

## 1. 现状与动机

### 1.1 现状

当前诊断链路为「全量等待」模式：

```
小程序 → wx.cloud.callFunction('diagnose') → 云函数 → DashScope（stream: false）
       ←────────────── 一次性返回完整 JSON ──────────────←
```

- 前端通过 `wx.cloud.callFunction` 调用云函数（`utils/api.js` 的 `doCloudRequest`），云函数再以非流式方式请求 DashScope，拿到完整响应后一次性返回。
- 完整诊断（含视觉预检 + RAG 注入 + 主诊断）端到端耗时约 **20-60 秒**，用户全程只能看加载动画。
- 前端 `API_TIMEOUT: 60000` 与云函数超时 60s 已顶到上限，长输出场景仍有超时风险。

### 1.2 动机

- **体验**：首 token 通常在 2-5 秒内产出，流式可让用户在数秒内看到"影像所见"开始逐字出现，感知等待大幅缩短。
- **超时压力**：分块返回后，连接活跃即不断流，降低整段 60s 硬超时导致的整单失败率。
- **中途放弃率**：漏斗数据（upload → submit → modelReturn）显示等待期是流失主要环节，渐进展示可直接改善。

## 2. 方案选型

### 2.1 选定方案：云函数 HTTP 触发 + `wx.request` 分块接收

```
小程序 wx.request({ enableChunked: true })
    → 云托管服务 / HTTP API 网关（HTTP 入口）
    → DashScope（stream: true, SSE）
    ← 边收边转发 SSE chunk
    ← onChunkReceived 逐块回调，前端增量渲染
```

关键点：

- `wx.cloud.callFunction` 的返回是一次性的，**不支持流式**，因此必须为诊断新增 HTTP 入口（微信云托管容器，或云函数 HTTP 触发/API 网关）。
- 小程序端 `wx.request` 自基础库 2.20.1 起支持 `enableChunked: true`，通过 `RequestTask.onChunkReceived` 逐块接收 `ArrayBuffer`。
- 服务端将 DashScope 的 SSE 流按行透传（或轻加工为自定义帧协议），响应头 `Content-Type: text/event-stream`、`Transfer-Encoding: chunked`。

### 2.2 放弃的备选方案

| 方案 | 说明 | 放弃原因 |
| --- | --- | --- |
| 轮询（poll） | 云函数把中间结果写入云数据库/缓存，前端定时 `callFunction` 拉取 | 实现最简单，但延迟粒度粗（秒级轮询）、请求量放大、云函数按次计费成本上升；"伪流式"体验提升有限 |
| WebSocket | `wx.connectSocket` 建长连接推送 | 小程序侧支持良好，但云函数不支持 WebSocket 服务端，需另建常驻服务（云托管/自建），运维成本高于 HTTP chunked；诊断是单次请求-响应模型，双向通道能力冗余 |

结论：HTTP chunked（SSE 透传）在改造成本、体验收益、运维复杂度之间平衡最好。

## 3. 改造点清单

### 3.1 云函数 / 服务端侧

1. **新增 HTTP 入口**
   - 首选微信云托管部署一个精简 Node 服务（可复用 `cloudfunctions/diagnose/index.js` 的 prompt 校验与请求组装逻辑），暴露 `POST /diagnose/stream`。
   - 备选：云函数 HTTP 触发 / API 网关。注意部分网关会缓冲响应体导致"假流式"，选型时必须实测 chunked 透传。
2. **鉴权改造（关键）**
   - HTTP 触发链路**拿不到微信注入的 `OPENID`**（`cloud.getWXContext()` 仅在 callFunction 链路有效），必须自带登录态校验：
     - 小程序端先 `wx.login()` 取 code，服务端用 `code2Session` 换取 openid + session_key，签发短期 token；
     - 流式请求携带该 token（Header），服务端校验通过才转发模型请求；
     - 沿用现有请求体大小校验（事件体 3.2MB / 文本 30KB / 单图 1.3MB），防止未鉴权滥用打爆模型配额。
3. **DashScope 流式转发**
   - 请求 DashScope 时改 `stream: true`，逐行读取上游 SSE；
   - 按 `data: {...}\n\n` 帧透传给小程序，末帧发送 `data: [DONE]`；
   - 上游异常时发送自定义错误帧（如 `event: error`），让前端能区分"断流"与"模型报错"。

### 3.2 前端侧（小程序）

1. **`utils/api.js` 增加流式请求分支**
   - 在 `diagnose` 主流程中按 `config.ENABLE_STREAM_DIAGNOSE` 分叉：开关关闭走现有 `doCloudRequest`，开启走新的 `doStreamRequest`（`wx.request` + `enableChunked: true`）。
   - 视觉预检（precheck）耗时短、结果不直接展示，**保持非流式**，仅主诊断走流式。
2. **chunk 解析**
   - `onChunkReceived` 收到的是 `ArrayBuffer`，需解码为 UTF-8 文本后按 SSE 帧切分；
   - 注意 chunk 边界不与 SSE 帧边界对齐：必须维护跨 chunk 的行缓冲区，同时处理多字节中文字符被 chunk 截断的场景（用 TextDecoder 的流式模式或自行缓冲未完整字节）。
3. **UI 增量渲染**
   - 诊断结果是结构化 JSON，无法在完整闭合前直接 `JSON.parse`。策略：
     - 阶段一（低成本）：只做"打字机"式原文预览 + 完成后整体解析渲染（复用现有 `parseModelJson` 四层容错）；
     - 阶段二：按 schema 字段出现顺序做前缀式流式解析（如先渲染 `observations`，再渐进补全候选列表）。
   - 流式过程中禁用提交按钮与重复触发（沿用现有 `_diagnosing` 锁）。
4. **config 开关**
   - `ENABLE_STREAM_DIAGNOSE: false` 已就位；开启前置条件：云托管入口 + 鉴权上线并通过验收。

## 4. 前置条件与风险

| 风险/前置项 | 说明 | 缓解措施 |
| --- | --- | --- |
| 云托管成本 | 常驻容器按量计费，高于纯云函数按次计费 | 最小规格 + 缩容到 0 策略；先灰度小流量验证收益再放量 |
| 鉴权安全 | HTTP 入口暴露公网，无 OPENID 天然身份 | code2Session 换 token、短有效期、限频；请求体大小校验前移；密钥仅存服务端环境变量 |
| 超时与断流重连 | 弱网下 chunked 连接易中断，半截结果不可用 | 前端断流后自动降级为一次非流式重试（走原 callFunction 链路兜底）；服务端设置心跳注释帧防中间层空闲断连 |
| JSON 流式解析容错 | 半截 JSON 不可 parse，模型偶发输出 markdown 包裹 | 阶段一只做原文预览、完成后统一走 `parseModelJson` 容错链；解析失败时保留已收原文供重试 |
| 网关缓冲 | 部分 HTTP 网关整包缓冲，流式失效 | 选型阶段实测 TTFB 与分块到达间隔，不达标则换云托管直连 |
| 基础库兼容 | `enableChunked` 需基础库 ≥ 2.20.1 | 运行时能力检测，不支持则自动走非流式链路 |

## 5. 分阶段上线建议

1. **阶段 0（当前）**：开关落位（`ENABLE_STREAM_DIAGNOSE: false`），设计文档评审，零行为变化。
2. **阶段 1**：云托管 HTTP 入口 + 鉴权链路搭建，先以**非流式**模式跑通 HTTP 链路（与 callFunction 结果做一致性对比）。
3. **阶段 2**：服务端 `stream: true` 透传 + 前端 chunk 解析，UI 仅做"打字机"原文预览，完成后整体解析；内部体验版验证断流重连与解析容错。
4. **阶段 3**：灰度开启（按用户尾号/白名单），监控埋点新增 `stream_first_chunk_ms`、`stream_abort` 等指标，对比放弃率与失败率。
5. **阶段 4**：全量开启，callFunction 链路保留为降级兜底；视数据决定是否推进结构化流式渲染（阶段二解析）。
