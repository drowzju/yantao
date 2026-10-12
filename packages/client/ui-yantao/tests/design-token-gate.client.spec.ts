/**
 * 设计令牌门禁（DESIGN.md §9 的机器化，2026-10-12 评审 P2-1）：token 迁移
 * 完成后，§9 承诺的闸门在此落闸——src/client 下（brand/ 品牌标豁免）：
 *
 * 1. 字号必须走 `--yt-type-*` 阶梯：`fontSize` 不许出现数字字面量，也不许
 *    出发 `var(--yt-type-…)` 之外的字符串（`inherit` 除外）。
 * 2. 间距（padding、margin、gap 及四方各族）不许出现裸 px：一律走 `--yt-space-*`
 *    阶梯（0 与负值的 `calc(-1 * var(…))` 例外）。
 * 3. 颜色不许裸 hex：语义一律走 `--yt-*` token。
 *
 * 新代码违反任何一条即 CI 红——和 hover-gate 一样，把约定变成机器检查，
 * 不再指望下一轮评审人眼扫出来。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const CLIENT_DIR = fileURLToPath(new URL('../src/client', import.meta.url))

const SPACING_PROPS = new Set([
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'gap', 'rowGap', 'columnGap',
])

const COLOR_PROPS = new Set([
  'color', 'background', 'backgroundColor', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'outlineColor', 'fill', 'stroke', 'caretColor', 'textDecorationColor',
])

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'brand') continue // 品牌标是画，不走令牌（豁免）。
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

function propertyName(property: ts.PropertyAssignment): string | undefined {
  const name = property.name
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

function findTokenViolations(source: string): { line: number; message: string }[] {
  const violations: { line: number; message: string }[] = []
  const sourceFile = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node)
      const init = node.initializer
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      if (name !== undefined && SPACING_PROPS.has(name)) {
        if (ts.isStringLiteral(init) && /\d+px/u.test(init.text)) {
          violations.push({ line: line + 1, message: `${name}: '${init.text}' 含裸 px——请走 --yt-space-* 阶梯` })
        } else if (ts.isNumericLiteral(init) && init.getText() !== '0') {
          violations.push({ line: line + 1, message: `${name}: ${init.getText()} 是裸数字——请走 --yt-space-* 阶梯` })
        }
      }
      if (name === 'fontSize') {
        if (ts.isNumericLiteral(init)) {
          violations.push({ line: line + 1, message: `fontSize: ${init.getText()} 是裸数字——请走 --yt-type-* 阶梯` })
        } else if (ts.isStringLiteral(init) && init.text !== 'inherit' && !init.text.startsWith('var(--yt-type-')) {
          violations.push({ line: line + 1, message: `fontSize: '${init.text}' 不在 --yt-type-* 阶梯上` })
        }
      }
      if (name !== undefined && COLOR_PROPS.has(name) && ts.isStringLiteral(init) && /^#[0-9a-fA-F]{3,8}$/u.test(init.text)) {
        violations.push({ line: line + 1, message: `${name}: '${init.text}' 是裸 hex——请走 --yt-* 语义 token` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

describe('design token gate (DESIGN.md §9)', () => {
  it('spacing rides --yt-space-*, font sizes ride --yt-type-*, colors ride --yt-* (brand/ exempt)', () => {
    const failures: string[] = []
    for (const file of collectSourceFiles(CLIENT_DIR)) {
      const source = readFileSync(file, 'utf8')
      for (const violation of findTokenViolations(source)) {
        failures.push(`${file}:${violation.line} ${violation.message}`)
      }
    }
    expect(failures).toEqual([])
  })
})
