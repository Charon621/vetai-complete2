#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_attempt_accounting.py — B15-1（BUG-31）首次 scheduled attempt 记账验收。

第1轮审计的反例（audit：3 病例含全失败、首轮 A 重试 B，旧工具报 2/2=100%、
excluded 0）在这里按 first_scheduled 口径复核：
  - scheduled 分母 = manifest 预注册的病例数（3）；
  - 首次尝试口径：A/B 分歧保留 → 条件一致 1/2；
  - 端到端成功且一致 1/3；全失败病例 always_failed 明确在案；
  - 重试链完整保留但只陈述、不参与计分；乱序日志不改变 first 选择；
  - 重复同 attempt 冲突阻断。
零依赖，直接 python 运行。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "..", "tools")
sys.path.insert(0, TOOLS)

import repeatability as rep  # noqa: E402

FIELD = ("branches", "full", "final", "primaryDiagnosis")
PASSED = 0


def ok(name, fn):
    global PASSED
    fn()
    PASSED += 1
    print("  ok %d - %s" % (PASSED, name))


def build_manifest():
    attempts = []
    for run in ("run1", "run2"):
        attempts.append({"run_id": run, "case_id": "X", "branch": "full", "stage": "final",
                         "scheduled_attempt_id": "X-%s-1" % run, "attempt_index": 1})
        attempts.append({"run_id": run, "case_id": "Y", "branch": "full", "stage": "final",
                         "scheduled_attempt_id": "Y-%s-1" % run, "attempt_index": 1})
        attempts.append({"run_id": run, "case_id": "Z", "branch": "full", "stage": "final",
                         "scheduled_attempt_id": "Z-%s-1" % run, "attempt_index": 1})
    # Y/run1 的重试：预注册 attempt_index=2
    attempts.append({"run_id": "run1", "case_id": "Y", "branch": "full", "stage": "final",
                     "scheduled_attempt_id": "Y-run1-2", "attempt_index": 2})
    return {"manifest_version": "1.0.0", "experiment_id": "audit-counterexample",
            "scheduled_attempts": attempts}


def rec(run, case, idx, status=None, label=None):
    payload = {"run_id": run, "case_id": case, "branch": "full", "stage": "final",
               "scheduled_attempt_id": "%s-%s-%d" % (case, run, idx), "attempt_index": idx}
    if status:
        payload["executionStatus"] = status
    if label:
        payload["branches"] = {"full": {"final": {"primaryDiagnosis": label}}}
    return payload


