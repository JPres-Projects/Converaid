/** The role of the user's next simulation input. Candidate statements provide context only. */
export type SimulationRole = "interviewer" | "candidate"

export interface SimulationTurn {
  id: string
  role: SimulationRole | "assistant"
  text: string
  timestamp: number
  firstTokenMs: number | null
  totalMs: number | null
  status: "complete" | "streaming" | "error"
}

export interface SimulationState {
  role: SimulationRole
  turns: SimulationTurn[]
  busy: boolean
  listening: boolean
  voiceConnected: boolean
  interim: string
  notice: string | null
}
