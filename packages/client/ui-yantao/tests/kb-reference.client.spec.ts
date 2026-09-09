import { describe, expect, it } from 'vitest'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerPick,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { kbReferenceSource, type KbReferenceFaces } from '../src/client/kb-reference.ts'

const workspace: KbTreeSection[] = [
  { id: 'projects', files: [{ name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' }] },
  { id: 'areas', files: [{ name: '健康', path: 'entities/areas/健康.md' }] },
  { id: 'people', files: [{ name: '张三', path: 'entities/people/张三.md', relation: 'peer' }] },
]

const intake: KbTreeSection[] = [
  { id: 'resources', files: [{ name: '周报.eml', path: 'resources/周报.eml' }] },
  { id: 'meetings', files: [{ name: '周会', path: 'entities/meetings/周会.md' }] },
  { id: 'todos', files: [{ name: 'todos', path: 'entities/todos.md' }] },
]

/** The two loaders, answering with the fixtures above. */
const faces: KbReferenceFaces = {
  intake: () => Promise.resolve(intake),
  workspace: () => Promise.resolve(workspace),
}

/** A candidate request with just the fields this source reads. */
function request(query: string): CandidateRequest {
  return {
    query, quoted: false, drilled: false,
    position: 'inline',
    signal: new AbortController().signal,
  }
}

/** Drive the source's candidate list. */
function candidates(query = ''): Promise<readonly { name?: string; section?: string; value?: string }[]> {
  return kbReferenceSource(faces).candidates({} as ClientSessionContext, request(query))
}

/** Drive one pick through the source. */
function pick(value: string | undefined): ReturnType<ReturnType<typeof kbReferenceSource>['onPick']> {
  return kbReferenceSource(faces).onPick({ candidate: { name: 'x', value } } as InputTriggerPick)
}

describe('kb @ source', () => {
  it('offers every entity the rails can see, grouped by section', async () => {
    const rows = await candidates()
    expect(rows.map(row => row.name)).toEqual(['dsh 学习', '健康', '张三', '周报.eml', '周会', 'todos'])
    expect(rows.map(row => row.section)).toEqual(['项目', '领域', '人物', '资源', '会议', '待办'])
  })

  it('filters on the typed query, by name or path', async () => {
    expect((await candidates('张三')).map(row => row.name)).toEqual(['张三'])
    expect((await candidates('meetings')).map(row => row.name)).toEqual(['周会'])
    expect(await candidates('没有这个')).toEqual([])
  })

  it('offers nothing once the request is aborted', async () => {
    const source = kbReferenceSource(faces)
    const aborted = { ...request(''), signal: AbortSignal.abort() }
    expect(await source.candidates({} as ClientSessionContext, aborted)).toEqual([])
  })

  it('inserts a chip carrying the KB-relative path', () => {
    const outcome = pick(JSON.stringify({ path: 'entities/people/张三.md', name: '张三' }))
    expect(outcome).toEqual({
      insert: {
        source: 'kb',
        ref: 'entities/people/张三.md',
        label: '张三',
        appearance: 'file',
        clipboardText: 'entities/people/张三.md',
      },
    })
  })

  it('ignores a payload that is not ours', () => {
    expect(pick('not json')).toBeUndefined()
    expect(pick(undefined)).toBeUndefined()
  })

  it('serializes a reference as its @path mention', async () => {
    const codec = kbReferenceSource(faces).codec
    expect(codec?.clipboardText('entities/areas/健康.md')).toBe('entities/areas/健康.md')
    await expect(codec?.serialize('entities/areas/健康.md', new AbortController().signal))
      .resolves.toBe('@entities/areas/健康.md')
  })
})
