export type ModelRouting = "standard" | "nitro"

export const CUSTOM_MODEL = "__custom__"

const OPENROUTER_MODELS = [
  { label: "Claude Sonnet 5.5", model: "anthropic/claude-sonnet-5.5" },
  { label: "Claude Haiku 5.5", model: "anthropic/claude-haiku-5.5" }
] as const

export function isOpenRouterUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    return url.origin === "https://openrouter.ai" && url.pathname.replace(/\/+$/, "") === "/api/v1"
      && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function modelPresets(baseUrl: string): readonly { label: string; model: string }[] {
  return isOpenRouterUrl(baseUrl) ? OPENROUTER_MODELS : []
}

export function modelRouting(model: string): ModelRouting {
  return /:nitro$/i.test(model) ? "nitro" : "standard"
}

export function modelWithRouting(model: string, routing: ModelRouting): string {
  const base = model.replace(/(?::nitro)+$/i, "")
  return base && routing === "nitro" ? `${base}:nitro` : base
}

export function normalizeProviderModel(baseUrl: string, model: string): string {
  return modelWithRouting(model, isOpenRouterUrl(baseUrl) ? modelRouting(model) : "standard")
}

export function selectedModelPreset(baseUrl: string, model: string): string {
  const base = modelWithRouting(model, "standard")
  return modelPresets(baseUrl).some((preset) => preset.model === base) ? base : CUSTOM_MODEL
}

export function presetModel(baseUrl: string, current: string, preset: string): string {
  if (preset === CUSTOM_MODEL) return current
  return modelWithRouting(preset, isOpenRouterUrl(baseUrl) ? modelRouting(current) : "standard")
}

/** A provider key must not follow an endpoint edit to another origin. */
export function providerChanged(previous: string, next: string): boolean {
  const origin = (value: string) => {
    try { return new URL(value.trim()).origin }
    catch { return null }
  }
  return origin(previous) !== origin(next)
}
