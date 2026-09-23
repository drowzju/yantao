import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendMemoryEntry, assertMemoryScope, listMemoryScopes, MEMORY_GLOBAL_SCOPE, MEMORY_SCOPE_SOFT_CAP,
  memoryDisplayPath, memoryEntryId, parseMemoryFile, readMemoryScope, removeMemoryEntry, serializeMemoryFile,
} from '../src/memory.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-memory-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

const GLOBAL_PATH = '.dsh/yantao/memory/global.md'

describe('memory file format', () => {
  it('parses bullets into entries and keeps everything above the first bullet as preamble', () => {
    const parsed = parseMemoryFile('global', '# 记忆 · 全局\n\n- 2026-09-23 同类邮件直接提示删除\n- 新建项目应尝试关联 area\n')
    expect(parsed.preamble).toBe('# 记忆 · 全局')
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0]).toMatchObject({ date: '2026-09-23', text: '同类邮件直接提示删除' })
    expect(parsed.entries[1]?.date).toBeUndefined()
    expect(parsed.entries[1]?.text).toBe('新建项目应尝试关联 area')
  })

  it('ids are scope-qualified sha1 and stable across parses', () => {
    const first = parseMemoryFile('mail', '- 同类邮件直接提示删除')
    const second = parseMemoryFile('mail', '- 2026-09-23 同类邮件直接提示删除')
    expect(first.entries[0]?.id).toBe(second.entries[0]?.id)
    expect(first.entries[0]?.id).not.toBe(parseMemoryFile('global', '- 同类邮件直接提示删除').entries[0]?.id)
    expect(memoryEntryId('mail', '同类邮件直接提示删除')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('round trips a well-formed file byte-for-byte', () => {
    const text = '# 记忆 · 全局\n\n- 2026-09-23 甲\n- 乙\n'
    expect(serializeMemoryFile(parseMemoryFile('global', text))).toBe(text)
  })

  it('skips blank bullets instead of remembering them', () => {
    expect(parseMemoryFile('global', '-  \n-  2026-09-23  ').entries).toHaveLength(0)
  })
})

describe('assertMemoryScope', () => {
  it('accepts global and capability-shaped names', () => {
    expect(assertMemoryScope(MEMORY_GLOBAL_SCOPE)).toBe('global')
    expect(assertMemoryScope('mail')).toBe('mail')
    expect(assertMemoryScope('a.b-c_d1')).toBe('a.b-c_d1')
  })
  it('refuses separators, escapes and empty names', () => {
    for (const bad of ['', '..', 'a/b', 'a\\b', '/abs', '.hidden']) {
      expect(() => assertMemoryScope(bad)).toThrow(KbError)
    }
  })
})

describe('appendMemoryEntry', () => {
  it('creates the global file with its heading on first write', async () => {
    const scope = await appendMemoryEntry(kbRoot, 'global', '同类邮件直接提示删除')
    expect(scope.path).toBe(GLOBAL_PATH)
    expect(scope.entries).toHaveLength(1)
    expect(scope.entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(scope.entries[0]?.text).toBe('同类邮件直接提示删除')
    expect(scope.text).toContain('# 记忆 · 全局')
  })

  it('appends to an existing file and preserves the human preamble', async () => {
    const dir = join(kbRoot, '.dsh', 'yantao', 'memory')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'global.md'), '# 我的记忆\n\n- 2026-01-01 旧的\n', 'utf8')
    const scope = await appendMemoryEntry(kbRoot, 'global', '新的')
    expect(scope.text).toContain('# 我的记忆')
    expect(scope.entries.map(entry => entry.text)).toEqual(['旧的', '新的'])
  })

  it('scopes by capability into capabilities/<name>.md', async () => {
    const scope = await appendMemoryEntry(kbRoot, 'mail', '重点邮件要在卡片顶部提醒')
    expect(scope.path).toBe('.dsh/yantao/memory/capabilities/mail.md')
    expect(scope.text).toContain('# 记忆 · mail')
  })

  it('refuses an empty text and an exact duplicate', async () => {
    await appendMemoryEntry(kbRoot, 'global', '甲')
    await expect(appendMemoryEntry(kbRoot, 'global', '  甲  ')).rejects.toThrow(KbError)
    await expect(appendMemoryEntry(kbRoot, 'global', '  ')).rejects.toThrow(KbError)
    // The refusal left the file with exactly one entry.
    expect((await readMemoryScope(kbRoot, 'global')).entries).toHaveLength(1)
  })

  it('refuses an unsafe scope', async () => {
    await expect(appendMemoryEntry(kbRoot, '../escape', '甲')).rejects.toThrow(KbError)
  })
})

describe('removeMemoryEntry', () => {
  it('removes by id and keeps the rest', async () => {
    await appendMemoryEntry(kbRoot, 'global', '甲')
    const added = await appendMemoryEntry(kbRoot, 'global', '乙')
    const victim = added.entries.find(entry => entry.text === '甲')
    const scope = await removeMemoryEntry(kbRoot, 'global', victim!.id)
    expect(scope.entries.map(entry => entry.text)).toEqual(['乙'])
  })

  it('reports a stale id as memory-entry-not-found', async () => {
    await appendMemoryEntry(kbRoot, 'global', '甲')
    const error = await removeMemoryEntry(kbRoot, 'global', 'deadbeef').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('memory-entry-not-found')
  })
})

describe('listMemoryScopes', () => {
  it('answers an empty list when nothing is remembered', async () => {
    expect(await listMemoryScopes(kbRoot)).toEqual([])
  })

  it('lists global first, then capability scopes name-sorted', async () => {
    await appendMemoryEntry(kbRoot, 'mail', '甲')
    await appendMemoryEntry(kbRoot, 'global', '乙')
    await appendMemoryEntry(kbRoot, 'agenda', '丙')
    const scopes = await listMemoryScopes(kbRoot)
    expect(scopes.map(scope => scope.scope)).toEqual(['global', 'agenda', 'mail'])
  })

  it('ignores non-markdown and unsafely named files', async () => {
    const dir = join(kbRoot, '.dsh', 'yantao', 'memory', 'capabilities')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.txt'), '- x\n', 'utf8')
    await writeFile(join(dir, '..esc.md'), '- x\n', 'utf8')
    await expect(listMemoryScopes(kbRoot)).resolves.toEqual([])
  })
})

describe('soft cap constant', () => {
  it('is the injection-time truncation bound, generous enough for a personal KB', () => {
    expect(MEMORY_SCOPE_SOFT_CAP).toBeGreaterThanOrEqual(20)
    expect(Number.isInteger(MEMORY_SCOPE_SOFT_CAP)).toBe(true)
  })
})

describe('memoryDisplayPath', () => {
  it('maps global to global.md and capabilities into the subdirectory', () => {
    expect(memoryDisplayPath('global')).toBe(GLOBAL_PATH)
    expect(memoryDisplayPath('mail')).toBe('.dsh/yantao/memory/capabilities/mail.md')
  })
})
