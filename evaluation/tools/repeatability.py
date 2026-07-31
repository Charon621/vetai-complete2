#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重测信度（intra-model consistency）评估。

复现 Kocaman et al. 2026（The Veterinary Journal 317:106611）的模型内稳定性
测试：同一批图片在完全相同的输入条件下重复评估 N 次，报告

1. 完全一致率——N 次输出对同一病例给出完全相同标签的病例比例；
2. 两两 Cohen's kappa 的均值——论文用它作为模型内部信度的汇总统计量。

为什么这件事必须单独测（论文 Discussion 的核心论点）：与专家的一致性高
并不代表临床可用。一个模型可以平均而言接近专家，但同一张图问三次给三个
答案——这种系统无法用于需要可追溯记录的诊疗场景。论文中 ChatGPT-5.1
Thinking 与专家的 kappa 在部分体征上最高，但完全一致率只有 30%，是全部
四个模型里最低的；这正是「只报准确率会误导」的实例。

与论文的差异（必须在方法学里如实写明，不能声称完全复现）：
- 论文通过网页界面评估，无法控制采样参数；本工具走 API，可固定 temperature
  与 seed。因此本工具测出的稳定性通常优于论文，两者不可直接比较。
- 论文用 gingivitis 单一体征作为索引指标；本工具支持多字段同时评估。

本工具只做统计，不产生标签。它读取已经跑好的多轮运行结果，
不会替代人工标注，也不能把模型自己的输出当作参考标准。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from itertools import combinations
from typing import Dict, Hashable, List, Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agreement_stats import (  # noqa: E402
    cohens_kappa,
    gwets_ac1,
    interpret_kappa,
    weighted_kappa,
    wilson_interval,
)

URGENCY_ORDER = ["low", "moderate", "urgent", "emergency"]


def full_consistency_rate(runs: Sequence[Dict[Hashable, Hashable]],
                          confidence: float = 0.95) -> Dict[str, object]:
    """完全一致率：所有轮次对同一病例给出相同标签的病例比例（附 Wilson 区间）。

    只统计在全部轮次里都出现的病例；某轮缺失的病例会被排除并单独报告，
    因为把「这轮请求失败」当成「不一致」会低估稳定性，反之则高估。
    """
    if len(runs) < 2:
        raise ValueError("重测信度至少需要两轮结果")

    common = set(runs[0].keys())
    for r in runs[1:]:
        common &= set(r.keys())
    all_ids = set()
    for r in runs:
        all_ids |= set(r.keys())
    missing = sorted(map(str, all_ids - common))

    if not common:
        return {"metric": "full_consistency_rate", "status": "no_common_cases",
                "n_runs": len(runs), "excluded_incomplete": missing}

    ordered = sorted(common, key=lambda v: str(v))
    identical = sum(1 for cid in ordered
                    if len({r[cid] for r in runs}) == 1)
    result = wilson_interval(identical, len(ordered), confidence)
    result.update({
        "metric": "full_consistency_rate",
        "n_runs": len(runs),
        "n_cases_scored": len(ordered),
        "excluded_incomplete": missing,
        "excluded_count": len(missing),
    })
    return result


def mean_pairwise_kappa(runs: Sequence[Dict[Hashable, Hashable]],
                        ordered_categories: Optional[Sequence[str]] = None) -> Dict[str, object]:
    """两两 Cohen's kappa 的均值（论文的汇总统计量）。

    ordered_categories 非空时额外给出加权 kappa 的均值，用于 urgency 这类
    有序字段——把 low/emergency 的分歧和 low/moderate 的分歧同等对待会
    严重高估不稳定程度。

    退化轮次对（某轮把所有病例标成同一类，导致 pe=1、kappa 无定义）会被
    跳过并计数，而不是当作 0 计入均值——当作 0 会把「无法计算」误报成
    「完全不一致」。
    """
    if len(runs) < 2:
        raise ValueError("重测信度至少需要两轮结果")

    common = set(runs[0].keys())
    for r in runs[1:]:
        common &= set(r.keys())
    if not common:
        return {"metric": "mean_pairwise_kappa", "status": "no_common_cases"}

    ordered = sorted(common, key=lambda v: str(v))
    pairs: List[Dict[str, object]] = []
    degenerate = 0

    for i, j in combinations(range(len(runs)), 2):
        a = [runs[i][c] for c in ordered]
        b = [runs[j][c] for c in ordered]
        res = cohens_kappa(a, b)
        entry: Dict[str, object] = {
            "run_pair": "run%d_vs_run%d" % (i + 1, j + 1),
            "kappa": res["kappa"],
            "po": res["po"],
            "degenerate": res["degenerate"],
        }
        if res["degenerate"]:
            degenerate += 1
        if ordered_categories:
            known = set(ordered_categories)
            if set(a) <= known and set(b) <= known:
                wk = weighted_kappa(a, b, list(ordered_categories), "linear")
                entry["weighted_kappa_linear"] = wk["kappa"]
        pairs.append(entry)

    valid = [p["kappa"] for p in pairs if not p["degenerate"]]
    weighted_vals = [p["weighted_kappa_linear"] for p in pairs
                     if "weighted_kappa_linear" in p and not p["degenerate"]]

    out: Dict[str, object] = {
        "metric": "mean_pairwise_kappa",
        "n_runs": len(runs),
        "n_cases_scored": len(ordered),
        "pairs": pairs,
        "degenerate_pairs": degenerate,
        "mean_kappa": (sum(valid) / len(valid)) if valid else float("nan"),
    }
    if valid:
        out["strength"] = interpret_kappa(out["mean_kappa"])
        out["min_kappa"] = min(valid)
        out["max_kappa"] = max(valid)
    if weighted_vals:
        out["mean_weighted_kappa_linear"] = sum(weighted_vals) / len(weighted_vals)
    return out


