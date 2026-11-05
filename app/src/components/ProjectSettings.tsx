import { useEffect, useRef, useState } from "react"
import { ChevronDown, FolderOpen, RefreshCw } from "lucide-react"
import type { InterviewProject, ProjectKnowledgeState, ProjectPreparation } from "@shared/types"
import { t } from "@shared/i18n"
import { api } from "@/lib/api"
import { useEvent } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/Markdown"
import { Button } from "@/components/ui/button"
import { Textarea, Toggle } from "@/components/ui/fields"

const STATUS_LABELS: Record<ProjectPreparation["status"], string> = {
  unprepared: "Not prepared",
  preparing: "Preparing...",
  ready: "Ready",
  limited: "Limited knowledge",
  stale: "Project changed",
  error: "Preparation failed"
}

const STATUS_HINTS: Record<ProjectPreparation["status"], string> = {
  unprepared: "Prepare this project before the interview.",
  preparing: "Reading project knowledge...",
  ready: "",
  limited: "Project knowledge is incomplete. Check the project map and prepare again.",
  stale: "Project knowledge has changed. Prepare again before the interview.",
  error: "Preparation failed. Try Prepare again."
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
}

/** Prepare local project knowledge before a conversation, with personal notes kept per project. */
export function ProjectSettings({ projects }: { projects: InterviewProject[] }) {
  const [knowledge, setKnowledge] = useState<ProjectKnowledgeState | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutations = useRef<Promise<unknown>>(Promise.resolve())
  const failedRoles = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    void api.invoke("projects:state").then((state) => { if (active) setKnowledge(state) }).catch((err) => { if (active) setError(errorText(err)) })
    return () => { active = false }
  }, [])
  useEvent("projects:changed", setKnowledge)

  const mutate = (key: string, action: () => Promise<unknown>): Promise<boolean> => {
    setPending((current) => [...current, key])
    setError(null)
    const operation = mutations.current.then(action).then(() => {
      failedRoles.current.delete(key)
      return true
    }).catch((err) => {
      if (key.startsWith("role:")) failedRoles.current.add(key)
      setError(errorText(err))
      return false
    }).finally(() => setPending((current) => current.filter((item) => item !== key)))
    mutations.current = operation
    return operation
  }

  const prepare = async () => {
    setPreparing(true)
    setError(null)
    try {
      // A click on Prepare blurs the role field first; wait for that save before preparing.
      await mutations.current
      if (projects.some((project) => project.enabled && failedRoles.current.has(`role:${project.id}`))) {
        setError(t("A project role could not be saved. Open its details and retry saving before preparing."))
        return
      }
      setKnowledge(await api.invoke("projects:prepare"))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPreparing(false)
    }
  }

  const busy = pending.some((key) => !key.startsWith("role:"))
  const isPreparing = preparing || Boolean(knowledge?.preparing)
  const selected = projects.filter((project) => project.enabled)
  const ready = selected.filter((project) => knowledge?.projects.some((item) => item.id === project.id && item.status === "ready")).length
  const hasPrepared = knowledge?.projects.some((project) => project.preparedAt !== null)

  return (
    <section className="space-y-2.5 py-3" aria-label={t("Projects")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-[12px] font-medium text-white/90">{t("Projects")}</h2>
          <p role="status" className="text-[10.5px] text-white/50">
            {t("{selected} selected, {ready} ready", { selected: selected.length, ready })}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" disabled={busy || isPreparing} onClick={() => void mutate("add", () => api.invoke("projects:add"))}>
          <FolderOpen aria-hidden="true" className="h-3 w-3" /> {t("Add projects")}
        </Button>
        <Button variant="primary" size="sm" className="h-7 px-2 text-[11px]" disabled={busy || isPreparing || selected.length === 0} onClick={() => void prepare()}>
          <RefreshCw aria-hidden="true" className={cn("h-3 w-3", isPreparing && "animate-spin")} />
          {isPreparing ? t("Preparing...") : hasPrepared ? t("Prepare again") : t("Prepare")}
        </Button>
      </div>
      <p className="max-w-prose text-[10.5px] leading-relaxed text-white/50">
        {t("Select projects and prepare knowledge from their existing project maps before the interview. Selected excerpts and your role are sent to your configured AI when answering. Projects stay out of account sync.")}
      </p>
      {projects.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/15 px-3 py-3 text-[11.5px] leading-relaxed text-white/60">
          {t("Add project folders from this computer. You can select several projects for the same interview.")}
        </p>
      ) : (
        <div className="divide-y divide-white/10 rounded-md border border-white/10 bg-white/[0.02]">
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              preparation={knowledge?.projects.find((item) => item.id === project.id)}
              loading={knowledge === null && !error}
              disabled={busy || isPreparing}
              removingDisabled={busy}
              saving={pending.includes(`role:${project.id}`)}
              onEnabled={(enabled) => { void mutate(`enable:${project.id}`, () => api.invoke("projects:update", project.id, { enabled })) }}
              onRemove={() => { void mutate(`remove:${project.id}`, () => api.invoke("projects:remove", project.id)) }}
              onSave={(experience) => mutate(`role:${project.id}`, () => api.invoke("projects:update", project.id, { experience }))}
            />
          ))}
        </div>
      )}
      {error && <p role="alert" className="selectable break-words text-[11px] leading-relaxed text-rose-300">{error}</p>}
    </section>
  )
}

