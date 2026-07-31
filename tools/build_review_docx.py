# -*- coding: utf-8 -*-
"""
把《项目全景拆解与改进清单.md》转成美观的 Word 文档。
- 去掉所有 Markdown 符号（**、`、#、---）和字符画
- 中文正文微软雅黑，代码标识 Consolas 深蓝色
- 分级彩色标题、真实 Word 表格（表头着色、隔行灰底）
"""
import re
import sys
import io
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MD_PATH = r'c:\Users\Administrator\Desktop\vetai-complete2\项目全景拆解与改进清单.md'
OUT_PATH = r'c:\Users\Administrator\Desktop\vetai-complete2\项目全景拆解与改进清单.docx'

# 主题色
BRAND = RGBColor(0x2F, 0x54, 0x96)      # 深蓝（一级标题）
BRAND_2 = RGBColor(0x3B, 0x6BB, 0xB8) if False else RGBColor(0x3B, 0x6B, 0xB8)  # 中蓝（二级标题）
ACCENT = RGBColor(0xC0, 0x50, 0x4D)     # 红（Bug 编号）
GREEN = RGBColor(0x2E, 0x75, 0x3F)      # 绿（建议编号）
CODE_COLOR = RGBColor(0x1F, 0x3F, 0x77) # 代码标识
GRAY = RGBColor(0x59, 0x59, 0x59)
LIGHT_HEADER = '2F5496'
LIGHT_ROW = 'F2F5FB'

CN_FONT = u'微软雅黑'
CODE_FONT = 'Consolas'


def set_cn(run, font=CN_FONT):
    run.font.name = font
    run._element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)


def add_runs(paragraph, text, base_size=10.5, base_bold=False, base_color=None):
    """把含 **bold** 和 `code` 的文本拆成带格式的 run；顺带清理奇怪符号。"""
    text = clean_symbols(text)
    tokens = re.split(r'(\*\*.*?\*\*|`[^`]*`)', text)
    for tok in tokens:
        if not tok:
            continue
        if tok.startswith('**') and tok.endswith('**') and len(tok) > 4:
            inner = tok[2:-2]
            # 编号高亮
            color = base_color
            if re.match(r'^BUG-[A-Z]\d', inner):
                color = ACCENT
            elif re.match(r'^[A-Z]-\d', inner):
                color = GREEN
            run = paragraph.add_run(strip_inline(inner))
            run.bold = True
            run.font.size = Pt(base_size)
            if color:
                run.font.color.rgb = color
            set_cn(run)
        elif tok.startswith('`') and tok.endswith('`') and len(tok) > 2:
            run = paragraph.add_run(tok[1:-1])
            run.font.size = Pt(base_size - 0.5)
            run.font.color.rgb = CODE_COLOR
            run.bold = base_bold
            set_cn(run, CODE_FONT)
        else:
            run = paragraph.add_run(strip_inline(tok))
            run.bold = base_bold
            run.font.size = Pt(base_size)
            if base_color:
                run.font.color.rgb = base_color
            set_cn(run)


def strip_inline(t):
    return t.replace('**', '').replace('`', '')


def clean_symbols(t):
    """去掉/替换用户不喜欢的符号。"""
    t = t.replace('→', ' 到 ') if False else t  # 保留常规箭头以外的处理见下
    replacements = {
        '─┐': '', '─┘': '', '├→': '', '└→': '', '│': '',
        '×': 'x', '≤': '不超过', '≥': '不少于',
        '——': '，', '~': '至',
    }
    for k, v in replacements.items():
        t = t.replace(k, v)
    # 箭头统一为全角简洁箭头
    t = t.replace('->', '→')
    # 多余空格
    t = re.sub(r'[ \t]{2,}', ' ', t)
    return t


def shade_cell(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)


def set_cell_text(cell, text, bold=False, color=None, size=9.5, white=False):
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    add_runs(p, text, base_size=size, base_bold=bold,
             base_color=RGBColor(0xFF, 0xFF, 0xFF) if white else color)


def add_heading1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run(strip_inline(clean_symbols(text)))
    run.bold = True
    run.font.size = Pt(17)
    run.font.color.rgb = BRAND
    set_cn(run)
    # 底部粗边框线
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '12')
    bottom.set(qn('w:space'), '4')
    bottom.set(qn('w:color'), '2F5496')
    pBdr.append(bottom)
    pPr.append(pBdr)


def add_heading2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(strip_inline(clean_symbols(text)))
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = BRAND_2
    set_cn(run)


def add_heading3(doc, text):
    """实现方式 / Bug / 提升建议 小节标签，加浅色底。"""
    label = strip_inline(clean_symbols(text))
    color_map = {'Bug': 'C0504D', 'Bug / 缺口': 'C0504D',
                 '提升建议': '2E753F'}
    fill = None
    for key, c in color_map.items():
        if label.startswith(key):
            fill = c
            break
    if fill is None:
        fill = '2F5496'
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run('　' + label + '　')
    run.bold = True
    run.font.size = Pt(11.5)
    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    set_cn(run)
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), fill)
    pPr.append(shd)


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.6 + level * 0.5)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.3
    bullet = p.add_run('•  ')
    bullet.font.size = Pt(10.5)
    bullet.font.color.rgb = BRAND_2
    set_cn(bullet)
    add_runs(p, text)


