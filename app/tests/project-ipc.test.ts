import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SettingsStore } from "../electron/services/settings"

const { handlers, choose } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), choose: vi.fn()
}))
vi.mock("electron", () => ({ app: {}, shell: {},
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
  dialog: { showOpenDialog: choose }
}))
import { registerIpc } from "../electron/ipc"
const dirs: string[] = []
afterEach(() => {
  handlers.clear(); vi.clearAllMocks()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtx-project-ipc-"))
  dirs.push(dir)
  const frame = {}
  const windows = Object.assign(new EventEmitter(), { kindOf: () => "chat", broadcast: vi.fn(), setPanelExtra: vi.fn() })
  const settings = new SettingsStore(path.join(dir, "settings.json"))
  settings.update({ projects: [{ id: "previous", name: "Previous", folder: path.join(dir, "previous"), experience: "I maintained the API.", enabled: true }] })
  const service = () => new EventEmitter()
  const projectKnowledge = { getState: vi.fn(() => ({ projects: [], preparing: false })), prepare: vi.fn(async () => ({ projects: [], preparing: false })) }
  registerIpc({ settings, projectKnowledge, windows, session: Object.assign(service(), { state: () => ({ status: "idle" }) }),
    chat: service(), suggestions: service(), meetings: service(), cloud: service(), plan: service(),
    reports: {}, logger: {}, ownKey: {}, transcripts: {} } as never)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return handler({ sender: { mainFrame: frame }, senderFrame: frame }, ...args)
  }
  return { invoke, settings, dir, projectKnowledge }
}

describe("local project registry IPC", () => {
  it("adds native multi-selections with main-generated ids and preserves deduplicated roles", async () => {
    const { invoke, settings, dir } = setup()
    choose.mockResolvedValue({ canceled: false, filePaths: [path.join(dir, "previous"), path.join(dir, "chosen"), path.join(dir, "chosen", ".")] })
    await invoke("projects:add", path.join(dir, "renderer-path"))
    expect(settings.get().projects).toHaveLength(2)
    expect(settings.get().projects[0].experience).toBe("I maintained the API.")
    expect(settings.get().projects[1]).toEqual({ id: expect.stringMatching(/^[a-f0-9-]{36}$/), name: "chosen", folder: path.join(dir, "chosen"), experience: "", enabled: true })
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ properties: ["openDirectory", "multiSelections"] }))
  })
  it("preserves every project when selection is canceled", async () => {
    const { invoke, settings } = setup()
    const previous = settings.get().projects
    choose.mockResolvedValue({ canceled: true, filePaths: [] })
    await invoke("projects:add")
    expect(settings.get().projects).toEqual(previous)
  })
  it("allows scoped edits and removal without accepting renderer paths or ids", async () => {
    const { invoke, settings } = setup()
    const folder = settings.get().projects[0].folder
    await invoke("projects:update", "previous", { name: "API", experience: "My role", enabled: false, folder: "C:\\injected", id: "injected" })
    expect(settings.get().projects).toEqual([{ id: "previous", name: "API", experience: "My role", enabled: false, folder }])
    await expect(invoke("projects:update", "missing", { name: "No" })).rejects.toThrow("Unknown project")
    await expect(invoke("projects:remove", {})).rejects.toThrow("Invalid project id")
    await invoke("settings:update", { projects: [], projectFolder: "C:\\injected", projectExperience: "Injected" })
    expect(settings.get().projects).toHaveLength(1)
    await invoke("projects:remove", "previous")
    expect(settings.get().projects).toEqual([])
  })
  it("prepares and reads state through the service", async () => {
    const { invoke, projectKnowledge } = setup()
    await expect(invoke("projects:state")).resolves.toEqual({ projects: [], preparing: false })
    await invoke("projects:prepare")
    expect(projectKnowledge.prepare).toHaveBeenCalledOnce()
  })
  it("refuses every project operation from an unowned renderer", async () => {
    const { projectKnowledge } = setup()
    for (const channel of ["projects:add", "projects:remove", "projects:update", "projects:prepare", "projects:state"]) {
      await expect(handlers.get(channel)!({ sender: { mainFrame: {} }, senderFrame: {} }, "previous", {})).rejects.toThrow("Untrusted IPC sender")
    }
    expect(choose).not.toHaveBeenCalled()
    expect(projectKnowledge.prepare).not.toHaveBeenCalled()
  })
})
