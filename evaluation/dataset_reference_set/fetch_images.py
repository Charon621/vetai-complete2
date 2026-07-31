#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V1 参考集图片准备工具。

职责：
  --check    对照 image_label.source.txt 报告哪些 case 的原图已就位、哪些缺失
  --prepare  把已就位的原图处理成去元数据的衍生图，并写出带双重 SHA-256 的清单

本仓库不重新分发数据集图片文件（尊重原始数据集的分发方式），只保留：
  - 原样的标签清单 image_label.source.txt
  - 去元数据、缩放后的衍生图与其哈希清单

为什么不能自动抓取：Mendeley 的整包 zip 下载需要浏览器会话，
其公开 API 的根目录只暴露标签文件，图片位于需要会话的归档内。
脚本会打印获取步骤，把原图放进 tmp/pilot_raw/ 后再跑 --prepare 即可。

衍生处理与既有的 prepare_pilot_images.py 保持一致（重新解码、Lanczos 缩放到
1280x720、JPEG 质量 88、去元数据），保证两批素材的预处理版本可比。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LABEL_FILE = HERE / "image_label.source.txt"
RAW_DIR = ROOT / "tmp" / "pilot_raw"
OUT_DIR = HERE / "images"
MANIFEST = HERE / "manifest.csv"

DERIVATIVE_SIZE = (1280, 720)
JPEG_QUALITY = 88

