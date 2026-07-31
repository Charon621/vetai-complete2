# 犬口腔影像多模态模型比较研究：实验与统计方案

## 1. 建议研究问题

比较 Kimi K2.6、豆包大模型 2.1 Pro、Qwen3.7-Plus 与 GPT-5.6 在犬口腔照片中识别预定义临床体征的：

1. 诊断判别性能；
2. 与兽医专家参考标准的一致性；
3. 同一病例重复运行的稳定性；
4. 不同体征、图像质量和病例难度下的性能差异；
5. 响应时间、token消耗和单位病例成本。

本研究评价的是“基于图像的临床体征识别”，不应表述为完整疾病诊断能力。

## 2. 样本与参考标准

### 2.1 数据集

- 最理想：额外准备20–30张开发图像，用于调试提示词；正式测试集保留完整200张。
- 如果总共只有200张：20张作为开发集，180张作为锁定测试集。
- 同一犬只的多张照片必须共享同一个 `dog_id`，不能当作独立病例；统计时按犬只聚类。
- 图像应覆盖不同品种、年龄、色素、牙位、光照、清晰度和病变严重度。
- 每项主要体征应尽量有至少40–50个阳性和40–50个阴性病例。稀有体征可富集抽样，但必须报告真实抽样方法，不能把富集后的预测值直接解释为临床患病率下的预测值。

### 2.2 参考标准

- 至少3名有犬牙科/口腔外科经验的兽医独立判读。
- 先保存每位专家的独立结果，再召开共识会议形成最终参考标签。
- 若条件允许，参考标准应综合完整口腔检查、牙周探诊、牙科X线、手术发现或病理结果，而不只是同一张照片。
- 共识前报告专家间 Fleiss' kappa 或 Gwet's AC1，避免把“专家共识”误当作无误差真值。

### 2.3 人类对照组

如果文章标题或结论要写“与兽医比较”，建议至少纳入3–5名初级兽医；条件允许时再加入3–5名普通临床兽医。每位兽医必须独立评价全部锁定病例，不能把多名兽医的结果在方法不明的情况下合并成一个“Novice”标签。统计模型中增加 `rater_id`，并分别报告个体结果、组内一致性和组水平估计。

## 3. 图像预处理

1. 保存不可修改的原始图像和一份推理副本。
2. 去除EXIF、姓名、医院、日期、水印和可能泄露诊断的标记。
3. 不改变病变区域，不使用AI增强、锐化、局部重绘或自动裁病灶。
4. 所有模型接收完全相同的像素文件；建议统一sRGB，JPEG质量90–95或无损PNG。
5. 细小牙科特征需要高分辨率。可先将长边统一到约2048 px，并在20–30张开发图像上验证是否损失骨折线、牙结石边界和溃疡细节。
6. 为每张图计算SHA-256，保证四个平台使用的是同一文件。

## 4. 最高效的投喂方法

### 4.1 核心原则

- **一张病例图对应一个独立API请求。** 不要把200张图塞进同一会话，也不要在同一聊天中连续上传病例。
- 每次请求均无历史消息、无先前输出、无参考答案。
- 每个模型使用同一提示词、同一枚举标签和同一JSON字段。
- 禁用联网搜索、代码解释器、工具调用、记忆和知识库。
- 能使用结构化输出/JSON Schema时必须开启；否则严格解析JSON并记录解析失败。
- 主研究每个模型只使用一种预先锁定的推理模式。不要在结果出来后切换“思考/非思考”版本。

### 4.2 批处理规模

正式测试集200张、4个模型：

- 主分析：`200 × 4 = 800` 次请求。
- 稳定性子集：建议分层抽取40张，主调用视为第1次，再额外运行2次：`40 × 2 × 4 = 320` 次。
- 合计：约1120次请求。

每个平台建立一个JSONL批任务，每行一个病例请求。OpenAI Batch适合离线评测，官方说明其成本较同步接口低50%，通常在24小时内完成；Qwen官方批量推理同样面向大规模评测并提供成本优惠。豆包方舟文档也提供批量Chat/批量推理入口。Kimi若当时没有可用批接口，则采用限速的异步并发请求。

### 4.3 时间与顺序控制

