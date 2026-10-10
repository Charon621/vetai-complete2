#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一致性与不确定性统计库。

benchmark_config.json 的 annotation_agreement / uncertainty_reporting 段声明了
raw_percent_agreement、cohens_kappa、gwets_ac1、weighted_kappa、wilson 95% CI
和以 animal_id_hash 为聚类单位的 bootstrap，但此前没有任何实现。本模块补齐这些
计算，只依赖标准库，便于在任何环境复现。

设计约束（对应 annotation_guide.md §9.3）：
- 一致性统计必须在裁决之前用两名专家的锁定标注计算，不能用裁决后的最终标签；
- 有序变量（紧急度）用加权 kappa，不能当作名义变量；
- 比例指标必须同时给出分子、分母和区间，不能只报一个百分数；
- bootstrap 以动物为聚类单位，同一动物的多张图/多变体不得被当作独立样本。

术语提醒：本模块算的是「评价者之间的一致性」，不是「诊断正确性」。
高百分比一致率配上接近 0 的 kappa 是常见陷阱（论文里 Claude 在 gingivitis 上
准确率 81.7% 但 kappa=0.000，因为它把几乎所有病例都标成同一类，纯靠基线患病率
蹭准确率）。任何结论都必须同时看这两个数。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
from collections import Counter, defaultdict
from typing import Dict, Hashable, List, Optional, Sequence, Tuple

__all__ = [
    "normal_sf",
    "wilson_interval",
    "confusion_matrix",
    "raw_agreement",
    "cohens_kappa",
    "weighted_kappa",
    "fleiss_kappa",
    "gwets_ac1",
    "cluster_bootstrap_ci",
    "interpret_kappa",
    "paired_mcnemar_exact",
]


# --------------------------------------------------------------------------
# 基础分布函数（避免引入 scipy 依赖）
# --------------------------------------------------------------------------

def normal_sf(z: float) -> float:
    """标准正态分布的上尾概率 P(Z > z)。"""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def _two_sided_p(z: float) -> float:
    return 2.0 * normal_sf(abs(z))


# --------------------------------------------------------------------------
# 比例区间
# --------------------------------------------------------------------------

def wilson_interval(successes: int, total: int, confidence: float = 0.95) -> Dict[str, float]:
    """Wilson 得分区间。

    小样本下比 Wald 区间稳健得多；小样本比例估计推荐用这个而不是 p±1.96·SE，
    否则在接近 0 或 1 的比例上会给出越界或过窄的区间。
    """
    if total <= 0:
        return {"numerator": successes, "denominator": total,
                "point": float("nan"), "lower": float("nan"), "upper": float("nan")}
    if successes < 0 or successes > total:
        raise ValueError("successes 必须落在 0 到 total 之间")

    z = _z_for_confidence(confidence)
    p = successes / total
    denom = 1.0 + z * z / total
    center = (p + z * z / (2.0 * total)) / denom
    half = (z / denom) * math.sqrt(p * (1.0 - p) / total + z * z / (4.0 * total * total))
    return {
        "numerator": successes,
        "denominator": total,
        "point": p,
        "lower": max(0.0, center - half),
        "upper": min(1.0, center + half),
        "confidence": confidence,
    }


