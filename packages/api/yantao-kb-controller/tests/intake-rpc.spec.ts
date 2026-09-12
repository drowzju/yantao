import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { entityFileContent, todayStamp, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import type { KbExtractResult } from '../src/types.ts'
import YantaoKbController from '../src/index.ts'

// `extractText` is the one part that would need Python and the per-format
// libraries; the rest — the base64 intake, the cache, the failure wording —
// is ours.
const { state } = vi.hoisted(() => ({ state: { extractText: vi.fn() } }))
const extractText = state.extractText

vi.mock('../src/extract/index.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/extract/index.ts')>(),
  extractText: state.extractText,
}))

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

const TODAY = todayStamp()

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-intake-'))
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return false
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  // The controller also injects the skill registry (ADR-0021); extraction
  // never resolves a capability, so an empty stand-in is enough.
  ctx.provide('skills', { get: async () => undefined } as never)
  fiber = await ctx.plugin(YantaoKbController)
  extractText.mockReset()
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

describe('yantaoKb.registerResource', () => {
  it('decodes the base64 content and copies it into resources/', async () => {
    const content = Buffer.from('书的内容'.repeat(3), 'utf8')
    const result = await ctx.yantaoKbController.registerResource({
      name: '三体.epub',
      contentBase64: content.toString('base64'),
    })
    expect(result).toEqual({ resource: 'resources/三体.epub' })
    expect(await readFile(join(kbRoot, 'resources/三体.epub'))).toEqual(content)
  })

  it('round-trips binary bytes exactly', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
    const result = await ctx.yantaoKbController.registerResource({
      name: '照片.png',
      contentBase64: Buffer.from(bytes).toString('base64'),
    })
    expect(await readFile(join(kbRoot, result.resource))).toEqual(Buffer.from(bytes))
  })

  it('refuses to overwrite an existing resource', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources/三体.epub'), 'original', 'utf8')
    const failure = await ctx.yantaoKbController.registerResource({
      name: '三体.epub',
      contentBase64: Buffer.from('replacement').toString('base64'),
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/rejected',
      details: { path: 'resources/三体.epub' },
    })
    expect((failure as Error).message).toMatch(/已登记过/)
    expect(await readFile(join(kbRoot, 'resources/三体.epub'), 'utf8')).toBe('original')
  })
})

describe('yantaoKb.extractResource', () => {
  beforeEach(async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources/三体.epub'), 'epub-bytes')
  })

  it('extracts, then caches the text and its self-describing metadata', async () => {
    extractText.mockResolvedValue({ text: '第一章\n黑暗森林', meta: { format: 'epub', chars: 8 } })
    const first: KbExtractResult = await ctx.yantaoKbController.extractResource({ path: 'resources/三体.epub' })
    expect(first).toEqual({
      extractPath: '.yantao/extracts/三体.epub.txt',
      format: 'epub',
      chars: 8,
      cached: false,
    })
    expect(extractText).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'epub', input: join(kbRoot, 'resources/三体.epub') }),
    )
    expect(await readFile(join(kbRoot, '.yantao/extracts/三体.epub.txt'), 'utf8')).toBe('第一章\n黑暗森林')
    const meta = JSON.parse(await readFile(join(kbRoot, '.yantao/extracts/三体.epub.json'), 'utf8')) as Record<string, unknown>
    expect(meta).toMatchObject({ format: 'epub', chars: 8, source: 'resources/三体.epub' })
    expect(typeof meta.extractedAt).toBe('string')
  })

  it('answers from the cache on a second call, without running the extractor', async () => {
    extractText.mockResolvedValue({ text: '正文', meta: { format: 'epub', chars: 2 } })
    await ctx.yantaoKbController.extractResource({ path: 'resources/三体.epub' })
    extractText.mockClear()
    const second = await ctx.yantaoKbController.extractResource({ path: 'resources/三体.epub' })
    expect(second).toEqual({
      extractPath: '.yantao/extracts/三体.epub.txt',
      format: 'epub',
      chars: 2,
      cached: true,
    })
    expect(extractText).not.toHaveBeenCalled()
  })

  it('refuses a path outside resources/', async () => {
    const failure = await ctx.yantaoKbController.extractResource({ path: 'entities/projects/读书-三体.md' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/extract', details: { kind: 'unsupported' } })
    expect(extractText).not.toHaveBeenCalled()
  })

  it('refuses a format the extractor does not know', async () => {
    await writeFile(join(kbRoot, 'resources/照片.png'), 'png-bytes')
    const failure = await ctx.yantaoKbController.extractResource({ path: 'resources/照片.png' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/extract', details: { kind: 'unsupported' } })
    expect(extractText).not.toHaveBeenCalled()
  })

  it('carries the extractor\'s kind, message and hint on failure', async () => {
    const { ExtractError } = await import('../src/extract/index.ts')
    extractText.mockRejectedValue(new ExtractError(
      'no-text',
      '这份文档没有可抽取的文字层（可能是扫描版）。',
      '扫描版需要 OCR，当前版本不支持。',
    ))
    const failure = await ctx.yantaoKbController.extractResource({ path: 'resources/三体.epub' })
      .catch((error: unknown) => error)
    const error = remoteErrorOf(failure)
    expect(error).toMatchObject({
      code: 'yantao-kb/extract',
      message: '这份文档没有可抽取的文字层（可能是扫描版）。',
      details: { kind: 'no-text', hint: '扫描版需要 OCR，当前版本不支持。' },
    })
    // The failed extraction left no cache behind, so a retry extracts anew.
    await expect(readFile(join(kbRoot, '.yantao/extracts/三体.epub.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('yantaoKb.createEntity with source', () => {
  it('writes the source resource into a reading project\'s frontmatter', async () => {
    const result = await ctx.yantaoKbController.createEntity({
      type: 'project',
      name: '读书-三体',
      source: 'resources/三体.epub',
    })
    expect(result.path).toBe('entities/projects/读书-三体.md')
    expect(await readFile(join(kbRoot, result.path), 'utf8')).toBe(
      entityFileContent('project', '读书-三体', TODAY, { source: 'resources/三体.epub' }),
    )
  })

  it('omits the field when the caller names no source', async () => {
    const result = await ctx.yantaoKbController.createEntity({ type: 'project', name: '普通项目' })
    expect(await readFile(join(kbRoot, result.path), 'utf8')).not.toContain('source:')
  })
})
