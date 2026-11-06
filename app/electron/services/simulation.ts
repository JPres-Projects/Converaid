import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import type { SimulationRole, SimulationState, SimulationTurn } from "../../shared/simulation"
import type { ChatChunk, ChatMessage, TranscriptEvent, Utterance } from "../../shared/types"
import type { ChatService } from "./chat"
import type { TranscriptionSocket } from "./session"
import type { SettingsStore } from "./settings"

interface Deps {
  settings: Pick<SettingsStore, "get">
  chat: Pick<ChatService, "send" | "clear" | "on" | "isBusy">
  /** Always a dedicated local socket, independent of the live meeting's transcription engine. */
  createSocket: () => TranscriptionSocket
  canListen: () => boolean
  now?: () => number
}

const MAX_TURNS = 60
const TRANSCRIPT_CHARS = 8000
const MAX_TEXT_CHARS = 20_000
const MAX_AUDIO_BYTES = 256 * 1024

/** Accept commands only when the entire utterance changes the input role. */
function spokenRole(text: string): SimulationRole | null {
  const command = text.toLowerCase().replace(/[.!?]+$/u, "").replace(/\s+/gu, " ").trim()
  const english = /^(?:now i am|i am now|now i'm|i'm now) (?:the |an? )?(interviewer|candidate)$/u.exec(command)
  if (english) return english[1] as SimulationRole
  const german = /^(?:jetzt bin ich|ich bin jetzt) (?:der |die |ein |eine )?(interviewer(?:in)?|kandidat(?:in)?|bewerber(?:in)?)$/u.exec(command)
  return german ? german[1].startsWith("interviewer") ? "interviewer" : "candidate" : null
}

/** An interview scratchpad with its own chat, local microphone socket and response timings. */
export class SimulationService extends EventEmitter {
  private role: SimulationRole = "interviewer"
  private turns: SimulationTurn[] = []
  private busy = false
  private listening = false
  private voiceConnected = false
  private interim = ""
  private notice: string | null = null
  private socket: TranscriptionSocket | null = null
  private listenGeneration = 0
  private pendingVoice = ""
  private lastUtterance: Utterance | null = null
  private answer: { startedAt: number; turn: SimulationTurn; finished: boolean } | null = null
  private readonly now: () => number

  constructor(private readonly deps: Deps) {
    super()
    this.now = deps.now ?? (() => performance.now())
    deps.chat.on("chunk", (chunk: ChatChunk) => this.onChunk(chunk))
    deps.chat.on("message", (message: ChatMessage) => {
      if (message.role === "assistant") this.finishAnswer(message.text, message.kind === "error", message.id)
    })
  }

  getState(): SimulationState {
    return { role: this.role, turns: this.turns.map((turn) => ({ ...turn })), busy: this.busy,
      listening: this.listening, voiceConnected: this.voiceConnected, interim: this.interim, notice: this.notice }
  }

  setRole(role: SimulationRole): SimulationState {
    if (role !== "interviewer" && role !== "candidate") throw new Error("Invalid simulation role")
    this.stopListening()
    return this.applyRole(role)
  }

  private applyRole(role: SimulationRole): SimulationState {
    this.role = role
    this.emitState()
    return this.getState()
  }