def add_numbered(doc, num, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.6)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.3
    n = p.add_run(num + '  ')
    n.bold = True
    n.font.size = Pt(10.5)
    n.font.color.rgb = BRAND_2
    set_cn(n)
    add_runs(p, text)


def add_body(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.35
    add_runs(p, text)


def add_quote(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_after = Pt(3)
    add_runs(p, text, base_size=10, base_color=GRAY)


def add_table(doc, header, rows):
    table = doc.add_table(rows=len(rows) + 1, cols=len(header))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for j, h in enumerate(header):
        cell = table.rows[0].cells[j]
        set_cell_text(cell, h, bold=True, white=True, size=10)
        shade_cell(cell, LIGHT_HEADER)
    for i, row in enumerate(rows):
        for j in range(len(header)):
            val = row[j] if j < len(row) else ''
            cell = table.rows[i + 1].cells[j]
            set_cell_text(cell, val)
            if i % 2 == 1:
                shade_cell(cell, LIGHT_ROW)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


FLOW_STEPS = [
    ('第 1 步', '入口：首页表单式初筛（pages/index），或聊天页对话式问诊（pages/chat）'),
    ('第 2 步', '图片处理：utils/image.js 负责压缩、患处 ROI 裁剪，再交给 utils/api.js 的 diagnose 函数'),
    ('第 3 步', '视觉预检：轻量模型 qwen3.6-flash 按受控词表提取照片客观特征'),
    ('第 4 步', '本地检索：utils/kb.js 在 66 个病种卡上打分，选出临床参考候选'),
    ('第 5 步', '完整诊断：qwen3.7-plus 多模态模型，system 加 user 双段提示词'),
    ('第 6 步', '云函数代理：cloudfunctions/diagnose 负责鉴权、限流、请求净化，再转发 DashScope'),
    ('第 7 步', '结果处理：parseModelJson 五级容错解析，normalizeDiagnosis 做校准、清洗和安全护栏'),
    ('第 8 步', '落地：storage.addRecord 保存记录，跳转 pages/result 或 pages/chat/report 展示报告'),
]


def main():
    with open(MD_PATH, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')

    doc = Document()

    # 页面设置
    for section in doc.sections:
        section.top_margin = Cm(2.2)
        section.bottom_margin = Cm(2.2)
        section.left_margin = Cm(2.4)
        section.right_margin = Cm(2.4)

    normal = doc.styles['Normal']
    normal.font.name = CN_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)

    # ── 封面标题区 ──
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    t.paragraph_format.space_before = Pt(60)
    run = t.add_run('VetAI 项目全景拆解与改进清单')
    run.bold = True
    run.font.size = Pt(26)
    run.font.color.rgb = BRAND
    set_cn(run)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = sub.add_run('宠物皮肤 AI 初筛小程序 · 代码审查报告')
    run.font.size = Pt(13)
    run.font.color.rgb = GRAY
    set_cn(run)

    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    meta.paragraph_format.space_after = Pt(30)
    run = meta.add_run('覆盖范围：全部页面、工具层、组件、云函数与测试　|　共 13 个模块 · 50 余项问题 · 30 余条建议')
    run.font.size = Pt(10)
    run.font.color.rgb = GRAY
    set_cn(run)

    in_code = False
    in_table = False
    table_header = []
    table_rows = []
    flow_inserted = False

    def flush_table():
        nonlocal in_table, table_header, table_rows
        if in_table and table_header:
            add_table(doc, table_header, table_rows)
        in_table = False
        table_header = []
        table_rows = []

    for raw in lines:
        line = raw.rstrip()

        # 代码块（数据流字符画）→ 替换为流程步骤
        if line.startswith('```'):
            if not in_code and not flow_inserted:
                for num, txt in FLOW_STEPS:
                    add_numbered(doc, num, txt)
                flow_inserted = True
            in_code = not in_code
            continue
        if in_code:
            continue

        # 表格
        if line.startswith('|'):
            cells = [c.strip() for c in line.strip('|').split('|')]
            if all(re.match(r'^:?-{2,}:?$', c) for c in cells if c):
                continue
            if not in_table:
                in_table = True
                table_header = cells
            else:
                table_rows.append(cells)
            continue
        else:
            flush_table()

        if not line.strip():
            continue
        if line.strip() == '---':
            continue

        if line.startswith('> '):
            add_quote(doc, line[2:])
        elif line.startswith('# '):
            text = line[2:]
            if 'VetAI 项目全景拆解' in text:
                continue  # 封面已有
            add_heading1(doc, text)
        elif line.startswith('## '):
            add_heading2(doc, line[3:])
        elif line.startswith('### '):
            add_heading3(doc, line[4:])
        elif re.match(r'^\d+\.\s', line):
            m = re.match(r'^(\d+)\.\s(.*)$', line)
            add_numbered(doc, '（' + m.group(1) + '）', m.group(2))
        elif line.startswith('- '):
            add_bullet(doc, line[2:])
        else:
            add_body(doc, line)

    flush_table()
    doc.save(OUT_PATH)
    print('saved:', OUT_PATH)

    # 校验能重新打开
    check = Document(OUT_PATH)
    print('paragraphs:', len(check.paragraphs), 'tables:', len(check.tables))


if __name__ == '__main__':
    main()
