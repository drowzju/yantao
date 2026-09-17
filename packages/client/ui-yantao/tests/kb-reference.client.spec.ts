import { describe, expect, it } from 'vitest'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerPick,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { kbReferenceSource, type KbReferenceFaces } from '../src/client/kb-reference.ts'
import { t } from './helpers.client.ts'

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
  t,
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

describe('kb @ source — directory candidates (ADR-0028)', () => {
  /** Resource files with real nesting; the wire name of a nested file is its path below `resources/`. */
  const nestedIntake: KbTreeSection[] = [
    {
      id: 'resources',
      files: [
        { name: '周报.eml', path: 'resources/周报.eml' },
        { name: '报告/2026-09/周报.md', path: 'resources/报告/2026-09/周报.md' },
      ],
    },
  ]
  const nestedFaces: KbReferenceFaces = {
    t,
    intake: () => Promise.resolve(nestedIntake),
    workspace: () => Promise.resolve([]),
  }

  it('synthesizes a folder candidate per intermediate directory, ahead of the files', async () => {
    const rows = await kbReferenceSource(nestedFaces).candidates({} as ClientSessionContext, request(''))
    expect(rows.map(row => [row.name, row.section])).toEqual([
      ['报告', '资源'],
      ['2026-09', '资源'],
      ['周报.eml', '资源'],
      ['报告/2026-09/周报.md', '资源'],
    ])
    expect(rows.map(row => row.description)).toEqual([
      'resources/报告/',
      'resources/报告/2026-09/',
      'resources/周报.eml',
      'resources/报告/2026-09/周报.md',
    ])
  })

  it('never offers the resources root itself, however flat the section is', async () => {
    const rows = await kbReferenceSource(faces).candidates({} as ClientSessionContext, request(''))
    expect(rows.map(row => row.description)).not.toContain('resources/')
  })

  it('matches a directory candidate by its name or path', async () => {
    const rows = await kbReferenceSource(nestedFaces).candidates({} as ClientSessionContext, request('报告'))
    expect(rows.map(row => row.description)).toEqual([
      'resources/报告/',
      'resources/报告/2026-09/',
      'resources/报告/2026-09/周报.md',
    ])
  })

  it('picks a directory candidate as a folder chip carrying the trailing-slash ref', () => {
    const source = kbReferenceSource(nestedFaces)
    const outcome = source.onPick({
      candidate: { name: '报告', value: JSON.stringify({ path: 'resources/报告/', name: '报告' }) },
    } as InputTriggerPick)
    expect(outcome).toEqual({
      insert: {
        source: 'kb',
        ref: 'resources/报告/',
        label: '报告',
        appearance: 'folder',
        clipboardText: 'resources/报告/',
      },
    })
  })

  it("serializes a path with spaces in the host regex's quoted form", async () => {
    const codec = kbReferenceSource(faces).codec
    await expect(codec?.serialize('entities/projects/dsh 学习.md', new AbortController().signal))
      .resolves.toBe('@"entities/projects/dsh 学习.md"')
    await expect(codec?.serialize('resources/报告/', new AbortController().signal))
      .resolves.toBe('@resources/报告/')
  })
})
