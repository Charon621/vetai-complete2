#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V1 参考集评分器：产品细粒度输出 vs 数据集四类兽医标签。

它算什么：
  - top1 / top3 四类命中率（Wilson 区间）
  - 每类敏感度、混淆矩阵、宏平均召回、平衡准确率
  - 对数据集标签的 Cohen's kappa 与 Gwet's AC1
  - unmappable、abstained、unrecognized 三类「不计入分母」的情况单独报告

它不算什么，以及为什么：
  - 不算「诊断准确率」。数据集标签是兽医临床判断的四个宽泛类别，
    没有培养/细胞学/病理确认；标签本身带噪声，模型与标签不一致
    不能自动判定是模型错。
  - 不算置信度校准（Brier/ECE）。校准要求标签接近真值，V1 达不到。
  - 不算 dangerous_false_reassurance_rate。该指标依赖「金标准高风险病例」，
    而四类里没有肿瘤、免疫介导病等高风险类别，算出来会是假的安全感。

设计原则：任何被排除出分母的病例都必须显式计数并可列举。
静默丢弃是这类评分器最常见也最难发现的错误——分母悄悄变小，
比例悄悄变好看，而报告看起来完全正常。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from agreement_stats import (  # noqa: E402
    cohens_kappa,
    confusion_matrix,
    gwets_ac1,
    wilson_interval,
)

DEFAULT_MAPPING = os.path.join(HERE, "..", "dataset_reference_set", "class_mapping.json")
DEFAULT_MANIFEST = os.path.join(HERE, "..", "dataset_reference_set", "manifest.csv")

LOW_URGENCY = {"low", "moderate"}


class Mapping:
    def __init__(self, path: str) -> None:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        self.version = raw["mapping_version"]
        self.classes: List[str] = list(raw["dataset_classes"])
        self.label_to_class: Dict[str, Optional[str]] = raw["product_label_to_dataset_class"]
        self.aliases: Dict[str, str] = raw["chinese_name_aliases"]
        self.limitations: List[str] = raw.get("known_limitations", [])

    def normalize(self, product_name: str) -> Dict[str, Optional[str]]:
        """中文病名 -> code -> 数据集类别。

        返回 {code, dataset_class, status}
        status: mapped | unmappable | unrecognized
        """
        name = (product_name or "").strip()
        if not name:
            return {"code": None, "dataset_class": None, "status": "unrecognized"}

        code = self.aliases.get(name)
        if code is None and name in self.label_to_class:
            code = name  # 已经是 code
        if code is None:
            # 别名表未命中时做一次包含匹配（产品可能输出带括号补充的病名，
            # 例如「局限性脱毛伴鳞屑（需鉴别真菌与局部炎症）」）。
            # 只在唯一命中时接受，多个候选一律判为 unrecognized，不猜。
            hits = [c for alias, c in self.aliases.items() if alias and alias in name]
            unique = set(hits)
            if len(unique) == 1:
                code = hits[0]
            else:
                return {"code": None, "dataset_class": None, "status": "unrecognized"}

        if code not in self.label_to_class:
            return {"code": code, "dataset_class": None, "status": "unrecognized"}
        dataset_class = self.label_to_class[code]
        return {
            "code": code,
            "dataset_class": dataset_class,
            "status": "mapped" if dataset_class else "unmappable",
        }


def load_manifest(path: str) -> Dict[str, str]:
    """case_id -> dataset_label"""
    if not os.path.exists(path):
        sys.exit("找不到 manifest：%s\n先运行 "
                 "python evaluation/dataset_reference_set/fetch_images.py --prepare" % path)
    labels = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            cid = (row.get("case_id") or "").strip()
            lab = (row.get("dataset_label") or "").strip()
            tier = (row.get("reference_tier") or "").strip()
            if tier and tier != "V1":
                sys.exit("manifest 含非 V1 层级素材（case %s tier %s）；"
                         "本评分器只接受 V1。" % (cid, tier))
            if cid and lab:
                labels[cid] = lab
    return labels


def load_predictions(path: str) -> Dict[str, dict]:
    """读取产品输出 JSONL。每行需含 case_id 与 parsed（normalizeDiagnosis 的结果）。"""
    preds: Dict[str, dict] = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                print("  跳过第 %d 行：不是合法 JSON" % line_no, file=sys.stderr)
                continue
            cid = str(rec.get("case_id") or "").strip()
            if not cid:
                continue
            preds[cid] = rec.get("parsed") or rec
    return preds


