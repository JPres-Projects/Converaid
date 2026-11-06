import { useState } from "react"
import { Camera, Check, EyeOff, MessageSquare, Mic, Pause, Play, Power, Settings, UserRound, X } from "lucide-react"
import { DEFAULT_SHORTCUTS } from "@shared/types"
import { t } from "@shared/i18n"
import { api, shortcutLabel } from "@/lib/api"
import { useCloudState, useElapsed, useEvent, useFitWindow, useSessionState, useSettings, useWindowsState } from "@/lib/hooks"
import type { PanelTab, UpdateState } from "@shared/types"
import { Button } from "@/components/ui/button"
import { Dot } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import converaidLogo from "../../build/converaid-logo.png"

/** The always-on-top toolbar. Everything else hangs off it. */
export function MainWindow() {
  const ref = useFitWindow<HTMLDivElement>()
  const session = useSessionState()
  const windows = useWindowsState()
  const [settings] = useSettings()
  const cloud = useCloudState()
  const KEYS = settings?.shortcuts ?? DEFAULT_SHORTCUTS
  // Not linked to an account (and not on an own API key): a quiet way in, next to the other buttons.
  const signedOut = settings !== null && !settings.ownKey && (cloud.status === "off" || cloud.status === "linking" || cloud.status === "error")
  const elapsed = useElapsed(session.startedAt)
  const [error, setError] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEvent("update:state", setUpdate)
  const updateNotice =
    update?.status === "installing"
      ? t("Updating Converaid to {version}…", { version: update.version ?? "" })
      : update?.status === "needs-move"
        ? t("Move Converaid to the Applications folder to get updates.")
        : null

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null)
      await action()
    } catch (err) {
      setError((err as Error).message)
      setTimeout(() => setError(null), 6000)
    }
  }

  const listen = () =>
    run(async () => {
      await api.invoke("panel:show", "transcript")
      await api.invoke("session:start")
    })
  const finish = () =>
    run(async () => {
      // Every finished session becomes a meeting and a .txt in Documents/Meetingly. Signed in, its report shows on
      // the web dashboard's Meetings page; otherwise (or kept on this computer) the file manager opens on the .txt.
      const meeting = await api.invoke("session:finish")
      if (!meeting) return
      if (cloud.status === "online" && !meeting.localOnly) await api.invoke("cloud:open-web", "meetings")
      else await api.invoke("transcripts:reveal")
    })
  const screenshot = () =>
    run(async () => {
      await api.invoke("panel:show", "answers")
      await api.invoke("chat:screenshot")
    })
  const showing = (tab: PanelTab) => windows.chat && windows.panelTab === tab
  // The panel shows the code to confirm in the browser, so it opens first.
  const signIn = () =>
    run(async () => {
      await api.invoke("panel:show", "answers")
      await api.invoke("cloud:link-start")
    })

  const live = session.status === "recording"
  const paused = session.status === "paused"
  const connecting = session.status === "connecting"

  return (
    <div ref={ref} className="inline-block w-[360px] max-w-[100vw] p-[4px]">
      <div className="glass drag flex h-[36px] items-center gap-1 !border-sky-200/20 !bg-[#09131f]/95 px-1.5" data-testid="converaid-toolbar">
        <div className="flex shrink-0 items-center gap-1 pr-0.5" aria-label="Converaid">
          <img src={converaidLogo} alt="" className="h-[18px] w-[18px] object-contain" draggable={false} />
          <span className="text-[11.5px] font-semibold tracking-[-0.035em] text-white">Converaid</span>
        </div>
        <div className="no-drag flex min-w-0 items-center gap-0.5 border-l border-sky-200/10 pl-1">
          {session.status === "idle" ? (
            <Button variant="ghost" size="md" className="h-7 gap-1 px-1.5 text-[11px] text-sky-200 hover:bg-sky-400/10 hover:text-sky-100" onClick={listen} title={t("Start listening ({shortcut})", { shortcut: shortcutLabel(KEYS.listen) })}>
              <Mic className="h-4 w-4" />
              {t("Listen")}
            </Button>
          ) : (
            <div className="flex items-center gap-0.5">
              {/* The timer doubles as the live-transcript toggle: closing that window must not strand the session. */}
              <Button
                variant={showing("transcript") ? "secondary" : "ghost"}
                size="md"
                className={cn("h-7 gap-1 px-1 text-[10px] tabular-nums", live ? "bg-sky-400/10 text-sky-200 hover:bg-sky-400/15" : "text-white/70")}
                onClick={() => api.invoke("panel:toggle", "transcript")}
                title={showing("transcript") ? t("Hide the live transcript") : t("Show the live transcript")}
              >
                <Dot className={cn("h-1.5 w-1.5", live && "animate-pulse bg-sky-300", paused && "bg-amber-400", connecting && "animate-pulse bg-sky-400")} />
                {elapsed}
              </Button>
              {live && (
                <Button variant="ghost" size="icon-sm" className="h-7 w-5" onClick={() => run(() => api.invoke("session:pause"))} title={t("Pause")}>
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              )}
              {paused && (
                <Button variant="ghost" size="icon-sm" className="h-7 w-5" onClick={() => run(() => api.invoke("session:resume"))} title={t("Resume")}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" className="h-7 w-5 text-emerald-300 hover:text-emerald-200" onClick={finish} title={t("Finish and save meeting")}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="h-7 w-5 text-white/50" onClick={() => run(() => api.invoke("session:cancel"))} title={t("Discard session")}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-white/[0.06] bg-white/[0.025] px-0.5">
          <Button variant={showing("answers") ? "secondary" : "ghost"} size="icon-sm" className={cn("h-7 w-[22px]", showing("answers") && "bg-sky-400/15 text-sky-200 hover:bg-sky-400/20")} onClick={() => api.invoke("panel:toggle", "answers")} title={t("Answers and chat ({shortcut})", { shortcut: shortcutLabel(KEYS.chat) })}>
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="h-7 w-[22px]" onClick={screenshot} title={t("Analyze screen ({shortcut})", { shortcut: shortcutLabel(KEYS.screenshot) })}>
            <Camera className="h-3.5 w-3.5" />
          </Button>
          {/* Settings for the next meeting open in the panel; its Settings tab links to the web dashboard for the rest. */}
          <Button variant={showing("settings") ? "secondary" : "ghost"} size="icon-sm" className={cn("h-7 w-[22px]", showing("settings") && "bg-sky-400/15 text-sky-200 hover:bg-sky-400/20")} onClick={() => api.invoke("panel:toggle", "settings")} title={t("Settings")}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          {signedOut && (
            <Button variant="ghost" size="icon-sm" className="relative h-7 w-[22px]" onClick={signIn} title={t("Sign up free or sign in: 50 AI answers a day")}>
              <UserRound className="h-3.5 w-3.5" />
              <span className={cn("absolute right-0.5 top-1.5 h-1 w-1 rounded-full bg-sky-400", cloud.status === "linking" && "animate-pulse")} />
            </Button>
          )}
        </div>
        <div className="no-drag flex shrink-0 items-center border-l border-white/10 pl-0.5">
          <Button variant="ghost" size="icon-sm" className="h-7 w-5 text-white/50" onClick={() => api.invoke("windows:toggle-all")} title={t("Hide all windows ({shortcut})", { shortcut: shortcutLabel(KEYS.toggleAll) })}>
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="h-7 w-5 text-white/45 hover:text-rose-300" onClick={() => api.invoke("app:quit")} title={t("Quit Converaid")}>
            <Power className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {(error || session.notice || updateNotice) && (
        <div className="mt-1 truncate rounded-md bg-black/80 px-3 py-1 text-xs text-amber-200">{error ?? session.notice ?? updateNotice}</div>
      )}
    </div>
  )
}
