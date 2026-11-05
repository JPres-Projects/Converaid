# Answer style and project context implementation plan

**Goal:** Implement natural, grounded answers, simple selectable modes and project access.

**Architecture:** Keep the shared generator, routing, streaming and shortcuts. Supply bounded project excerpts from the Electron main process.

**Specification:** `reports/Meetingly_Antwortformat_Implementierungsauftrag.md` and the user's request.

**Constraints:** English repository text; complete sentences; dynamic depth; no invented experience; custom dropdowns; page margins; no paid verification calls.

## Ordered work

- [x] 1. Replace shared/default answer instructions and migrate untouched defaults. Test manual, automatic, chat and screenshot requests.
- [x] 2. Persist and expose simple mode selection. Test normalization and renderer allowlisting.
- [x] 3. Add bounded read-only project context. Test unavailable files, exclusions, symlinks and size limits.
- [x] 4. Integrate controls and custom dropdowns. Inspect the UI at desktop and approximately 390px widths.
- [x] 5. Run all tests, typecheck, build, Electron smoke and independent review. Record evidence in `docs/STATUS.md`.

## Review focus

- Preserve custom prompts and consistent answer routes.
- Code does not establish personal authorship or achievements.
- Project data stays out of account sync; excerpts accompany requested AI answers.
- Unavailable folders and large repositories do not invent context or break answering.
