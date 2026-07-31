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
- §2  DEV_ONLY 素材不得出现在冻结集；
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
DEFAULT_ONTOLOGY = os.path.join(HERE, "..", "gold_standard", "label_ontology.json")

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


def validate_manifest(rows: List[Dict[str, str]], findings: Findings) -> None:
    """检查 case_manifest 的泄漏控制与层级规则。"""
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

        if tier == "DEV_ONLY" and split == "frozen_test":
            findings.add(BLOCKING, "§2 DEV_ONLY",
                         "DEV_ONLY 素材不得进入 frozen_test", where)
        if split == "frozen_test" and tier not in {"G1", "G2"}:
            findings.add(BLOCKING, "§4 核心集",
                         "核心冻结集只接受 G1/G2，当前 gold_tier='%s'" % tier, where)

        consent = (row.get("consent_verified") or "").strip().lower()
        deid = (row.get("deidentified_verified") or "").strip().lower()
        if split == "frozen_test":
            if consent not in {"1", "true", "yes", "y"}:
                findings.add(BLOCKING, "§5 同意",
                             "冻结集病例必须 consent_verified", where)
            if deid not in {"1", "true", "yes", "y"}:
                findings.add(BLOCKING, "§5 去标识",
                             "冻结集病例必须 deidentified_verified", where)

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
                         "动物 %s 关联 %d 个 case_id；核心集要求 40 只动物对应 40 例，"
                         "同一动物不得作为多个核心病例" % (animal[:8], len(cases)))


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


def main() -> None:
    parser = argparse.ArgumentParser(description="校验标注表是否遵守 annotation_guide 协议")
    parser.add_argument("--expert", help="专家标注 CSV（可重复用逗号分隔多个）")
    parser.add_argument("--manifest", help="case_manifest CSV")
    parser.add_argument("--adjudication", help="裁决表 CSV")
    parser.add_argument("--ontology", default=DEFAULT_ONTOLOGY)
    parser.add_argument("--json-out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    ontology = load_ontology(args.ontology)

    if args.self_test:
        _self_test(ontology)
        return

    if not any([args.expert, args.manifest, args.adjudication]):
        # 无参数时校验模板本身：确认表头齐全、本体自洽
        print("未指定输入文件，改为自检模板与本体一致性。\n")
        _self_test(ontology)
        return

    findings = Findings()

    if args.expert:
        for path in args.expert.split(","):
            path = path.strip()
            print("校验专家标注：%s" % path)
            validate_expert_forms(read_csv(path), ontology, findings)
    if args.manifest:
        print("校验 case manifest：%s" % args.manifest)
        validate_manifest(read_csv(args.manifest), findings)
    if args.adjudication:
        print("校验裁决表：%s" % args.adjudication)
        validate_adjudication(read_csv(args.adjudication), ontology, findings)

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
        {"case_id": "C1", "animal_id_hash": "A", "split": "frozen_test",
         "gold_tier": "G1", "consent_verified": "1", "deidentified_verified": "1"},
        {"case_id": "C2", "animal_id_hash": "A", "split": "development",
         "gold_tier": "G1", "consent_verified": "1", "deidentified_verified": "1"},
    ], f6)
    assert any("被分到多个 split" in e["message"] for e in f6.errors), f6.errors

    # DEV_ONLY 进冻结集必须拦截
    f7 = Findings()
    validate_manifest([{"case_id": "C1", "animal_id_hash": "A", "split": "frozen_test",
                        "gold_tier": "DEV_ONLY", "consent_verified": "1",
                        "deidentified_verified": "1"}], f7)
    assert any("不得进入 frozen_test" in e["message"] for e in f7.errors), f7.errors

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
    tpl_dir = os.path.join(HERE, "..", "gold_standard")
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

    print("validate_annotations self-test passed")


if __name__ == "__main__":
    main()
