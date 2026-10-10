#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""reference_candidates.py — B14-2（BUG-30）：参考候选的独立属性解析与过滤评价契约。

职责：
1. 把候选标签解析为统一属性（病族/亚型/粒度/物种范围），支持两个标签空间：
   - 终诊参考本体 code（label_ontology.json，标注与评分的金标准口径）；
   - 知识卡显示名（retrieval_label_map.json，B02-2 的工程分组口径）。
   两者通过 label_ontology 的 product_kb_name 对照衔接；卡片 id / 模型自造名
   永远不能成为金标准。
2. 给排除规则评价提供分类纯函数（B16 评分器消费）：
   - 参考集合内候选被删 → overkill（误杀）；
   - 参考集合外 + 已证实物种不适用的候选被删 → correct_filter（正确过滤）；
   - 参考集合外且无独立依据 → not_evaluable（评分时单列覆盖，禁止填 0）。

边界：本模块只做契约与分类，不读取任何系统输出；"KB 外但参考允许的病名
不得因此判错"由调用方保证 acceptable 集合来自本体 code，不来自知识卡覆盖。
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ONTOLOGY = os.path.join(HERE, "..", "reference_data", "label_ontology.json")
DEFAULT_LABEL_MAP = os.path.join(HERE, "..", "config", "retrieval_label_map.json")

# 已证实物种限制的排除理由类别（B05 的 SPECIES_RESTRICTIONS 上线后才可使用；
# 在那之前任何 species_incompatible 声明都必须带 review_source，否则不评定）
VALID_EXCLUSION_REASONS = {
    "species_incompatible",   # 候选对主体物种不适用（需已审限制表支持）
    "out_of_task_scope",      # 任务不允许病因命名（按 task_answerability 判）
    "duplicate_of_kept",      # 同族重复候选被合并
    "low_score_below_gate",   # 常规打分/门槛过滤
    "other",
}

# 分类结果
OVERKILL = "overkill"                    # 误杀：参考允许保留的候选被删
CORRECT_FILTER = "correct_filter"        # 正确过滤
NOT_EVALUABLE = "not_evaluable"          # 无法评定（参考缺失或排除依据不足）


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_ontology(path: str = DEFAULT_ONTOLOGY) -> dict:
    return load_json(path)


def load_label_map(path: str = DEFAULT_LABEL_MAP) -> Optional[dict]:
    if not os.path.exists(path):
        return None
    return load_json(path)


def ontology_by_code(ontology: dict) -> Dict[str, dict]:
    out = {entry["code"]: entry for entry in ontology.get("labels", [])}
    out.update({code: {"label_zh": meta.get("label_zh", code), "subtypes": [],
                       "clinical_group": "non_etiologic"}
                for code, meta in ontology.get("non_etiologic_codes", {}).items()})
    return out


def resolve_candidate(label: str,
                      ontology: dict,
                      label_map: Optional[dict]) -> Optional[dict]:
    """把候选标签解析为统一属性；解析不了返回 None（调用方记 unresolved_concept，
    不得盲目硬删——KB 外概念与未知映射必须区分）。"""
    label = (label or "").strip()
    if not label:
        return None
    by_code = ontology_by_code(ontology)
    if label in by_code:
        entry = by_code[label]
        return {
            "namespace": "ontology",
            "label": label,
            "label_zh": entry.get("label_zh", ""),
            "family": entry.get("clinical_group"),       # 粗粒度病族（临床分组）
            "subtype": None,
            "granularity": "etiology",
            "species_scope": None,
            "kb_card_names": _kb_names_for_code(label, ontology, label_map),
        }
    if label_map and label_map.get("labels", {}).get(label):
        entry = label_map["labels"][label]
        return {
            "namespace": "kb_card",
            "label": label,
            "label_zh": label,
            "family": entry.get("family_code"),
            "subtype": entry.get("subtype_code"),
            "granularity": entry.get("target_granularity"),
            "species_scope": entry.get("species_scope") or [],
            "reference_code": entry.get("reference_code"),
        }
    # 未登记标签：单列，不判病错也不猜
    return {"namespace": "unregistered", "label": label, "label_zh": label,
            "family": None, "subtype": None, "granularity": None,
            "species_scope": None}


def _kb_names_for_code(code: str, ontology: dict, label_map: Optional[dict]) -> List[str]:
    """本体 code 对照的知识卡名（仅 product_kb_name 逐字相等的登记）。"""
    entry = next((e for e in ontology.get("labels", []) if e["code"] == code), None)
    if not entry:
        return []
    name = entry.get("product_kb_name") or ""
    if not name:
        return []
    if label_map and label_map.get("labels", {}).get(name):
        return [name]
    return []


def species_compatible(resolved: dict, species: str) -> Optional[bool]:
    """候选解析自带物种范围时判断兼容性；无范围信息返回 None（不猜测）。"""
    scope = (resolved or {}).get("species_scope")
    if not scope or not species:
        return None
    return species in scope


