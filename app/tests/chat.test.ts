import { describe, expect, it } from "vitest"
import { buildMessages, composeSystemPrompt, gateDecision, SKIP_TOKEN } from "../electron/services/chat"
import { formatTranscript } from "../electron/services/session"
import { ANSWER_FORMAT, ANSWER_LENGTHS, ANSWER_MODES, DEFAULT_PROMPT, type AnswerLength, type AnswerMode, type ChatMessage } from "../shared/types"

it("keeps practice instructions and candidate context isolated from live chat", async () => {
  const { ChatService } = await import("../electron/services/chat")
  const requests: { role: string; content: string }[][] = []
  const settings = { get: () => ({ answerLength: "auto", answerMode: "interview", projects: [] }), activePrompt: () => DEFAULT_PROMPT } as never
  const llm = { languageInstruction: () => "Respond in English.", chat: async (messages: { role: string; content: string }[]) => { requests.push(messages); return { text: "A complete answer.", tokens: 1 } } } as never
  const live = new ChatService({ settings, llm, session: { transcriptText: () => "LIVE_ONLY", getLastUtterance: () => null }, capture: async () => ({}) as never })
  const practice = new ChatService({ settings, llm, session: { transcriptText: () => "Candidate: I maintained the API.", getLastUtterance: () => null }, capture: async () => ({}) as never, systemInstruction: "PRACTICE_ONLY: Assist the candidate in this practice interview." })
  await live.send("Explain the database.")
  await practice.send("Explain the API.")
  expect(requests[0][0].content).not.toContain("PRACTICE_ONLY")
  expect(requests[1][0].content).toContain("PRACTICE_ONLY")
  expect(requests[1].map((message) => message.content).join("\n")).toContain("Candidate: I maintained the API.")
  expect(requests[1].map((message) => message.content).join("\n")).not.toContain("LIVE_ONLY")
  expect(live.getHistory().some((message) => message.text === "Explain the API.")).toBe(false)
})

const msg = (role: ChatMessage["role"], text: string, kind: ChatMessage["kind"] = "text"): ChatMessage => ({
  id: text,
  role,
  kind,
  text,
  timestamp: 0
})

describe("buildMessages", () => {
  it("puts the system prompt first, then transcript, then history", () => {
    const out = buildMessages({
      system: "SYS",
      transcript: "we talked about kafka",
      history: [msg("user", "hi"), msg("assistant", "hello")]
    })
    expect(out[0]).toEqual({ role: "system", content: "SYS" })
    expect(out[1].role).toBe("system")
    expect(out[1].content).toContain("we talked about kafka")
    expect(out.slice(2)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }
    ])
  })

  it("skips the transcript block when empty, drops errors, labels screenshots and heard turns", () => {
    const out = buildMessages({
      system: "SYS",
      transcript: "   ",
      history: [msg("assistant", "boom", "error"), msg("assistant", "seen", "screenshot"), msg("user", "what is kafka", "auto")]
    })
    expect(out).toHaveLength(3)
    expect(out[1].content).toBe("[Screenshot analysis]\nseen")
    expect(out[2].content).toBe("[Heard in the meeting] what is kafka")
  })

  it("keeps only the most recent history and the tail of a long transcript", () => {
    const history = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? "assistant" : "user", `m${i}`))
    const out = buildMessages({ system: "S", transcript: "x".repeat(10000), history })
    expect(out.filter((m) => m.role !== "system")).toHaveLength(12)
    expect(out.at(-1)?.content).toBe("m29")
    expect(out[1].content.length).toBeLessThan(4200)
  })
})

