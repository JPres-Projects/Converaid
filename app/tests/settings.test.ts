import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "../electron/services/settings"
import { ANSWER_FORMAT, DEFAULT_PROMPT } from "../shared/types"
import { CLOUD_SETTING_KEYS } from "../shared/cloud"

const dirs: string[] = []
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igpt-settings-"))
  dirs.push(dir)
  return path.join(dir, "settings.json")
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("SettingsStore", () => {
  it("keeps meetings on this computer only when turned on", () => {
    const file = tmpFile()
    expect(new SettingsStore(file).get().keepMeetingsLocal).toBe(false)
    new SettingsStore(file).update({ keepMeetingsLocal: true })
    expect(new SettingsStore(file).get().keepMeetingsLocal).toBe(true)
  })

  it("transcribes the system language on a new install, and keeps a saved choice", () => {
    const file = tmpFile()
    const meta = { version: "1.2.9", platform: "win32", locale: "ru-RU" }
    expect(new SettingsStore(file, meta).get().audioLanguage).toBe("ru")
    expect(new SettingsStore(tmpFile(), { ...meta, locale: "xx-YY" }).get().audioLanguage).toBe("en")
    new SettingsStore(file, meta).update({ audioLanguage: "en" })
    expect(new SettingsStore(file, { ...meta, locale: "de-DE" }).get().audioLanguage).toBe("en")
  })

  it("starts from defaults and persists updates", () => {
    const file = tmpFile()
    const store = new SettingsStore(file)
    expect(store.get().outputLanguage).toBe("en")
    store.update({ outputLanguage: "ru", stealth: false })
    const reloaded = new SettingsStore(file)
    expect(reloaded.get().outputLanguage).toBe("ru")
    expect(reloaded.get().stealth).toBe(false)
  })

  it("persists local projects and answer mode without changing prompt notes", () => {
    const file = tmpFile()
    const store = new SettingsStore(file)
    expect(store.get().answerMode).toBe("meeting")
    expect(store.get().projects).toEqual([])
    const projects = [{ id: "project-a", name: "Export", folder: path.dirname(file), experience: "I maintained the export endpoint.", enabled: true }]
    store.update({ answerMode: "coding", projects })
    const settings = new SettingsStore(file).get()
    expect(settings.answerMode).toBe("coding")
    expect(settings.projects).toEqual(projects)
    expect(settings.prompts).toEqual([DEFAULT_PROMPT])
    for (const localKey of ["answerMode", "projects"]) expect(CLOUD_SETTING_KEYS).not.toContain(localKey)
  })

  it("normalizes invalid modes and project configurations", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ answerMode: "unknown", projectFolder: "relative/path", projectExperience: 17 }))
    const store = new SettingsStore(file)
    expect(store.get().answerMode).toBe("meeting")
    expect(store.get().projects).toEqual([])
    const project = { id: "project-a", name: "  Export  ", folder: path.dirname(file), experience: `  ${"x".repeat(6500)}  `, enabled: true }
    store.update({ answerMode: "interview", projects: [project, { ...project, id: "bad", folder: "relative" }] })
    expect(store.get().answerMode).toBe("interview")
    expect(store.get().projects).toEqual([{ ...project, name: "Export", experience: "x".repeat(6000) }])
    store.update({ projects: Array.from({ length: 40 }, (_, i) => ({ ...project, id: `project-${i}`, folder: path.join(path.dirname(file), String(i)) })) })
    expect(store.get().projects).toHaveLength(32)
  })
  it("persists a short project description separately from confirmed experience", () => {
    const file = tmpFile()
    const store = new SettingsStore(file)
    store.update({ projects: [{ id: "project-a", name: "Practice", folder: path.dirname(file),
      description: "  A practice assistant.\0  ", experience: "I built the API.", enabled: true }] })
    expect(new SettingsStore(file).get().projects[0]).toMatchObject({ description: "A practice assistant.", experience: "I built the API." })
    store.update({ projects: [{ ...store.get().projects[0], description: "x".repeat(2500) }] })
    expect(store.get().projects[0].description).toHaveLength(2000)
  })
  it("saves, switches and removes named prompts while retaining custom content and cloud ids", () => {
    const file = tmpFile()
    const store = new SettingsStore(file)
    const custom = { id: "cloud:custom/123", title: "Technical interview", content: "  Use my custom approach.  ", notes: "My background" }
    store.update({ prompts: [DEFAULT_PROMPT, custom], activePromptId: custom.id })
    expect(new SettingsStore(file).activePrompt()).toEqual(custom)
    const exposed = store.get().prompts
    exposed[1].content = "Mutated"
    custom.notes = "Mutated after saving"
    expect(store.activePrompt().content).toBe("  Use my custom approach.  ")
    expect(store.activePrompt().notes).toBe("My background")
    store.update({ prompts: [DEFAULT_PROMPT] })
    expect(new SettingsStore(file).activePrompt()).toEqual(DEFAULT_PROMPT)
    store.update({ prompts: [] })
    expect(store.activePrompt()).toEqual(DEFAULT_PROMPT)
  })
  it("recovers malformed prompts and duplicate ids within a bounded saved collection", () => {
    const file = tmpFile()
    const valid = { id: "cloud:existing", title: "Custom", content: "Keep this custom instruction.", notes: "Background" }
    fs.writeFileSync(file, JSON.stringify({ prompts: [null, { ...valid, title: "" }, valid, { ...valid, content: "Duplicate" },
      ...Array.from({ length: 25 }, (_, i) => ({ ...valid, id: `saved-${i}` }))], activePromptId: "missing" }))
    const store = new SettingsStore(file)
    expect(store.get().prompts).toHaveLength(20)
    expect(store.activePrompt()).toEqual(valid)
    expect(store.get().prompts.filter((prompt) => prompt.id === valid.id)).toHaveLength(1)
  })

  it("migrates the legacy selected project once and removes obsolete fields from disk", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ deviceId: "existing-device-id", projectFolder: path.dirname(file), projectExperience: "I maintained exports.", __v: 3 }))
    const store = new SettingsStore(file)
    expect(store.get().projects).toEqual([expect.objectContaining({ folder: path.dirname(file), experience: "I maintained exports.", enabled: true })])
    const id = store.get().projects[0].id
    expect(new SettingsStore(file).get().projects[0].id).toBe(id)
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/projectFolder|projectExperience/)
    store.update({ projects: [] })
    expect(new SettingsStore(file).get().projects).toEqual([])
    fs.writeFileSync(file, JSON.stringify({ projects: [], projectFolder: path.dirname(file), __v: 3 }))
    expect(new SettingsStore(file).get().projects).toEqual([])
  })

  it("never exposes mutable project references through settings or views", () => {
    const file = tmpFile()
    const store = new SettingsStore(file)
    const project = { id: "project-a", name: "Export", folder: path.dirname(file), experience: "My role", enabled: true }
    store.update({ projects: [project] })
    project.name = "Caller mutation"
    store.get().projects[0].name = "Get mutation"
    store.view().projects[0].experience = "View mutation"
    expect(store.get().projects[0]).toMatchObject({ name: "Export", experience: "My role" })
  })

  it("has suggestions off by default (1.2.5), and keeps them on where they were saved on", () => {
    const file = tmpFile()
    expect(new SettingsStore(file).get().suggestions).toBe(false)
    fs.writeFileSync(file, JSON.stringify({ outputLanguage: "ru", suggestions: true, __v: 2 }))
    expect(new SettingsStore(file).get().suggestions).toBe(true)
    const store = new SettingsStore(file)
    store.update({ suggestions: false })
    expect(new SettingsStore(file).get().suggestions).toBe(false)
  })

  it("creates a stable device id on first run", () => {
    const file = tmpFile()
    const first = new SettingsStore(file).deviceId()
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(new SettingsStore(file).deviceId()).toBe(first)
  })
  it.skipIf(process.platform === "win32")("tightens an existing settings file without requiring an update", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ deviceId: "existing-device-id", cloud: { token: "fixture", email: "fixture@example.invalid" } }), { mode: 0o644 })
    fs.chmodSync(path.dirname(file), 0o755)
    const store = new SettingsStore(file)
    expect(store.deviceId()).toBe("existing-device-id")
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
  })
  it("normalizes malformed saved native boolean settings", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ deviceId: "existing-device-id", autoLaunch: "yes", stealth: null }))
    const store = new SettingsStore(file)
    expect(store.get().autoLaunch).toBe(false)
    expect(store.get().stealth).toBe(true)
  })

  it("never ends up without a prompt or with a dangling active id", () => {
    const store = new SettingsStore(tmpFile())
    store.update({ prompts: [], activePromptId: "nope" })
    expect(store.get().prompts).toEqual([DEFAULT_PROMPT])
    expect(store.get().activePromptId).toBe(DEFAULT_PROMPT.id)
    store.update({ prompts: [{ id: "a", title: "A", content: "x" }, { id: "b", title: "B", content: "y" }], activePromptId: "b" })
    expect(store.activePrompt().id).toBe("b")
    store.update({ prompts: [{ id: "a", title: "A", content: "x" }] })
    expect(store.activePrompt().id).toBe("a")
  })

  it("survives a corrupt file", () => {
    const file = tmpFile()
    fs.writeFileSync(file, "{not json")
    const store = new SettingsStore(file)
    expect(store.get().outputLanguage).toBe("en")
    expect(store.deviceId()).toHaveLength(32)
  })

  it("recovers when every saved prompt is malformed", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ prompts: [null, { id: 5 }, { content: false }], activePromptId: "missing" }))
    const store = new SettingsStore(file)
    expect(store.activePrompt()).toEqual(DEFAULT_PROMPT)
  })

  it("notifies listeners", () => {
    const store = new SettingsStore(tmpFile())
    const seen: string[] = []
    const off = store.onChange((s) => seen.push(s.outputLanguage))
    store.update({ outputLanguage: "fr" })
    off()
    store.update({ outputLanguage: "de" })
    expect(seen).toEqual(["fr"])
  })
})

