import type { InterviewProjectPatch, Settings } from "../../shared/types"

/** Only an owned top-level renderer may invoke privileged main-process handlers. */
export function trustedFrame(owned: boolean, senderFrame: unknown, mainFrame: unknown): boolean {
  return owned && Boolean(senderFrame) && senderFrame === mainFrame
}

const EDITABLE = new Set([
  "outputLanguage", "audioLanguage", "audioSource", "transcriptionEngine", "audioDeviceId",
  "autoAnswer", "answerLength", "answerMode", "suggestions", "keepMeetingsLocal", "stealth", "autoLaunch", "prompts", "activePromptId", "shortcuts"
])

/** Account identity and credentials can only change through their dedicated main-process flows. */
export function rendererSettingsPatch(input: unknown): Partial<Settings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid settings update")
  const entries = Object.entries(input).filter(([key]) => EDITABLE.has(key))
  for (const [key, value] of entries) {
    if (["autoLaunch", "stealth", "suggestions", "keepMeetingsLocal"].includes(key) && typeof value !== "boolean") {
      throw new Error(`Invalid ${key}: expected a boolean`)
    }
  }
  return Object.fromEntries(entries) as Partial<Settings>
}

export function rendererProjectPatch(input: unknown): InterviewProjectPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid project update")
  const patch: InterviewProjectPatch = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === "name") {
      if (typeof value !== "string" || !value.trim() || value.trim().length > 120 || /[\x00-\x1f]/.test(value)) throw new Error("Project name must contain 1 to 120 characters")
      patch.name = value.trim()
    } else if (key === "experience") {
      if (typeof value !== "string" || value.length > 6000 || value.includes("\0")) throw new Error("Confirmed experience must contain at most 6000 characters")
      patch.experience = value.trim()
    } else if (key === "enabled") {
      if (typeof value !== "boolean") throw new Error("Invalid project selection: expected a boolean")
      patch.enabled = value
    }
  }
  return patch
}

export function projectId(input: unknown): string {
  if (typeof input !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input)) throw new Error("Invalid project id")
  return input
}