def write_jsonl(dirpath, name, records):
    p = os.path.join(dirpath, name)
    with open(p, "w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return p


def t_counterexample():
    manifest = build_manifest()
    tmp = tempfile.mkdtemp()
    # 乱序写入：重试记录排在首次之前，first 选择不得受日志顺序影响
    run1 = [
        rec("run1", "Y", 2, label="B"),
        rec("run1", "X", 1, status="provider_error"),
        rec("run1", "Y", 1, label="A"),
        rec("run1", "Z", 1, label="脓皮"),
    ]
    run2 = [
        rec("run2", "Z", 1, label="脓皮"),
        rec("run2", "X", 1, status="timeout"),
        rec("run2", "Y", 1, label="B"),
    ]
    paths = [write_jsonl(tmp, "run1.jsonl", run1), write_jsonl(tmp, "run2.jsonl", run2)]
    view = rep.load_scheduled_runs(paths, manifest, FIELD)
    assert view["conflicts"] == [], view["conflicts"]
    report = rep.scheduled_consistency_report(manifest, view)["branches"]["full"]
    assert report["scheduled_cases"] == 3
    assert report["cases_with_valid_labels_in_all_runs"] == 2
    assert report["conditional_full_consistency"] == {"numerator": 1, "denominator": 2}, report
    assert report["end_to_end_success_and_identical"] == {"numerator": 1, "denominator": 3}, report
    assert [c["case_id"] for c in report["always_failed_cases"]] == ["X"]
    div = report["first_attempt_divergences"]
    assert len(div) == 1 and div[0]["case_id"] == "Y", div
    assert div[0]["first_attempt_labels"] == {"run1": "A", "run2": "B"}, div
    # 重试链如实保留：run1 attempt2 → B；不改变首次口径的结论
    retries = [s for s in div[0]["retry_chain"] if s["run_id"] == "run1"]
    assert retries[0]["label"] == "B" and retries[0]["status"] == "completed", div


ok("乱序日志 + 首轮A重试B：条件一致 1/2、端到端 1/3、always_failed 明确、分歧保留", t_counterexample)


def t_all_valid_identical_not_100_overall():
    """全失败病例在场时，端到端一致率必须 <100%（旧行为是 100%）。"""
    manifest = build_manifest()
    tmp = tempfile.mkdtemp()
    paths = [write_jsonl(tmp, "run1.jsonl", [
        rec("run1", "X", 1, status="schema_error"),
        rec("run1", "Y", 1, label="B"),
        rec("run1", "Z", 1, label="甲"),
    ]), write_jsonl(tmp, "run2.jsonl", [
        rec("run2", "X", 1, status="provider_error"),
        rec("run2", "Y", 1, label="B"),
        rec("run2", "Z", 1, label="甲"),
    ])]
    view = rep.load_scheduled_runs(paths, manifest, FIELD)
    report = rep.scheduled_consistency_report(manifest, view)["branches"]["full"]
    # Y/Z 首次一致（重试不存在时旧口径会把这些当全部样本报 100%）
    assert report["conditional_full_consistency"] == {"numerator": 2, "denominator": 2}
    # 但端到端分母含全失败的 X：1 案例失败 → 2/3，不得报 100%
    assert report["end_to_end_success_and_identical"] == {"numerator": 2, "denominator": 3}
    assert [c["case_id"] for c in report["always_failed_cases"]] == ["X"]


ok("技术失败进入端到端分母（2/3），条件口径单列（2/2）", t_all_valid_identical_not_100_overall)


def t_duplicate_conflict_blocks():
    manifest = build_manifest()
    tmp = tempfile.mkdtemp()
    path = write_jsonl(tmp, "dup.jsonl", [
        rec("run1", "Z", 1, label="甲"),
        rec("run1", "Z", 1, label="乙"),  # 同一 scheduled attempt 两条记录
    ])
    view = rep.load_scheduled_runs([path], manifest, FIELD)
    assert len(view["conflicts"]) == 1, view["conflicts"]


ok("重复同 attempt 记录 → 冲突阻断级", t_duplicate_conflict_blocks)


def t_missing_attempt_is_failure():
    """manifest 登记了但日志没给记录 → missing_record 失败，不得静默缩小分母。"""
    manifest = build_manifest()
    tmp = tempfile.mkdtemp()
    path = write_jsonl(tmp, "run1.jsonl", [
        rec("run1", "Y", 1, label="A"),
        rec("run1", "Z", 1, label="甲"),
    ])  # X 的记录缺失
    view = rep.load_scheduled_runs([path], manifest, FIELD)
    slot = view["attempts"]["X-run1-1"]
    assert slot["status"] == "missing_record" and slot["label"] is None, slot


ok("manifest 登记而日志缺失 → missing_record（分母不缩水）", t_missing_attempt_is_failure)


def t_cli_end_to_end():
    """CLI：--scheduled-manifest + --field + --json-out 走通并输出 1/3。"""
    import subprocess
    manifest = build_manifest()
    tmp = tempfile.mkdtemp()
    paths = [write_jsonl(tmp, "run1.jsonl", [
        rec("run1", "X", 1, status="provider_error"),
        rec("run1", "Y", 1, label="A"),
        rec("run1", "Y", 2, label="B"),
        rec("run1", "Z", 1, label="甲")]),
        write_jsonl(tmp, "run2.jsonl", [
            rec("run2", "X", 1, status="timeout"),
            rec("run2", "Y", 1, label="B"),
            rec("run2", "Z", 1, label="甲")])]
    mpath = os.path.join(tmp, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)
    out = os.path.join(tmp, "report.json")
    exe = sys.executable
    res = subprocess.run([exe, os.path.join(TOOLS, "repeatability.py"),
                          paths[0], paths[1],
                          "--scheduled-manifest", mpath,
                          "--attempt-policy", "first_scheduled",
                          "--field", "branches.full.final.primaryDiagnosis",
                          "--json-out", out],
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    with open(out, encoding="utf-8") as fh:
        report = json.load(fh)
    full = report["branches"]["full"]
    assert full["end_to_end_success_and_identical"] == {"numerator": 1, "denominator": 3}
    assert full["conditional_full_consistency"] == {"numerator": 1, "denominator": 2}


ok("CLI --scheduled-manifest --attempt-policy first_scheduled --field 端到端走通", t_cli_end_to_end)

print("")
print("test_attempt_accounting: %d 组全部通过" % PASSED)
