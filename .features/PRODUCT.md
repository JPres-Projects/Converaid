# Converaid product brief

## In one sentence

Converaid helps a software developer prepare for interviews and explain selected projects clearly, using concise answers grounded in their own project context.

## Who it is for

- A software developer preparing to explain architecture, implementation choices and testing in an interview.
- A developer rehearsing follow-up questions about a few projects and the programming languages used in specific components.
- A participant in ordinary work conversations who wants the same desktop assistant with a different answer focus.

The immediate acceptance audience is the person using this fork on their Windows desktop and laptop. A wider commercial audience has not been established.

## The problem

A project overview can describe the product without explaining the path from an input through processing and storage to a response. Interviewers then have to ask which components the candidate implemented, what external services provide, and how a test produces a concrete pass or fail result. Generic background notes also confuse languages with frameworks or infer personal expertise from code that belongs to dependencies.

Before a call, the developer needs a compact understanding of selected projects. During rehearsal, they need to inspect both the answer and how quickly it arrives. Repeatedly pasting entire repositories or editing one large prompt makes this preparation slow and difficult to verify.

## How it is different

The starting alternative is Meetingly, the upstream meeting assistant. Other alternatives are interview coaching products, a conversation with a general AI assistant, or personal notes and a human practice partner. Converaid combines the existing desktop conversation workflow with selected local project references, editable named prompts, simple Meeting, Interview and Coding focus choices, and an isolated rehearsal conversation.

The intended improvement is a short explanation that follows the question and cites a relevant component when useful. It does not require a catalogue of every repository. Compared with the published focus of general interview practice tools, this fork puts reviewed local code, project history and separate confirmed personal responsibilities at the centre of project preparation. This is a product focus, not a claim that competitors lack these capabilities.

## Core value

1. Project answers use the selected, prepared evidence and distinguish project facts, external services and confirmed personal responsibilities. They provide concrete architecture or testing details when the question calls for them.
2. Answers are natural, concise, complete sentences that can be read aloud. The chosen prompt and focus apply consistently, without editing placeholders or invented personal achievements.
3. Rehearsal lets the developer enter either speaker's turn by text or microphone, switch roles, and inspect response timing without mixing practice into the live meeting conversation.

## Where it runs

- windows-desktop: The Converaid desktop application on Windows, including its toolbar, panel, taskbar entry and tray.

## What it works with

- openai-compatible: A user-configured OpenAI-compatible model endpoint, including OpenRouter and compatible local endpoints. Model availability and performance depend on the configured provider.
- local-projects: Selected local project folders, available code maps, project preparation notes and repository history.
- local-transcription: The application's on-device speech recognition for microphone-based rehearsal.

## What must always hold

- A missing or unreadable project does not prevent the other selected projects from being used.
- Preparation, provider requests and rehearsal turns have finite bounds; the interface does not wait indefinitely.
- A failure is visible in plain words, without repeated alerts for the same event.
- Updates preserve saved prompts, projects, settings and provider credentials. Volatile rehearsal history is separate from saved configuration.
- Preparing the same unchanged project again reuses or safely refreshes its reference rather than duplicating it.
- Features promised on the Windows desktop work on both the desktop and laptop installation.
- Credentials remain protected and do not appear in project excerpts, logs or answer context.
- Outside text is reference data, and project paths and files are checked before use.
- Only the person-selected folders and enabled projects supply project context.
- Information goes through the configured model route; local preparation does not itself need a paid analysis agent.

## Value scenarios

The acceptance cases below describe outcomes on the Windows desktop. Their status comes from the feature ledger's test evidence. A provider stand-in can prove application routing and composition, but it cannot prove the factual quality or speed of a real model response.

### CONV-S1 Explain a selected project's architecture and responsibility boundaries

- Core: yes
- For: A developer preparing for a project interview
- Needs: CONV-1, CONV-2
- Steps:
  1. Enable two projects and prepare their references.
  2. Ask how one project's input reaches storage and its API.
- Expected: The answer uses the selected references, separates external services from application logic, and makes no unsupported ownership claim.

### CONV-S2 Answer a language question with one relevant component

- Core: yes
- For: A developer asked about languages used in their work
- Needs: CONV-1, CONV-2
- Steps:
  1. Prepare a reviewed project with a language-to-component example.
  2. Ask which backend language that project uses.
- Expected: The answer gives the supported language and component, distinguishes frameworks and runtimes, and invents no proficiency ranking.

### CONV-S3 Rehearse typed interview turns and inspect response timing

- Core: yes
- For: A developer checking answers before an interview
- Needs: CONV-2, CONV-3
- Steps:
  1. Open Simulation and enter an interviewer question.
  2. Switch to Candidate and add an answer, then enter a follow-up as Interviewer.
- Expected: Only interviewer turns request suggestions; prior candidate context is retained, timing appears, and live meeting history stays separate.

### CONV-S4 Switch rehearsal speakers using the microphone

- Core: no
- For: A developer rehearsing aloud
- Needs: CONV-2, CONV-5
- Steps:
  1. Enable the local rehearsal microphone.
  2. Speak a supported role-change command and then a question.
