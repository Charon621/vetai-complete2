const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function postJson(url, apiKey, payload, timeoutMs, phase) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const body = JSON.stringify(payload || {})
    const target = new URL(url)

    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'POST',
      timeout: timeoutMs || 55000,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        text += chunk
      })
      res.on('end', () => {
        let data = null
        try {
          data = text ? JSON.parse(text) : {}
        } catch (e) {
          data = { raw: text }
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          data
        })
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error((phase || 'model-request') + ' DashScope request timeout after ' + (Date.now() - startedAt) + 'ms'))
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const apiKey = process.env.QWEN_API_KEY
  const apiBase = process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  const payload = event && event.payload
  const phase = event && event.phase
  const requestedTimeout = event && Number(event.timeoutMs)
  const timeoutMs = requestedTimeout > 0
    ? Math.min(requestedTimeout, 55000)
    : (phase === 'vision-precheck' ? 18000 : 55000)

  if (!apiKey) {
    return {
      success: false,
      error: '云函数环境变量 QWEN_API_KEY 未配置'
    }
  }

  if (!payload || !payload.model || !Array.isArray(payload.messages)) {
    return {
      success: false,
      error: '请求参数不完整'
    }
  }

  try {
    const response = await postJson(apiBase, apiKey, payload, timeoutMs, phase)
    if (!response.ok) {
      const detail = response.data && response.data.error
        ? (response.data.error.message || response.data.error.code || '')
        : ''
      return {
        success: false,
        statusCode: response.statusCode,
        error: '模型接口错误 ' + response.statusCode + (detail ? '：' + detail : ''),
        data: response.data
      }
    }

    return {
      success: true,
      statusCode: response.statusCode,
      data: response.data
    }
  } catch (err) {
    return {
      success: false,
      error: err && err.message ? err.message : '云函数请求模型失败'
    }
  }
}
