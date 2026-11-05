import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }))
vi.mock("electron", () => ({ app: {}, shell: {}, dialog: {},
  ipcMain: { handle: (channel: string, callback: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, callback) }
}))
import { registerIpc } from "../electron/ipc"

afterEach(() => { handlers.clear(); vi.clearAllMocks() })

function setup() {
  const frame = {}
  const order: string[] = []
  const state = { role: "interviewer", turns: [], busy: false, listening: false, voiceConnected: false, interim: "", notice: null }
  const simulation = Object.assign(new EventEmitter(), {
    getState: vi.fn(() => state), setRole: vi.fn(() => state), send: vi.fn(async () => {}),
    setListening: vi.fn(async () => { order.push("simulation-stop"); return state }), sendAudio: vi.fn(), clear: vi.fn()
  })
  const windows = Object.assign(new EventEmitter(), { kindOf: () => "chat", broadcast: vi.fn() })
  const session = Object.assign(new EventEmitter(), { state: () => ({ status: "idle" }), start: vi.fn(async () => { order.push("live-start"); return { status: "recording" } }) })
  const settings = Object.assign(new EventEmitter(), { get: () => ({}), onChange: () => {} })
  registerIpc({ settings, windows, session, simulation, chat: new EventEmitter(), projectKnowledge: {}, suggestions: new EventEmitter(),
    meetings: new EventEmitter(), cloud: new EventEmitter(), plan: new EventEmitter(), reports: {}, logger: {}, ownKey: {}, transcripts: {} } as never)
  const invoke = (channel: string, ...args: unknown[]) => {
    const callback = handlers.get(channel)
    if (!callback) throw new Error(`Missing IPC handler: ${channel}`)
    return callback({ sender: { mainFrame: frame }, senderFrame: frame }, ...args)
  }
  return { invoke, simulation, windows, state, order }
}

describe("simulation IPC", () => {
  it("exposes state and forwards typed requests through the trusted wrapper", async () => {
    const { invoke, simulation, state } = setup()
    await expect(invoke("simulation:state")).resolves.toEqual(state)
    await invoke("simulation:role", "candidate")
    await invoke("simulation:send", "What did you build?")
    await invoke("simulation:listen", true)
    await invoke("simulation:audio", new ArrayBuffer(64))
    await invoke("simulation:clear")
    expect(simulation.setRole).toHaveBeenCalledWith("candidate")
    expect(simulation.send).toHaveBeenCalledWith("What did you build?")
    expect(simulation.setListening).toHaveBeenCalledWith(true)
    expect(simulation.sendAudio).toHaveBeenCalledOnce()
    expect(simulation.clear).toHaveBeenCalledOnce()
  })

  it("rejects malformed and oversized renderer input before service calls", async () => {
    const { invoke, simulation } = setup()
    for (const role of ["assistant", null, {}, 1]) await expect(invoke("simulation:role", role)).rejects.toThrow(/role/i)
    for (const text of [null, {}, 1, "x".repeat(20_001)]) await expect(invoke("simulation:send", text)).rejects.toThrow(/text/i)
    for (const enabled of [null, "true", 1]) await expect(invoke("simulation:listen", enabled)).rejects.toThrow(/listening/i)
    for (const audio of [null, {}, new Uint8Array(32), new ArrayBuffer(262_148)]) await expect(invoke("simulation:audio", audio)).rejects.toThrow(/audio/i)
    expect(simulation.send).not.toHaveBeenCalled()
    expect(simulation.setRole).not.toHaveBeenCalled()
    expect(simulation.sendAudio).not.toHaveBeenCalled()
  })

  it("rejects unknown renderer frames for every simulation operation", async () => {
    setup()
    for (const channel of ["simulation:state", "simulation:role", "simulation:send", "simulation:listen", "simulation:audio", "simulation:clear"]) {
      await expect(handlers.get(channel)!({ sender: { mainFrame: {} }, senderFrame: {} }, "candidate")).rejects.toThrow("Untrusted IPC sender")
    }
  })

  it("broadcasts simulation state separately and stops its microphone before a live meeting starts", async () => {
    const { invoke, simulation, windows, state, order } = setup()
    simulation.emit("state", state)
    expect(windows.broadcast).toHaveBeenCalledExactlyOnceWith("simulation:changed", state)
    await invoke("session:start")
    expect(order).toEqual(["simulation-stop", "live-start"])
  })
})
