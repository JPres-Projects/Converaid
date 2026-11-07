import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { SimulationService } from "../electron/services/simulation"
import type { ChatMessage, TranscriptEvent } from "../shared/types"

class SpeechSocket extends EventEmitter {
  isOpen = false
  closed = false
  stereo = true
  manual = false
  release: (() => void) | null = null
  audio: ArrayBuffer[] = []
  async connect(): Promise<void> {
    if (this.manual) await new Promise<void>((resolve) => { this.release = resolve })
    this.isOpen = true
  }
  sendAudio(audio: ArrayBuffer): void { this.audio.push(audio) }
  close(): void { this.closed = true; this.isOpen = false }
  say(text: string, options: Partial<TranscriptEvent> = {}): void {
    this.emit("transcript", { text, isFinal: true, speechFinal: true, confidence: 1, speaker: null, channel: "you", ...options })
  }
}

function setup(options: { manual?: boolean; allowed?: boolean } = {}) {
  let elapsed = 100
  let sequence = 0
  let reply: (text: string) => Promise<void>
  const chat = Object.assign(new EventEmitter(), {
    send: vi.fn(async (text: string) => reply(text)),
    clear: vi.fn(),
    isBusy: false
  })
  const socket = new SpeechSocket()
  socket.manual = options.manual ?? false
  const service = new SimulationService({
    settings: { get: () => ({ audioLanguage: "de", outputLanguage: "en" }) } as never,
    chat: chat as never,
    createSocket: () => socket,
    canListen: () => options.allowed !== false,
    now: () => elapsed
  })
  reply = async () => {
    const id = `reply-${++sequence}`
    elapsed += 32
    chat.emit("chunk", { id, text: "" })
    elapsed += 18
    chat.emit("chunk", { id, text: "A grounded " })
    elapsed += 80
    chat.emit("chunk", { id, text: "answer." })
    const message: ChatMessage = { id, role: "assistant", kind: "text", text: "A grounded answer.", timestamp: Date.now() }
    chat.emit("message", message)
  }
  return { service, chat, socket, setReply: (next: typeof reply) => { reply = next }, advance: (ms: number) => { elapsed += ms } }
}

