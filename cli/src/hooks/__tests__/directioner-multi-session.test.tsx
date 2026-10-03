import { freebucksFixture } from '@beyonders/common/testing/directioner'
import {
  useDirectionerChatStore,
  selectDirectionerChatModel,
  requestDirectionerChatAdmission,
  directionerChatNeedsAdmission,
} from '../../state/directioner-chat-store'
import {
  beginDirectionerChatAdmission,
  useDirectionerChatAdmission,
} from '../use-directioner-chat-admission'
import { registerActiveRunStopHandler } from '../../utils/active-run'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot, flushSync } from '@opentui/react'
import React from 'react'
import {
  DIRECTIONER_MIMO_V25_MODEL_ID,
  DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
} from '@beyonders/common/constants/directioner-models'
import * as auth from '../../utils/auth'
import { useDirectionerSessionStore } from '../../state/directioner-session-store'
import { useDirectionerModelStore } from '../../state/directioner-model-store'
import { directionerSessionMetadata } from '../../utils/directioner-session-identity'
import { consumeDirectionerSessionRelaunch } from '../../utils/directioner-session-relaunch'
import * as cli from '../use-directioner-session'

// IS_HOSTED is a build-time constant. Run the controller in its own Directioner
// process instead of mocking an already-imported constant in other CLI suites.
if (process.env.CLI_MULTI_SESSION_TEST !== '1') {
  test('multi-instance CLI lifecycle (isolated Directioner build)', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: {
        ...process.env,
        HOSTED_MODE: 'true',
        CLI_MULTI_SESSION_TEST: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, output: code ? stdout + stderr : '' }).toEqual({
      code: 0,
      output: '',
    })
  }, 20_000)
} else {
  let close: (() => void) | undefined
  let fetchSpy: ReturnType<typeof spyOn>
  let authSpy: ReturnType<typeof spyOn>
  let configSpy: ReturnType<typeof spyOn>
  let configDir: string
  type Active = {
    status: 'active'
    model: string
    instanceId: string
    admittedAt: string
    expiresAt: string
    remainingMs: number
    accessTier: 'full' | 'limited'
  }
  const rows = new Map<string, Active>()
  const requests: { method: string; headers: Headers; path: string }[] = []
  let purchases = 0
  let capacity = Infinity
  let losePostResponse = false
  let loseDeleteResponse = false
  let tier: 'full' | 'limited' = 'full'
  let meter: ReturnType<typeof freebucksFixture> | undefined
  let rejectAdmission = false

  async function until(condition: () => boolean) {
    const deadline = performance.now() + 3_000
    while (!condition()) {
      if (performance.now() > deadline) throw new Error('CLI did not settle')
      await Bun.sleep(5)
    }
  }

  beforeEach(() => {
    useDirectionerChatStore.setState({
      admission: null,
      nextModel: null,
      pickerOpen: false,
    })
    meter = undefined
    rejectAdmission = false
    rows.clear()
    requests.length = 0
    purchases = 0
    capacity = Infinity
    losePostResponse = false
    loseDeleteResponse = false
    tier = 'full'
    configDir = mkdtempSync(join(tmpdir(), 'cli-multi-session-'))
    configSpy = spyOn(auth, 'getConfigDir').mockReturnValue(configDir)
    authSpy = spyOn(auth, 'getAuthTokenDetails').mockReturnValue({
      token: 'fixture',
      source: 'environment',
    })
    useDirectionerModelStore
      .getState()
      .setSelectedModel(DIRECTIONER_MIMO_V25_MODEL_ID)
    useDirectionerSessionStore.getState().setSession(null)
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      // Like the real transport: an already-aborted signal never reaches the
      // network. Without this, a request made on a dead controller passes.
      if (init?.signal?.aborted)
        throw new DOMException('The operation was aborted.', 'AbortError')
      const headers = new Headers(init?.headers)
      const method = init?.method ?? 'GET'
      const path = new URL(String(input)).pathname
      requests.push({ method, headers, path })
      // Exercise the real hook and transport against an independently keyed
      // session service. A global GET or DELETE would affect the sibling row.
      expect(headers.get('x-directioner-multi-session')).toBe('1')
      const id = headers.get('x-directioner-instance-id')!
      expect(id).toStartWith('cli:')
      if (method === 'GET')
        return Response.json(
          rows.get(id) ?? {
            status: 'none',
            accessTier: tier,
            freebucks: meter,
          },
        )
      expect(headers.get('x-directioner-desktop-attempt-id')).toBe(id.slice(4))
      if (method === 'DELETE') {
        expect(path).toEndWith('/session/attempt')
        rows.delete(id)
        if (loseDeleteResponse) {
          loseDeleteResponse = false
          throw new TypeError('response lost')
        }
        return Response.json({ status: 'ended', freebucksRefund: 0 })
      }
      if (rejectAdmission)
        return Response.json({ error: 'test refusal' }, { status: 403 })
      const model = headers.get('x-directioner-model')!
      const holder = [...rows.keys()].find((key) => key !== id)
      if (!rows.has(id) && rows.size >= capacity && holder) {
        if (headers.get('x-directioner-takeover-instance-id') !== holder)
          return Response.json(
            {
              status: 'purchase_capacity',
              requestedModel: model,
              currentInstanceId: holder,
              accessTier: tier,
              slotLimit: capacity,
            },
            { status: 409 },
          )
        rows.delete(holder)
      }
      if (!rows.has(id)) {
        purchases++
        rows.set(id, active(id, model))
      }
      if (losePostResponse) {
        losePostResponse = false
        throw new TypeError('response lost')
      }
      return Response.json(rows.get(id))
    }) as typeof fetch)
  })

  afterEach(async () => {
    close?.()
    close = undefined
    // Let the effect's bounded best-effort release finish before restoring fetch.
    await Bun.sleep(5)
    fetchSpy.mockRestore()
    authSpy.mockRestore()
    configSpy.mockRestore()
    useDirectionerSessionStore.getState().setSession(null)
    useDirectionerSessionStore.getState().setFailure(null)
    rmSync(configDir, { recursive: true, force: true })
  })

  function active(
    instanceId: string,
    model: string = DIRECTIONER_MIMO_V25_MODEL_ID,
  ): Active {
    return {
      status: 'active',
      instanceId,
      model,
      accessTier: tier,
      admittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      remainingMs: 3_600_000,
      ...(meter ? { freebucks: meter } : {}),
    }
  }

  async function mount(expectedStatus: 'none' | 'active' = 'none') {
    const setup = await createTestRenderer({ width: 30, height: 2 })
    const root = createRoot(setup.renderer)
    function Controller() {
      cli.useDirectionerSession()
      useDirectionerChatAdmission(true)
      return null
    }
    close = () => {
      flushSync(() => root.unmount())
      setup.renderer.destroy()
    }
    flushSync(() => root.render(<Controller />))
    await until(
      () =>
        useDirectionerSessionStore.getState().session?.status === expectedStatus,
    )
  }

  test('startup, admission, model switch and end never take a sibling session', async () => {
    rows.set('desktop-sibling', active('desktop-sibling'))
    await mount()
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const first = cli.getDirectionerInstanceId()!
    expect(rows.size).toBe(2)
    expect(directionerSessionMetadata(first)).toEqual({
      directioner_instance_id: first,
      directioner_multi_session: '1',
      surface: 'cli',
    })
    await cli.startDirectionerSession(DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID)
    const second = cli.getDirectionerInstanceId()!
    expect(second).not.toBe(first)
    expect(rows.has(first)).toBe(false)
    expect(rows.get(second)?.model).toBe(DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID)
    await cli.returnToDirectionerLanding()
    expect([...rows.keys()]).toEqual(['desktop-sibling'])
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(cli.getDirectionerInstanceId()).not.toBe(second)
    expect(purchases).toBe(3)
  })

  test('choosing a model never buys a session; the first send admits once', async () => {
    await mount()
    selectDirectionerChatModel(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(purchases).toBe(0)
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
    expect(directionerChatNeedsAdmission()).toBe(true)
    requestDirectionerChatAdmission()
    requestDirectionerChatAdmission()
    await until(
      () =>
        purchases === 1 && useDirectionerChatStore.getState().admission === null,
    )
    expect(directionerChatNeedsAdmission()).toBe(false)
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })

  test('switching models waits for send and confirmation and preserves the queued prompt', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    let queueCleared = false
    const unregister = registerActiveRunStopHandler(() => {
      queueCleared = true
    })
    try {
      selectDirectionerChatModel(DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID)
      expect(purchases).toBe(1)
      expect(cli.getDirectionerInstanceId()).toBeDefined()
      requestDirectionerChatAdmission()
      await until(
        () => useDirectionerChatStore.getState().admission?.phase === 'confirm',
      )
      expect(purchases).toBe(1)
      await beginDirectionerChatAdmission(
        useDirectionerChatStore.getState().admission!,
      )
      await until(() => useDirectionerChatStore.getState().admission === null)
      expect(purchases).toBe(2)
      expect(queueCleared).toBe(false)
      expect(rows.size).toBe(1)
      expect(directionerChatNeedsAdmission()).toBe(false)
    } finally {
      unregister()
    }
  })

  test('wallet consent is requested on send and bounded to the quoted spend', async () => {
    meter = {
      ...freebucksFixture(0, { [DIRECTIONER_MIMO_V25_MODEL_ID]: 5 }),
      balance: 10,
      wallet: { balance: 10, monthlyBonus: 0 },
    }
    await mount()
    selectDirectionerChatModel(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(purchases).toBe(0)
    requestDirectionerChatAdmission()
    await until(
      () => useDirectionerChatStore.getState().admission?.phase === 'confirm',
    )
    expect(purchases).toBe(0)
    expect(useDirectionerChatStore.getState().admission?.message).toContain(
      '5 from your wallet',
    )
    await beginDirectionerChatAdmission(useDirectionerChatStore.getState().admission!)
    await until(() => useDirectionerChatStore.getState().admission === null)
    expect(purchases).toBe(1)
    expect(
      requests
        .find((r) => r.method === 'POST')
        ?.headers.get('x-directioner-wallet-spend-limit'),
    ).toBe('5')
  })

  test('a lost model-switch reply can cancel the new claim without orphaning a purchase', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    selectDirectionerChatModel(DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID)
    requestDirectionerChatAdmission()
    await until(() => useDirectionerChatStore.getState().admission?.phase === 'confirm')
    losePostResponse = true
    await beginDirectionerChatAdmission(useDirectionerChatStore.getState().admission!)
    await until(() => useDirectionerChatStore.getState().admission?.phase === 'failed')
    expect(rows.size).toBe(1)
    expect(cli.getDirectionerInstanceId()).toBeUndefined()
    await cli.returnToDirectionerLanding({ preserveQueue: true })
    expect(rows.size).toBe(0)
  })

  test('first send refreshes an idle balance before deciding it cannot afford a session', async () => {
    meter = freebucksFixture(0, { [DIRECTIONER_MIMO_V25_MODEL_ID]: 5 })
    await mount()
    meter = freebucksFixture(25, { [DIRECTIONER_MIMO_V25_MODEL_ID]: 5 })
    requestDirectionerChatAdmission()
    await until(() => purchases === 1 && useDirectionerChatStore.getState().admission === null)
    expect(purchases).toBe(1)
  })

  test('failed admission stays held until the user retries', async () => {
    await mount()
    rejectAdmission = true
    requestDirectionerChatAdmission()
    await until(
      () => useDirectionerChatStore.getState().admission?.phase === 'failed',
    )
    expect(purchases).toBe(0)
    rejectAdmission = false
    requestDirectionerChatAdmission()
    await until(() => useDirectionerChatStore.getState().admission === null)
    expect(purchases).toBe(1)
  })

  test('an update relaunch resumes only its own launcher-scoped purchase', async () => {
    const previousPid = process.env.BEYONDERS_LAUNCHER_PID
    process.env.BEYONDERS_LAUNCHER_PID = '12345'
    try {
      rows.set('desktop-sibling', active('desktop-sibling'))
      await mount()
      await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
      const original = cli.getDirectionerInstanceId()!
      useDirectionerSessionStore.getState().keepSlotForRelaunch()
      await useDirectionerSessionStore.getState().releaseSlot()
      close!()
      close = undefined
      expect(rows.has(original)).toBe(true)
      expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)

      process.env.BEYONDERS_LAUNCHER_PID = '54321'
      expect(consumeDirectionerSessionRelaunch('fixture')).toBeUndefined()
      process.env.BEYONDERS_LAUNCHER_PID = '12345'
      useDirectionerSessionStore.getState().setSession(null)
      useDirectionerSessionStore.setState({ slotKeptForRelaunch: false })
      await mount('active')
      expect(cli.getDirectionerInstanceId()).toBe(original)
      expect(purchases).toBe(1)
      expect(rows.has('desktop-sibling')).toBe(true)
      expect(consumeDirectionerSessionRelaunch('fixture')).toBeUndefined()
    } finally {
      useDirectionerSessionStore.setState({ slotKeptForRelaunch: false })
      if (previousPid === undefined) delete process.env.BEYONDERS_LAUNCHER_PID
      else process.env.BEYONDERS_LAUNCHER_PID = previousPid
    }
  })

  // Discord 2026-09-25: "the CLI crashed ... when manually opened again the
  // freebucks are deducted even though the session was only running for 2
  // minutes". A crash skips every release and every update handoff; the only
  // trace is the dead process's live record.
  test('a relaunch after a crash resumes the unexpired hour instead of buying another', async () => {
    rows.set('desktop-sibling', active('desktop-sibling'))
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const original = cli.getDirectionerInstanceId()!
    const ownRecord = join(configDir, `directioner-live-${process.pid}.json`)
    await until(() => existsSync(ownRecord))
    expect(JSON.parse(readFileSync(ownRecord, 'utf8')).instanceId).toBe(
      original,
    )

    // The crash: no DELETE, and the record now names a process that is gone.
    const deadPid = Bun.spawnSync(['true']).pid
    const record = JSON.parse(readFileSync(ownRecord, 'utf8'))
    writeFileSync(
      join(configDir, `directioner-live-${deadPid}.json`),
      JSON.stringify({ ...record, ownerPid: deadPid }),
    )
    rmSync(ownRecord)
    useDirectionerSessionStore.setState({ slotKeptForRelaunch: true })
    close!()
    close = undefined
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)

    try {
      useDirectionerSessionStore.getState().setSession(null)
      useDirectionerSessionStore.setState({ slotKeptForRelaunch: false })
      await mount('active')
      expect(cli.getDirectionerInstanceId()).toBe(original)
      expect(purchases).toBe(1)
      expect(rows.has('desktop-sibling')).toBe(true)
      // Resumed exactly once: the dead record is gone, this process holds it now.
      expect(existsSync(join(configDir, `directioner-live-${deadPid}.json`))).toBe(
        false,
      )
      await until(() => existsSync(ownRecord))
    } finally {
      useDirectionerSessionStore.setState({ slotKeptForRelaunch: false })
    }
  })

  test('an explicit end leaves nothing for a later launch to resume', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const ownRecord = join(configDir, `directioner-live-${process.pid}.json`)
    await until(() => existsSync(ownRecord))
    await cli.returnToDirectionerLanding()
    expect(existsSync(ownRecord)).toBe(false)
  })

  test('an ambiguous POST retries the same purchase identity', async () => {
    await mount()
    losePostResponse = true
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(useDirectionerSessionStore.getState().failure?.outcomeUnknown).toBe(
      true,
    )
    const firstId = [...rows.keys()][0]
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(cli.getDirectionerInstanceId()).toBe(firstId)
    expect(purchases).toBe(1)
  })

  test('changing models after a lost POST ends that exact attempt before purchasing', async () => {
    await mount()
    losePostResponse = true
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const firstId = [...rows.keys()][0]!
    await cli.startDirectionerSession(DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID)
    expect(rows.has(firstId)).toBe(false)
    expect(rows.size).toBe(1)
    expect(cli.getDirectionerInstanceId()).not.toBe(firstId)
    expect(
      requests
        .filter((r) => r.method === 'DELETE')[0]
        ?.headers.get('x-directioner-instance-id'),
    ).toBe(firstId)
  })

  test('capacity preserves the holder until the user explicitly confirms takeover', async () => {
    tier = 'limited'
    capacity = 1
    rows.set('desktop-sibling', active('desktop-sibling'))
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(useDirectionerSessionStore.getState().session).toMatchObject({
      status: 'takeover_prompt',
      currentInstanceId: 'desktop-sibling',
    })
    expect(purchases).toBe(0)
    expect(rows.has('desktop-sibling')).toBe(true)
    await cli.takeOverDirectionerSession()
    expect(useDirectionerSessionStore.getState().session?.status).toBe('active')
    expect(rows.has('desktop-sibling')).toBe(false)
    expect(
      requests.at(-1)?.headers.get('x-directioner-takeover-instance-id'),
    ).toBe('desktop-sibling')
  })

  test('failed end keeps its identity for retry and cannot close a new purchase', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const first = cli.getDirectionerInstanceId()!
    loseDeleteResponse = true
    await expect(cli.returnToDirectionerLanding()).rejects.toThrow('response lost')
    expect(cli.getDirectionerInstanceId()).toBe(first)
    await cli.returnToDirectionerLanding()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(cli.getDirectionerInstanceId()).not.toBe(first)
    expect(rows.size).toBe(1)
  })

  test('unmount cancels an unacknowledged purchase without touching a sibling', async () => {
    rows.set('desktop-sibling', active('desktop-sibling'))
    await mount()
    losePostResponse = true
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    close!()
    close = undefined
    await until(() => rows.size === 1)
    expect(rows.has('desktop-sibling')).toBe(true)
  })

  test('clean exit cancels an unacknowledged purchase before the hook unmounts', async () => {
    await mount()
    losePostResponse = true
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    expect(rows.size).toBe(1)
    await useDirectionerSessionStore.getState().releaseSlot()
    expect(rows.size).toBe(0)
    expect(useDirectionerSessionStore.getState().pendingAdmission).toBeNull()
  })

  test('a missing/expired session rejoins on a fresh claim after retiring the old attempt', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const first = cli.getDirectionerInstanceId()!
    rows.delete(first)
    cli.markDirectionerSessionEnded()
    await cli.refreshDirectionerSession()
    expect(cli.getDirectionerInstanceId()).not.toBe(first)
    expect(rows.size).toBe(1)
    expect(purchases).toBe(2)
  })

  // Chat completions rejected mid-run with a session-ending gate code (428
  // waiting_room_required, 410 session_expired): the CLI marks the session
  // ended from outside the poll loop. The next send must still be admitted --
  // it used to fail its metadata refresh on the poll's already-aborted signal,
  // every retry failing the same way until the CLI was restarted.
  test('the send after a session ended mid-run is admitted, not refused', async () => {
    await mount()
    await cli.startDirectionerSession(DIRECTIONER_MIMO_V25_MODEL_ID)
    const first = cli.getDirectionerInstanceId()!
    rows.delete(first)
    cli.markDirectionerSessionEnded()
    expect(directionerChatNeedsAdmission()).toBe(true)
    requestDirectionerChatAdmission()
    await until(() => {
      const admission = useDirectionerChatStore.getState().admission
      return admission === null || admission.phase === 'failed'
    })
    expect(useDirectionerChatStore.getState().admission).toBeNull()
    expect(useDirectionerSessionStore.getState().session?.status).toBe('active')
    expect(directionerChatNeedsAdmission()).toBe(false)
    expect(rows.size).toBe(1)
    expect(purchases).toBe(2)
  })
}
