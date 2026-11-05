import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudSync } from "../electron/services/cloud"
import { MeetingStore } from "../electron/services/meetings"
import { SettingsStore } from "../electron/services/settings"
import type { Meeting } from "../shared/types"

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const meeting = (id: string, over: Partial<Meeting> = {}): Meeting => ({
  id, title: id, startTime: 1, endTime: 2, duration: 1, transcript: [], fullTranscriptText: `text of ${id}`,
  language: "en", status: "completed", createdAt: 1, updatedAt: 1, ...over
})

describe("meeting sync", () => {
  it("does not upload local project paths, role notes or mode preferences", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtx-project-sync-"))
    dirs.push(dir)
    const settings = new SettingsStore(path.join(dir, "settings.json"))
    settings.update({ cloud: { url: "https://account.example", token: "mtk_test", userId: "u1", email: "a@b.c", name: "", linkedAt: 1 },
      projectFolder: "C:\\private-project-location", projectExperience: "Private confirmed responsibility", answerMode: "coding" })
    const requests: string[] = []
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push(String(init.body))
      const profile = { profile: { settings: {}, id: "u1" } }
      const prompts = { prompts: settings.get().prompts }
      return new Response(JSON.stringify(new URL(url).pathname.endsWith("profile") ? profile : prompts), { status: 200 })
    })
    const sync = new CloudSync({ settings, meetings: new MeetingStore(path.join(dir, "meetings.json")), appVersion: "1.3.1", openExternal: async () => {} })
    const internal = sync as unknown as { pushProfile(initial: boolean): Promise<void>; pushPrompts(initial: boolean): Promise<void> }
    await internal.pushProfile(true)
    await internal.pushPrompts(true)
    expect(requests).toHaveLength(2)
    const sent = requests.join("\n")
    for (const local of ["private-project-location", "Private confirmed responsibility", "projectFolder", "projectExperience", "answerMode"]) {
      expect(sent).not.toContain(local)
    }
  })

  it("never uploads a meeting kept on this computer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtx-cloud-"))
    dirs.push(dir)
    const settings = new SettingsStore(path.join(dir, "settings.json"))
    settings.update({ cloud: { url: "https://account.example", token: "mtk_test", userId: "u1", email: "a@b.c", name: "", linkedAt: 1 } })
    const meetings = new MeetingStore(path.join(dir, "meetings.json"))
    meetings.save(meeting("kept", { localOnly: true }))
    meetings.save(meeting("normal"))
    const uploaded: string[] = []
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      uploaded.push(`${init.method} ${new URL(url).pathname}`)
      return new Response(JSON.stringify({ id: "r1", updated: new Date().toISOString() }), { status: 200 })
    })
    const sync = new CloudSync({ settings, meetings, appVersion: "1.3.1", openExternal: async () => {} })
    await (sync as unknown as { pushMeetings(): Promise<void> }).pushMeetings()
    expect(uploaded).toEqual(["PUT /api/app/meetings/normal"])
  })
})