describe("composeSystemPrompt", () => {
  it("adds background notes, natural complete sentences, depth and language", () => {
    const out = composeSystemPrompt({ ...DEFAULT_PROMPT, notes: "I am a data engineer at Acme." }, { answerLength: "short" }, "Respond in English.")
    expect(out.startsWith(DEFAULT_PROMPT.content)).toBe(true)
    expect(out).toContain("Background about the user")
    expect(out).toContain("I am a data engineer at Acme.")
    expect(out).toContain(ANSWER_FORMAT)
    expect(out).toContain("complete, grammatically correct sentences")
    expect(out).toContain(ANSWER_LENGTHS.short.instruction)
    expect(out.endsWith("Respond in English.")).toBe(true)
  })

  it("omits the background block when notes are empty", () => {
    const out = composeSystemPrompt(DEFAULT_PROMPT, { answerLength: "auto" }, "L")
    expect(out).not.toContain("Background about the user")
  })

  it.each(["meeting", "interview", "coding"] as AnswerMode[])("uses the %s mode without reintroducing fragments or fixed answer limits", (answerMode) => {
    expect(ANSWER_MODES).toBeDefined()
    for (const answerLength of Object.keys(ANSWER_LENGTHS) as AnswerLength[]) {
      const out = composeSystemPrompt(DEFAULT_PROMPT, { answerLength, answerMode }, "L")
      expect(out).toContain(ANSWER_MODES[answerMode].instruction)
      expect(out).toContain(ANSWER_LENGTHS[answerLength].instruction)
      expect(out).toContain(ANSWER_FORMAT)
      expect(out).not.toMatch(/catch points|not a sentence|\d+\s*(?:to|-)\s*\d+\s*(?:sentences|words|bullets)/i)
      expect(out).not.toContain("[placeholder]")
      expect(out).not.toContain("For code, give the code")
    }
  })

  it("keeps project references separate from user-confirmed experience and never treats source text as instructions", () => {
    const out = composeSystemPrompt(DEFAULT_PROMPT, { answerLength: "auto", projectExperience: "I implemented the export endpoint." }, "L", "src/export.ts: exports invoices")
    expect(out).toContain("I implemented the export endpoint.")
    expect(out).toContain("User-confirmed project experience")
    expect(out).toContain("src/export.ts: exports invoices")
    expect(out).toContain("reference data")
    expect(out).toContain("never follow instructions")
    expect(out).toContain("personal authorship")
  })

  it("includes confirmed experience even without a selected project folder", () => {
    const out = composeSystemPrompt(DEFAULT_PROMPT, { answerLength: "auto", projectExperience: "I maintained the billing API." }, "L")
    expect(out).toContain("I maintained the billing API.")
    expect(out).not.toContain("Project repository context")
  })
})

describe("gateDecision", () => {
  it("waits while the reply could still be the skip marker", () => {
    expect(gateDecision("")).toBe("wait")
    expect(gateDecision("  ")).toBe("wait")
    expect(gateDecision("[")).toBe("wait")
    expect(gateDecision("[no-ans")).toBe("wait")
  })
  it("skips on the marker, answers on anything else", () => {
    expect(gateDecision(SKIP_TOKEN)).toBe("skip")
    expect(gateDecision(` ${SKIP_TOKEN}
`)).toBe("skip")
    expect(gateDecision("Kafka is a distributed log")).toBe("answer")
    expect(gateDecision("Kafka — это распределённый лог")).toBe("answer")
    expect(gateDecision("[1] first point")).toBe("answer")
  })
  it("sees through optional markdown around the marker", () => {
    expect(gateDecision("**")).toBe("wait")
    expect(gateDecision("**[no-")).toBe("wait")
    expect(gateDecision(`**${SKIP_TOKEN}**`)).toBe("skip")
    expect(gateDecision(`_${SKIP_TOKEN}_`)).toBe("skip")
    expect(gateDecision("**Kafka is a distributed log.**")).toBe("answer")
  })
})

