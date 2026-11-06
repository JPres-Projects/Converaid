import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { InvokeChannel, InvokeMap } from "../../shared/ipc"
import type { ChatService } from "../services/chat"
import type { CloudSync } from "../services/cloud"
import type { PlanService } from "../services/plan"
import type { OwnKeyService } from "../services/ownKey"
import type { Logger } from "../services/logger"
import type { MeetingStore } from "../services/meetings"
import type { ReportGenerator } from "../services/reports"
import type { RecordingSession } from "../services/session"
import type { SimulationService } from "../services/simulation"
import type { SettingsStore } from "../services/settings"
import { projectFolderKey } from "../services/settings"
import type { ProjectKnowledgeService } from "../services/projectKnowledgeService"
import type { SuggestionService } from "../services/suggestions"
import { suggestionsVisible } from "../../shared/types"
import { SUGGESTIONS_WIDTH } from "../windows/config"
import type { WindowManager } from "../windows/WindowManager"
import { projectId, rendererProjectPatch, rendererSettingsPatch, trustedFrame } from "./guard"

export interface IpcDeps {
  settings: SettingsStore
  projectKnowledge: ProjectKnowledgeService
  windows: WindowManager
  session: RecordingSession
  simulation: SimulationService
  chat: ChatService
  suggestions: SuggestionService
  meetings: MeetingStore
  reports: ReportGenerator
  logger: Logger
  cloud: CloudSync
  plan: PlanService
  ownKey: OwnKeyService
  transcripts: { reveal: () => void }
}

type Handler<K extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: Parameters<InvokeMap[K]>
) => ReturnType<InvokeMap[K]> | Promise<ReturnType<InvokeMap[K]>>

/** Typed `ipcMain.handle`. Errors are logged once and rejected to the renderer as plain messages. */
function registerHandler<K extends InvokeChannel>(channel: K, fn: Handler<K>, windows: WindowManager): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!trustedFrame(Boolean(windows.kindOf(event.sender)), event.senderFrame, event.sender.mainFrame)) {
        throw new Error("Untrusted IPC sender")
      }
      return await fn(event, ...(args as Parameters<InvokeMap[K]>))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (channel !== "session:audio" && channel !== "simulation:audio") console.error(`[ipc] ${channel}: ${message}`)
      throw new Error(message)
    }
  })
}

let ownKeyFormPending = false

/** The tray's "Use your own API key…": the panel on Answers with the own-key form open. */
export function openOwnKeyForm(windows: WindowManager): void {
  ownKeyFormPending = true
  windows.showPanel("answers")
  windows.send("chat", "ownkey:open", undefined)
}

