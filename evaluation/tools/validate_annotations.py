#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""标注表校验器。

在计算任何统计量之前先跑这个。它检查的是「协议是否被遵守」，
而不是「标签是否正确」——后者只能由专家判断。

校验项对应 annotation_guide 的硬性要求：
- §7  primary_etiology_label 必须是 label_ontology.json 里的 code，不能是自由文本；
- §7  urgency 必须是声明的四个有序等级之一；photo_quality_score 必须是 0/1/2；
- §6  两名专家必须独立提交；同一 (case_id, annotator) 不得重复；
- §6  不得出现「两位专家 ID 相同」这种伪独立标注；
- §8  划分单位是动物：同一 animal_id_hash 不得跨 split；
- §2  DEV_ONLY 素材不能标记为临床参考已审核；
- §5  证据包不完整或命中排除条件的病例必须标 EXCLUDED / CANNOT_DETERMINE。

退出码：0 全部通过；1 有阻断性错误；无错误但有警告时仍返回 0。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ONTOLOGY = os.path.join(HERE, "..", "reference_data", "label_ontology.json")
DEFAULT_SCREENING_SCHEMA = os.path.join(HERE, "..", "reference_data",
                                        "screening_task_annotation.schema.json")

BLOCKING = "ERROR"
WARNING = "WARN"


class Findings:
    def __init__(self) -> None:
        self.items: List[Dict[str, str]] = []

    def add(self, level: str, rule: str, message: str, where: str = "") -> None:
        self.items.append({"level": level, "rule": rule, "message": message, "where": where})

    @property
    def errors(self) -> List[Dict[str, str]]:
        return [i for i in self.items if i["level"] == BLOCKING]

    @property
    def warnings(self) -> List[Dict[str, str]]:
        return [i for i in self.items if i["level"] == WARNING]


def load_ontology(path: str) -> Dict[str, object]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def valid_codes(ontology: Dict[str, object]) -> Set[str]:
    codes = {entry["code"] for entry in ontology.get("labels", [])}
    codes |= set(ontology.get("non_etiologic_codes", {}).keys())
    return codes


