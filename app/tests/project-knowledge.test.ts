import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import childProcess, { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareProjectKnowledge, queryProjectKnowledge, isProjectKnowledgeCurrent, type PreparedProjectKnowledge } from "../electron/services/projectKnowledge"
import { readProjectFiles } from "../electron/services/projectContext"

const roots: string[] = []
function project(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "meetingly-knowledge-"))
  roots.push(root)
  return root
}
function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 5000 }).trim()
}
function commit(root: string): string {
  git(root, "init", "--quiet")
  git(root, "add", ".")
  git(root, "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "commit", "--quiet", "-m", "Fixture")
  return git(root, "rev-parse", "HEAD")
}
function graph(root: string, options: { legacy?: boolean; hash?: string; extras?: object[] } = {}): void {
  write(root, options.legacy ? ".understand-anything/knowledge-graph.json" : ".ua/knowledge-graph.json", JSON.stringify({
    project: { name: "Invoice Portal", description: "Tracks supplier invoices and approval status.", languages: ["TypeScript"], frameworks: ["React"], gitCommitHash: options.hash },
    nodes: [
      { id: "ui", type: "file", name: "InvoiceScreen", filePath: "frontend/InvoiceScreen.tsx", summary: "Frontend interface sends approval actions to the backend API and displays database records.", tags: ["frontend", "interface"] },
      { id: "api", type: "file", name: "Authentication API", filePath: "server/auth.ts", summary: "Authentication validates sessions before database access.", tags: ["backend", "authentication"] },
      { id: "db", type: "file", name: "Invoice database", filePath: "server/database.ts", summary: "Database stores approved invoice records.", tags: ["database"] },
      ...(options.extras ?? [])
    ],
    edges: [{ source: "ui", target: "api", type: "calls" }, { source: "api", target: "db", type: "depends_on" }],
    layers: [{ id: "frontend", name: "Frontend", description: "Reviewer interface", nodeIds: ["ui"] }, { id: "backend", name: "Backend", description: "Session checks and persistence", nodeIds: ["api", "db"] }],
    tour: [{ order: 1, title: "Approval journey", description: "Follow an approval from the screen to storage.", nodeIds: ["ui", "api", "db"] }]
  }))
}
function sourceFixture(root: string): void {
  write(root, "frontend/InvoiceScreen.tsx", "export const InvoiceScreen = 'APPROVAL_UI'")
  write(root, "server/auth.ts", "export function authenticate() { return 'LIVE_SESSION_VALIDATION' }")
  write(root, "server/database.ts", "export const database = 'APPROVED_INVOICES'")
}
function searchFixture(name: string, summaries: string[]): PreparedProjectKnowledge {
  const nodes = summaries.map((summary, index) => ({ id: `node-${index}`, type: "file", name: `Module ${index}`,
    file: `src/module-${index}.ts`, summary, tags: [], changed: false, search: summary.toLowerCase() }))
  return { folder: "", name, brief: "", notice: "", source: "map", nodeCount: nodes.length, preparedAt: 0,
    graphPath: null, graphStamp: null, nodes, byId: new Map(nodes.map((node) => [node.id, node])),
    neighbors: new Map(), sections: [], fallback: summaries.join(" "), fallbackFiles: ["README.md"], interview: "", interviewStamp: "" }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("prepared local project knowledge", () => {
  it("prioritizes the currently named project over rich history from three other projects", () => {
    const previous = "authentication sessions backend login tokens database caching encryption security"
    const projects = ["Atlas", "Gateway", "Legacy"].map((name) => searchFixture(name, [previous]))
    projects.push(searchFixture("Beacon", ["Persistent storage."]))
    const question = `Now explain Beacon storage.\n\nRecent conversation:\nuser: Explain Atlas ${previous}.`
    const ranked = projects.map((project) => ({ name: project.name, score: queryProjectKnowledge(project, question).score }))
      .sort((a, b) => b.score - a.score)
    expect(ranked[0].name).toBe("Beacon")
    const mappedScore = queryProjectKnowledge(projects[0], question).score
    expect(queryProjectKnowledge({ ...projects[3], source: "files" }, question).score).toBeGreaterThan(mappedScore)
  })

  it("ranks current details before earlier topics while retaining history for generic follow-ups", () => {
    const previous = "authentication sessions backend login tokens database caching encryption security"
    const prepared = searchFixture("Atlas", [previous, "Persistent storage."])
    const history = `\n\nRecent meeting context:\nAtlas ${previous}.`
    expect(queryProjectKnowledge(prepared, `How does storage work?${history}`).files[0]).toBe("src/module-1.ts")
    const followup = queryProjectKnowledge(prepared, `Tell me more.${history}`)
    expect(followup.files[0]).toBe("src/module-0.ts")
    expect(followup.score).toBeGreaterThan(0)
  })

  it("does not mistake short generic names or a name inside another word for a project mention", () => {
    for (const name of ["A", "The", "Atlas"]) {
      expect(queryProjectKnowledge(searchFixture(name, ["Unrelated module."]), "Explain the Atlasify deployment.").score).toBe(0)
    }
  })

  it("recognizes the displayed project alias and graph name without changing map provenance", () => {
    const prepared = searchFixture("Internal Atlas", ["Unrelated module."])
    const named = queryProjectKnowledge(prepared, "Explain Internal Atlas.", "Beacon")
    const alias = queryProjectKnowledge(prepared, "Explain Beacon.", "Beacon")
    expect(alias.score).toBe(named.score)
    expect(alias.score).toBeGreaterThan(0)
    expect(alias.files).toEqual(["src/module-0.ts"])
    expect(alias.text).toContain("Project: Internal Atlas")
    expect(prepared.name).toBe("Internal Atlas")
    expect(queryProjectKnowledge(prepared, "Explain Beaconry.", "Beacon").score).toBe(0)
    expect(queryProjectKnowledge(prepared, "Tell me more.\n\nRecent conversation:\nuser: Explain Beacon.", "Beacon").score).toBeGreaterThan(0)
  })

  it.each([false, true])("prepares modern or legacy maps with purpose, layers, tour and relationships (legacy=%s)", async (legacy) => {
    const root = project()
    sourceFixture(root)
    graph(root, { legacy, hash: commit(root) })
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.source).toBe("map")
    expect(prepared.name).toBe("Invoice Portal")
    expect(prepared.nodeCount).toBe(3)
    expect(prepared.brief).toContain("Tracks supplier invoices")
    expect(prepared.brief).toContain("Frontend")
    expect(prepared.brief).toContain("Backend")
    expect(prepared.brief.split("\n").find((line) => line.startsWith("Backend:"))).toMatch(/^Backend: Authentication API;/)
    expect(prepared.brief).not.toContain("\nInvoiceScreen (frontend/InvoiceScreen.tsx)")
    expect(prepared.brief.split("\n").find((line) => line.startsWith("Data storage:"))).toMatch(/^Data storage: Invoice database;/)
    expect(prepared.brief).toContain("Approval journey")
    expect(prepared.brief).toContain("calls")
    expect(prepared.brief).toContain("depends_on")
    expect(queryProjectKnowledge(prepared, "authentication").text).toContain("untrusted")
    expect(prepared.brief.slice(0, 160)).toContain("Tracks supplier invoices")
    for (const heading of ["Frontend:", "Backend:", "Data storage:", "Map relationships:"]) expect(prepared.brief.slice(0, 1600)).toContain(heading)
    expect(prepared.notice).toContain("verified")
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(true)
  })

  it("keeps map language and framework labels separate before lengthy interview notes", async () => {
    const root = project()
    sourceFixture(root)
    graph(root)
    const graphPath = path.join(root, ".ua/knowledge-graph.json")
    const data = JSON.parse(fs.readFileSync(graphPath, "utf8"))
    data.project.frameworks = ["React", "Node.js"]
    fs.writeFileSync(graphPath, JSON.stringify(data))
    write(root, "INTERVIEW.md", "Prepared contribution notes. ".repeat(100))
    const prepared = await prepareProjectKnowledge(root)
    const compact = prepared.brief.slice(0, 600)
    expect(compact).toContain("Programming languages listed by the map: TypeScript\n")
    expect(compact).toContain("Frameworks and runtimes listed by the map: React, Node.js\n")
    expect(compact).toMatch(/map.*(?:labels|categories).*untrusted/i)
    expect(compact).toMatch(/do not establish.*personal use.*strongest skill/i)
    expect(prepared.brief.indexOf("Frameworks and runtimes listed by the map")).toBeLessThan(prepared.brief.indexOf("Prepared contribution notes"))
    expect(prepared.brief).not.toContain("Technologies listed by the map:")
    expect(prepared.brief.length).toBeLessThanOrEqual(16_000)
  })

  it("finds detailed English and German questions locally without rescanning directories or reading files", async () => {
    const root = project()
    sourceFixture(root)
    graph(root, { hash: commit(root) })
    const prepared = await prepareProjectKnowledge(root)
    const opendir = vi.spyOn(fsp, "opendir")
    const readdir = vi.spyOn(fsp, "readdir")
    const open = vi.spyOn(fsp, "open")
    for (const question of ["How does authentication access the database?", "Wie funktioniert die Anmeldung mit der Datenbank?"]) {
      const result = queryProjectKnowledge(prepared, question)
      expect(result.score).toBeGreaterThan(0)
      expect(result.text).toContain("Authentication")
      expect(result.text).toContain("depends_on")
      expect(result.files).toContain("server/auth.ts")
    }
    expect(queryProjectKnowledge(prepared, "Oberfläche").files[0]).toBe("frontend/InvoiceScreen.tsx")
    expect(queryProjectKnowledge(prepared, "Invoice Portal").score).toBeGreaterThan(0)
    expect(opendir).not.toHaveBeenCalled()
    expect(readdir).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it("withholds changed summaries and reads only explicitly referenced deep source files", async () => {
    const root = project()
    sourceFixture(root)
    const deep = "one/two/three/four/five/six/seven/handler.ts"
    write(root, deep, "export const reconciliation = 'DEEP_LIVE_IMPLEMENTATION'")
    graph(root, { hash: commit(root), extras: [{ id: "deep", type: "file", name: "Reconciliation", filePath: deep, summary: "Handles ledger reconciliation." }] })
    write(root, "server/auth.ts", "export function authenticate() { return 'CHANGED_LIVE_AUTH' }")
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.notice).toContain("changed")
    expect(queryProjectKnowledge(prepared, "authentication").text).not.toContain("Authentication validates sessions")
    expect(queryProjectKnowledge(prepared, "authentication").text).toContain("changed")
    const opendir = vi.spyOn(fsp, "opendir")
    const detail = await readProjectFiles(root, queryProjectKnowledge(prepared, "reconciliation").files, "reconciliation")
    expect(detail).toContain("DEEP_LIVE_IMPLEMENTATION")
    expect(await readProjectFiles(root, ["server/auth.ts"], "authenticate")).toContain("CHANGED_LIVE_AUTH")
    expect(opendir).not.toHaveBeenCalled()
  })

  it("prepares a limited documentation snapshot once when no map exists", async () => {
    const root = project()
    write(root, "README.md", "A calendar planner built with React.")
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.source).toBe("files")
    expect(prepared.notice).toMatch(/limited|no .*map/i)
    expect(prepared.brief).toContain("calendar planner")
    write(root, "README.md", "AFTER_PREPARATION")
    const open = vi.spyOn(fsp, "open")
    expect(queryProjectKnowledge(prepared, "calendar").text).toContain("calendar planner")
    expect(open).not.toHaveBeenCalled()
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(true)
    graph(root)
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(false)
  })

  it("invalidates a prepared map when its graph file changes", async () => {
    const root = project()
    graph(root)
    const prepared = await prepareProjectKnowledge(root)
    fs.appendFileSync(path.join(root, ".ua/knowledge-graph.json"), " ")
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(false)
  })

  it.each([false, true])("prepares interview notes before a call and searches their cached claims (map=%s)", async (mapped) => {
    const root = project()
    write(root, "README.md", "General project documentation. ".repeat(150))
    write(root, "INTERVIEW.md", "# Personal contribution\nDesigned the approval adapter; model inference is delegated to a provider API.\n# Testing\nVerified duplicate approval retries with integration tests. Commit: abc1234.\n")
    write(root, "docs/INTERVIEW.md", "Architecture: TypeScript frontend, service layer and SQL persistence.")
    if (mapped) { sourceFixture(root); graph(root) }
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.brief.slice(0, 1800)).toContain("Designed the approval adapter")
    expect(prepared.brief).toContain("TypeScript frontend")
    write(root, "INTERVIEW.md", "UNPREPARED_REPLACEMENT")
    const open = vi.spyOn(fsp, "open")
    const opendir = vi.spyOn(fsp, "opendir")
    const result = queryProjectKnowledge(prepared, "Which testing contribution is personal and which work is delegated?")
    expect(result.score).toBeGreaterThan(0)
    expect(result.text).toContain("integration tests")
    expect(result.text).toContain("abc1234")
    expect(result.text).toContain("provider API")
    expect(result.text).toContain('Source: "INTERVIEW.md"')
    expect(result.text).toContain("untrusted reference data")
    expect(result.text).toMatch(/not.*(?:prove|verify|verified).*authorship/i)
    expect(result.text).not.toContain("UNPREPARED_REPLACEMENT")
    expect(result.files).not.toContain("INTERVIEW.md")
    expect(result.files).not.toContain("docs/INTERVIEW.md")
    expect(open).not.toHaveBeenCalled()
    expect(opendir).not.toHaveBeenCalled()
  })

  it.each([false, true])("invalidates interview notes when added, changed or removed (map=%s)", async (mapped) => {
    const root = project()
    if (mapped) graph(root)
    const absent = await prepareProjectKnowledge(root)
    write(root, "docs/INTERVIEW.md", "Testing: verified retries.")
    expect(await isProjectKnowledgeCurrent(absent)).toBe(false)
    const prepared = await prepareProjectKnowledge(root)
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(true)
    write(root, "docs/INTERVIEW.md", "Testing: verified retries and duplicate events.")
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(false)
    const updated = await prepareProjectKnowledge(root)
    fs.unlinkSync(path.join(root, "docs/INTERVIEW.md"))
    expect(await isProjectKnowledgeCurrent(updated)).toBe(false)
  })

  it("excludes ignored, linked and secret-bearing interview notes", async () => {
    const root = project()
    const outside = project()
    write(root, "INTERVIEW.md", "IGNORED_INTERVIEW")
    write(root, ".gitignore", "INTERVIEW.md\n")
    write(outside, "INTERVIEW.md", "LINKED_INTERVIEW")
    fs.symlinkSync(outside, path.join(root, "docs"), process.platform === "win32" ? "junction" : "dir")
    git(root, "init", "--quiet")
    let prepared = await prepareProjectKnowledge(root)
    expect(prepared.brief + queryProjectKnowledge(prepared, "interview").text).not.toMatch(/IGNORED_INTERVIEW|LINKED_INTERVIEW/)
    fs.unlinkSync(path.join(root, ".gitignore"))
    write(root, "INTERVIEW.md", 'Personal contribution: SECRET_INTERVIEW; password = "do-not-expose-this"')
    prepared = await prepareProjectKnowledge(root)
    expect(prepared.brief + queryProjectKnowledge(prepared, "personal").text).not.toContain("SECRET_INTERVIEW")
  })

  it("invalidates prepared interview claims when their document becomes ignored", async () => {
    const root = project()
    git(root, "init", "--quiet")
    write(root, "docs/INTERVIEW.md", "Personal contribution: documented adapter integration.")
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.brief).toContain("documented adapter integration")
    write(root, ".gitignore", "docs/INTERVIEW.md\n")
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(false)
    const refreshed = await prepareProjectKnowledge(root)
    expect(refreshed.brief + queryProjectKnowledge(refreshed, "adapter").text).not.toContain("documented adapter integration")
  })

  it("matches personal ownership questions to documented contributions in either conversation language", async () => {
    const root = project()
    write(root, "INTERVIEW.md", "Personal contribution: designed the adapter; provider inference was delegated.")
    const prepared = await prepareProjectKnowledge(root)
    for (const question of ["What did you personally build?", "Was hast du selbst gebaut?"]) {
      const result = queryProjectKnowledge(prepared, question)
      expect(result.score).toBeGreaterThan(0)
      expect(result.text).toContain("provider inference was delegated")
    }
  })

  it.each(["C#", "C++"])("finds a literal %s reference in cached interview notes", async (language) => {
    const root = project()
    write(root, "INTERVIEW.md", `Documented language example: ${language} adapter integration.`)
    const result = queryProjectKnowledge(await prepareProjectKnowledge(root), language)
    expect(result.score).toBeGreaterThan(0)
    expect(result.text).toContain(`${language} adapter integration`)
  })

  it("keeps C# and C++ source matches distinct without treating C as a language query", () => {
    const sharp = searchFixture("Managed bridge", ["A C# adapter."])
    const cpp = searchFixture("Native bridge", ["A C++ adapter."])
    expect(queryProjectKnowledge(sharp, "C#").files).toEqual(["src/module-0.ts"])
    expect(queryProjectKnowledge(cpp, "C#").score).toBe(0)
    expect(queryProjectKnowledge(cpp, "C++").files).toEqual(["src/module-0.ts"])
    expect(queryProjectKnowledge(sharp, "C++").score).toBe(0)
    expect(queryProjectKnowledge(sharp, "C").score).toBe(0)
    expect(queryProjectKnowledge(cpp, "C").score).toBe(0)
  })

  it("prepares a valid six MiB map without truncating metadata near its end", async () => {
    const root = project()
    const prefix = '{"padding":"'
    const suffix = '","project":{"name":"Large valid map"},"nodes":[]}'
    write(root, ".ua/knowledge-graph.json", prefix + " ".repeat(6 * 1024 * 1024 - prefix.length - suffix.length) + suffix)
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.source).toBe("map")
    expect(prepared.name).toBe("Large valid map")
    expect(await isProjectKnowledgeCurrent(prepared)).toBe(true)
  })

  it("rejects malformed or oversized maps explicitly", async () => {
    const root = project()
    write(root, ".ua/knowledge-graph.json", "{invalid")
    await expect(prepareProjectKnowledge(root)).rejects.toThrow(/map|graph/i)
    write(root, ".ua/knowledge-graph.json", JSON.stringify({ nodes: "wrong" }))
    await expect(prepareProjectKnowledge(root)).rejects.toThrow(/map|graph/i)
    write(root, ".ua/knowledge-graph.json", JSON.stringify({ project: { name: "Invalid" }, nodes: [{ id: "broken", name: 42 }] }))
    await expect(prepareProjectKnowledge(root)).rejects.toThrow(/map|graph/i)
    write(root, ".ua/knowledge-graph.json", " ".repeat(8 * 1024 * 1024 + 1))
    await expect(prepareProjectKnowledge(root)).rejects.toThrow(/large|limit/i)
  })

  it("labels Git failures as unverified instead of claiming current source knowledge", async () => {
    const root = project()
    sourceFixture(root)
    graph(root, { hash: "1234567" })
    vi.spyOn(childProcess, "execFile").mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void
      queueMicrotask(() => callback(new Error("Git fixture failure"), "", ""))
      return { stdin: { on: () => {}, end: () => {} } }
    }) as unknown as typeof childProcess.execFile)
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.notice).toContain("unverified")
    expect(queryProjectKnowledge(prepared, "authentication").text).toContain("unverified")
  })

  it("checks committed, staged and untracked changes while ignoring sibling monorepo changes", async () => {
    const outer = project()
    const root = path.join(outer, "selected")
    sourceFixture(root)
    write(outer, "sibling/readme.md", "A separate application.")
    const hash = commit(outer)
    write(outer, "sibling/readme.md", "Only a sibling changed.")
    git(outer, "add", "sibling")
    git(outer, "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "commit", "--quiet", "-m", "Sibling change")
    graph(root, { hash })
    expect((await prepareProjectKnowledge(root)).notice).toContain("freshness verified")
    write(root, "server/auth.ts", "export const authenticate = 'STAGED_CHANGE'")
    git(outer, "add", "selected/server/auth.ts")
    write(root, "server/new-route.ts", "export const addedRoute = true")
    const changed = await prepareProjectKnowledge(root)
    expect(changed.notice).toContain("2 project file(s) changed")
    expect(queryProjectKnowledge(changed, "authentication").text).not.toContain("Authentication validates sessions")
    git(outer, "add", "selected/server")
    git(outer, "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "commit", "--quiet", "-m", "Project change")
    expect((await prepareProjectKnowledge(root)).notice).toContain("2 project file(s) changed")
  })

  it("rejects a graph directory junction instead of using a hidden-path exception to leave the project", async () => {
    const root = project()
    const external = project()
    graph(external)
    fs.symlinkSync(path.join(external, ".ua"), path.join(root, ".ua"), process.platform === "win32" ? "junction" : "dir")
    await expect(prepareProjectKnowledge(root)).rejects.toThrow(/unsafe/i)
  })

  it.skipIf(process.platform !== "win32")("matches Windows source changes regardless of graph path casing", async () => {
    const root = project()
    sourceFixture(root)
    graph(root, { hash: commit(root) })
    const graphPath = path.join(root, ".ua/knowledge-graph.json")
    const data = JSON.parse(fs.readFileSync(graphPath, "utf8"))
    data.nodes[1].filePath = "Server/Auth.ts"
    fs.writeFileSync(graphPath, JSON.stringify(data))
    write(root, "server/auth.ts", "export const authenticate = 'NEW_CASE_INSENSITIVE_BEHAVIOR'")
    const result = queryProjectKnowledge(await prepareProjectKnowledge(root), "authentication")
    expect(result.text).not.toContain("Authentication validates sessions")
    expect(result.text).toContain("Source changed")
  })

  it("withholds architecture descriptions that depend on a deleted source node", async () => {
    const root = project()
    sourceFixture(root)
    graph(root, { hash: commit(root) })
    fs.unlinkSync(path.join(root, "server/auth.ts"))
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.brief).not.toContain("Session checks and persistence")
    expect(prepared.brief).not.toContain("Follow an approval from the screen to storage")
    expect(prepared.brief).toContain("unavailable source")
  })

  it("keeps all onboarding sections when map descriptions and tours are long", async () => {
    const root = project()
    sourceFixture(root)
    graph(root)
    const graphPath = path.join(root, ".ua/knowledge-graph.json")
    const data = JSON.parse(fs.readFileSync(graphPath, "utf8"))
    data.project.description = "Purpose detail. ".repeat(200)
    data.project.frameworks = Array.from({ length: 12 }, (_, i) => `${i} ${"Framework ".repeat(10)}`)
    data.nodes.forEach((node: { summary: string }) => { node.summary += " Implementation detail. ".repeat(100) })
    data.layers = Array.from({ length: 8 }, (_, i) => ({ name: `Layer ${i}`, description: "Layer detail. ".repeat(100), nodeIds: ["ui", "api", "db"] }))
    data.tour = Array.from({ length: 8 }, (_, i) => ({ title: `Tour ${i}`, description: "Tour detail. ".repeat(100), nodeIds: ["ui", "api", "db"] }))
    fs.writeFileSync(graphPath, JSON.stringify(data))
    const prepared = await prepareProjectKnowledge(root)
    for (const section of ["Frontend:", "Backend:", "Data storage:", "data-flow relationships", "Architecture layers:", "Reading tour:"]) expect(prepared.brief).toContain(section)
    expect(prepared.brief.length).toBeLessThanOrEqual(16_000)
  })

  it("rejects traversal, hidden files, ignored files, nested repositories, links and secret-bearing graph text", async () => {
    const root = project()
    const outside = project()
    sourceFixture(root)
    write(outside, "outside.ts", "EXTERNAL_CONTENT")
    fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
    write(root, ".env", "HIDDEN_CONTENT")
    write(root, "credentials.json", "CREDENTIAL_CONTENT")
    write(root, ".gitignore", "ignored.ts\n")
    write(root, "ignored.ts", "IGNORED_CONTENT")
    write(root, "nested/.git/HEAD", "fixture")
    write(root, "nested/code.ts", "NESTED_CONTENT")
    git(root, "init", "--quiet")
    graph(root, { extras: [
      ...["../outside.ts", ".env", "credentials.json", "linked/outside.ts", "ignored.ts", "nested/code.ts"].map((filePath, i) => ({ id: `bad-${i}`, name: "UNSAFE_GRAPH_CONTENT", type: "file", filePath, summary: "UNSAFE_GRAPH_CONTENT" })),
      { id: "bad-secret", type: "concept", name: "Sensitive", summary: 'const password = "SECRET_GRAPH_CONTENT"' }
    ] })
    const prepared = await prepareProjectKnowledge(root)
    const queried = queryProjectKnowledge(prepared, "UNSAFE_GRAPH_CONTENT Sensitive")
    expect(prepared.brief + queried.text).not.toContain("UNSAFE_GRAPH_CONTENT")
    expect(prepared.brief + queried.text).not.toContain("SECRET_GRAPH_CONTENT")
    const detail = await readProjectFiles(root, ["../outside.ts", ".env", "credentials.json", "linked/outside.ts", "ignored.ts", "nested/code.ts", ".ua/knowledge-graph.json"], "CONTENT")
    expect(detail).not.toMatch(/EXTERNAL_CONTENT|HIDDEN_CONTENT|CREDENTIAL_CONTENT|IGNORED_CONTENT|NESTED_CONTENT|SECRET_GRAPH_CONTENT/)
  })

  it("bounds cached nodes and brief/query text in a large valid map", async () => {
    const root = project()
    graph(root, { extras: Array.from({ length: 6000 }, (_, i) => ({ id: `concept-${i}`, type: "concept", name: `Concept ${i}`, summary: "A reusable architecture concept." })) })
    const prepared = await prepareProjectKnowledge(root)
    expect(prepared.nodeCount).toBeLessThanOrEqual(5000)
    expect(prepared.brief.length).toBeLessThanOrEqual(16_000)
    expect(queryProjectKnowledge(prepared, "architecture concept").text.length).toBeLessThanOrEqual(12_000)
    expect(prepared.notice).toMatch(/limit|truncat/i)
  })
})