- 固定模型的实际API `model` 字符串或日期快照，而不是只记录产品宣传名。
- Qwen可优先使用日期版本，如 `qwen3.7-plus-2026-05-26`，不要使用会自动漂移的 `latest`。
- GPT研究中优先记录实际模型层级和快照；不要只写含义可能变化的聊天产品名称。
- Kimi、豆包必须从控制台导出实验当天的实际模型ID/Endpoint ID。
- 若供应商不提供快照，应在尽可能短的时间窗口内完成四组评测，并记录UTC时间。
- 病例顺序由预设随机种子生成；每个请求独立时，顺序主要用于审计。

## 5. 主提示词

建议主研究使用英文提示词，以便国际投稿和跨平台复现。若要研究语言效应，可在40张分层子集中另做中英文提示词敏感性分析，但不要根据结果选择“表现更好”的语言作为主结果。

### 5.1 System prompt

```text
You are evaluating a canine oral photograph for a blinded veterinary image-assessment study.

Your task is limited to identifying predefined, visually observable clinical signs. Do not infer history, laboratory findings, radiographic findings, final disease diagnoses, treatment, prognosis, breed, age, or owner information.

Use only the supplied image. Do not use external tools, web search, prior conversation, or unstated assumptions.

For every clinical sign, return exactly one status:
- present: the sign is clearly visible;
- absent: the sign is not visible in the assessable region;
- indeterminate: image quality, angle, obstruction, or ambiguity prevents a reliable present/absent judgment.

Return only valid JSON matching the required schema. Do not add markdown, explanation, differential diagnoses, or recommendations.
```

### 5.2 User prompt

```text
<case_id>{{CASE_ID}}</case_id>

Assess the supplied lateral canine oral photograph for all nine clinical signs:

1. gingivitis: visible gingival erythema, edema, swelling, or loss of a sharp gingival margin;
2. dental_calculus: visible yellow, brown, or mineralized deposit adherent to a tooth surface;
3. fractured_tooth: visible loss, crack, fissure, or structural disruption of the tooth crown;
4. missing_tooth: an expected tooth position appears empty and can be judged from the visible field;
5. malocclusion: visibly abnormal tooth alignment or relationship that can be assessed from this view;
6. oral_ulcer: focal visible loss or erosion of oral mucosal epithelium;
7. oral_mucosal_pigmentation: visible melanin pigmentation or localized mucosal color change; record the finding without assuming pathology;
8. oral_mass_or_nodule: visible focal raised, nodular, or mass-like oral lesion;
9. traumatic_oral_lesion: visible acute laceration, tissue disruption, contusion, or bleeding compatible with trauma.

Judge each sign independently. Normal pigmentation must not be called an ulcer, mass, or traumatic lesion solely because it is dark. Dental calculus must not be inferred from tooth discoloration alone. If the relevant anatomy is not visible, use indeterminate rather than absent.

Return the required JSON only.
```

### 5.3 建议JSON Schema

```json
{
  "case_id": "C0001",
  "overall_image_quality": "adequate",
  "findings": {
    "gingivitis": {"status": "present", "confidence": 82},
    "dental_calculus": {"status": "absent", "confidence": 76},
    "fractured_tooth": {"status": "indeterminate", "confidence": 41},
    "missing_tooth": {"status": "absent", "confidence": 70},
    "malocclusion": {"status": "indeterminate", "confidence": 45},
    "oral_ulcer": {"status": "absent", "confidence": 73},
    "oral_mucosal_pigmentation": {"status": "present", "confidence": 91},
    "oral_mass_or_nodule": {"status": "absent", "confidence": 75},
    "traumatic_oral_lesion": {"status": "absent", "confidence": 79}
  }
}
```

约束：

- `overall_image_quality`: `adequate | limited | non_diagnostic`
- `status`: `present | absent | indeterminate`
- `confidence`: 0–100整数，代表模型对所选状态的信心，不是疾病概率。
- 不要求自由文本理由，可显著降低输出token、解析错误和事后主观编码。

## 6. 运行参数与日志

所有平台记录：

- provider、API基地址、实际model/endpoint ID、模型日期快照；
- 请求UTC时间、prompt版本与SHA-256；
- image SHA-256、宽高、格式、字节数；
- temperature、top_p、seed、reasoning/thinking模式、图像detail设置；
- 原始请求JSON、原始响应JSON、解析后的标签；
-输入/输出/推理token、延迟、成本、finish reason；
- 错误码、内容过滤、重试次数。

重试规则应预先固定：仅对网络、限流和服务端错误自动重试；同一个 `case_id` 最多3次，指数退避。内容过滤、无效JSON和模型拒答作为失败结果保存，不能人工补答案。

