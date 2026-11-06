# Prepared interview projects

Converaid can prepare several local projects before an interview and use their architecture, relationships and relevant source files while answering. Preparation reads existing Understand Anything maps; it never creates a new map or calls an AI provider.

## Usage

1. Open Settings and choose Meeting, Interview or Coding under Answer mode.
2. Add project folders and select the projects for the conversation.
3. Open each project's Details and record the user's actual contributions and experience.
4. Click Prepare. Ready projects have a local briefing; Limited knowledge means only available documentation was found. Detailed preparation notices explain unavailable or changed evidence.
5. Ask questions normally. Follow-up questions use recent conversation context; a newly named project takes priority over older topics.

Prepare again after changing a project or its map, and after restarting the app. This explicitly refreshes all selected snapshots. Routine questions reuse prepared memory and read only a small set of relevant source files.

## Evidence and limits

- Supported map paths: `.ua/knowledge-graph.json` and `.understand-anything/knowledge-graph.json`.
- Briefings include purpose, frontend, backend, storage, documented relationships, layers and a reading tour when present. Missing facts remain unknown.
- Preparation checks the map's Git commit and project-scoped committed, staged, unstaged and untracked changes. Changed-node summaries are withheld. This is a preparation-time check; current targeted source excerpts confirm requested implementation details.
- Map changes invalidate cached evidence. Removing, disabling or refreshing a project invalidates in-flight reads. Confirmed roles remain associated with their own project.
- Index bounds: 5 MB map, 3,000 nodes, 12,000 edges. The combined project prompt is bounded to 32,000 characters. All selected projects receive a briefing; detailed evidence is selected for up to three matching projects, with live source text reserved space before map details.
- Project paths and role notes are stored locally. Prepared evidence remains in memory and stays out of account sync. Selected evidence and role notes accompany normal answers to the configured provider.
- The file reader rejects traversal, linked paths, hidden and sensitive files, ignored files, nested repositories, binary content and detected secrets. Project contents are reference data, never instructions or proof of personal authorship.

## Verification on 2026-11-05

The complete application suite passed: 204 tests, with one existing skipped test. Integration tests prepare actual fixture repositories and verify the same grounded context through chat, manual answers, both automatic answer paths and screenshots. Follow-up questions read changed source without rereading the map or enumerating directories. Other tests cover migration, IPC permissions, local-only settings, cache races, map changes, explicit preparation refresh and bounded context.

Type checking and production builds passed. The actual Electron Chromium renderer completed functional checks for multi-project selection, role saving before Prepare, ready/limited status, removal, custom selector keyboard/mouse interaction, margins and overflow at 1440 and 390 CSS pixels. The six resulting overview, briefing and open-menu screenshots were visually inspected.

Performance sample: a synthetic map with 3,000 nodes referencing three source files prepared in 1,120 ms. Across 30 cached searches, median search time was 27.19 ms and p95 was 47.49 ms. These numbers measure local preparation/search on this machine, not end-to-end answer latency; source access, network and model generation add time. No paid model request was used for verification.

Final verification also passed: 21 targeted architecture and integration checks, a fresh typecheck and production build, and the Electron `project-ui` smoke with `ok: true` and no errors. The final renderer screenshots were inspected at both widths. Windows fixture cleanup now handles read-only Git objects. The memory guard temporarily blocked verification, then released it when free memory recovered; no user applications were closed. Two earlier disposable smoke fixtures remain in the system temporary directory; their manual recursive cleanup was blocked by tool policy.
