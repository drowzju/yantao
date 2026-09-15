import { describe, expect, it } from 'vitest'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerPick,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { KbCapabilitySummary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { capabilityGestureSource } from '../src/client/capability-gesture.ts'

/** The capability rows one `capabilityList` answers with, covering every gate. */
const CAPABILITIES: KbCapabilitySummary[] = [
  { name: 'mail', description: '读 Outlook 邮件', source: 'project', invocation: ['human'] },
  { name: 'digest', description: '给 agent 的摘要', source: 'project', invocation: ['agent'] },
  { name: 'eml-digest', description: '读一封邮件', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'] },
  { name: 'notes-helper', description: '整理笔记', source: 'project', invocation: ['human', 'agent'] },
]

/** A candidate request with just the fields this source reads. */
function request(query: string): CandidateRequest {
  return {
    query, quoted: false, drilled: false,
    position: 'leading',
    signal: new AbortController().signal,
  }
}

/** Drive the source's candidate list. */
function candidates(query = ''): Promise<readonly { name?: string; section?: string }[]> {
  return capabilityGestureSource(() => Promise.resolve({ capabilities: CAPABILITIES, unregistered: [] }))
    .candidates({} as ClientSessionContext, request(query))
}

describe('capability / source', () => {
  it('lists only the instruction-type, human-invocable capabilities (ADR-0025 决定 6)', async () => {
    const rows = await candidates()
    // `digest` is agent-only and `eml-digest` is script-type: neither is a
    // `/xxx` the controller's pre-step would answer.
    expect(rows.map(row => row.name)).toEqual(['mail', 'notes-helper'])
  })

  it('filters on the typed query, by name or description', async () => {
    expect((await candidates('mail')).map(row => row.name)).toEqual(['mail'])
    expect((await candidates('笔记')).map(row => row.name)).toEqual(['notes-helper'])
    expect(await candidates('没有这个')).toEqual([])
  })

  it('offers nothing once the request is aborted', async () => {
    const source = capabilityGestureSource(() => Promise.resolve({ capabilities: CAPABILITIES, unregistered: [] }))
    const aborted = { ...request(''), signal: AbortSignal.abort() }
    expect(await source.candidates({} as ClientSessionContext, aborted)).toEqual([])
  })

  it('inserts the plain `/name ` token, no chip and no match hooks', () => {
    const source = capabilityGestureSource(() => Promise.resolve({ capabilities: CAPABILITIES, unregistered: [] }))
    const outcome = source.onPick({
      candidate: { name: 'mail' },
    } as InputTriggerPick)
    expect(outcome).toEqual({ text: '/mail ' })
    // ADR-0025 决定 6: enter/space adjudication stays with ui-commands.
    expect('matchEnter' in source).toBe(false)
    expect('matchSpace' in source).toBe(false)
  })
})
