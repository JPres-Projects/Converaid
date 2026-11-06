import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Logger } from "../electron/services/logger"

const { app, updater, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (info: { version: string }) => void>()
  return {
    app: { isPackaged: true },
    listeners,
    updater: {
      on: vi.fn((event: string, listener: (info: { version: string }) => void) => listeners.set(event, listener)),
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => null),
      quitAndInstall: vi.fn()
    }
  }
})
vi.mock("electron", () => ({ app }))
vi.mock("electron-updater", () => ({ autoUpdater: updater }))
import { startAutoUpdates } from "../electron/updater"

const platform = Object.getOwnPropertyDescriptor(process, "platform")!
const onState = vi.fn()
const deps = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
  isBusy: () => false,
  onState
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("CONVERAID_UPDATE_URL", "")
  vi.stubEnv("MEETINGLY_UPDATE_URL", "")
  Object.defineProperty(process, "platform", { value: "win32" })
  app.isPackaged = true
  listeners.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  Object.defineProperty(process, "platform", platform)
})

describe("fork update safety", () => {
  it("never checks or installs in a packaged app without an explicit feed", async () => {
    startAutoUpdates(deps)
    listeners.get("update-downloaded")?.({ version: "99.0.0" })
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.setFeedURL).not.toHaveBeenCalled()
    expect(onState).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(["CONVERAID_UPDATE_URL", "MEETINGLY_UPDATE_URL"])("routes an explicitly configured %s feed", async (variable) => {
    vi.stubEnv(variable, "https://updates.example.com/converaid///")
    startAutoUpdates(deps)

    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: "https://updates.example.com/converaid" })
    await vi.advanceTimersByTimeAsync(3000)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()

    listeners.get("update-downloaded")!({ version: "2.0.0" })
    expect(onState).toHaveBeenCalledWith({ status: "installing", version: "2.0.0" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it("prefers the fork feed when both environment variables are configured", () => {
    vi.stubEnv("CONVERAID_UPDATE_URL", "https://updates.example.com/converaid")
    vi.stubEnv("MEETINGLY_UPDATE_URL", "https://updates.example.com/legacy")
    startAutoUpdates(deps)

    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: "https://updates.example.com/converaid" })
  })
})
