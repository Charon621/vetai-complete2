# -*- coding: utf-8 -*-
"""生成小程序内置衬线字体（BUG-UI58）。

背景：设计系统标题/病名/AI 回复用宋体，但中文字体靠系统字体栈在真机上不可靠——
安卓没有中文衬线，也不认 -apple-system / PingFang / Songti，整套会掉回黑体，
所以真机看不到开发者工具里的效果。wx.loadBuiltInFontFace 又只有微信自家无衬线字体。

方案：把思源宋体子集化后以 base64 内置进小程序，用 wx.loadFontFace 加载，
不依赖服务器、不需要配置 downloadFile 域名。

用法：
    python tools/build_font_subset.py

产物：
    utils/fontData.js              小程序运行时加载的 base64 字体（会被打包进去）
    <输出目录>/font-subset/  中间产物（源码字体、字符集、子集 woff2）；
                               Windows 默认 E:\CodexOutputs\vetai-complete2，
                               其他系统默认 ~/CodexOutputs/vetai-complete2，可用 VETAI_OUTPUT_DIR 覆盖

换字体或调整字符覆盖范围时，改 DOMAIN_TEXT / 常用字数量后重跑本脚本。
"""
import base64
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from output_paths import output_root  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = str(output_root("font-subset"))
SRC_FONT = os.path.join(OUT_DIR, "noto-serif-sc-cn.woff2")
SRC_URL = ("https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.5/files/"
           "noto-serif-sc-chinese-simplified-400-normal.woff2")
TARGET_JS = os.path.join(REPO, "utils", "fontData.js")
FAMILY = "VetAISerif"

# 格式必须用 WOFF：官方 Tips 写明「建议格式为 TTF 和 WOFF，WOFF2 在低版本 iOS 上会不兼容」。
# WOFF 比 WOFF2 大约 17%，但兼容性优先。
FLAVOR = "woff"

# GB2312 一级字按拼音序额外收录的个数。实测（WOFF，base64 后）：
#   0 个 -> 365 KB（界面文案 100%，常用字 32%）
#   600 个 -> 494 KB（43%）
#   1000 个 -> 574 KB（50%）
#   1500 个 -> 674 KB（59%，超主包余量）
# 取 0：界面文案全覆盖已经能保证视觉一致；base64 体积最小，
# 也让微信开发者工具 Babel 这一步的解析负担最轻（见下方生成逻辑的注意事项）。
# 想提高报告正文的字形覆盖率，把这个值调大后重跑本脚本即可。
EXTRA_COMMON = 0

# 皮肤科 / 宠物 / 就医场景的补充字，保证 AI 生成的报告正文尽量不缺字
DOMAIN_TEXT = (
    "皮肤病寄生虫真菌细菌感染过敏瘙痒脱毛掉毛红斑丘疹脓疱结痂鳞屑溃烂渗出异味"
    "湿疹皮炎螨虫疥癣猫狗犬皮肤瘙痒抓挠舔咬耳炎外耳道马拉色菌念珠菌癣菌"
    "结节肿块肿瘤良性恶性溃疡色素沉着脱色素角化过度皮屑油腻红斑狼疮免疫"
    "内分泌甲状腺肾上腺激素过敏原食物环境接触性日光激素药物剂量疗程就诊"
    "兽医宠物主人症状表现诊断鉴别可能方向建议观察复查随访转诊医院检查化验"
    "镜检刮片细胞学培养药敏血常规生化影像超免疫荧光病理活检手术切除"
    "轻微中度严重紧急风险等级立刻尽快就医观察居家护理清洁干燥消毒隔离"
    "体重年龄性别绝育疫苗驱虫品种血统哺乳幼年成年老年公母"
    "眼鼻口腔牙齿肛门生殖器四肢腹部背部胸部颈部头部尾巴爪垫全身局部"
    "照片清晰对焦光线角度距离参照整体近景细节圈选标注区域"
    "结果仅供参考不能替代面诊确诊请及时就诊"
)


def walk_sources():
    for base, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in
                   ("node_modules", ".git", "tests", "evaluation", "tools", "docs", "cloudfunctions")]
        for name in files:
            yield os.path.join(base, name)


