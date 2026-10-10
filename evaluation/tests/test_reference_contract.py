#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_reference_contract.py — B14 参考契约的跨模块验收（零依赖，直接 python 运行）。

覆盖第2轮路线图 B14-1/B14-2/B14-3 验收行：
  - 初筛可答性 schema 与模板一致；终诊（G1/G2 final_label）与初筛 should_abstain 彻底分离；
  - 画质 0/1/2 的任务边界；病族可答/亚型弃答；KB 外参考允许病名照常计分；
  - 排除评价三分类（误杀/正确过滤/无法评定）；完整性模式完整性阻断、草稿模式诚实警告。
真实病例、双专家与裁决仍由 annotation_guide 流程负责——本文件只验协议契约。
"""

from __future__ import annotations

import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "..", "tools")
GOLD = os.path.join(HERE, "..", "reference_data")
sys.path.insert(0, TOOLS)

from validate_annotations import (  # noqa: E402
    Findings, load_screening_schema, validate_manifest, validate_screening_forms,
)
import reference_candidates as rc  # noqa: E402

ontology = rc.load_ontology()
schema = load_screening_schema(os.path.join(GOLD, "screening_task_annotation.schema.json"))
label_map = rc.load_label_map()

PASSED = 0


def ok(name, fn):
    global PASSED
    fn()
    PASSED += 1
    print("  ok %d - %s" % (PASSED, name))


def screening_row(**over):
    base = {
        "case_id": "S1", "input_snapshot_id": "snap-1", "input_sha256": "a" * 8,
        "allowed_input_fields": "images;owner_text;history",
        "screening_timepoint": "intake_photo",
        "task_scope": "image_etiology;image_morphology;history_triage",
        "answerability": "limited", "should_abstain": "1",
        "abstention_scope": "etiology",
        "acceptable_primary_labels": "", "required_coexisting_labels": "",
        "permitted_differentials": "PAR_SARCOPTIC_MANGE",
        "allowable_candidate_granularity": "morphology_only",
        "urgency": "urgent", "recommended_test_scope": "basic_workup",
        "annotator_id_hash": "ann1", "annotation_version": "v1",
        "retainable_candidate_codes": "", "exclusion_evidence": "证据不足待刮片",
    }
    base.update(over)
    return base


# ── 1. schema 与模板一致 ──

def t_schema_template():
    with open(os.path.join(GOLD, schema["file"]), "r", encoding="utf-8-sig", newline="") as fh:
        header = next(csv.reader(fh))
    assert header == list(schema["columns"].keys()), (header, list(schema["columns"].keys()))


ok("screening 模板表头与 schema 逐列一致", t_schema_template)


# ── 2. BUG-30：终诊与初筛分离 ──

def t_bug30_separation():
    f = Findings()
    # G1 终诊已知（manifest）+ 初筛病因应弃答且形态/分诊可答：双表并存合法
    validate_screening_forms([screening_row()], schema, ontology, f, mode="strict")
    assert not f.errors, f.errors
    m = Findings()
    validate_manifest([{
        "case_id": "S1", "animal_id_hash": "A", "split": "evaluation", "gold_tier": "G1",
        "consent_verified": "1", "deidentified_verified": "1",
        "final_label": "INF_DERMATOPHYTOSIS", "final_urgency": "routine",
        "gold_evidence_summary": "培养阳性", "confirmatory_tests": "真菌培养",
        "expert_1_label": "INF_DERMATOPHYTOSIS", "expert_2_label": "INF_DERMATOPHYTOSIS",
    }], m, ontology=ontology, mode="strict")
    assert not m.errors, m.errors
    # 旧 cannot_determine 语义未被改变：专家表里 CANNOT_DETERMINE 仍走终诊口径
    from validate_annotations import validate_expert_forms
    fe = Findings()
    validate_expert_forms([{
        "case_id": "S1", "annotator_id_hash": "a1", "primary_etiology_label": "CANNOT_DETERMINE",
        "urgency": "monitor", "cannot_determine": "1", "cannot_determine_reason": "画质不足",
    }], ontology, fe)
    assert not fe.errors, fe.errors


ok("G1 终诊 + 初筛病因弃答 + 形态/分诊可答 合法并存；旧 cannot_determine 语义未变", t_bug30_separation)


# ── 3. 画质边界（0/1/2） ──

def t_quality_edges():
    # 画质1：image_etiology answerable 阻断
    f1 = Findings()
    validate_screening_forms([screening_row(should_abstain="0", abstention_scope="",
                                            answerability="answerable")],
                             schema, ontology, f1, mode="strict",
                             expert_rows=[{"case_id": "S1", "photo_quality_score": "1"}])
    assert any("画质1" in e["message"] for e in f1.errors)
    # 画质0：图像任务阻断，history_triage 可答合法
    f2 = Findings()
    validate_screening_forms([screening_row(task_scope="history_triage",
                                            answerability="answerable",
                                            should_abstain="0", abstention_scope="")],
                             schema, ontology, f2, mode="strict",
                             expert_rows=[{"case_id": "S1", "photo_quality_score": "0"}])
    assert not f2.errors, f2.errors
    # 画质2：image_etiology answerable 合法
    f3 = Findings()
    validate_screening_forms([screening_row(should_abstain="0", abstention_scope="",
                                            answerability="answerable",
                                            acceptable_primary_labels="INF_DERMATOPHYTOSIS",
                                            allowable_candidate_granularity="etiology")],
                             schema, ontology, f3, mode="strict",
                             expert_rows=[{"case_id": "S1", "photo_quality_score": "2"}])
    assert not f3.errors, f3.errors


ok("画质0/1/2 的初筛任务边界按 R2 执行", t_quality_edges)


# ── 4. 病族可答 / 亚型弃答 ──

def t_family_subtype():
    f = Findings()
    validate_screening_forms([screening_row(allowable_candidate_granularity="family",
                                            abstention_scope="etiology;subtype",
                                            permitted_differentials="PAR_SARCOPTIC_MANGE")],
                             schema, ontology, f, mode="strict")
    assert not f.errors, f.errors


ok("allowable_candidate_granularity=family + subtype 弃答合法（R6）", t_family_subtype)


# ── 5. 参考候选解析与排除评价（B14-2） ──

def t_candidate_resolution():
    # 本体 code 与 KB 卡名两个标签空间
    r1 = rc.resolve_candidate("INF_DERMATOPHYTOSIS", ontology, label_map)
    r2 = rc.resolve_candidate("皮肤癣菌病（犬猫）", ontology, label_map)
    assert r1["namespace"] == "ontology" and r2["namespace"] == "kb_card"
    assert r2["reference_code"] == "INF_DERMATOPHYTOSIS"
    # KB 外参考允许病名：本体 code 无 KB 卡也能解析与计分（不以 69 卡定义正确答案）
    r3 = rc.resolve_candidate("NEO_CUTANEOUS_NEOPLASIA", ontology, label_map)
    assert r3 and r3["namespace"] == "ontology"
    # 未注册标签单列
    r4 = rc.resolve_candidate("未知新概念", ontology, label_map)
    assert r4["namespace"] == "unregistered"


ok("候选标签双空间解析 + KB 外参考概念可解析", t_candidate_resolution)


def t_exclusion_classification():
    # 误杀：参考允许 → 任何理由都是 overkill
    assert rc.evaluate_exclusion("NEO_CUTANEOUS_NEOPLASIA", "low_score_below_gate",
                                 ["NEO_CUTANEOUS_NEOPLASIA"], "犬", ontology, label_map
                                 )["classification"] == rc.OVERKILL
    # 正确过滤：参考外 + 已证实物种不适用
    assert rc.evaluate_exclusion("浅表脓皮病", "species_incompatible", [], "蜥蜴",
                                 ontology, label_map)["classification"] == rc.CORRECT_FILTER
    # 无法评定：缺参考 / 缺物种范围 / 理由未知 —— 评分侧单列，禁止填 0
    for args in [("皮肤癣菌病（犬猫）", "low_score_below_gate", []),
                 ("INF_DERMATOPHYTOSIS", "species_incompatible", []),
                 ("INF_DERMATOPHYTOSIS", "自定义理由", ["INF_DERMATOPHYTOSIS"])]:
        v = rc.evaluate_exclusion(args[0], args[1], args[2], "猫", ontology, label_map)
        assert v["classification"] == rc.NOT_EVALUABLE, (args, v)


ok("排除评价三分类：误杀/正确过滤/无法评定（不填0）", t_exclusion_classification)


# ── 6. 完整性校验 vs 草稿模式 ──

def t_modes():
    row = screening_row(annotator_id_hash="", annotation_version="", input_sha256="")
    ff = Findings()
    validate_screening_forms([row], schema, ontology, ff, mode="strict")
    assert len([e for e in ff.errors if e["rule"] == "标注完整"]) == 3
    fd = Findings()
    validate_screening_forms([row], schema, ontology, fd, mode="draft")
    assert not fd.errors and fd.warnings
    # 空表：not_collected 诚实状态
    fe = Findings()
    validate_screening_forms([], schema, ontology, fe, mode="draft")
    assert not fe.errors and any("not_collected" in w["message"] for w in fe.warnings)
    # manifest strict：不一致缺裁决阻断
    fm = Findings()
    validate_manifest([{
        "case_id": "C2", "animal_id_hash": "B", "split": "evaluation", "gold_tier": "G2",
        "consent_verified": "1", "deidentified_verified": "1",
        "final_label": "PAR_SARCOPTIC_MANGE", "final_urgency": "urgent",
        "gold_evidence_summary": "刮片阳性", "confirmatory_tests": "皮肤刮片",
        "expert_1_label": "PAR_SARCOPTIC_MANGE", "expert_2_label": "INF_DERMATOPHYTOSIS",
    }], fm, ontology=ontology, mode="strict")
    assert any("不一致但 adjudicated_label 为空" in e["message"] for e in fm.errors)


ok("strict 阻断 / draft 诚实警告 / not_collected 不产指标", t_modes)


# ── 7. 幂等性 ──

def t_idempotent():
    rows = [screening_row(), screening_row(case_id="S2", input_snapshot_id="snap-2")]
    a, b = Findings(), Findings()
    validate_screening_forms(rows, schema, ontology, a, mode="strict")
    validate_screening_forms(rows, schema, ontology, b, mode="strict")
    assert [i["rule"] for i in a.items] == [i["rule"] for i in b.items]


ok("同一输入重复校验结果一致（幂等）", t_idempotent)

print("")
print("test_reference_contract: %d 组全部通过" % PASSED)
