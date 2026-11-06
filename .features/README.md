# Features of Converaid

<!-- Written by the awg-features plugin from .features/items. Change features with its commands (/awg-features, /awg-features-add, /awg-features-test), not in this file. -->

Updated 2026-11-06 at commit c145803. 4 features: 4 tests not run. Tested in the backend: 0, in the frontend: 0. 62 code files belong to no feature yet.

A status comes from the feature's tests, not from anybody's word: **Tested** means every test of the feature passed on the code as it is now; **Changed since last test** means it passed, but its files changed since.

## Where we are

No product brief yet. `/awg-features-brief` writes `.features/PRODUCT.md`: who this project is for, the core value that must work 100%, and the real cases (value scenarios) whose end-to-end tests say how far it is.

## Needs attention

| ID | Feature | Status | Backend | Frontend |
|---|---|---|---|---|
| CONV-1 | Prepare selected projects for role-specific interviews | Tests not run | not run | untested |
| CONV-2 | Practice interviews with editable system prompts | Tests not run | not run | untested |
| CONV-3 | Choose OpenRouter Claude models and routing | Tests not run | not run | untested |
| CONV-4 | Launch Converaid with a distinct desktop identity | Tests not run | not run | untested |

## Open findings

Found wrong and not proven fixed yet. Each stays here until a test that names it (`@finding <ID>`) passes.

| ID | What is wrong | Feature | Severity | Must hold |
|---|---|---|---|---|
| CONV-F1 | When account linking or billing browser launch fails, the existing Auto-answer action discards the IPC rejection and shows no user-visible error. CloudSync.linkStart and openWeb do not populate… | CONV-4 Launch Converaid with a distinct desktop identity | low | visible |

## General

| ID | Feature | Status | Backend | Frontend | Last change |
|---|---|---|---|---|---|
| CONV-1 | Prepare selected projects for role-specific interviews | Tests not run | not run | untested | 2026-11-06 feat: add interview practice and prepared project briefings |
| CONV-2 | Practice interviews with editable system prompts | Tests not run | not run | untested | 2026-11-06 feat: add interview practice and prepared project briefings |
| CONV-3 | Choose OpenRouter Claude models and routing | Tests not run | not run | untested | 2026-11-06 feat: add interview practice and prepared project briefings |
| CONV-4 | Launch Converaid with a distinct desktop identity | Tests not run | not run | untested | 2026-11-06 feat: add interview practice and prepared project briefings |

## Code that belongs to no feature yet

- `app/electron/asr-worker.ts`
- `app/electron/copy-menu.ts`
- `app/electron/copy.ts`
- `app/electron/mac-updater.ts`
- `app/electron/preload.ts`
- `app/electron/services/asrAudio.ts`
- `app/electron/services/asrModel.ts`
- `app/electron/services/capture.ts`
- `app/electron/services/deepgram.ts`
- `app/electron/services/llm.ts`
- `app/electron/services/localAsr.ts`
- `app/electron/services/logger.ts`
- `app/electron/services/meetings.ts`
- `app/electron/services/ownKey.ts`
- `app/electron/services/plan.ts`
- `app/electron/services/refine.ts`
- `app/electron/services/refineQueue.ts`
- `app/electron/services/relayAuth.ts`
- `app/electron/services/reports.ts`
- `app/electron/services/secretBox.ts`
- `app/electron/services/session.ts`
- `app/electron/services/suggestions.ts`
- `app/electron/services/transcriptFiles.ts`
- `app/electron/shortcuts.ts`
- `app/electron/update-feed.ts`
- `app/electron/windows/config.ts`
- `app/postcss.config.js`
- `app/scripts/fetch-asr-native.mjs`
- `app/scripts/i18n.mjs`
- `app/scripts/i18n_translate.py`
- `app/scripts/publish-release.sh`
- `app/scripts/screenshot.ps1`
- `app/scripts/smoke.mjs`
- `app/shared/cloud.ts`
- `app/shared/i18n/catalogs.ts`
- `app/shared/i18n/index.ts`
- `app/shared/relay.ts`
- `app/src/components/Markdown.tsx`
- `app/src/components/Panel.tsx`
- `app/src/components/ui/badge.tsx`
- `app/src/components/ui/button.tsx`
- `app/src/components/ui/fields.tsx`
- `app/src/index.css`
- `app/src/lib/api.ts`
- `app/src/lib/audio.ts`
- `app/src/lib/capture.ts`
- `app/src/lib/format.ts`
- `app/src/lib/hooks.ts`
- `app/src/lib/markdown.ts`
- `app/src/lib/plain-text.ts`
- and 12 more

