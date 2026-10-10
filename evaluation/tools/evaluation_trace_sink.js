// BUG-34：仅显式离线注入。同步落盘失败由调用链标记 unscorable。
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto')
function scrub(value, key) {
  if (/api.?key|authorization|token|secret|image_url|base64/i.test(key || '')) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(v => scrub(v, key))
  if (value && typeof value === 'object') {
    const out = {}; Object.keys(value).forEach(k => { out[k] = scrub(value[k], k) }); return out
  }
  return value
}
function create(options) {
  options = options || {}; const events = [], id = options.id || crypto.randomBytes(8).toString('hex')
  let fd = null, bytes = 0
  if (options.path) {
    if (!path.isAbsolute(options.path)) throw new Error('trace path must be absolute')
    fs.mkdirSync(path.dirname(options.path), { recursive: true }); fd = fs.openSync(options.path, 'wx')
  }
  return {
    events,
    emit(event) {
      const clean = scrub(event), line = JSON.stringify(clean) + '\n'
      bytes += Buffer.byteLength(line)
      if (bytes > (options.maxBytes === undefined ? 8 * 1024 * 1024 : options.maxBytes)) throw new Error('trace size limit')
      if (fd !== null) fs.writeSync(fd, line)
      events.push(clean); return 'offline-trace:' + id
    },
    close() { if (fd !== null) { fs.closeSync(fd); fd = null } }
  }
}
module.exports = { create, scrub }
