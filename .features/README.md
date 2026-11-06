# Features of Converaid

<!-- Written by the awg-features plugin from .features/items. Change features with its commands (/awg-features, /awg-features-add, /awg-features-test), not in this file. -->

Updated 2026-11-06 at commit 32209f1. 9 features: 1 changed since last test; 1 tests not run; 6 backend tested; 1 in progress. Tested in the backend: 6, in the frontend: 0.

A status comes from the feature's tests, not from anybody's word: **Tested** means every test of the feature passed on the code as it is now; **Changed since last test** means it passed, but its files changed since.

## Where we are

**Product:** Converaid helps a software developer prepare for interviews and explain selected projects clearly, using concise answers grounded in their own project context. The brief: [PRODUCT.md](PRODUCT.md).

**The market:** The immediate niche is personal software-engineering interview preparation and project explanation. The person maintaining this fork is its initial customer; no subscription price or sales plan has been selected. Existing commercial products demonstrate an active category for AI interview preparation and conversation practice: [FinalRound's product guide](https://docs.finalroundai.com/) describes interview preparation, live assistance and review, and [Yoodli's interview preparation page](https://yoodli.ai/use-cases/interview-preparation) offers simulated interviews and feedback. This research establishes the category and alternatives, not the number of potential customers. No independently sourced market-size estimate has been established. The first practical success criterion is whether the current developer can explain a selected project and answer a technical follow-up accurately during rehearsal.

**Competing with:** Meetingly, FinalRound, Yoodli

**Core value**

1. Project answers use the selected, prepared evidence and distinguish project facts, external services and confirmed personal responsibilities. They provide concrete architecture or testing details when the question calls for them.
2. Answers are natural, concise, complete sentences that can be read aloud. The chosen prompt and focus apply consistently, without editing placeholders or invented personal achievements.
3. Rehearsal lets the developer enter either speaker's turn by text or microphone, switch roles, and inspect response timing without mixing practice into the live meeting conversation.

| Scenario | Kind | Status | Tests |
|---|---|---|---|
| CONV-S1 Explain a selected project's architecture and responsibility boundaries | core | Untested | 0 |
| CONV-S2 Answer a language question with one relevant component | core | Untested | 0 |
| CONV-S3 Rehearse typed interview turns and inspect response timing | core | Untested | 0 |
| CONV-S4 Switch rehearsal speakers using the microphone | side | Untested | 0 |
| CONV-S5 Reuse a saved prompt with a different answer focus | side | Untested | 0 |
| CONV-S6 Choose an OpenRouter preset and faster routing | side | Untested | 0 |
| CONV-S7 Open an updated installation with saved configuration intact | side | Untested | 0 |

**Next step:** CONV-S1 Explain a selected project's architecture and responsibility boundaries (core, untested) - no test proves it yet: write its end-to-end test the way the person does it (real systems where that is safe, drafts never sent), with "@scenario CONV-S1" at its top, and run it (/awg-features-test CONV-S1).

## Needs attention

| ID | Feature | Status | Backend | Frontend |
|---|---|---|---|---|
| CONV-2 | Practice interviews with editable system prompts | Changed since last test | changed | untested |
| CONV-4 | Launch Converaid with a distinct desktop identity | Tests not run | not run | untested |

## Still open

Put down by the chat that did the work; closed when a chat says what showed it worked (`open done <ID>`).

| ID | What it is about | Waits for | Will show it worked | From |
|---|---|---|---|---|
| CONV-O1 | Prove the documented Windows product acceptance scenarios end to end | A dedicated Windows acceptance-test pass for the newly documented scenarios. | Each scenario has passing tagged end-to-end evidence on the Windows desktop, with explicit provider stand-ins and no claim about untested real-model answer… | Codex on DESKTOP-KV3OK8I, 2026-11-06 `01a1a978-8210-70f2-86b4-bd5cc8cc499e` |
| CONV-O3 | Apply the privately prepared research context after the interview | The user explicitly releases transfer and application changes after the interviews. | After an explicit release, back up the destination profile and verify the selected preparation includes the reviewed reference and support guidance. | a chat on DESKTOP-KV3OK8I, 2026-11-06 `01a1a978-8210-70f2-86b4-bd5cc8cc499e` |

## Steps not done

The steps a team takes before a feature counts, beside its tests: research what exists, design what a person sees, secure it. Recorded with `step <ID> <step> "what was done"`, or skipped with the reason.

| ID | Feature | Status | Missing |
|---|---|---|---|
| CONV-5 | Record and transcribe conversations | Backend tested | research, design, security |
| CONV-6 | Review saved meetings and reports | Backend tested | research, design, security |
| CONV-7 | Get answers and suggestions during conversations | Backend tested | research, design, security |
| CONV-8 | Use managed accounts and service allowances | Backend tested | research, design, security |

## Open findings

Found wrong and not proven fixed yet. Each stays here until a test that names it (`@finding <ID>`) passes.

| ID | What is wrong | Feature | Severity | Must hold |
|---|---|---|---|---|
| CONV-F2 | The user reports visible PowerShell windows during Converaid-related operation. The source is not yet identified between app startup and remote operator tooling; investigate hidden process launch… | CONV-4 Launch Converaid with a distinct desktop identity | medium | visible |
| CONV-F3 | The user reports that personal-experience follow-ups produce unsupported denials and repeat project overviews already covered in the dialogue, instead of using the separately confirmed experience… | CONV-2 Practice interviews with editable system prompts | medium | visible |
| CONV-F1 | When account linking or billing browser launch fails, the existing Auto-answer action discards the IPC rejection and shows no user-visible error. CloudSync.linkStart and openWeb do not populate… | CONV-4 Launch Converaid with a distinct desktop identity | low | visible |

## Planned and in progress

| ID | Feature | Status | What it is |
|---|---|---|---|
| CONV-9 | Prepare editable job applications before practice | In progress | English translation: I want to enter the role and company or platform myself in a Preparation tab, so the assistant knows which application and required… |

## Accounts and service access

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-8 | Use managed accounts and service allowances | Backend tested | passing | untested | 2026-11-06 feat: add interview practice and prepared project briefings |

## Conversation assistance

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-7 | Get answers and suggestions during conversations | Backend tested | passing | untested | 2026-11-06 fix: ground spoken language answers in reviewed examples |

## Conversation recording

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-5 | Record and transcribe conversations | Backend tested | passing | untested | 2026-11-06 fix: ground spoken language answers in reviewed examples |

## General

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-1 | Prepare selected projects for role-specific interviews | Backend tested | passing | untested | 2026-11-06 fix: ground spoken language answers in reviewed examples |
| CONV-2 | Practice interviews with editable system prompts | Changed since last test | changed | untested | 2026-11-06 fix: keep Windows overlays out of taskbar |
| CONV-3 | Choose a model provider and routing | Backend tested | passing | untested | 2026-11-06 feat: add interview practice and prepared project briefings |
| CONV-4 | Launch Converaid with a distinct desktop identity | Tests not run | not run | untested | 2026-11-06 fix: keep Windows overlays out of taskbar |

## Meeting records

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-6 | Review saved meetings and reports | Backend tested | passing | untested | 2026-11-06 feat: add interview practice and prepared project briefings |

