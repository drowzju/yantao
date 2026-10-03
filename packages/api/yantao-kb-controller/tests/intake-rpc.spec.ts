import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

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
  // The controller also injects the skill registry (ADR-0021); intake never
  // resolves a capability, so an empty stand-in is enough.
  ctx.provide('skills', { get: async () => undefined, list: async () => [] } as never)
  // ADR-0023: the controller also injects the tool layer to register
  // kb_run_capability; intake never invokes it, so a no-op stub is enough.
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
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

describe('yantaoKb.deleteResource', () => {
  it('removes a resource file and reports its path', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources/草稿.txt'), 'obsolete', 'utf8')
    const result = await ctx.yantaoKbController.deleteResource('resources/草稿.txt')
    expect(result).toEqual({ path: 'resources/草稿.txt' })
    await expect(readFile(join(kbRoot, 'resources/草稿.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a path outside the resource plane', async () => {
    await mkdir(join(kbRoot, 'entities/people'), { recursive: true })
    await writeFile(join(kbRoot, 'entities/people/张三.md'), '# 张三', 'utf8')
    const failure = await ctx.yantaoKbController.deleteResource('entities/people/张三.md')
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/rejected',
      details: { path: 'entities/people/张三.md' },
    })
    expect(await readFile(join(kbRoot, 'entities/people/张三.md'), 'utf8')).toBe('# 张三')
  })

  it('refuses a traversal escape even when it names resources/', async () => {
    const failure = await ctx.yantaoKbController.deleteResource('../outside/resources/x.txt')
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.code).toBeDefined()
  })

  it('reports not-found for a missing resource', async () => {
    const failure = await ctx.yantaoKbController.deleteResource('resources/不存在.txt')
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/not-found',
      details: { path: 'resources/不存在.txt' },
    })
  })
})