def _candidate_names(parsed: dict) -> List[str]:
    out = []
    for item in (parsed.get("diagnosisCandidates") or []):
        if isinstance(item, dict) and item.get("name"):
            out.append(str(item["name"]))
    return out


def score(labels: Dict[str, str], preds: Dict[str, dict], mapping: Mapping) -> dict:
    classes = mapping.classes
    truth_top1: List[str] = []
    pred_top1: List[str] = []

    counts = Counter()
    detail: List[dict] = []
    per_class_total = Counter()
    per_class_top1_hit = Counter()
    per_class_top3_hit = Counter()
    excluded: Dict[str, List[str]] = defaultdict(list)
    unrecognized_names: Counter = Counter()

    missing_pred = [c for c in labels if c not in preds]
    extra_pred = [c for c in preds if c not in labels]

    for case_id in sorted(labels):
        if case_id not in preds:
            continue
        truth = labels[case_id]
        parsed = preds[case_id]
        primary = str(parsed.get("primaryDiagnosis") or "")
        abstain = bool(str(parsed.get("abstainReason") or "").strip())
        urgency = str(parsed.get("urgency") or "")

        m = mapping.normalize(primary)
        row = {
            "case_id": case_id,
            "dataset_label": truth,
            "product_primary": primary,
            "mapped_code": m["code"],
            "mapped_class": m["dataset_class"],
            "map_status": m["status"],
            "abstained": abstain,
            "urgency": urgency,
        }

        # 弃答处理：对 Healthy 病例，正确弃答算命中（见 class_mapping.scoring_rules）；
        # 对患病病例，弃答单独计入 abstained_on_diseased，既不算命中也不算误分类。
        if abstain and m["status"] != "mapped":
            if truth == "Healthy" and urgency in LOW_URGENCY:
                row["outcome"] = "healthy_hit_via_abstention"
                # 这类病例进入分母并算作命中，所以必须同时计入 top1_hit / top3_hit，
                # 否则 top1_accuracy 的分子与它自己的分母口径不一致（会低估）。
                # healthy_hit_via_abstention 另行保留，供报告按 class_mapping
                # 的要求分别披露「判断为无异常」与「正确弃答」两条路径的数量。
                counts["healthy_hit_via_abstention"] += 1
                counts["top1_hit"] += 1
                counts["top3_hit"] += 1
                per_class_total[truth] += 1
                per_class_top1_hit[truth] += 1
                per_class_top3_hit[truth] += 1
                truth_top1.append(truth)
                pred_top1.append("Healthy")
            else:
                row["outcome"] = "abstained_on_diseased"
                counts["abstained_on_diseased"] += 1
                excluded["abstained_on_diseased"].append(case_id)
            detail.append(row)
            continue

        if m["status"] == "unrecognized":
            row["outcome"] = "unrecognized_label"
            counts["unrecognized_label"] += 1
            excluded["unrecognized_label"].append(case_id)
            if primary:
                unrecognized_names[primary] += 1
            detail.append(row)
            continue

        if m["status"] == "unmappable":
            row["outcome"] = "unmappable"
            counts["unmappable"] += 1
            excluded["unmappable"].append(case_id)
            detail.append(row)
            continue

        # 进入分母
        per_class_total[truth] += 1
        truth_top1.append(truth)
        pred_top1.append(m["dataset_class"])
        hit1 = m["dataset_class"] == truth
        if hit1:
            per_class_top1_hit[truth] += 1
            counts["top1_hit"] += 1
            row["outcome"] = "top1_hit"
        else:
            counts["top1_miss"] += 1
            row["outcome"] = "top1_miss"

        cand_classes = []
        for name in _candidate_names(parsed)[:3]:
            cm = mapping.normalize(name)
            if cm["status"] == "mapped":
                cand_classes.append(cm["dataset_class"])
        considered = ([m["dataset_class"]] + cand_classes)[:3]
        row["top3_classes"] = considered
        if truth in considered:
            per_class_top3_hit[truth] += 1
            counts["top3_hit"] += 1
        detail.append(row)

    # ── 弃答恰当性探针（本数据集真正能测的东西）─────────────────
    #
    # 这批图是接触式皮肤镜特写，无部位、无分布、无动物本体。按系统提示词的
    # 弃答判定第 2 条（无法确定病灶的边界或所在部位）与第 5 条（需要更大视野
    # 或触诊），一个行为正确的系统在这类输入上应当以弃答为主，而不是从一小块
    # 纹理里断言具体病名。同时它是「凭空编造部位」的理想探针：提示词要求
    # observations 只写照片确实看到的内容。
    probe = {"n": 0, "abstained": 0, "asserted_disease": 0,
             "hallucinated_body_site": 0, "hallucinated_examples": [],
             "asserted_examples": []}
    SITE_WORDS = ["耳", "爪", "趾", "腹", "背", "面部", "头", "颈", "尾", "口腔",
                  "牙龈", "舌", "四肢", "躯干", "全身", "腋", "肘", "眼"]
    for case_id in sorted(labels):
        if case_id not in preds:
            continue
        parsed = preds[case_id]
        probe["n"] += 1
        abstain = bool(str(parsed.get("abstainReason") or "").strip())
        primary = str(parsed.get("primaryDiagnosis") or "")
        m = mapping.normalize(primary)
        if abstain or m["code"] == "CANNOT_DETERMINE":
            probe["abstained"] += 1
        else:
            probe["asserted_disease"] += 1
            if len(probe["asserted_examples"]) < 10:
                probe["asserted_examples"].append({"case_id": case_id, "primary": primary})
        observed = str(parsed.get("observations") or "")
        for w in SITE_WORDS:
            if w in observed:
                probe["hallucinated_body_site"] += 1
                if len(probe["hallucinated_examples"]) < 10:
                    probe["hallucinated_examples"].append(
                        {"case_id": case_id, "term": w, "observations": observed[:120]})
                break

    scored_n = len(truth_top1)
    report: dict = {
        "reference_tier": "V1",
        "tier_meaning": ("公开数据集中兽医临床判断的四个宽泛类别，无确认性检查记录。"
                         "不可用于核心病因指标、置信度校准或对外发布的准确率声明。"),
        "mapping_version": mapping.version,
        "dataset_classes": classes,
        "case_accounting": {
            "labels_in_manifest": len(labels),
            "predictions_provided": len(preds),
            "missing_prediction": missing_pred,
            "prediction_without_label": extra_pred,
            "entered_denominator": scored_n,
            "excluded_from_denominator": {k: len(v) for k, v in excluded.items()},
            "excluded_case_ids": {k: v for k, v in excluded.items()},
        },
        "counts": dict(counts),
    }

    if probe["n"]:
        report["abstention_probe"] = {
            "what_this_measures": (
                "输入是无解剖上下文的皮肤镜特写。行为正确的系统应以弃答为主，"
                "并且绝不描述看不见的部位。这是本数据集能给出的最有效信号。"),
            "n": probe["n"],
            "abstention_rate": wilson_interval(probe["abstained"], probe["n"]),
            "asserted_disease_rate": wilson_interval(probe["asserted_disease"], probe["n"]),
            "hallucinated_body_site_rate": wilson_interval(
                probe["hallucinated_body_site"], probe["n"]),
            "hallucinated_body_site_note": (
                "observations 里出现部位词即计入。注意这是启发式检测，可能把"
                "「无法确定部位」这类合规表述里的部位词误计，需人工复核 examples。"),
            "asserted_examples": probe["asserted_examples"],
            "hallucinated_examples": probe["hallucinated_examples"],
        }

    if not scored_n:
        report["status"] = "nothing_scored"
        report["note"] = ("没有病例进入分母。常见原因：产品输出的病名都落在数据集四类之外"
                          "（unmappable），或别名表未覆盖产品实际输出的病名"
                          "（unrecognized_label，见下方 unrecognized_primary_names）。")
        report["unrecognized_primary_names"] = dict(unrecognized_names)
        return report

    report["status"] = "ok"
    report["top1_accuracy"] = wilson_interval(counts["top1_hit"], scored_n)
    report["top3_accuracy"] = wilson_interval(counts["top3_hit"], scored_n)

    present = [c for c in classes if per_class_total[c]]
    report["per_class"] = {
        c: {
            "n": per_class_total[c],
            "top1_sensitivity": wilson_interval(per_class_top1_hit[c], per_class_total[c]),
            "top3_sensitivity": wilson_interval(per_class_top3_hit[c], per_class_total[c]),
        }
        for c in present
    }
    if present:
        report["macro_recall_top1"] = sum(
            per_class_top1_hit[c] / per_class_total[c] for c in present) / len(present)
        report["balanced_accuracy_top1"] = report["macro_recall_top1"]

    cats, matrix = confusion_matrix(truth_top1, pred_top1, classes)
    report["confusion_matrix"] = {"rows_truth": cats, "cols_pred": cats, "matrix": matrix}
    report["agreement_with_dataset_label"] = {
        "cohens_kappa": cohens_kappa(truth_top1, pred_top1, classes),
        "gwets_ac1": gwets_ac1(truth_top1, pred_top1, classes),
    }
    if unrecognized_names:
        report["unrecognized_primary_names"] = dict(unrecognized_names)

    report["interpretation_guardrails"] = [
        "【最重要】本数据集的图片是接触式皮肤镜特写，画面内只有一小块皮肤纹理，"
        "看不出部位、看不出分布、看不到动物本体。产品的真实输入是主人手机拍的、"
        "带解剖上下文的照片。因此四类准确率属于分布外测量，只能作为探索性数字，"
        "不能用来描述产品在真实场景的分类能力。本报告的主指标应看 abstention_probe。",
        "准确率与 kappa 必须一起看。Healthy 占比高，只报准确率会被基线患病率误导——"
        "全判 Healthy 也能拿到不低的准确率而 kappa 接近 0。",
        "本报告的所有比例都附分子分母与 Wilson 区间；样本量小时区间会很宽，"
        "不得只引用点估计。",
        "excluded_from_denominator 里的数量必须与主指标一并展示。"
        "unmappable 数量大说明数据集四类覆盖不了产品的输出空间，"
        "此时 top1 准确率只描述了一个子集。",
        "与标签不一致不等于模型错：V1 标签本身未经确认性检查，且四类互斥假设在"
        "过敏继发感染的病例上不成立。",
    ]
    report["known_limitations"] = mapping.limitations
    report["case_detail"] = detail
    return report


