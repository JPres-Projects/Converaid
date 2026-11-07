import { describe, expect, it } from "vitest"
import { rendererProjectPatch, rendererSettingsPatch, trustedFrame } from "../electron/ipc/guard"

describe("IPC boundaries", () => {
  it("refuses subframes, missing frames and unowned renderers", () => {
    const main = {}
    expect(trustedFrame(true, main, main)).toBe(true)
    expect(trustedFrame(false, main, main)).toBe(false)
    expect(trustedFrame(true, {}, main)).toBe(false)
    expect(trustedFrame(true, null, null)).toBe(false)
  })
  it("preserves user preferences without allowing credential or device replacement", () => {
    expect(rendererSettingsPatch({ outputLanguage: "ru", suggestions: false, cloud: { token: "attacker" },
      deviceId: "replacement", ownKey: { baseUrl: "https://example.invalid" }, unexpected: true }))
      .toEqual({ outputLanguage: "ru", suggestions: false })
  })
  it("rejects malformed patch containers", () => {
    for (const input of [null, false, "text", []]) expect(() => rendererSettingsPatch(input)).toThrow()
  })
  it("validates bounded named prompts without replacing cloud ids", () => {
    const prompt = { id: "cloud:prompt/123", title: "Technical interview", content: "Explain the reasoning.", notes: "Confirmed background" }
    expect(rendererSettingsPatch({ prompts: [prompt], activePromptId: prompt.id })).toEqual({ prompts: [prompt], activePromptId: prompt.id })
    for (const prompts of [null, [], [null], [{ ...prompt, title: " " }], [{ ...prompt, content: "" }],
      [{ ...prompt, notes: 5 }], [{ ...prompt, id: "bad\0id" }], [prompt, prompt],
      [{ ...prompt, title: "x".repeat(121) }], [{ ...prompt, content: "x".repeat(30001) }],
      [{ ...prompt, notes: "x".repeat(12001) }], Array.from({ length: 21 }, (_, i) => ({ ...prompt, id: String(i) }))]) {
      expect(() => rendererSettingsPatch({ prompts })).toThrow(/prompt/i)
    }
    for (const activePromptId of [5, "", "bad\0id", "x".repeat(129)]) {
      expect(() => rendererSettingsPatch({ activePromptId })).toThrow(/prompt/i)
    }
    expect(rendererSettingsPatch({ activePromptId: null })).toEqual({ activePromptId: null })
  })
  it("accepts a separate short project description and rejects unsafe or oversized values", () => {
    expect(rendererProjectPatch({ description: "  A local practice assistant.  ", experience: "  I built the API.  " }))
      .toEqual({ description: "A local practice assistant.", experience: "I built the API." })
    for (const description of [false, "x".repeat(2001), "invalid\0description"]) {
      expect(() => rendererProjectPatch({ description })).toThrow(/description/i)
    }
  })
  it("requires dedicated project IPC for all project data", () => {
    expect(rendererSettingsPatch({ answerMode: "interview", projects: [], projectExperience: "I maintained the export endpoint.", projectFolder: "C:\\private" }))
      .toEqual({ answerMode: "interview" })
  })
  it("only allows valid project names, confirmed roles and enabled flags", () => {
    expect(rendererProjectPatch({ name: "  Export  ", experience: "  My role  ", enabled: false, folder: "C:\\private", id: "replacement" }))
      .toEqual({ name: "Export", experience: "My role", enabled: false })
    for (const patch of [null, [], { name: "" }, { name: "x".repeat(121) }, { experience: false }, { experience: "x".repeat(6001) }, { enabled: 1 }]) {
      expect(() => rendererProjectPatch(patch)).toThrow()
    }
  })
  it("rejects non-boolean native preferences before they can be saved", () => {
    for (const key of ["autoLaunch", "stealth", "suggestions", "keepMeetingsLocal"]) {
      expect(() => rendererSettingsPatch({ [key]: "yes" })).toThrow("expected a boolean")
    }
    expect(rendererSettingsPatch({ autoLaunch: false })).toEqual({ autoLaunch: false })
    expect(rendererSettingsPatch({ keepMeetingsLocal: true })).toEqual({ keepMeetingsLocal: true })
  })
})
