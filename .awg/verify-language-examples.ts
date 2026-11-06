import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { ProjectKnowledgeService } from '../app/electron/services/projectKnowledgeService'
import type { SettingsStore } from '../app/electron/services/settings'

async function main() {
  const projects = [
    { id: 'deepmines', name: 'DeepMines', folder: 'C:/AWG/Projekte/ExtractMiningStocksData', experience: '', enabled: true },
    { id: 'awg', name: 'AWG', folder: 'C:/AWG/Github/StardawnAI/AI-Working-Ground', experience: '', enabled: true },
    { id: 'aiclip', name: 'AI Clipping', folder: 'C:/AWG/Projekte/AI Clipping', experience: '', enabled: true },
    { id: 'deploy', name: 'Stardawn Deploy', folder: 'C:/AWG/Github/StardawnAI/Stardawn Deploy', experience: '', enabled: true, description: 'CURATED_GO_EXAMPLE_SELECTED' }
  ]
  let notify = () => {}
  const settings = { get: () => ({ projects }), onChange: (listener: () => void) => { notify = listener; return () => {} } } as unknown as SettingsStore
  const service = new ProjectKnowledgeService({ settings })
  const started = performance.now()
  const state = await service.prepare()
  assert(state.projects.length === 4 && state.projects.every(project => ['ready', 'limited'].includes(project.status)))
  const prepareMs = Math.round(performance.now() - started)
  const cases = [
    ['Give a Python backend example from AI Clipping.', 'FastAPI'],
    ['Where does AWG use C#?', 'WinForms/WebView2'],
    ['Give a Go example from Stardawn Deploy.', 'customer agent']
  ]
  const checks = []
  for (const [question, example] of cases) {
    const before = performance.now()
    const context = await service.context(question)
    assert(context.length <= 32_000 && context.includes(example), `Missing curated example: ${example}`)
    checks.push({ example, contextMs: Math.round(performance.now() - before), chars: context.length })
  }
  projects[3].enabled = false
  notify()
  const deselected = await service.context('Give a Go language example.')
  assert(!deselected.includes('CURATED_GO_EXAMPLE_SELECTED'))
  console.log(JSON.stringify({ selectedProjects: 4, prepareMs, examples: checks, inactiveProjectExcluded: true, paidCalls: 0 }))
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
