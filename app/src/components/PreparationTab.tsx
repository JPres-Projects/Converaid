import { useEffect, useState } from "react"
import { PREPARATION_LIMITS } from "@shared/types"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/fields"

/** The draft and active preparation last only until Converaid quits. */
export function PreparationTab() {
  const [mode, setMode] = useState<"general" | "job">("general")
  const [requirements, setRequirements] = useState("")
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.invoke("preparation:state").then((state) => {
      if (state.active) {
        setRequirements(state.active.requirements)
        setMode(state.active.requirements.trim() ? "job" : "general")
      }
    }).catch((err: unknown) => setError(String(err))).finally(() => setLoading(false))
  }, [])
  const start = async () => {
    setPending(true)
    setError(null)
    try {
      await api.invoke("preparation:start", { requirements: mode === "job" ? requirements : "" })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setPending(false) }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" data-testid="preparation-tab">
      <form className="mx-auto flex w-full max-w-3xl flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void start() }}>
        <div>
          <h1 className="text-lg font-semibold text-white">Preparation</h1>
          <p className="mt-1 text-sm leading-relaxed text-white/60">Use General or paste a job description.</p>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Preparation mode">
          <Button aria-pressed={mode === "general"} variant={mode === "general" ? "primary" : "secondary"} onClick={() => setMode("general")} disabled={pending || loading}>General</Button>
          <Button aria-pressed={mode === "job"} variant={mode === "job" ? "primary" : "secondary"} onClick={() => setMode("job")} disabled={pending || loading}>Job description</Button>
        </div>
        {mode === "general" ? (
          <p className="text-sm leading-relaxed text-white/60">Use your projects and saved background without a specific job focus.</p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="preparation-requirements" className="text-xs text-white/70">Job description</label>
            <Textarea id="preparation-requirements" value={requirements} onChange={(event) => setRequirements(event.target.value)} maxLength={PREPARATION_LIMITS.requirements} placeholder="Paste the complete job description, requirements or task details." className="min-h-[180px]" disabled={pending || loading} />
          </div>
        )}
        <p className="text-xs leading-relaxed text-white/50">Start returns to Listen without recording. Preparation stays active until you fully quit Converaid.</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <Button type="submit" disabled={pending || loading} className="w-full sm:w-auto sm:self-start">{pending ? "Starting…" : "Start"}</Button>
      </form>
    </div>
  )
}
