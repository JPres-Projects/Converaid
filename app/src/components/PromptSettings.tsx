import { useEffect, useRef, useState } from "react"
import { Plus, Save } from "lucide-react"
import { DEFAULT_PROMPT, PROMPT_LIMITS, type Prompt, type SettingsView } from "@shared/types"
import { t } from "@shared/i18n"
import { Button } from "@/components/ui/button"
import { Input, Select, Textarea } from "@/components/ui/fields"

interface PromptEditor {
  draft: Prompt
  saved: Prompt
  index: number
}

function sameText(left: Prompt, right: Prompt): boolean {
  return left.title === right.title && left.content === right.content && (left.notes ?? "") === (right.notes ?? "")
}

function editorFor(prompt: Prompt, prompts: Prompt[]): PromptEditor {
  return { draft: prompt, saved: prompt, index: prompts.findIndex((item) => item.id === prompt.id) }
}

/** Account sync replaces local prompt ids; match the last saved text without replacing a draft. */
function savedPrompt(editor: PromptEditor, prompts: Prompt[]): Prompt | undefined {
  return prompts.find((prompt) => prompt.id === editor.saved.id)
    ?? (prompts[editor.index] && sameText(prompts[editor.index], editor.saved) ? prompts[editor.index] : undefined)
    ?? prompts.find((prompt) => sameText(prompt, editor.saved))
}

type PromptAction = { kind: "save" | "add" | "remove" } | { kind: "select"; id: string }