describe("prompt migration", () => {
  it("defaults to short complete sentences and a coherent explanation without bare fragments", () => {
    expect(DEFAULT_PROMPT.content).toContain("short, complete sentences")
    expect(DEFAULT_PROMPT.content).toContain("coherent explanation")
    expect(ANSWER_FORMAT).toContain("short, complete")
    expect(ANSWER_FORMAT).toContain("coherent explanation")
  })
  it("upgrades a saved copy of any earlier default, keeps custom prompts", async () => {
    const { LEGACY_DEFAULT_SYSTEM_PROMPTS, DEFAULT_SYSTEM_PROMPT } = await import("../shared/types")
    expect(LEGACY_DEFAULT_SYSTEM_PROMPTS).toHaveLength(5)
    for (const old of LEGACY_DEFAULT_SYSTEM_PROMPTS) {
      const file = tmpFile()
      fs.writeFileSync(file, JSON.stringify({
        prompts: [
          // Saved on Windows: CRLF line endings must not defeat the comparison.
          { id: "default", title: "Meeting assistant", content: old.replace(/\n/g, "\r\n") },
          { id: "mine", title: "Mine", content: "Answer like a pirate." }
        ],
        activePromptId: "default"
      }))
      const prompts = new SettingsStore(file).get().prompts
      expect(prompts[0].content).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(prompts[1].content).toBe("Answer like a pirate.")
    }
  })
})