def flip_profile(runs: Sequence[Dict[Hashable, Hashable]]) -> Dict[str, object]:
    """哪些病例在轮次间摇摆，摇摆在哪两个标签之间。

    完全一致率只给一个总数，看不出问题集中在哪。这个视图直接指向 prompt
    需要改的地方：如果不稳定集中在某两个标签之间，通常说明 prompt 对这两
    类的判定边界没写清楚，而不是模型「随机」。
    """
    if len(runs) < 2:
        raise ValueError("至少需要两轮结果")
    common = set(runs[0].keys())
    for r in runs[1:]:
        common &= set(r.keys())

    unstable = []
    transition_counter: Counter = Counter()
    for cid in sorted(common, key=lambda v: str(v)):
        labels = [r[cid] for r in runs]
        distinct = sorted({str(x) for x in labels})
        if len(distinct) > 1:
            unstable.append({"case_id": str(cid),
                             "labels_by_run": [str(x) for x in labels],
                             "distinct": distinct})
            transition_counter["<->".join(distinct)] += 1

    return {
        "metric": "flip_profile",
        "n_cases_scored": len(common),
        "n_unstable": len(unstable),
        "unstable_cases": unstable,
        "most_common_flips": transition_counter.most_common(10),
    }


def evaluate_field(runs: Sequence[Dict[Hashable, Hashable]],
                   field_name: str,
                   ordered_categories: Optional[Sequence[str]] = None) -> Dict[str, object]:
    """对单个字段给出完整的重测信度报告。"""
    report: Dict[str, object] = {
        "field": field_name,
        "full_consistency": full_consistency_rate(runs),
        "pairwise_kappa": mean_pairwise_kappa(runs, ordered_categories),
        "flips": flip_profile(runs),
    }
    common = set(runs[0].keys())
    for r in runs[1:]:
        common &= set(r.keys())
    if common:
        ordered = sorted(common, key=lambda v: str(v))
        # 也给出 AC1：若某标签占绝对多数，kappa 会被基线悖论压低，
        # 单看 kappa 会把「稳定但类别不平衡」误判成「不稳定」。
        report["pairwise_ac1_first_pair"] = gwets_ac1(
            [runs[0][c] for c in ordered], [runs[1][c] for c in ordered])
        report["label_distribution_by_run"] = [
            dict(Counter(str(r[c]) for c in ordered)) for r in runs
        ]
    return report


# --------------------------------------------------------------------------
# 从运行日志读取
# --------------------------------------------------------------------------

