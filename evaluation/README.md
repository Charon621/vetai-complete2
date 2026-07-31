# VetAI 皮肤科提示词评估资料

本目录把“提示词开发素材”和“最终参考标准”严格分开。它用于评估图片质量判断、皮损描述、鉴别诊断、分诊、安全建议与恰当拒答；它不用于宣称 VetAI 能替代兽医诊断，也不构成临床有效性认证。

## 一条不可跨越的边界

- `pilot_public_images/` 中的 8 张图来自公开数据集，只能做界面、解析、提示词和鲁棒性开发。
- 公开网页图片、论文插图、来源数据集的宽泛类别，以及模型自己生成的标签，都不能进入最终金标准。
- `gold_standard/` 描述的是尚需真实病例、病例级诊断证据和盲法专家标注才能建立的冻结测试集。未完成该流程前，不得发布“准确率提高”之类的产品结论。

### 2026-07-26 补充：新增 V1 层级（`dataset_reference_set/`）

按负责人明确指示，新增一个用公开数据集兽医标签建立的**可运行**参考集，
共 62 例，见 [`dataset_reference_set/README.md`](dataset_reference_set/README.md)。

上面三条边界**全部继续有效，未被修改**：

- V1 **不是**冻结核心集，不参与 `top3_etiology_recall` 等核心病因指标，不能发布准确率；
- `model_generated_labels_allowed` 仍为 `false`——V1 的标签来自执业兽医，不是模型生成的；
- `gold_standard/` 的双专家盲标流程仍是唯一能支撑对外结论的路径，仍未开始。

**取回图片后发现的关键事实**：这批图是接触式皮肤镜特写，无部位、无分布、无动物本体，
与产品真实输入（手机照片）分布不符。因此它的主指标是**弃答恰当性**与**是否编造部位**，
而不是四类准确率——后者只作探索性数字。详见该目录 README。

## 目录

| 路径 | 用途 |
|---|---|
| `gold_standard/annotation_guide.md` | G1/G2/G3 复合参考标准、盲法标注、裁决、泄漏控制和评分规则 |
| `gold_standard/case_manifest.template.csv` | 每个真实病例必须填写的追溯清单模板 |
| `gold_standard/benchmark_config.json` | 40 例冻结基准的机器可读预注册配置 |
| `gold_standard/label_ontology.json` | 受控标签本体：疾病大类 → 具体疾病 → 亚型，同义词映射到固定 code |
| `gold_standard/expert_annotation_form.template.csv` | 单名专家的盲标表（长格式，每人一行），空表待填 |
| `gold_standard/adjudication_form.template.csv` | 第三方裁决表，空表待填 |
| `pilot_public_images/manifest.csv` | 8 张公开开发图的来源、许可、修改和双重 SHA-256 |
| `pilot_public_images/*_dev.jpg` | 重新解码、缩放并去元数据的 1280×720 开发衍生图 |
| `pilot_public_images/contact_sheet_dev_only.jpg` | 仅供人工快速检查的联系表，不作为模型输入基准 |
| `tools/prepare_pilot_images.py` | 从 `tmp/pilot_raw/` 可重复生成衍生图和联系表 |
| `tools/validate_annotations.py` | 校验标注表是否遵守本指南（受控标签、层级证据、双专家独立、泄漏控制） |
| `tools/agreement_stats.py` | 一致性与区间统计：Cohen's κ、Gwet's AC1、加权 κ、Fleiss' κ、Wilson CI、按动物聚类 bootstrap、McNemar |
| `tools/repeatability.py` | 重测信度：完全一致率与两两 κ 均值（对应 Kocaman et al. 2026 的模型内稳定性测试） |
| `tools/run_dev_set.js` | 对 8 张 DEV_ONLY 图做结构与鲁棒性审计，输出带 prompt SHA-256 的审计日志 |
| `tools/score_v1_reference.py` | V1 评分：弃答恰当性与编造部位探针（主指标）+ 四类粗粒度探索性指标 |
| `dataset_reference_set/` | V1 参考集：62 例，兽医宽泛标签，CC BY 4.0，含映射表与取图脚本 |
| `runs/` | 审计与评估运行记录（每次运行一个文件，不覆盖旧运行） |

### 工具链使用顺序

