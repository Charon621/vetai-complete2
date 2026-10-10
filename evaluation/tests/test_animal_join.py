#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_animal_join.py — B15-2（BUG-32）动物聚类 join 验收。

第1轮审计的反例：同一动物的母本与衍生图被 pivot 退化成两个簇，bootstrap
有效样本量被高估。这里验收 manifest join 后：
  - 母本 + 衍生图同动物 → 1 簇；不同动物 → 2 簇；
  - missing join / 同例双动物 / 专家与 manifest 矛盾 → 阻断；
  - --allow-case-clusters 只能标 development_only；
  - 每动物 1 例的 manifest 下 bootstrap 与旧逐例结果一致（回归护栏）。
零依赖，直接 python 运行。
"""

from __future__ import annotations

import csv
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "..", "tools")
sys.path.insert(0, TOOLS)

from agreement_stats import (  # noqa: E402
    apply_manifest_join, cluster_bootstrap_ci, cohens_kappa,
    load_animal_manifest, pivot_long_form, score_long_form_csv,
)

PASSED = 0


def ok(name, fn):
    global PASSED
    fn()
    PASSED += 1
    print("  ok %d - %s" % (PASSED, name))


def expert_row(case, annotator, label, animal=None):
    row = {"case_id": case, "annotator_id_hash": annotator,
           "primary_etiology_label": label, "urgency": "routine"}
    if animal:
        row["animal_id_hash"] = animal
    return row


def write_manifest(dirpath, name, rows):
    p = os.path.join(dirpath, name)
    with open(p, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["case_id", "animal_id_hash", "derivative_group_id"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return p


def t_cluster_merge_and_split():
    tmp = tempfile.mkdtemp()
    rows = [expert_row("P1", "a", "X"), expert_row("P1", "b", "X"),
            expert_row("P2", "a", "X"), expert_row("P2", "b", "Y"),
            expert_row("P3", "a", "X"), expert_row("P3", "b", "Y")]
    m = write_manifest(tmp, "m.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": "D1"},
        {"case_id": "P3", "animal_id_hash": "A2", "derivative_group_id": "D1"},
    ])
    piv = pivot_long_form(rows)
    apply_manifest_join(piv["paired"], load_animal_manifest(m))
    animals = {p["animal_id_hash"] for p in piv["paired"]}
    assert animals == {"A1", "A2"} and len(animals) == 2, animals
    # 衍生组信息随 join 带上
    d = {p["case_id"]: p.get("derivative_group_id") for p in piv["paired"]}
    assert d["P2"] == "D1" and d["P3"] == "D1", d


ok("母本+衍生图同动物合成 1 簇；不同动物 2 簇；衍生组随 join 带上", t_cluster_merge_and_split)


def t_blocks():
    tmp = tempfile.mkdtemp()
    rows = [expert_row("P1", "a", "X"), expert_row("P1", "b", "X"),
            expert_row("P2", "a", "X"), expert_row("P2", "b", "Y")]
    m_missing = write_manifest(tmp, "m_missing.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""}])
    try:
        apply_manifest_join(pivot_long_form(rows)["paired"], load_animal_manifest(m_missing))
        raise AssertionError("missing join 必须阻断")
    except ValueError as e:
        assert "missing join" in str(e)

    m_dup = write_manifest(tmp, "m_dup.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P1", "animal_id_hash": "A9", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": ""}])
    try:
        load_animal_manifest(m_dup)
        raise AssertionError("同例双动物必须阻断")
    except ValueError as e:
        assert "两个动物" in str(e)

    rows_conflict = [expert_row("P1", "a", "X", animal="ZZ"),
                     expert_row("P1", "b", "X", animal="ZZ"),
                     expert_row("P2", "a", "X"), expert_row("P2", "b", "Y")]
    m_ok = write_manifest(tmp, "m_ok.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": ""}])
    try:
        apply_manifest_join(pivot_long_form(rows_conflict)["paired"],
                            load_animal_manifest(m_ok))
        raise AssertionError("专家与 manifest 动物矛盾必须阻断")
    except ValueError as e:
        assert "矛盾" in str(e)

    # 专家表内同例双动物阻断
    rows_inner = [expert_row("P1", "a", "X", animal="AA"),
                  expert_row("P1", "b", "X", animal="BB"),
                  expert_row("P2", "a", "X"), expert_row("P2", "b", "Y")]
    try:
        apply_manifest_join(pivot_long_form(rows_inner)["paired"],
                            load_animal_manifest(m_ok))
        raise AssertionError("专家表内同例双动物必须阻断")
    except ValueError as e:
        assert "同例双动物" in str(e), e


ok("missing join / 同例双动物 / 专家-manifest 矛盾 / 专家表内矛盾 全部阻断", t_blocks)


def t_dev_fallback_flagged():
    tmp = tempfile.mkdtemp()
    rows = [expert_row("P1", "a", "X"), expert_row("P1", "b", "X"),
            expert_row("P9", "a", "Y"), expert_row("P9", "b", "Y")]
    m = write_manifest(tmp, "m_part.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""}])
    piv = pivot_long_form(rows)
    notes = apply_manifest_join(piv["paired"], load_animal_manifest(m),
                                allow_case_clusters=True)
    assert notes["cluster_source"] == "case_level_development_only", notes
    assert notes["fallback_case_clusters"] == ["P9"], notes


ok("allow_case_clusters 显式退化且必须标 development_only", t_dev_fallback_flagged)


def t_bootstrap_regression():
    """每动物 1 例的 manifest：bootstrap 簇数与旧逐侧行为一致。"""
    tmp = tempfile.mkdtemp()
    rows = []
    for i in range(8):
        lab = "X" if i % 2 else "Y"
        rows += [expert_row("K%d" % i, "a", lab), expert_row("K%d" % i, "b", lab)]
    m = write_manifest(tmp, "m1to1.csv", [
        {"case_id": "K%d" % i, "animal_id_hash": "AN%d" % i, "derivative_group_id": ""}
        for i in range(8)])
    piv = pivot_long_form(rows)
    apply_manifest_join(piv["paired"], load_animal_manifest(m))

    def kappa_of(sub):
        return float(cohens_kappa([i["primary_etiology_label__a"] for i in sub],
                                  [i["primary_etiology_label__b"] for i in sub])["kappa"])
    boot = cluster_bootstrap_ci(piv["paired"], kappa_of, iterations=300, seed=3)
    assert boot["n_clusters"] == 8 and boot["n_items"] == 8, boot


ok("每动物1例 manifest 下 bootstrap 保持逐例结果（回归护栏）", t_bootstrap_regression)


def t_score_long_form_with_manifest():
    tmp = tempfile.mkdtemp()
    csv_path = os.path.join(tmp, "expert.csv")
    fields = ["case_id", "annotator_id_hash", "primary_etiology_label", "urgency",
              "animal_id_hash", "gold_tier", "photo_quality_score"]
    rows = [expert_row("P1", "a", "X"), expert_row("P1", "b", "X"),
            expert_row("P2", "a", "X"), expert_row("P2", "b", "Y")]
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    m = write_manifest(tmp, "m.csv", [
        {"case_id": "P1", "animal_id_hash": "A1", "derivative_group_id": ""},
        {"case_id": "P2", "animal_id_hash": "A2", "derivative_group_id": ""}])
    report = score_long_form_csv(csv_path, manifest_path=m)
    assert report["status"] == "ok" and report["cluster_source"] == "manifest", report
    assert report["n_animal_clusters"] == 2, report
    # 无 manifest 时保持旧行为但明确标注未核实
    legacy = score_long_form_csv(csv_path)
    assert legacy["cluster_source"] == "case_fallback_unverified", legacy


ok("score_long_form_csv 带 manifest 输出簇数与来源；无 manifest 标注未核实", t_score_long_form_with_manifest)

print("")
print("test_animal_join: %d 组全部通过" % PASSED)
