import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, expect, it, vi } from "vitest"
import { ChatService } from "../electron/services/chat"
import { SettingsStore } from "../electron/services/settings"
import { ProjectKnowledgeService } from "../electron/services/projectKnowledgeService"
import { prepareProjectKnowledge, queryProjectKnowledge } from "../electron/services/projectKnowledge"
import { ANSWER_FORMAT, ANSWER_MODES } from "../shared/types"

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(name: string, nodeCount = 3) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "converaid-interview-"))
  roots.push(folder)
  fs.mkdirSync(path.join(folder, "src"))
  const modules = ["frontend", "backend", "database"]
  for (const module of modules) fs.writeFileSync(path.join(folder, "src", `${module}.ts`), `export const ${module} = '${name}_${module}_CURRENT';`)
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", windowsHide: true, timeout: 15_000 }).trim()
  git("init", "--quiet")
  git("add", "src")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture")
  const graph = {
    project: { name, description: `${name} manages invoice approvals.`, gitCommitHash: git("rev-parse", "HEAD") },
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index}`, type: "function", name: `${name} ${modules[index % 3]} ${index}`,
      filePath: `src/${modules[index % 3]}.ts`, tags: [modules[index % 3]],
      summary: `${modules[index % 3]} handles ${index % 3 === 0 ? "the approval interface" : index % 3 === 1 ? "authentication sessions and approvals" : "persistent invoice storage"}.`
    })),
    edges: [{ source: "node-0", target: "node-1", type: "calls" }, { source: "node-1", target: "node-2", type: "depends_on" }],
    layers: [{ id: "application", name: "Application", description: "The interface calls the API, which persists approved invoices.", nodeIds: ["node-0", "node-1", "node-2"] }]
  }
  fs.mkdirSync(path.join(folder, ".ua"))
  fs.writeFileSync(path.join(folder, ".ua", "knowledge-graph.json"), JSON.stringify(graph))
  return { id: name, name, folder, experience: `I reviewed ${name}'s backend.`, enabled: true }
}

it("carries actual prepared multi-project evidence through every answer path and retrieves fresh source for follow-ups", async () => {
  const atlas = fixture("Atlas")
  const beacon = fixture("Beacon")
  const settings = new SettingsStore(path.join(atlas.folder, "settings.json"))
  settings.update({ projects: [atlas, beacon], answerMode: "interview", autoAnswer: "questions" })
  const knowledge = new ProjectKnowledgeService({ settings })
  await knowledge.prepare()
  expect(knowledge.getState().projects.map((project) => project.status)).toEqual(["ready", "ready"])
  const opendir = vi.spyOn(fsp, "opendir")
  const readFile = vi.spyOn(fsp, "readFile")
  const systems: string[] = []
  const capture = (system: string) => { systems.push(system); return { text: "Atlas checks authentication in its backend.", tokens: 1 } }
  const chat = new ChatService({
    settings,
    llm: {
      languageInstruction: () => "Respond in English.",
      chat: async (messages: { content: string }[], chunk?: (text: string) => void) => {
        const answer = capture(messages[0].content)
        chunk?.(answer.text)
        return answer
      },
      vision: async (_image: string, _query: string, system: string) => capture(system)
    } as never,
    session: { transcriptText: () => "Atlas backend authentication", getLastUtterance: () => ({ text: "Explain Atlas authentication." }) } as never,
    capture: async () => ({ base64: "fixture", width: 10, height: 10 }) as never,
    projectContext: (query) => knowledge.context(query)
  })
  await chat.send("Explain Atlas authentication.")
  await chat.answerLast()
  await chat.autoAnswer({ text: "Explain the Atlas backend architecture.", channel: "them", speaker: null, timestamp: 0 })
  settings.update({ autoAnswer: "always" })
  await chat.autoAnswer({ text: "Describe how the Atlas backend checks authentication.", channel: "them", speaker: null, timestamp: 0 })
  await chat.screenshot("Explain the Atlas authentication code on screen.")
  expect(systems).toHaveLength(5)
  for (const system of systems) {
    expect(system).toContain(ANSWER_FORMAT)
    expect(system).toContain(ANSWER_MODES.interview.instruction)
    expect(system).toContain('PROJECT "Atlas"')
    expect(system).toContain('PROJECT "Beacon"')
    expect(system).toContain(atlas.experience)
    expect(system).toContain(beacon.experience)
    expect(system).toContain("Atlas_backend_CURRENT")
    expect(system).toContain("src/backend.ts")
  }
  fs.writeFileSync(path.join(atlas.folder, "src/backend.ts"), "export const authentication = 'Atlas_AUTHENTICATION_UPDATED';")
  await chat.send("And how does it check sessions?")
  expect(systems.at(-1)).toContain("Atlas_AUTHENTICATION_UPDATED")
  expect(systems.at(-1)).not.toContain("Atlas_backend_CURRENT")
  expect(opendir).not.toHaveBeenCalled()
  expect(readFile.mock.calls.filter(([file]) => String(file).endsWith("knowledge-graph.json"))).toHaveLength(0)
}, 60_000)

it("measures bounded preparation and repeated in-memory search without file access", async () => {
  const project = fixture("Atlas", 3000)
  const start = performance.now()
  const prepared = await prepareProjectKnowledge(project.folder)
  const preparationMs = performance.now() - start
  const open = vi.spyOn(fsp, "open")
  const opendir = vi.spyOn(fsp, "opendir")
  const samples: number[] = []
  for (let index = 0; index < 30; index++) {
    const before = performance.now()
    const result = queryProjectKnowledge(prepared, "How does Atlas backend authentication use database storage?")
    samples.push(performance.now() - before)
    expect(result.files).toContain("src/backend.ts")
    expect(result.text.length).toBeLessThanOrEqual(12_000)
  }
  expect(open).not.toHaveBeenCalled()
  expect(opendir).not.toHaveBeenCalled()
  samples.sort((a, b) => a - b)
  console.info("Prepared project benchmark", JSON.stringify({ nodes: prepared.nodeCount, queries: samples.length, preparationMs: Math.round(preparationMs), searchMedianMs: Number(samples[15].toFixed(2)), searchP95Ms: Number(samples[28].toFixed(2)) }))
}, 60_000)
