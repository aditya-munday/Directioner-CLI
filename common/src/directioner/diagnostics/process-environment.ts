/**
 * The real {@link DiagnosticEnvironment}: read-only files, symlinks, and
 * allowlisted executables, with bounded output and time.
 *
 * This is the only place diagnostics touch the actual system. Everything is
 * read-only: `readTextFile`, `readLink`, and `readDir` never write; `run`
 * refuses anything outside {@link DIAGNOSTIC_EXECUTABLES} and starts a process
 * with `spawn`, an absolute path, and a fixed argument array — there is no
 * shell, so no argument can be interpreted as a command.
 *
 * The `run` implementation kills on timeout and on abort, and it caps capture
 * at `maxBytes`. The environment it passes to the child is scrubbed of
 * credential-shaped variables, so a diagnostic cannot read a provider key out
 * of its own process environment.
 */

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import {
  accessSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs'

import { DIAGNOSTIC_EXECUTABLES } from './linux'

import type {
  DiagnosticEnvironment,
  DiagnosticErrorClass,
  DirOutcome,
  ReadOutcome,
  RunOutcome,
  RunSpec,
} from './types'

const ALLOWED_EXECUTABLES = new Set<string>(Object.values(DIAGNOSTIC_EXECUTABLES))

/**
 * Build the production environment. `env` defaults to `process.env`; pass a
 * scrubbed copy to remove credentials the child should never see. The child
 * always receives only `PATH`, `LANG`, `LC_ALL`, and `HOME` from whatever is
 * supplied here.
 */
export function createProcessDiagnosticEnvironment(
  options: { env?: NodeJS.ProcessEnv; now?: () => string } = {},
): DiagnosticEnvironment {
  const baseEnv = options.env ?? process.env
  return {
    platform: process.platform,
    arch: process.arch,
    now: options.now ?? (() => new Date().toISOString()),
    readTextFile,
    exists: (path) => existsSync(path),
    readLink,
    readDir,
    run: (spec) => runExecutable(spec, baseEnv),
  }
}

function classifyFsError(err: unknown): DiagnosticErrorClass {
  switch ((err as NodeJS.ErrnoException | undefined)?.code) {
    case 'ENOENT':
      return 'missing_source'
    case 'EACCES':
    case 'EPERM':
      return 'permission_denied'
    default:
      return 'unsupported'
  }
}

function readTextFile(path: string, maxBytes: number): ReadOutcome {
  try {
    const buf = readFileSync(path)
    const truncated = buf.byteLength > maxBytes
    const slice = truncated ? buf.subarray(0, maxBytes) : buf
    return { ok: true, text: slice.toString('utf8'), truncated }
  } catch (err) {
    return { ok: false, errorClass: classifyFsError(err) }
  }
}

function readLink(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

function readDir(path: string): DirOutcome {
  try {
    return { ok: true, entries: readdirSync(path) as string[] }
  } catch (err) {
    return { ok: false, errorClass: classifyFsError(err) }
  }
}

/**
 * Run an allowlisted executable. Refuses anything not in the allowlist, runs
 * without a shell, caps capture, and kills on timeout/cancel. Only a small,
 * scrubbed environment is passed to the child.
 */
async function runExecutable(
  spec: RunSpec,
  baseEnv: NodeJS.ProcessEnv,
): Promise<RunOutcome> {
  if (!ALLOWED_EXECUTABLES.has(spec.executable)) {
    return { ok: false, errorClass: 'validation_failed' }
  }
  try {
    accessSync(spec.executable, constants.X_OK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    return {
      ok: false,
      errorClass: code === 'ENOENT' ? 'missing_executable' : 'permission_denied',
    }
  }

  const childEnv: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'HOME'] as const) {
    if (baseEnv[key] !== undefined) childEnv[key] = baseEnv[key]
  }

  return await new Promise<RunOutcome>((resolve) => {
    let settled = false
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const child = spawn(spec.executable, [...spec.args], {
      env: childEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const finish = (outcome: RunOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      spec.signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const kill = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Process already gone.
      }
    }

    const timer = setTimeout(() => {
      kill()
      finish({ ok: false, errorClass: 'timeout' })
    }, spec.timeoutMs)

    const onAbort = () => {
      kill()
      finish({ ok: false, errorClass: 'cancelled' })
    }
    if (spec.signal) {
      if (spec.signal.aborted) {
        onAbort()
        return
      }
      spec.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = spec.maxBytes - stdoutBytes
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (chunk.byteLength > remaining) truncated = true
      stdoutChunks.push(chunk.subarray(0, Math.max(remaining, 0)))
      stdoutBytes += Math.min(chunk.byteLength, remaining)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = spec.maxBytes - stderrBytes
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (chunk.byteLength > remaining) truncated = true
      stderrChunks.push(chunk.subarray(0, Math.max(remaining, 0)))
      stderrBytes += Math.min(chunk.byteLength, remaining)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finish({ ok: false, errorClass: 'missing_executable' })
      } else if (err.code === 'EACCES' || err.code === 'EPERM') {
        finish({ ok: false, errorClass: 'permission_denied' })
      } else {
        finish({ ok: false, errorClass: 'unsupported' })
      }
    })
    child.on('close', (code) => {
      finish({
        ok: true,
        status: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated,
      })
    })
  })
}