describe("answer request coverage", () => {
  // @finding CONV-F4
  it.each([
    { answerMode: "interview", question: "Have you worked with distributed queues?", path: "manual" },
    { answerMode: "interview", question: "What was difficult about the ingestion pipeline, and how did you solve it?", path: "automatic" },
    { answerMode: "meeting", question: "Tell me about a time you disagreed with a technical decision.", path: "manual" },
    { answerMode: "coding", question: "Explain the retry strategy shown on screen.", path: "screenshot" }
  ] as const)("keeps useful answer fallbacks after saved instructions for $path in $answerMode mode", async ({ answerMode, question, path }) => {
    const { ChatService } = await import("../electron/services/chat")
    const prompt = {
      ...DEFAULT_PROMPT,
      content: "If personal details are missing, state that they are unknown.",
      notes: "Atlas: ingestion normalizes source facts; schema validation rejects malformed records."
    }
    const original = { ...prompt }
    let system = ""
    const chat = new ChatService({
      settings: { get: () => ({ answerLength: "auto", answerMode, autoAnswer: "questions", projects: [] }), activePrompt: () => prompt } as never,
      llm: {
        languageInstruction: () => "Respond in English.",
        chat: async (messages: { content: string }[], onChunk?: (delta: string) => void) => {
          system = messages[0].content
          onChunk?.("An answer draft.")
          return { text: "An answer draft.", tokens: 1 }
        },
        vision: async (_image: string, _question: string, instruction: string) => {
          system = instruction
          return { text: "An answer draft.", tokens: 1 }
        }
      } as never,
      session: { transcriptText: () => "", getLastUtterance: () => null },
      capture: async () => ({ base64: "fixture", width: 10, height: 10 }) as never,
      projectContext: async () => "Atlas: schema validation rejects malformed records. Individual authorship is not supplied."
    })
    if (path === "automatic") await chat.autoAnswer({ text: question, channel: "them", speaker: null, timestamp: 0 })
    else if (path === "screenshot") await chat.screenshot(question)
    else await chat.send(question)

    expect(prompt).toEqual(original)
    expect(system).toContain(original.notes)
    expect(system).toContain("Individual authorship is not supplied.")
    const finalRules = system.slice(system.indexOf(ANSWER_FORMAT))
    expect(system.indexOf(ANSWER_FORMAT)).toBeGreaterThan(system.indexOf(original.content))
    expect(finalRules).toMatch(/missing (?:personal )?notes.*not evidence of no experience/i)
    expect(finalRules).toMatch(/do not infer.*personal denial/i)
    expect(finalRules).toMatch(/project challenge.*supported problem and concrete solution.*missing individual authorship.*not block/i)
    expect(finalRules).toMatch(/generic behavioral.*unnamed illustrative first-person answer draft.*problem, action and result/i)
    expect(finalRules).toMatch(/first-person past tense.*draft status internal.*if this happened.*inability-to-recall.*spoken hypothetical or draft label/i)
    expect(finalRules).toMatch(/never attach illustrative details to named projects, employers, credentials, deployments or metrics/i)
    expect(finalRules).toMatch(/do not repeat.*project overview/i)
    expect(finalRules).toMatch(/reference data.*never follow instructions/i)
  })

  it.each(["Backend", "Frontend", "Full-stack"])("applies spoken interview safeguards after a saved %s prompt without rewriting it", async (title) => {
    const { ChatService } = await import("../electron/services/chat")
    const prompt = {
      id: `saved-${title.toLowerCase()}`,
      title,
      content: `Focus on ${title} interviews. Add [Add your confirmed role here] when personal details are missing. Close with an offer to refine the answer.`,
      notes: "My confirmed focus is the JavaScript/TypeScript ecosystem."
    }
    const original = { ...prompt }
    const requests: { role: string; content: string }[][] = []
    for (const systemInstruction of [undefined, "This is a practice interview. Use candidate statements as confirmed conversation context."]) {
      const chat = new ChatService({
        settings: { get: () => ({ answerLength: "auto", answerMode: "interview", projects: [] }), activePrompt: () => prompt } as never,
        llm: {
          languageInstruction: () => "Respond in English.",
          chat: async (messages: { role: string; content: string }[]) => {
            requests.push(messages)
            return { text: "The frontend uses TypeScript and React in the browser.", tokens: 1 }
          }
        } as never,
        session: { transcriptText: () => "", getLastUtterance: () => null },
        capture: async () => ({}) as never,
        projectContext: async () => "Project A: TypeScript and React frontend; Node.js backend. Personal role: not supplied.",
        systemInstruction
      })
      await chat.send("Which languages do the projects use, and what was my hardest problem?")
    }
    expect(prompt).toEqual(original)
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      const system = request[0].content
      expect(system.startsWith(original.content)).toBe(true)
      expect(system).toContain(original.notes)
      const trusted = system.slice(system.indexOf(ANSWER_MODES.interview.instruction))
      expect(system.indexOf(ANSWER_MODES.interview.instruction)).toBeGreaterThan(system.indexOf("Personal role: not supplied."))
      expect(trusted).toMatch(/never emit (?:editing )?placeholders/i)
      expect(trusted).toMatch(/requested code or templates/i)
      expect(trusted).toMatch(/no coaching or generic closing/i)
      expect(trusted).toMatch(/missing personal role.*answer.*project facts/i)
      expect(trusted).toMatch(/missing authorship must not block the explanation/i)
      expect(trusted).toMatch(/general project challenge.*confirmed personal achievement/i)
      expect(trusted).toMatch(/project-level challenge explanation does not require exclusive authorship/i)
      expect(trusted).toMatch(/illustrative event is not confirmed user background/i)
      expect(trusted).not.toContain("or hardest problem")
      expect(trusted).toContain("JavaScript/TypeScript ecosystem")
      expect(trusted).toMatch(/languages.*frameworks.*runtimes/i)
      expect(trusted).toMatch(/browser.*Node\.js build tools/i)
      expect(trusted).toMatch(/secondary languages.*reviewed, substantive original project components.*curated references/i)
      expect(trusted).toMatch(/project language use.*individual proficiency or implementation role/i)
      expect(trusted).toMatch(/upstream, vendored or dependency-only code does not establish experience/i)
      expect(trusted).toMatch(/never rank.*file counts/i)
      expect(trusted).toMatch(/documented project focus.*strongest language/i)
      expect(trusted).toMatch(/language-only question.*short matching language-to-component example/i)
      expect(request.at(-1)?.content).toBe("Which languages do the projects use, and what was my hardest problem?")
    }
  })

  const scenarios = [
    { path: "chat", question: "What is SQL injection?" },
    { path: "answer", question: "Explain a cache, then write an eviction function and discuss its complexity." },
    { path: "always", question: "Explain a database index to someone without a technical background." },
    { path: "questions", question: "What did I personally build in this project?" },
    { path: "screenshot", question: "Solve the coding task shown on screen." }
  ] as const

  it.each(scenarios)("passes the same format, selected mode, grounded context and language through $path", async ({ path, question }) => {
    const { ChatService } = await import("../electron/services/chat")
    let capturedSystem = ""
    let capturedQuery = ""
    let capturedTask = ""
    const chat = new ChatService({
      settings: {
        get: () => ({ answerLength: "auto", answerMode: "coding", autoAnswer: path === "always" ? "always" : "questions", projectExperience: "I maintained the export endpoint." }),
        activePrompt: () => DEFAULT_PROMPT
      } as never,
      llm: {
        chat: async (messages: { role: string; content: string }[], onChunk?: (delta: string) => void, task?: string) => {
          capturedSystem = messages[0].content
          capturedTask = task ?? ""
          onChunk?.("This is a complete answer.")
          return { text: "This is a complete answer.", tokens: 1 }
        },
        vision: async (_image: string, _question: string, system: string) => {
          capturedSystem = system
          capturedTask = "vision"
          return { text: "This is a complete answer.", tokens: 1 }
        },
        languageInstruction: () => "Respond in English."
      } as never,
      session: {
        transcriptText: () => `${"old meeting context ".repeat(500)}Most recent discussion: invoice exports.`,
        getLastUtterance: () => ({ text: question })
      } as never,
      capture: async () => ({ base64: "fixture", width: 10, height: 10 }) as never,
      projectContext: async (query) => {
        capturedQuery = query
        return "src/export.ts: exportInvoices validates the invoice identifier."
      }
    })
    if (path === "chat") await chat.send(question)
    else if (path === "answer") await chat.answerLast()
    else if (path === "screenshot") await chat.screenshot(question)
    else await chat.autoAnswer({ text: question, channel: "them", speaker: null, timestamp: 0 })

    expect(capturedSystem).toContain(ANSWER_FORMAT)
    expect(capturedSystem).toContain("complete, grammatically correct sentences")
    expect(capturedSystem).toContain(ANSWER_MODES.coding.instruction)
    expect(capturedSystem).toContain("src/export.ts: exportInvoices")
    expect(capturedSystem).toContain("I maintained the export endpoint.")
    expect(capturedSystem).toContain("Respond in English.")
    expect(capturedQuery).toContain(question)
    expect(capturedQuery).toContain("Most recent discussion: invoice exports.")
    expect(capturedQuery.length).toBeLessThan(6500)
    expect(capturedTask).toBe(path === "screenshot" ? "vision" : path === "questions" ? "auto" : "answer")
  })

  it("answers with an explicit context notice when project retrieval fails", async () => {
    const { ChatService } = await import("../electron/services/chat")
    let system = ""
    const chat = new ChatService({
      settings: { get: () => ({ answerLength: "auto" }), activePrompt: () => DEFAULT_PROMPT } as never,
      llm: {
        languageInstruction: () => "L",
        chat: async (messages: { content: string }[]) => { system = messages[0].content; return { text: "I cannot verify the project details.", tokens: 1 } }
      } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never,
      projectContext: async () => { throw new Error("fixture missing folder") }
    })
    await chat.send("What does my project do?")
    expect(system).toContain("Project context is unavailable")
    expect(system).not.toContain("fixture missing folder")
    expect(chat.getHistory().at(-1)?.kind).toBe("text")
  })

  it("keeps user actions busy while project context loads", async () => {
    const { ChatService } = await import("../electron/services/chat")
    let finishContext!: (context: string) => void
    let requests = 0
    const chat = new ChatService({
      settings: { get: () => ({ answerLength: "auto" }), activePrompt: () => DEFAULT_PROMPT } as never,
      llm: { languageInstruction: () => "L", chat: async () => { requests++; return { text: "An answer.", tokens: 1 } } } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never,
      projectContext: () => new Promise((resolve) => { finishContext = resolve })
    })
    const first = chat.send("Explain the project.")
    expect(chat.isBusy).toBe(true)
    expect(finishContext).toBeTypeOf("function")
    await chat.send("A second question.")
    finishContext("Project reference.")
    await first
    expect(requests).toBe(1)
    expect(chat.isBusy).toBe(false)
  })

  it.each(["remove", "disable", "replace", "role"])("discards stale evidence when prepared projects change through %s during retrieval", async (change) => {
    const { ChatService } = await import("../electron/services/chat")
    const project = { id: "a", name: "Atlas", folder: "C:\\project-a", experience: "I maintained project A.", enabled: true }
    let settings = { answerLength: "auto", answerMode: "coding", projects: [project] }
    let finishContext!: (context: string) => void
    let system = ""
    const chat = new ChatService({
      settings: { get: () => settings, activePrompt: () => DEFAULT_PROMPT } as never,
      llm: {
        languageInstruction: () => "L",
        chat: async (messages: { content: string }[]) => { system = messages[0].content; return { text: "An answer.", tokens: 1 } }
      } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never,
      projectContext: () => new Promise((resolve) => { finishContext = resolve })
    })
    const answer = chat.send("Explain the selected project.")
    expect(finishContext).toBeTypeOf("function")
    settings = { ...settings, projects: change === "remove" ? [] : [{ ...project,
      ...(change === "disable" ? { enabled: false } : {}),
      ...(change === "replace" ? { id: "b", name: "Beacon", folder: "C:\\project-b" } : {}),
      ...(change === "role" ? { experience: "I only reviewed this project." } : {})
    }] }
    finishContext("PROJECT_A_SOURCE_ONLY: src/api.ts uses a legacy queue.")
    await answer
    expect(system).not.toContain("PROJECT_A_SOURCE_ONLY")
    expect(system).not.toContain("I maintained project A.")
    expect(system).toContain("Project context is unavailable")
    expect(system).toContain("project selection changed")
  })

  it("includes recent project conversation in retrieval for a follow-up question", async () => {
    const { ChatService } = await import("../electron/services/chat")
    const queries: string[] = []
    const chat = new ChatService({
      settings: { get: () => ({ answerLength: "auto", projects: [] }), activePrompt: () => DEFAULT_PROMPT } as never,
      llm: { languageInstruction: () => "L", chat: async () => ({ text: "Atlas handles authentication in its API service.", tokens: 1 }) } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never,
      projectContext: async (query) => { queries.push(query); return "Prepared project references." }
    })
    await chat.send("Explain authentication in Atlas.")
    await chat.send("And how are its sessions stored?")
    expect(queries[1]).toMatch(/^And how are its sessions stored\?/)
    expect(queries[1]).toContain("Explain authentication in Atlas.")
    expect(queries[1]).toContain("Recent conversation")
  })
})

