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


# --------------------------------------------------------------------------
# B15-1（BUG-31）：预注册 scheduled attempt 记账
# --------------------------------------------------------------------------
#
# 旧 load_runs_from_jsonl 逐行取「最后一条命中记录」，于是：失败尝试消失、
# 重试覆盖首次、末次成功顶掉首轮 A——全部失败与首轮分歧从分母里蒸发。
# 预注册模式下，每次计划尝试（scheduled attempt）先在 manifest 里登记
# （run_id/case_id/branch/stage/scheduled_attempt_id/attempt_index），日志记录
# 按同一五元组对号入座；一致性的主分析只看 **attempt_index=1 的首次尝试**，
# 重试与失败全部保留在执行链里如实报告，绝不择优。

SCHEDULED_MANIFEST_VERSION = "1.0.0"
ATTEMPT_POLICIES = ("first_scheduled", "legacy")

# 计划尝试的五种终态：completed 之外全部是技术性失败，必须保留在分母里
ATTEMPT_TERMINAL = ("completed", "parse_error", "provider_error",
                    "timeout", "schema_error", "missing_record")


def load_scheduled_manifest(path: str) -> dict:
    """读取并校验预注册 manifest。manifest 是唯一分母来源；日志不得自定分母。"""
    with open(path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("manifest_version") != SCHEDULED_MANIFEST_VERSION:
        raise ValueError("scheduled manifest_version 必须是 %s，收到 %r"
                         % (SCHEDULED_MANIFEST_VERSION, manifest.get("manifest_version")))
    entries = manifest.get("scheduled_attempts")
    if not isinstance(entries, list) or not entries:
        raise ValueError("scheduled manifest 缺 scheduled_attempts")
    seen: Counter = Counter()
    for e in entries:
        for key in ("run_id", "case_id", "branch", "stage",
                    "scheduled_attempt_id", "attempt_index"):
            if not e.get(key) and e.get(key) != 0:
                raise ValueError("scheduled attempt 缺字段 %s：%r" % (key, e))
        idx = int(e["attempt_index"])
        if idx < 1:
            raise ValueError("attempt_index 从 1 开始：%r" % e)
        seen[e["scheduled_attempt_id"]] += 1
    dupes = [k for k, n in seen.items() if n > 1]
    if dupes:
        raise ValueError("scheduled_attempt_id 重复：%s" % dupes)
    return manifest


def _extract_field(record: dict, field_path: Sequence[str]) -> Optional[str]:
    node: object = record
    for key in field_path:
        if isinstance(node, dict) and key in node:
            node = node[key]
        else:
            # 分支载荷兼容：记录把分支内容放在 payload 里时从 payload 续走
            payload = record.get("payload") if node is record else None
            if isinstance(payload, dict):
                node = payload
                for key2 in field_path:
                    if isinstance(node, dict) and key2 in node:
                        node = node[key2]
                    else:
                        return None
                break
            return None
    if node is None or isinstance(node, (dict, list)):
        return None
    return str(node)


def load_scheduled_runs(paths: Sequence[str],
                        manifest: dict,
                        field_path: Sequence[str]) -> dict:
    """按预注册 manifest 对号入座地装载运行记录（B15-1）。

    返回视图：
      attempts        — 每个计划尝试一条结果（status/label/attempt_index/source）
      conflicts       — 同一 scheduled_attempt_id 出现多条记录（阻断级）
      unscheduled     — 日志里存在但 manifest 未登记的记录（如实列出，不评分）
      chains          — 按 (branch, case_id, run_id) 的尝试链（按 attempt_index 排序）
      runs_by_branch  — {branch: [run_id...]}
    """
    attempts: Dict[str, dict] = {}
    chains: Dict[tuple, List[dict]] = defaultdict(list)
    conflicts: List[dict] = []
    unscheduled: List[dict] = []

    for entry in manifest["scheduled_attempts"]:
        key = str(entry["scheduled_attempt_id"])
        attempts[key] = {
            "scheduled_attempt_id": key,
            "run_id": str(entry["run_id"]), "case_id": str(entry["case_id"]),
            "branch": str(entry["branch"]), "stage": str(entry["stage"]),
            "attempt_index": int(entry["attempt_index"]),
            "status": "missing_record", "label": None, "source": None,
        }

    for path in paths:
        with open(path, "r", encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    unscheduled.append({"source": "%s:%d" % (path, line_no),
                                        "reason": "bad_json"})
                    continue
                sid = record.get("scheduled_attempt_id")
                if not sid or sid not in attempts:
                    unscheduled.append({"source": "%s:%d" % (path, line_no),
                                        "reason": "not_in_manifest",
                                        "scheduled_attempt_id": sid})
                    continue
                slot = attempts[sid]
                if slot["source"] is not None:
                    conflicts.append({"scheduled_attempt_id": sid,
                                      "first": slot["source"],
                                      "second": "%s:%d" % (path, line_no)})
                    continue
                status = str(record.get("executionStatus") or "").strip()
                label = _extract_field(record, field_path)
                if status and status not in ATTEMPT_TERMINAL:
                    slot["status"] = "parse_error"
                    slot["detail"] = "unknown executionStatus %r" % status
                elif status and status != "completed":
                    slot["status"] = status
                elif label is None:
                    slot["status"] = "missing_field"
                else:
                    slot["status"] = "completed"
                    slot["label"] = label
                slot["source"] = "%s:%d" % (path, line_no)

    for slot in sorted(attempts.values(),
                       key=lambda s: (s["branch"], s["case_id"], s["run_id"],
                                      s["attempt_index"])):
        chains[(slot["branch"], slot["case_id"], slot["run_id"])].append(slot)

    runs_by_branch: Dict[str, List[str]] = defaultdict(list)
    for (_b, _c, run_id) in chains:
        if run_id not in runs_by_branch[_b]:
            runs_by_branch[_b].append(run_id)

    return {
        "attempts": attempts,
        "conflicts": conflicts,
        "unscheduled": unscheduled,
        "chains": chains,
        "runs_by_branch": dict(runs_by_branch),
    }


def first_scheduled_view(view: dict) -> Dict[tuple, dict]:
    """按 first_scheduled 策略取每条执行链的首次预定尝试结果。

    主分析只看 attempt_index=1；重试哪怕成功也不得顶替首次结果。
    返回 {(branch, case_id, run_id): slot}。
    """
    primary: Dict[tuple, dict] = {}
    for key, chain in view["chains"].items():
        ordered = sorted(chain, key=lambda s: s["attempt_index"])
        first = ordered[0]
        if first["attempt_index"] != 1:
            raise ValueError("执行链 %s 缺 attempt_index=1 的首次尝试：%s"
                             % (key, [s["scheduled_attempt_id"] for s in ordered]))
        primary[key] = first
    return primary


def scheduled_consistency_report(manifest: dict, view: dict) -> dict:
    """首次预定尝试口径的一致性报告（B15-1 主分析）。

    - scheduled_cases：预注册分母（与日志成败无关）；
    - conditional：两轮及以上都有有效标签的病例里的完全一致率（旧口径的分母）；
    - end_to_end：全部分母上「所有 run 首次尝试都成功且标签一致」的比例——
      技术失败单列，不伪造疾病预测；
    - always_failed：所有 run 的首次尝试都失败的病例，逐例保留原因；
    - first_attempt_divergences：首次尝试的 A/B 分歧逐例保留（附后续重试链，
      重试信息只陈述不参与计分）。
    """
    primary = first_scheduled_view(view)
    report: dict = {
        "attempt_policy": "first_scheduled",
        "scheduled_case_count": len({e["case_id"] for e in manifest["scheduled_attempts"]}),
        "conflicts": view["conflicts"],
        "unscheduled_records": view["unscheduled"],
        "branches": {},
    }
    for branch, run_ids in sorted(view["runs_by_branch"].items()):
        case_ids = sorted({c for (b, c, r) in view["chains"] if b == branch})
        rows: List[Dict[str, Optional[str]]] = []
        for run in run_ids:
            rows.append({c: primary[(branch, c, run)].get("label")
                         for c in case_ids})
        valid_cases = [c for c in case_ids
                       if all(row.get(c) is not None for row in rows)]
        identical_valid = [c for c in valid_cases
                           if len({row[c] for row in rows}) == 1]
        all_success_identical = [c for c in case_ids
                                 if all(primary[(branch, c, run)]["status"] == "completed"
                                        for run in run_ids)
                                 and len({primary[(branch, c, run)]["label"] for run in run_ids}) == 1]
        always_failed = [c for c in case_ids
                         if all(primary[(branch, c, run)]["status"] != "completed"
                                for run in run_ids)]
        divergences = []
        for c in case_ids:
            labels = [primary[(branch, c, run)].get("label") for run in run_ids]
            if all(lab is not None for lab in labels) and len(set(labels)) > 1:
                divergences.append({
                    "case_id": c,
                    "first_attempt_labels": {run: primary[(branch, c, run)]["label"]
                                             for run in run_ids},
                    "first_attempt_ids": {run: primary[(branch, c, run)]["scheduled_attempt_id"]
                                          for run in run_ids},
                    "retry_chain": [
                        {"run_id": s["run_id"], "attempt_index": s["attempt_index"],
                         "scheduled_attempt_id": s["scheduled_attempt_id"],
                         "status": s["status"], "label": s["label"]}
                        for (b2, c2, r2), chain in view["chains"].items()
                        if b2 == branch and c2 == c
                        for s in sorted(chain, key=lambda x: x["attempt_index"])
                        if s["attempt_index"] > 1
                    ],
                })
        report["branches"][branch] = {
            "run_ids": run_ids,
            "scheduled_cases": len(case_ids),
            "cases_with_valid_labels_in_all_runs": len(valid_cases),
            "conditional_full_consistency": {
                "numerator": len(identical_valid),
                "denominator": len(valid_cases),
            },
            "end_to_end_success_and_identical": {
                "numerator": len(all_success_identical),
                "denominator": len(case_ids),
            },
            "always_failed_cases": [
                {"case_id": c,
                 "first_attempt_status": {run: primary[(branch, c, run)]["status"]
                                          for run in run_ids}}
                for c in always_failed
            ],
            "first_attempt_divergences": divergences,
        }
    return report


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

    # ── B15-1（BUG-31）：预注册首次尝试记账 ──
    # 3 个预定病例：X 两轮全失败；Y run1 首次 A、重试 B，run2 首次 B；Z 两轮首次一致。
    # 旧口径只看「最后命中」会报 2/2=100% 且 X 消失；首次口径必须报
    # scheduled=3、条件一致 1/2、端到端成功且一致 1/3、always_failed=[X]、
    # Y 的 A/B 首轮分歧逐例保留。
    import tempfile

    manifest = {"manifest_version": SCHEDULED_MANIFEST_VERSION,
                "scheduled_attempts": []}
    for case, n_attempts in (("X", 1), ("Y", 2), ("Z", 1)):
        for run in ("run1", "run2"):
            for idx in range(1, n_attempts + 1):
                if case == "X" or idx <= 1 or run == "run1":
                    manifest["scheduled_attempts"].append({
                        "run_id": run, "case_id": case, "branch": "full",
                        "stage": "final",
                        "scheduled_attempt_id": "%s-%s-%d" % (case, run, idx),
                        "attempt_index": idx})

    def rec(run, case, idx, status=None, label=None):
        payload = {"run_id": run, "case_id": case, "branch": "full", "stage": "final",
                   "scheduled_attempt_id": "%s-%s-%d" % (case, run, idx),
                   "attempt_index": idx}
        if status:
            payload["executionStatus"] = status
        if label:
            payload["branches"] = {"full": {"final": {"primaryDiagnosis": label}}}
        return payload

    records = {
        "run1.jsonl": [
            rec("run1", "X", 1, status="provider_error"),
            rec("run1", "Y", 1, label="A"),
            rec("run1", "Y", 2, label="B"),
            rec("run1", "Z", 1, label="甲"),
            # 日志里混入一条 manifest 未登记的记录：如实列出，不评分
            {"run_id": "run1", "case_id": "GHOST", "branch": "full", "stage": "final",
             "scheduled_attempt_id": "ghost-1", "attempt_index": 1,
             "executionStatus": "completed",
             "branches": {"full": {"final": {"primaryDiagnosis": "幽灵"}}}},
        ],
        "run2.jsonl": [
            rec("run2", "X", 1, status="timeout"),
            rec("run2", "Y", 1, label="B"),
            rec("run2", "Z", 1, label="甲"),
        ],
    }
    tmpdir = tempfile.mkdtemp()
    paths = []
    for name, recs in records.items():
        p = os.path.join(tmpdir, name)
        with open(p, "w", encoding="utf-8") as fh:
            for r in recs:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        paths.append(p)

    view = load_scheduled_runs(paths, manifest, ("branches", "full", "final", "primaryDiagnosis"))
    assert view["conflicts"] == [], view["conflicts"]
    assert len(view["unscheduled"]) == 1 and view["unscheduled"][0]["reason"] == "not_in_manifest"
    rep = scheduled_consistency_report(manifest, view)
    full = rep["branches"]["full"]
    assert rep["scheduled_case_count"] == 3, rep["scheduled_case_count"]
    assert full["scheduled_cases"] == 3
    assert full["cases_with_valid_labels_in_all_runs"] == 2, full
    assert full["conditional_full_consistency"] == {"numerator": 1, "denominator": 2}, full
    assert full["end_to_end_success_and_identical"] == {"numerator": 1, "denominator": 3}, full
    assert [c["case_id"] for c in full["always_failed_cases"]] == ["X"], full["always_failed_cases"]
    assert full["always_failed_cases"][0]["first_attempt_status"] == {
        "run1": "provider_error", "run2": "timeout"}
    assert len(full["first_attempt_divergences"]) == 1, full["first_attempt_divergences"]
    div = full["first_attempt_divergences"][0]
    assert div["case_id"] == "Y"
    assert div["first_attempt_labels"] == {"run1": "A", "run2": "B"}, div
    retries = [s for s in div["retry_chain"] if s["run_id"] == "run1"]
    assert retries and retries[0]["label"] == "B" and retries[0]["attempt_index"] == 2, div
    # 重试信息只陈述：哪怕重试与 run2 一致，主分析仍按首次 A/B 报不一致
    assert full["conditional_full_consistency"]["numerator"] == 1

    # 同一 scheduled_attempt_id 出现两条记录 → 冲突阻断
    dup_path = os.path.join(tmpdir, "dup.jsonl")
    with open(dup_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(rec("run1", "Z", 1, label="甲")) + "\n")
        fh.write(json.dumps(rec("run1", "Z", 1, label="乙")) + "\n")
    view2 = load_scheduled_runs([dup_path], manifest,
                                ("branches", "full", "final", "primaryDiagnosis"))
    assert len(view2["conflicts"]) == 1, view2["conflicts"]

    # manifest 校验：版本不符 / 重复 id / 缺字段必须报错
    with open(os.path.join(tmpdir, "m.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)
    loaded = load_scheduled_manifest(os.path.join(tmpdir, "m.json"))
    assert loaded["scheduled_attempts"], loaded
    bad = {"manifest_version": "0.9", "scheduled_attempts": manifest["scheduled_attempts"]}
    with open(os.path.join(tmpdir, "bad.json"), "w", encoding="utf-8") as fh:
        json.dump(bad, fh, ensure_ascii=False)
    try:
        load_scheduled_manifest(os.path.join(tmpdir, "bad.json"))
        raise AssertionError("版本不符必须报错")
    except ValueError:
        pass

    print("repeatability self-test passed (incl. B15 scheduled accounting)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="计算模型重测信度（完全一致率 + 两两 kappa 均值；或 B15 首次尝试记账）")
    parser.add_argument("runs", nargs="*", help="每轮一个 JSONL 运行日志")
    parser.add_argument("--field", default="urgency",
                        help="要评估的字段，支持点号嵌套，如 parsed.urgency")
    parser.add_argument("--ordered", action="store_true",
                        help="按有序等级处理（urgency）并额外给出加权 kappa")
    parser.add_argument("--case-key", default="case_id")
    parser.add_argument("--scheduled-manifest",
                        help="B15-1：预注册 scheduled manifest JSON；给出后按首次预定尝试口径记账")
    parser.add_argument("--attempt-policy", choices=list(ATTEMPT_POLICIES),
                        default="first_scheduled")
    parser.add_argument("--json-out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test or not args.runs:
        _self_test()
        return

    field_path = tuple(args.field.split("."))

    if args.scheduled_manifest:
        # B15-1：预注册模式。分母来自 manifest；冲突阻断；失败与重试全部保留。
        if args.attempt_policy != "first_scheduled":
            parser.error("scheduled 模式当前只支持 --attempt-policy first_scheduled")
        manifest = load_scheduled_manifest(args.scheduled_manifest)
        view = load_scheduled_runs(args.runs, manifest, field_path)
        if view["conflicts"]:
            print("存在重复 scheduled_attempt_id 记录，阻断：", file=sys.stderr)
            for c in view["conflicts"]:
                print("  %s: %s vs %s" % (c["scheduled_attempt_id"], c["first"], c["second"]),
                      file=sys.stderr)
            sys.exit(1)
        report = scheduled_consistency_report(manifest, view)
        report["source_files"] = list(args.runs)
        report["scheduled_manifest"] = args.scheduled_manifest
        text = json.dumps(report, ensure_ascii=False, indent=2)
        if args.json_out:
            with open(args.json_out, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
            print("报告已写入 %s" % args.json_out)
        else:
            print(text)
        return

    if len(args.runs) < 2:
        parser.error("重测信度至少需要两轮日志；单轮无法计算稳定性")

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