export function registerIpc(deps: IpcDeps): void {
  const { settings, projectKnowledge, windows, session, simulation, chat, suggestions, meetings, logger, cloud, plan, ownKey, transcripts } = deps
  const handle = <K extends InvokeChannel>(channel: K, fn: Handler<K>) => registerHandler(channel, fn, windows)

  // Settings
  handle("settings:get", () => settings.view())
  handle("settings:update", (_e, patch) => {
    settings.update(rendererSettingsPatch(patch))
    return settings.view()
  })

  handle("projects:add", async () => {
    const result = await dialog.showOpenDialog({ title: "Add interview projects", properties: ["openDirectory", "multiSelections"] })
    if (!result.canceled) {
      const projects = settings.get().projects
      const folders = new Set(projects.map((p) => projectFolderKey(p.folder)))
      for (const folder of result.filePaths) {
        const key = projectFolderKey(folder)
        if (folders.has(key)) continue
        if (projects.length >= 32) throw new Error("You can add up to 32 interview projects")
        folders.add(key)
        projects.push({ id: randomUUID(), name: path.basename(folder) || folder, folder, experience: "", enabled: true })
      }
      settings.update({ projects })
    }
    return settings.view()
  })
  handle("projects:remove", (_e, id) => {
    const validId = projectId(id)
    const projects = settings.get().projects
    if (!projects.some((p) => p.id === validId)) throw new Error("Unknown project")
    settings.update({ projects: projects.filter((p) => p.id !== validId) })
    return settings.view()
  })
  handle("projects:update", (_e, id, input) => {
    const validId = projectId(id)
    const patch = rendererProjectPatch(input)
    const projects = settings.get().projects
    if (!projects.some((p) => p.id === validId)) throw new Error("Unknown project")
    settings.update({ projects: projects.map((p) => p.id === validId ? { ...p, ...patch } : p) })
    return settings.view()
  })
  handle("projects:prepare", () => projectKnowledge.prepare())
  handle("projects:state", () => projectKnowledge.getState())

  // Windows
  handle("windows:state", () => windows.state())
  handle("windows:show", (_e, kind) => windows.show(kind))
  handle("windows:hide", (_e, kind) => windows.hide(kind))
  handle("windows:toggle", (_e, kind) => windows.toggle(kind))
  handle("windows:toggle-all", () => windows.toggleAll())
  const panelTab = (tab: unknown) => {
    if (tab !== "answers" && tab !== "transcript" && tab !== "settings" && tab !== "simulation") throw new Error("Invalid panel tab")
    return tab
  }
  handle("panel:show", (_e, tab) => windows.showPanel(panelTab(tab)))
  handle("panel:toggle", (_e, tab) => windows.togglePanel(panelTab(tab)))
  handle("panel:set-tab", (_e, tab) => windows.setPanelTab(panelTab(tab)))
  handle("windows:fit", (e, size) => {
    const kind = windows.kindOf(e.sender)
    if (kind) windows.fit(kind, size.width, size.height)
  })
  handle("windows:drag", (_e, step) => {
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 20_000
    if (!step || !["start", "move", "end"].includes(step.phase) || !ok(step.dx) || !ok(step.dy)) return
    windows.dragMain(step.phase, step.dx, step.dy)
  })
  handle("transcripts:reveal", () => transcripts.reveal())
  handle("app:quit", () => app.quit())
  handle("app:open-logs", () => {
    shell.showItemInFolder(logger.file)
  })
  handle("app:log", (_e, entry) => {
    // Renderer-side diagnostics land in the same file, in order.
    logger[entry.level]?.(`ui:${entry.scope}`, entry.message, entry.data)
  })

  // Recording session
  handle("session:state", () => session.state())
  handle("session:start", async () => {
    await simulation?.setListening(false)
    return session.start()
  })
  handle("session:pause", () => session.pause())
  handle("session:resume", () => session.resume())
  handle("session:finish", () => session.finish())
  handle("session:cancel", () => session.cancel())
  handle("session:audio", (_e, pcm16) => session.sendAudio(pcm16))
  handle("session:transcript", () => session.transcriptText())
  handle("session:last-utterance", () => session.getLastUtterance())

  handle("simulation:state", () => simulation.getState())
  handle("simulation:role", (_e, role) => {
    if (role !== "interviewer" && role !== "candidate") throw new Error("Invalid simulation role")
    return simulation.setRole(role)
  })
  handle("simulation:send", (_e, text) => {
    if (typeof text !== "string" || text.length > 20_000 || text.includes("\0")) throw new Error("Invalid simulation text: maximum 20000 characters")
    return simulation.send(text)
  })
  handle("simulation:listen", (_e, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid simulation listening value")
    return simulation.setListening(enabled)
  })
  handle("simulation:audio", (_e, pcm16) => {
    if (!(pcm16 instanceof ArrayBuffer) || pcm16.byteLength > 256 * 1024 || pcm16.byteLength % 4 !== 0) throw new Error("Invalid simulation audio buffer")
    simulation.sendAudio(pcm16)
  })
  handle("simulation:clear", () => simulation.clear())

  // Chat
  handle("chat:history", () => chat.getHistory())
  handle("chat:send", (_e, text) => {
    // Fire and forget: the reply streams back through events.
    void chat.send(text)
  })
  handle("chat:answer-last", () => chat.answerLast())
  handle("chat:clear", () => chat.clear())
  handle("chat:screenshot", (_e, prompt) => chat.screenshot(prompt))

  // Suggestions rail
  handle("suggestions:state", () => suggestions.state())
  handle("suggestions:refresh", () => {
    void suggestions.refresh()
  })
  handle("suggestions:use", (_e, id) => {
    // The answer lands in the Answers tab: show it, even when the transcript tab was open.
    if (suggestions.use(id)) windows.showPanel("answers")
  })

  // Account / sync
  handle("cloud:state", () => cloud.state())
  handle("cloud:link-start", () => cloud.linkStart())
  handle("cloud:link-cancel", () => cloud.linkCancel())
  handle("cloud:unlink", () => cloud.unlink())
  handle("cloud:open-web", (_e, page) => cloud.openWeb(page))
  handle("cloud:sync-now", () => cloud.syncNow())

  // Plan and usage
  handle("plan:state", () => plan.getState())
  handle("plan:refresh", () => plan.refresh())
  handle("plan:upgrade", () => cloud.openWeb("billing"))

  // Your own API key
  handle("ownkey:models", (_e, input) => ownKey.models(input))
  handle("ownkey:save", async (_e, input) => {
    await ownKey.save(input)
    return settings.view()
  })
  handle("ownkey:pending", () => {
    const pending = ownKeyFormPending
    ownKeyFormPending = false
    return pending
  })
  handle("ownkey:clear", () => {
    ownKey.clear()
    return settings.view()
  })

  /** The panel is wider while the suggestions rail shows (during a session, setting on). */
  const fitPanel = () => windows.setPanelExtra(suggestionsVisible(settings.get(), session.state().status) ? SUGGESTIONS_WIDTH : 0)

  // Push events from services to every window.
  session.on("state", (state) => {
    if (state.status !== "idle") void simulation?.setListening(false)
    fitPanel()
    // Audio capture lives in the panel: it must exist (shown or not) whenever a session runs.
    if (state.status !== "idle") windows.ensure("chat")
    else suggestions.reset()
    windows.broadcast("session:state", state)
  })
  session.on("transcript", (event) => windows.broadcast("session:transcript", event))
  simulation?.on("state", (state) => windows.broadcast("simulation:changed", state))
  session.on("utterance", (utterance) => {
    windows.broadcast("session:utterance", utterance)
    void chat.autoAnswer(utterance)
    suggestions.onUtterance()
  })
  suggestions.on("state", (state) => windows.broadcast("suggestions:state", state))
  chat.on("message", (message) => windows.broadcast("chat:message", message))
  // A hands-free answer is useless if the chat window is hidden.
  // Background: never un-hides the app on its own; the answer waits in chat until the user shows it.
  chat.on("auto-answer", () => windows.showPanel("answers", { background: true }))
  chat.on("chunk", (chunk) => windows.send("chat", "chat:chunk", chunk))
  chat.on("busy", (busy) => windows.broadcast("chat:busy", busy))
  chat.on("cleared", () => windows.broadcast("chat:cleared", undefined))
  meetings.on("changed", () => windows.broadcast("meetings:changed", undefined))
  meetings.on("changed-quiet", () => windows.broadcast("meetings:changed", undefined))
  cloud.on("state", (state) => windows.broadcast("cloud:state", state))
  plan.on("state", (state) => windows.broadcast("plan:state", state))
  // Usage moves with every answer and every limit error; linking or unlinking changes the plan itself.
  chat.on("message", (message) => {
    if (message.role === "assistant") plan.refreshSoon()
  })
  const identity = (s: ReturnType<SettingsStore["get"]>) => `${s.cloud?.token ?? ""}|${s.ownKey ? "own" : ""}`
  let lastIdentity = identity(settings.get())
  settings.onChange((s) => {
    if (identity(s) !== lastIdentity) {
      lastIdentity = identity(s)
      plan.refreshSoon(500)
    }
  })
  windows.on("state", (state) => {
    if (state.chat === false || (state.panelTab !== undefined && state.panelTab !== "simulation")) {
      void simulation?.setListening(false)
    }
    windows.broadcast("windows:state", state)
  })
  settings.onChange(() => {
    fitPanel()
    // Turned on mid-session: start from what was said so far.
    if (suggestionsVisible(settings.get(), session.state().status)) suggestions.onUtterance()
    windows.broadcast("settings:changed", settings.view())
    // Session state carries the audio source, so the recording window restarts
    // its capture when the source or device changes mid-session.
    windows.broadcast("session:state", session.state())
  })
  settings.on("conflicts", () => windows.broadcast("settings:changed", settings.view()))
}
