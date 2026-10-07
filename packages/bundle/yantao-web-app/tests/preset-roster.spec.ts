/**
 * Preset roster gate: the registry's default must have a preset BODY.
 *
 * 0.2.1 moved the agent plane behind presets: the registry row (default:
 * yantao) only NAMES the default, and the preset itself is a separate
 * `@deepseek-ai/dsh-agent-preset` declaration. Missing the body passes every
 * unit test and only explodes at session create with
 * `agent-preset/not-found: Unknown agent preset: yantao` (2026-10-07 实机
 * 踩过). This gate pins the pairing in YAML, where it belongs.
 *
 * The composition assertions mirror packages/bundle/yantao/tests/persona.spec.ts:
 * the preset carries no persona row (deployment persona is the single
 * source) and no model-facing tool row (the kb_ family is host-plane;
 * tool-lessness is the ADR-0004 boundary — the compaction group's
 * tool-result-pruner is session infrastructure the model cannot call).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

/** One entry of a cordis patch, as this gate reads it. */
interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

/** One plugin row inside a preset's composition. */
interface PluginRow {
  id?: string
  name?: string
  config?: PluginRow[]
}

function patchRows(): PatchRow[] {
  const path = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
  // The patch carries `!!js` expressions; this gate judges shapes, not
  // expressions, so any `!!js` value resolves as an opaque scalar.
  const opaqueJs = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: () => true })
  return yaml.load(readFileSync(path, 'utf8'), { schema: new yaml.Schema([opaqueJs]) }) as PatchRow[]
}

describe('yantao-web-app preset roster', () => {
  it('declares a registry whose default preset has a body', () => {
    const flattened: PatchRow[] = []
    for (const row of patchRows()) {
      const inserted = (row as { insert?: PatchRow[] }).insert
      if (Array.isArray(inserted)) flattened.push(...inserted)
      else flattened.push(row)
    }
    const registry = flattened.find(row => row.name === '@deepseek-ai/dsh-agent-preset-registry')
    expect(registry, 'the bundle must declare the agent-preset-registry').toBeDefined()
    const defaultId = registry?.config?.['default']
    expect(typeof defaultId).toBe('string')

    const bodies = flattened.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
    expect(bodies.map(row => (row.config as { id?: string } | undefined)?.id),
      'every registry default must have a @deepseek-ai/dsh-agent-preset declaration').toContain(defaultId)
  })

  it('keeps the yantao preset a persona-less, tool-less composition with compaction', () => {
    const flattened: PatchRow[] = []
    for (const row of patchRows()) {
      const inserted = (row as { insert?: PatchRow[] }).insert
      if (Array.isArray(inserted)) flattened.push(...inserted)
      else flattened.push(row)
    }
    const body = flattened.find(row => row.name === '@deepseek-ai/dsh-agent-preset'
      && (row.config as { id?: string } | undefined)?.id === 'yantao')
    expect(body, 'the yantao preset body must be declared in this bundle').toBeDefined()

    const plugins = (body!.config as { plugins: PluginRow[] }).plugins
    // Exactly the compaction group: no persona row (single-source persona,
    // see persona.spec.ts) and no model-facing tool row (ADR-0004 boundary).
    expect(plugins.map(plugin => plugin.id)).toEqual(['compaction'])
  })
})
