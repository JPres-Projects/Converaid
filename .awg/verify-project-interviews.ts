import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { prepareProjectKnowledge, queryProjectKnowledge, isProjectKnowledgeCurrent } from '../app/electron/services/projectKnowledge'

const roots = ['C:/AWG/Projekte/ExtractMiningStocksData', 'C:/AWG/Github/StardawnAI/AI-Working-Ground']
async function main() {
for (const root of roots) {
  const started = performance.now()
  const prepared = await prepareProjectKnowledge(root)
  const preparedMs = Math.round(performance.now() - started)
  assert(prepared.interview.includes('INTERVIEW.md'), 'The selected project interview reference must be loaded')
  assert(prepared.interview.includes('Personal contribution'), 'The ownership caveat must survive the reader bound')
  assert(prepared.interview.includes('TypeScript'), 'The actual language must survive preparation')
  const searchStarted = performance.now()
  const answer = queryProjectKnowledge(prepared, 'Explain the backend architecture and a concrete testing example. Was hast du selbst gebaut?')
  const searchMs = Math.round((performance.now() - searchStarted) * 100) / 100
  assert(answer.score > 0 && answer.text.includes('INTERVIEW.md'))
  assert(answer.text.includes('Personal contribution'))
  assert(await isProjectKnowledgeCurrent(prepared))
  console.log(JSON.stringify({ project: prepared.name, preparedMs, cachedSearchMs: searchMs, nodes: prepared.nodeCount, interviewChars: prepared.interview.length, referenceIncluded: true, ownershipSeparated: true, current: true }))
}
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
