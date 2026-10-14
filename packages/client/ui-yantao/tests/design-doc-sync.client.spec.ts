/**
 * DESIGN.md frontmatter 与 yt-tokens.ts 的镜像 pin（2026-10-14 impeccable
 * 第三轮 P2 修复）：文档曾三次与代码漂移——text-muted 停留在 2026-10-05
 * 对比度修订前的旧值、warning-text 同病、§2.5 暗色 error 也未跟上提亮。
 * 漂移的危险在于方向反噬：照文档改代码会把刻意调过的对比度改回不达标。
 * 此测试把「以代码为准」变成机器门禁：frontmatter colors 段的每个值必须
 * 与 YT_COLOR_TOKENS.light 一致，缺键、多键、值不符都算红。
 * （投影两档是阴影不是颜色，不收进 frontmatter，故比对时豁免。）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { YT_COLOR_TOKENS } from '../src/client/frame/yt-tokens.ts'

const DESIGN_MD = fileURLToPath(new URL('../../../../apps/yantao/DESIGN.md', import.meta.url))

/** Parse the frontmatter's colors block into a token → value map. */
function frontmatterColors(markdown: string): Record<string, string> {
  const match = /^---\n(?<frontmatter>[\s\S]*?)\n---/u.exec(markdown)
  if (match?.groups === undefined) throw new Error('DESIGN.md 缺少 frontmatter')
  const lines = match.groups.frontmatter.split('\n')
  const colors: Record<string, string> = {}
  let inColors = false
  for (const line of lines) {
    if (/^colors:/u.test(line)) { inColors = true; continue }
    if (inColors && /^\S/u.test(line)) break // 下一个顶层键（typography:）即出 colors 段
    const entry = /^\s{2}(?<key>[\w-]+):\s+"(?<value>[^"]+)"\s*$/u.exec(line)
    if (inColors && entry?.groups !== undefined) colors[`--yt-${entry.groups.key}`] = entry.groups.value
  }
  return colors
}

describe('DESIGN.md frontmatter mirrors yt-tokens.ts (2026-10-14 防漂移 pin)', () => {
  it('every light color token matches, with no missing or extra keys (shadows exempt)', () => {
    const documented = frontmatterColors(readFileSync(DESIGN_MD, 'utf8'))
    const canonical = Object.fromEntries(
      Object.entries(YT_COLOR_TOKENS.light).filter(([token]) => !token.startsWith('--yt-shadow-')),
    )
    expect(documented).toEqual(canonical)
  })
})