describe("isolated interview simulation", () => {
  it("records candidate turns as context without asking the model", async () => {
    const { service, chat } = setup()
    service.setRole("candidate")
    await service.send("I built the API.")
    expect(chat.send).not.toHaveBeenCalled()
    expect(service.getState().turns).toEqual([expect.objectContaining({ role: "candidate", text: "I built the API.", status: "complete", firstTokenMs: null, totalMs: null })])
    expect(service.transcriptText()).toContain("Candidate: I built the API.")
    expect(service.getLastUtterance()?.text).toBe("I built the API.")
  })

  it("answers an interviewer turn once and measures first nonempty output and completion", async () => {
    const { service, chat } = setup()
    await service.send("What did you build?")
    expect(chat.send).toHaveBeenCalledExactlyOnceWith("What did you build?")
    expect(service.getState()).toMatchObject({ busy: false, turns: [
      { role: "interviewer", text: "What did you build?", status: "complete" },
      { role: "assistant", text: "A grounded answer.", status: "complete", firstTokenMs: 50, totalMs: 130 }
    ] })
  })

  it("keeps candidate context when the input role changes", async () => {
    const { service, chat } = setup()
    service.setRole("candidate")
    await service.send("I owned deployment.")
    service.setRole("interviewer")
    await service.send("How did you deploy it?")
    expect(chat.clear).not.toHaveBeenCalled()
    expect(service.transcriptText()).toContain("Candidate: I owned deployment.")
    expect(service.getState().turns.map((turn) => turn.role)).toEqual(["candidate", "interviewer", "assistant"])
  })

  it("records model errors without reporting a successful completed answer", async () => {
    const { service, chat, setReply, advance } = setup()
    setReply(async () => {
      advance(90)
      chat.emit("message", { id: "failure", role: "assistant", kind: "error", text: "Daily answer limit reached.", timestamp: Date.now() })
    })
    await service.send("Explain the service.")
    expect(service.getState().turns.at(-1)).toMatchObject({ status: "error", text: "Daily answer limit reached.", firstTokenMs: null, totalMs: 90 })
    expect(service.getState().busy).toBe(false)
  })

  it("recognizes standalone English and German role commands locally while continuing to listen", async () => {
    const { service, socket, chat } = setup()
    await service.setListening(true)
    socket.say("Now I am the candidate.")
    expect(service.getState()).toMatchObject({ role: "candidate", listening: true, turns: [] })
    socket.say("Jetzt bin ich der Interviewer.")
    expect(service.getState()).toMatchObject({ role: "interviewer", listening: true, turns: [] })
    expect(chat.send).not.toHaveBeenCalled()
    expect(socket.closed).toBe(false)
  })

  it("discards pending speech and late finals when the role changes through the UI", async () => {
    const { service, socket, chat } = setup()
    service.setRole("candidate")
    await service.setListening(true)
    socket.say("I handled deployment", { speechFinal: false })
    expect(service.getState().interim).toBe("I handled deployment")
    service.setRole("interviewer")
    socket.say("and integration tests.")
    await Promise.resolve()
    expect(service.getState()).toMatchObject({ role: "interviewer", listening: false, voiceConnected: false, interim: "", turns: [] })
    expect(socket.closed).toBe(true)
    expect(chat.send).not.toHaveBeenCalled()
  })

  it("combines microphone finals, ignores system audio, and stops before answering", async () => {
    const { service, socket, chat, setReply } = setup()
    setReply(async () => { expect(socket.closed).toBe(true) })
    await service.setListening(true)
    socket.say("A remote question", { channel: "them" })
    socket.say("How did", { speechFinal: false })
    socket.say("you test it?")
    await Promise.resolve()
    await Promise.resolve()
    expect(chat.send).toHaveBeenCalledExactlyOnceWith("How did you test it?")
    expect(service.getState()).toMatchObject({ listening: false, voiceConnected: false, interim: "" })
  })

  it("adds a spoken candidate turn without paying for a reply", async () => {
    const { service, socket, chat } = setup()
    service.setRole("candidate")
    await service.setListening(true)
    socket.say("I wrote integration tests.")
    await Promise.resolve()
    expect(service.getState().turns).toHaveLength(1)
    expect(service.getState().turns[0].role).toBe("candidate")
    expect(chat.send).not.toHaveBeenCalled()
    expect(socket.closed).toBe(true)
  })

  it("refuses microphone access while a live meeting owns audio", async () => {
    const { service, socket } = setup({ allowed: false })
    await expect(service.setListening(true)).rejects.toThrow(/meeting/i)
    expect(service.getState()).toMatchObject({ listening: false, voiceConnected: false })
    expect(socket.isOpen).toBe(false)
  })

  it("ignores late events when microphone startup was canceled", async () => {
    const { service, socket, chat } = setup({ manual: true })
    const opening = service.setListening(true)
    await service.setListening(false)
    socket.release?.()
    await opening
    socket.say("An obsolete question")
    expect(socket.closed).toBe(true)
    expect(chat.send).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({ listening: false, voiceConnected: false, turns: [] })
  })

  it("clears idle context but refuses to clear an answer in progress", async () => {
    const { service, chat, setReply } = setup()
    service.setRole("candidate")
    await service.send("An earlier candidate answer.")
    service.clear()
    expect(service.transcriptText()).toBe("")
    expect(chat.clear).toHaveBeenCalledOnce()
    let complete!: () => void
    setReply(() => new Promise<void>((resolve) => { complete = resolve }))
    service.setRole("interviewer")
    const answer = service.send("A pending question")
    expect(() => service.clear()).toThrow(/finish/i)
    complete()
    await answer
  })

  it("bounds submitted text and transcript context and sends audio only while connected", async () => {
    const { service, socket } = setup()
    await expect(service.send("x".repeat(20_001))).rejects.toThrow(/text/i)
    service.setRole("candidate")
    for (let i = 0; i < 4; i++) await service.send(`${i}: ${"e".repeat(4000)}`)
    expect(service.transcriptText().length).toBeLessThanOrEqual(8000)
    const audio = new ArrayBuffer(320)
    service.sendAudio(audio)
    expect(socket.audio).toHaveLength(0)
    await service.setListening(true)
    service.sendAudio(audio)
    expect(socket.audio).toHaveLength(1)
    expect(() => service.sendAudio(new ArrayBuffer(262_148))).toThrow(/audio/i)
  })
})
