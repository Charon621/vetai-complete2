const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
// 持久输出目录（仓库外），规则与 tools/output_paths.py、tools/knowledge-ops.js 一致：
// VETAI_OUTPUT_DIR 优先；Windows 默认 E 盘，其他系统默认 ~/CodexOutputs/vetai-complete2
const outputRoot = process.env.VETAI_OUTPUT_DIR ||
  (process.platform === 'win32' ? 'E:\\CodexOutputs\\vetai-complete2' : path.join(os.homedir(), 'CodexOutputs', 'vetai-complete2'))
const docxPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(outputRoot, 'prompt-docs', 'VetAI提示词优化与参考标准实施报告_规范修订版_2026-07-24.docx')
const previewJsPath = path.join(root, 'tmp', 'docx-preview.min.js')
const jsZipPath = path.join(root, 'tmp', 'jszip.min.js')
const outDir = path.join(outputRoot, 'prompt-docs', 'prompt_report_browser_qa_final3')
const printOutDir = path.join(outputRoot, 'prompt-docs', 'prompt_report_print_qa_final3')
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]
const executablePath = chromeCandidates.find(fs.existsSync)

if (!fs.existsSync(docxPath)) throw new Error('DOCX not found: ' + docxPath)
if (!fs.existsSync(previewJsPath)) throw new Error('docx-preview script not found: ' + previewJsPath)
if (!fs.existsSync(jsZipPath)) throw new Error('JSZip script not found: ' + jsZipPath)
if (!executablePath) throw new Error('Chrome/Edge executable not found')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(printOutDir, { recursive: true })

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>VetAI DOCX QA</title>
  <script src="/jszip.min.js"></script>
  <script src="/docx-preview.min.js"></script>
  <style>
    html, body { margin: 0; background: #d0d5dd; }
    #container { padding: 24px 0; }
    .docx-wrapper { background: #d0d5dd !important; padding: 0 !important; }
    section.docx { margin: 0 auto 24px auto !important; box-shadow: 0 2px 12px rgba(16,24,40,.25); }
    @page { size: Letter; margin: 0; }
    @media print {
      html, body, .docx-wrapper { background: #fff !important; }
      #container { padding: 0 !important; }
      section.docx {
        box-shadow: none !important;
        margin: 0 auto !important;
        break-after: page;
        overflow: visible !important;
      }
      tr, img { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div id="container"></div>
  <script>
    window.renderDone = false;
    window.renderError = '';
    fetch('/report.docx')
      .then(r => r.blob())
      .then(blob => docx.renderAsync(blob, document.getElementById('container'), null, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true
      }))
      .then(() => { window.renderDone = true; })
      .catch(err => { window.renderError = String(err && err.stack || err); window.renderDone = true; });
  </script>
</body>
</html>`

function sendFile(res, file, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  if (req.url === '/jszip.min.js') return sendFile(res, jsZipPath, 'application/javascript')
  if (req.url === '/docx-preview.min.js') return sendFile(res, previewJsPath, 'application/javascript')
  if (req.url === '/report.docx') {
    return sendFile(res, docxPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
})

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath })
    const page = await browser.newPage({ viewport: { width: 1500, height: 2100 }, deviceScaleFactor: 1 })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.renderDone === true, null, { timeout: 120000 })
    const renderError = await page.evaluate(() => window.renderError)
    if (renderError) throw new Error(renderError)
    await page.evaluate(() => document.fonts && document.fonts.ready)
    const pages = page.locator('section.docx')
    const count = await pages.count()
    if (!count) throw new Error('docx-preview rendered zero pages')
    for (let i = 0; i < count; i++) {
      await pages.nth(i).screenshot({
        path: path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`)
      })
    }
    await page.emulateMedia({ media: 'print' })
    const pdfPath = path.join(printOutDir, 'VetAI_prompt_report_browser_render.pdf')
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    })
    console.log(JSON.stringify({
      renderer: 'docx-preview',
      documentSections: count,
      sectionScreenshots: outDir,
      printPdf: pdfPath
    }, null, 2))
  } finally {
    if (browser) await browser.close()
    server.close()
  }
})