describe("shortcuts", () => {
  it("fills missing shortcuts from defaults and keeps overrides", () => {
    const store = new SettingsStore(tmpFile())
    store.update({ shortcuts: { chat: "Alt+X" } as never })
    expect(store.get().shortcuts.chat).toBe("Alt+X")
    expect(store.get().shortcuts.listen).toBe("CommandOrControl+L")
  })

  it("moves shortcuts still on the old Ctrl+Alt defaults to the plain Ctrl ones, keeping custom keys", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({
      shortcuts: { toggleAll: "CommandOrControl+Alt+B", chat: "CommandOrControl+Alt+C", listen: "Shift+F9", moveLeft: "CommandOrControl+Alt+Left" }
    }))
    const shortcuts = new SettingsStore(file).get().shortcuts
    expect(shortcuts.toggleAll).toBe("CommandOrControl+B")
    expect(shortcuts.chat).toBe("CommandOrControl+Shift+C")
    expect(shortcuts.moveLeft).toBe("CommandOrControl+Left")
    expect(shortcuts.listen).toBe("Shift+F9")
  })
})

describe("logger", () => {
  it("writes lines and redacts secrets", async () => {
    const { Logger, redact } = await import("../electron/services/logger")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igpt-log-"))
    dirs.push(dir)
    const file = path.join(dir, "app.log")
    const logger = new Logger(file, "debug", false)
    logger.info("audio", "capture started", { opened: ["microphone", "system"] })
    logger.error("chat", "failed", new Error("boom"))
    await expect.poll(() => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("ERROR [chat] failed Error: boom"), { timeout: 5000 }).toBe(true)
    const text = fs.readFileSync(file, "utf8")
    expect(text).toContain("[audio] capture started")
    expect(text).toContain('"opened":["microphone","system"]')
    expect(text).toContain("ERROR [chat] failed Error: boom")

    expect(redact("Authorization: Bearer igpt_v1_7Qm3xLk9pZ2vT8nR4wYb6Hd1Fs5Ja0Ce")).not.toContain("Ja0Ce")
    expect(redact("key=sk-or-v1-0123456789abcdef01234567")).toBe("key=sk-or-v1-01…")
    expect(redact("nothing secret here")).toBe("nothing secret here")
  })
})

