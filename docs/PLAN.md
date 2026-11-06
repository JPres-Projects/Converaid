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

## Prepared interview projects

The user clarified that interview answers must draw on a prepared understanding of several projects, like a senior developer onboarding a junior. Existing Understand Anything maps supply purpose, architecture, layers, walkthroughs and relationships. Preparation happens before the interview; each answer receives compact project briefings and locally selected evidence without rescanning repositories.

- [x] 6. Load existing `.ua/knowledge-graph.json` and legacy maps into a bounded in-memory search index. Assemble source-backed architecture briefings, inspect Git freshness, and retain a clearly limited documentation fallback for projects without a map. Verify graph relationships, multilingual technical queries, outdated sources and path boundaries.
- [x] 7. Replace the single folder with locally persisted projects, each with a name, confirmed role and interview inclusion switch. Migrate the previous selection. Add native multi-folder selection, preparation state, stale-cache handling and removal. Verify IPC and account-sync boundaries.
- [x] 8. Supply briefings for selected projects plus relevant graph relationships and targeted source excerpts to every answer route. Preserve question context across follow-ups and discard results if project selection changes. Verify cross-project separation and no per-answer directory scans.
- [x] 9. Add a simple Projects list with Add projects, inclusion switches, role notes, Prepare and readable readiness/errors. Inspect the actual renderer at 1440px and 390px.
- [x] 10. Run the complete relevant tests, typecheck, build, Electron smoke, independent review and a measured local retrieval benchmark. Report preparation time separately from cached retrieval and make no unmeasured model-latency claim.

Preparation uses existing map summaries and local indexing, with no additional paid model calls or automatic map generation. Only referenced files need live reads; a changed map must be prepared again. Runtime prepared data stays in memory; project configuration persists locally.

## Local prompts and interview simulation

Design: docs/simulation-design.md. The user has specified the behavior; routine implementation choices are resolved without another approval gate.

- [x] 11. Add bounded local prompt editing/selection and optional project descriptions; verify settings/IPC/context regression tests.
- [x] 12. Add an isolated simulation service using existing chat/project composition and local microphone transcription; verify role commands, candidate context, one response per interviewer turn, timing, lifecycle and errors.
- [x] 13. Add the Simulation tab, microphone/role controls, transcript and timing, and show the toolbar in the Windows taskbar; verify typecheck and UI integration.
- [x] 14. Verify all changed behavior with fake providers, run the appropriate suite/build, and inspect actual renderer screenshots at 1440/390 pixels.
- [x] 15. Commit/push the verified changes, build a portable Windows version, and update the laptop Desktop shortcut; verify the delivered artifact and report any required manual launch precisely.
- [x] 16. Add verified OpenRouter Claude Sonnet 5.5 / Haiku 5.5 presets and Standard/Nitro routing while preserving manual model entry; verify helpers, provider boundaries and responsive selection controls.
- [x] 17. Generate and integrate an original Converaid logo into application/tray/Windows icon assets; inspect the generated mark and final packaged interface. Confirm the taskbar entry appears automatically when the toolbar opens.
- [x] 18. Brand the floating toolbar and panel header as Converaid using the generated mark, coherent sky-blue accents and readable grouped controls; verify functionality and 1440/390 layouts without changing profile identity.

- [x] 19. Review DeepMind (ExtractMiningStocksData) and AWG maps, current source and bounded Git history; identify verifiable architecture, languages, integration boundaries, challenges and concrete test mechanics without assuming personal authorship.
- [x] 20. Write compact local INTERVIEW.md references for those two projects and a reusable role-specific preparation prompt; cite code and commits, distinguish current facts from historical fixes and unknown personal responsibility.
- [x] 21. Include safe prewritten interview references in selected-project preparation, with bounded cached context and freshness checks; verify map, no-map, ignored/unsafe and changed-reference cases.
- [x] 22. Verify the appropriate unit suite, typecheck/build and a preparation run against the two actual selected projects; update CONV-1 evidence and report the usable briefings and remaining release limitations.

- [x] 23. Audit the supplied simulation answer and a small portfolio shortlist using actual source and Git provenance; select presentable Python and compiled-language examples, excluding unchanged forks and dependency-only languages.
- [x] 24. Record short language-to-component examples from the curated shortlist; avoid full project pitches, forced language coverage, inferred proficiency or individual authorship.
- [x] 25. Strengthen shared spoken-answer guidance against editorial placeholders, filler and invented personal challenge rankings; separate map language metadata from frameworks/runtimes and verify focused regression tests.
- [x] 26. Verify the complete relevant suite, typecheck/build and actual prepared portfolio context, including active-project isolation, bounds and preserved custom prompts; report model-behavior limits honestly.
- [x] 27. Build and deliver the Windows update and short language references to the laptop, preserving the existing installation, settings and any running practice; verify hashes and the small project selection.

## November 6 transcript and language clarification

- [x] Read the private Micro-One transcript, reconstruct the question sequence and save a private reading copy without altering the original.
- [x] Record the latest language clarification in CONV-D1 and verify that the installed laptop profile has no fixed proficiency ranking.
- [x] Complete the product brief and classify inherited code in the feature ledger, then verify the metadata and linked tests.

## November 6 - personal interview language prompt

- [x] Record the approved interview focus in CONV-D2 and verify the Python example against application source.
- [x] Prepare a compact personal prompt section without changing global application defaults.
- [x] Apply the section to the relevant saved personal prompts while preserving other settings and custom text.
- [x] Verify saved content, limits, idempotence and the existing prompt-assembly path without a paid model call.


## November 6 - prepared personal and project follow-ups

- [x] Capture the confirmed identity and preparation requirements in CONV-D3 without putting personal prompt payloads into this repository.
- [x] Verify concise challenge, solution and test examples for every reviewed language.
- [x] Stage personal background and compact prepared answer cards as private prompt data.
- [x] Update the stopped laptop profile atomically and verify preservation, bounds and idempotence.

## November 6 - obsolete delivery cleanup

- [x] Inventory current and obsolete Converaid deliverables and shortcut targets.
- [x] Repair desktop launch targets before removing obsolete portable builds.
- [x] Delete only verified obsolete builds, stale delivery proofs and redundant setup copies within named delivery roots.
- [x] Verify the current installer, installed application, shortcuts and preserved private interview data.

## Preparation delivery, 2026-11-06
- [x] Preserve partial changes and integrate taskbar commit 32209f1.
- [x] Prove failing regressions; implement validated session-only context and trusted Start.
- [x] Add editable responsive Preparation and connect all answer paths.
- [x] Verify tests, typechecks, renderer screenshots and production NSIS.
- [ ] Preserve private profile, install, prove quit/relaunch reset and deliver hashes.
