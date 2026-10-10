# -*- coding: utf-8 -*-
"""持久输出目录（仓库外）。规则与 tools/knowledge-ops.js 的 outputRoot() 保持一致：

- 设置了 VETAI_OUTPUT_DIR 时优先使用；
- Windows 默认 E:\\CodexOutputs\\vetai-complete2（C 盘空间紧张时放 E 盘）；
- macOS / Linux 默认 ~/CodexOutputs/vetai-complete2。

调用 output_root("prompt-docs", "x.docx") 得到对应子路径，目录由调用方按需创建。
"""
import os
import sys
from pathlib import Path


def output_root(*parts):
    base = os.environ.get("VETAI_OUTPUT_DIR")
    if not base:
        if sys.platform == "win32":
            base = r"E:\CodexOutputs\vetai-complete2"
        else:
            base = str(Path.home() / "CodexOutputs" / "vetai-complete2")
    return Path(base).joinpath(*parts)
