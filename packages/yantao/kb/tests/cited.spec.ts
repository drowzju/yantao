import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCitedEntries } from '../src/cited.ts'
import { MAX_DIR_ENTRIES, type CitedEntry } from '../src/mentions.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-cited-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** Narrow a cited entry to its directory form, failing the test otherwise. */
function dirOf(entry: CitedEntry): Extract<CitedEntry, { kind: 'dir' }> {
  if (entry.kind !== 'dir') throw new Error('预期目录引用')
  return entry
}

describe('readCitedEntries', () => {
  it('reads a cited file as text', async () => {
    await mkdir(join(kbRoot, 'entities', 'people'), { recursive: true })
    await writeFile(join(kbRoot, 'entities', 'people', '张三.md'), '张三的内容')
    expect(await readCitedEntries(kbRoot, ['entities/people/张三.md']))
      .toEqual([{ kind: 'file', path: 'entities/people/张三.md', content: '张三的内容' }])
  })

  it('reports a NUL-bearing file as binary instead of decoding it', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '照片.png'), new Uint8Array([0x50, 0x4b, 0x00, 0x03]))
    expect(await readCitedEntries(kbRoot, ['resources/照片.png']))
      .toEqual([{ kind: 'binary', path: 'resources/照片.png', size: 4 }])
  })

  it('expands a cited directory into KB-relative rows, subdirectories first-sorted', async () => {
    await mkdir(join(kbRoot, 'resources', '报告', '2026-09'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '报告', '笔记.md'), '目录里的笔记')
    await writeFile(join(kbRoot, 'resources', '报告', '2026-09', '周报.md'), '周报内容')
    const cited = await readCitedEntries(kbRoot, ['resources/报告/'])
    expect(cited).toHaveLength(1)
    const dir = dirOf(cited[0])
    expect(dir.path).toBe('resources/报告')
    expect(dir.files.map(file => file.path))
      .toEqual(['resources/报告/2026-09/周报.md', 'resources/报告/笔记.md'])
    expect(dir.files.map(file => file.content)).toEqual(['周报内容', '目录里的笔记'])
  })

  it('demotes a binary file inside a directory to a placeholder row with its size', async () => {
    await mkdir(join(kbRoot, 'resources', '附件'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '附件', '照片.png'), new Uint8Array([1, 0, 2]))
    const cited = await readCitedEntries(kbRoot, ['resources/附件'])
    expect(dirOf(cited[0]).files).toEqual([
      { path: 'resources/附件/照片.png', content: null, reason: 'binary', size: 3 },
    ])
  })

  it('demotes a file past the directory content budget but keeps smaller later files', async () => {
    await mkdir(join(kbRoot, 'resources', '大目录'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '大目录', 'big.txt'), 'x'.repeat(95_000))
    await writeFile(join(kbRoot, 'resources', '大目录', 'mid.txt'), 'y'.repeat(2_000))
    await writeFile(join(kbRoot, 'resources', '大目录', 'small.txt'), 'z'.repeat(500))
    const cited = await readCitedEntries(kbRoot, ['resources/大目录'])
    const dir = dirOf(cited[0])
    expect(dir.files.map(file => [file.path, file.content !== null, file.reason ?? null])).toEqual([
      ['resources/大目录/big.txt', true, null],
      ['resources/大目录/mid.txt', false, 'budget'],
      ['resources/大目录/small.txt', true, null],
    ])
    expect(dir.files[0].content).toHaveLength(95_000)
  })

  it('caps a directory at the entry cap and marks the listing truncated', async () => {
    await mkdir(join(kbRoot, 'resources', 'many'), { recursive: true })
    for (let index = 0; index < MAX_DIR_ENTRIES + 1; index++) {
      await writeFile(join(kbRoot, 'resources', 'many', `f${String(index).padStart(3, '0')}.txt`), 'x')
    }
    const cited = await readCitedEntries(kbRoot, ['resources/many'])
    const dir = dirOf(cited[0])
    expect(dir.files).toHaveLength(MAX_DIR_ENTRIES)
    expect(dir.truncated).toBe(true)
  })

  it('skips a vanished path and one that climbs out of the root', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    expect(await readCitedEntries(kbRoot, ['resources/不存在.md', '../outside.md'])).toEqual([])
  })
})