def read_csv(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _split_multi(value: str) -> List[str]:
    """次要标签列支持用分号或竖线分隔。"""
    if not value:
        return []
    raw = value.replace("|", ";").split(";")
    return [x.strip() for x in raw if x.strip()]


def validate_expert_forms(rows: List[Dict[str, str]],
                          ontology: Dict[str, object],
                          findings: Findings) -> None:
    codes = valid_codes(ontology)
    urgency_levels = set(ontology.get("urgency_ordered_levels", []))
    quality_levels = set(ontology.get("photo_quality_levels", {}).keys())

    if not rows:
        findings.add(WARNING, "empty",
                     "标注表没有数据行。尚未收集标注时这是正常状态，不是错误。")
        return

    seen_pairs: Counter = Counter()
    per_case_annotators: Dict[str, Set[str]] = defaultdict(set)

    for idx, row in enumerate(rows, start=2):
        where = "第 %d 行" % idx
        case_id = (row.get("case_id") or "").strip()
        annotator = (row.get("annotator_id_hash") or "").strip()

        if not case_id:
            findings.add(BLOCKING, "§7 case_id", "case_id 为空", where)
            continue
        if not annotator:
            findings.add(BLOCKING, "§6 annotator", "annotator_id_hash 为空，无法判断独立性", where)
            continue

        seen_pairs[(case_id, annotator)] += 1
        per_case_annotators[case_id].add(annotator)

        label = (row.get("primary_etiology_label") or "").strip()
        cannot = (row.get("cannot_determine") or "").strip().lower() in {"1", "true", "yes", "y"}

        if not label:
            findings.add(BLOCKING, "§7 受控标签",
                         "primary_etiology_label 为空；无法确定时应填 CANNOT_DETERMINE", where)
        elif label not in codes:
            findings.add(BLOCKING, "§7 受控标签",
                         "primary_etiology_label='%s' 不在 label_ontology.json 中。"
                         "自由文本不得作为主标签。" % label, where)

        if cannot and label not in {"CANNOT_DETERMINE", "EXCLUDED"}:
            findings.add(BLOCKING, "§5 一致性",
                         "cannot_determine 为真但主标签是 '%s'；两者必须一致" % label, where)
        if label == "CANNOT_DETERMINE" and not (row.get("cannot_determine_reason") or "").strip():
            findings.add(BLOCKING, "§5 排除理由",
                         "标为 CANNOT_DETERMINE 必须写 cannot_determine_reason", where)

        for sec in _split_multi(row.get("acceptable_secondary_labels") or ""):
            if sec not in codes:
                findings.add(BLOCKING, "§7 受控标签",
                             "次要标签 '%s' 不在本体中" % sec, where)
            elif sec == label:
                findings.add(WARNING, "§7 冗余",
                             "次要标签与主标签重复：%s" % sec, where)

        tier = (row.get("gold_tier") or "").strip()
        if label not in {"CANNOT_DETERMINE", "EXCLUDED"}:
            if tier not in {"G1", "G2", "G3"}:
                findings.add(BLOCKING, "§2 层级",
                             "gold_tier='%s' 必须是 G1/G2/G3 之一" % tier, where)
            elif tier in {"G1", "G2"} and not (row.get("confirmatory_evidence_cited") or "").strip():
                findings.add(BLOCKING, "§3 证据路径",
                             "定为 %s 必须在 confirmatory_evidence_cited 写出确认证据；"
                             "只有图片时应定 G3" % tier, where)
            if tier == "G3":
                findings.add(WARNING, "§2 层级用途",
                             "G3 不进入病因准确率主分析，只能用于形态/画质/拒答子任务", where)
            if not (row.get("gold_tier_justification") or "").strip():
                findings.add(WARNING, "§2 层级",
                             "建议填写 gold_tier_justification 说明为何定该层级", where)

        urgency = (row.get("urgency") or "").strip()
        if not urgency:
            findings.add(BLOCKING, "§7 紧急度", "urgency 为空", where)
        elif urgency not in urgency_levels:
            findings.add(BLOCKING, "§7 紧急度",
                         "urgency='%s' 不在有序等级 %s 中。注意参考标准用 monitor/routine/"
                         "urgent/emergency，与产品输出的 low/... 不是同一套。"
                         % (urgency, sorted(urgency_levels)), where)

        quality = (row.get("photo_quality_score") or "").strip()
        if quality and quality not in quality_levels:
            findings.add(BLOCKING, "§7 画质",
                         "photo_quality_score='%s' 必须是 %s 之一"
                         % (quality, sorted(quality_levels)), where)
        if quality == "0" and label not in {"CANNOT_DETERMINE", "EXCLUDED"} and tier != "G3":
            findings.add(WARNING, "§9 拒答子任务",
                         "画质 0 的病例通常只能支撑拒答/重拍评价，给出病因标签需说明依据", where)

        certainty = (row.get("subjective_certainty_0_100") or "").strip()
        if certainty:
            try:
                value = float(certainty)
                if not 0 <= value <= 100:
                    raise ValueError
            except ValueError:
                findings.add(BLOCKING, "§6 把握度",
                             "subjective_certainty_0_100='%s' 必须是 0-100 的数值" % certainty, where)

        high_risk = (row.get("high_risk_flag") or "").strip().lower() in {"1", "true", "yes", "y"}
        if high_risk and not (row.get("high_risk_reason") or "").strip():
            findings.add(BLOCKING, "§7 高风险",
                         "high_risk_flag 为真必须写 high_risk_reason", where)

        if (row.get("evidence_package_complete") or "").strip().lower() in {"0", "false", "no", "n"}:
            if label not in {"CANNOT_DETERMINE", "EXCLUDED"}:
                findings.add(BLOCKING, "§5 纳排",
                             "证据包不完整的病例不得给出病因标签，应标 EXCLUDED", where)

    for (case_id, annotator), count in seen_pairs.items():
        if count > 1:
            findings.add(BLOCKING, "§6 重复提交",
                         "case %s 的标注者 %s 提交了 %d 次；每人每例只应有一份锁定标注"
                         % (case_id, annotator[:8], count))

    for case_id, annotators in sorted(per_case_annotators.items()):
        if len(annotators) < 2:
            findings.add(WARNING, "§6 双专家",
                         "case %s 目前只有 %d 名标注者；最终参考标准需两名独立专家"
                         % (case_id, len(annotators)))


def validate_manifest(rows: List[Dict[str, str]], findings: Findings,
                      ontology: Optional[Dict[str, object]] = None,
                      mode: str = "draft") -> None:
    """检查 case_manifest 的泄漏控制与层级规则。

    mode='strict'（BUG-33/B14-3）：终诊完整性字段逐项强制——final_label/final_urgency
    必填且在本体/有序等级内；G1/G2 必须有 gold_evidence_summary 与 confirmatory_tests；
    两专家不一致而裁决缺失即阻断；裁决者不得是原专家。draft 模式这些缺项降为警告，
    保持草稿可流转。"""
    codes = valid_codes(ontology) if ontology else None
    urgency_levels = set(ontology.get("urgency_ordered_levels", [])) if ontology else set()
    if not rows:
        findings.add(WARNING, "empty", "case_manifest 没有数据行（尚未收集病例）")
        return

    animal_splits: Dict[str, Set[str]] = defaultdict(set)
    group_splits: Dict[str, Set[str]] = defaultdict(set)
    seen_cases: Counter = Counter()
    animal_cases: Dict[str, Set[str]] = defaultdict(set)

    for idx, row in enumerate(rows, start=2):
        where = "第 %d 行" % idx
        case_id = (row.get("case_id") or "").strip()
        animal = (row.get("animal_id_hash") or "").strip()
        split = (row.get("split") or "").strip()
        tier = (row.get("gold_tier") or "").strip()
        group = (row.get("derivative_group_id") or "").strip()

        if not case_id:
            findings.add(BLOCKING, "§5 追溯", "case_id 为空", where)
            continue
        seen_cases[case_id] += 1

        if not animal:
            findings.add(BLOCKING, "§8 泄漏控制",
                         "animal_id_hash 为空；划分单位是动物而不是图片", where)
        else:
            if split:
                animal_splits[animal].add(split)
            animal_cases[animal].add(case_id)
        if group and split:
            group_splits[group].add(split)

        if tier == "DEV_ONLY" and row.get("gold_status") == "reviewed":
            findings.add(BLOCKING, "§2 DEV_ONLY",
                         "DEV_ONLY 素材不得标记为临床参考已审核", where)

        # ── B14-3（BUG-33）：终诊完整性字段完整性 ──
        final_label = (row.get("final_label") or "").strip()
        final_urgency = (row.get("final_urgency") or "").strip()
        if not final_label:
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "§4 终诊完整性" if mode == "strict" else "§4 终诊草稿",
                         "final_label 缺失；评分导出必须含逐例终诊主标签", where)
        elif codes is not None and final_label not in codes:
            findings.add(BLOCKING, "§4 终诊完整性",
                         "final_label='%s' 不在 label_ontology.json 中" % final_label, where)
        if final_label in {"CANNOT_DETERMINE", "EXCLUDED"} and not (row.get("exclusion_reason") or "").strip() \
                and final_label == "EXCLUDED":
            findings.add(BLOCKING, "§4 终诊完整性", "final_label=EXCLUDED 必须写 exclusion_reason", where)
        if not final_urgency:
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "§4 终诊完整性" if mode == "strict" else "§4 终诊草稿",
                         "final_urgency 缺失", where)
        elif final_urgency and urgency_levels and final_urgency not in urgency_levels:
            findings.add(BLOCKING, "§4 终诊完整性",
                         "final_urgency='%s' 不在有序等级中" % final_urgency, where)
        if tier in {"G1", "G2"}:
            evidence = (row.get("gold_evidence_summary") or "").strip()
            tests = (row.get("confirmatory_tests") or "").strip()
            if not evidence:
                findings.add(BLOCKING if mode == "strict" else WARNING,
                             "§3 证据" if mode == "strict" else "§3 证据草稿",
                             "%s 病例缺 gold_evidence_summary" % tier, where)
            if not tests:
                findings.add(BLOCKING if mode == "strict" else WARNING,
                             "§3 证据" if mode == "strict" else "§3 证据草稿",
                             "%s 病例缺 confirmatory_tests" % tier, where)

        # 两专家不一致而裁决缺失：缺项阻断；裁决者不得是原专家（manifest 内含专家 ID）
        e1 = (row.get("expert_1_label") or "").strip()
        e2 = (row.get("expert_2_label") or "").strip()
        adj_label = (row.get("adjudicated_label") or "").strip()
        adj_id = (row.get("adjudicator_id_hash") or "").strip()
        if e1 and e2 and e1 != e2 and not adj_label:
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "§6 裁决" if mode == "strict" else "§6 裁决草稿",
                         "两专家标签不一致但 adjudicated_label 为空；不一致病例必须经独立裁决", where)
        if e1 and e2 and adj_label and not adj_id:
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "§6 裁决" if mode == "strict" else "§6 裁决草稿",
                         "存在裁决标签但 adjudicator_id_hash 为空", where)
        if adj_label and codes is not None and adj_label not in codes:
            findings.add(BLOCKING, "§7 受控标签",
                         "adjudicated_label='%s' 不在本体中" % adj_label, where)

        consent = (row.get("consent_verified") or "").strip().lower()
        deid = (row.get("deidentified_verified") or "").strip().lower()
        if mode == "strict" and tier in {"G1", "G2"}:
            if consent not in {"1", "true", "yes", "y"}:
                findings.add(BLOCKING, "§5 同意",
                             "临床参考病例必须 consent_verified", where)
            if deid not in {"1", "true", "yes", "y"}:
                findings.add(BLOCKING, "§5 去标识",
                             "临床参考病例必须 deidentified_verified", where)

    for case_id, count in seen_cases.items():
        if count > 1:
            findings.add(BLOCKING, "§5 唯一性",
                         "case_id '%s' 出现 %d 次，必须唯一" % (case_id, count))

    for animal, splits in sorted(animal_splits.items()):
        if len(splits) > 1:
            findings.add(BLOCKING, "§8 泄漏控制",
                         "动物 %s 的病例被分到多个 split：%s。同一动物的所有资料必须同组。"
                         % (animal[:8], sorted(splits)))

    for group, splits in sorted(group_splits.items()):
        if len(splits) > 1:
            findings.add(BLOCKING, "§8 泄漏控制",
                         "derivative_group '%s' 跨越多个 split：%s。画质变体必须与原病例同组。"
                         % (group, sorted(splits)))

    for animal, cases in sorted(animal_cases.items()):
        if len(cases) > 1:
            findings.add(WARNING, "§4 独立性",
                         "动物 %s 关联 %d 个 case_id；统计时应按动物聚类，"
                         "同一动物的多次就诊不应视为独立样本" % (animal[:8], len(cases)))