describe("auto-answer (Pro since 1.2.5)", () => {
  it("is off for a new install, and turned off once for settings saved before 1.2.5", () => {
    const file = tmpFile()
    expect(new SettingsStore(file).get().autoAnswer).toBe("off")
    fs.writeFileSync(file, JSON.stringify({ autoAnswer: "questions", __v: 2 }))
    expect(new SettingsStore(file).get().autoAnswer).toBe("off")
  })

  it("keeps the user's choice made after that", () => {
    const file = tmpFile()
    fs.writeFileSync(file, JSON.stringify({ autoAnswer: "questions", __v: 2 }))
    const store = new SettingsStore(file)
    store.update({ autoAnswer: "always" })
    expect(new SettingsStore(file).get().autoAnswer).toBe("always")
  })

  it("is available on Lite, Pro, Unlimited and the user's own key only", async () => {
    const { autoAnswerAllowed } = await import("../shared/types")
    expect(autoAnswerAllowed({ status: "ok", plan: "lite" })).toBe(true)
    expect(autoAnswerAllowed({ status: "ok", plan: "pro" })).toBe(true)
    expect(autoAnswerAllowed({ status: "ok", plan: "unlimited" })).toBe(true)
    expect(autoAnswerAllowed({ status: "own-key" })).toBe(true)
    expect(autoAnswerAllowed({ status: "ok", plan: "free" })).toBe(false)
    expect(autoAnswerAllowed({ status: "ok", plan: "guest" })).toBe(false)
    expect(autoAnswerAllowed({ status: "signed-out" })).toBe(false)
    expect(autoAnswerAllowed({ status: "unknown" })).toBe(false)
    expect(autoAnswerAllowed({ status: "offline" })).toBe(false)
  })
})
