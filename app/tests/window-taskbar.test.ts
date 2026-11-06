import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserWindow } from "electron"
import { WindowManager } from "../electron/windows/WindowManager"

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  class NativeWindow extends EventEmitter {
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() }
    setMenuBarVisibility = vi.fn()
    setContentProtection = vi.fn()
    setSkipTaskbar = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setHiddenInMissionControl = vi.fn()
    loadFile = vi.fn().mockResolvedValue(undefined)
    isDestroyed = () => false
    destroy = vi.fn()
    constructor(private readonly bounds: { x: number; y: number; width: number; height: number }) { super() }
    getBounds() { return this.bounds }
  }
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
  return {
    app: new EventEmitter(),
    BrowserWindow: vi.fn(NativeWindow),
    screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display }
  }
})
vi.mock("../electron/copy", () => ({ attachContextMenu: vi.fn() }))

const originalPlatform = process.platform

describe.each([
  { platform: "win32", mainSkips: true },
  { platform: "darwin", mainSkips: false },
  { platform: "linux", mainSkips: false }
])("$platform taskbar behavior", ({ platform, mainSkips }) => {
  let windows: WindowManager

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: platform })
    vi.mocked(BrowserWindow).mockClear()
    windows = new WindowManager("preload.js")
    windows.createMain()
    windows.ensure("chat")
  })

  afterEach(() => {
    windows.destroyAll()
    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  it("sets the native constructor options for both overlay windows", () => {
    expect(vi.mocked(BrowserWindow).mock.calls.map(([options]) => options?.skipTaskbar)).toEqual([mainSkips, true])
  })

  it("keeps every native taskbar update consistent through privacy-state changes", () => {
    windows.setStealth(false)
    windows.setStealth(true)

    expect(windows.get("main")!.setSkipTaskbar).toHaveBeenCalledTimes(3)
    expect(windows.get("main")!.setSkipTaskbar).toHaveBeenNthCalledWith(1, mainSkips)
    expect(windows.get("main")!.setSkipTaskbar).toHaveBeenNthCalledWith(2, mainSkips)
    expect(windows.get("main")!.setSkipTaskbar).toHaveBeenNthCalledWith(3, mainSkips)
    expect(windows.get("chat")!.setSkipTaskbar).toHaveBeenCalledTimes(3)
    expect(windows.get("chat")!.setSkipTaskbar).toHaveBeenNthCalledWith(1, true)
    expect(windows.get("chat")!.setSkipTaskbar).toHaveBeenNthCalledWith(2, true)
    expect(windows.get("chat")!.setSkipTaskbar).toHaveBeenNthCalledWith(3, true)
  })
})