  async send(text: string): Promise<void> {
    if (typeof text !== "string" || text.length > MAX_TEXT_CHARS || text.includes("\0")) throw new Error("Simulation text must contain at most 20000 characters")
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.busy || this.deps.chat.isBusy) throw new Error("Wait for the current answer to finish.")
    const role = this.role
    this.stopListening()
    this.notice = null
    this.lastUtterance = { text: trimmed, speaker: null, channel: "you", timestamp: Date.now() }
    this.turns.push(this.turn(role, trimmed))
    if (role === "candidate") {
      this.limitTurns()
      this.emitState()
      return
    }
    const turn = this.turn("assistant", "")
    turn.status = "streaming"
    this.turns.push(turn)
    this.limitTurns()
    this.busy = true
    this.answer = { startedAt: this.now(), turn, finished: false }
    this.emitState()
    try {
      // Reuse the existing provider route, project retrieval and account limits.
      await this.deps.chat.send(trimmed)
      if (!this.answer?.finished) this.finishAnswer("The model returned no answer.", true)
    } catch (err) {
      this.finishAnswer(err instanceof Error ? err.message : String(err), true)
    } finally {
      this.answer = null
      this.busy = false
      this.emitState()
    }
  }

  /** Candidate statements reach the same project lookup and answer prompt as earlier questions. */
  transcriptText(): string {
    return this.turns.filter((turn) => turn.status === "complete" && turn.text)
      .map((turn) => `${turn.role === "interviewer" ? "Interviewer" : turn.role === "candidate" ? "Candidate" : "Assistant"}: ${turn.text}`)
      .join("\n").slice(-TRANSCRIPT_CHARS)
  }

  getLastUtterance(): Utterance | null {
    return this.lastUtterance ? { ...this.lastUtterance } : null
  }

  clear(): SimulationState {
    if (this.busy || this.deps.chat.isBusy) throw new Error("Wait for the current answer to finish.")
    this.stopListening()
    this.turns = []
    this.lastUtterance = null
    this.notice = null
    this.deps.chat.clear()
    this.emitState()
    return this.getState()
  }

  async setListening(enabled: boolean): Promise<SimulationState> {
    if (typeof enabled !== "boolean") throw new Error("Invalid simulation listening value")
    if (!enabled) {
      this.stopListening()
      this.emitState()
      return this.getState()
    }
    if (this.listening) return this.getState()
    if (this.busy) throw new Error("Wait for the current answer to finish.")
    if (!this.deps.canListen()) throw new Error("Finish the live meeting before using the simulation microphone.")
    const generation = ++this.listenGeneration
    const socket = this.deps.createSocket()
    this.socket = socket
    this.listening = true
    this.voiceConnected = false
    this.pendingVoice = ""
    this.interim = ""
    this.notice = null
    let failure: Error | null = null
    const current = () => this.socket === socket && this.listening && generation === this.listenGeneration
    const fail = (error: Error) => {
      if (!current()) return
      failure = error
      this.stopListening()
      this.notice = error.message
      this.emitState()
    }
    socket.on("transcript", (event: TranscriptEvent) => { if (current()) this.onTranscript(event) })
    socket.on("progress", (percent: number) => {
      if (!current()) return
      this.notice = `Downloading the local speech model, ${Math.round(percent)}%. This happens once.`
      this.emitState()
    })
    socket.on("error", (err: Error) => fail(err))
    socket.on("close", (_code: number, reason: string, byUs: boolean) => {
      if (!byUs) fail(new Error(reason || "Microphone transcription stopped. Start the microphone again."))
    })
    this.emitState()
    try {
      await socket.connect()
      if (!current()) {
        this.disposeSocket(socket)
        if (failure) throw failure
        return this.getState()
      }
      if (!this.deps.canListen()) throw new Error("Finish the live meeting before using the simulation microphone.")
      this.voiceConnected = true
      this.notice = null
      this.emitState()
      return this.getState()
    } catch (err) {
      if (current()) {
        this.stopListening()
        this.notice = err instanceof Error ? err.message : String(err)
        this.emitState()
        throw err
      }
      if (failure) throw failure
      return this.getState()
    }
  }

  sendAudio(pcm16: ArrayBuffer): void {
    if (!(pcm16 instanceof ArrayBuffer) || pcm16.byteLength > MAX_AUDIO_BYTES || pcm16.byteLength % 4 !== 0) throw new Error("Invalid simulation audio buffer")
    if (this.listening && this.voiceConnected && this.socket?.isOpen) this.socket.sendAudio(pcm16)
  }

  private onTranscript(event: TranscriptEvent): void {
    if (event.channel !== "you" || !event.text.trim()) return
    if (!event.isFinal) {
      this.interim = [this.pendingVoice, event.text].filter(Boolean).join(" ").slice(0, MAX_TEXT_CHARS)
      this.emitState()
      return
    }
    this.pendingVoice = [this.pendingVoice, event.text.trim()].filter(Boolean).join(" ")
    this.interim = this.pendingVoice.slice(0, MAX_TEXT_CHARS)
    if (this.pendingVoice.length > MAX_TEXT_CHARS) {
      this.stopListening()
      this.notice = "The spoken turn is too long. Enter at most 20000 characters."
      this.emitState()
      return
    }
    if (!event.speechFinal) {
      this.emitState()
      return
    }
    const text = this.pendingVoice
    this.pendingVoice = ""
    this.interim = ""
    const role = spokenRole(text)
    if (role) {
      this.applyRole(role)
      return
    }
    void this.send(text).catch((err: unknown) => {
      this.notice = err instanceof Error ? err.message : String(err)
      this.emitState()
    })
  }

  private stopListening(): void {
    ++this.listenGeneration
    const socket = this.socket
    this.socket = null
    this.listening = false
    this.voiceConnected = false
    this.interim = ""
    this.pendingVoice = ""
    if (socket) this.disposeSocket(socket)
  }

  private disposeSocket(socket: TranscriptionSocket): void {
    socket.removeAllListeners()
    // An already stopping worker may emit a final error after the listening generation changed.
    socket.on("error", () => {})
    socket.close()
  }

  private onChunk(chunk: ChatChunk): void {
    const answer = this.answer
    if (!answer || answer.finished || !chunk.text) return
    answer.turn.id = chunk.id
    answer.turn.firstTokenMs ??= Math.max(0, this.now() - answer.startedAt)
    answer.turn.text += chunk.text
    this.emitState()
  }

  private finishAnswer(text: string, error: boolean, id?: string): void {
    const answer = this.answer
    if (!answer || answer.finished) return
    answer.finished = true
    if (id) answer.turn.id = id
    answer.turn.text = text
    answer.turn.status = error ? "error" : "complete"
    answer.turn.totalMs = Math.max(0, this.now() - answer.startedAt)
    this.emitState()
  }

  private turn(role: SimulationTurn["role"], text: string): SimulationTurn {
    return { id: randomUUID(), role, text, timestamp: Date.now(), firstTokenMs: null, totalMs: null, status: "complete" }
  }

  private limitTurns(): void {
    if (this.turns.length > MAX_TURNS) this.turns = this.turns.slice(-MAX_TURNS)
  }

  private emitState(): void {
    this.emit("state", this.getState())
  }
}
