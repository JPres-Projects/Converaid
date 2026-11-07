import { app, BrowserWindow, clipboard, screen } from "electron"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import type { AddressInfo } from "node:net"
import type { AsrModel } from "./services/asrModel"
import { LocalAsrSocket } from "./services/localAsr"
import type { RefineModels } from "./services/refine"
import { ANSWER_FORMAT, getLanguage, type AudioSource, type InterviewProject, type LanguageCode, type ProjectKnowledgeState, type SessionState, type WindowKind } from "../shared/types"
import type { SimulationState } from "../shared/simulation"
import type { ChatService } from "./services/chat"
import type { CloudSync } from "./services/cloud"
import { MeetingStore } from "./services/meetings"
import type { ReportGenerator } from "./services/reports"
import { RecordingSession } from "./services/session"
import { SettingsStore } from "./services/settings"
import type { WindowManager } from "./windows/WindowManager"
import { SUGGESTIONS_WIDTH } from "./windows/config"
import { copySelection } from "./copy"
import { openOwnKeyForm } from "./ipc"

const KINDS: WindowKind[] = ["main", "chat"]

interface SmokeDeps {
  windows: WindowManager
  chat: ChatService
  session: RecordingSession
  settings: SettingsStore
  cloud: CloudSync
  meetings: MeetingStore
  asrModel: AsrModel
}

/**
 * Self checks driven by the IGPT_SMOKE env var:
 *   "1"       open every window, collect renderer errors, print a JSON report, exit.
 *   "chat"    same, plus one real chat round-trip through the relay.
 *   "listen"  same, plus a real listening session with the microphone and with
 *             system audio: the transcription socket must open and the renderer
 *             must keep the session in "recording" (capture errors pause it).
 *   "visual"  open every window with content protection off and stay running
 *             so the screen can be captured.
 *   "answers" auto-answer against the real model: English and Russian questions must get
 *             direct answers, small talk must be skipped (nothing shown in chat).
 *   "shots"   capture the toolbar and every panel tab (with sample answers) as PNGs into
 *             IGPT_SMOKE_SHOTS. capturePage works even with content protection on.
 *   "project-ui" local project preparation, role notes and selection through the real renderer;
 *             project overview, expanded briefing and mode-menu PNGs at 1440 and 390 pixels.
 *   "simulation-ui" prompt editing, project summaries and isolated practice turns through the real
 *             renderer and a fake local provider; Settings and Simulation PNGs at 1440 and 390 pixels.
 *   "demo"    frames of answers streaming in the panel, for the README animation (see demoFrames).
 *   "copy"    selecting an answer in the panel and pressing Ctrl+C copies it (the Ctrl+C shortcut must not
 *             swallow the copy); nothing selected means the copy path declines. Restores the clipboard.
 *   "hide"    hide everything with the toolbar eye button, bring it back every way a user can, use the chat button.
 *   "hardware" the same with the real cursor and a real Ctrl+B, starting like a real launch (no panel yet). Moves
 *             the cursor: for an unattended machine (the UI test workflow), not a desk someone is using.
 *   "ownkey"  the "use your own API key" flow in the real panel against a fake local endpoint (see ownKeySmoke).
 *   "asr"     on-device transcription: stream IGPT_SMOKE_WAV (16 kHz mono, played on the IGPT_SMOKE_SIDE
 *             channel, default "them") through the
 *             speech worker in real time and report partials, finals and latency.
 *   "switch"  the meeting language changes mid-session with the real on-device engine: IGPT_SMOKE_WAV (English)
 *             plays, the language switches to Russian, IGPT_SMOKE_WAV2 (Russian) plays (see switchSmoke).
 *   "refine"  the second pass end to end, without windows: see runRefineSmoke.
 */
