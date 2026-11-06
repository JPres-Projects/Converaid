import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<unknown>>() }))
vi.mock("electron", () => ({ app: {}, shell: {}, dialog: {}, ipcMain: { handle: (channel: string, callback: any) => handlers.set(channel, callback) } }))
import { registerIpc } from "../electron/ipc"

afterEach(() => { handlers.clear(); vi.clearAllMocks() })
function setup() {
  const frame = {}
  const preparation = { getState: vi.fn(() => ({ active: null })), start: vi.fn(() => ({ active: {} })) }
  const windows = Object.assign(new EventEmitter(), { kindOf: () => "chat", broadcast: vi.fn(), setPanelTab: vi.fn(), hide: vi.fn() })
  const chat = Object.assign(new EventEmitter(), { isAnswerPending: false })
  const state = { busy: false }
  const simulation = Object.assign(new EventEmitter(), { getState: () => state })
  const session = Object.assign(new EventEmitter(), { start: vi.fn(), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() })
  const settings = Object.assign(new EventEmitter(), { get: () => ({}), onChange: () => {}, update: vi.fn() })
  registerIpc({ preparation, settings, windows, session, simulation, chat, projectKnowledge: {}, suggestions: new EventEmitter(), meetings: new EventEmitter(), cloud: new EventEmitter(), plan: new EventEmitter(), reports: {}, logger: {}, ownKey: {}, transcripts: {} } as never)
  const invoke = (channel: string, ...args: unknown[]) => {
    const callback = handlers.get(channel)
    if (!callback) return Promise.reject(new Error(`Missing handler ${channel}`))
    return callback({ sender: { mainFrame: frame }, senderFrame: frame }, ...args)
  }
  return { invoke, frame, preparation, windows, chat, state, session, settings }
}

describe("Preparation IPC", () => {
  it("starts from the trusted panel, hides it and returns to Listen without recording or writing settings", async () => {
    const { invoke, preparation, windows, session, settings } = setup()
    await expect(invoke("preparation:state")).resolves.toEqual({ active: null })
    const draft = { title: "", organization: "", focus: "", requirements: "" }
    await invoke("preparation:start", draft)
    expect(preparation.start).toHaveBeenCalledExactlyOnceWith(draft)
    expect(windows.setPanelTab).toHaveBeenCalledWith("answers")
    expect(windows.hide).toHaveBeenCalledWith("chat")
    expect(session.start).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
    await invoke("panel:set-tab", "preparation")
    expect(windows.setPanelTab).toHaveBeenLastCalledWith("preparation")
  })
  it("rejects untrusted subframes for both preparation handlers", async () => {
    const { preparation } = setup()
    for (const channel of ["preparation:state", "preparation:start"]) {
      const callback = handlers.get(channel)
      expect(callback).toBeDefined()
      await expect(callback!({ sender: { mainFrame: {} }, senderFrame: {} }, {})).rejects.toThrow("Untrusted IPC sender")
    }
    expect(preparation.start).not.toHaveBeenCalled()
  })
  it("rejects Start during live answers, auto-answer probes or simulation answers", async () => {
    const { invoke, chat, state, preparation, windows } = setup()
    chat.isAnswerPending = true
    await expect(invoke("preparation:start", {})).rejects.toThrow(/answer/i)
    chat.isAnswerPending = false
    state.busy = true
    await expect(invoke("preparation:start", {})).rejects.toThrow(/answer/i)
    expect(preparation.start).not.toHaveBeenCalled()
    expect(windows.hide).not.toHaveBeenCalled()
  })
  it("retains preparation when listening is paused, finished or canceled", async () => {
    const { invoke, preparation } = setup()
    for (const channel of ["session:pause", "session:finish", "session:cancel"]) await invoke(channel)
    expect(preparation.start).not.toHaveBeenCalled()
  })
})