def _z_for_confidence(confidence: float) -> float:
    """由双侧置信水平反解 z（二分法，避免依赖 scipy.stats.norm.ppf）。"""
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence 必须在 0 和 1 之间")
    target = (1.0 - confidence) / 2.0
    lo, hi = 0.0, 10.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if normal_sf(mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# --------------------------------------------------------------------------
# 列联表
# --------------------------------------------------------------------------

def confusion_matrix(
    rater_a: Sequence[Hashable],
    rater_b: Sequence[Hashable],
    categories: Optional[Sequence[Hashable]] = None,
) -> Tuple[List[Hashable], List[List[int]]]:
    """返回 (类别顺序, 计数矩阵)，矩阵行为 rater_a、列为 rater_b。"""
    if len(rater_a) != len(rater_b):
        raise ValueError("两位评价者的标注数量必须一致")
    if not rater_a:
        raise ValueError("标注为空")

    if categories is None:
        cats = sorted({*rater_a, *rater_b}, key=lambda v: str(v))
    else:
        cats = list(categories)
        unknown = ({*rater_a, *rater_b}) - set(cats)
        if unknown:
            raise ValueError("出现未在 categories 中声明的标签：%s" % sorted(map(str, unknown)))

    index = {c: i for i, c in enumerate(cats)}
    matrix = [[0] * len(cats) for _ in cats]
    for a, b in zip(rater_a, rater_b):
        matrix[index[a]][index[b]] += 1
    return cats, matrix


# --------------------------------------------------------------------------
# 两评价者一致性
# --------------------------------------------------------------------------

def raw_agreement(
    rater_a: Sequence[Hashable],
    rater_b: Sequence[Hashable],
    confidence: float = 0.95,
) -> Dict[str, float]:
    """原始一致率（附 Wilson 区间）。

    这是 annotation_guide §9.3 要求的「裁决前原始一致率」，必须与 kappa 一起报告。
    """
    if len(rater_a) != len(rater_b):
        raise ValueError("两位评价者的标注数量必须一致")
    hits = sum(1 for a, b in zip(rater_a, rater_b) if a == b)
    result = wilson_interval(hits, len(rater_a), confidence)
    result["metric"] = "raw_percent_agreement"
    return result


def cohens_kappa(
    rater_a: Sequence[Hashable],
    rater_b: Sequence[Hashable],
    categories: Optional[Sequence[Hashable]] = None,
) -> Dict[str, object]:
    """Cohen's kappa，附 H0:kappa=0 下的渐近标准误与双侧 p 值。

    与 SPSS 输出的 "Asymptotic Std. Error" 及显著性口径一致，便于和已发表结果对照。
    另外单独给出用于构造置信区间的样本标准误（se_ci），二者用途不同：
    se_null 只能用来做「是否显著异于 0」的检验，不能拿去算区间。
    """
    cats, matrix = confusion_matrix(rater_a, rater_b, categories)
    n = float(len(rater_a))
    k = len(cats)

    p = [[matrix[i][j] / n for j in range(k)] for i in range(k)]
    row = [sum(p[i]) for i in range(k)]
    col = [sum(p[i][j] for i in range(k)) for j in range(k)]

    po = sum(p[i][i] for i in range(k))
    pe = sum(row[i] * col[i] for i in range(k))

    if abs(1.0 - pe) < 1e-12:
        # 所有评价者都只用了同一个类别：kappa 无定义。
        return {
            "metric": "cohens_kappa", "kappa": float("nan"), "po": po, "pe": pe,
            "n": int(n), "categories": [str(c) for c in cats],
            "se_null": float("nan"), "se_ci": float("nan"), "z": float("nan"),
            "p_value": float("nan"), "ci_lower": float("nan"), "ci_upper": float("nan"),
            "degenerate": True,
            "note": "期望一致性为 1，kappa 无定义；这通常说明某位评价者把所有病例标成了同一类",
        }

    kappa = (po - pe) / (1.0 - pe)

    # H0: kappa = 0 下的渐近标准误（SPSS 口径）
    se_null_sq = (pe + pe * pe - sum(row[i] * col[i] * (row[i] + col[i]) for i in range(k)))
    se_null = math.sqrt(max(se_null_sq, 0.0) / (n * (1.0 - pe) ** 2))
    z = kappa / se_null if se_null > 0 else float("nan")
    p_value = _two_sided_p(z) if se_null > 0 else float("nan")

    # 用于置信区间的样本标准误（Fleiss/Cohen 1969）
    term_a = sum(p[i][i] * (1.0 - (row[i] + col[i]) * (1.0 - kappa)) ** 2 for i in range(k))
    term_b = (1.0 - kappa) ** 2 * sum(
        p[i][j] * (col[i] + row[j]) ** 2
        for i in range(k) for j in range(k) if i != j
    )
    term_c = (kappa - pe * (1.0 - kappa)) ** 2
    se_ci_sq = (term_a + term_b - term_c) / (n * (1.0 - pe) ** 2)
    se_ci = math.sqrt(max(se_ci_sq, 0.0))
    z95 = _z_for_confidence(0.95)

    return {
        "metric": "cohens_kappa",
        "kappa": kappa,
        "po": po,
        "pe": pe,
        "n": int(n),
        "categories": [str(c) for c in cats],
        "matrix": matrix,
        "se_null": se_null,
        "se_ci": se_ci,
        "z": z,
        "p_value": p_value,
        "ci_lower": kappa - z95 * se_ci,
        "ci_upper": kappa + z95 * se_ci,
        "degenerate": False,
        "strength": interpret_kappa(kappa),
    }


def weighted_kappa(
    rater_a: Sequence[Hashable],
    rater_b: Sequence[Hashable],
    categories: Sequence[Hashable],
    weights: str = "linear",
) -> Dict[str, object]:
    """有序变量的加权 kappa（linear 或 quadratic）。

    categories 必须按有序等级从低到高显式传入——紧急度是 monitor < routine <
    urgent < emergency，若让函数按字母排序会把等级顺序打乱，权重全错。
    """
    cats = list(categories)
    k = len(cats)
    if k < 2:
        raise ValueError("加权 kappa 至少需要两个有序类别")
    _, matrix = confusion_matrix(rater_a, rater_b, cats)
    n = float(len(rater_a))

    if weights == "linear":
        def w(i: int, j: int) -> float:
            return 1.0 - abs(i - j) / (k - 1)
    elif weights == "quadratic":
        def w(i: int, j: int) -> float:
            return 1.0 - ((i - j) / (k - 1)) ** 2
    else:
        raise ValueError("weights 只支持 'linear' 或 'quadratic'")

    p = [[matrix[i][j] / n for j in range(k)] for i in range(k)]
    row = [sum(p[i]) for i in range(k)]
    col = [sum(p[i][j] for i in range(k)) for j in range(k)]

    po_w = sum(w(i, j) * p[i][j] for i in range(k) for j in range(k))
    pe_w = sum(w(i, j) * row[i] * col[j] for i in range(k) for j in range(k))

    if abs(1.0 - pe_w) < 1e-12:
        return {"metric": "weighted_kappa", "weights": weights, "kappa": float("nan"),
                "po_w": po_w, "pe_w": pe_w, "n": int(n), "degenerate": True}

    kappa = (po_w - pe_w) / (1.0 - pe_w)
    return {
        "metric": "weighted_kappa",
        "weights": weights,
        "kappa": kappa,
        "po_w": po_w,
        "pe_w": pe_w,
        "n": int(n),
        "ordered_categories": [str(c) for c in cats],
        "matrix": matrix,
        "degenerate": False,
        "strength": interpret_kappa(kappa),
    }


def gwets_ac1(
    rater_a: Sequence[Hashable],
    rater_b: Sequence[Hashable],
    categories: Optional[Sequence[Hashable]] = None,
) -> Dict[str, object]:
    """Gwet's AC1。

    为什么 config 要求它和 Cohen's kappa 一起报：kappa 在类别极不平衡时会被
    「基线悖论」压低——两位专家高度一致但因为某类占比 95%，kappa 依然接近 0。
    AC1 的期望一致性不依赖各评价者的边际分布，在皮肤科这种阳性率悬殊的场景更稳。
    两个数一起看才能区分「真的不一致」和「患病率导致的伪不一致」。
    """
    cats, matrix = confusion_matrix(rater_a, rater_b, categories)
    n = float(len(rater_a))
    k = len(cats)
    if k < 2:
        return {"metric": "gwets_ac1", "ac1": float("nan"), "n": int(n), "degenerate": True,
                "note": "只出现一个类别，AC1 无定义"}

    p = [[matrix[i][j] / n for j in range(k)] for i in range(k)]
    row = [sum(p[i]) for i in range(k)]
    col = [sum(p[i][j] for i in range(k)) for j in range(k)]

    pa = sum(p[i][i] for i in range(k))
    pi = [(row[i] + col[i]) / 2.0 for i in range(k)]
    pe = sum(x * (1.0 - x) for x in pi) / (k - 1)

    if abs(1.0 - pe) < 1e-12:
        return {"metric": "gwets_ac1", "ac1": float("nan"), "pa": pa, "pe": pe,
                "n": int(n), "degenerate": True}

    ac1 = (pa - pe) / (1.0 - pe)
    return {
        "metric": "gwets_ac1",
        "ac1": ac1,
        "pa": pa,
        "pe": pe,
        "n": int(n),
        "categories": [str(c) for c in cats],
        "degenerate": False,
        "strength": interpret_kappa(ac1),
    }


# --------------------------------------------------------------------------
# 多评价者
# --------------------------------------------------------------------------

def fleiss_kappa(ratings: Sequence[Sequence[Hashable]],
                 categories: Optional[Sequence[Hashable]] = None) -> Dict[str, object]:
    """Fleiss' kappa：每个元素是一个病例的全部评价者标签列表。

    要求每个病例的评价者数量相同（Fleiss 的前提）。annotation_guide §2.2 提到
    「共识前报告专家间 Fleiss' kappa 或 Gwet's AC1」，用于三名及以上专家的场景。
    """
    if not ratings:
        raise ValueError("ratings 为空")
    m = len(ratings[0])
    if m < 2:
        raise ValueError("Fleiss' kappa 至少需要两名评价者")
    if any(len(r) != m for r in ratings):
        raise ValueError("Fleiss' kappa 要求每个病例的评价者数量相同；"
                         "评价者数不等时请改用 Gwet's AC1 或成对 Cohen's kappa")

    if categories is None:
        cats = sorted({label for r in ratings for label in r}, key=lambda v: str(v))
    else:
        cats = list(categories)
    index = {c: i for i, c in enumerate(cats)}
    k = len(cats)
    n = len(ratings)

    counts = [[0] * k for _ in range(n)]
    for i, row in enumerate(ratings):
        for label in row:
            counts[i][index[label]] += 1

    p_j = [sum(counts[i][j] for i in range(n)) / float(n * m) for j in range(k)]
    pe = sum(x * x for x in p_j)
    p_i = [(sum(c * c for c in counts[i]) - m) / float(m * (m - 1)) for i in range(n)]
    pa = sum(p_i) / n

    if abs(1.0 - pe) < 1e-12:
        return {"metric": "fleiss_kappa", "kappa": float("nan"), "pa": pa, "pe": pe,
                "n_cases": n, "n_raters": m, "degenerate": True}

    kappa = (pa - pe) / (1.0 - pe)
    return {
        "metric": "fleiss_kappa",
        "kappa": kappa,
        "pa": pa,
        "pe": pe,
        "n_cases": n,
        "n_raters": m,
        "categories": [str(c) for c in cats],
        "degenerate": False,
        "strength": interpret_kappa(kappa),
    }


# --------------------------------------------------------------------------
# 聚类 bootstrap
# --------------------------------------------------------------------------

def cluster_bootstrap_ci(
    items: Sequence[dict],
    statistic,
    cluster_key: str = "animal_id_hash",
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 20260726,
) -> Dict[str, object]:
    """以动物为单位重抽样的 bootstrap 百分位区间。

    为什么必须按动物聚类（annotation_guide §8）：同一只动物的多张照片、多次
    就诊和画质压力变体是相关观测。按图片重抽样会把有效样本量虚增，区间被人为
    压窄，得出「显著改善」的假结论。这里整簇一起抽取或一起不抽。

    statistic: 接收一个 item 列表、返回 float 的可调用对象；返回 nan 的抽样轮次
    会被跳过并计入 skipped，避免个别退化样本污染区间。
    """
    if not items:
        raise ValueError("items 为空")
    missing = [i for i, it in enumerate(items) if cluster_key not in it]
    if missing:
        raise ValueError("以下条目缺少聚类字段 %s：索引 %s" % (cluster_key, missing[:5]))

    groups: Dict[Hashable, List[dict]] = defaultdict(list)
    for it in items:
        groups[it[cluster_key]].append(it)
    cluster_ids = list(groups.keys())

    point = statistic(list(items))
    rng = random.Random(seed)
    samples: List[float] = []
    skipped = 0
    for _ in range(iterations):
        picked: List[dict] = []
        for _ in range(len(cluster_ids)):
            picked.extend(groups[cluster_ids[rng.randrange(len(cluster_ids))]])
        try:
            value = statistic(picked)
        except (ValueError, ZeroDivisionError):
            skipped += 1
            continue
        if value is None or (isinstance(value, float) and math.isnan(value)):
            skipped += 1
            continue
        samples.append(float(value))

    if not samples:
        return {"point": point, "lower": float("nan"), "upper": float("nan"),
                "iterations": iterations, "effective": 0, "skipped": skipped,
                "n_clusters": len(cluster_ids), "n_items": len(items),
                "note": "所有重抽样都退化，无法给出区间"}

    samples.sort()
    alpha = (1.0 - confidence) / 2.0
    lo = samples[max(0, int(math.floor(alpha * len(samples))))]
    hi = samples[min(len(samples) - 1, int(math.ceil((1.0 - alpha) * len(samples))) - 1)]
    return {
        "point": point,
        "lower": lo,
        "upper": hi,
        "confidence": confidence,
        "iterations": iterations,
        "effective": len(samples),
        "skipped": skipped,
        "n_clusters": len(cluster_ids),
        "n_items": len(items),
        "cluster_key": cluster_key,
        "seed": seed,
    }


# --------------------------------------------------------------------------
# 配对比较（压力变体 / 模型间对比）
# --------------------------------------------------------------------------

def paired_mcnemar_exact(both: int, only_a: int, only_b: int, neither: int) -> Dict[str, object]:
    """McNemar 精确检验（二项分布），用于同病例配对的成败对比。

    annotation_guide §9.3 要求「压力变体采用同病例配对分析」。原始图与其模糊
    变体不是独立样本，用卡方独立性检验会高估显著性；配对检验只看不一致的那部分。
    小样本下用精确二项而非带连续性校正的卡方。
    """
    discordant = only_a + only_b
    if discordant == 0:
        return {"metric": "mcnemar_exact", "p_value": 1.0, "discordant": 0,
                "only_a": only_a, "only_b": only_b, "both": both, "neither": neither,
                "note": "没有不一致的配对，无法区分两者"}

    smaller = min(only_a, only_b)
    # P = 2 * sum_{i=0}^{smaller} C(n,i) * 0.5^n，上限截断到 1
    tail = sum(math.comb(discordant, i) for i in range(smaller + 1)) * (0.5 ** discordant)
    return {
        "metric": "mcnemar_exact",
        "p_value": min(1.0, 2.0 * tail),
        "discordant": discordant,
        "only_a": only_a,
        "only_b": only_b,
        "both": both,
        "neither": neither,
    }


# --------------------------------------------------------------------------
# 解释
# --------------------------------------------------------------------------

def interpret_kappa(value: float) -> str:
    """Landis & Koch 分级。

    只是沟通用的粗标签，不能当作临床可用性阈值——论文的核心教训正是
    「高一致性标签 ≠ 可独立用于诊断」。报告里必须同时给出数值和区间。
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "undefined"
    if value < 0:
        return "worse_than_chance"
    if value < 0.21:
        return "slight"
    if value < 0.41:
        return "fair"
    if value < 0.61:
        return "moderate"
    if value < 0.81:
        return "substantial"
    return "almost_perfect"


# --------------------------------------------------------------------------
# CLI：对标注 CSV 计算裁决前一致性
# --------------------------------------------------------------------------

URGENCY_ORDER = ["monitor", "routine", "urgent", "emergency"]


def pivot_long_form(
    rows: Sequence[dict],
    case_key: str = "case_id",
    annotator_key: str = "annotator_id_hash",
    value_keys: Sequence[str] = ("primary_etiology_label", "urgency", "gold_tier",
                                 "photo_quality_score"),
) -> Dict[str, object]:
    """把长格式专家标注表（每位标注者一行）转成成对宽格式。

    expert_annotation_form.template.csv 是长格式，因为每位专家独立提交自己的
    那一份；一致性统计需要的是成对列。这个函数做桥接。

    只保留恰好有两名标注者的病例——三人及以上应改用 fleiss_kappa，
    单人则无法计算一致性。被排除的病例会明确列出，不静默丢弃。
    """
    by_case: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for row in rows:
        cid = (row.get(case_key) or "").strip()
        aid = (row.get(annotator_key) or "").strip()
        if not cid or not aid:
            continue
        by_case[cid][aid] = row

    paired: List[dict] = []
    skipped_single: List[str] = []
    skipped_multi: List[str] = []
    for cid in sorted(by_case):
        annotators = sorted(by_case[cid])
        if len(annotators) == 1:
            skipped_single.append(cid)
            continue
        if len(annotators) > 2:
            skipped_multi.append(cid)
            continue
        a_row, b_row = by_case[cid][annotators[0]], by_case[cid][annotators[1]]
        entry = {case_key: cid,
                 "annotator_a": annotators[0],
                 "annotator_b": annotators[1]}
        for key in value_keys:
            entry["%s__a" % key] = (a_row.get(key) or "").strip()
            entry["%s__b" % key] = (b_row.get(key) or "").strip()
        # 长格式里没有动物哈希时，退化为按病例聚类（每例自成一簇）；
        # 是否由专家行提供动物字段单独记录，供 B15-2 与 manifest 对照
        a_animal = (a_row.get("animal_id_hash") or "").strip()
        b_animal = (b_row.get("animal_id_hash") or "").strip()
        entry["animal_id_hash"] = a_animal or b_animal or cid
        entry["animal_from_expert"] = bool(a_animal or b_animal)
        entry["animal_conflict"] = bool(a_animal and b_animal and a_animal != b_animal)
        paired.append(entry)

    return {
        "paired": paired,
        "n_paired": len(paired),
        "skipped_single_annotator": skipped_single,
        "skipped_more_than_two": skipped_multi,
        "note": "三名及以上标注者的病例请改用 fleiss_kappa；"
                "单名标注者无法计算一致性。",
    }


def load_animal_manifest(path: str) -> Dict[str, Dict[str, str]]:
    """B15-2（BUG-32）：读取 case_manifest，建立 case_id → 动物/衍生组 的唯一映射。

    manifest 是动物聚类的唯一权威：专家表里的动物字段只是冗余核对。
    manifest 内同一 case_id 出现两个动物哈希 = 数据错误，直接阻断。"""
    if not os.path.exists(path):
        raise FileNotFoundError("manifest 不存在：%s" % path)
    mapping: Dict[str, Dict[str, str]] = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for idx, row in enumerate(csv.DictReader(fh), start=2):
            cid = (row.get("case_id") or "").strip()
            animal = (row.get("animal_id_hash") or "").strip()
            if not cid or not animal:
                raise ValueError("manifest 第 %d 行缺 case_id 或 animal_id_hash" % idx)
            group = (row.get("derivative_group_id") or "").strip()
            if cid in mapping:
                if mapping[cid]["animal_id_hash"] != animal:
                    raise ValueError("case '%s' 在 manifest 中对应两个动物：%s vs %s（同例双动物阻断）"
                                     % (cid, mapping[cid]["animal_id_hash"][:8], animal[:8]))
            mapping[cid] = {"animal_id_hash": animal, "derivative_group_id": group}
    return mapping


def apply_manifest_join(paired: List[dict],
                        manifest_map: Dict[str, Dict[str, str]],
                        allow_case_clusters: bool = False) -> Dict[str, object]:
    """把 manifest 的动物哈希强制 join 到成对行上（B15-2）。

    阻断条件：missing join（case 不在 manifest）、专家与 manifest 动物矛盾、
    专家表内同例双动物。allow_case_clusters=True 只允许在开发统计里退化为
    病例级聚类，报告必须带 development_only 标记；正式评分禁止退化。"""
    notes: Dict[str, object] = {"joined": 0, "fallback_case_clusters": [],
                                "cluster_source": "manifest"}
    for entry in paired:
        cid = entry.get("case_id") or ""
        m = manifest_map.get(cid)
        if m is None:
            if not allow_case_clusters:
                raise ValueError("case '%s' 不在 manifest 中（missing join）：正式评分禁止退化为病例聚类" % cid)
            notes["fallback_case_clusters"].append(cid)
            notes["cluster_source"] = "case_level_development_only"
            continue
        if entry.get("animal_conflict"):
            raise ValueError("case '%s' 专家表内出现两个不同动物哈希（同例双动物阻断）" % cid)
        if entry.get("animal_from_expert") and entry["animal_id_hash"] != m["animal_id_hash"]:
            raise ValueError("case '%s' 专家动物 %s 与 manifest 动物 %s 矛盾；以 manifest 为准前必须先解决矛盾"
                             % (cid, entry["animal_id_hash"][:8], m["animal_id_hash"][:8]))
        entry["animal_id_hash"] = m["animal_id_hash"]
        if m.get("derivative_group_id"):
            entry["derivative_group_id"] = m["derivative_group_id"]
        notes["joined"] += 1
    return notes


def score_long_form_csv(path: str,
                        cluster_key: str = "animal_id_hash",
                        manifest_path: Optional[str] = None,
                        allow_case_clusters: bool = False) -> Dict[str, object]:
    """直接对 expert_annotation_form 长格式表计算裁决前一致性。

    B15-2：提供 manifest_path 时按 manifest 强制 join 动物（缺失/矛盾阻断，
    不再退化 case_id 聚类）；未提供且 allow_case_clusters=False 时维持旧有
    行为以保持兼容，但报告会标注 cluster_source=case_fallback_unverified。"""
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return {"status": "empty_file", "path": path,
                "note": "标注表为空；尚未收集标注时这是正常状态"}

    pivoted = pivot_long_form(rows)
    paired = pivoted["paired"]
    if not paired:
        return {"status": "no_paired_cases", "path": path, **pivoted}

    join_note: Optional[dict] = None
    if manifest_path:
        manifest_map = load_animal_manifest(manifest_path)
        join_note = apply_manifest_join(paired, manifest_map,
                                        allow_case_clusters=allow_case_clusters)

    a = [p["primary_etiology_label__a"] for p in paired]
    b = [p["primary_etiology_label__b"] for p in paired]

    report: Dict[str, object] = {
        "status": "ok",
        "path": path,
        "format": "long_form_expert_annotation",
        "n_cases": len(paired),
        "n_animal_clusters": len({p[cluster_key] for p in paired}),
        "cluster_source": (join_note or {}).get("cluster_source",
                                               "manifest" if manifest_path else "case_fallback_unverified"),
        "manifest_join": join_note,
        "skipped_single_annotator": pivoted["skipped_single_annotator"],
        "skipped_more_than_two": pivoted["skipped_more_than_two"],
        "label_distribution": {"annotator_a": dict(Counter(a)),
                               "annotator_b": dict(Counter(b))},
        "primary_label": {
            "raw_agreement": raw_agreement(a, b),
            "cohens_kappa": cohens_kappa(a, b),
            "gwets_ac1": gwets_ac1(a, b),
        },
        "disagreement_cases": [
            {"case_id": p["case_id"],
             "annotator_a_label": p["primary_etiology_label__a"],
             "annotator_b_label": p["primary_etiology_label__b"]}
            for p in paired
            if p["primary_etiology_label__a"] != p["primary_etiology_label__b"]
        ],
    }

    ua = [p["urgency__a"] for p in paired]
    ub = [p["urgency__b"] for p in paired]
    if all(ua) and all(ub):
        unknown = ({*ua, *ub}) - set(URGENCY_ORDER)
        if unknown:
            report["urgency"] = {"status": "unknown_levels", "unexpected": sorted(unknown),
                                 "expected_order": URGENCY_ORDER}
        else:
            report["urgency"] = {
                "raw_agreement": raw_agreement(ua, ub),
                "weighted_kappa_linear": weighted_kappa(ua, ub, URGENCY_ORDER, "linear"),
            }

    clusters = {p.get(cluster_key) for p in paired}
    if len(clusters) > 1:
        def kappa_stat(sub: Sequence[dict]) -> float:
            return float(cohens_kappa(
                [i["primary_etiology_label__a"] for i in sub],
                [i["primary_etiology_label__b"] for i in sub])["kappa"])

        report["primary_label"]["cohens_kappa_cluster_bootstrap"] = cluster_bootstrap_ci(
            paired, kappa_stat, cluster_key=cluster_key, iterations=2000)

    return report


def score_annotation_csv(
    path: str,
    label_a: str = "expert_1_label",
    label_b: str = "expert_2_label",
    urgency_a: str = "expert_1_urgency",
    urgency_b: str = "expert_2_urgency",
    cluster_key: str = "animal_id_hash",
) -> Dict[str, object]:
    """读取标注 CSV，输出裁决前一致性报告。

    只使用两名专家的锁定列；刻意不读 final_label / adjudicated_label，
    因为用裁决后标签算一致性会把裁决过程的信息泄漏进去，虚高一致性。
    """
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        rows = [r for r in csv.DictReader(fh)]

    rows = [r for r in rows if (r.get(label_a) or "").strip() and (r.get(label_b) or "").strip()]
    if not rows:
        return {"status": "no_annotated_rows",
                "note": "两名专家的标注列都为空；这是尚未收集标注的正常状态，不是错误",
                "path": path}

    a = [r[label_a].strip() for r in rows]
    b = [r[label_b].strip() for r in rows]

    report: Dict[str, object] = {
        "status": "ok",
        "path": path,
        "n_cases": len(rows),
        "n_clusters": len({(r.get(cluster_key) or "").strip() for r in rows}),
        "label_distribution": {
            label_a: dict(Counter(a)),
            label_b: dict(Counter(b)),
        },
        "primary_label": {
            "raw_agreement": raw_agreement(a, b),
            "cohens_kappa": cohens_kappa(a, b),
            "gwets_ac1": gwets_ac1(a, b),
        },
    }

    ua = [(r.get(urgency_a) or "").strip() for r in rows]
    ub = [(r.get(urgency_b) or "").strip() for r in rows]
    if all(ua) and all(ub):
        unknown = ({*ua, *ub}) - set(URGENCY_ORDER)
        if unknown:
            report["urgency"] = {"status": "unknown_levels",
                                 "unexpected": sorted(unknown),
                                 "expected_order": URGENCY_ORDER}
        else:
            report["urgency"] = {
                "raw_agreement": raw_agreement(ua, ub),
                "weighted_kappa_linear": weighted_kappa(ua, ub, URGENCY_ORDER, "linear"),
                "weighted_kappa_quadratic": weighted_kappa(ua, ub, URGENCY_ORDER, "quadratic"),
            }

    if report["n_clusters"] > 1:
        items = [{cluster_key: (r.get(cluster_key) or "").strip(), "a": x, "b": y}
                 for r, x, y in zip(rows, a, b)]

        def kappa_stat(sub: Sequence[dict]) -> float:
            res = cohens_kappa([i["a"] for i in sub], [i["b"] for i in sub])
            return float(res["kappa"])

        report["primary_label"]["cohens_kappa_cluster_bootstrap"] = cluster_bootstrap_ci(
            items, kappa_stat, cluster_key=cluster_key, iterations=2000)

    return report


# --------------------------------------------------------------------------
# 自检
# --------------------------------------------------------------------------

def _self_test() -> None:
    def close(x: float, y: float, tol: float = 1e-9) -> bool:
        return abs(x - y) < tol

    # Cohen's kappa：手算 2x2。 [[20,5],[10,15]]
    # po=0.70, pe=0.5*0.6+0.5*0.4=0.50, kappa=0.40
    a = ["+"] * 25 + ["-"] * 25
    b = ["+"] * 20 + ["-"] * 5 + ["+"] * 10 + ["-"] * 15
    res = cohens_kappa(a, b)
    assert close(res["po"], 0.70), res
    assert close(res["pe"], 0.50), res
    assert close(res["kappa"], 0.40), res
    # 0.40 落在 Landis & Koch 的 fair 区间（0.21–0.40）上界，不是 moderate
    assert res["strength"] == "fair", res
    assert interpret_kappa(0.45) == "moderate"
    assert interpret_kappa(-0.1) == "worse_than_chance"
    assert res["p_value"] < 0.01, res
    # 置信区间必须包含点估计且不能退化成一个点
    assert res["ci_lower"] < res["kappa"] < res["ci_upper"], res

    # 完全一致 -> kappa = 1
    perfect = cohens_kappa(["x", "y", "z", "x"], ["x", "y", "z", "x"])
    assert close(perfect["kappa"], 1.0), perfect

    # 退化：一位评价者只用一个类别 -> pe=1，必须标记而不是崩溃或返回 0
    degen = cohens_kappa(["p"] * 10, ["p"] * 10)
    assert degen["degenerate"] is True, degen
    assert math.isnan(degen["kappa"]), degen

    # 基线悖论：一致率 0.6 但类别不平衡时 AC1 > kappa
    # [[45,15],[25,15]]  pa=0.60  kappa=0.130...  AC1=0.266...
    a2 = ["+"] * 60 + ["-"] * 40
    b2 = ["+"] * 45 + ["-"] * 15 + ["+"] * 25 + ["-"] * 15
    k2 = cohens_kappa(a2, b2)
    g2 = gwets_ac1(a2, b2)
    assert close(k2["po"], 0.60), k2
    assert close(k2["kappa"], (0.60 - 0.54) / 0.46), k2
    assert close(g2["pa"], 0.60), g2
    assert close(g2["pe"], 0.455), g2
    assert close(g2["ac1"], (0.60 - 0.455) / (1 - 0.455)), g2
    assert g2["ac1"] > k2["kappa"], "AC1 应当缓解基线悖论"

    # 加权 kappa 的核心性质一：观测一致性对「差一级」给部分分，对「差三级」给得更少。
    # 注意不能用两个完全对调的数据集比 kappa——那样两者都是 -1，比不出东西（这一点
    # 本身就说明必须看 po_w 而不是只看最终 kappa）。
    order = URGENCY_ORDER
    near = weighted_kappa(["routine"] * 10 + ["urgent"] * 10,
                          ["urgent"] * 10 + ["routine"] * 10, order, "linear")
    far = weighted_kappa(["monitor"] * 10 + ["emergency"] * 10,
                         ["emergency"] * 10 + ["monitor"] * 10, order, "linear")
    assert near["po_w"] > far["po_w"], (near["po_w"], far["po_w"])
    assert close(near["po_w"], 2.0 / 3.0), near   # 差一级：权重 1 - 1/3
    assert close(far["po_w"], 0.0), far           # 差三级：权重 1 - 3/3 = 0
    # 未加权时这两种情况都是 po=0，完全无法区分——这正是有序变量必须加权的理由
    assert close(cohens_kappa(["routine"] * 10 + ["urgent"] * 10,
                              ["urgent"] * 10 + ["routine"] * 10)["po"], 0.0)

    # 核心性质二：同一数据集上，加权 kappa 应高于未加权，因为差一级不再算全错。
    ord_a = ["monitor"] * 5 + ["routine"] * 5 + ["urgent"] * 5 + ["emergency"] * 5
    ord_b = ["monitor"] * 5 + ["urgent"] * 5 + ["urgent"] * 5 + ["emergency"] * 5
    plain = cohens_kappa(ord_a, ord_b)
    lin = weighted_kappa(ord_a, ord_b, order, "linear")
    quad = weighted_kappa(ord_a, ord_b, order, "quadratic")
    assert close(plain["po"], 0.75), plain
    assert lin["kappa"] > plain["kappa"], (lin["kappa"], plain["kappa"])
    # 二次权重对「只差一级」的惩罚比线性更轻，故 kappa 更高
    assert quad["kappa"] > lin["kappa"], (quad["kappa"], lin["kappa"])

    # 加权 kappa 必须按传入顺序而非字母序处理等级
    assert weighted_kappa(["monitor", "routine"], ["routine", "monitor"], order,
                          "linear")["ordered_categories"] == order
    # 传入未声明的等级必须报错，而不是静默按字母序新建一个类别
    try:
        weighted_kappa(["monitor", "typo_level"], ["monitor", "monitor"], order, "linear")
        raise AssertionError("未声明的等级必须报错")
    except ValueError:
        pass

    # Fleiss：三评价者完全一致
    fk = fleiss_kappa([["a", "a", "a"], ["b", "b", "b"], ["a", "a", "a"]])
    assert close(fk["kappa"], 1.0), fk
    try:
        fleiss_kappa([["a", "a"], ["b"]])
        raise AssertionError("评价者数不等时必须报错")
    except ValueError:
        pass

    # Wilson：0/10 的下界必须是 0，上界必须严格大于 0 且小于 1
    w0 = wilson_interval(0, 10)
    assert close(w0["lower"], 0.0) and 0.0 < w0["upper"] < 1.0, w0
    w10 = wilson_interval(10, 10)
    assert close(w10["upper"], 1.0) and 0.0 < w10["lower"] < 1.0, w10
    # 半数时区间应大致对称于 0.5
    w5 = wilson_interval(5, 10)
    assert close((w5["lower"] + w5["upper"]) / 2, 0.5, 1e-6), w5
    assert w5["numerator"] == 5 and w5["denominator"] == 10, "必须回报分子分母"

    # z 反解校验：95% 对应 1.959963...
    assert close(_z_for_confidence(0.95), 1.959963985, 1e-6), _z_for_confidence(0.95)

    # 聚类 bootstrap：同一动物的 10 张重复图不应被当作 10 个独立样本。
    # 构造 2 只动物、每只 10 张完全一致的标注：簇级重抽样只有 3 种可能结果，
    # 区间必然很宽；若按图片抽样会得到近乎为零宽度的区间。
    items = ([{"animal_id_hash": "A", "a": "+", "b": "+"} for _ in range(10)]
             + [{"animal_id_hash": "B", "a": "+", "b": "-"} for _ in range(10)])

    def agree_rate(sub):
        return sum(1 for i in sub if i["a"] == i["b"]) / len(sub)

    boot = cluster_bootstrap_ci(items, agree_rate, iterations=500, seed=1)
    assert close(boot["point"], 0.5), boot
    assert boot["n_clusters"] == 2 and boot["n_items"] == 20, boot
    assert boot["upper"] - boot["lower"] > 0.4, ("簇级抽样区间应当很宽", boot)
    try:
        cluster_bootstrap_ci([{"a": 1}], agree_rate)
        raise AssertionError("缺少聚类字段时必须报错")
    except ValueError:
        pass

    # McNemar：配对不一致全部偏向一侧
    mc = paired_mcnemar_exact(both=10, only_a=8, only_b=0, neither=2)
    assert mc["p_value"] < 0.01, mc
    assert paired_mcnemar_exact(5, 0, 0, 5)["p_value"] == 1.0

    # 长格式转宽格式：两人成对保留，单人与三人以上必须被显式排除而不是静默丢弃
    long_rows = [
        {"case_id": "C1", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "C1", "annotator_id_hash": "b", "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "C2", "annotator_id_hash": "a", "primary_etiology_label": "Y", "urgency": "urgent"},
        {"case_id": "C2", "annotator_id_hash": "b", "primary_etiology_label": "Z", "urgency": "routine"},
        {"case_id": "C3", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "monitor"},
        {"case_id": "C4", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "monitor"},
        {"case_id": "C4", "annotator_id_hash": "b", "primary_etiology_label": "X", "urgency": "monitor"},
        {"case_id": "C4", "annotator_id_hash": "c", "primary_etiology_label": "X", "urgency": "monitor"},
    ]
    piv = pivot_long_form(long_rows)
    assert piv["n_paired"] == 2, piv
    assert piv["skipped_single_annotator"] == ["C3"], piv
    assert piv["skipped_more_than_two"] == ["C4"], piv
    # 缺 animal_id_hash 时退化为按病例自成一簇，而不是让所有病例挤进同一簇
    assert {p["animal_id_hash"] for p in piv["paired"]} == {"C1", "C2"}, piv

    # ── B15-2（BUG-32）：manifest 强制动物 join ──
    # 母本 + 衍生图同一动物必须合成 1 簇；不同动物 2 簇；
    # missing join / 同例双动物 / 专家与 manifest 矛盾必须阻断；
    # bootstrap 对"每只动物 1 例"的 manifest 结果与旧行为一致。
    import tempfile
    tmpdir2 = tempfile.mkdtemp()

    def write_manifest(name, rows):
        p = os.path.join(tmpdir2, name)
        with open(p, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["case_id", "animal_id_hash", "derivative_group_id"])
            w.writeheader()
            for r in rows:
                w.writerow(r)
        return p

    expert_rows_join = [
        {"case_id": "P1", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "P1", "annotator_id_hash": "b", "primary_etiology_label": "X", "urgency": "routine"},
        # P2/P3 是同一动物 A1 的母本与衍生图 → 必须合成 1 簇
        {"case_id": "P2", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "P2", "annotator_id_hash": "b", "primary_etiology_label": "Y", "urgency": "routine"},
        {"case_id": "P3", "annotator_id_hash": "a", "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "P3", "annotator_id_hash": "b", "primary_etiology_label": "Y", "urgency": "routine"},
    ]
    manifest_ok = write_manifest("m_ok.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": "D1"},
        {"case_id": "P3", "animal_id_hash": "A2", "derivative_group_id": "D1"},
    ])
    piv2 = pivot_long_form(expert_rows_join)
    assert piv2["n_paired"] == 3, piv2
    notes = apply_manifest_join(piv2["paired"], load_animal_manifest(manifest_ok))
    assert notes["joined"] == 3 and notes["cluster_source"] == "manifest", notes
    animals = {p["animal_id_hash"] for p in piv2["paired"]}
    assert animals == {"A1", "A2"}, animals
    assert len(animals) == 2, "母本+衍生图必须同簇"

    # missing join：strict 阻断；allow_case_clusters 显式退化并必须带 development_only 标记
    manifest_missing = write_manifest("m_missing.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
    ])
    try:
        apply_manifest_join(pivot_long_form(expert_rows_join)["paired"],
                            load_animal_manifest(manifest_missing))
        raise AssertionError("missing join 必须阻断")
    except ValueError as e:
        assert "missing join" in str(e), e
    piv3 = pivot_long_form(expert_rows_join)
    notes3 = apply_manifest_join(piv3["paired"], load_animal_manifest(manifest_missing),
                                 allow_case_clusters=True)
    assert notes3["cluster_source"] == "case_level_development_only", notes3
    assert sorted(notes3["fallback_case_clusters"]) == ["P2", "P3"], notes3

    # 同例双动物（manifest 内部矛盾）阻断
    manifest_dup = write_manifest("m_dup.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P1", "animal_id_hash": "A9", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": "D1"},
        {"case_id": "P3", "animal_id_hash": "A2", "derivative_group_id": "D1"},
    ])
    try:
        load_animal_manifest(manifest_dup)
        raise AssertionError("manifest 内同例双动物必须阻断")
    except ValueError as e:
        assert "两个动物" in str(e), e

    # 专家与 manifest 动物矛盾阻断
    conflicting = [
        {"case_id": "P1", "annotator_id_hash": "a", "animal_id_hash": "ZZ",
         "primary_etiology_label": "X", "urgency": "routine"},
        {"case_id": "P1", "annotator_id_hash": "b", "animal_id_hash": "ZZ",
         "primary_etiology_label": "X", "urgency": "routine"},
    ]
    try:
        apply_manifest_join(pivot_long_form(conflicting)["paired"],
                            load_animal_manifest(manifest_ok))
        raise AssertionError("专家与 manifest 动物矛盾必须阻断")
    except ValueError as e:
        assert "矛盾" in str(e), e

    # 每只动物 1 例的 manifest：bootstrap 结果与旧逐侧行为一致（回归护栏）
    rows_1to1 = [{"case_id": "K%d" % i, "annotator_id_hash": "a",
                  "primary_etiology_label": "X" if i % 2 else "Y", "urgency": "routine"}
                 for i in range(10)] + \
                [{"case_id": "K%d" % i, "annotator_id_hash": "b",
                  "primary_etiology_label": "X" if i % 2 else "Y", "urgency": "routine"}
                 for i in range(10)]
    m_1to1 = write_manifest("m_1to1.csv",
                            [{"case_id": "K%d" % i, "animal_id_hash": "AN%d" % i,
                              "derivative_group_id": ""} for i in range(10)])
    piv4 = pivot_long_form(rows_1to1)
    apply_manifest_join(piv4["paired"], load_animal_manifest(m_1to1))

    def kappa_of(sub):
        return float(cohens_kappa([i["primary_etiology_label__a"] for i in sub],
                                  [i["primary_etiology_label__b"] for i in sub])["kappa"])
    boot_manifest = cluster_bootstrap_ci(piv4["paired"], kappa_of, iterations=500, seed=7)
    items_1to1 = [{"animal_id_hash": "AN%d" % i, "a": "X" if i % 2 else "Y",
                   "b": "X" if i % 2 else "Y"} for i in range(10)]
    boot_legacy = cluster_bootstrap_ci(items_1to1, lambda s: 1.0, iterations=500, seed=7)
    assert boot_manifest["n_clusters"] == boot_legacy["n_clusters"] == 10, (
        boot_manifest, boot_legacy)

    print("agreement_stats self-test passed (incl. B15 animal join)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="计算裁决前一致性统计（Cohen's kappa / Gwet's AC1 / 加权 kappa / 聚类 bootstrap）")
    parser.add_argument("csv", nargs="?", help="标注 CSV 路径（省略则只跑自检）")
    parser.add_argument("--self-test", action="store_true", help="只运行自检")
    parser.add_argument("--long-form", action="store_true",
                        help="输入是 expert_annotation_form 长格式（每位标注者一行）")
    parser.add_argument("--cluster-key", default="animal_id_hash")
    parser.add_argument("--manifest",
                        help="B15-2：case_manifest CSV，动物聚类的权威 join；给出后缺失/矛盾阻断")
    parser.add_argument("--allow-case-clusters", action="store_true",
                        help="显式允许退化为病例级聚类；只能标 development_only，正式评分禁止")
    parser.add_argument("--json-out", help="把报告写到此路径")
    args = parser.parse_args()

    if args.self_test or not args.csv:
        _self_test()
        return

    if args.long_form:
        report = score_long_form_csv(args.csv, cluster_key=args.cluster_key,
                                     manifest_path=args.manifest,
                                     allow_case_clusters=args.allow_case_clusters)
    else:
        report = score_annotation_csv(args.csv, cluster_key=args.cluster_key)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("报告已写入 %s" % args.json_out)
    else:
        print(text)


if __name__ == "__main__":
    main()