def evaluate_exclusion(candidate_label: str,
                       exclusion_reason: str,
                       reference_allowed_codes: List[str],
                       case_species: str = "",
                       ontology: Optional[dict] = None,
                       label_map: Optional[dict] = None) -> dict:
    """排除规则评价分类（B14-2/B16 共用契约）。

    reference_allowed_codes：人工盲法基于允许输入填写的 retainable/acceptable
    本体 code 集合（含通过 product_kb_name 对照到卡片名的 code）。
    """
    ontology = ontology if ontology is not None else load_ontology()
    reason = (exclusion_reason or "").strip()
    if reason and reason not in VALID_EXCLUSION_REASONS:
        return {"classification": NOT_EVALUABLE,
                "reason": "unknown_exclusion_reason",
                "detail": reason}

    resolved = resolve_candidate(candidate_label, ontology, label_map)
    if resolved is None:
        return {"classification": NOT_EVALUABLE, "reason": "unresolved_candidate"}

    # 参考对照：候选的 KB 卡名 → reference_code，或候选本身就是本体 code
    refs = set(reference_allowed_codes or [])
    matched_ref = None
    if resolved["namespace"] == "ontology" and resolved["label"] in refs:
        matched_ref = resolved["label"]
    elif resolved["namespace"] == "kb_card" and resolved.get("reference_code") in refs:
        matched_ref = resolved["reference_code"]

    if matched_ref is not None:
        # 参考允许保留的候选被删：一律误杀（物种限制也不能推翻独立参考）
        return {"classification": OVERKILL, "reason": reason or "unspecified",
                "matched_reference": matched_ref}

    # 参考未收录：只有"已证实物种不适用"且候选解析确含物种范围且不兼容时，才计正确过滤
    if reason == "species_incompatible":
        compat = species_compatible(resolved, case_species)
        if compat is False:
            return {"classification": CORRECT_FILTER, "reason": reason}
        if compat is None:
            return {"classification": NOT_EVALUABLE,
                    "reason": "species_scope_unavailable"}
        return {"classification": NOT_EVALUABLE, "reason": "species_scope_contradicts"}

    return {"classification": NOT_EVALUABLE, "reason": "no_reference_support"}


def _self_test() -> None:
    ontology = load_ontology()
    label_map = load_label_map()

    # 本体 code 解析
    r = resolve_candidate("INF_DERMATOPHYTOSIS", ontology, label_map)
    assert r and r["namespace"] == "ontology" and r["family"] == "infectious_or_parasitic"
    assert "皮肤癣菌病（犬猫）" in r["kb_card_names"]

    # KB 卡名解析（B02 映射）
    r2 = resolve_candidate("皮肤癣菌病（犬猫）", ontology, label_map)
    assert r2 and r2["namespace"] == "kb_card" and r2["family"] == "dermatophytosis"
    assert r2.get("reference_code") == "INF_DERMATOPHYTOSIS"

    # 未登记标签单列，不判错
    r3 = resolve_candidate("模型给出的KB外新病", ontology, label_map)
    assert r3 and r3["namespace"] == "unregistered" and r3["family"] is None

    # 误杀：参考允许的候选被任何理由删除
    v = evaluate_exclusion("INF_DERMATOPHYTOSIS", "low_score_below_gate",
                           ["INF_DERMATOPHYTOSIS"], "猫", ontology, label_map)
    assert v["classification"] == OVERKILL, v
    # 即使物种范围矛盾，参考优先
    v2 = evaluate_exclusion("INF_DERMATOPHYTOSIS", "species_incompatible",
                            ["INF_DERMATOPHYTOSIS"], "猫", ontology, label_map)
    assert v2["classification"] == OVERKILL, v2

    # 正确过滤：参考外 + 已证实物种不适用（候选解析必须自带物种范围）
    v3 = evaluate_exclusion("浅表脓皮病", "species_incompatible", [], "蜥蜴",
                            ontology, label_map)
    assert v3["classification"] == CORRECT_FILTER, v3
    # 物种范围信息缺失 → 不评定，禁止当作正确过滤填 0
    v4 = evaluate_exclusion("INF_DERMATOPHYTOSIS", "species_incompatible", [], "猫",
                            ontology, label_map)
    assert v4["classification"] == NOT_EVALUABLE, v4
    # 兼容物种却声称不适用 → 矛盾，不评定
    v5 = evaluate_exclusion("浅表脓皮病", "species_incompatible", [], "犬",
                            ontology, label_map)
    assert v5["classification"] == NOT_EVALUABLE, v5

    # 无参考支持的低分排除 → 不评定（不是正确也不是误杀）
    v6 = evaluate_exclusion("皮肤癣菌病（犬猫）", "low_score_below_gate", [], "猫",
                            ontology, label_map)
    assert v6["classification"] == NOT_EVALUABLE, v6

    # 未知排除理由 → 不评定
    v7 = evaluate_exclusion("INF_DERMATOPHYTOSIS", "模型说不像", ["INF_DERMATOPHYTOSIS"],
                            "猫", ontology, label_map)
    assert v7["classification"] == NOT_EVALUABLE and v7["reason"] == "unknown_exclusion_reason"

    print("reference_candidates self-test passed")


if __name__ == "__main__":
    _self_test()