export async function runSmokeTest(mode: string, { windows, chat, session, settings, cloud, meetings, asrModel }: SmokeDeps): Promise<void> {
  const errors: string[] = []
  const loaded = new Set<WindowKind>()

  const attach = (kind: WindowKind) => {
    const win = windows.get(kind)
    if (!win) return
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(`[${kind}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    win.webContents.on("did-fail-load", (_e, code, desc) => errors.push(`[${kind}] did-fail-load ${code} ${desc}`))
    win.webContents.on("render-process-gone", (_e, details) => errors.push(`[${kind}] renderer gone: ${details.reason}`))
    win.webContents.on("did-finish-load", () => loaded.add(kind))
  }

  attach("main")
  // "hardware" starts like a real launch: only the toolbar exists; the panel is created the first time it opens.
  const fresh = mode === "hardware"
  for (const kind of KINDS) {
    if (kind !== "main" && !fresh) {
      windows.show(kind)
      attach(kind)
    }
  }
  if (mode === "visual") windows.setStealth(false)

  await sleep(mode === "visual" ? 3000 : 6000)

  let chatProbe: { ok: boolean; reply?: string; error?: string; ms: number } | undefined
  if (mode === "chat") {
    const started = Date.now()
    const done = new Promise<{ ok: boolean; reply?: string; error?: string }>((resolve) => {
      chat.once("message", () => {
        chat.once("message", (m) => resolve(m.kind === "error" ? { ok: false, error: m.text } : { ok: true, reply: m.text }))
      })
    })
    await chat.send("Reply with exactly three words confirming you work.")
    chatProbe = { ...(await Promise.race([done, sleep(45000).then(() => ({ ok: false, error: "timeout" }))])), ms: Date.now() - started }
  }

  const listenProbe: Record<string, { ok: boolean; status: string; connected: boolean; notice: string | null; transcript?: string; heardPhrase?: boolean }> = {}
  if (mode === "listen") {
    const original = settings.get()
    for (const source of ["microphone", "system", "both"] as AudioSource[]) {
      settings.update({ audioSource: source, audioDeviceId: "", autoAnswer: "off" })
      try {
        await session.start()
        await sleep(2500)
        // System audio: play a known phrase through the speakers and expect it in the transcript.
        const spoke = source !== "microphone" ? await speakOnWindows(TEST_PHRASE) : false
        await sleep(spoke ? 9000 : 6000)
        const state = session.state()
        const transcript = session.transcriptText()
        // Diarization may split one sentence across speaker lines; compare words only.
        const words = transcript.toLowerCase().replace(/speaker \d+:/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ")
        const heardPhrase = spoke ? words.includes("purple elephant") : undefined
        listenProbe[source] = {
          ok: state.status === "recording" && state.connected && heardPhrase !== false,
          status: state.status,
          connected: state.connected,
          notice: state.notice,
          transcript: transcript.slice(0, 200),
          heardPhrase
        }
      } catch (err) {
        listenProbe[source] = { ok: false, status: "error", connected: false, notice: (err as Error).message }
      }
      session.cancel()
      await sleep(1000)
    }
    settings.update({ audioSource: original.audioSource, audioDeviceId: original.audioDeviceId, autoAnswer: original.autoAnswer })
  }

  let cloudProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "cloud") cloudProbe = await cloudSmoke({ cloud, settings, meetings })

  if (mode === "shots") await shots(windows, settings, process.env.IGPT_SMOKE_SHOTS || app.getPath("temp"))
  if (mode === "project-ui") {
    try { await projectUiSmoke(windows, settings, process.env.IGPT_SMOKE_SHOTS || app.getPath("temp")) }
    catch (error) { errors.push(`Project UI: ${(error as Error).message}`) }
  }
  let simulationUiProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "simulation-ui") {
    try { simulationUiProbe = await simulationUiSmoke(windows, chat, settings, process.env.IGPT_SMOKE_SHOTS || app.getPath("temp")) }
    catch (error) { errors.push(`Simulation UI: ${(error as Error).message}`) }
  }
  if (mode === "demo") await demoFrames(windows, process.env.IGPT_SMOKE_SHOTS || app.getPath("temp"))

  let answersProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "answers") answersProbe = await answersSmoke(chat, settings)

  let copyProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "copy") copyProbe = await copySmoke(windows)

  let hideProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "hide") hideProbe = await hideSmoke(windows)
  if (mode === "hardware") hideProbe = await hardwareSmoke(windows)

  let ownKeyProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "ownkey") ownKeyProbe = await ownKeySmoke(windows, chat, settings)

  let asrProbe: Record<string, unknown> & { ok: boolean } | undefined
  if (mode === "asr") asrProbe = await asrSmoke(asrModel, process.env.IGPT_SMOKE_WAV ?? "", process.env.IGPT_SMOKE_LANG ?? "en-US")
  if (mode === "switch") asrProbe = await switchSmoke(asrModel)

  const report = {
    mode,
    ok:
      errors.length === 0 &&
      loaded.size === (fresh ? 1 : KINDS.length) &&
      (chatProbe?.ok ?? true) &&
      Object.values(listenProbe).every((p) => p.ok) &&
      (cloudProbe?.ok ?? true) &&
      (asrProbe?.ok ?? true) &&
      (copyProbe?.ok ?? true) &&
      (ownKeyProbe?.ok ?? true) &&
      (hideProbe?.ok ?? true) &&
      (answersProbe?.ok ?? true),
    loaded: [...loaded],
    windows: Object.fromEntries(
      KINDS.map((k) => {
        const win = windows.get(k)
        return [k, win ? { visible: win.isVisible(), bounds: win.getBounds() } : null]
      })
    ),
    chat: chatProbe,
    listen: mode === "listen" ? listenProbe : undefined,
    cloud: cloudProbe,
    asr: asrProbe,
    copy: copyProbe,
    ownKey: ownKeyProbe,
    hide: hideProbe,
    answers: answersProbe,
    simulationUi: simulationUiProbe,
    errors
  }
  console.log(`SMOKE_REPORT ${JSON.stringify(report)}`)
  if (mode !== "visual") app.exit(report.ok ? 0 : 1)
}

/**
 * Copying from the panel. The first checks call the copy path directly; the last one presses a real Ctrl+C
 * (SendKeys), which goes through the global shortcut exactly as when the user types it.
 */
async function copySmoke(windows: WindowManager): Promise<Record<string, unknown> & { ok: boolean }> {
  const saved = await clipboard.readText()
  const steps: Record<string, unknown> = {}
  const answer = "Sharding splits one database"
  try {
    windows.showPanel("answers")
    await sleep(1200)
    windows.send("chat", "chat:message", {
      id: "c1",
      role: "assistant",
      kind: "auto",
      text: "**Sharding splits one database into many by key.**\n- Pick a stable shard key\n- Route queries by key",
      timestamp: Date.now()
    })
    const panel = windows.get("chat")
    if (!panel) return { ok: false, steps, error: "no panel" }
    // The panel may still be loading: wait until the answer is on screen.
    for (let i = 0; i < 25; i++) {
      if (await panel.webContents.executeJavaScript("document.querySelectorAll('.md').length > 0").catch(() => false)) break
      await sleep(200)
    }
    panel.focus()
    await sleep(300)
    await clipboard.writeText("before")
    await panel.webContents.executeJavaScript("window.getSelection().removeAllRanges(); true")
    steps.noSelectionCopies = await copySelection(panel)
    const select =
      "(() => { const el = [...document.querySelectorAll('.md')].pop(); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString() })()"
    steps.selected = String(await panel.webContents.executeJavaScript(select)).slice(0, 60)
    const focused = BrowserWindow.getFocusedWindow()
    steps.focusedWindow = focused ? windows.kindOf(focused.webContents) : null
    steps.direct = await copySelection(panel)
    await sleep(200)
    steps.clipboardAfterDirect = (await clipboard.readText()).slice(0, 60)
    const directOk = steps.direct === true && (await clipboard.readText()).includes(answer)

    // Ctrl+C typed into the window itself (Chromium's own copy, now that Ctrl+C is no global shortcut).
    await clipboard.writeText("before")
    await panel.webContents.executeJavaScript(select)
    panel.webContents.sendInputEvent({ type: "keyDown", keyCode: "C", modifiers: ["control"] })
    panel.webContents.sendInputEvent({ type: "keyUp", keyCode: "C", modifiers: ["control"] })
    await sleep(500)
    steps.clipboardAfterWindowKey = (await clipboard.readText()).slice(0, 60)
    const windowKeyOk = (await clipboard.readText()).includes(answer)

    // The real key press, through Windows (and the global shortcut, if one is bound to Ctrl+C).
    let keyOk: boolean | undefined
    if (process.platform === "win32") {
      await clipboard.writeText("before")
      await panel.webContents.executeJavaScript(select)
      steps.focusedBeforeKey = panel.isFocused()
      await sendKeys("^c")
      await sleep(800)
      steps.clipboardAfterKey = (await clipboard.readText()).slice(0, 60)
      steps.panelVisibleAfterKey = panel.isVisible()
      keyOk = (await clipboard.readText()).includes(answer) && panel.isVisible()
    }
    // Informational: a smoke run started in the background is often not the OS foreground window, so a
    // synthetic key press may land elsewhere. The two checks above cover both ways Ctrl+C copies.
    return { ok: steps.noSelectionCopies === false && directOk && windowKeyOk, windowKey: windowKeyOk, keyPress: keyOk, steps }
  } catch (err) {
    return { ok: false, steps, error: (err as Error).message }
  } finally {
    await clipboard.writeText(saved)
  }
}

/** Types keys into whatever has focus (Windows), as a person would. */
function sendKeys(keys: string): Promise<void> {
  return new Promise((resolve) => {
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true })
    child.on("error", () => resolve())
    child.on("exit", () => resolve())
  })
}

const TEST_PHRASE = "The purple elephant is testing system audio capture."

/** Local-only acceptance checks against the actual Electron renderer and preload bridge. */
async function projectUiSmoke(windows: WindowManager, settings: SettingsStore, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  const original = settings.get()
  const tempRoot = fs.realpathSync(app.getPath("temp"))
  const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, "meetingly-project-ui-"))
  const emptyHooks = path.join(fixtureRoot, "empty-hooks")
  fs.mkdirSync(emptyHooks)
  const write = (folder: string, relative: string, content: string) => {
    const file = path.join(folder, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const git = (folder: string, ...args: string[]) => execFileSync("git", [
    "-c", `core.hooksPath=${emptyHooks}`, "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", "-C", folder, ...args
  ], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }).trim()
  const mappedProject = (id: string, name: string, purpose: string, experience: string): InterviewProject => {
    const folder = path.join(fixtureRoot, `${id}-project-with-a-readable-long-folder-name`)
    write(folder, "src/Screen.tsx", "export const Screen = 'Project overview and actions'\n")
    write(folder, "src/api.ts", "export function handleRequest() { return 'Validated project request' }\n")
    write(folder, "src/database.ts", "export const database = 'Persistent project records'\n")
    git(folder, "init", "--quiet")
    git(folder, "add", "src")
    // The identity and empty hooks directory apply only to this disposable fixture commit.
    git(folder, "-c", "user.name=Project UI Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Create local smoke fixture")
    write(folder, ".ua/knowledge-graph.json", JSON.stringify({
      project: { name, description: purpose, languages: ["TypeScript"], frameworks: ["React"], gitCommitHash: git(folder, "rev-parse", "HEAD") },
      nodes: [
        { id: "screen", type: "file", name: "Project screen", filePath: "src/Screen.tsx", summary: "The frontend presents records and sends user actions to the API.", tags: ["frontend"] },
        { id: "api", type: "file", name: "Project API", filePath: "src/api.ts", summary: "The backend validates requests before accessing stored records.", tags: ["backend"] },
        { id: "database", type: "file", name: "Project database", filePath: "src/database.ts", summary: "The database persists records used by the project.", tags: ["database"] }
      ],
      edges: [{ source: "screen", target: "api", type: "calls" }, { source: "api", target: "database", type: "depends_on" }],
      layers: [{ id: "frontend", name: "Frontend", description: "User actions and record views.", nodeIds: ["screen"] }, { id: "backend", name: "Backend", description: "Validation and persistence.", nodeIds: ["api", "database"] }],
      tour: [{ order: 1, title: "Request journey", description: "Follow an action from the screen through validation to storage.", nodeIds: ["screen", "api", "database"] }]
    }))
    return { id, name, folder, experience, enabled: true }
  }

  settings.update({ answerMode: "meeting", ownKey: null, cloud: null, projects: [], suggestions: false })
  windows.setPanelExtra(0)
  windows.showPanel("settings")
  const panel = windows.get("chat")!
  const originalBounds = panel.getBounds()
  const originalMaximum = panel.getMaximumSize()
  const run = <T = unknown>(js: string) => panel.webContents.executeJavaScript(js) as Promise<T>
  const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
  const until = async (js: string, timeout = 6000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await run(js)) return
      await sleep(100)
    }
    throw new Error(`Project UI check failed: ${js}`)
  }
  const click = async (selector: string) => {
    await until(`Boolean(${query(selector)}) && !${query(selector)}.disabled`)
    await run(`${query(selector)}.scrollIntoView({ block: 'nearest' })`)
    await sleep(75)
    const point = await run<{ x: number; y: number }>(`(() => { const r = ${query(selector)}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    panel.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 })
    panel.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 })
  }
  const fillRole = async (selector: string, text: string) => {
    await click(selector)
    await run(`(() => { const input = ${query(selector)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await until(`${query(selector)}.value === ${JSON.stringify(text)}`)
  }
  const capture = async (name: string) => fs.writeFileSync(path.join(dir, name), (await panel.webContents.capturePage()).toPNG())
  const checkLayout = async (width: number) => {
    if (!await run(`innerWidth === ${width} && document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.scroll')].every(e => e.scrollWidth <= e.clientWidth + 1)`)) throw new Error(`Horizontal overflow or incorrect viewport at ${width}px`)
    if (!await run(`(() => { const r = document.querySelector('section[aria-label="Projects"]').getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 })()`)) throw new Error(`Project page margins missing at ${width}px`)
    if (!await run(`document.querySelectorAll('select,datalist').length === 0`)) throw new Error(`Native dropdown rendered at ${width}px`)
  }
  const section = 'section[aria-label="Projects"]'
  const modeSelector = '[role="combobox"][aria-label="Answer mode"]'
  const mode = query(modeSelector)
  const prepareSelector = `${section} > div:first-child > button:last-child`
  const invoice = '[data-project-id="invoice-portal"]'
  const delivery = '[data-project-id="delivery-planner"]'
  const prototype = '[data-project-id="calendar-prototype"]'
  const invoiceRole = `${invoice} textarea`
  const deliveryRole = `${delivery} textarea`
  const invoiceExperience = "I maintained the API and reviewed database migrations."
  const deliveryExperience = "I designed routing rules and monitored delivery retries."

  try {
    const projects: InterviewProject[] = [
      mappedProject("invoice-portal", "Invoice Portal", "Tracks supplier invoices and approval status.", "I maintained the API."),
      mappedProject("delivery-planner", "Delivery Planner", "Plans parcel routes and tracks delivery events.", "I implemented delivery events."),
      { id: "calendar-prototype", name: "Calendar Prototype", folder: path.join(fixtureRoot, "calendar-prototype-without-a-map"), experience: "I built the first scheduling prototype.", enabled: true }
    ]
    write(projects[2].folder, "README.md", "# Calendar Prototype\nA calendar planner built with React. The prototype groups appointments by day.\n")
    panel.setMaximumSize(1600, 1000)
    panel.setSize(1440, 900)
    await until(`Boolean(${mode}) && Boolean(${query(section)})`)
    await until(`${query(prepareSelector)}.disabled && document.querySelectorAll('[data-project-id]').length === 0`)
    await until(`${query(section)}.textContent.includes('Add projects')`)
    await checkLayout(1440)

    await click(modeSelector)
    await until(`document.querySelectorAll('[role="option"]').length === 3`)
    await click('[role="option"]:last-child')
    await until(`${mode}.textContent.includes('Coding')`)
    if (settings.get().answerMode !== "coding") throw new Error("Mouse-selected mode did not persist through IPC")
    await run(`${mode}.focus()`)
    for (const key of ["Enter", "ArrowUp", "Enter"]) {
      await run(`${mode}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
      await sleep(100)
    }
    await until(`${mode}.textContent.includes('Interview')`)
    if (settings.get().answerMode !== "interview") throw new Error("Keyboard-selected mode did not persist through IPC")
    await click(modeSelector)
    await until(`Boolean(document.querySelector('[role="listbox"]'))`)
    await run(`${mode}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await until(`!document.querySelector('[role="listbox"]')`)
    if (!panel.isVisible()) throw new Error("Escape closed the panel instead of the mode menu")
    await click(modeSelector)
    await until(`Boolean(document.querySelector('[role="listbox"]'))`)
    await click(`${section} h2`)
    await until(`!document.querySelector('[role="listbox"]')`)

    settings.update({ projects })
    await until(`document.querySelectorAll('[data-project-id]').length === 3 && document.querySelectorAll('[data-project-status="unprepared"]').length === 3`)
    await click(`${delivery} [role="switch"]`)
    await until(`${query(`${delivery} [role="switch"]`)}.getAttribute('aria-checked') === 'false' && ${query(section)}.textContent.includes('2 selected')`)
    if (settings.get().projects.find((project) => project.id === projects[1].id)?.enabled !== false) throw new Error("Project deselection did not persist")
    await click(`${delivery} [role="switch"]`)
    await until(`${query(`${delivery} [role="switch"]`)}.getAttribute('aria-checked') === 'true' && ${query(section)}.textContent.includes('3 selected')`)

    await click(`${delivery} [aria-label="Details for Delivery Planner"]`)
    await fillRole(deliveryRole, deliveryExperience)
    await click(`${delivery} [aria-label="Details for Delivery Planner"]`)
    await until(`window.api.invoke('settings:get').then(s => s.projects.find(p => p.id === 'delivery-planner')?.experience === ${JSON.stringify(deliveryExperience)})`)
    if (settings.get().projects.find((project) => project.id === projects[0].id)?.experience !== projects[0].experience) throw new Error("Saving one role changed another project's role")

    await click(`${invoice} [aria-label="Details for Invoice Portal"]`)
    await fillRole(invoiceRole, invoiceExperience)
    // Actual mouse input blurs the role field and immediately clicks Prepare, exercising save ordering.
    await click(prepareSelector)
    await until(`window.api.invoke('projects:state').then(s => !s.preparing && s.projects.filter(p => p.status === 'ready').length === 2 && s.projects.find(p => p.id === 'calendar-prototype')?.status === 'limited')`, 20000)
    await until(`${query(section)}.textContent.includes('3 selected, 2 ready') && ${query(prepareSelector)}.textContent.includes('Prepare again') && !${query(prepareSelector)}.disabled`)
    const state = await run<ProjectKnowledgeState>("window.api.invoke('projects:state')")
    for (const project of projects.slice(0, 2)) {
      const prepared = state.projects.find((item) => item.id === project.id)
      if (prepared?.status !== "ready" || !prepared.preparedAt || !prepared.brief.includes("Frontend") || !prepared.brief.includes("Backend") || !prepared.brief.includes("Request journey") || !prepared.notice.includes("Map freshness verified")) throw new Error(`Mapped project was not fully prepared: ${project.name}`)
    }
    const limited = state.projects.find((item) => item.id === projects[2].id)
    if (limited?.status !== "limited" || !/no Understand Anything map/i.test(limited.notice)) throw new Error("Missing project map was not reported as limited knowledge")
    await until(`${query(prototype)}.textContent.includes('Limited knowledge') && ${query(prototype)}.textContent.includes('No project map found. Only available documentation is prepared.')`)
    if (settings.get().projects.find((project) => project.id === projects[0].id)?.experience !== invoiceExperience || settings.get().projects.find((project) => project.id === projects[1].id)?.experience !== deliveryExperience) throw new Error("Project roles did not persist separately before preparation")
    await until(`${query(`${invoice} h4`)}?.textContent === 'Prepared architecture briefing'`)

    for (const width of [1440, 390]) {
      panel.setSize(width, 900)
      await until(`innerWidth === ${width}`)
      await run(`document.querySelectorAll('${section} [aria-expanded="true"]').forEach(e => e.click()); document.querySelectorAll('.scroll').forEach(e => { e.scrollTop = 0 })`)
      await sleep(200)
      await checkLayout(width)
      await capture(`projects-${width}.png`)

      await click(`${invoice} [aria-label="Details for Invoice Portal"]`)
      await until(`Boolean(${query(`${invoice} h4`)})`)
      await run(`${query(`${invoice} label`)}.scrollIntoView({ block: 'start' }); ${query(section)}.closest('.scroll').scrollTop -= 12`)
      await sleep(200)
      await checkLayout(width)
      await capture(`project-briefing-${width}.png`)
      await click(`${invoice} [aria-label="Details for Invoice Portal"]`)

      await run(`${mode}.scrollIntoView({ block: 'center' })`)
      await sleep(150)
      await click(modeSelector)
      await until(`Boolean(document.querySelector('[role="listbox"]'))`)
      await sleep(200)
      if (!await run(`(() => { const r = document.querySelector('[role="listbox"]').getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 0 && r.bottom <= innerHeight })()`)) throw new Error(`Dropdown outside viewport at ${width}px`)
      await capture(`mode-${width}.png`)
      await run(`${mode}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await until(`!document.querySelector('[role="listbox"]')`)
    }

    await click(`${delivery} [aria-label="Remove Delivery Planner"]`)
    await until(`!${query(delivery)} && document.querySelectorAll('[data-project-id]').length === 2`)
    if (settings.get().projects.length !== 2 || settings.get().projects.some((project) => project.id === projects[1].id) || settings.get().projects.find((project) => project.id === projects[0].id)?.experience !== invoiceExperience) throw new Error("Removing a project did not preserve the other projects and their roles")
    await click(`${invoice} [aria-label="Remove Invoice Portal"]`)
    await until(`!${query(invoice)}`)
    await click(`${prototype} [aria-label="Remove Calendar Prototype"]`)
    await until(`document.querySelectorAll('[data-project-id]').length === 0 && ${query(prepareSelector)}.disabled`)
    if (settings.get().projects.length !== 0) throw new Error("Removing the last project did not clear the selection")
    fs.writeFileSync(path.join(dir, "project-ui-checks.json"), JSON.stringify({
      ok: true,
      checks: ["mode mouse selection", "mode keyboard selection", "Escape and outside close", "multiple project selection", "independent roles saved on blur before Prepare", "two verified mapped projects ready", "missing map limited", "project removal preserves other roles", "empty selection disables Prepare", "no native selects", "page margins", "no horizontal overflow"],
      widths: [1440, 390],
      screenshots: [1440, 390].flatMap((width) => [`projects-${width}.png`, `project-briefing-${width}.png`, `mode-${width}.png`])
    }, null, 2))
  } catch (error) {
    try { await capture("project-ui-failure.png") } catch { /* Preserve the original check failure. */ }
    throw error
  } finally {
    settings.update({ answerMode: original.answerMode, ownKey: original.ownKey, cloud: original.cloud, projects: original.projects, suggestions: original.suggestions })
    panel.setMaximumSize(originalMaximum[0], originalMaximum[1])
    panel.setBounds(originalBounds)
    const resolvedFixture = path.resolve(fixtureRoot)
    if (path.dirname(resolvedFixture) !== tempRoot || !path.basename(resolvedFixture).startsWith("meetingly-project-ui-")) throw new Error("Refusing to remove a fixture outside the expected temporary directory")
    if (process.platform === "win32") {
      // Git creates read-only object files; clear that flag only inside this run's disposable fixture.
      const directories = [resolvedFixture]
      while (directories.length) {
        const folder = directories.pop()!
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const file = path.join(folder, entry.name)
          if (entry.isSymbolicLink()) continue
          if (entry.isDirectory()) directories.push(file)
          else if (entry.isFile()) fs.chmodSync(file, 0o600)
        }
      }
    }
    await fs.promises.rm(resolvedFixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Real Settings and Simulation interaction; every model request stays on this bounded local server. */
async function simulationUiSmoke(windows: WindowManager, chat: ChatService, settings: SettingsStore, dir: string): Promise<Record<string, unknown> & { ok: boolean }> {
  fs.mkdirSync(dir, { recursive: true })
  const original = settings.get()
  const originalWindows = windows.state()
  const originalFetch = globalThis.fetch
  let toolbarSession: SessionState | undefined
  const tempRoot = fs.realpathSync(app.getPath("temp"))
  const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, "meetingly-simulation-ui-"))
  const checks: Record<string, boolean> = {}
  const screenshots: string[] = []
  const requests: { messages: { role: string; content: string }[]; authenticated: boolean }[] = []
  const dummyKey = "sk-simulation-ui-local-only"
  const reply = "I would start with the scheduling API and confirm its constraints."
  let requestCount = 0
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (data) => { raw += data; if (raw.length > 256_000) req.destroy() })
    req.on("end", () => {
      if (++requestCount > 16) { res.writeHead(429); res.end("Local smoke request limit reached"); return }
      let body: { stream?: boolean; model?: string; messages?: { role: string; content: string }[] }
      try { body = raw ? JSON.parse(raw) : {} }
      catch { res.writeHead(400); res.end("Invalid local smoke request"); return }
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "smoke-simulation" }] }))
        return
      }
      if (req.url !== "/v1/chat/completions") { res.writeHead(404); res.end(); return }
      if (!body.stream) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ id: "smoke-check", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }))
        return
      }
      requests.push({ messages: body.messages ?? [], authenticated: req.headers.authorization === `Bearer ${dummyKey}` })
      const chunk = (text: string, done = false) => `data: ${JSON.stringify({ id: "simulation-smoke", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: { content: text }, finish_reason: done ? "stop" : null }] })}\n\n`
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
      res.write(chunk("I would start with "))
      const finish = setTimeout(() => res.end(chunk(reply.slice("I would start with ".length), true) + "data: [DONE]\n\n"), 750)
      res.once("close", () => clearTimeout(finish))
    })
  })
  const panel = windows.get("chat")!
  const originalBounds = panel.getBounds()
  const originalMaximum = panel.getMaximumSize()
  const originalMainBounds = windows.get("main")?.getBounds()
  const run = <T = unknown>(js: string) => panel.webContents.executeJavaScript(js) as Promise<T>
  const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
  const button = (text: string, scope = "document") => `[...${scope}.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)})`
  const until = async (js: string, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await run(js)) return
      await sleep(75)
    }
    const state = await run<{ width: number; height: number; labels: (string | null)[] }>(`({ width: innerWidth, height: innerHeight, labels: [...document.querySelectorAll('[role="combobox"]')].map(element => element.getAttribute('aria-label')) })`)
    throw new Error(`Simulation UI check failed: ${js.slice(0, 300)}; renderer ${JSON.stringify(state)}`)
  }
  const requireCheck = (name: string, passed: boolean) => {
    checks[name] = passed
    if (!passed) throw new Error(`Simulation UI check failed: ${name}`)
  }
  const resizeViewport = async (win: BrowserWindow, width: number, height: number) => {
    const attempts: unknown[] = []
    let requestedWidth = width
    let requestedHeight = height
    win.setContentSize(requestedWidth, requestedHeight)
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(100)
      const actual = await win.webContents.executeJavaScript("({ width: innerWidth, height: innerHeight })") as { width: number; height: number }
      attempts.push({ actual, bounds: win.getBounds(), content: win.getContentSize(), maximum: win.getMaximumSize() })
      if (actual.width === width && actual.height === height) return
      // Windows can round a transparent window by one CSS pixel at fractional desktop scaling.
      requestedWidth += width - actual.width
      requestedHeight += height - actual.height
      win.setContentSize(requestedWidth, requestedHeight)
    }
    throw new Error(`Could not set the renderer viewport to ${width}x${height}: ${JSON.stringify(attempts)}`)
  }
  const click = async (expression: string) => {
    await until(`Boolean(${expression}) && !(${expression}).disabled`)
    await run(`(${expression}).scrollIntoView({ block: 'nearest' })`)
    await sleep(75)
    const point = await run<{ x: number; y: number }>(`(() => { const r = (${expression}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    panel.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 })
    panel.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 })
  }
  const fill = async (selector: string, text: string) => {
    await click(query(selector))
    await run(`(() => { const field = ${query(selector)}; const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await until(`${query(selector)}.value === ${JSON.stringify(text)}`)
  }
  const capture = async (name: string) => {
    await sleep(200)
    fs.writeFileSync(path.join(dir, name), (await panel.webContents.capturePage()).toPNG())
    screenshots.push(name)
  }
  const promptsSection = 'section[aria-label="System prompts"]'
  const promptSelector = '[role="combobox"][aria-label="System prompt"]'
  const simulationSection = 'section[aria-label="Interview simulation"]'
  const simulationInput = 'textarea[aria-label="Simulation input"]'
  const alphaInstruction = "SMOKE_ALPHA_INSTRUCTION. Explain the scheduling API clearly in complete sentences."
  const betaInstruction = "SMOKE_BETA_INSTRUCTION. Focus the next answer on delivery tradeoffs."
  const alphaSummary = "A scheduling service for small teams, built with React and a TypeScript API."
  const betaSummary = "A delivery planner for dispatch teams, built with Python and PostgreSQL."
  const alphaRole = "I implemented the scheduling API and reviewed database migrations."
  const betaRole = "I designed route validation and monitored delivery retries."
  const liveMarker = "LIVE_HISTORY_ONLY_SMOKE: discuss a private live meeting topic."
  const candidateText = "I built the scheduling API and would start by validating the request."
  const checkLayout = async (width: number, section: string) => {
    const passed = await run<boolean>(`innerWidth === ${width} && document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.scroll')].every(e => !e.clientWidth || e.scrollWidth <= e.clientWidth + 1) && !document.querySelector('select,datalist') && (() => { const e = ${query(section)}; const r = e.getBoundingClientRect(); const css = getComputedStyle(e); return r.left + parseFloat(css.paddingLeft) >= 8 && r.right - parseFloat(css.paddingRight) <= innerWidth - 8 })()`)
    if (!passed) {
      const dimensions = await run(`({ width: innerWidth, document: document.documentElement.scrollWidth, scroll: [...document.querySelectorAll('.scroll')].map(e => ({ label: e.getAttribute('aria-label'), client: e.clientWidth, width: e.scrollWidth })), section: (() => { const e = ${query(section)}; const r = e.getBoundingClientRect(); const css = getComputedStyle(e); return { left: r.left, right: r.right, padding: [css.paddingLeft, css.paddingRight] } })() })`)
      throw new Error(`Layout ${section} at ${width}: ${JSON.stringify(dimensions)}`)
    }
    requireCheck(`layout-${section === promptsSection ? "prompts" : "simulation"}-${width}`, passed)
  }
  const choosePrompt = async (title: string) => {
    await click(query(promptSelector))
    await until(`Boolean(document.querySelector('[role="listbox"]'))`)
    await click(`[...document.querySelectorAll('[role="option"]')].find(e => e.textContent.trim() === ${JSON.stringify(title)})`)
    await until(`${query(promptSelector)}.textContent.includes(${JSON.stringify(title)})`)
    await until(`window.api.invoke('settings:get').then(s => s.prompts.find(p => p.id === s.activePromptId)?.title === ${JSON.stringify(title)})`)
  }
  const simulationState = () => run<SimulationState>("window.api.invoke('simulation:state')")
  const summary = (ok: boolean, error?: string) => ({ ok, checks, widths: [1440, 390], screenshots, localRequests: requestCount, streamedRequests: requests.length, ...(error ? { error: error.slice(0, 600) } : {}) })

  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const projects: InterviewProject[] = [
      { id: "smoke-scheduling", name: "Scheduling Service", folder: path.join(fixtureRoot, "scheduling"), experience: "I worked on the API.", enabled: true },
      { id: "smoke-delivery", name: "Delivery Planner", folder: path.join(fixtureRoot, "delivery"), experience: betaRole, enabled: true }
    ]
    for (const project of projects) {
      fs.mkdirSync(project.folder)
      fs.writeFileSync(path.join(project.folder, "README.md"), `# ${project.name}\nLocal simulation smoke fixture.\n`)
    }
    settings.update({ cloud: null, ownKey: null, answerMode: "interview", outputLanguage: "en", suggestions: false, projects, prompts: [{ id: "smoke-baseline", title: "General practice", content: "Answer the interviewer's question." }], activePromptId: "smoke-baseline" })
    windows.setPanelExtra(0)
    windows.showPanel("settings")
    panel.setMaximumSize(1600, 1000)
    await resizeViewport(panel, 1440, 900)
    await until(`Boolean(${query(promptSelector)})`)
    requireCheck("last-prompt-kept", await run<boolean>(`(${button("Remove prompt", query(promptsSection))}).disabled`))
    // Use the public own-key flow so the OS secret box encrypts even this disposable dummy key.
    await run(`window.api.invoke('ownkey:save', ${JSON.stringify({ baseUrl, key: dummyKey, model: "smoke-simulation" })})`)
    const ownKey = settings.get().ownKey
    requireCheck("encrypted-local-provider", Boolean(ownKey && ownKey.baseUrl === baseUrl && ownKey.key && ownKey.key !== dummyKey))

    // Only this catalog URL is intercepted. Validation and every completion still use localhost.
    let catalogRequests = 0
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url === "https://openrouter.ai/api/v1/models") {
        catalogRequests++
        return new Response(JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-5.5" }, { id: "anthropic/claude-haiku-5.5" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      return originalFetch(input, init)
    }
    try {
      openOwnKeyForm(windows)
      await until(`Boolean(${query("#own-model")})`)
      await fill("#own-key", "unsaved-local-provider-key")
      await click(button("OpenRouter", query('[aria-label="API provider"]')))
      await until(`${query("#own-url")}.value === 'https://openrouter.ai/api/v1' && Boolean(${query('[aria-label="Model preset"]')}) && Boolean(${query('[aria-label="Available models"]')})`)
      requireCheck("provider-change-clears-typed-key", await run<boolean>(`${query("#own-key")}.value === ''`))
      const chooseModelOption = async (label: string, choice: string) => {
        const selector = `[role="combobox"][aria-label="${label}"]`
        await click(query(selector))
        await until(`Boolean(document.querySelector('[role="listbox"]'))`)
        await click(`[...document.querySelectorAll('[role="option"]')].find(e => e.textContent.trim() === ${JSON.stringify(choice)})`)
        await until(`${query(selector)}.textContent.includes(${JSON.stringify(choice)})`)
      }
      await chooseModelOption("Model preset", "Claude Sonnet 5.5")
      requireCheck("sonnet-preset-standard", await run<boolean>(`${query("#own-model")}.value === 'anthropic/claude-sonnet-5.5'`))
      await chooseModelOption("OpenRouter routing", "Nitro")
      requireCheck("sonnet-nitro-exact-model-id", await run<boolean>(`${query("#own-model")}.value === 'anthropic/claude-sonnet-5.5:nitro'`))
      await chooseModelOption("OpenRouter routing", "Standard")
      requireCheck("standard-removes-nitro", await run<boolean>(`${query("#own-model")}.value === 'anthropic/claude-sonnet-5.5'`))
      await chooseModelOption("OpenRouter routing", "Nitro")
      await chooseModelOption("Model preset", "Claude Haiku 5.5")
      requireCheck("haiku-preset-preserves-nitro", await run<boolean>(`${query("#own-model")}.value === 'anthropic/claude-haiku-5.5:nitro'`))
      await fill("#own-model", "custom/smoke-model:nitro")
      await until(`${query('[aria-label="Model preset"]')}.textContent.includes('Custom')`)
      requireCheck("manual-model-remains-editable", await run<boolean>(`${query("#own-model")}.value === 'custom/smoke-model:nitro' && !${query("#own-model")}.disabled`))
      await chooseModelOption("Model preset", "Claude Sonnet 5.5")
      for (const width of [1440, 390]) {
        await resizeViewport(panel, width, 900)
        await run(`${query("#own-url")}.closest('form').scrollIntoView({ block: 'center' })`)
        requireCheck(`model-form-layout-${width}`, await run<boolean>(`!document.querySelector('select,datalist') && document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.scroll')].every(e => !e.clientWidth || e.scrollWidth <= e.clientWidth + 1) && (() => { const r = ${query("#own-url")}.closest('form').getBoundingClientRect(); const route = ${query('[aria-label="OpenRouter routing"]')}.getBoundingClientRect(); return r.left + 10 >= 8 && r.right - 10 <= innerWidth - 8 && route.top >= 0 && route.bottom <= innerHeight })()`))
        await click(query('[aria-label="Model preset"]'))
        await until(`Boolean(document.querySelector('[role="listbox"]'))`)
        await capture(`models-${width}.png`)
        await run(`${query('[aria-label="Model preset"]')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        await until(`!document.querySelector('[role="listbox"]')`)
      }
      // Editing the address changes provider without the OpenAI button's external catalog request.
      await fill("#own-url", baseUrl)
      await click(query("#own-model"))
      await until(`!${query('[aria-label="OpenRouter routing"]')} && !${query('[aria-label="Model preset"]')}`)
      requireCheck("local-provider-removes-nitro-routing", await run<boolean>(`${query("#own-model")}.value === 'anthropic/claude-sonnet-5.5'`))
      await click(button("Cancel", `${query("#own-url")}.closest('form')`))
      await until(`!${query("#own-url")}`)
      requireCheck("catalog-local-and-provider-not-saved", catalogRequests > 0 && JSON.stringify(settings.get().ownKey) === JSON.stringify(ownKey))
    } finally {
      globalThis.fetch = originalFetch
    }
    windows.showPanel("settings")
    await resizeViewport(panel, 1440, 900)
    await until(`Boolean(${query(promptSelector)})`)

    const toolbar = windows.get("main")!
    toolbarSession = await toolbar.webContents.executeJavaScript("window.api.invoke('session:state')") as SessionState
    await resizeViewport(toolbar, 360, 44)
    for (const status of ["idle", "recording"] as const) {
      windows.send("main", "session:state", { ...toolbarSession, status, startedAt: status === "recording" ? Date.now() - 75_000 : null, connected: status === "recording", notice: null })
      await sleep(200)
      requireCheck(`toolbar-360x44-${status}`, await toolbar.webContents.executeJavaScript(`innerWidth === 360 && innerHeight === 44 && document.querySelector('[aria-label="Converaid"]').textContent.includes('Converaid') && document.querySelector('[aria-label="Converaid"] img').complete && [...document.querySelectorAll('button')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })`) as boolean)
      const name = `toolbar-${status}.png`
      fs.writeFileSync(path.join(dir, name), (await toolbar.webContents.capturePage()).toPNG())
      screenshots.push(name)
    }
    windows.send("main", "session:state", toolbarSession)

    await click(button("Add prompt", query(promptsSection)))
    await until(`window.api.invoke('settings:get').then(s => s.prompts.length === 2)`)
    await fill('[aria-label="Prompt title"]', "Technical interview")
    await fill('[aria-label="System instructions"]', alphaInstruction)
    await fill('[aria-label="Background notes"]', "SMOKE_ALPHA_BACKGROUND: three years of API experience.")
    await click(button("Save prompt", query(promptsSection)))
    await until(`window.api.invoke('settings:get').then(s => s.prompts.find(p => p.id === s.activePromptId)?.content === ${JSON.stringify(alphaInstruction)})`)
    requireCheck("prompt-add-edit-save", settings.get().prompts.some((prompt) => prompt.title === "Technical interview" && prompt.content === alphaInstruction && prompt.notes?.includes("SMOKE_ALPHA_BACKGROUND")))
    await click(button("Add prompt", query(promptsSection)))
    await until(`window.api.invoke('settings:get').then(s => s.prompts.length === 3)`)
    await fill('[aria-label="Prompt title"]', "Project follow-up")
    await fill('[aria-label="System instructions"]', betaInstruction)
    await fill('[aria-label="Background notes"]', "SMOKE_BETA_BACKGROUND: discuss delivery decisions.")
    await choosePrompt("Technical interview")
    requireCheck("dirty-prompt-saved-on-selection", settings.get().prompts.some((prompt) => prompt.title === "Project follow-up" && prompt.content === betaInstruction && prompt.notes?.includes("SMOKE_BETA_BACKGROUND")))
    await choosePrompt("General practice")
    await click(button("Remove prompt", query(promptsSection)))
    await until(`window.api.invoke('settings:get').then(s => s.prompts.length === 2 && !s.prompts.some(p => p.id === 'smoke-baseline'))`)
    requireCheck("prompt-removal-preserves-others", settings.get().prompts.some((prompt) => prompt.content === alphaInstruction) && settings.get().prompts.some((prompt) => prompt.content === betaInstruction))
    await choosePrompt("Technical interview")

    await click(query('[aria-label="Details for Scheduling Service"]'))
    await fill('textarea[aria-label="Project summary for Scheduling Service"]', alphaSummary)
    await fill('textarea[aria-label="Your role and experience for Scheduling Service"]', alphaRole)
    await click(query('[aria-label="Details for Scheduling Service"]'))
    await click(query('[aria-label="Details for Delivery Planner"]'))
    await fill('textarea[aria-label="Project summary for Delivery Planner"]', betaSummary)
    await click(query('[aria-label="Details for Delivery Planner"]'))
    await until(`window.api.invoke('settings:get').then(s => s.projects.find(p => p.id === 'smoke-scheduling')?.description === ${JSON.stringify(alphaSummary)} && s.projects.find(p => p.id === 'smoke-scheduling')?.experience === ${JSON.stringify(alphaRole)} && s.projects.find(p => p.id === 'smoke-delivery')?.description === ${JSON.stringify(betaSummary)})`)
    requireCheck("separate-project-summaries-and-roles", settings.get().projects.every((project) => project.description === (project.id === "smoke-scheduling" ? alphaSummary : betaSummary) && project.experience === (project.id === "smoke-scheduling" ? alphaRole : betaRole)))

    // A real live-chat turn makes accidental sharing observable in the later provider payload.
    await chat.send(liveMarker)
    const liveHistory = JSON.stringify(chat.getHistory())
    const beforeCandidate = requests.length
    windows.showPanel("simulation")
    await until(`Boolean(${query(simulationInput)}) && Boolean(${query('[aria-label="Input speaker"]')})`)
    await run("window.api.invoke('simulation:clear')")
    await click(button("Candidate (you)", query('[aria-label="Input speaker"]')))
    await until(`(${button("Candidate (you)", query('[aria-label="Input speaker"]'))}).getAttribute('aria-pressed') === 'true'`)
    await fill(simulationInput, candidateText)
    await click(button("Add candidate turn", query(simulationSection)))
    await until(`document.querySelectorAll('[data-simulation-role="candidate"]').length === 1 && !${query(simulationInput)}.value`)
    await sleep(300)
    requireCheck("candidate-context-without-provider-call", requests.length === beforeCandidate && (await simulationState()).turns.length === 1)
    requireCheck("microphone-unused", !(await simulationState()).listening && await run<boolean>(`Boolean(${query('button[aria-label="Record simulation turn"]')})`))
    await click(button("Interviewer", query('[aria-label="Input speaker"]')))
    await until(`(${button("Interviewer", query('[aria-label="Input speaker"]'))}).getAttribute('aria-pressed') === 'true'`)
    await fill(simulationInput, "How would you validate the scheduling API request?")
    await click(button("Ask as interviewer", query(simulationSection)))
    await until(`Boolean(document.querySelector('[data-simulation-role="assistant"][data-simulation-status="streaming"]')) && document.querySelector('[data-simulation-role="assistant"]').textContent.includes('I would start with')`)
    requireCheck("streamed-answer-and-reset-lock", await run<boolean>(`(${button("Reset simulation", query(simulationSection))}).disabled`))
    await until(`window.api.invoke('simulation:state').then(s => !s.busy && s.turns.some(t => t.role === 'assistant' && t.status === 'complete'))`)
    const firstAnswer = (await simulationState()).turns.find((turn) => turn.role === "assistant")!
    const firstRequest = requests[beforeCandidate]
    const firstSystem = firstRequest.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n")
    requireCheck("selected-prompt-and-shared-format", firstSystem.includes(alphaInstruction) && firstSystem.includes("SMOKE_ALPHA_BACKGROUND") && firstSystem.includes(ANSWER_FORMAT))
    requireCheck("project-summaries-and-roles-in-model", [alphaSummary, betaSummary, alphaRole, betaRole].every((text) => firstSystem.includes(text)))
    requireCheck("labeled-candidate-context-and-isolated-history", JSON.stringify(firstRequest.messages).includes(`Candidate: ${candidateText}`) && !JSON.stringify(firstRequest.messages).includes(liveMarker) && JSON.stringify(chat.getHistory()) === liveHistory)
    requireCheck("numeric-first-and-completion-timing", firstAnswer.text === reply && typeof firstAnswer.firstTokenMs === "number" && Number.isFinite(firstAnswer.firstTokenMs) && firstAnswer.firstTokenMs >= 0 && typeof firstAnswer.totalMs === "number" && Number.isFinite(firstAnswer.totalMs) && firstAnswer.totalMs >= firstAnswer.firstTokenMs && await run<boolean>(`/First text: [0-9.]+ (ms|s)/.test(${query('[data-simulation-role="assistant"]')}.textContent) && /Completed: [0-9.]+ (ms|s)/.test(${query('[data-simulation-role="assistant"]')}.textContent)`))

    for (const width of [1440, 390]) {
      windows.showPanel("settings")
      await until(`Boolean(${query(promptSelector)})`)
      await resizeViewport(panel, width, 900)
      await run(`${query(promptsSection)}.scrollIntoView({ block: 'start' })`)
      await checkLayout(width, promptsSection)
      await capture(`prompts-${width}.png`)
      await click(query(promptSelector))
      await until(`Boolean(document.querySelector('[role="listbox"]'))`)
      requireCheck(`prompt-dropdown-${width}`, await run<boolean>(`(() => { const r = document.querySelector('[role="listbox"]').getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 0 && r.bottom <= innerHeight })()`))
      await capture(`prompt-menu-${width}.png`)
      await run(`${query(promptSelector)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await until(`!document.querySelector('[role="listbox"]')`)
      windows.showPanel("simulation")
      await until(`Boolean(${query(simulationInput)}) && document.querySelectorAll('[data-simulation-role="assistant"]').length === 1`)
      await resizeViewport(panel, width, 900)
      await checkLayout(width, simulationSection)
      requireCheck(`role-controls-${width}`, await run<boolean>(`(() => { const r = ${query('[aria-label="Input speaker"]')}.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 0 && r.bottom <= innerHeight })()`))
      await capture(`simulation-${width}.png`)
    }

    windows.showPanel("settings")
    await until(`Boolean(${query(promptSelector)})`)
    await choosePrompt("Project follow-up")
    windows.showPanel("simulation")
    await until(`Boolean(${query(simulationInput)})`)
    const beforeSecond = requests.length
    await fill(simulationInput, "Which delivery tradeoff would you explain first?")
    await click(button("Ask as interviewer", query(simulationSection)))
    await until(`window.api.invoke('simulation:state').then(s => !s.busy && s.turns.filter(t => t.role === 'assistant' && t.status === 'complete').length === 2)`)
    const secondSystem = requests[beforeSecond].messages.filter((message) => message.role === "system").map((message) => message.content).join("\n")
    requireCheck("prompt-switch-applies-to-next-answer", secondSystem.includes(betaInstruction) && secondSystem.includes("SMOKE_BETA_BACKGROUND") && !secondSystem.includes(alphaInstruction) && !secondSystem.includes("SMOKE_ALPHA_BACKGROUND"))
    requireCheck("one-request-per-interviewer-turn", requests.length === beforeCandidate + 2 && requests.every((request) => request.authenticated))
    await click(button("Reset simulation", query(simulationSection)))
    await until(`window.api.invoke('simulation:state').then(s => !s.busy && !s.listening && s.turns.length === 0)`)
    await until(`!document.querySelector('[data-simulation-role]')`)
    requireCheck("reset-clears-practice-only", !await run<boolean>("Boolean(document.querySelector('[data-simulation-role]'))") && JSON.stringify(chat.getHistory()) === liveHistory)

    requireCheck("overlay-windows-remain-visible", KINDS.every((kind) => windows.get(kind)?.isVisible() === true))
    const result = { ...summary(true), nativeTaskbarProof: process.platform === "win32" ? "overlay visibility verified; taskbar absence requires native desktop inspection" : "requires Windows verification" }
    fs.writeFileSync(path.join(dir, "simulation-ui-checks.json"), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    try { await capture("simulation-ui-failure.png") } catch { /* Preserve the original failure. */ }
    fs.writeFileSync(path.join(dir, "simulation-ui-checks.json"), JSON.stringify(summary(false, (error as Error).message), null, 2))
    throw error
  } finally {
    globalThis.fetch = originalFetch
    if (toolbarSession) windows.send("main", "session:state", toolbarSession)
    try { await run("window.api.invoke('simulation:listen', false)") } catch { /* The renderer may have failed. */ }
    server.closeAllConnections()
    await new Promise<void>((resolve) => { if (server.listening) server.close(() => resolve()); else resolve() })
    settings.update({ cloud: original.cloud, ownKey: original.ownKey, answerMode: original.answerMode, outputLanguage: original.outputLanguage, suggestions: original.suggestions, projects: original.projects, prompts: original.prompts, activePromptId: original.activePromptId })
    panel.setMaximumSize(originalMaximum[0], originalMaximum[1])
    panel.setBounds(originalBounds)
    windows.showPanel(originalWindows.panelTab)
    if (!originalWindows.chat) windows.hide("chat")
    if (originalMainBounds) windows.get("main")?.setBounds(originalMainBounds)
    const resolvedFixture = path.resolve(fixtureRoot)
    if (path.dirname(resolvedFixture) !== tempRoot || !path.basename(resolvedFixture).startsWith("meetingly-simulation-ui-")) throw new Error("Refusing to remove a simulation fixture outside the expected temporary directory")
    await fs.promises.rm(resolvedFixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Render sample content into the panel and save each window as a PNG (with alpha) plus its bounds. */
async function shots(windows: WindowManager, settings: SmokeDeps["settings"], dir: string): Promise<void> {
  const now = Date.now()
  // Suggestions start off (1.2.5); the shots show the rail, so turn them on (smoke runs use a throwaway settings folder).
  settings.update({ suggestions: true })
  const sample = [
    { id: "s1", role: "user", kind: "auto", text: "What is Kafka?", timestamp: now },
    { id: "s2", role: "assistant", kind: "auto", text: "**Kafka is a distributed event-streaming platform for publishing, storing and processing real-time data.**\n- Producers write to topics\n- Consumers read at their own pace\n- Partitions scale it out\n- Replicated, so durable", timestamp: now },
    { id: "s3", role: "user", kind: "auto", text: "How would you scale the database as traffic grows?", timestamp: now },
    { id: "s4", role: "assistant", kind: "auto", text: "**I'd scale it in stages: find the bottleneck, fix queries and indexes, then add read replicas and shard by key.**\n- Profile the load first\n- Indexes and query plans\n- Read replicas for reads\n- Shard by merchant ID", timestamp: now }
  ] as const
  // A session in progress with the suggestions rail; "paused" shows it without starting audio capture.
  windows.setPanelExtra(SUGGESTIONS_WIDTH)
  windows.showPanel("answers")
  await sleep(1500)
  windows.send("chat", "session:state", { status: "paused", startedAt: now, notice: null, connected: true, audioSource: "both", audioDeviceId: "" })
  windows.send("chat", "suggestions:state", {
    topic: "Scaling the payments database",
    items: [
      { id: "q1", text: "What is database sharding and when is it needed?" },
      { id: "q2", text: "How does replication differ from sharding?" },
      { id: "q3", text: "How do you choose a shard key for a payments service?" },
      { id: "q4", text: "What is consumer lag in Kafka and how do you monitor it?" }
    ],
    updating: false
  })
  for (const m of sample) windows.send("chat", "chat:message", { ...m })
  await sleep(800)
  const save = async (name: string) => {
    for (const kind of ["main", "chat"] as WindowKind[]) {
      const win = windows.get(kind)
      if (!win) continue
      const img = await win.webContents.capturePage()
      fs.writeFileSync(`${dir}/${name}-${kind}.png`, img.toPNG())
      fs.writeFileSync(`${dir}/${name}-${kind}.json`, JSON.stringify(win.getBounds()))
    }
  }
  await save("answers")
  windows.showPanel("transcript")
  const said: [string, "you" | "them", boolean][] = [
    ["Thanks for joining! Tell me a bit about yourself and your experience.", "them", true],
    ["Hi! I've been a backend engineer for five years, mostly Go and Kafka.", "you", true],
    ["For the last two years I've owned our payments service.", "you", true],
    ["Great. How would you scale the database as traffic grows?", "them", true],
    ["And what would you do first if latency doubled overnight", "them", false]
  ]
  await sleep(400)
  for (const [text, channel, isFinal] of said) {
    windows.send("chat", "session:transcript", { text, isFinal, speechFinal: isFinal, confidence: 1, speaker: null, channel })
    await sleep(60)
  }
  await sleep(600)
  await save("transcript")
  windows.showPanel("settings")
  await sleep(600)
  await save("settings")
  // The rest of the list, scrolled to its end.
  await windows.get("chat")?.webContents.executeJavaScript(`document.querySelectorAll(".scroll").forEach((e) => { if (e.offsetParent) e.scrollTop = e.scrollHeight })`)
  await sleep(300)
  await save("settings-end")
}

/**
 * Hide everything with the toolbar's eye button, bring it back each way a user can (Ctrl+B, the tray's
 * "Show toolbar", launching the app again), then use the toolbar's chat button. After every round the
 * windows must be where they belong, on top, and both renderers must answer quickly.
 */
async function hideSmoke(windows: WindowManager): Promise<Record<string, unknown> & { ok: boolean }> {
  const main = () => windows.get("main")!
  const panel = () => windows.get("chat")
  const click = (title: string) =>
    main().webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.title || "").startsWith(${JSON.stringify(title)})); if (b) b.click(); return Boolean(b) })()`) as Promise<boolean>
  const ping = async (kind: "main" | "chat") => {
    const win = kind === "main" ? main() : panel()
    if (!win) return -1
    const t0 = Date.now()
    await Promise.race([win.webContents.executeJavaScript("new Promise((r) => requestAnimationFrame(() => r(1)))"), sleep(3000)])
    return Date.now() - t0
  }
  // On screen: shown and inside a display (a hidden toolbar on Windows is parked off-screen, still shown).
  const onScreen = () => main().isVisible() && screen.getAllDisplays().some((d) => { const b = main().getBounds(); const a = d.bounds; return b.x >= a.x && b.y >= a.y && b.x < a.x + a.width && b.y < a.y + a.height })
  const snap = async (label: string) => ({
    label,
    main: windows.isVisible("main"),
    mainOnScreen: onScreen(),
    chat: panel()?.isVisible() ?? false,
    mainOnTop: main().isAlwaysOnTop(),
    chatOnTop: panel()?.isAlwaysOnTop() ?? null,
    mainMs: await ping("main"),
    chatMs: await ping("chat"),
    windows: BrowserWindow.getAllWindows().length,
    toggleState: windows.state()
  })
  const rounds: Record<string, unknown>[] = []
  const problems: string[] = []
  const reopen: [string, () => void][] = [
    ["Ctrl+B (toggle all)", () => windows.toggleAll()],
    ["tray: Show toolbar", () => windows.centerMain()],
    ["launch again (second instance)", () => windows.centerMain()],
    ["Ctrl+B again", () => windows.toggleAll()]
  ]
  windows.showPanel("answers")
  await sleep(1200)
  for (const [route, open] of reopen) {
    for (const withPanel of [true, false]) {
      if (withPanel && !windows.isVisible("chat")) windows.showPanel("answers")
      if (!withPanel && windows.isVisible("chat")) windows.hide("chat")
      await sleep(300)
      if (!(await click("Hide all windows"))) problems.push("eye button not found")
      await sleep(500)
      const hidden = await snap(`${route}, panel ${withPanel ? "open" : "closed"}: hidden`)
      if (hidden.main || hidden.chat || hidden.mainOnScreen) problems.push(`${hidden.label}: something still visible`)
      open()
      await sleep(700)
      const back = await snap(`${route}: back`)
      if (!back.main || !back.mainOnScreen) problems.push(`${route}: toolbar didn't come back`)
      if (back.chat !== withPanel) problems.push(`${route}: panel ${withPanel ? "didn't come back" : "came back uninvited"}`)
      // Then the chat button, twice: it must close and open the panel (or open and close it).
      const first = back.chat
      await click("Answers and chat")
      await sleep(500)
      const afterOne = await snap(`${route}: chat button once`)
      await click("Answers and chat")
      await sleep(500)
      const afterTwo = await snap(`${route}: chat button twice`)
      if (afterOne.chat === first) problems.push(`${route}: first chat click did nothing (panel ${first ? "stayed open" : "stayed closed"})`)
      if (afterTwo.chat !== first) problems.push(`${route}: second chat click did nothing`)
      for (const s of [back, afterOne, afterTwo]) {
        if (s.main && !s.mainOnTop) problems.push(`${s.label}: toolbar lost always-on-top`)
        if (s.chat && s.chatOnTop === false) problems.push(`${s.label}: panel lost always-on-top`)
        if (s.mainMs > 500 || s.chatMs > 500) problems.push(`${s.label}: slow renderer (${s.mainMs} / ${s.chatMs} ms)`)
      }
      rounds.push(hidden, back, afterOne, afterTwo)
    }
  }
  return { ok: problems.length === 0, problems, rounds: rounds.map((r) => JSON.stringify(r)) }
}

