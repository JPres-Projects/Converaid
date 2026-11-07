import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { ProjectKnowledgeService } from '../app/electron/services/projectKnowledgeService'
import type { SettingsStore } from '../app/electron/services/settings'

async function main() {
  const projects = [
    { id: 'deepmines', name: 'DeepMines', folder: 'C:/AWG/Projekte/ExtractMiningStocksData', experience: '', enabled: true },
    { id: 'awg', name: 'AWG', folder: 'C:/AWG/Github/StardawnAI/AI-Working-Ground', experience: '', enabled: true }
  ]
  const settings = { get: () => ({ projects }), onChange: () => () => {} } as unknown as SettingsStore
  const service = new ProjectKnowledgeService({ settings })
  const started = performance.now()
  const state = await service.prepare()
  const preparedMs = Math.round(performance.now() - started)
  assert(state.projects.length === 2 && state.projects.every(project => project.status === 'ready'))
  const beforeQuery = performance.now()
  const context = await service.context('Explain DeepMines and AWG backend architecture, provider boundaries and one concrete pass/fail testing example. Was hast du selbst gebaut?')
  const cachedContextMs = Math.round(performance.now() - beforeQuery)
  console.log(JSON.stringify({ preparedMs, cachedContextMs, contextChars: context.length, hasPersonalSection: context.includes('Personal contribution'), hasRoleCaveat: context.includes('Not supplied. Do not infer personal responsibility'), hasConversion: context.includes('0.032'), hasConcurrency: context.includes('fifty') }))
  assert(context.length <= 32_000)
  assert(context.includes('DeepMines') && context.includes('AWG') && context.includes('INTERVIEW.md'))
  assert(context.includes('Personal contribution') && context.includes('Not supplied. Do not infer personal responsibility'))
  assert(context.includes('0.032') && context.includes('fifty'))
  console.log(JSON.stringify({ selectedProjects: 2, preparedMs, cachedContextMs, contextChars: context.length, bothReferencesIncluded: true, concreteTestsIncluded: true, personalRoleNotInferred: true, paidCalls: 0 }))
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
