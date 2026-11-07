import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudSync } from "../electron/services/cloud"
import { MeetingStore } from "../electron/services/meetings"
import { SettingsStore } from "../electron/services/settings"
import type { Prompt } from "../shared/types"

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

type UploadedPrompt = Required<Prompt> & { active: boolean }
const prompt = (id: string): Prompt => ({ id, title: id, content: `Instructions for ${id}`, notes: "" })
function reply(prompts: UploadedPrompt[]): Response {
  return new Response(JSON.stringify({ prompts: prompts.map((item) => ({ ...item, id: item.id.replace(/^local-/, "server-") })) }), { status: 200 })
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtx-cloud-prompts-"))
  dirs.push(dir)
  const settings = new SettingsStore(path.join(dir, "settings.json"))
  settings.update({ cloud: { url: "https://account.example", token: "fixture-token", userId: "u1", email: "fixture@example.invalid", linkedAt: 1 },
    prompts: [prompt("local-a"), prompt("local-c")], activePromptId: "local-a" })
  const sync = new CloudSync({ settings, meetings: new MeetingStore(path.join(dir, "meetings.json")), appVersion: "1.3.1", openExternal: async () => {} })
  const internal = sync as unknown as { pushPrompts(initial: boolean): Promise<void>; applyRemotePrompts(prompts: UploadedPrompt[]): void }
  const started = deferred<UploadedPrompt[]>()
  const firstResponse = deferred<Response>()
  const requests: UploadedPrompt[][] = []
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const uploaded = (JSON.parse(String(init.body)) as { prompts: UploadedPrompt[] }).prompts
    requests.push(uploaded)
    if (requests.length === 1) {
      started.resolve(uploaded)
      return firstResponse.promise
    }
    return reply(uploaded)
  })
  vi.stubGlobal("fetch", fetcher)
  return { settings, internal, started, firstResponse, requests, fetcher }
}

describe("prompt cloud synchronization", () => {
  it("preserves edits, additions, deletions and the latest active choice while assigning server ids", async () => {
    const { settings, internal, started, firstResponse, requests } = setup()
    const upload = internal.pushPrompts(true)
    const uploaded = await started.promise
    const edited = { ...prompt("local-a"), title: "Edited title", content: "Latest saved instructions", notes: "Latest saved background" }
    settings.update({ prompts: [edited, prompt("local-b")], activePromptId: "local-b" })
    firstResponse.resolve(reply(uploaded))
    await upload
    expect(settings.get().prompts).toEqual([{ ...edited, id: "server-a" }, prompt("local-b")])
    expect(settings.get().activePromptId).toBe("local-b")

    await internal.pushPrompts(false)
    expect(requests[1]).toEqual([{ ...edited, id: "server-a", active: false }, { ...prompt("local-b"), active: true }])
    expect(settings.get().activePromptId).toBe("server-b")
    expect(settings.get().prompts.some((item) => ["local-c", "server-c"].includes(item.id))).toBe(false)
  })

  it("remaps the current active choice rather than restoring the uploaded active choice", async () => {
    const { settings, internal, started, firstResponse } = setup()
    const upload = internal.pushPrompts(true)
    const uploaded = await started.promise
    settings.update({ activePromptId: "local-c" })
    firstResponse.resolve(reply(uploaded))
    await upload
    expect(settings.get().activePromptId).toBe("server-c")
  })

  it("serializes uploads and sends the latest saved content with remapped ids next", async () => {
    const { settings, internal, started, firstResponse, requests, fetcher } = setup()
    const first = internal.pushPrompts(true)
    const uploaded = await started.promise
    const edited = { ...prompt("local-a"), content: "Newer saved instructions" }
    settings.update({ prompts: [edited, prompt("local-c")] })
    const second = internal.pushPrompts(false)
    try {
      await Promise.resolve()
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      firstResponse.resolve(reply(uploaded))
      await Promise.all([first, second])
    }
    expect(requests).toHaveLength(2)
    expect(requests[1][0]).toMatchObject({ id: "server-a", content: "Newer saved instructions" })
    expect(settings.get().prompts[0]).toMatchObject({ id: "server-a", content: "Newer saved instructions" })
    await internal.pushPrompts(false)
    expect(requests).toHaveLength(2)
  })

  it("ignores an in-flight upload echo instead of replacing newer local saves", async () => {
    const { settings, internal, started, firstResponse } = setup()
    const upload = internal.pushPrompts(true)
    const uploaded = await started.promise
    const edited = { ...prompt("local-a"), content: "New local instructions" }
    settings.update({ prompts: [edited, prompt("local-b")], activePromptId: "local-b" })
    internal.applyRemotePrompts(uploaded.map((item) => ({ ...item, id: item.id.replace(/^local-/, "server-") })))
    firstResponse.resolve(reply(uploaded))
    await upload
    internal.applyRemotePrompts(uploaded.map((item) => ({ ...item, id: item.id.replace(/^local-/, "server-") })))
    expect(settings.get().prompts).toEqual([{ ...edited, id: "server-a" }, prompt("local-b")])
    expect(settings.get().activePromptId).toBe("local-b")
  })

  it("keeps the upload queue usable after a failed request", async () => {
    const { settings, internal, started, firstResponse, requests } = setup()
    const first = internal.pushPrompts(true)
    await started.promise
    const failure = expect(first).rejects.toThrow("Temporarily unavailable")
    firstResponse.resolve(new Response(JSON.stringify({ message: "Temporarily unavailable" }), { status: 503 }))
    await failure
    settings.update({ prompts: [{ ...prompt("local-a"), content: "Retry the latest saved instructions" }] })
    await internal.pushPrompts(false)
    expect(requests).toHaveLength(2)
    expect(requests[1][0].content).toBe("Retry the latest saved instructions")
    expect(settings.get().prompts[0].id).toBe("server-a")
  })
})
