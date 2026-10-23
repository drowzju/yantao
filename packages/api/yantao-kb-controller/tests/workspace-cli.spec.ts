/**
 * Unit tests for the workspace CLI options (2026-10-23): the --help model
 * parse, the model precedence, and the env layering. Pure functions — no
 * spawn, no services.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace-cli-spec
 */
import { describe, expect, it } from 'vitest'
import { applyCliEnv, parseModelIds, resolveStepModel } from '../src/workspace/cli.ts'

describe('parseModelIds', () => {
  it('reads the parenthesized id list off the --model help line (real contract, probed 2026-10-23)', () => {
    const help = [
      '  -p, --print                                      Print response and exit',
      '  --output-format <format>                         Output format (only works with --print)',
      '  --model <model>                                  Model for the current session. Currently supported: (auto, hy4-preview, glm-5.3, custom-local:GLM5.1, custom-local:Kimi-K2.6)',
      '  --fallback-model <model>                         Enable automatic fallback',
    ].join('\n')
    expect(parseModelIds(help)).toEqual(['auto', 'hy4-preview', 'glm-5.3', 'custom-local:GLM5.1', 'custom-local:Kimi-K2.6'])
  })

  it('answers empty on prose without the parenthesis pair', () => {
    expect(parseModelIds('  --model <model>  Model for the current session')).toEqual([])
    expect(parseModelIds('')).toEqual([])
  })
})

describe('resolveStepModel', () => {
  it('the workspace binding wins over the global default', () => {
    expect(resolveStepModel('space-model', { model: 'global-model' })).toBe('space-model')
  })

  it('the global default answers when the workspace binds none', () => {
    expect(resolveStepModel(undefined, { model: 'global-model' })).toBe('global-model')
    expect(resolveStepModel('', { model: 'global-model' })).toBe('global-model')
  })

  it('no configuration anywhere means the CLI decides', () => {
    expect(resolveStepModel(undefined, undefined)).toBeUndefined()
    expect(resolveStepModel(undefined, {})).toBeUndefined()
    expect(resolveStepModel(undefined, { model: '' })).toBeUndefined()
  })
})

describe('applyCliEnv', () => {
  it('layers the two API-key variables onto a stripped environment', () => {
    const env = applyCliEnv({ PATH: '/bin' }, { apiKey: 'k-1', internetEnvironment: 'cloudhosted' })
    expect(env.CODEBUDDY_API_KEY).toBe('k-1')
    expect(env.CODEBUDDY_INTERNET_ENVIRONMENT).toBe('cloudhosted')
    expect(env.PATH).toBe('/bin')
  })

  it('empty fields and absent options add nothing', () => {
    const plain = { PATH: '/bin' }
    expect(applyCliEnv(plain, undefined)).toEqual({ PATH: '/bin' })
    expect(applyCliEnv(plain, {})).toEqual({ PATH: '/bin' })
    expect(applyCliEnv(plain, { apiKey: '', internetEnvironment: '' })).toEqual({ PATH: '/bin' })
  })
})
