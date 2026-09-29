import { describe, expect, it } from 'vitest'
import type { ModelsConfigView } from '../src/client/model-config.ts'
import {
  KEY_REF, apiKeyIssue, deriveKeyRef, draftIssue, normalizeBaseUrl, profileOps, type ModelsConfigDraft,
} from '../src/client/model-config.ts'

/** The view the dialog opens on, as `loadModelsConfig` would assemble it. */
function view(overrides: Partial<ModelsConfigView> = {}): ModelsConfigView {
  return {
    displayName: '内网模型网关',
    baseURL: 'https://gateway.internal/v1',
    baseDisplayName: '内网模型网关',
    baseBaseURL: 'https://gateway.internal/v1',
    apiKeyEnv: 'MODEL_GATEWAY_API_KEY',
    keyConfigured: true,
    keyWritable: true,
    models: [{ id: 'GLM5.1', name: 'inner-glm5.1' }],
    defaultModel: 'GLM5.1',
    profileRevision: 7,
    defaultRevision: 3,
    rawModels: [{ id: 'GLM5.1', name: 'inner-glm5.1', contextWindow: 131072 }],
    ...overrides,
  }
}

function draft(overrides: Partial<ModelsConfigDraft> = {}): ModelsConfigDraft {
  return {
    displayName: '内网模型网关',
    baseURL: 'https://gateway.internal/v1',
    apiKey: '',
    models: [{ id: 'GLM5.1', name: 'inner-glm5.1' }],
    defaultModel: 'GLM5.1',
    ...overrides,
  }
}

describe('deriveKeyRef', () => {
  it('derives exactly the reference the yantao bundle seeds', () => {
    // Regression guard: the composition seeds `apiKeyEnv: MODEL_GATEWAY_API_KEY`
    // for the model-gateway route; drifting from it orphans the stored key.
    expect(deriveKeyRef('model-gateway')).toBe('MODEL_GATEWAY_API_KEY')
    expect(KEY_REF).toBe('MODEL_GATEWAY_API_KEY')
  })

  it('maps non-alphanumeric runs to underscores', () => {
    expect(deriveKeyRef('deepseek-official')).toBe('DEEPSEEK_OFFICIAL_API_KEY')
  })
})

describe('normalizeBaseUrl', () => {
  it('strips the habitual /chat/completions paste', () => {
    expect(normalizeBaseUrl('https://aicodemarket.dahuatech.com/rd-soft-tools/glm/v1/chat/completions'))
      .toBe('https://aicodemarket.dahuatech.com/rd-soft-tools/glm/v1')
  })

  it('is case-insensitive about the suffix and tolerates trailing slashes', () => {
    expect(normalizeBaseUrl('https://h/v1/Chat/Completions/')).toBe('https://h/v1')
  })

  it('passes a bare /v1 through and trims whitespace', () => {
    expect(normalizeBaseUrl('  https://h/v1/  ')).toBe('https://h/v1')
  })

  it('keeps the empty field empty', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('apiKeyIssue', () => {
  it('allows the empty field (keep the stored key)', () => {
    expect(apiKeyIssue('')).toBeUndefined()
  })

  it('rejects a NAME=value paste, quoting, and non-printable/non-ASCII input', () => {
    expect(apiKeyIssue('FOO_BAR=secret')).toBe('keyIllegalCharacters')
    expect(apiKeyIssue('"wrapped"')).toBe('keyIllegalCharacters')
    expect(apiKeyIssue('密钥文本')).toBe('keyIllegalCharacters')
    expect(apiKeyIssue('   ')).toBe('keyBlank')
  })

  it('accepts real-looking keys, including all-upper-case base64 padding', () => {
    expect(apiKeyIssue('sk-abc123')).toBeUndefined()
    expect(apiKeyIssue('ABCD==')).toBeUndefined()
  })
})

describe('draftIssue', () => {
  it('refuses a row without an id', () => {
    expect(draftIssue(draft({ models: [{ id: '', name: 'x' }] }))).toBe('modelIdRequired')
  })

  it('refuses a default model outside the rows', () => {
    expect(draftIssue(draft({ defaultModel: 'missing' }))).toBe('defaultMissing')
    expect(draftIssue(draft({ defaultModel: '' }))).toBe('defaultMissing')
  })
})

describe('profileOps', () => {
  it('produces no ops for an unchanged draft', () => {
    expect(profileOps(view(), draft())).toEqual([])
  })

  it('sets a changed display name and normalizes the endpoint', () => {
    const ops = profileOps(view(), draft({
      displayName: 'DH 模型枢纽',
      baseURL: 'https://aicodemarket.dahuatech.com/rd-soft-tools/glm/v1/chat/completions',
    }))
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'model-gateway', 'displayName'], value: 'DH 模型枢纽' },
      { op: 'set', path: ['providers', 'model-gateway', 'baseURL'], value: 'https://aicodemarket.dahuatech.com/rd-soft-tools/glm/v1' },
    ])
  })

  it('unsets a cleared field, reverting to the composition base', () => {
    const ops = profileOps(view(), draft({ displayName: '', baseURL: '' }))
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'model-gateway', 'displayName'] },
      { op: 'unset', path: ['providers', 'model-gateway', 'baseURL'] },
    ])
  })

  it('rewrites the model rows as one op, merging onto stored rows to keep their extras', () => {
    const ops = profileOps(view(), draft({
      models: [{ id: 'GLM5.1', name: 'GLM 5.1 内网' }, { id: 'GLM-Air', name: 'air' }],
    }))
    expect(ops).toHaveLength(1)
    const op = ops[0]
    if (op.op !== 'set') throw new Error('expected a set op')
    expect(op.path).toEqual(['providers', 'model-gateway', 'models'])
    expect(op.value).toContainEqual({ id: 'GLM5.1', name: 'GLM 5.1 内网', contextWindow: 131072 })
  })
})
