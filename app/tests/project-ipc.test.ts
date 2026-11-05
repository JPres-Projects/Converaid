import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "../shared/types"

const { handlers, choose } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), choose: vi.fn()
}))
vi.mock("electron", () => ({ app: {}, shell: {},
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
  dialog: { showOpenDialog: choose }
}))
import { registerIpc } from "../electron/ipc"
afterEach(() => { handlers.clear(); vi.clearAllMocks() })

function setup() {
  let state = { ...DEFAULT_SETTINGS, projectFolder: "C:\\previous-project", projectExperience: "I maintained the API." }
  const frame = {}
  const windows = Object.assign(new EventEmitter(), { kindOf: () => "chat", broadcast: vi.fn(), setPanelExtra: vi.fn() })
  const settings = Object.assign(new EventEmitter(), { get: () => state, view: () => state, onChange: () => {},
    update: (patch: Partial<typeof state>) => { state = { ...state, ...patch } }
  })
  const service = () => new EventEmitter()
  registerIpc({ settings, windows, session: Object.assign(service(), { state: () => ({ status: "idle" }) }),
    chat: service(), suggestions: service(), meetings: service(), cloud: service(), plan: service(),
    reports: {}, logger: {}, ownKey: {}, transcripts: {} } as never)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return handler({ sender: { mainFrame: frame }, senderFrame: frame }, ...args)
  }
  return { invoke, settings }
}

describe("local project selection IPC", () => {
  it("only uses the folder returned by the native picker", async () => {
    const { invoke, settings } = setup()
    choose.mockResolvedValue({ canceled: false, filePaths: ["C:\\chosen-project"] })
    await invoke("project:choose", "C:\\untrusted-renderer-path")
    expect(settings.get().projectFolder).toBe("C:\\chosen-project")
    expect(settings.get().projectExperience).toBe("")
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ properties: ["openDirectory"] }))
  })
  it("preserves the project and experience when selection is canceled", async () => {
    const { invoke, settings } = setup()
    choose.mockResolvedValue({ canceled: true, filePaths: [] })
    await invoke("project:choose")
    expect(settings.get().projectFolder).toBe("C:\\previous-project")
    expect(settings.get().projectExperience).toBe("I maintained the API.")
  })
  it("clears the folder and its personal experience together", async () => {
    const { invoke, settings } = setup()
    await invoke("project:clear")
    expect(settings.get().projectFolder).toBe("")
    expect(settings.get().projectExperience).toBe("")
  })
  it("refuses folder selection from an unowned renderer", async () => {
    setup()
    await expect(handlers.get("project:choose")!({ sender: { mainFrame: {} }, senderFrame: {} })).rejects.toThrow("Untrusted IPC sender")
    expect(choose).not.toHaveBeenCalled()
  })
})
