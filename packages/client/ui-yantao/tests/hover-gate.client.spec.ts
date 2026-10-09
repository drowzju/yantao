/**
 * Hover-feedback coverage gate (2026-10-09 评审 P1-A)：全局 hover 层
 * （theme-presenter 的 FOCUS_RING_CSS）靠 `data-hover` 属性命中按钮，
 * 选择性加入意味着新组件天然漏网——上两轮评审的同一病灶两次复发。
 * 本测试把约定变成机器检查：src/client 下每个 `<button>` JSX 必须携带
 * `data-hover`，否则 CI 红。新增按钮时补一个属性即可过闸。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const CLIENT_DIR = fileURLToPath(new URL('../src/client', import.meta.url))

function collectTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectTsxFiles(full, acc)
    else if (entry.name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

/** A `<button` opening/self-closing JSX element misses `data-hover`? */
function findButtonViolations(source: string): { line: number }[] {
  const violations: { line: number }[] = []
  const sourceFile = ts.createSourceFile('scan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'button') {
      const hasHover = node.attributes.properties.some(
        property => ts.isJsxAttribute(property) && property.name.getText() === 'data-hover',
      )
      if (!hasHover) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        violations.push({ line: line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

describe('hover coverage gate', () => {
  it('every <button> element carries data-hover so the global hover layer reaches it', () => {
    const failures: string[] = []
    for (const file of collectTsxFiles(CLIENT_DIR)) {
      const source = readFileSync(file, 'utf8')
      for (const violation of findButtonViolations(source)) {
        failures.push(`${file}:${violation.line}`)
      }
    }
    expect(failures).toEqual([])
  })
})
