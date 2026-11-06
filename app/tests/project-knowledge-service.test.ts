import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore } from "../electron/services/settings"
import type { InterviewProject } from "../shared/types"
import type { PreparedProjectKnowledge } from "../electron/services/projectKnowledge"

const { prepare, queryMap, current, readFiles } = vi.hoisted(() => ({
  prepare: vi.fn(), queryMap: vi.fn(), current: vi.fn(), readFiles: vi.fn()
}))
vi.mock("../electron/services/projectKnowledge", () => ({ prepareProjectKnowledge: prepare, queryProjectKnowledge: queryMap, isProjectKnowledgeCurrent: current }))
vi.mock("../electron/services/projectContext", () => ({ readProjectFiles: readFiles }))
import { ProjectKnowledgeService } from "../electron/services/projectKnowledgeService"

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
beforeEach(() => {
  vi.resetAllMocks()
  prepare.mockImplementation(async (folder: string) => prepared(folder))
  current.mockResolvedValue(true)
  queryMap.mockImplementation((p: PreparedProjectKnowledge) => ({ score: 2, text: `Graph evidence for ${p.name}`, files: [`src/${p.name}.ts`] }))
  readFiles.mockImplementation(async (_folder: string, files: string[]) => `Live evidence: ${files.join(", ")}`)
})

function prepared(folder: string, source: "map" | "files" = "map"): PreparedProjectKnowledge {
  return { folder, name: path.basename(folder), brief: `Brief for ${path.basename(folder)}`, notice: source === "map" ? "" : "No project map; limited local files.", source, nodeCount: 4, preparedAt: 1234 } as PreparedProjectKnowledge
}

