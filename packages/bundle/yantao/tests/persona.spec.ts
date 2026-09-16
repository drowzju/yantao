/**
 * The yantao persona has ONE source: the profile bundle's `system-prompt`
 * patch row — the deployment persona, inherited by every agent that names no
 * preset (headless one-shot runs) and fallen through to by workbench sessions
 * (they mount the persona-less yantao preset, and a scoped section simply
 * absent lets the global `deployment:persona` show). The single-source
 * decision (2026-09-16, after ADR-0026): a scoped persona row in the preset
 * would shadow the deployment text with a second hand-copied copy, and the
 * copies did drift — workbench sessions kept reciting an overturned rule.
 * These gates pin it: the preset must not grow a persona row again without
 * consciously deleting this suite, the preset must stay a valid (empty)
 * composition, and the deployment persona must stay stated.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

/** One entry of a cordis patch/preset list, as this gate reads it. */
interface PatchRow {
  id?: string
  config?: Record<string, unknown>
}

/** The deployment persona: the profile bundle's `system-prompt` patch row. */
function deploymentPersona(): string {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const rows = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')) as PatchRow[]
  const row = rows.find(candidate => candidate.id === 'system-prompt')
  if (row === undefined) throw new Error('the bundle patch must carry a system-prompt row')
  const persona = row.config?.['persona']
  if (typeof persona !== 'string') throw new Error('the system-prompt row must state a persona string')
  return persona
}

/** The yantao preset's composition rows. */
function presetRows(): PatchRow[] {
  const path = fileURLToPath(new URL('../../../preset/agent-presets/presets/yantao/agent.cordis.yml', import.meta.url))
  return yaml.load(readFileSync(path, 'utf8')) as PatchRow[]
}

describe('yantao persona', () => {
  it('stays single-source: the preset carries no persona row', () => {
    expect(presetRows().find(candidate => candidate.id === 'persona')).toBeUndefined()
  })

  it('keeps the yantao preset a valid (empty) composition', () => {
    expect(Array.isArray(presetRows())).toBe(true)
  })

  it('keeps the deployment persona stated', () => {
    expect(deploymentPersona().length).toBeGreaterThan(0)
  })
})