- Expected: The role changes without sending the command as a question, and the following utterance follows the selected role.

### CONV-S5 Reuse a saved prompt with a different answer focus

- Core: no
- For: A developer switching between a meeting and coding practice
- Needs: CONV-2
- Steps:
  1. Save and select a named system prompt.
  2. Change the focus from Meeting to Coding and reopen settings.
- Expected: The prompt remains selected and editable, while the next answer receives the chosen focus and shared spoken-answer guidance.

### CONV-S6 Choose an OpenRouter preset and faster routing

- Core: no
- For: A developer comparing configured model routes
- Needs: CONV-3
- Steps:
  1. Choose OpenRouter and a model preset.
  2. Switch between Standard and Nitro routing, then edit the model identifier.
- Expected: Routing changes preserve the base model, manual identifiers remain editable, and credentials do not follow a changed provider origin.

### CONV-S7 Open an updated installation with saved configuration intact

- Core: no
- For: The developer using Converaid on a Windows desktop or laptop
- Needs: CONV-4
- Steps:
  1. Update an existing installation and open the Converaid desktop shortcut.
  2. Inspect the toolbar, taskbar entry and saved settings.
- Expected: Converaid branding and its taskbar icon appear, saved prompts/projects/provider settings remain, and no upstream update feed is used without explicit configuration.

## Where it is going

The intended result is a simple, recognizable desktop assistant that the developer can prepare before a call and rehearse with immediately. A small set of presentable projects supplies concise, verifiable examples for the questions being asked. Changing the answer focus, prompt or model remains a small action in the same interface.

Windows desktop and laptop installations are the current delivery scope. The inherited project also contains macOS and Linux packaging, but this brief does not claim that the fork has completed acceptance testing on those systems. A browser preview supports development checks; it is not a separately delivered web application.

The inherited live conversation workflow can also use its configured relay and transcription services. Rehearsal uses the selected answer route and a separate local microphone connection.

No commercial rollout, additional operating-system acceptance scope, automatic repository-wide skill ranking or autonomous project-analysis service is committed by this brief.

## The market

The immediate niche is personal software-engineering interview preparation and project explanation. The person maintaining this fork is its initial customer; no subscription price or sales plan has been selected. Existing commercial products demonstrate an active category for AI interview preparation and conversation practice: [FinalRound's product guide](https://docs.finalroundai.com/) describes interview preparation, live assistance and review, and [Yoodli's interview preparation page](https://yoodli.ai/use-cases/interview-preparation) offers simulated interviews and feedback.

This research establishes the category and alternatives, not the number of potential customers. No independently sourced market-size estimate has been established. The first practical success criterion is whether the current developer can explain a selected project and answer a technical follow-up accurately during rehearsal.

## Competition

- **Meetingly**: An open-source desktop meeting assistant with local transcription and context-based answers. Converaid extends its starting workflow with selected project preparation, editable prompt choices, rehearsal roles and a distinct identity (checked 2026-11-06, https://meetinglyai.com/).
- **FinalRound**: A desktop interview product combining preparation materials, practice interviews, live suggestions and debriefs. Converaid's current focus is the developer's small set of reviewed local projects and a simple configurable rehearsal workflow (checked 2026-11-06, https://docs.finalroundai.com/).
- **Yoodli**: Interview roleplays with dynamic follow-up questions and feedback on communication. Converaid's current focus is project-specific technical context, editable answer instructions and observable response timing rather than automated delivery coaching (checked 2026-11-06, https://yoodli.ai/use-cases/interview-preparation).

## How it changed

- 2026-11-06: The first product brief records the requested Windows workflow, selected project context, editable answer focus and rehearsal. The latest clarification makes language examples follow the question rather than treating a historical interview answer as a permanent skill ranking. The brief records the existing scope so future work does not grow into an unnecessary project catalogue.

## Principles

- Keep the controls simple: choose a focus, choose a prompt, enable a few projects, and rehearse.
- Prefer a short, supported language-to-component example over an unsolicited project presentation.
- Keep facts about code separate from claims about personal ownership, proficiency and results.
- The current language-answer policy is held in [decision CONV-D2](decisions/CONV-D2.json); decision records remain authoritative.
- Personal background and prepared project follow-ups are governed by [decision CONV-D3](decisions/CONV-D3.json); personal prompt payloads stay outside the repository.
- Reuse prepared context before a call rather than running a large analysis task during it.
- Treat response timing as a measured observation, not a promise that a particular provider will always be fast.
- Preserve existing saved configuration when distributing an update.
- Keep delivery folders and launchers unambiguous according to [decision CONV-D4](decisions/CONV-D4.json).

## What it is not

- A ranking of the developer's abilities inferred from repository counts, dependencies or untouched forks.
- A claim that every language found in a repository is part of the developer's personal experience.
- An automatic recruiter assessment or a guarantee of passing an interview.
- A requirement to add every project or invent an example for a language that has no reviewed original component.
- An autonomous interviewer that currently invents and voices a complete interview: the current rehearsal workflow lets the developer play both speakers.
- A commitment to replace the inherited account, billing or hosted infrastructure.