function setup(count = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtx-knowledge-service-"))
  dirs.push(dir)
  const settings = new SettingsStore(path.join(dir, "settings.json"))
  const projects: InterviewProject[] = Array.from({ length: count }, (_, i) => ({ id: `project-${i}`, name: `Project ${i}`, folder: path.join(dir, `repo-${i}`), experience: `Confirmed role ${i}`, enabled: true }))
  settings.update({ projects })
  return { settings, projects, service: new ProjectKnowledgeService({ settings }), dir }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("prepared interview project service", () => {
  it("includes selected descriptions before preparation and keeps them separate from confirmed roles", async () => {
    const { service, settings, projects } = setup()
    settings.update({ projects: [
      { ...projects[0], description: "A local interview practice assistant." },
      { ...projects[1], description: "Unselected confidential project.", enabled: false }
    ] })
    const context = await service.context("What is this project?")
    expect(context).toContain("User-provided project description: A local interview practice assistant.")
    expect(context).toContain("Confirmed personal role: Confirmed role 0")
    expect(context).toContain("Descriptions and roles do not verify implementation details")
    expect(context).toContain("Evidence unavailable")
    expect(context).not.toContain("Unselected confidential project")
    expect(prepare).not.toHaveBeenCalled()
  })
  it("bounds descriptions together with roles while retaining every selected project's context", async () => {
    const { service, settings, projects } = setup(32)
    settings.update({ projects: projects.map((project, i) => ({ ...project, description: `Description ${i} ${"d".repeat(1990)}`, experience: `Role ${i} ${"r".repeat(5990)}` })) })
    const context = await service.context("Explain the projects")
    expect(context.length).toBeLessThanOrEqual(32_000)
    for (let i = 0; i < 32; i++) {
      expect(context).toContain(`Description ${i} `)
      expect(context).toContain(`Role ${i} `)
    }
  })
  it("shares concurrent preparation and cached questions but rebuilds on explicit preparation", async () => {
    const { service, projects } = setup()
    const first = deferred<PreparedProjectKnowledge>()
    prepare.mockImplementationOnce(() => first.promise)
    const job = service.prepare()
    expect(service.prepare()).toBe(job)
    await Promise.resolve()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(service.getState()).toMatchObject({ preparing: true, projects: [{ status: "preparing" }, { status: "preparing" }] })
    first.resolve(prepared(projects[0].folder))
    await job
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(service.getState()).toMatchObject({ preparing: false, projects: [{ status: "ready" }, { status: "ready" }] })
    await service.context("Explain the API")
    await service.context("And the database?")
    expect(prepare).toHaveBeenCalledTimes(2)
    await service.prepare()
    expect(prepare).toHaveBeenCalledTimes(4)
    expect(current).toHaveBeenCalled()
    expect(readFiles).toHaveBeenCalledWith(projects[0].folder, ["src/repo-0.ts"], "Explain the API")
  })

  it("includes every prepared briefing and keeps each confirmed role associated with its project", async () => {
    const { service } = setup(4)
    await service.prepare()
    const context = await service.context("Compare the projects")
    for (let i = 0; i < 4; i++) {
      expect(context).toContain(`PROJECT "Project ${i}" [project-${i}]\nConfirmed personal role: Confirmed role ${i}\nPrepared briefing: Brief for repo-${i}`)
    }
    expect(context).toContain("Repository evidence describes code, not personal authorship")
    expect(context).toContain("Additional matching project detail was omitted")
    expect(readFiles).toHaveBeenCalledTimes(3)
  })

  it("prioritizes relevant detail while keeping all briefings for generic follow-ups", async () => {
    const { service } = setup(5)
    await service.prepare()
    queryMap.mockImplementation((p: PreparedProjectKnowledge) => ({ score: p.name === "repo-4" ? 10 : 0, text: `Relevant ${p.name}`, files: ["src/specific.ts"] }))
    const context = await service.context("Describe the payment queue")
    expect(context).toContain("Relevant repo-4")
    expect(context).toContain("Brief for repo-0")
    expect(readFiles).toHaveBeenCalledTimes(1)
    queryMap.mockReturnValue({ score: 0, text: "", files: [] })
    const followup = await service.context("Tell me more")
    for (let i = 0; i < 5; i++) expect(followup).toContain(`Brief for repo-${i}`)
  })

  it("describes missing preparation and roles without inventing experience", async () => {
    const { service, settings, projects } = setup()
    settings.update({ projects: [{ ...projects[0], experience: "" }, projects[1]] })
    const context = await service.context("What did I build?")
    expect(context).toContain("Not supplied. Do not infer personal responsibility")
    expect(context).toContain("Confirmed role 1")
    expect(context).toContain("has not been prepared")
    expect(prepare).not.toHaveBeenCalled()
    expect(readFiles).not.toHaveBeenCalled()
  })

  it("never commits a removed or deselected project after pending preparation", async () => {
    const { service, settings, projects } = setup()
    const pending = deferred<PreparedProjectKnowledge>()
    prepare.mockImplementationOnce(() => pending.promise)
    const job = service.prepare()
    await Promise.resolve()
    settings.update({ projects: [{ ...projects[1], enabled: false }] })
    pending.resolve(prepared(projects[0].folder))
    await job
    expect(service.getState().projects).toEqual([expect.objectContaining({ id: projects[1].id, status: "unprepared" })])
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(await service.context("Anything?")).toBe("")
  })

  it("invalidates only changed selections and ignores pending work after a disable-enable cycle", async () => {
    const { service, settings, projects } = setup()
    const pending = deferred<PreparedProjectKnowledge>()
    prepare.mockImplementationOnce(() => pending.promise)
    const job = service.prepare()
    await Promise.resolve()
    settings.update({ projects: [{ ...projects[0], enabled: false }, projects[1]] })
    settings.update({ projects })
    pending.resolve(prepared(projects[0].folder))
    await job
    expect(service.getState().projects.map((p) => p.status)).toEqual(["unprepared", "ready"])
    await service.prepare()
    expect(prepare).toHaveBeenCalledTimes(4)
  })

  it("excludes all previous evidence while an explicit preparation is pending", async () => {
    const { service, projects } = setup()
    await service.prepare()
    const pending = deferred<PreparedProjectKnowledge>()
    prepare.mockImplementationOnce(() => pending.promise)
    const refresh = service.prepare()
    await Promise.resolve()
    const context = await service.context("Explain both projects")
    expect(context).not.toContain("Brief for")
    expect(context).not.toContain("Graph evidence")
    expect(context).toContain("Confirmed role 0")
    expect(context).toContain("Confirmed role 1")
    expect(readFiles).not.toHaveBeenCalled()
    pending.resolve({ ...prepared(projects[0].folder), brief: "Refreshed source briefing" })
    await refresh
    expect(await service.context("Explain both projects")).toContain("Refreshed source briefing")
    expect(prepare).toHaveBeenCalledTimes(4)
  })

  it("drops an old context read when explicit preparation replaces its snapshot", async () => {
    const { service } = setup(1)
    await service.prepare()
    const pending = deferred<string>()
    const started = deferred<void>()
    readFiles.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const contextJob = service.context("Explain implementation")
    await started.promise
    await service.prepare()
    pending.resolve("OLD SNAPSHOT SOURCE")
    const context = await contextJob
    expect(context).not.toContain("OLD SNAPSHOT SOURCE")
    expect(context).not.toContain("Graph evidence")
  })

  it("reserves current source evidence for three projects with long map descriptions", async () => {
    const { service } = setup(3)
    prepare.mockImplementation(async (folder: string) => ({ ...prepared(folder), brief: "b".repeat(16_000) }))
    queryMap.mockImplementation((p: PreparedProjectKnowledge) => ({ score: 1, text: "g".repeat(12_000), files: [`src/${p.name}.ts`] }))
    readFiles.mockImplementation(async (_folder: string, files: string[]) => `CURRENT SOURCE ${files[0]}\n${"code".repeat(4000)}`)
    await service.prepare()
    const context = await service.context("Explain implementation")
    expect(context.length).toBeLessThanOrEqual(32_000)
    for (let i = 0; i < 3; i++) expect(context).toContain(`CURRENT SOURCE src/repo-${i}.ts`)
  })

  it("drops removed project detail if selection changes during a targeted file read", async () => {
    const { service, settings, projects } = setup()
    await service.prepare()
    const pending = deferred<string>()
    const started = deferred<void>()
    readFiles.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const contextJob = service.context("Explain both projects")
    await started.promise
    settings.update({ projects: [projects[1]] })
    pending.resolve("REMOVED PROJECT SOURCE")
    const context = await contextJob
    expect(context).not.toContain("REMOVED PROJECT SOURCE")
    expect(context).not.toContain("repo-0")
    expect(context).not.toContain("Confirmed role 0")
    expect(context).toContain("Brief for repo-1")
  })

  it("uses the latest role and name without reparsing an unchanged project", async () => {
    const { service, settings, projects } = setup(1)
    await service.prepare()
    settings.update({ projects: [{ ...projects[0], name: "Renamed", experience: "Updated confirmed role" }] })
    const context = await service.context("Explain the work")
    expect(context).toContain('PROJECT "Renamed"')
    expect(context).toContain("Updated confirmed role")
    expect(context).not.toContain("Confirmed role 0")
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it("marks changed maps stale and excludes all old evidence until preparation", async () => {
    const { service } = setup(1)
    await service.prepare()
    current.mockResolvedValue(false)
    const context = await service.context("Explain implementation")
    expect(service.getState().projects[0].status).toBe("stale")
    expect(context).toContain("Prepare this project again")
    expect(context).not.toContain("Brief for")
    expect(context).not.toContain("Graph evidence")
    expect(context).toContain("Confirmed role 0")
    expect(readFiles).not.toHaveBeenCalled()
    await service.prepare()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(service.getState().projects[0].status).toBe("ready")
  })

  it("shows limited evidence and isolates preparation errors without returning source contents", async () => {
    const { service, projects } = setup()
    prepare.mockImplementationOnce(async () => prepared(projects[0].folder, "files"))
    prepare.mockRejectedValueOnce(new Error("SECRET SOURCE BODY"))
    const state = await service.prepare()
    expect(state.projects.map((p) => p.status)).toEqual(["limited", "error"])
    expect(JSON.stringify(state)).not.toContain("SECRET SOURCE BODY")
    const context = await service.context("Explain")
    expect(context).toContain("No project map; limited local files")
    expect(context).not.toContain("SECRET SOURCE BODY")
  })

  it("bounds context for 32 projects with explicit omissions and keeps every project identifiable", async () => {
    const { service, settings, projects } = setup(32)
    settings.update({ projects: projects.map((p) => ({ ...p, name: `${p.name} ${"n".repeat(105)}`, experience: "r".repeat(6000) })) })
    prepare.mockImplementation(async (folder: string) => ({ ...prepared(folder), brief: "b".repeat(12_000) }))
    queryMap.mockReturnValue({ score: 1, text: "g".repeat(20_000), files: ["src/a.ts"] })
    readFiles.mockResolvedValue("s".repeat(20_000))
    await service.prepare()
    const context = await service.context("Compare")
    expect(context.length).toBeLessThanOrEqual(32_000)
    for (const project of projects) expect(context).toContain(`[${project.id}]`)
    expect(context).toContain("omitted")
    expect(fs.readFileSync(path.join(path.dirname(projects[0].folder), "settings.json"), "utf8")).not.toContain("bbbbbbbb")
  })

  it("exposes immutable state snapshots and emits preparation updates", async () => {
    const { service } = setup(1)
    const listener = vi.fn()
    service.on("state", listener)
    service.getState().projects[0].status = "ready"
    expect(service.getState().projects[0].status).toBe("unprepared")
    await service.prepare()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ preparing: true }))
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ preparing: false }))
  })
})