/**
 * Hardware input, as a person does it: the real cursor clicks the eye button, a real Ctrl+B keypress brings the
 * windows back, then the real cursor clicks the chat button. Each step starts from a known state, so one failure
 * doesn't cascade, and records which mouse events reached the toolbar page (a dead button shows a release without
 * a press). Clicks only land while our toolbar is on screen at that spot; the cursor goes back afterwards.
 * Meant for a machine nobody is using at the time (CI): it moves the real cursor.
 */
async function hardwareSmoke(windows: WindowManager): Promise<Record<string, unknown> & { ok: boolean }> {
  if (process.platform !== "win32") return { ok: true, skipped: "Windows only" }
  const ps = (script: string) =>
    new Promise<string>((resolve) => {
      const p = spawn("powershell.exe", ["-NoProfile", "-Command", script])
      let out = ""
      p.stdout.on("data", (d) => (out += d))
      p.on("close", () => resolve(out.trim()))
    })
  const NATIVE = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class H { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e); public struct POINT { public int X; public int Y; } }';`
  const main = () => windows.get("main")!
  const where = async (title: string) => {
    if (!windows.isVisible("main")) return null
    const win = main()
    const b = win.getBounds()
    const scale = screen.getDisplayMatching(b).scaleFactor
    const r = (await win.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.title || "").startsWith(${JSON.stringify(title)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
    )) as { x: number; y: number } | null
    return r ? { x: Math.round((b.x + r.x) * scale), y: Math.round((b.y + r.y) * scale) } : null
  }
  const events: string[] = []
  const click = async (title: string) => {
    const p = await where(title)
    if (!p) {
      events.push(`${title}: toolbar not on screen, not clicked`)
      return false
    }
    await main().webContents.executeJavaScript(
      `window.__ev = []; if (!window.__hooked) { window.__hooked = true; for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) addEventListener(t, () => window.__ev.push(t), true) }`
    )
    await ps(`${NATIVE} [H]::SetCursorPos(${p.x}, ${p.y}) | Out-Null; Start-Sleep -Milliseconds 150; [H]::mouse_event(2, 0, 0, 0, 0); Start-Sleep -Milliseconds 80; [H]::mouse_event(4, 0, 0, 0, 0)`)
    await sleep(200)
    events.push(`${title}: toolbar page got [${((await main().webContents.executeJavaScript("window.__ev")) as string[]).join(", ")}]`)
    return true
  }
  const ctrlB = () => ps(`${NATIVE} [H]::keybd_event(0x11, 0, 0, 0); Start-Sleep -Milliseconds 40; [H]::keybd_event(0x42, 0, 0, 0); Start-Sleep -Milliseconds 60; [H]::keybd_event(0x42, 0, 2, 0); [H]::keybd_event(0x11, 0, 2, 0)`)
  const saved = await ps(`${NATIVE} $p = New-Object H+POINT; [H]::GetCursorPos([ref]$p) | Out-Null; "$($p.X) $($p.Y)"`)
  const steps: string[] = []
  const problems: string[] = []
  const check = (label: string, ok: boolean) => {
    steps.push(`${ok ? "ok  " : "FAIL"} ${label}`)
    if (!ok) problems.push(label)
  }
  /** Toolbar showing, panel closed, whatever happened before. */
  const reset = async () => {
    if (!windows.isVisible("main")) windows.showAll()
    if (windows.isVisible("chat")) windows.hide("chat")
    await sleep(600)
  }
  // HW_PLAN picks what happens before the chat button is clicked, to find what breaks the toolbar:
  //   click-key  the eye button (real click), then a real Ctrl+B: what users do (default)
  //   click-api  the eye button, then shown again by code      api-key   hidden by code, then a real Ctrl+B
  //   api-api    hidden and shown by code                      move-key  real Ctrl+Down, Ctrl+Up (moves, no hiding)
  //   shift-key  a real Shift press, nothing else
  //   drag       drag the panel's header with the real mouse: the toolbar and the panel move together
  const plan = process.env.HW_PLAN || "click-key"
  const realKey = (vk: number) => ps(`${NATIVE} [H]::keybd_event(${vk}, 0, 0, 0); Start-Sleep -Milliseconds 60; [H]::keybd_event(${vk}, 0, 2, 0)`)
  const ctrlKey = (vk: number) => ps(`${NATIVE} [H]::keybd_event(0x11, 0, 0, 0); Start-Sleep -Milliseconds 40; [H]::keybd_event(${vk}, 0, 0, 0); Start-Sleep -Milliseconds 60; [H]::keybd_event(${vk}, 0, 2, 0); [H]::keybd_event(0x11, 0, 2, 0)`)
  steps.push(`plan: ${plan}`)
  if (plan === "drag") {
    try {
      await sleep(800)
      for (let round = 1; round <= Number(process.env.HW_ROUNDS || 3); round++) {
        windows.showPanel("answers")
        await sleep(1200)
        const panel = windows.get("chat")
        if (!panel || !windows.isVisible("chat")) {
          check(`round ${round}: the panel is open`, false)
          continue
        }
        const pb = panel.getBounds()
        const scale = screen.getDisplayMatching(pb).scaleFactor
        // An empty spot in the header: right of the tabs, left of the buttons, and nothing clickable under it.
        const spot = (await panel.webContents.executeJavaScript(
          `(() => { const h = document.querySelector("header"); if (!h) return null; const r = h.getBoundingClientRect(); const x = r.x + r.width * 0.5, y = r.y + r.height / 2; const el = document.elementFromPoint(x, y); return el && !el.closest("button, select, input, a, label") ? { x, y } : null })()`
        )) as { x: number; y: number } | null
        check(`round ${round}: an empty spot in the panel header`, Boolean(spot))
        if (!spot) continue
        const before = { main: main().getBounds(), panel: pb }
        const from = { x: Math.round((pb.x + spot.x) * scale), y: Math.round((pb.y + spot.y) * scale) }
        const by = { x: round % 2 ? 160 : -140, y: round % 2 ? 90 : -70 }
        const moves = Array.from({ length: 12 }, (_, i) => `[H]::SetCursorPos(${Math.round(from.x + (by.x * (i + 1)) / 12)}, ${Math.round(from.y + (by.y * (i + 1)) / 12)}) | Out-Null; Start-Sleep -Milliseconds 25;`).join(" ")
        await ps(`${NATIVE} [H]::SetCursorPos(${from.x}, ${from.y}) | Out-Null; Start-Sleep -Milliseconds 150; [H]::mouse_event(2, 0, 0, 0, 0); Start-Sleep -Milliseconds 80; ${moves} Start-Sleep -Milliseconds 120; [H]::mouse_event(4, 0, 0, 0, 0)`)
        await sleep(700)
        const after = { main: main().getBounds(), panel: panel.getBounds() }
        const moved = { x: after.main.x - before.main.x, y: after.main.y - before.main.y }
        const want = { x: by.x / scale, y: by.y / scale }
        steps.push(`round ${round}: dragged ${by.x},${by.y} px; toolbar moved ${moved.x},${moved.y} DIP; panel moved ${after.panel.x - before.panel.x},${after.panel.y - before.panel.y}`)
        check(`round ${round}: the toolbar follows the drag`, Math.abs(moved.x - want.x) <= 8 && Math.abs(moved.y - want.y) <= 8)
        check(`round ${round}: the panel stays attached`, Math.abs(after.panel.x - before.panel.x - moved.x) <= 2 && Math.abs(after.panel.y - before.panel.y - moved.y) <= 2)
        // The toolbar still answers real clicks afterwards.
        await click("Answers and chat")
        await sleep(1000)
        check(`round ${round}: then the chat button still closes the panel`, !windows.isVisible("chat"))
      }
    } finally {
      const [x, y] = saved.split(" ").map(Number)
      if (Number.isFinite(x) && Number.isFinite(y)) await ps(`${NATIVE} [H]::SetCursorPos(${x}, ${y}) | Out-Null`)
    }
    return { ok: problems.length === 0, steps, events }
  }
  try {
    await sleep(800)
    if (process.env.HW_CONTROL !== "0") {
      // Control: real clicks on the chat button before anything else happened.
      await click("Answers and chat")
      await sleep(1000)
      check("control: the chat button opens the panel", windows.isVisible("chat"))
      await click("Answers and chat")
      await sleep(1000)
      check("control: the chat button closes the panel", !windows.isVisible("chat"))
    }
    for (let round = 1; round <= Number(process.env.HW_ROUNDS || 3); round++) {
      await reset()
      if (plan === "move-key") {
        await ctrlKey(0x28)
        await sleep(400)
        await ctrlKey(0x26)
        await sleep(900)
      } else if (plan === "shift-key") {
        await realKey(0x10)
        await sleep(900)
      } else {
        if (plan.startsWith("click")) await click("Hide all windows")
        else windows.hideAll()
        await sleep(800)
        const hidden = !windows.isVisible("main")
        check(`round ${round}: everything hidden`, hidden)
        if (!hidden) windows.hideAll()
        await sleep(300)
        if (plan.endsWith("key")) await ctrlB()
        else windows.toggleAll()
        await sleep(900)
        const back = windows.isVisible("main")
        check(`round ${round}: the toolbar is back`, back)
        if (!back) windows.showAll()
        await sleep(300)
      }
      if (windows.isVisible("chat")) windows.hide("chat")
      await sleep(400)
      await click("Answers and chat")
      await sleep(1000)
      check(`round ${round}: then the chat button opens the panel`, windows.isVisible("chat"))
      if (windows.isVisible("chat")) {
        await click("Answers and chat")
        await sleep(1000)
        check(`round ${round}: and closes it again`, !windows.isVisible("chat"))
      }
    }
  } finally {
    const [x, y] = saved.split(" ").map(Number)
    if (Number.isFinite(x) && Number.isFinite(y)) await ps(`${NATIVE} [H]::SetCursorPos(${x}, ${y}) | Out-Null`)
  }
  return { ok: problems.length === 0, steps, events }
}