def collect_chars():
    """界面文案字符 + 高频常用字 + 领域补充字。"""
    chars = set()

    # 1) WXML 文本节点 + 模板里的中文字面量
    for path in walk_sources():
        if path.endswith(".wxml"):
            text = open(path, encoding="utf-8").read()
            text = text.replace("<!--", "").replace("-->", "")
            for seg in text.split("<"):
                for ch in seg.split(">")[-1] if ">" in seg else seg:
                    chars.add(ch)
            for ch in text:
                if 0x2E7F < ord(ch):
                    chars.add(ch)
        elif path.endswith(".js"):
            text = open(path, encoding="utf-8").read()
            for quote in ("'", '"'):
                parts = text.split(quote)
                for i in range(1, len(parts), 2):
                    seg = parts[i]
                    if len(seg) < 200 and any(0x3000 <= ord(c) <= 0x9FFF for c in seg):
                        chars.update(seg)

    # 2) GB2312 一级字按拼音序取前 N 个（覆盖最常用字，N 见 EXTRA_COMMON）
    gb_l1 = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                gb_l1.append(bytes([hi, lo]).decode("gb2312"))
            except Exception:
                pass
    chars.update(gb_l1[:EXTRA_COMMON])

    # 3) 领域补充字
    chars.update(ch for ch in DOMAIN_TEXT if ch.strip())

    # 4) ASCII 可见字符 + 常用全角标点
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update("　、。〈〉《》「」『』【】〔〕！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］｛｜｝～￥·—…‘’“”")

    chars.discard("\n")
    chars.discard("\r")
    return chars


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.exists(SRC_FONT):
        print("缺少源字体，请先下载到 " + SRC_FONT)
        print("下载命令：curl -L --fail -o \"%s\" \"%s\"" % (SRC_FONT, SRC_URL))
        return 1

    chars = collect_chars()
    charset_file = os.path.join(OUT_DIR, "charset-final.txt")
    with open(charset_file, "w", encoding="utf-8") as fh:
        fh.write("".join(sorted(chars)))
    print("子集字符数: %d" % len(chars))

    subset = os.path.join(OUT_DIR, "vetai-serif.woff")
    cmd = [sys.executable, "-m", "fontTools.subset", SRC_FONT,
           "--text-file=" + charset_file,
           "--flavor=" + FLAVOR,
           "--layout-features=*",
           "--no-hinting",
           "--desubroutinize",
           "--output-file=" + subset]
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        print("子集化失败:\n" + (done.stderr or "")[-2000:])
        return 1

    size_kb = os.path.getsize(subset) / 1024
    b64 = base64.b64encode(open(subset, "rb").read()).decode("ascii")
    print("子集 %s: %.1f KB  ->  base64: %.1f KB" % (FLAVOR, size_kb, len(b64) / 1024))

    header = (
        "// 由 tools/build_font_subset.py 生成，请勿手改（BUG-UI58）。\n"
        "// 思源宋体（Noto Serif SC）子集，仅含界面与报告常用字。\n"
        "// 用途：真机安卓没有中文衬线，靠系统字体栈会掉回黑体，\n"
        "// 这里内置一份 base64 字体，由 app.js 用 wx.loadFontFace 加载。\n"
        "// 格式为 WOFF：官方文档明确 WOFF2 在低版本 iOS 上不兼容。\n"
        "//\n"
        "// 注意：不要改回「一个长字符串 + 加号拼接」的写法。\n"
        "// 那样 AST 会退化成几百层嵌套的二元表达式，微信开发者工具的 Babel\n"
        "// 编译这一步会 Maximum call stack size exceeded，整个包编译失败、页面白屏。\n"
        "// 这里用「多个短变量 + join」，AST 只有若干独立变量和一次数组字面量。\n"
    )
    # 每块 8 KB base64。块要小：单行过长时 Babel 解析字符串字面量也容易出问题
    # （实测 500 KB 单表达式会爆栈；8 KB 块留足余量）。
    chunk_size = 8 * 1024
    chunks = [b64[i:i + chunk_size] for i in range(0, len(b64), chunk_size)]
    lines = [header]
    for idx, chunk in enumerate(chunks):
        lines.append("var PART_%d = '%s'\n" % (idx, chunk))
    lines.append("\nvar FONT_BASE64 = [\n")
    for idx in range(len(chunks)):
        lines.append("  PART_%d,\n" % idx)
    lines.append("].join('')\n")
    lines.append("\nmodule.exports = { family: '%s', base64: FONT_BASE64 }\n" % FAMILY)
    with open(TARGET_JS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("".join(lines))
    print("已生成: %s（%d 块）" % (TARGET_JS, len(chunks)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
