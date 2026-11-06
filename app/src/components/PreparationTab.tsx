import { useEffect, useState } from "react"
import { PREPARATION_LIMITS, type Preparation } from "@shared/types"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input, Select, Textarea } from "@/components/ui/fields"

const EMPTY: Preparation = { organization: "", title: "", requirements: "", focus: "" }
const STARTERS: Record<string, { label: string; draft: Preparation }> = {
  general: { label: "General", draft: EMPTY },
  architecture: { label: "Architecture / product", draft: { ...EMPTY, focus: "Architecture, product decisions, data flow, implementation choices and testing." } },
  coding: { label: "Coding / refactoring", draft: { ...EMPTY, focus: "Solve the current coding task. Explain the approach, tradeoffs and test cases concisely." } },
  outlier: { label: "Outlier language focus", draft: { ...EMPTY, organization: "Outlier", focus: "Focus on the coding languages entered for this task. Explain or improve the code in the actual question." } },
  mercor: { label: "Mercor Infrastructure / SRE", draft: { ...EMPTY, organization: "Mercor", title: "Infrastructure / SRE", focus: "Production reliability; Kubernetes; AWS; Datadog, Prometheus and Grafana; Terraform and Pulumi; Linux, networking and containers; CI/CD; incident response and root cause; SLOs and SLIs; automation with Python, Go and Bash." } }
}

/** Drafts and the active snapshot are session-only; saved prompts and projects stay separate. */
export function PreparationTab() {
  const [draft, setDraft] = useState<Preparation>({ ...EMPTY })
  const [starter, setStarter] = useState("general")
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.invoke("preparation:state").then((state) => {
      if (state.active) { setDraft({ ...state.active }); setActive(true) }
    }).catch((err: unknown) => setError(String(err))).finally(() => setLoading(false))
  }, [])
  const field = (key: keyof Preparation, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const start = async () => {
    setPending(true)
    setError(null)
    try {
      await api.invoke("preparation:start", draft)
      setActive(true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setPending(false) }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" data-testid="preparation-tab">
      <form className="mx-auto flex w-full max-w-3xl flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void start() }}>
        <div>
          <h1 className="text-lg font-semibold text-white">Preparation</h1>
          <p className="mt-1 text-sm leading-relaxed text-white/60">Paste a job description or add the languages for this task. Every field is optional.</p>
        </div>
        <div className="space-y-1.5">
          <div id="preparation-starter-label" className="text-xs text-white/70">Starter</div>
          <Select aria-labelledby="preparation-starter-label" value={starter} onChange={(value) => { setStarter(value); setDraft({ ...STARTERS[value].draft }) }} disabled={pending || loading}>
            {Object.entries(STARTERS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="preparation-organization" className="text-xs text-white/70">Platform / company</label>
            <Input id="preparation-organization" value={draft.organization} onChange={(e) => field("organization", e.target.value)} maxLength={PREPARATION_LIMITS.organization} placeholder="Optional" disabled={pending || loading} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="preparation-title" className="text-xs text-white/70">Role / title</label>
            <Input id="preparation-title" value={draft.title} onChange={(e) => field("title", e.target.value)} maxLength={PREPARATION_LIMITS.title} placeholder="Optional" disabled={pending || loading} />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="preparation-requirements" className="text-xs text-white/70">Job description / requirements</label>
          <Textarea id="preparation-requirements" value={draft.requirements} onChange={(e) => field("requirements", e.target.value)} maxLength={PREPARATION_LIMITS.requirements} placeholder="Paste the requirements for this conversation or task" className="min-h-[140px]" disabled={pending || loading} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="preparation-focus" className="text-xs text-white/70">Coding languages / focus</label>
          <Textarea id="preparation-focus" value={draft.focus} onChange={(e) => field("focus", e.target.value)} maxLength={PREPARATION_LIMITS.focus} placeholder="For example: Python, Go, incident response" disabled={pending || loading} />
        </div>
        <p className="text-xs leading-relaxed text-white/50">{active ? "A preparation is active for this session. Start applies your edits. " : ""}Start returns to Listen without recording. Preparation stays active until you fully quit Converaid. Requirements guide answers; they do not establish personal experience.</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <Button type="submit" disabled={pending || loading} className="w-full sm:w-auto sm:self-start">{pending ? "Starting…" : "Start"}</Button>
      </form>
    </div>
  )
}
