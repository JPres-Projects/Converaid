# Interview simulation

The simulation lets the user enter interviewer questions by text or microphone and read the same project-aware model answer used by live assistance. Candidate statements are stored as context and never trigger an automatic model call. The role switch changes how the next input is handled and preserves the current conversation.

The simulation owns its history, streaming state, timings, microphone capture and local transcription socket. It uses a separate ChatService instance with the existing Llm and project retrieval service. Its transcript facade labels interviewer, candidate and assistant turns; live meeting transcripts, saved meetings, reports and synchronization are excluded.

Only interviewer submissions call ChatService.send. Timings begin before that call, include project retrieval, record the first nonempty streamed delta and finish on the final assistant message. Failed responses have an explicit error status and do not appear as successful completions. Candidate turns have no response timing.

Microphone input uses the existing stereo PCM16 capture with the microphone source only and a dedicated LocalAsrSocket. The service accepts only the microphone channel, assembles final segments until an utterance boundary, stops microphone listening and submits one turn. Standalone English and German role commands update the role locally and keep listening. Partial transcripts and system audio never trigger a model request. Canceled socket startup and late socket events are ignored.

The live session and simulation do not capture concurrently. Starting a live session stops simulation capture first. Starting simulation microphone capture while a live session owns audio is rejected. Simulation transcription stays local on every account plan and adds no cloud transcription provider.

Renderer requests use the existing trusted IPC frame checks. New channels validate roles, booleans, text up to 20,000 characters and stereo audio buffers up to 256 KiB before forwarding. Full simulation state is broadcast through simulation:changed, independently of the live chat events. Reset is refused while an answer is running.

No new paid API integration or background answer loop is introduced. Interviewer questions use the existing ChatService/Llm routing and provider limits. Tests cover candidate-only context, real chat delegation, timing, streaming errors, role commands, local audio isolation, startup cancellation, bounded input and trusted IPC handling.
