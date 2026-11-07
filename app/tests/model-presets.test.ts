import { describe, expect, it } from "vitest"
import {
  CUSTOM_MODEL,
  isOpenRouterUrl,
  modelPresets,
  modelWithRouting,
  normalizeProviderModel,
  presetModel,
  providerChanged,
  selectedModelPreset
} from "../shared/model-presets"

const OPENROUTER = "https://openrouter.ai/api/v1"

describe("model presets and routing", () => {
  it("recognizes only the OpenRouter HTTPS API endpoint", () => {
    expect(isOpenRouterUrl(OPENROUTER)).toBe(true)
    expect(isOpenRouterUrl("https://OPENROUTER.ai:443/api/v1/")).toBe(true)
    for (const url of [
      "http://openrouter.ai/api/v1",
      "https://openrouter.ai.attacker.example/api/v1",
      "https://attacker.example/openrouter.ai/api/v1",
      "https://openrouter.ai:8443/api/v1",
      "https://user@openrouter.ai/api/v1",
      "https://openrouter.ai/other",
      `${OPENROUTER}?target=other`,
      "invalid"
    ]) expect(isOpenRouterUrl(url), url).toBe(false)
  })

  it("offers the verified Claude presets without an API model list", () => {
    expect(modelPresets(OPENROUTER).map((preset) => preset.model)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "anthropic/claude-haiku-5.5"
    ])
    expect(modelPresets("http://localhost:11434/v1")).toEqual([])
  })

  it("adds Nitro once and removes every duplicate trailing Nitro suffix", () => {
    expect(modelWithRouting("anthropic/claude-sonnet-5.5", "nitro")).toBe("anthropic/claude-sonnet-5.5:nitro")
    expect(modelWithRouting("custom/model:nitro:NITRO", "nitro")).toBe("custom/model:nitro")
    expect(modelWithRouting("custom/model:nitro:nitro", "standard")).toBe("custom/model")
    expect(modelWithRouting("custom/model:nitro-preview", "standard")).toBe("custom/model:nitro-preview")
    expect(modelWithRouting("", "nitro")).toBe("")
  })

  it("keeps Nitro when choosing another OpenRouter preset", () => {
    expect(presetModel(OPENROUTER, "anthropic/claude-sonnet-5.5:nitro", "anthropic/claude-haiku-5.5"))
      .toBe("anthropic/claude-haiku-5.5:nitro")
    expect(selectedModelPreset(OPENROUTER, "anthropic/claude-haiku-5.5:nitro:nitro"))
      .toBe("anthropic/claude-haiku-5.5")
  })

  it("keeps an editable custom model when Custom is chosen", () => {
    const custom = "organization/my-model:preview:nitro"
    expect(presetModel(OPENROUTER, custom, CUSTOM_MODEL)).toBe(custom)
    expect(selectedModelPreset(OPENROUTER, custom)).toBe(CUSTOM_MODEL)
    expect(normalizeProviderModel(OPENROUTER, "organization/my-model:preview")).toBe("organization/my-model:preview")
  })

  it("removes OpenRouter routing when changing providers", () => {
    expect(normalizeProviderModel("https://api.openai.com/v1", "custom/model:nitro:nitro"))
      .toBe("custom/model")
    expect(normalizeProviderModel(OPENROUTER, "custom/model:nitro:nitro"))
      .toBe("custom/model:nitro")
  })

  it("clears a typed key when the provider origin changes", () => {
    expect(providerChanged(OPENROUTER, "https://api.openai.com/v1")).toBe(true)
    expect(providerChanged(OPENROUTER, "http://openrouter.ai/api/v1")).toBe(true)
    expect(providerChanged(OPENROUTER, "https://openrouter.ai:8443/api/v1")).toBe(true)
    expect(providerChanged(OPENROUTER, "https://openrouter.ai/api/v1/")).toBe(false)
    expect(providerChanged(OPENROUTER, "https://openrouter.ai/other")).toBe(false)
    expect(providerChanged(OPENROUTER, "invalid")).toBe(true)
  })
})