def validate_adjudication(rows: List[Dict[str, str]],
                          ontology: Dict[str, object],
                          findings: Findings) -> None:
    codes = valid_codes(ontology)
    urgency_levels = set(ontology.get("urgency_ordered_levels", []))
    if not rows:
        findings.add(WARNING, "empty", "裁决表没有数据行（尚未进入裁决阶段）")
        return

    for idx, row in enumerate(rows, start=2):
        where = "第 %d 行" % idx
        e1 = (row.get("expert_1_id_hash") or "").strip()
        e2 = (row.get("expert_2_id_hash") or "").strip()
        adj = (row.get("adjudicator_id_hash") or "").strip()

        if e1 and e2 and e1 == e2:
            findings.add(BLOCKING, "§6 独立性",
                         "两名专家 ID 相同，不构成独立标注", where)
        if adj and adj in {e1, e2}:
            findings.add(BLOCKING, "§6 裁决独立性",
                         "裁决者不得是原标注专家之一", where)

        locked = (row.get("pre_adjudication_labels_locked") or "").strip().lower()
        if locked not in {"1", "true", "yes", "y"}:
            findings.add(BLOCKING, "§6 锁定",
                         "必须确认裁决前标注已锁定；先讨论再补填不算独立标注", where)

        label = (row.get("adjudicated_primary_label") or "").strip()
        if label and label not in codes:
            findings.add(BLOCKING, "§7 受控标签",
                         "adjudicated_primary_label='%s' 不在本体中" % label, where)

        urgency = (row.get("adjudicated_urgency") or "").strip()
        if urgency and urgency not in urgency_levels:
            findings.add(BLOCKING, "§7 紧急度",
                         "adjudicated_urgency='%s' 不在有序等级中" % urgency, where)

        if label and not (row.get("adjudication_rationale") or "").strip():
            findings.add(BLOCKING, "§6 裁决记录",
                         "裁决必须写出理由；裁决不是简单多数投票", where)


