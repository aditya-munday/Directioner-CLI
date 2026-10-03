#!/usr/bin/env node

/**
 * Runtime network guard for the Directioner release wrapper.
 *
 * Preloaded with `node --require scripts/net-guard.cjs <entrypoint> ...`, it
 * replaces every Node networking primitive with a function that records the
 * attempt and throws. This is the offline proof for the launcher: `--version`
 * and `--doctor` must complete with zero attempts, and any future regression
 * that opens a socket fails the run loudly instead of passing a source grep.
 *
 * It is a runtime check on purpose. Grepping the source for `http` proves only
 * that a string is absent; this proves no connection is made, including through
 * an indirect dependency.
 *
 * Environment:
 *   NET_GUARD_LOG   file to append attempts to (default: stderr only)
 */

const fs = require('fs')
const net = require('net')
const http = require('http')
const https = require('https')
const dns = require('dns')
const tls = require('tls')

const LOG_PATH = process.env.NET_GUARD_LOG || ''

function record(kind, detail) {
  const line = `NET_GUARD ${kind} ${detail}\n`
  try {
    if (LOG_PATH) fs.appendFileSync(LOG_PATH, line)
    else process.stderr.write(line)
  } catch {
    // A failed record must not hide the attempt; the throw below still fires.
  }
  throw new Error(`NET_GUARD: blocked outbound ${kind} (${detail})`)
}

const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const target =
    typeof args[0] === 'object' && args[0] !== null
      ? `${args[0].host || args[0].path || '?'}:${args[0].port || ''}`
      : `${args[0]}:${args[1] ?? ''}`
  return record('socket.connect', target)
}
// Keep a handle so a future need to allow loopback is a deliberate edit, not a
// deletion of the guard.
net.__netGuardOriginalConnect = originalConnect

tls.connect = (...args) => record('tls.connect', JSON.stringify(args[0] || {}))

dns.lookup = (...args) => record('dns.lookup', String(args[0]))
dns.resolve = (...args) => record('dns.resolve', String(args[0]))
dns.resolve4 = (...args) => record('dns.resolve4', String(args[0]))
dns.resolve6 = (...args) => record('dns.resolve6', String(args[0]))

http.request = (...args) => record('http.request', JSON.stringify(args[0] || {}))
https.request = (...args) => record('https.request', JSON.stringify(args[0] || {}))
http.get = (...args) => record('http.get', JSON.stringify(args[0] || {}))
https.get = (...args) => record('https.get', JSON.stringify(args[0] || {}))

// Node's global fetch is backed by undici, which does not go through the
// http/https module functions above in all versions. Replace it outright.
globalThis.fetch = (...args) =>
  record('fetch', String(args[0] && args[0].url ? args[0].url : args[0]))
