# Interview simulation and local prompt editing

The user wants a small practice environment for trying the actual assistant before an interview. They can supply both interviewer and candidate turns, by typing or microphone, and switch their input role with a button or a spoken command. The assistant continues to help the candidate; it does not generate a second autonomous interviewer.

## Behavior

- Show the toolbar's window in the Windows taskbar. Keep the existing tray and attached panel behavior.
- Edit and select named system prompts directly in Settings. Preserve the shared answer rules: short complete sentences, coherent explanations and useful detail, without bare bullet fragments. Selecting another prompt applies to the next response.
- Add an optional short project description beside each project's confirmed personal role. Only selected projects contribute context; neither description nor role proves undocumented implementation details.
- Add a Simulation tab with Interviewer/Candidate input roles, a text box, microphone control, a bounded conversation and response timing. Interviewer turns request one assistant response. Candidate turns only add labeled context.
- Reuse the configured provider, shared prompt composition and prepared project lookup through a separate ChatService instance. Live meeting history, audio and meeting persistence stay separate.
- Voice uses the existing on-device ASR engine and microphone only. Parse English and German role commands locally. A role command changes the input role without making an AI request. A spoken turn is shown in the conversation; interviewer turns request one answer. Do not start cloud transcription, recording reports or autonomous interview loops.
- Measure request-to-first-text and request-to-completion with a monotonic clock, including project retrieval. State that voice transcription precedes this measurement. Errors must not look like successful answers.
- Stop simulation capture when leaving the tab or starting a live meeting. Reject simultaneous live/simulation capture and stale socket callbacks. Reset must not silently clear an in-flight request.

## Scope and verification

Keep existing custom selectors, English interface strings and page margins. Reuse existing prompt settings/cloud synchronization and local-only project storage. No new provider integration, embeddings, map generation or paid background processing is introduced. Automated verification uses fake providers and fake ASR; real provider keys are not read or changed.

Test prompt persistence and validation, description/role separation, labeled simulation context, role commands, timing, errors and voice lifecycle. Inspect the actual renderer at 1440 and 390 CSS pixels, including prompt controls and simulation. Build a new portable executable from the verified commit and update the laptop's existing Converaid shortcut to that file.