def load_screening_schema(path: str = DEFAULT_SCREENING_SCHEMA) -> Dict[str, object]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def validate_screening_forms(rows: List[Dict[str, str]],
                             schema: Dict[str, object],
                             ontology: Dict[str, object],
                             findings: Findings,
                             mode: str = "draft",
                             expert_rows: Optional[List[Dict[str, str]]] = None,
                             template_dir: Optional[str] = None) -> None:
    """B14-1（BUG-30）：初筛任务可答性标注校验。

    终诊 manifest 的 final_label/gold_tier 回答"最终是什么病"；本表回答"初筛时点的
    允许输入下哪些任务可答、病因是否应弃答"。两者不得互相推导——
    G1 病因已知 + 画质2 + 允许输入缺排查依据 → 病因应弃答且形态/分诊可答是合法组合。"""
    codes = valid_codes(ontology)
    urgency_levels = set(ontology.get("urgency_ordered_levels", []))
    enums = schema.get("enums", {})
    required_cols = list((schema.get("columns") or {}).keys())

    if not rows:
        findings.add(WARNING, "empty",
                     "初筛可答性表没有数据行（status: not_collected）；不得产出任何初筛弃答指标。")
        return

    seen_keys: Counter = Counter()
    snapshot_hash: Dict[str, str] = {}
    # 终诊画质交叉引用（B14-1 R2）：按 case_id 取专家表的画质分
    quality_by_case: Dict[str, str] = {}
    for er in (expert_rows or []):
        cid = (er.get("case_id") or "").strip()
        q = (er.get("photo_quality_score") or "").strip()
        if cid and q and cid not in quality_by_case:
            quality_by_case[cid] = q

    # 表头完整性（校验的是实际输入文件的表头；模板自身由 self-test 覆盖）
    if template_dir:
        tpl = os.path.join(template_dir, schema.get("file", ""))
        if os.path.exists(tpl):
            with open(tpl, "r", encoding="utf-8-sig", newline="") as fh:
                header = next(csv.reader(fh), [])
            missing = [c for c in required_cols if c not in header]
            if missing:
                findings.add(BLOCKING, "schema 模板",
                             "screening 模板缺少列：%s" % missing)

    for idx, row in enumerate(rows, start=2):
        where = "第 %d 行" % idx
        case_id = (row.get("case_id") or "").strip()
        snap = (row.get("input_snapshot_id") or "").strip()
        sha = (row.get("input_sha256") or "").strip()
        timepoint = (row.get("screening_timepoint") or "").strip()
        answerability = (row.get("answerability") or "").strip()
        should_abstain = (row.get("should_abstain") or "").strip().lower() in {"1", "true", "yes", "y"}
        abstain_scope = _split_multi(row.get("abstention_scope") or "")
        task_scope = _split_multi(row.get("task_scope") or "")

        if not case_id or not snap:
            findings.add(BLOCKING, "可答性标识", "case_id / input_snapshot_id 为空", where)
            continue
        key = (case_id, timepoint, snap)
        seen_keys[key] += 1
        if snap in snapshot_hash and snapshot_hash[snap] and sha and snapshot_hash[snap] != sha:
            findings.add(BLOCKING, "快照一致性",
                         "input_snapshot_id '%s' 对应多个 input_sha256；快照必须内容唯一" % snap, where)
        if sha:
            snapshot_hash.setdefault(snap, sha)

        if not timepoint or timepoint not in enums.get("screening_timepoint", []):
            findings.add(BLOCKING, "枚举", "screening_timepoint='%s' 非法" % timepoint, where)
        if not task_scope:
            findings.add(BLOCKING, "任务范围", "task_scope 为空", where)
        for t in task_scope:
            if t not in enums.get("task_scope", []):
                findings.add(BLOCKING, "枚举", "task_scope 含非法值 '%s'" % t, where)
        if answerability not in enums.get("answerability", []):
            findings.add(BLOCKING, "枚举", "answerability='%s' 非法" % answerability, where)
        if answerability == "unanswerable" and not should_abstain:
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "弃答联动" if mode == "strict" else "弃答联动草稿",
                         "answerability=unanswerable 但 should_abstain 未置 1", where)
        if should_abstain and not abstain_scope:
            findings.add(BLOCKING, "弃答范围", "should_abstain=1 必须 abstention_scope 非空", where)
        for s in abstain_scope:
            if s not in enums.get("abstention_scope", []):
                findings.add(BLOCKING, "枚举", "abstention_scope 含非法值 '%s'" % s, where)

        # etiology 弃答与病因候选自相矛盾
        acceptable = _split_multi(row.get("acceptable_primary_labels") or "")
        coexisting = _split_multi(row.get("required_coexisting_labels") or "")
        permitted = _split_multi(row.get("permitted_differentials") or "")
        retainable = _split_multi(row.get("retainable_candidate_codes") or "")
        if "etiology" in abstain_scope and (acceptable or coexisting):
            findings.add(BLOCKING if mode == "strict" else WARNING,
                         "弃答一致性" if mode == "strict" else "弃答一致性草稿",
                         "etiology 应弃答却给出 acceptable/required 病因标签；两者矛盾", where)

        # 标签空间：只接受本体 code（KB 外正确概念登记在本体上，不以 69 卡定义正确答案）
        for group, items in [("acceptable", acceptable), ("coexisting", coexisting),
                             ("permitted", permitted), ("retainable", retainable)]:
            for lab in items:
                if lab not in codes:
                    findings.add(BLOCKING, "受控标签",
                                 "%s_labels 中 '%s' 不在 label_ontology.json" % (group, lab), where)

        granularity = (row.get("allowable_candidate_granularity") or "").strip()
        if granularity not in enums.get("allowable_candidate_granularity", []):
            findings.add(BLOCKING, "枚举",
                         "allowable_candidate_granularity='%s' 非法" % granularity, where)
        elif granularity == "none" and acceptable:
            findings.add(WARNING, "粒度一致",
                         "granularity=none 却给出 acceptable 病因标签", where)
        # 病族可答 + 亚型弃答是合法组合（R6）：不做任何拦截，这里仅显式注释防误改。

        urgency = (row.get("urgency") or "").strip()
        if not urgency:
            findings.add(BLOCKING, "紧急度", "urgency 为空", where)
        elif urgency not in urgency_levels:
            findings.add(BLOCKING, "紧急度", "urgency='%s' 不在有序等级中" % urgency, where)

        test_scope = (row.get("recommended_test_scope") or "").strip()
        if test_scope not in enums.get("recommended_test_scope", []):
            findings.add(BLOCKING, "枚举", "recommended_test_scope='%s' 非法" % test_scope, where)

        allowed_fields = _split_multi(row.get("allowed_input_fields") or "")
        if not allowed_fields:
            findings.add(BLOCKING, "允许输入", "allowed_input_fields 为空；标注必须声明输入边界", where)
        for f in allowed_fields:
            if f not in enums.get("allowed_input_fields", []):
                findings.add(BLOCKING, "枚举", "allowed_input_fields 含非法值 '%s'" % f, where)

        annotator = (row.get("annotator_id_hash") or "").strip()
        version = (row.get("annotation_version") or "").strip()
        if mode == "strict":
            if not annotator:
                findings.add(BLOCKING, "标注完整", "strict 模式缺 annotator_id_hash", where)
            if not version:
                findings.add(BLOCKING, "标注完整", "strict 模式缺 annotation_version", where)
            if not sha:
                findings.add(BLOCKING, "标注完整", "strict 模式缺 input_sha256", where)
        else:
            if not annotator or not version or not sha:
                findings.add(WARNING, "草稿缺项",
                             "draft 模式缺 annotator/annotation_version/input_sha256；正式评分前必须补齐", where)

        # 画质交叉（R2）：仅当提供了专家表才启用
        q = quality_by_case.get(case_id)
        if q:
            if "image_etiology" in task_scope and answerability == "answerable":
                if q == "1":
                    findings.add(BLOCKING, "画质边界",
                                 "画质1（受限）不允许把 image_etiology 标为 answerable；病因需排查依据", where)
                elif q == "0":
                    findings.add(BLOCKING, "画质边界",
                                 "画质0 不允许任何基于图像的病因断言（image_etiology answerable）", where)
            if q == "0" and "image_morphology" in task_scope and answerability == "answerable":
                findings.add(WARNING, "画质边界",
                             "画质0 下图像形态描述通常也应受限；请确认依据", where)
            # 画质0 + history_triage 可答是合法且必要的（病史危险信号仍可紧急就医）：不拦。

    for (case_id, timepoint, snap), count in seen_keys.items():
        if count > 1:
            findings.add(BLOCKING, "唯一性",
                         "(case=%s, timepoint=%s, snapshot=%s) 出现 %d 次，必须唯一"
                         % (case_id, timepoint, snap[:16], count))


