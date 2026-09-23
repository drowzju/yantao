import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { appendMemoryEntry } from '../src/memory.ts'
import { BEHAVIOR_MEMORY_SECTION, loadSectionText, registerBehaviorMemorySection, registerPromptSections, YANTAO_SECTIONS } from '../src/sections.ts'

/** The prompt/sections directory, resolved from this test file's location. */
const sectionsDir = fileURLToPath(new URL('../prompt/sections', import.meta.url))

/** A stub ctx that records section registrations through the effect indirection. */
function recordingCtx(): { sectionSpy: ReturnType<typeof vi.fn>; ctx: Context } {
  const sectionSpy = vi.fn()
  const ctx = {
    effect: (register: () => unknown) => register(),
    systemPrompt: { section: sectionSpy },
  } as unknown as Context
  return { sectionSpy, ctx }
}

describe('yantao prompt sections (ADR-0022)', () => {
  it('declares exactly the four yantao sections in the 100–200 band', () => {
    expect(YANTAO_SECTIONS.map(section => section.name)).toEqual([
      'yantao:philosophy',
      'yantao:filesystem',
      'yantao:memory',
      'yantao:skills',
    ])
    for (const section of YANTAO_SECTIONS) {
      expect(section.order).toBeGreaterThanOrEqual(100)
      expect(section.order).toBeLessThanOrEqual(200)
    }
    expect(new Set(YANTAO_SECTIONS.map(section => section.order)).size).toBe(YANTAO_SECTIONS.length)
  })

  it('backs every section with a non-empty Markdown file', () => {
    for (const section of YANTAO_SECTIONS) {
      const path = `${sectionsDir}/${section.file}`
      expect(existsSync(path), path).toBe(true)
      expect(readFileSync(path, 'utf8').trim().length, path).toBeGreaterThan(0)
    }
  })

  it('registers each section with text equal to its file content', () => {
    const { sectionSpy, ctx } = recordingCtx()
    registerPromptSections(ctx)
    expect(sectionSpy).toHaveBeenCalledTimes(YANTAO_SECTIONS.length)
    for (const [index, section] of YANTAO_SECTIONS.entries()) {
      expect(sectionSpy).toHaveBeenNthCalledWith(index + 1, {
        name: section.name,
        order: section.order,
        text: loadSectionText(section.file),
      })
    }
  })
})

describe('the dynamic behavior-memory section (ADR-0032 批次②)', () => {
  let kbRoot: string

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-behavior-memory-'))
  })

  afterEach(async () => {
    await rm(kbRoot, { recursive: true, force: true })
  })

  it('sits between the static memory and skills sections', () => {
    expect(BEHAVIOR_MEMORY_SECTION).toEqual({ name: 'yantao:behavior-memory', order: 150 })
    expect(YANTAO_SECTIONS.every(section => section.order !== BEHAVIOR_MEMORY_SECTION.order)).toBe(true)
  })

  it('evaluates its text per assembly from the live root', async () => {
    const { sectionSpy, ctx } = recordingCtx()
    registerBehaviorMemorySection(ctx, () => kbRoot)
    expect(sectionSpy).toHaveBeenCalledTimes(1)
    const registered = sectionSpy.mock.calls[0]?.[0] as {
      name: string
      order: number
      text: () => string
    }
    expect(registered.name).toBe('yantao:behavior-memory')
    expect(registered.order).toBe(150)
    // Nothing remembered yet: an empty section contributes nothing.
    expect(registered.text()).toBe('')
    // The human approves a memory; the NEXT assembly sees it — no rebuild.
    await appendMemoryEntry(kbRoot, 'global', '同类邮件直接提示删除')
    expect(registered.text()).toContain('- ')
    expect(registered.text()).toContain('同类邮件直接提示删除')
  })

  it('follows a root retarget without re-registering', async () => {
    const { sectionSpy, ctx } = recordingCtx()
    let liveRoot = kbRoot
    registerBehaviorMemorySection(ctx, () => liveRoot)
    const registered = sectionSpy.mock.calls[0]?.[0] as { text: () => string }
    const nextRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-behavior-memory-next-'))
    try {
      await mkdir(join(nextRoot, '.dsh', 'yantao', 'memory'), { recursive: true })
      await writeFile(join(nextRoot, '.dsh', 'yantao', 'memory', 'global.md'), '# 记忆 · 全局\n\n- 2026-01-01 换库后的规则\n', 'utf8')
      expect(registered.text()).not.toContain('换库后的规则')
      liveRoot = nextRoot
      expect(registered.text()).toContain('换库后的规则')
    } finally {
      await rm(nextRoot, { recursive: true, force: true })
    }
  })
})
