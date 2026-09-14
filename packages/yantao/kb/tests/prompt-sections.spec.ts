import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { loadSectionText, registerPromptSections, YANTAO_SECTIONS } from '../src/sections.ts'

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