def load_runs_from_jsonl(paths: Sequence[str],
                         field_path: Sequence[str],
                         case_key: str = "case_id") -> List[Dict[str, str]]:
    """从多个 JSONL 运行日志里抽取同一字段，每个文件是一轮。

    field_path 是嵌套路径，例如 ("parsed", "urgency")。
    缺字段或解析失败的记录会被跳过（不构造默认值）——凭空补一个默认标签
    会把失败伪装成一致，是重测信度里最容易犯的错。
    """
    runs: List[Dict[str, str]] = []
    for path in paths:
        mapping: Dict[str, str] = {}
        with open(path, "r", encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    print("  跳过 %s 第 %d 行：不是合法 JSON" % (path, line_no), file=sys.stderr)
                    continue
                case_id = record.get(case_key)
                if case_id is None:
                    continue
                node = record
                ok = True
                for key in field_path:
                    if isinstance(node, dict) and key in node:
                        node = node[key]
                    else:
                        ok = False
                        break
                if ok and node is not None:
                    mapping[str(case_id)] = str(node)
        runs.append(mapping)
    return runs


def _self_test() -> None:
    # 完全稳定：3 轮完全一致
    stable = [{"c1": "present", "c2": "absent", "c3": "present"} for _ in range(3)]
    fc = full_consistency_rate(stable)
    assert fc["point"] == 1.0, fc
    assert fc["numerator"] == 3 and fc["denominator"] == 3, fc
    pk = mean_pairwise_kappa(stable)
    assert abs(pk["mean_kappa"] - 1.0) < 1e-9, pk
    assert len(pk["pairs"]) == 3, pk        # C(3,2) = 3 对
    assert flip_profile(stable)["n_unstable"] == 0

    # 部分摇摆：c2 在三轮里给了两种答案 -> 完全一致率 2/3
    wobbly = [
        {"c1": "present", "c2": "absent", "c3": "present"},
        {"c1": "present", "c2": "present", "c3": "present"},
        {"c1": "present", "c2": "absent", "c3": "present"},
    ]
    fc2 = full_consistency_rate(wobbly)
    assert fc2["numerator"] == 2 and fc2["denominator"] == 3, fc2
    fp = flip_profile(wobbly)
    assert fp["n_unstable"] == 1 and fp["unstable_cases"][0]["case_id"] == "c2", fp
    assert fp["most_common_flips"][0][0] == "absent<->present", fp

    # 缺失病例必须被排除并报告，而不是当作不一致
    partial = [
        {"c1": "a", "c2": "b"},
        {"c1": "a"},
    ]
    fc3 = full_consistency_rate(partial)
    assert fc3["n_cases_scored"] == 1, fc3
    assert fc3["excluded_incomplete"] == ["c2"], fc3
    assert fc3["point"] == 1.0, fc3

    # 退化轮次对：两轮都把所有病例标成同一类 -> kappa 无定义，必须跳过不计入均值
    degen = [{"c1": "x", "c2": "x"}, {"c1": "x", "c2": "x"}]
    pk2 = mean_pairwise_kappa(degen)
    assert pk2["degenerate_pairs"] == 1, pk2
    import math
    assert math.isnan(pk2["mean_kappa"]), pk2
    # 但完全一致率仍应是 100%——两个指标回答的是不同问题
    assert full_consistency_rate(degen)["point"] == 1.0

    # 有序字段：摇摆幅度必须影响结论。两组的未加权 kappa 完全相同（都是差 5 个病例），
    # 只有加权 kappa 能区分「low<->moderate 的轻微摇摆」和「low<->emergency 的严重摇摆」。
    # 两轮都必须含多个类别，否则边际退化会让 kappa 恒为 0，测不出差异。
    base = {"c%d" % i: "urgent" for i in range(5)}
    near_run1 = dict(base, **{"c%d" % i: "low" for i in range(5, 10)})
    near_run2 = dict(base, **{"c%d" % i: "moderate" for i in range(5, 10)})
    far_run2 = dict(base, **{"c%d" % i: "emergency" for i in range(5, 10)})

    nk = mean_pairwise_kappa([near_run1, near_run2], URGENCY_ORDER)
    fk = mean_pairwise_kappa([near_run1, far_run2], URGENCY_ORDER)
    # 未加权时两组无法区分
    assert abs(nk["mean_kappa"] - fk["mean_kappa"]) < 1e-9, (nk["mean_kappa"], fk["mean_kappa"])
    # 加权后差一级明显优于差三级
    assert "mean_weighted_kappa_linear" in nk, nk
    assert abs(nk["mean_weighted_kappa_linear"] - 0.5) < 1e-9, nk
    assert abs(fk["mean_weighted_kappa_linear"] - 0.0) < 1e-9, fk
    assert nk["mean_weighted_kappa_linear"] > fk["mean_weighted_kappa_linear"], (nk, fk)

    # 未在有序表中声明的标签不应让整个报告崩溃，只是拿不到加权 kappa
    odd = [{"c1": "low", "c2": "typo"}, {"c1": "low", "c2": "moderate"}]
    ok_report = mean_pairwise_kappa(odd, URGENCY_ORDER)
    assert "mean_weighted_kappa_linear" not in ok_report, ok_report

    try:
        full_consistency_rate([{"c1": "a"}])
        raise AssertionError("单轮结果必须报错")
    except ValueError:
        pass

    print("repeatability self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="计算模型重测信度（完全一致率 + 两两 kappa 均值）")
    parser.add_argument("runs", nargs="*", help="每轮一个 JSONL 运行日志")
    parser.add_argument("--field", default="urgency",
                        help="要评估的字段，支持点号嵌套，如 parsed.urgency")
    parser.add_argument("--ordered", action="store_true",
                        help="按有序等级处理（urgency）并额外给出加权 kappa")
    parser.add_argument("--case-key", default="case_id")
    parser.add_argument("--json-out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test or not args.runs:
        _self_test()
        return

    if len(args.runs) < 2:
        parser.error("重测信度至少需要两轮日志；单轮无法计算稳定性")

    field_path = tuple(args.field.split("."))
    runs = load_runs_from_jsonl(args.runs, field_path, args.case_key)
    empty = [p for p, r in zip(args.runs, runs) if not r]
    if empty:
        parser.error("以下日志没有抽到任何 %s 字段：%s" % (args.field, empty))

    report = evaluate_field(runs, args.field,
                            URGENCY_ORDER if args.ordered else None)
    report["source_files"] = list(args.runs)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("报告已写入 %s" % args.json_out)
    else:
        print(text)


if __name__ == "__main__":
    main()