describe("formatTranscript", () => {
  const seg = (text: string, speaker: number | null) => ({ text, timestamp: 0, confidence: 1, speaker })
  it("joins plain segments with spaces when there is no diarization", () => {
    expect(formatTranscript([seg("hello", null), seg("world", null)])).toBe("hello world")
  })
  it("labels speaker changes and merges consecutive turns", () => {
    const out = formatTranscript([seg("hi", 0), seg("there", 0), seg("hello", 1), seg("back", 0)])
    expect(out).toBe("Speaker 1: hi there\nSpeaker 2: hello\nSpeaker 1: back")
  })
})

describe("ChatService priorities", () => {
  it("a screen analysis is not blocked by an auto-answer check still deciding", async () => {
    const { ChatService, SKIP_TOKEN } = await import("../electron/services/chat")
    const { DEFAULT_PROMPT } = await import("../shared/types")
    let finishCheck: (() => void) | null = null
    let startCheck!: () => void
    const checkStarted = new Promise<void>((resolve) => { startCheck = resolve })
    const llm = {
      // The auto-answer check streams nothing for a while, then declines.
      chat: (_m: unknown, onChunk?: (d: string) => void) =>
        new Promise<{ text: string }>((resolve) => {
          startCheck()
          finishCheck = () => {
            onChunk?.(SKIP_TOKEN)
            resolve({ text: SKIP_TOKEN })
          }
        }),
      vision: async () => ({ text: "A code editor with a failing test.", tokens: 10 }),
      languageInstruction: () => ""
    }
    const chat = new ChatService({
      settings: { get: () => ({ autoAnswer: "questions", answerLength: "auto" }), activePrompt: () => DEFAULT_PROMPT } as never,
      llm: llm as never,
      session: { transcriptText: () => "", getLastUtterance: () => null } as never,
      capture: async () => ({ base64: "x", width: 10, height: 10 }) as never
    })
    const check = chat.autoAnswer({ text: "We moved the standup to Thursday.", speaker: null, channel: "them", timestamp: Date.now() })
    await checkStarted
    const shot = await chat.screenshot()
    expect(shot.text).toContain("code editor")
    finishCheck!()
    await check
    const kinds = chat.getHistory().map((m) => m.kind)
    expect(kinds).toEqual(["screenshot"])
  })

  it("never auto-answers the user's own microphone", async () => {
    const { ChatService } = await import("../electron/services/chat")
    let calls = 0
    const chat = new ChatService({
      settings: { get: () => ({ autoAnswer: "always", answerLength: "auto" }) } as never,
      llm: { chat: async () => { calls++; return { text: "x" } } } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never
    })
    await chat.autoAnswer({ text: "What is Kafka, I would say it is a log", speaker: null, channel: "you", timestamp: Date.now() })
    expect(calls).toBe(0)
  })
  it("asks nothing when the plan has no auto-answer (Free)", async () => {
    const { ChatService } = await import("../electron/services/chat")
    let calls = 0
    let allowed = false
    const chat = new ChatService({
      settings: { get: () => ({ autoAnswer: "questions", answerLength: "auto" }), activePrompt: () => DEFAULT_PROMPT } as never,
      llm: { chat: async () => { calls++; return { text: SKIP_TOKEN } }, languageInstruction: () => "" } as never,
      session: { transcriptText: () => "" } as never,
      capture: async () => ({}) as never,
      canAutoAnswer: () => allowed
    })
    const heard = { text: "So, what is Kafka used for?", speaker: null, channel: "them" as const, timestamp: Date.now() }
    await chat.autoAnswer(heard)
    expect(calls).toBe(0)
    allowed = true
    await chat.autoAnswer(heard)
    expect(calls).toBe(1)
  })
})