```bash
# 1. 结构审计（无需 API Key，随时可跑）
node evaluation/tools/run_dev_set.js --out evaluation/runs/dev_audit_$(date +%Y%m%d).json

# 2. 拿到专家标注后，先校验协议再算统计——顺序不能颠倒
python evaluation/tools/validate_annotations.py \
  --expert path/to/expert_annotations.csv \
  --manifest path/to/case_manifest.csv \
  --adjudication path/to/adjudication.csv

# 3. 裁决前一致性（长格式标注表）
python evaluation/tools/agreement_stats.py path/to/expert_annotations.csv --long-form

# 4. 模型重测信度（同输入至少三轮）
python evaluation/tools/repeatability.py run1.jsonl run2.jsonl run3.jsonl \
  --field parsed.urgency --ordered

# 5. V1 参考集评分（今天就能跑；主指标是弃答恰当性，不是准确率）
python evaluation/dataset_reference_set/fetch_images.py --check
python evaluation/tools/score_v1_reference.py v1_predictions.jsonl \
  --json-out evaluation/runs/v1_score_YYYYMMDD.json
```

每个工具都带 `--self-test`，改动后先跑自检。`validate_annotations.py` 报出阻断性错误时不得继续计算任何指标。

## 当前状态

| 环节 | 状态 |
|---|---|
| 协议与预注册配置 | 已完成 |
| 受控标签本体 | 已完成（`label_ontology.json`，31 个病因 code + 2 个非病因 code） |
| 标注表与裁决表 | 空表已就绪，等待真实病例与专家 |
| 统计与校验工具链 | 已完成并通过自检 |
| 开发集结构审计 | 已完成（84 项检查全通过，见 `runs/dev_audit_v2.0.0.json`） |
| V1 数据集参考集 | 已完成，62 例就位，可立即运行弃答与编造部位探针 |
| **G1/G2 专家标注冻结核心集** | **未开始——这仍是对外结论的唯一阻塞项** |

V1 让「今天就能跑出数字」成为可能，但它测的是**行为安全性**（该弃答时是否弃答、
是否描述看不见的部位），不是诊断准确率。在两名兽医皮肤科专家按 `annotation_guide.md`
完成盲标与裁决之前，仍不能产出任何可对外发布的诊断准确率、召回率或校准结论。

## 推荐使用顺序

1. 先用 8 张公开图检查多图编号、结构化输出、低画质拒答和提示注入防护，不能计算诊断准确率。
2. 按标注指南另行收集真实病例，取得同意、去标识并形成诊断证据包。
3. 两名兽医皮肤科专家独立盲标；不一致时由第三名专家裁决，并保留裁决前结果。
4. 将同一动物、同次就诊、重复拍摄和所有画质衍生图绑定为同一组，整组只进入一个数据用途。
5. 提示词只在独立开发集上迭代；40 例核心集从建立时起冻结，最终只解盲一次。
6. 按 `benchmark_config.json` 同时报效果、安全、拒答、专家一致性和置信区间，不只报一个总准确率。

## 公开开发图的归属

数据集：Sungbo Hwang、Hyun Kil Shin、Jin Moon Park、Bosun Kwon、Myung-Gyun Kang，*Classification of pet dog skin diseases using deep learning with images captured from multispectral imaging device*，Mendeley Data，Version 1，DOI [10.17632/5dbht54kw7.1](https://doi.org/10.17632/5dbht54kw7.1)，数据页 <https://data.mendeley.com/datasets/5dbht54kw7/1>，许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。

修改说明：本项目仅选取 8 个病例文件夹中的普通可见光 `pic0.jpg`，重新解码、缩放至 1280×720、JPEG 压缩并去除元数据；未裁切、未叠字、未改变病例的宽泛来源标签。联系表经过拼版和文字标注。每张图的原始与衍生哈希见 `manifest.csv`。联系表 SHA-256 为 `7debe4d03a74f7e7029c88db1232b9b949c20ff6f7b46d588f3a97e354e63222`。

## 版本与结论约束

- 每次正式评估必须冻结提示词、模型、知识库、预处理和标签本体版本。
- 40 例只是可行性规模，类别分层后的置信区间会很宽；结果必须连同分子、分母和 95% 置信区间报告。
- 任何来自其他论文的准确率、最佳 few-shot 数量或自一致性收益都不能直接迁移为 VetAI 的效果声明。
- 若改变提示词或模型，应新建评估运行版本；不得覆盖旧运行或回看冻结集后继续调参。