DATASET = {
    "title": ("Classification of pet dog skin diseases using deep learning "
              "with images captured from multispectral imaging device"),
    "authors": "Sungbo Hwang; Hyun Kil Shin; Jin Moon Park; Bosun Kwon; Myung-Gyun Kang",
    "doi": "10.17632/5dbht54kw7.1",
    "url": "https://data.mendeley.com/datasets/5dbht54kw7/1",
    "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "paper_doi": "10.1007/s13273-022-00249-7",
    "label_provenance": ("veterinarian clinical impression at hospital visit; "
                         "no confirmatory testing reported in source paper"),
    "consent": "written owner consent obtained per source paper",
    "reference_tier": "V1",
    "not_gold_warning": ("V1: veterinarian broad-class label without confirmatory testing. "
                         "Not eligible for the frozen core holdout or published accuracy claims."),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_labels() -> "dict[str, str]":
    if not LABEL_FILE.exists():
        sys.exit("找不到标签清单：%s" % LABEL_FILE)
    labels = {}
    for line_no, line in enumerate(LABEL_FILE.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            print("  跳过第 %d 行（格式不符）：%s" % (line_no, line), file=sys.stderr)
            continue
        labels[parts[0]] = parts[1]
    return labels


def find_raw(case_id: str) -> "Path | None":
    """原图命名可能是 <case>_pic0.jpg 或 <case>.jpg，两种都接受。"""
    for name in ("%s_pic0.jpg" % case_id, "%s.jpg" % case_id,
                 "%s_pic0.JPG" % case_id, "%s.JPG" % case_id):
        candidate = RAW_DIR / name
        if candidate.exists():
            return candidate
    return None


def cmd_check(labels: "dict[str, str]") -> int:
    present, missing = [], []
    for case_id in sorted(labels):
        (present if find_raw(case_id) else missing).append(case_id)

    print("=== V1 参考集图片就位情况 ===\n")
    print("标签清单共 %d 例" % len(labels))
    print("原图已就位 %d 例，缺失 %d 例\n" % (len(present), len(missing)))

    by_class: "dict[str, list[int]]" = {}
    for case_id in labels:
        cls = labels[case_id]
        slot = by_class.setdefault(cls, [0, 0])
        slot[1] += 1
        if find_raw(case_id):
            slot[0] += 1
    print("按类别（已就位 / 总数）：")
    for cls in sorted(by_class):
        got, total = by_class[cls]
        print("  %-40s %2d / %2d" % (cls, got, total))

    if missing:
        print("\n缺失 %d 例，case id：" % len(missing))
        for i in range(0, len(missing), 4):
            print("  " + "  ".join(missing[i:i + 4]))
        print("""
获取步骤（脚本无法自动完成，Mendeley 整包下载需要浏览器会话）：
  1. 打开 %s
  2. 点 Download All 取得 zip（CC BY 4.0，允许下载与修改）
  3. 把各 case 目录下的普通可见光 pic0.jpg 解压到：
       %s
     命名保持 <case_id>_pic0.jpg
  4. 重新运行本脚本的 --prepare

只处理普通可见光 pic0.jpg；多光谱通道图不进入本评估集，
因为产品接收的是手机普通照片，用多光谱图评估会高估真实场景表现。""".strip()
              % (DATASET["url"], RAW_DIR))
    return 0 if present else 1


def cmd_prepare(labels: "dict[str, str]") -> int:
    try:
        from PIL import Image
    except ImportError:
        sys.exit("需要 Pillow：python -m pip install Pillow")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    skipped = []

    for case_id in sorted(labels):
        raw = find_raw(case_id)
        if raw is None:
            skipped.append(case_id)
            continue

        original_sha = sha256_file(raw)
        with Image.open(raw) as img:
            original_size = img.size
            converted = img.convert("RGB").resize(DERIVATIVE_SIZE, Image.LANCZOS)

        out_path = OUT_DIR / ("%s_v1.jpg" % case_id)
        # 不带 exif 参数保存即去除元数据
        converted.save(out_path, "JPEG", quality=JPEG_QUALITY)

        rows.append({
            "derivative_file": out_path.name,
            "case_id": case_id,
            "original_file": raw.name,
            "dataset_label": labels[case_id],
            "reference_tier": DATASET["reference_tier"],
            "label_provenance": DATASET["label_provenance"],
            "consent": DATASET["consent"],
            "not_gold_warning": DATASET["not_gold_warning"],
            "source_title": DATASET["title"],
            "source_authors": DATASET["authors"],
            "source_doi": DATASET["doi"],
            "source_url": DATASET["url"],
            "paper_doi": DATASET["paper_doi"],
            "license": DATASET["license"],
            "license_url": DATASET["license_url"],
            "original_sha256": original_sha,
            "original_width": original_size[0],
            "original_height": original_size[1],
            "derivative_sha256": sha256_file(out_path),
            "derivative_width": DERIVATIVE_SIZE[0],
            "derivative_height": DERIVATIVE_SIZE[1],
            "modification": ("Decoded to RGB; resized with Lanczos to %dx%d; "
                             "JPEG quality %d; metadata stripped"
                             % (DERIVATIVE_SIZE[0], DERIVATIVE_SIZE[1], JPEG_QUALITY)),
        })

    if not rows:
        print("没有可处理的原图。先运行 --check 看获取步骤。")
        return 1

    with MANIFEST.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print("已处理 %d 例，衍生图写入 %s" % (len(rows), OUT_DIR))
    print("清单写入 %s" % MANIFEST)
    if skipped:
        print("\n仍缺 %d 例原图，当前评估集不完整。" % len(skipped))
        print("按类别分布（已就位）：")
        counts: "dict[str, int]" = {}
        for row in rows:
            counts[row["dataset_label"]] = counts.get(row["dataset_label"], 0) + 1
        for cls in sorted(counts):
            print("  %-40s %d" % (cls, counts[cls]))
        print("\n注意：类别样本量过小时，任何类别级比例都必须连同分子分母与区间报告。")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="V1 参考集图片准备")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="报告图片就位情况与获取步骤")
    group.add_argument("--prepare", action="store_true", help="处理已就位原图并写清单")
    args = parser.parse_args()

    labels = load_labels()
    sys.exit(cmd_check(labels) if args.check else cmd_prepare(labels))


if __name__ == "__main__":
    main()