export function PromptSettings({ settings, update }: {
  settings: SettingsView
  update: (patch: Partial<SettingsView>) => Promise<unknown>
}) {
  const [editor, setEditor] = useState(() => editorFor(settings.prompts.find((prompt) => prompt.id === settings.activePromptId) ?? settings.prompts[0] ?? DEFAULT_PROMPT, settings.prompts))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const currentSettings = useRef(settings)
  const writing = useRef(false)
  currentSettings.current = settings

  useEffect(() => {
    setEditor((current) => {
      const saved = savedPrompt(current, settings.prompts)
      if (!sameText(current.draft, current.saved)) {
        // Keep unsaved text even if sync changed the active prompt or removed its original.
        return saved ? { draft: { ...current.draft, id: saved.id }, saved, index: settings.prompts.indexOf(saved) } : current
      }
      return editorFor(settings.prompts.find((prompt) => prompt.id === settings.activePromptId) ?? settings.prompts[0] ?? DEFAULT_PROMPT, settings.prompts)
    })
  }, [settings.prompts, settings.activePromptId])

  const dirty = !sameText(editor.draft, editor.saved)
  const selected = savedPrompt(editor, settings.prompts)
  const edit = (patch: Partial<Prompt>) => {
    setEditor((current) => ({ ...current, draft: { ...current.draft, ...patch } }))
    setNotice(null)
    setError(null)
  }

  const write = async (action: PromptAction) => {
    if (writing.current) return
    writing.current = true
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const current = currentSettings.current
      let prompts = [...current.prompts]
      const saved = savedPrompt(editor, prompts)
      let activeId = saved?.id ?? editor.draft.id

      if (action.kind === "remove") {
        if (prompts.length <= 1) throw new Error(t("Keep at least one system prompt."))
        if (!saved) throw new Error(t("This prompt changed during account sync. Save your draft before removing it."))
        const index = prompts.indexOf(saved)
        prompts = prompts.filter((prompt) => prompt.id !== saved.id)
        activeId = prompts[Math.min(index, prompts.length - 1)].id
      } else {
        if (dirty || action.kind === "save") {
          if (!editor.draft.title.trim()) throw new Error(t("Enter a prompt title before saving."))
          if (!editor.draft.content.trim()) throw new Error(t("Enter system instructions before saving."))
          const draft = { ...editor.draft, id: saved?.id ?? crypto.randomUUID(), title: editor.draft.title.trim() }
          prompts = saved ? prompts.map((prompt) => prompt.id === saved.id ? draft : prompt) : [...prompts, draft]
          activeId = draft.id
        }
        if (action.kind === "select") {
          if (!prompts.some((prompt) => prompt.id === action.id)) throw new Error(t("This prompt is no longer available. Select another prompt."))
          activeId = action.id
        } else if (action.kind === "add") {
          let title = "New prompt"
          for (let suffix = 2; prompts.some((prompt) => prompt.title === title); suffix++) title = `New prompt ${suffix}`
          const prompt = { ...DEFAULT_PROMPT, id: crypto.randomUUID(), title, notes: "" }
          prompts.push(prompt)
          activeId = prompt.id
        }
      }
      if (prompts.length > PROMPT_LIMITS.count) throw new Error(t("You can save up to {count} system prompts.", { count: PROMPT_LIMITS.count }))
      // Save the edited prompt and selection together, so the next answer sees one consistent choice.
      await update({ prompts, activePromptId: activeId })
      setEditor(editorFor(prompts.find((prompt) => prompt.id === activeId)!, prompts))
      setNotice(t(action.kind === "add" ? "Prompt added." : action.kind === "remove" ? "Prompt removed." : action.kind === "select" ? "Prompt selected. Your changes are saved." : "Prompt saved."))
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""))
    } finally {
      writing.current = false
      setSaving(false)
    }
  }

  return (
    <section className="min-w-0 space-y-2.5 py-3" aria-label={t("System prompts")}>
      <div>
        <h2 className="text-[12px] font-medium text-white/90">{t("System prompts")}</h2>
        <p className="mt-0.5 max-w-prose text-[10.5px] leading-relaxed text-white/50">
          {t("Choose the instructions and background used for the next answer. Shared answer formatting stays applied. Meeting, Interview and Coding focus are selected separately.")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t("System prompt")} className="h-8 min-w-0 flex-1 basis-40 px-2 text-[11.5px]" value={selected?.id ?? editor.draft.id} disabled={saving} onChange={(id) => { if (id !== selected?.id) void write({ kind: "select", id }) }}>
          {settings.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.title}</option>)}
          {!selected && <option value={editor.draft.id}>{t("Unsaved prompt draft")}</option>}
        </Select>
        <Button variant="secondary" size="sm" className="h-8 px-2 text-[11px]" disabled={saving || settings.prompts.length >= PROMPT_LIMITS.count} onClick={() => void write({ kind: "add" })}>
          <Plus aria-hidden="true" className="h-3 w-3" /> {t("Add prompt")}
        </Button>
      </div>
      <div>
        <label htmlFor="prompt-title" className="mb-1 block text-[11.5px] font-medium text-white/80">{t("Prompt title")}</label>
        <Input id="prompt-title" aria-label={t("Prompt title")} className="h-8 px-2 text-[11.5px]" value={editor.draft.title} disabled={saving} maxLength={PROMPT_LIMITS.title} onChange={(event) => edit({ title: event.target.value })} />
      </div>
      <div>
        <label htmlFor="prompt-instructions" className="mb-1 block text-[11.5px] font-medium text-white/80">{t("System instructions")}</label>
        <Textarea id="prompt-instructions" aria-label={t("System instructions")} className="min-h-[112px] px-2 py-1.5 text-[11.5px]" value={editor.draft.content} disabled={saving} maxLength={PROMPT_LIMITS.content} onChange={(event) => edit({ content: event.target.value })} />
      </div>
      <div>
        <label htmlFor="prompt-notes" className="mb-1 block text-[11.5px] font-medium text-white/80">{t("Background notes")}</label>
        <Textarea id="prompt-notes" aria-label={t("Background notes")} aria-describedby="prompt-notes-hint" className="min-h-[72px] px-2 py-1.5 text-[11.5px]" value={editor.draft.notes ?? ""} disabled={saving} maxLength={PROMPT_LIMITS.notes} placeholder={t("Optional: CV, job description or facts the assistant should know.")} onChange={(event) => edit({ notes: event.target.value })} />
        <p id="prompt-notes-hint" className="mt-1 text-[10.5px] leading-relaxed text-white/45">{t("Changes are saved when you select or add another prompt. Use Save prompt to apply edits now.")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" className="h-7 px-2 text-[11px]" disabled={saving || !dirty} onClick={() => void write({ kind: "save" })}>
          <Save aria-hidden="true" className="h-3 w-3" /> {saving ? t("Saving...") : t("Save prompt")}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-white/50" disabled={saving || settings.prompts.length <= 1} onClick={() => void write({ kind: "remove" })}>{t("Remove prompt")}</Button>
        {dirty && <span className="text-[10.5px] text-amber-200">{t("Unsaved changes")}</span>}
      </div>
      {notice && <p role="status" className="text-[10.5px] text-white/55">{notice}</p>}
      {error && <p role="alert" className="selectable break-words text-[11px] leading-relaxed text-rose-300">{error}</p>}
    </section>
  )
}