/**
 * The own-key flow in the real panel, against a fake OpenAI-compatible server on localhost: the tray's
 * "Use your own API key…" opens the form, it fills, Save checks the endpoint and switches the app over, and a
 * chat message is answered by that endpoint with the user's key. PNGs of each step go to IGPT_SMOKE_SHOTS.
 */
async function ownKeySmoke(windows: WindowManager, chat: ChatService, settings: SettingsStore): Promise<Record<string, unknown> & { ok: boolean }> {
  const seen: { path: string; auth?: string; model?: unknown; task?: string }[] = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, model: body.model, task: req.headers["x-meetingly-task"] as string | undefined })
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ data: [{ id: "smoke-model" }, { id: "smoke-model-mini" }] }))
      }
      const text = "**Kafka is a distributed log for streaming events.**\n- Topics split into partitions\n- Consumers read at their own pace"
      if (body.stream) {
        const chunk = (choices: object[], extra: object = {}) =>
          `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: body.model, choices, ...extra })}\n\n`
        res.writeHead(200, { "Content-Type": "text/event-stream" })
        return res.end(chunk([{ index: 0, delta: { content: text }, finish_reason: null }]) + chunk([], { usage: { total_tokens: 9 } }) + "data: [DONE]\n\n")
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ id: "1", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { total_tokens: 9 } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const dir = process.env.IGPT_SMOKE_SHOTS
  const shot = async (name: string) => {
    const win = windows.get("chat")
    if (dir && win) fs.writeFileSync(`${dir}/ownkey-${name}.png`, (await win.webContents.capturePage()).toPNG())
  }
  const panel = windows.get("chat")
  const run = (js: string) => panel!.webContents.executeJavaScript(js) as Promise<unknown>
  const steps: Record<string, boolean> = {}
  try {
    settings.update({ ownKey: null })
    windows.showPanel("answers")
    await sleep(500)
    windows.send("chat", "plan:state", { status: "signed-out" })
    await sleep(500)
    await shot("1-signed-out")
    // Not offered on the signed-out bar any more: only the tray opens it.
    const offeredOnBar = (await run(`[...document.querySelectorAll("button")].some((x) => x.textContent.includes("OpenRouter"))`)) === true
    openOwnKeyForm(windows)
    await sleep(600)
    steps.offered = !offeredOnBar && (await run(`Boolean(document.getElementById("own-url"))`)) === true
    const fill = (id: string, value: string) =>
      run(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new FocusEvent("blur")); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); return true })()`)
    steps.filled = (await fill("own-url", base)) === true && (await fill("own-key", "sk-smoke-123")) === true && (await fill("own-model", "smoke-model")) === true
    await sleep(800)
    await run(`document.getElementById("own-models")?.click()`)
    steps.listedModels = (await run(`document.querySelectorAll('[role="option"]').length`)) === 3
    await run(`document.getElementById("own-models")?.click()`)
    await shot("2-form")
    await run(`document.querySelector("form button[type=submit]").click()`)
    for (let i = 0; i < 20 && !settings.get().ownKey; i++) await sleep(250)
    const saved = settings.get().ownKey
    steps.saved = Boolean(saved && saved.model === "smoke-model" && saved.baseUrl === base && saved.key && saved.key !== "sk-smoke-123")
    steps.checked = seen.some((s) => s.path === "/v1/chat/completions" && s.auth === "Bearer sk-smoke-123")
    await sleep(1200)
    steps.bar = (await run(`document.body.innerText.includes("smoke-model")`)) === true
    await shot("3-in-use")
    const before = seen.length
    const reply = new Promise<string>((resolve) => {
      const onMessage = (m: { role: string; kind?: string; text: string }) => {
        if (m.role === "assistant") {
          chat.off("message", onMessage)
          resolve(m.kind === "error" ? `error: ${m.text}` : m.text)
        }
      }
      chat.on("message", onMessage)
    })
    await chat.send("What is Kafka?")
    const text = await Promise.race([reply, sleep(20000).then(() => "timeout")])
    const answered = seen.slice(before).find((s) => s.path === "/v1/chat/completions")
    steps.answered = text.startsWith("**Kafka") && answered?.auth === "Bearer sk-smoke-123" && answered.model === "smoke-model" && answered.task === undefined
    await sleep(600)
    await shot("4-answer")
    if (dir) await ollamaShot(run, settings, windows, shot)
    return { ok: Object.values(steps).every(Boolean) && Object.keys(steps).length === 7, steps, requests: seen.map((s) => s.path) }
  } catch (err) {
    return { ok: false, steps, error: (err as Error).message }
  } finally {
    settings.update({ ownKey: null })
    server.close()
  }
}

/**
 * For the store and README images: the form as an Ollama user fills it, with the model list coming from a
 * stand-in on Ollama's own port (skipped when something already listens there). Not part of the check.
 */
async function ollamaShot(run: (js: string) => Promise<unknown>, settings: SettingsStore, windows: WindowManager, shot: (name: string) => Promise<void>): Promise<void> {
  const ollama = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(req.url === "/v1/models" ? JSON.stringify({ data: ["gpt-oss:20b", "llama3.2", "qwen3:8b"].map((id) => ({ id })) }) : "{}")
  })
  const listening = await new Promise<boolean>((resolve) => {
    ollama.once("error", () => resolve(false))
    ollama.listen(11434, "127.0.0.1", () => resolve(true))
  })
  if (!listening) return
  try {
    settings.update({ ownKey: null })
    windows.send("chat", "chat:cleared", undefined)
    windows.send("chat", "plan:state", { status: "signed-out" })
    await sleep(500)
    openOwnKeyForm(windows)
    await sleep(600)
    await run(`[...document.querySelectorAll("form button")].find((b) => b.textContent === "Ollama")?.click()`)
    await sleep(800)
    await run(`(() => { const el = document.getElementById("own-model");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "llama3.2");
      el.dispatchEvent(new Event("input", { bubbles: true })) })()`)
    await sleep(400)
    await shot("5-ollama")
  } finally {
    ollama.close()
  }
}

/**
 * Frames for the README demo: the panel during an interview, an answer streaming in after each question.
 * Writes demo-NNN.png (panel) + demo-main.png (toolbar) with their bounds into IGPT_SMOKE_SHOTS, plus
 * frames.json with each frame's duration; scripts outside the app turn them into an animation.
 */
async function demoFrames(windows: WindowManager, dir: string): Promise<void> {
  const now = Date.now()
  const frames: { file: string; ms: number }[] = []
  const panel = () => windows.get("chat")!
  const grab = async (ms: number) => {
    const file = `demo-${String(frames.length).padStart(3, "0")}.png`
    fs.writeFileSync(`${dir}/${file}`, (await panel().webContents.capturePage()).toPNG())
    frames.push({ file, ms })
  }
  windows.setPanelExtra(SUGGESTIONS_WIDTH)
  windows.showPanel("answers")
  await sleep(1500)
  windows.send("chat", "chat:cleared", undefined)
  windows.send("chat", "session:state", { status: "paused", startedAt: now, notice: null, connected: true, audioSource: "both", audioDeviceId: "" })
  // The toolbar shows a call in progress; only the panel captures audio, and it stays paused.
  windows.send("main", "session:state", { status: "recording", startedAt: now - 754_000, notice: null, connected: true, audioSource: "both", audioDeviceId: "" })
  const scenes = [
    {
      topic: "Scaling the payments database",
      suggestions: ["How do you choose a shard key?", "Replication vs sharding: what's the difference?", "What would you do if latency doubled overnight?"],
      question: "How would you scale the database as traffic grows?",
      answer: "**I'd scale it in stages: find the bottleneck, fix queries and indexes, then add read replicas and shard by key.**\n- Profile the load first\n- Indexes and query plans\n- Read replicas for reads\n- Shard by merchant ID"
    },
    {
      topic: "Scaling the payments database",
      suggestions: ["How do you keep shards balanced?", "How would you migrate without downtime?", "What metrics would you alert on?"],
      question: "And what would you do first if latency doubled overnight?",
      answer: "**First I'd check what changed: deploys, traffic and slow queries, then roll back if a release lines up.**\n- Compare p95 before and after\n- Slow-query log and lock waits\n- Roll back, then dig in"
    }
  ]
  await grab(700)
  for (const [i, scene] of scenes.entries()) {
    windows.send("chat", "suggestions:state", { topic: scene.topic, items: scene.suggestions.map((text, n) => ({ id: `q${i}${n}`, text })), updating: false })
    windows.send("chat", "chat:message", { id: `u${i}`, role: "user", kind: "auto", text: scene.question, timestamp: now })
    windows.send("chat", "chat:busy", true)
    await sleep(250)
    await grab(500)
    const id = `a${i}`
    const words = scene.answer.split(/(?<= )/)
    for (let w = 0; w < words.length; w += 2) {
      windows.send("chat", "chat:chunk", { id, text: words.slice(w, w + 2).join("") })
      await sleep(60)
      await grab(70)
    }
    windows.send("chat", "chat:message", { id, role: "assistant", kind: "auto", text: scene.answer, timestamp: now })
    windows.send("chat", "chat:busy", false)
    await sleep(250)
    await grab(i === scenes.length - 1 ? 3200 : 2400)
  }
  const main = windows.get("main")
  if (main) fs.writeFileSync(`${dir}/demo-main.png`, (await main.webContents.capturePage()).toPNG())
  fs.writeFileSync(`${dir}/frames.json`, JSON.stringify({ frames, chat: panel().getBounds(), main: main?.getBounds() }, null, 1))
}

/** Real model round-trips through ChatService.autoAnswer (relay, current default prompt). */
async function answersSmoke(chat: ChatService, settings: SettingsStore): Promise<Record<string, unknown> & { ok: boolean }> {
  const cases: { lang: "en" | "ru"; text: string; expect: "answer" | "skip" }[] = [
    { lang: "en", text: "What is Kafka?", expect: "answer" },
    { lang: "en", text: "So how would you design a rate limiter for a public API", expect: "answer" },
    { lang: "en", text: "Tell me about a time you disagreed with your manager.", expect: "answer" },
    { lang: "en", text: "Thanks, that makes sense, let's move on to the next part.", expect: "skip" },
    { lang: "ru", text: "Что такое Kafka?", expect: "answer" },
    { lang: "ru", text: "Расскажите, как бы вы масштабировали базу данных.", expect: "answer" },
    { lang: "ru", text: "Хорошо, понятно, спасибо.", expect: "skip" }
  ]
  const original = settings.get()
  const results: Record<string, unknown>[] = []
  for (const c of cases) {
    settings.update({ autoAnswer: "questions", outputLanguage: c.lang, audioLanguage: c.lang })
    chat.clear()
    let answer: string | null = null
    const onAnswer = (m: { text: string }) => { answer = m.text }
    chat.on("auto-answer", onAnswer)
    const started = Date.now()
    await chat.autoAnswer({ text: c.text, speaker: null, timestamp: Date.now() })
    chat.off("auto-answer", onAnswer)
    const got = answer === null ? "skip" : "answer"
    results.push({ heard: c.text, expect: c.expect, got, ok: got === c.expect, ms: Date.now() - started, answer })
  }
  settings.update({ autoAnswer: original.autoAnswer, outputLanguage: original.outputLanguage, audioLanguage: original.audioLanguage })
  return { ok: results.every((r) => r.ok), results }
}

/** Read a 16 kHz mono WAV (16-bit PCM or 32-bit float) as signed 16-bit samples. */
function readWav16k(file: string): Int16Array {
  const buf = fs.readFileSync(file)
  let off = 12
  let format = 1
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === "fmt ") format = buf.readUInt16LE(off + 8)
    if (id === "data") {
      const data = buf.subarray(off + 8, off + 8 + size)
      if (format === 3) {
        const f = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~3)))
        return Int16Array.from(f, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))))
      }
      return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1)))
    }
    off += 8 + size + (size % 2)
  }
  throw new Error("no audio data in " + file)
}

/**
 * Switching the meeting language mid-session, with the real on-device engine. English plays, the language changes
 * to Russian in the settings, Russian plays. A control session plays the Russian without the switch. Both are
 * sessions of their own (not the panel's), so no microphone or system audio is captured.
 */
async function switchSmoke(model: AsrModel): Promise<Record<string, unknown> & { ok: boolean }> {
  const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "igpt-switch-"))
  const run = async (switchLanguage: boolean) => {
    const settings = new SettingsStore(path.join(dir, `${switchLanguage ? "switch" : "control"}.json`))
    settings.update({ audioLanguage: "en", transcriptionEngine: "local" })
    const session = new RecordingSession({
      settings,
      meetings: new MeetingStore(path.join(dir, "meetings.json")),
      reports: { generate: async () => null } as unknown as ReportGenerator,
      asrModel: model,
      cloudTranscription: () => false
    })
    settings.onChange(() => session.syncEngine())
    const heard: Record<"before" | "after", string[]> = { before: [], after: [] }
    let phase: "before" | "after" = "before"
    session.on("transcript", (e: { text: string; isFinal: boolean }) => {
      if (e.isFinal) heard[phase].push(e.text)
    })
    await session.start()
    await playWav(session, process.env.IGPT_SMOKE_WAV ?? "")
    phase = "after"
    let reopenMs: number | null = null
    if (switchLanguage) {
      const switchedAt = Date.now()
      const reopened = new Promise<boolean>((resolve) => {
        const onState = (s: SessionState) => {
          if (!s.connected) return
          session.off("state", onState)
          resolve(true)
        }
        session.on("state", onState)
      })
      settings.update({ audioLanguage: "ru" })
      if (await Promise.race([reopened, sleep(60000).then(() => false)])) reopenMs = Date.now() - switchedAt
    }
    await playWav(session, process.env.IGPT_SMOKE_WAV2 ?? "")
    const meeting = await session.finish()
    return { before: heard.before.join(" "), after: heard.after.join(" "), reopenMs, meetingLanguage: meeting?.language ?? null }
  }
  try {
    const switched = await run(true)
    const control = await run(false)
    const cyrillic = (s: string) => /[а-яё]/i.test(s)
    return {
      ok: /[a-z]/i.test(switched.before) && !cyrillic(switched.before) && cyrillic(switched.after) && switched.reopenMs !== null && switched.meetingLanguage === "ru",
      switched,
      control
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Play a recording into a session at real-time pace on the system-audio side, then 2.5 s of silence. */
async function playWav(session: RecordingSession, wav: string): Promise<void> {
  const pcm = readWav16k(wav)
  const frames = pcm.length + 40000
  const stereo = new Int16Array(frames * 2)
  for (let i = 0; i < pcm.length; i++) stereo[2 * i + 1] = pcm[i]
  for (let f = 0; f < frames; f += 1600) {
    session.sendAudio(stereo.slice(2 * f, 2 * Math.min(frames, f + 1600)).buffer)
    await sleep(100)
  }
}

/** Test sets (FLEURS language folders, AMI meeting microphones) and the meeting language they are in. */
const SET_LANGUAGE: Record<string, LanguageCode> = {
  en_us: "en", ro_ro: "ro", ru_ru: "ru", es_419: "es", cmn_hans_cn: "zh", ja_jp: "ja", ko_kr: "ko",
  ar_eg: "ar", hi_in: "hi", tr_tr: "tr", vi_vn: "vi", ihm: "en", sdm: "en", de_de: "de", fr_fr: "fr", it_it: "it",
  pt_br: "pt", pl_pl: "pl", uk_ua: "uk", nl_nl: "nl", cs_cz: "cs", sv_se: "sv", bg_bg: "bg", hu_hu: "hu", fi_fi: "fi",
  da_dk: "da", hr_hr: "hr", sk_sk: "sk", et_ee: "et"
}

/**
 * The second pass end to end, as in a call: recorded sentences of a language play one after another on the
 * system-audio side, 2 s apart, through the live model and the second pass, at IGPT_SMOKE_SPEED times real time
 * (default 2). Writes what each produced, with the references, to IGPT_SMOKE_OUT for scoring.
 *   IGPT_SMOKE_MANIFEST  [{ file, ref, set }]   IGPT_SMOKE_SETS  "ro_ro,en_us"   IGPT_SMOKE_CLIPS  per set (default 12)
 * Runs without windows (main.ts), so nothing shows on the desktop.
 */
export async function runRefineSmoke({ asrModel, refineModels }: { asrModel: AsrModel; refineModels: RefineModels }): Promise<void> {
  const manifestPath = process.env.IGPT_SMOKE_MANIFEST ?? ""
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { file: string; ref: string; set: string }[]
  const base = path.dirname(manifestPath)
  const sets = (process.env.IGPT_SMOKE_SETS ?? "en_us").split(",").filter(Boolean)
  const perSet = Number(process.env.IGPT_SMOKE_CLIPS ?? 12)
  const speed = Number(process.env.IGPT_SMOKE_SPEED ?? 2)
  const results: Record<string, unknown>[] = []
  for (const set of sets) {
    const code = SET_LANGUAGE[set]
    const clips = manifest.filter((m) => m.set === set).slice(0, perSet)
    const refine = code ? refineModels.forLanguage(code) : null
    const socket = new LocalAsrSocket({ language: getLanguage(code ?? "en").asr, model: asrModel, refine })
    const live: string[] = []
    const finals: { text: string; at: number }[] = []
    let ended = 0
    socket.on("live-final", (f: { text: string }) => {
      live.push(f.text)
      ended = Date.now()
    })
    socket.on("transcript", (e: { text: string; isFinal: boolean }) => {
      if (e.isFinal) finals.push({ text: e.text, at: Date.now() - ended })
    })
    const started = Date.now()
    try {
      await socket.connect()
      for (let i = 0; i < 300 && refine && !socket.refining; i++) await sleep(100)
      const refining = socket.refining
      const gap = new Int16Array(32000)
      const parts = clips.flatMap((c) => [readWav16k(path.resolve(base, c.file)), gap])
      const total = parts.reduce((n, p) => n + p.length, 0) + 48000
      const stereo = new Int16Array(total * 2)
      let o = 0
      for (const p of parts) {
        for (let i = 0; i < p.length; i++) stereo[2 * (o + i) + 1] = p[i]
        o += p.length
      }
      for (let f = 0; f < total; f += 1600) {
        socket.sendAudio(stereo.slice(2 * f, 2 * Math.min(total, f + 1600)).buffer)
        await sleep(100 / speed)
      }
      for (let i = 0; i < 200 && socket.waiting > 0; i++) await sleep(100)
      results.push({
        set, language: code, refine: refine ? path.basename(refine.modelPath) : null, refining, clips: clips.length,
        audioSeconds: +(total / 16000).toFixed(1), wallSeconds: +((Date.now() - started) / 1000).toFixed(1),
        stats: { ...socket.stats }, refs: clips.map((c) => c.ref), live, finals: finals.map((f) => f.text),
        finalDelayMs: finals.map((f) => f.at)
      })
    } catch (err) {
      results.push({ set, error: (err as Error).message })
    } finally {
      socket.close()
      await sleep(2000)
    }
  }
  const out = process.env.IGPT_SMOKE_OUT
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1))
  const ok = results.every((r) => !r.error && (r.finals as string[]).length > 0)
  console.log(`SMOKE_REPORT ${JSON.stringify({ mode: "refine", ok, sets: results.map((r) => ({ set: r.set, refine: r.refine, refining: r.refining, stats: r.stats, error: r.error })) })}`)
  app.exit(ok ? 0 : 1)
}

/** Feed a recording through the speech worker at real-time pace (100 ms chunks), plus 1.5 s of silence. */
async function asrSmoke(model: AsrModel, wav: string, language: string): Promise<Record<string, unknown> & { ok: boolean }> {
  const started = Date.now()
  const socket = new LocalAsrSocket({ language, model })
  const finals: { text: string; speechFinal: boolean; channel: unknown; atMs: number }[] = []
  let partials = 0
  const workerErrors: string[] = []
  socket.on("error", (e: Error) => workerErrors.push(e.message))
  let firstPartialMs: number | null = null
  socket.on("transcript", (e: { text: string; isFinal: boolean; speechFinal: boolean; channel?: unknown }) => {
    if (e.isFinal) finals.push({ text: e.text, speechFinal: e.speechFinal, channel: e.channel, atMs: Date.now() - started })
    else {
      partials++
      if (firstPartialMs === null) firstPartialMs = Date.now() - started
    }
  })
  try {
    await socket.connect()
    const readyMs = Date.now() - started
    const pcm = readWav16k(wav)
    // Stereo like the capture: the recording plays on the system-audio side ("them"), the mic is silent.
    const side = process.env.IGPT_SMOKE_SIDE === "you" ? 0 : 1
    const frames = pcm.length + 24000
    const stereo = new Int16Array(frames * 2)
    for (let i = 0; i < pcm.length; i++) stereo[2 * i + side] = pcm[i]
    const feedStart = Date.now()
    for (let f = 0; f < frames; f += 1600) {
      socket.sendAudio(stereo.slice(2 * f, 2 * Math.min(frames, f + 1600)).buffer)
      await sleep(100)
    }
    await sleep(1500)
    socket.close()
    await sleep(800)
    return {
      ok: finals.length > 0,
      readyMs,
      audioSeconds: +(pcm.length / 16000).toFixed(1),
      firstPartialMs: firstPartialMs === null ? null : firstPartialMs - (feedStart - started),
      partials,
      finals,
      workerErrors
    }
  } catch (err) {
    socket.close()
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Account linking and two-way sync against a real server. Needs:
 *   IGPT_CLOUD_URL          the account service base URL (an ssh tunnel to a test copy works)
 *   IGPT_SMOKE_USER/_PASS   an existing, verified account that plays the browser side
 * A second, scripted "computer" is linked to the same account to make changes this app must receive.
 * Ends with both devices unlinked again.
 */
async function cloudSmoke({ cloud, settings, meetings }: Pick<SmokeDeps, "cloud" | "settings" | "meetings">): Promise<Record<string, unknown> & { ok: boolean }> {
  const base = (process.env.IGPT_CLOUD_URL ?? "").replace(/\/+$/, "")
  const email = process.env.IGPT_SMOKE_USER
  const password = process.env.IGPT_SMOKE_PASS
  const steps: Record<string, unknown> = {}
  const fail = (step: string, detail: unknown) => ({ ok: false, failedAt: step, detail, steps })
  if (!base || !email || !password) return fail("env", "IGPT_CLOUD_URL, IGPT_SMOKE_USER and IGPT_SMOKE_PASS are required")

  const call = async (method: string, path: string, opts: { body?: unknown; token?: string; cookie?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.cookie ? { Cookie: opts.cookie } : {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
    return { body, res }
  }
  const waitFor = async (what: string, check: () => boolean | Promise<boolean>, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await check()) return true
      await sleep(300)
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  let otherToken = ""
  try {
    // Seed one local meeting so the upload path is exercised.
    const smokeMeetingId = `smoke_${Date.now()}`
    meetings.save({
      id: smokeMeetingId,
      title: "Smoke meeting",
      startTime: Date.now() - 60000,
      endTime: Date.now(),
      duration: 60000,
      transcript: [{ text: "hello from the smoke test", timestamp: Date.now(), confidence: 1, speaker: 0 }],
      fullTranscriptText: "hello from the smoke test",
      language: "en",
      status: "completed",
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    if (settings.get().cloud) await cloud.unlink()

    // 1. app side: start linking (no browser is opened in smoke mode)
    const started = await cloud.linkStart()
    steps.code = started.code
    if (!started.code) return fail("link-start", started)

    // 2. browser side: sign in and confirm the code
    const signIn = await call("POST", "/api/auth/sign-in", { body: { email, password } })
    const cookie = (signIn.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("session=")) ?? ""
    if (!cookie) return fail("sign-in", "no session cookie")
    await call("POST", "/api/app/link/claim", { cookie, body: { code: started.code } })

    // 3. app side: the poll picks the token up and goes online
    await waitFor("cloud online", () => cloud.state().status === "online", 20000)
    steps.linkedAs = cloud.state().email

    // 4. a second computer on the same account, scripted
    const otherId = `smoke${Date.now().toString(36)}other`
    const other = await call("POST", "/api/app/link/start", { body: { deviceId: otherId, name: "Smoke second computer", platform: "linux", appVersion: "smoke" } })
    await call("POST", "/api/app/link/claim", { cookie, body: { code: other.body.code } })
    otherToken = (await call("GET", `/api/app/link/poll?code=${other.body.code}&deviceId=${otherId}`)).body.token
    if (!otherToken) return fail("second-device", "no token")

    // 5. the account has this app's profile, prompts and meeting
    const profile = (await call("GET", "/api/app/profile", { token: otherToken })).body.profile
    const prompts = (await call("GET", "/api/app/prompts", { token: otherToken })).body.prompts as { id: string; title: string; content: string; notes: string; active: boolean }[]
    await waitFor("meeting upload", async () => (await call("GET", "/api/app/meetings", { token: otherToken })).body.index.some((m: { localId: string }) => m.localId === smokeMeetingId))
    steps.initialUpload = { profile: Boolean(profile), prompts: prompts.length, meeting: "ok" }
    if (!profile || prompts.length < 1) return fail("initial-upload", steps)

    // 6. other computer -> this app (live): a setting
    const before = settings.get().answerLength
    const target = before === "short" ? "medium" : "short"
    await call("PUT", "/api/app/profile", { token: otherToken, body: { settings: { ...profile.settings, answerLength: target } } })
    await waitFor("remote setting to arrive", () => settings.get().answerLength === target)
    steps.remoteToLocal = "ok"

    // 7. this app -> the account: a setting
    const lang = settings.get().outputLanguage === "fr" ? "de" : "fr"
    settings.update({ outputLanguage: lang })
    await waitFor("local setting to upload", async () => (await call("GET", "/api/app/profile", { token: otherToken })).body.profile?.settings?.outputLanguage === lang)
    steps.localToRemote = "ok"

    // 8. a prompt edited on the other computer shows up here
    await call("PUT", "/api/app/prompts", { token: otherToken, body: { prompts: prompts.map((p, i) => ({ ...p, notes: i === 0 ? "smoke background note" : p.notes })) } })
    await waitFor("remote prompt edit", () => settings.get().prompts.some((p) => p.notes === "smoke background note"))
    steps.promptSync = "ok"

    // 9. the meeting deleted on the other computer disappears here
    await call("DELETE", `/api/app/meetings/${smokeMeetingId}`, { token: otherToken })
    await waitFor("remote meeting delete", () => !meetings.get(smokeMeetingId))
    steps.meetingDelete = "ok"

    // 10. clean up: restore, unlink both
    settings.update({ answerLength: before, outputLanguage: "en" })
    await sleep(1500)
    await call("DELETE", "/api/app/device", { token: otherToken })
    otherToken = ""
    await cloud.unlink()
    steps.unlinked = cloud.state().status
    return { ok: cloud.state().status === "off", steps }
  } catch (err) {
    if (otherToken) await call("DELETE", "/api/app/device", { token: otherToken }).catch(() => undefined)
    return fail("exception", (err as Error).message)
  }
}

/** Windows text-to-speech through the default speakers; resolves false where unavailable. */
function speakOnWindows(text: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false)
  return new Promise((resolve) => {
    const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = 100; $s.Speak('${text.replace(/'/g, "''")}')`
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true })
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