GPT-5.6图像输入建议先在开发集比较 `high` 与 `original`；官方说明GPT-5.6在 `original/auto` 下保留原图尺寸，超大图会显著增加token，因此正式实验应固定图像尺寸和detail。其他平台使用最接近的高保真设置，并如实承认各供应商内部视觉预处理不可完全等同。

## 7. 统计分析计划

### 7.1 主要终点

以每个“病例×临床体征×模型”是否与专家参考标签一致作为二元主要终点。

主要模型采用混合效应logistic回归：

```text
correct ~ model * clinical_sign + image_quality + (1 | dog_id)
```

如果一只犬只有一张照片，`dog_id`即病例随机截距；若一只犬有多张照片，可增加photo层级。模型间两两比较采用估计边际均值，并用Holm方法校正6组模型对比。

### 7.2 每个体征的性能

对每个模型、每项体征报告：

- 三分类混淆矩阵；
- macro-F1和三分类准确率；
- Cohen's kappa或加权kappa及95%聚类bootstrap置信区间；
- 将`indeterminate`视为弃权时的弃权率、覆盖率和选择性准确率；
- 在预注册的二分类分析中报告灵敏度、特异度、PPV、NPV、balanced accuracy；
- 不以“kappa是否显著”作为模型优劣的主要依据。

### 7.3 模型间配对比较

- 单个体征可对“正确/错误”使用Cochran's Q总体检验，再进行Holm校正的配对McNemar检验。
- 全部体征的主比较仍以混合效应模型为准，因为同一病例的9个体征彼此相关。
- 对效应量报告模型间正确率差、比值比及95%CI，而不只报告p值。

### 7.4 稳定性与校准

- 在40张分层样本上，每个模型独立运行3次。
- 报告三次完全一致率、Fleiss' kappa/Gwet's AC1及95%CI；不要把三个两两Cohen kappa简单取平均作为唯一指标。
- 若保留0–100信心值，报告Brier score、校准曲线和预先定义分箱的ECE；不同模型的自报信心只适合做探索性比较。

### 7.5 样本量

不要使用“四个独立组的一元ANOVA”做功效分析。200个配对病例通常足以检测中等规模的模型差异，但最终功效取决于：每项体征阳性率、模型间不一致比例、同犬多图相关性和预期正确率差。

推荐流程：先用不进入正式分析的20–30张开发图像估计类别率和模型间discordance，再通过模拟混合效应logistic模型确定正式样本量。样本量应由最稀有的主要体征驱动。

## 8. 盲法、预注册与论文透明度

- 专家不知道模型输出，模型不能接触专家标签。
- 在正式运行前锁定：数据集、排除规则、提示词、JSON Schema、模型ID、运行参数、重试规则和统计脚本。
- 将研究方案预注册在OSF等平台；结果出来后不得修改主要终点。
- 附录公开去标识化提示词、代码、病例级标签、原始模型输出和运行日志；若图像受隐私或版权限制，至少公开哈希、标签和可审计元数据。
- 伦理审批需覆盖临床影像二次使用、数据传输至第三方模型服务以及跨境数据处理。

## 9. 建议文章的创新点

相比已阅读论文，本研究可通过以下升级形成更强的文章：

1. 使用约200个病例并保证每项体征的有效阳性样本；
2. 使用真实临床/影像学复合参考标准，而非仅靠照片专家共识；
3. 采用四个2026年原生多模态模型并锁定实际API版本；
4. 用结构化输出彻底消除人工解释模型回答的偏差；
5. 同时比较准确性、弃权、稳定性、校准、延迟和成本；
6. 使用病例聚类的混合效应模型，而非把540/1800个标签当作独立观察；
7. 预注册并公开病例级原始输出，提升可复现性。

## 10. 当前模型能力核对来源

- [Kimi K2.6官方页面：原生多模态](https://www.moonshot.ai/en)
- [Kimi提示词最佳实践](https://platform.moonshot.ai/docs/guide/prompt-best-practice)
- [豆包大模型2.1 Pro官方产品页](https://www.volcengine.com/)
- [火山方舟文档入口：图片理解与批量推理](https://www.volcengine.com/docs/82379/66619f8df281250274ef4f88?lang=zh)
- [Qwen3.7-Plus官方模型页：原生多模态](https://modelstudio.alibabacloud.com/)
- [Qwen Responses API与日期版本](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses)
- [Qwen批量推理](https://www.alibabacloud.com/help/en/model-studio/batch-inference/)
- [OpenAI GPT-5.6 Sol模型页](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [OpenAI图像与视觉输入指南](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
