# Preparing selected projects for an interview

Select only the projects you intend to discuss. Prepare their context before the call. Converaid reads an optional `INTERVIEW.md` or `docs/INTERVIEW.md` from each selected project through the same safety checks as other source files. These references are cached together with the existing code map; no analysis agent or additional model call runs during preparation. Changing, adding, removing or ignoring an interview reference requires preparation again.

Keep the reference compact: about 400 words, with the most useful material first. The reader limits each document to approximately 3,200 characters and the brief gives its opening section priority. Include purpose and languages, one end-to-end flow, application logic versus external APIs, one concrete engineering challenge and one test with its input and pass/fail rule. Cite relative source paths and relevant commits. Mark the review date and historical examples. State unknowns instead of inventing uptime, accuracy, speed or personal contributions.

Project descriptions provide a short product overview. The separate role field records what the user confirms they designed, implemented, reviewed, tested or delegated. Neither a code map nor a Git author proves an individual's responsibilities.

For language questions, a short language-to-component example is enough. State the language or family first, then its actual use in a reviewed project. Keep programming languages separate from frameworks, build tools and runtimes. Project language use is evidence about code, not an automatic ranking of individual proficiency. A missing example is acceptable; dependencies and unchanged upstream code do not fill that gap.

## Reusable preparation prompt

Use this in a coding assistant before the interview, then save the verified result as the project's interview reference:

> Prepare this selected project for a [backend / frontend / full-stack] interview about [role or task]. Start with its existing Understand Anything map, check its age against Git and inspect the relevant current source. Do not regenerate the map. Read a bounded set of relevant commits and tests. Write a compact English reference with: the product problem; the actual languages and frameworks; the relevant frontend/backend/storage boundaries; an input-to-output walkthrough; application logic versus external provider capabilities; one concrete challenge with its cause and resolution; and one test with its input, expected result and exact pass/fail mechanism. Cite relative code paths and commit IDs. Distinguish current behavior from historical fixes and proposed improvements. Do not run paid providers or claim unmeasured production results. Record personal contribution only when I explicitly confirm it. Keep the file around 3,000 characters, with the material most relevant to the role first.

## Optional system prompt for interview answers

Create a named prompt in Settings, set the answer mode to Interview and put the role or job description in Background notes:

> Answer the interviewer's current question using only the selected project references, current source evidence and my confirmed role. Explain the relevant backend, frontend or full-stack flow in short, connected, complete sentences. Name the actual implementation language. Separate what our application does from what an external API supplies. When asked about a challenge or testing, give one concrete example and explain what would pass or fail. Use first person only for responsibilities I confirmed. Do not turn project capabilities or commit authors into personal achievements. Do not invent metrics or decisions.

The two local examples prepared for Jim live in the DeepMines and AWG project roots, rather than in this public Converaid repository. Their technical and personal context stays with those selected local projects.