def main() -> None:
    parser = argparse.ArgumentParser(description="校验标注表是否遵守 annotation_guide 协议")
    parser.add_argument("--expert", help="专家标注 CSV（可重复用逗号分隔多个）")
    parser.add_argument("--manifest", help="case_manifest CSV")
    parser.add_argument("--adjudication", help="裁决表 CSV")
    parser.add_argument("--screening", help="初筛任务可答性标注 CSV（B14-1）")
    parser.add_argument("--screening-schema", default=DEFAULT_SCREENING_SCHEMA)
    parser.add_argument("--mode", choices=["draft", "strict"], default="draft",
                        help="draft=草稿（缺项警告）；strict=完整性校验（缺项阻断，B14-3）")
    parser.add_argument("--ontology", default=DEFAULT_ONTOLOGY)
    parser.add_argument("--json-out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    ontology = load_ontology(args.ontology)

    if args.self_test:
        _self_test(ontology)
        return

    if not any([args.expert, args.manifest, args.adjudication, args.screening]):
        # 无参数时校验模板本身：确认表头齐全、本体自洽
        print("未指定输入文件，改为自检模板与本体一致性。\n")
        _self_test(ontology)
        return

    findings = Findings()
    expert_rows: List[Dict[str, str]] = []

    if args.expert:
        for path in args.expert.split(","):
            path = path.strip()
            print("校验专家标注：%s" % path)
            rows = read_csv(path)
            expert_rows.extend(rows)
            validate_expert_forms(rows, ontology, findings)
    if args.manifest:
        print("校验 case manifest（mode=%s）：%s" % (args.mode, args.manifest))
        validate_manifest(read_csv(args.manifest), findings, ontology=ontology, mode=args.mode)
    if args.adjudication:
        print("校验裁决表：%s" % args.adjudication)
        validate_adjudication(read_csv(args.adjudication), ontology, findings)
    if args.screening:
        print("校验初筛可答性标注（mode=%s）：%s" % (args.mode, args.screening))
        schema = load_screening_schema(args.screening_schema)
        validate_screening_forms(read_csv(args.screening), schema, ontology, findings,
                                 mode=args.mode,
                                 expert_rows=expert_rows,
                                 template_dir=os.path.dirname(os.path.abspath(args.screening_schema)))

    print("")
    for item in findings.items:
        prefix = "[阻断]" if item["level"] == BLOCKING else "[警告]"
        loc = ("（%s）" % item["where"]) if item["where"] else ""
        print("%s %s%s %s" % (prefix, item["rule"], loc, item["message"]))

    print("\n---------------------------------------------")
    print("阻断性错误 %d 项，警告 %d 项" % (len(findings.errors), len(findings.warnings)))
    if findings.errors:
        print("存在阻断性错误：不得据此计算任何一致性或效果指标。")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump({"errors": findings.errors, "warnings": findings.warnings},
                      fh, ensure_ascii=False, indent=2)
        print("结果已写入 %s" % args.json_out)

    sys.exit(1 if findings.errors else 0)


def _self_test(ontology: Dict[str, object]) -> None:
    codes = valid_codes(ontology)
    assert "INF_DERMATOPHYTOSIS" in codes
    assert "CANNOT_DETERMINE" in codes

    # 本体自洽：code 唯一、clinical_group 合法、必填字段齐全
    seen = Counter(e["code"] for e in ontology["labels"])
    dupes = [c for c, n in seen.items() if n > 1]
    assert not dupes, "本体存在重复 code：%s" % dupes
    groups = set(ontology["clinical_groups"])
    for entry in ontology["labels"]:
        assert entry["clinical_group"] in groups, entry["code"]
        for key in ("label_zh", "category_zh", "g1_path_summary", "insufficient_alone"):
            assert entry.get(key), "%s 缺少 %s" % (entry["code"], key)

    # 自由文本主标签必须被拦截
    f = Findings()
    validate_expert_forms([{
        "case_id": "C1", "annotator_id_hash": "a1",
        "primary_etiology_label": "看起来像猫癣",
        "gold_tier": "G1", "urgency": "routine",
        "confirmatory_evidence_cited": "培养阳性",
    }], ontology, f)
    assert any("不在 label_ontology" in e["message"] for e in f.errors), f.errors

    # G1 无确认证据必须拦截
    f2 = Findings()
    validate_expert_forms([{
        "case_id": "C1", "annotator_id_hash": "a1",
        "primary_etiology_label": "INF_DERMATOPHYTOSIS",
        "gold_tier": "G1", "urgency": "routine",
        "confirmatory_evidence_cited": "",
    }], ontology, f2)
    assert any("必须在 confirmatory_evidence_cited" in e["message"] for e in f2.errors), f2.errors

    # 合法行不应产生阻断错误
    f3 = Findings()
    validate_expert_forms([
        {"case_id": "C1", "annotator_id_hash": "a1",
         "primary_etiology_label": "INF_DERMATOPHYTOSIS", "gold_tier": "G1",
         "urgency": "routine", "confirmatory_evidence_cited": "真菌培养阳性",
         "gold_tier_justification": "培养确认", "photo_quality_score": "2",
         "subjective_certainty_0_100": "80", "evidence_package_complete": "1"},
        {"case_id": "C1", "annotator_id_hash": "a2",
         "primary_etiology_label": "INF_DERMATOPHYTOSIS", "gold_tier": "G1",
         "urgency": "routine", "confirmatory_evidence_cited": "同一培养报告",
         "gold_tier_justification": "培养确认", "photo_quality_score": "2",
         "subjective_certainty_0_100": "75", "evidence_package_complete": "1"},
    ], ontology, f3)
    assert not f3.errors, f3.errors

    # 重复提交必须拦截
    f4 = Findings()
    row = {"case_id": "C1", "annotator_id_hash": "a1",
           "primary_etiology_label": "CANNOT_DETERMINE", "urgency": "monitor",
           "cannot_determine": "1", "cannot_determine_reason": "画质不足"}
    validate_expert_forms([dict(row), dict(row)], ontology, f4)
    assert any("提交了 2 次" in e["message"] for e in f4.errors), f4.errors

    # 产品口径 urgency 混入必须被发现（low 不是参考标准等级）
    f5 = Findings()
    validate_expert_forms([{
        "case_id": "C1", "annotator_id_hash": "a1",
        "primary_etiology_label": "NORM_HEALTHY_SKIN", "gold_tier": "G2",
        "confirmatory_evidence_cited": "随访无进展", "urgency": "low",
    }], ontology, f5)
    assert any("不在有序等级" in e["message"] for e in f5.errors), f5.errors

    # 泄漏控制：同一动物跨 split
    f6 = Findings()
    validate_manifest([
        {"case_id": "C1", "animal_id_hash": "A", "split": "evaluation",
         "gold_tier": "G1", "consent_verified": "1", "deidentified_verified": "1"},
        {"case_id": "C2", "animal_id_hash": "A", "split": "development",
         "gold_tier": "G1", "consent_verified": "1", "deidentified_verified": "1"},
    ], f6)
    assert any("被分到多个 split" in e["message"] for e in f6.errors), f6.errors

    # DEV_ONLY 冒充临床参考必须拦截
    f7 = Findings()
    validate_manifest([{"case_id": "C1", "animal_id_hash": "A", "split": "evaluation", "gold_status": "reviewed",
                        "gold_tier": "DEV_ONLY", "consent_verified": "1",
                        "deidentified_verified": "1"}], f7)
    assert any("不得标记为临床参考已审核" in e["message"] for e in f7.errors), f7.errors

    # 裁决独立性
    f8 = Findings()
    validate_adjudication([{
        "case_id": "C1", "expert_1_id_hash": "x", "expert_2_id_hash": "x",
        "adjudicator_id_hash": "x", "pre_adjudication_labels_locked": "1",
        "adjudicated_primary_label": "INF_DERMATOPHYTOSIS",
        "adjudication_rationale": "依据培养",
    }], ontology, f8)
    msgs = " ".join(e["message"] for e in f8.errors)
    assert "两名专家 ID 相同" in msgs and "裁决者不得是原标注专家" in msgs, f8.errors

    # 空表是正常状态，不是错误
    f9 = Findings()
    validate_expert_forms([], ontology, f9)
    assert not f9.errors and f9.warnings, f9.items

    # 模板表头必须覆盖校验器读取的所有列
    tpl_dir = os.path.join(HERE, "..", "reference_data")
    for name, required in [
        ("expert_annotation_form.template.csv",
         ["case_id", "annotator_id_hash", "primary_etiology_label", "gold_tier",
          "urgency", "photo_quality_score", "confirmatory_evidence_cited",
          "cannot_determine", "cannot_determine_reason", "high_risk_flag",
          "high_risk_reason", "evidence_package_complete",
          "subjective_certainty_0_100", "acceptable_secondary_labels",
          "gold_tier_justification"]),
        ("adjudication_form.template.csv",
         ["case_id", "expert_1_id_hash", "expert_2_id_hash", "adjudicator_id_hash",
          "pre_adjudication_labels_locked", "adjudicated_primary_label",
          "adjudicated_urgency", "adjudication_rationale"]),
    ]:
        path = os.path.join(tpl_dir, name)
        with open(path, "r", encoding="utf-8-sig", newline="") as fh:
            header = next(csv.reader(fh))
        missing = [c for c in required if c not in header]
        assert not missing, "%s 缺少列：%s" % (name, missing)

    # ── B14（BUG-30/33）：初筛可答性与完整性校验 ──
    schema = load_screening_schema()
    screening_cols = list((schema.get("columns") or {}).keys())

    def screening_row(**over):
        base = {
            "case_id": "S1", "input_snapshot_id": "snap-1", "input_sha256": "a" * 8,
            "allowed_input_fields": "images;owner_text;history",
            "screening_timepoint": "intake_photo",
            "task_scope": "image_etiology;image_morphology;history_triage",
            "answerability": "limited", "should_abstain": "1",
            "abstention_scope": "etiology",
            "acceptable_primary_labels": "", "required_coexisting_labels": "",
            "permitted_differentials": "", "allowable_candidate_granularity": "morphology_only",
            "urgency": "urgent", "recommended_test_scope": "basic_workup",
            "annotator_id_hash": "ann1", "annotation_version": "v1",
            "retainable_candidate_codes": "", "exclusion_evidence": "",
        }
        base.update(over)
        return base

    # BUG-30 核心场景：G1 病因已知 + 画质2 + 允许输入缺排查依据 → 病因应弃答且形态/分诊可答，
    # 与终诊 G1 并存完全合法，校验器不得阻断（终诊与初筛分离）。
    f10 = Findings()
    validate_screening_forms([screening_row()], schema, ontology, f10, mode="strict")
    assert not f10.errors, f10.errors

    # 病族可答 + 亚型弃答（R6）：合法组合
    f10b = Findings()
    validate_screening_forms([screening_row(
        allowable_candidate_granularity="family",
        abstention_scope="etiology;subtype")], schema, ontology, f10b, mode="strict")
    assert not f10b.errors, f10b.errors

    # etiology 弃答却给病因候选 → 自相矛盾，strict 阻断
    f11 = Findings()
    validate_screening_forms([screening_row(acceptable_primary_labels="INF_DERMATOPHYTOSIS")],
                             schema, ontology, f11, mode="strict")
    assert any("矛盾" in e["message"] for e in f11.errors), f11.errors

    # 非法标签阻断
    f12 = Findings()
    validate_screening_forms([screening_row(abstention_scope="",
                                            should_abstain="0",
                                            answerability="answerable",
                                            acceptable_primary_labels="看起来像猫癣")],
                             schema, ontology, f12, mode="draft")
    assert any("不在 label_ontology" in e["message"] for e in f12.errors), f12.errors

    # 画质交叉：画质1 不允许 image_etiology answerable；画质0 只拦图像任务、病史分诊保持可答
    f13 = Findings()
    validate_screening_forms([screening_row(should_abstain="0", abstention_scope="",
                                            answerability="answerable")],
                             schema, ontology, f13, mode="strict",
                             expert_rows=[{"case_id": "S1", "photo_quality_score": "1"}])
    assert any("画质1" in e["message"] for e in f13.errors), f13.errors

    f13b = Findings()
    validate_screening_forms([screening_row(task_scope="image_morphology;history_triage",
                                            answerability="answerable",
                                            should_abstain="0", abstention_scope="")],
                             schema, ontology, f13b, mode="strict",
                             expert_rows=[{"case_id": "S1", "photo_quality_score": "0"}])
    assert not f13b.errors, ("画质0 下病史/分诊可答必须合法", f13b.errors)

    # strict 缺 annotator/版本/快照哈希阻断；draft 仅警告
    f14 = Findings()
    validate_screening_forms([screening_row(annotator_id_hash="", annotation_version="",
                                            input_sha256="")],
                             schema, ontology, f14, mode="strict")
    assert len([e for e in f14.errors if "标注完整" in e["rule"]]) == 3, f14.errors
    f14b = Findings()
    validate_screening_forms([screening_row(annotator_id_hash="", annotation_version="",
                                            input_sha256="")],
                             schema, ontology, f14b, mode="draft")
    assert not f14b.errors and f14b.warnings, f14b.items

    # 表头唯一性
    f15 = Findings()
    validate_screening_forms([screening_row(), screening_row()],
                             schema, ontology, f15, mode="draft")
    assert any("必须唯一" in e["message"] for e in f15.errors), f15.errors

    # header-only / 空表：draft 保持诚实 not_collected，不产错误
    f16 = Findings()
    validate_screening_forms([], schema, ontology, f16, mode="draft")
    assert not f16.errors and any("not_collected" in w["message"] for w in f16.warnings)

    # manifest strict：缺 final_label 阻断；draft 警告
    manifest_row = {"case_id": "C1", "animal_id_hash": "A", "split": "evaluation",
                    "gold_tier": "G1", "consent_verified": "1", "deidentified_verified": "1",
                    "expert_1_label": "INF_DERMATOPHYTOSIS", "expert_2_label": "INF_DERMATOPHYTOSIS"}
    f17 = Findings()
    validate_manifest([dict(manifest_row)], f17, ontology=ontology, mode="strict")
    assert any("final_label 缺失" in e["message"] for e in f17.errors), f17.errors
    f17b = Findings()
    validate_manifest([dict(manifest_row)], f17b, ontology=ontology, mode="draft")
    assert not any(e["rule"].startswith("§4 终诊完整性") for e in f17b.errors), f17b.errors

    # manifest strict：G1 缺证据阻断；两专家不一致缺裁决阻断；非法 final 标签阻断
    f18 = Findings()
    validate_manifest([dict(manifest_row, final_label="INF_DERMATOPHYTOSIS",
                            final_urgency="routine")],
                      f18, ontology=ontology, mode="strict")
    assert any("gold_evidence_summary" in e["message"] for e in f18.errors), f18.errors

    f19 = Findings()
    validate_manifest([dict(manifest_row, final_label="INF_DERMATOPHYTOSIS",
                            final_urgency="routine",
                            gold_evidence_summary="培养阳性", confirmatory_tests="真菌培养",
                            expert_2_label="PAR_SARCOPTIC_MANGE")],
                      f19, ontology=ontology, mode="strict")
    assert any("不一致但 adjudicated_label 为空" in e["message"] for e in f19.errors), f19.errors

    f20 = Findings()
    validate_manifest([dict(manifest_row, final_label="自由文本猫癣",
                            final_urgency="routine", gold_evidence_summary="x",
                            confirmatory_tests="y")],
                      f20, ontology=ontology, mode="strict")
    assert any("final_label=" in e["message"] and "不在" in e["message"] for e in f20.errors), f20.errors

    # 合法已完整 G1/G2 完整行通过（无需裁决）
    f21 = Findings()
    validate_manifest([dict(manifest_row, final_label="INF_DERMATOPHYTOSIS",
                            final_urgency="routine", gold_evidence_summary="培养阳性",
                            confirmatory_tests="真菌培养")],
                      f21, ontology=ontology, mode="strict")
    assert not f21.errors, f21.errors

    # screening 模板表头与 schema 一致
    tpl_path = os.path.join(HERE, "..", "reference_data", schema.get("file", ""))
    with open(tpl_path, "r", encoding="utf-8-sig", newline="") as fh:
        header = next(csv.reader(fh))
    missing = [c for c in screening_cols if c not in header]
    assert not missing, "screening 模板缺少列：%s" % missing

    print("validate_annotations self-test passed (incl. B14)")


if __name__ == "__main__":
    main()
