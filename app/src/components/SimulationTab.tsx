import { useEffect, useRef, useState } from "react"
import { Eraser, Mic, SendHorizontal, Square } from "lucide-react"
import type { SimulationRole, SimulationState } from "@shared/simulation"
import type { SessionStatus, SettingsView } from "@shared/types"
import { t } from "@shared/i18n"
import { api } from "@/lib/api"
import { startAudioCapture, type AudioCapture } from "@/lib/audio"
import { useEvent } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/Markdown"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/fields"

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
}

function duration(value: number | null): string {
  if (value === null) return "—"
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`
}

/** A separate practice conversation, using the same selected prompt and projects as live answers. */
export function SimulationTab({ settings, liveStatus }: { settings: SettingsView; liveStatus: SessionStatus }) {
  const [state, setState] = useState<SimulationState | null>(null)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const stick = useRef(true)
  const end = useRef<HTMLDivElement>(null)
  useEvent("simulation:changed", (next) => { revision.current++; setState(next) })

  useEffect(() => {
    let mounted = true
    const before = revision.current
    void api.invoke("simulation:state").then((next) => {
      if (mounted && before === revision.current) setState(next)
    }).catch((err) => { if (mounted) setError(errorMessage(err)) })
    return () => {
      mounted = false
      void api.invoke("simulation:listen", false).catch(() => {})
    }
  }, [])

  const listening = state?.listening ?? false
  const connected = state?.voiceConnected ?? false
  const lastTurn = state?.turns.at(-1)
  useEffect(() => {
    if (!listening || !connected) return
    let stopped = false
    let capture: AudioCapture | null = null
    const fail = (err: unknown) => {
      if (stopped) return
      stopped = true
      capture?.stop()
      setError(errorMessage(err))
      void api.invoke("simulation:listen", false).catch(() => {})
    }
    void startAudioCapture("microphone", settings.audioDeviceId, (frame) => {
      if (!stopped) void api.invoke("simulation:audio", frame).catch(fail)
    }).then((next) => {
      if (stopped) next.stop()
      else capture = next
    }).catch(fail)
    return () => { stopped = true; capture?.stop() }
  }, [listening, connected, settings.audioDeviceId])

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" })
  }, [state?.turns.length, lastTurn?.text, state?.interim])

  const action = async (run: () => Promise<unknown>) => {
    setError(null)
    setPending(true)
    try { await run() }
    catch (err) { setError(errorMessage(err)) }
    finally { setPending(false) }
  }
  const chooseRole = (role: SimulationRole) => {
    setError(null)
    void api.invoke("simulation:role", role).catch((err) => setError(errorMessage(err)))
  }
  const send = async () => {
    const text = draft.trim()
    if (!text || !state || state.busy || pending || listening) return
    setError(null)
    setPending(true)
    try {
      await api.invoke("simulation:send", text)
      setDraft("")
      stick.current = true
    } catch (err) { setError(errorMessage(err)) }
    finally { setPending(false) }
  }
  const role = state?.role ?? "interviewer"
  const disabled = !state || state.busy || pending

  return (
    <section aria-label={t("Interview simulation")} className="scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2">
      <div className="shrink-0 space-y-2 border-b border-white/10 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[12px] font-medium text-white/90">{t("Interview simulation")}</h2>
          <Button variant="ghost" size="icon-sm" disabled={disabled || listening} title={t("Reset simulation")} aria-label={t("Reset simulation")} onClick={() => void action(() => api.invoke("simulation:clear"))}>
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="max-w-prose text-[10.5px] leading-relaxed text-white/55">
          {t("Try answers with your selected system prompt and projects. You play both speakers. Interviewer questions request an answer; candidate turns add context.")}
        </p>
        <div role="group" aria-label={t("Input speaker")} className="flex flex-wrap items-center gap-1.5">
          {(["interviewer", "candidate"] as SimulationRole[]).map((speaker) => (
            <Button key={speaker} variant={role === speaker ? "primary" : "secondary"} size="sm" className="h-7 px-2 text-[11px]" aria-pressed={role === speaker} disabled={!state} onClick={() => chooseRole(speaker)}>
              {speaker === "interviewer" ? t("Interviewer") : t("Candidate (you)")}
            </Button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-white/45">
          {t('While recording, say "Now I am the interviewer" or "Now I am the candidate" to switch. German role commands work too. Recording stops after a spoken turn.')}
        </p>
      </div>

      <div className="scroll min-h-[120px] flex-1 space-y-3 py-3" aria-label={t("Simulation conversation")} aria-live="polite" onScroll={(event) => { const element = event.currentTarget; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
        {!state?.turns.length && <p className="rounded-md border border-dashed border-white/15 p-3 text-[11px] leading-relaxed text-white/55">{t("Enter an interviewer question or record a turn to try the assistant. Your live meeting stays separate.")}</p>}
        {state?.turns.map((turn) => (
          <article key={turn.id} data-simulation-role={turn.role} data-simulation-status={turn.status} className={cn("min-w-0 rounded-md border px-3 py-2", turn.role === "assistant" ? "border-sky-400/20 bg-sky-400/[0.04]" : "border-white/10 bg-white/[0.02]")}>
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/45">
              <span className="font-medium text-white/75">{turn.role === "assistant" ? t("Assistant suggestion") : turn.role === "interviewer" ? t("Interviewer") : t("Candidate (you)")}</span>
              {turn.role === "assistant" && <span>{t("First text: {time}", { time: duration(turn.firstTokenMs) })} · {t("Completed: {time}", { time: duration(turn.totalMs) })}</span>}
              {turn.status === "streaming" && <span role="status">{t("Answering...")}</span>}
            </div>
            {turn.status === "error" ? <p role="alert" className="selectable whitespace-pre-wrap break-words text-[11px] text-rose-300">{turn.text}</p> : <Markdown text={turn.text} className="break-words text-[11.5px] text-white/85" />}
          </article>
        ))}
        {state?.interim && <p className="selectable break-words text-[11px] italic text-white/45">{state.interim}</p>}
        <div ref={end} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-white/10 pt-2">
        {(error || state?.notice) && <p role={error ? "alert" : "status"} className={cn("selectable break-words text-[10.5px] leading-relaxed", error ? "text-rose-300" : "text-amber-200/85")}>{error || state?.notice}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void send() }} className="space-y-2">
          <Textarea aria-label={t("Simulation input")} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={20_000} disabled={disabled || listening} className="min-h-[65px] resize-y px-2 py-1.5 text-[11.5px]" placeholder={role === "interviewer" ? t("Type what the interviewer asks...") : t("Type your own answer to add context...")} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant={listening ? "danger" : "secondary"} size="sm" className="h-7 px-2 text-[11px]" aria-label={listening ? t("Stop recording simulation") : t("Record simulation turn")} disabled={!state || (!listening && (disabled || liveStatus !== "idle"))} onClick={() => void action(() => api.invoke("simulation:listen", !listening))}>
              {listening ? <Square className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
              {listening ? connected ? t("Cancel recording") : t("Cancel microphone") : t("Record a turn")}
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-7 px-2 text-[11px]" disabled={disabled || listening || !draft.trim()}>
              <SendHorizontal className="h-3 w-3" /> {role === "interviewer" ? t("Ask as interviewer") : t("Add candidate turn")}
            </Button>
          </div>
        </form>
        <p className="text-[9.5px] leading-relaxed text-white/40">{t("Timing starts when text is submitted or speech is recognized; voice transcription time is separate. Answers use your configured AI and its normal quota. Voice recognition runs on this computer.")}</p>
      </div>
    </section>
  )
}
