import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import childProcess, { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readProjectContext } from "../electron/services/projectContext"

const dirs: string[] = []
function project(): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "meetingly-project-"))
  dirs.push(dir)
  return dir
}
function write(root: string, name: string, content: string | Buffer): void {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("local project context", () => {
  it("labels README, manifests and relevant source with relative paths without claiming experience", async () => {
    const root = project()
    write(root, "README.md", "This application processes invoices.")
    write(root, "package.json", '{"name":"invoice-tool","dependencies":{"react":"1"}}')
    write(root, "src/invoices.ts", "export function totalInvoice(amount: number) { return amount * 1.19 }")
    const out = await readProjectContext(root, "How are invoice totals calculated?")
    expect(out).toContain("README.md")
    expect(out).toContain("package.json")
    expect(out).toContain("src/invoices.ts")
    expect(out).toContain("totalInvoice")
    expect(out).toContain("cannot establish the user's authorship")
    expect(out).toContain("untrusted reference data")
    expect(out).not.toContain(root)
    expect(out).toBe(await readProjectContext(root, "How are invoice totals calculated?"))
  })

  it("returns nothing when no project is selected and a clear notice when it is unavailable", async () => {
    expect(await readProjectContext("", "anything")).toBe("")
    const missing = path.join(project(), "missing")
    const out = await readProjectContext(missing, "anything")
    expect(out).toContain("unavailable")
    expect(out).not.toContain(missing)
  })

  it("omits hidden, generated, credential, lock and binary files", async () => {
    const root = project()
    execFileSync("git", ["init", "--quiet", root], { windowsHide: true, timeout: 5000 })
    const excluded = [
      ".env", ".hidden.ts", ".git/excluded-note.txt", ".cache/x.ts", "node_modules/x.ts", "dist/x.ts",
      "build/x.ts", "coverage/x.ts", "vendor/x.ts", "credentials.json", "private-config.ts",
      "client_secret.json", "api-key.ts", "certificate.ts", "server.pem", "package-lock.json", "yarn.lock"
    ]
    for (const file of excluded) write(root, file, "EXCLUDED_CONTENT")
    write(root, "src/binary.ts", Buffer.from("EXCLUDED_CONTENT\0\x01"))
    write(root, "src/visible.ts", "export const visible = 'VISIBLE_CONTENT'")
    const out = await readProjectContext(root, "Show the code")
    expect(out).toContain("VISIBLE_CONTENT")
    expect(out).not.toContain("EXCLUDED_CONTENT")
    for (const file of excluded) expect(out).not.toContain(`\"${file}\"`)
  })

  it("omits entire files with recognizable credentials, tokens or private keys", async () => {
    const root = project()
    const sensitive = [
      'const password = "test-only-password-value"; // SENSITIVE_CONTENT',
      'const apiKey = "test-only-api-value"; // SENSITIVE_CONTENT',
      'const VENDOR_API_KEY = "test-only-prefixed-value"; // SENSITIVE_CONTENT',
      'const token = "test-only-generic-token"; // SENSITIVE_CONTENT',
      'const authToken = "test-only-auth-token"; // SENSITIVE_CONTENT',
      'const config = {"client_secret":"test-only-client-value"}; // SENSITIVE_CONTENT',
      'const connection = "postgres://fixture:fixture-password@example.invalid/db"; // SENSITIVE_CONTENT',
      'const header = "Bearer abcdefghijklmnopqrstuvwxyz123456"; // SENSITIVE_CONTENT',
      "-----BEGIN RSA PRIVATE KEY-----\nSENSITIVE_CONTENT\n-----END RSA PRIVATE KEY-----"
    ]
    sensitive.forEach((content, index) => write(root, `src/module-${index}.ts`, content))
    write(root, "src/clean.ts", "export const status = 'SAFE_CONTENT'")
    const out = await readProjectContext(root, "module")
    expect(out).toContain("SAFE_CONTENT")
    expect(out).not.toContain("SENSITIVE_CONTENT")
    expect(out).not.toContain("test-only")
    expect(out).not.toContain("module-")
  })

  it("keeps typed authentication code and dynamic credential reads while excluding literal config values", async () => {
    const root = project()
    write(root, "src/session.ts", "export function verify(token: string) { return token.length > 0 }\nconst token = request.headers.authorization\nconst password = suppliedPassword\nconst apiKey = process.env.VENDOR_KEY\n// AUTH_IMPLEMENTATION")
    write(root, "config.yaml", "password: test-only-config-value\n# CONFIG_CREDENTIAL_CONTENT")
    const out = await readProjectContext(root, "verify authentication token")
    expect(out).toContain("AUTH_IMPLEMENTATION")
    expect(out).toContain("token: string")
    expect(out).toContain("request.headers.authorization")
    expect(out).not.toContain("CONFIG_CREDENTIAL_CONTENT")
  })

  it("honors root and nested Git ignore rules without uploading their contents", async () => {
    const root = project()
    execFileSync("git", ["init", "--quiet", root], { windowsHide: true, timeout: 5000 })
    write(root, ".gitignore", "ignored.ts\nignored-dir/\n")
    write(root, "src/.gitignore", "nested-ignore.ts\n")
    for (const file of ["ignored.ts", "ignored-dir/file.ts", "src/nested-ignore.ts"]) write(root, file, "IGNORED_CONTENT")
    write(root, "src/kept.ts", "export const kept = 'KEPT_CONTENT'")
    const out = await readProjectContext(root, "code")
    expect(out).toContain("KEPT_CONTENT")
    expect(out).not.toContain("IGNORED_CONTENT")
  })

  it("fails closed without Git when ignore markers exist in the selected folder or its ancestors", async () => {
    const missingGit = vi.spyOn(childProcess, "execFile").mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error & { code: string }, stdout: string, stderr: string) => void
      queueMicrotask(() => callback(Object.assign(new Error("Fixture Git missing"), { code: "ENOENT" }), "", ""))
      return { stdin: { on: () => {}, end: () => {} } }
    }) as unknown as typeof childProcess.execFile)
    for (const marker of [".git", ".gitignore"]) {
      const root = project()
      write(root, marker, "fixture")
      write(root, "selected/code.ts", "MUST_REMAIN_UNREAD")
      const out = await readProjectContext(path.join(root, "selected"), "code")
      expect(out).toContain("unavailable")
      expect(out).not.toContain("MUST_REMAIN_UNREAD")
    }
    const plain = project()
    write(plain, "code.ts", "PLAIN_FOLDER_CONTENT")
    expect(await readProjectContext(plain, "code")).toContain("PLAIN_FOLDER_CONTENT")
    expect(missingGit).toHaveBeenCalled()
  })

  it("fails closed when a plain folder has ignore rules that Git cannot evaluate", async () => {
    const root = project()
    write(root, ".gitignore", "ignored.ts\n")
    write(root, "ignored.ts", "MUST_REMAIN_UNREAD")
    const out = await readProjectContext(root, "code")
    expect(out).toContain("unavailable")
    expect(out).not.toContain("MUST_REMAIN_UNREAD")
  })

  it("does not bypass descendant ignore rules in a plain parent folder", async () => {
    const root = project()
    write(root, "nested/.gitignore", "config.ts\n")
    write(root, "nested/config.ts", "NESTED_IGNORED_CONTENT")
    const out = await readProjectContext(root, "config")
    expect(out).toContain("unavailable")
    expect(out).not.toContain("NESTED_IGNORED_CONTENT")
  })

  it("does not cross a nested repository boundary", async () => {
    const root = project()
    write(root, "README.md", "PARENT_PROJECT_CONTENT")
    write(root, "nested/.git/HEAD", "fixture")
    write(root, "nested/source.ts", "NESTED_REPOSITORY_CONTENT")
    const out = await readProjectContext(root, "source")
    expect(out).toContain("PARENT_PROJECT_CONTENT")
    expect(out).not.toContain("NESTED_REPOSITORY_CONTENT")
  })

  it("rejects directory links, linked ancestors and a selected link", async () => {
    const root = project()
    const external = project()
    write(external, "src/elsewhere.ts", "EXTERNAL_CONTENT")
    const link = path.join(root, "linked")
    fs.symlinkSync(external, link, process.platform === "win32" ? "junction" : "dir")
    write(root, "safe.ts", "export const safe = 'SAFE_CONTENT'")
    expect(await readProjectContext(root, "elsewhere")).not.toContain("EXTERNAL_CONTENT")
    expect(await readProjectContext(link, "anything")).toContain("unavailable")
    expect(await readProjectContext(path.join(link, "src"), "anything")).toContain("unavailable")
  })

  it("ranks matching late filenames before the read limit and extracts relevant later lines", async () => {
    const root = project()
    for (let index = 0; index < 115; index++) write(root, `src/a-${String(index).padStart(3, "0")}.ts`, "export const unrelated = true")
    write(root, "src/z-payment-retry.ts", "// unrelated setup\n".repeat(800) + "export function paymentRetry() { return 'RELEVANT_LATE_CONTENT' }\n")
    const out = await readProjectContext(root, "Explain payment retry")
    expect(out).toContain("src/z-payment-retry.ts")
    expect(out).toContain("RELEVANT_LATE_CONTENT")
    expect(out.length).toBeLessThanOrEqual(24_000)
    expect(out).toContain("truncated")
  })

  it("keeps the project overview even when many filenames match the question", async () => {
    const root = project()
    write(root, "README.md", "OVERVIEW_CONTENT")
    write(root, "package.json", '{"name":"OVERVIEW_MANIFEST"}')
    for (let index = 0; index < 110; index++) write(root, `src/payment-${index}.ts`, "export const payment = true")
    const out = await readProjectContext(root, "payment")
    expect(out).toContain("OVERVIEW_CONTENT")
    expect(out).toContain("OVERVIEW_MANIFEST")
    expect(out).toContain("src/payment-")
  })

  it("reports an unavailable context when the selected directory cannot be listed", async () => {
    const root = project()
    vi.spyOn(fsp, "opendir").mockRejectedValueOnce(new Error("Fixture permission denied"))
    expect(await readProjectContext(root, "anything")).toContain("unavailable")
  })

  it("bounds file reads, total bytes, prompt size and directory depth", async () => {
    const root = project()
    for (let index = 0; index < 12; index++) write(root, `large-${index}.ts`, "x".repeat(64 * 1024) + "BEYOND_FILE_LIMIT")
    write(root, "one/two/three/four/five/six/seven.ts", "BEYOND_DEPTH_LIMIT")
    const opened = vi.spyOn(fsp, "open")
    const out = await readProjectContext(root, "code")
    expect(opened.mock.calls.length).toBeLessThanOrEqual(8)
    expect(out.length).toBeLessThanOrEqual(24_000)
    expect(out).not.toContain("BEYOND_FILE_LIMIT")
    expect(out).not.toContain("BEYOND_DEPTH_LIMIT")
    expect(out).toContain("truncated")
  })

  it("limits traversal and file reads in a large directory", async () => {
    const root = project()
    for (let index = 0; index < 1510; index++) write(root, `source-${String(index).padStart(4, "0")}.ts`, "export const source = true")
    const directory = await fsp.opendir(root)
    const readCalls = vi.spyOn(Object.getPrototypeOf(directory), "read")
    await directory.close()
    const opened = vi.spyOn(fsp, "open")
    const out = await readProjectContext(root, "source")
    expect(readCalls.mock.calls.length).toBeLessThanOrEqual(1500)
    expect(opened.mock.calls.length).toBeLessThanOrEqual(100)
    expect(out.length).toBeLessThanOrEqual(24_000)
    expect(out).toContain("truncated")
  }, 60_000)

  it("reads changed files on the next request without persisting a snapshot", async () => {
    const root = project()
    write(root, "src/current.ts", "export const current = 'BEFORE_CHANGE'")
    expect(await readProjectContext(root, "current")).toContain("BEFORE_CHANGE")
    write(root, "src/current.ts", "export const current = 'AFTER_CHANGE'")
    const out = await readProjectContext(root, "current")
    expect(out).toContain("AFTER_CHANGE")
    expect(out).not.toContain("BEFORE_CHANGE")
    expect(fs.readdirSync(root)).toEqual(["src"])
  })
})