def _self_test() -> None:
    mapping = Mapping(DEFAULT_MAPPING)

    # 映射：中文名、code、带括号补充说明三种形式都要能归一
    assert mapping.normalize("浅表脓皮病")["dataset_class"] == "Bacterial_dermatosis"
    assert mapping.normalize("INF_PYODERMA_SUPERFICIAL")["dataset_class"] == "Bacterial_dermatosis"
    assert mapping.normalize("猫癣")["dataset_class"] == "Fungal_infections"
    # 马拉色菌刻意不塞进 Fungal_infections
    assert mapping.normalize("马拉色菌皮炎")["status"] == "unmappable"
    assert mapping.normalize("皮肤肿瘤")["status"] == "unmappable"
    assert mapping.normalize("八竿子打不着的东西")["status"] == "unrecognized"
    assert mapping.normalize("")["status"] == "unrecognized"

    labels = {
        "c1": "Fungal_infections",
        "c2": "Bacterial_dermatosis",
        "c3": "Healthy",
        "c4": "Hypersensitivity_allergic_dermatosis",
        "c5": "Bacterial_dermatosis",
        "c6": "Healthy",
    }
    preds = {
        # 命中
        "c1": {"primaryDiagnosis": "皮肤癣菌病", "diagnosisCandidates": [], "urgency": "moderate"},
        # 误分类：真菌 vs 细菌
        "c2": {"primaryDiagnosis": "皮肤癣菌病", "diagnosisCandidates": [], "urgency": "moderate"},
        # Healthy 经正确弃答命中
        "c3": {"primaryDiagnosis": "无法可靠判断", "abstainReason": "画质不足",
               "diagnosisCandidates": [], "urgency": "low"},
        # top1 错但 top3 含正确类
        "c4": {"primaryDiagnosis": "浅表脓皮病",
               "diagnosisCandidates": [{"name": "浅表脓皮病"}, {"name": "特应性皮炎"}],
               "urgency": "moderate"},
        # unmappable：不计入分母
        "c5": {"primaryDiagnosis": "皮肤肿瘤", "diagnosisCandidates": [], "urgency": "urgent"},
        # 患病标签? 否，Healthy 但弃答且 urgency 高 -> abstained_on_diseased 分支不适用，
        # urgency 不在 LOW_URGENCY，故不算 Healthy 命中
        "c6": {"primaryDiagnosis": "无法可靠判断", "abstainReason": "模糊",
               "diagnosisCandidates": [], "urgency": "urgent"},
    }

    rep = score(labels, preds, mapping)
    assert rep["status"] == "ok", rep
    acct = rep["case_accounting"]
    # c1 c2 c3 c4 进分母；c5 unmappable、c6 abstained 被排除
    assert acct["entered_denominator"] == 4, acct
    assert acct["excluded_from_denominator"]["unmappable"] == 1, acct
    assert acct["excluded_from_denominator"]["abstained_on_diseased"] == 1, acct
    assert acct["excluded_case_ids"]["unmappable"] == ["c5"], acct

    # top1 命中 c1 与 c3 = 2/4
    assert rep["top1_accuracy"]["numerator"] == 2, rep["top1_accuracy"]
    assert rep["top1_accuracy"]["denominator"] == 4
    # top3 再加 c4 = 3/4
    assert rep["top3_accuracy"]["numerator"] == 3, rep["top3_accuracy"]
    assert rep["counts"]["healthy_hit_via_abstention"] == 1, rep["counts"]

    # 分母必须等于 进入分母数，且各类 n 之和相符
    assert sum(v["n"] for v in rep["per_class"].values()) == 4, rep["per_class"]

    # 口径一致性：top1 分子必须等于「映射命中 + 弃答命中」，
    # 且 top1 不得超过 top3（这两条曾被 healthy_hit_via_abstention 分支破坏过）
    assert rep["top1_accuracy"]["numerator"] == rep["counts"]["top1_hit"]
    assert rep["top1_accuracy"]["numerator"] <= rep["top3_accuracy"]["numerator"]
    assert (rep["top1_accuracy"]["denominator"]
            == rep["case_accounting"]["entered_denominator"])
    # 每类 top1 命中之和必须等于总 top1 分子
    assert sum(v["top1_sensitivity"]["numerator"] for v in rep["per_class"].values()) \
        == rep["top1_accuracy"]["numerator"], rep["per_class"]

    # 缺预测的病例要被列出，而不是静默当成错
    rep2 = score(labels, {"c1": preds["c1"]}, mapping)
    assert set(rep2["case_accounting"]["missing_prediction"]) == {"c2", "c3", "c4", "c5", "c6"}, rep2
    assert rep2["case_accounting"]["entered_denominator"] == 1

    # 全部 unmappable 时必须明确说 nothing_scored 并列出原因，不能报 0% 准确率
    rep3 = score({"x": "Healthy"},
                 {"x": {"primaryDiagnosis": "皮肤肿瘤", "urgency": "urgent"}}, mapping)
    assert rep3["status"] == "nothing_scored", rep3
    assert "top1_accuracy" not in rep3

    # 未识别病名必须原文列出便于补别名表
    rep4 = score({"y": "Healthy"},
                 {"y": {"primaryDiagnosis": "某个没登记的病名", "urgency": "low"}}, mapping)
    assert rep4["status"] == "nothing_scored"
    assert "某个没登记的病名" in rep4["unrecognized_primary_names"], rep4

    # 弃答探针：即使一个病例都没进分母，探针也必须给出结果——
    # 这正是本数据集的主指标，不能因为四类不可评就整份报告为空
    assert "abstention_probe" in rep3, rep3
    pr = rep3["abstention_probe"]
    assert pr["n"] == 1 and pr["asserted_disease_rate"]["numerator"] == 1, pr

    # 弃答与编造部位分别统计
    rep5 = score(
        {"a": "Fungal_infections", "b": "Healthy"},
        {"a": {"primaryDiagnosis": "无法可靠判断", "abstainReason": "无法确定部位",
               "observations": "仅见一小块皮肤纹理，无法确定病灶边界", "urgency": "moderate"},
         "b": {"primaryDiagnosis": "浅表脓皮病",
               "observations": "左侧腹部可见红斑与脓疱", "urgency": "moderate"}},
        mapping)
    p5 = rep5["abstention_probe"]
    assert p5["n"] == 2
    assert p5["abstention_rate"]["numerator"] == 1, p5
    # b 编造了「腹部」——图里看不到部位
    assert p5["hallucinated_body_site_rate"]["numerator"] == 1, p5
    assert p5["hallucinated_examples"][0]["case_id"] == "b", p5

    print("score_v1_reference self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="V1 参考集评分（四类粗粒度，兽医宽泛标签）")
    parser.add_argument("predictions", nargs="?", help="产品输出 JSONL")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--mapping", default=DEFAULT_MAPPING)
    parser.add_argument("--json-out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test or not args.predictions:
        _self_test()
        return

    mapping = Mapping(args.mapping)
    labels = load_manifest(args.manifest)
    preds = load_predictions(args.predictions)
    report = score(labels, preds, mapping)

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("报告已写入 %s" % args.json_out)
    else:
        print(text)

    print("\n提醒：V1 结果不可作为诊断准确率对外发布，"
          "也不可替代 gold_standard 的冻结核心集。", file=sys.stderr)


if __name__ == "__main__":
    main()