function ProjectRow({ project, preparation, loading, disabled, removingDisabled, saving, onEnabled, onRemove, onSave }: {
  project: InterviewProject
  preparation?: ProjectPreparation
  loading: boolean
  disabled: boolean
  removingDisabled: boolean
  saving: boolean
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
  onSave: (experience: string) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [experience, setExperience] = useState(project.experience)
  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => setExperience(project.experience), [project.experience])
  const status = preparation?.status ?? "unprepared"
  const verified = preparation?.notice.startsWith("Map freshness verified") && !/unverified|omitted|truncated|unavailable|changed/i.test(preparation.notice)
  const notice = status === "ready"
    ? verified ? "Prepared from your project map." : "Prepared with limitations. Open details before relying on this project."
    : status === "limited" ? "No project map found. Only available documentation is prepared." : STATUS_HINTS[status]
  const fieldId = `project-role-${project.id}`
  const detailsId = `project-details-${project.id}`
  const saveExperience = async () => {
    if (experience !== project.experience || saveFailed) setSaveFailed(!await onSave(experience))
  }

  return (
    <article data-project-id={project.id} aria-label={project.name} className="min-w-0 space-y-2 px-2.5 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5">
          <Toggle size="sm" checked={project.enabled} onChange={onEnabled} disabled={disabled || saving} label={t("Use {name}", { name: project.name })} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[12px] font-medium leading-snug text-white/90">{project.name}</h3>
          <p data-project-status={status} className={cn("mt-0.5 text-[10.5px]", loading ? "text-white/45" : status === "ready" ? "text-emerald-300" : status === "error" ? "text-rose-300" : status === "limited" || status === "stale" ? "text-amber-200" : "text-white/55")}>
            {loading ? t("Checking preparation...") : t(STATUS_LABELS[status])}
            {!project.enabled && <span className="text-white/40">{t(" (not selected)")}</span>}
          </p>
        </div>
      </div>
      {notice && !loading && <p className="selectable break-words text-[10.5px] leading-relaxed text-white/55">{t(notice)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10.5px]" aria-label={t("Details for {name}", { name: project.name })} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
          <ChevronDown aria-hidden="true" className={cn("h-3 w-3", expanded && "rotate-180")} /> {t("Details")}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10.5px] text-white/50" aria-label={t("Remove {name}", { name: project.name })} disabled={removingDisabled || saving} onClick={onRemove}>{t("Remove")}</Button>
      </div>
      {expanded && (
        <div id={detailsId} className="space-y-3 border-t border-white/10 pt-2">
          {preparation?.notice && (
            <div>
              <p className="mb-1 text-[11.5px] font-medium text-white/80">{t("Preparation details")}</p>
              <p className="selectable break-words text-[10.5px] leading-relaxed text-white/55">{preparation.notice}</p>
            </div>
          )}
          <div>
            <p className="text-[10.5px] text-white/45">{t("Folder")}</p>
            <p className="selectable mt-0.5 break-all text-[11px] leading-relaxed text-white/65">{project.folder}</p>
          </div>
          <div>
            <label htmlFor={fieldId} className="text-[11.5px] font-medium text-white/80">{t("Your role and experience")}</label>
            <p id={`${fieldId}-hint`} className="mb-1.5 mt-0.5 text-[10.5px] leading-relaxed text-white/45">
              {t("Add your contributions and experience. These facts are not inferred from code. Saved when you leave this field.")}
            </p>
            <Textarea
              id={fieldId}
              aria-label={t("Your role and experience for {name}", { name: project.name })}
              aria-describedby={`${fieldId}-hint`}
              className="min-h-[72px] px-2 py-1.5 text-[11.5px]"
              value={experience}
              disabled={disabled || saving}
              maxLength={6000}
              placeholder={t("For example: I built the API and have three years of TypeScript experience.")}
              onChange={(event) => setExperience(event.target.value)}
              onBlur={() => void saveExperience()}
            />
            {saving && <p role="status" className="mt-1 text-[10.5px] text-white/45">{t("Saving role...")}</p>}
            {saveFailed && !saving && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] text-rose-300">{t("Your role could not be saved.")}</span>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10.5px]" disabled={disabled} onClick={() => void saveExperience()}>{t("Retry saving role")}</Button>
              </div>
            )}
          </div>
          {preparation?.brief && (
            <div>
              <h4 className="mb-1 text-[11.5px] font-medium text-white/80">{t("Prepared architecture briefing")}</h4>
              <Markdown text={preparation.brief} className="break-words text-[11px] text-white/65" />
            </div>
          )}
        </div>
      )}
    </article>
  )
}
