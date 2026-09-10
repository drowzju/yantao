import { describe, expect, it } from 'vitest'
import {
  hasScheme, isOpenable, openCommand, OPENABLE_SCHEMES, schemeOf,
} from '../src/open.ts'

describe('open.schemeOf', () => {
  it('reads a scheme with its colon, lower-cased', () => {
    expect(schemeOf('obsidian://open?path=x')).toBe('obsidian:')
    expect(schemeOf('VSCode://file/x')).toBe('vscode:')
  })

  it('answers undefined for a bare path', () => {
    expect(schemeOf('entities/people/我自己.md')).toBeUndefined()
    // A colon inside a path is not a scheme: schemes start with a letter and
    // carry no slash before the colon.
    expect(schemeOf('entities/people/a:b.md')).toBeUndefined()
  })

  it('agrees with hasScheme', () => {
    for (const target of ['obsidian://x', 'entities/a.md']) {
      expect(hasScheme(target)).toBe(schemeOf(target) !== undefined)
    }
  })
})

describe('open.isOpenable', () => {
  it('accepts a plain KB-relative path', () => {
    expect(isOpenable('entities/people/我自己.md')).toBe(true)
    expect(isOpenable('resources/周报.eml')).toBe(true)
  })

  it('accepts every allowlisted scheme and nothing else', () => {
    for (const scheme of OPENABLE_SCHEMES) expect(isOpenable(`${scheme}whatever`)).toBe(true)
    expect(isOpenable('file:///etc/passwd')).toBe(false)
    expect(isOpenable('javascript:alert(1)')).toBe(false)
    expect(isOpenable('smb://host/share')).toBe(false)
  })

  // The bridge must not become a shell: the Windows route goes through
  // `cmd /c start`, so anything that could change the command line is refused.
  it('refuses shell metacharacters even inside an otherwise fine target', () => {
    expect(isOpenable('entities/a & calc.md')).toBe(false)
    expect(isOpenable('entities/a | calc.md')).toBe(false)
    expect(isOpenable('entities/a > b.md')).toBe(false)
    expect(isOpenable('obsidian://open?path=a^&b')).toBe(false)
    expect(isOpenable('obsidian://open?path=a\nstart calc')).toBe(false)
  })

  it('refuses the empty target', () => {
    expect(isOpenable('')).toBe(false)
    expect(isOpenable('   ')).toBe(false)
  })
})

describe('open.openCommand', () => {
  it('passes the target as one argument, never through a shell string', () => {
    const { command, args } = openCommand('obsidian://open?path=D%3A%2Fx.md')
    expect(command).toBeTypeOf('string')
    expect(args.at(-1)).toBe('obsidian://open?path=D%3A%2Fx.md')
    // No metacharacter ever reaches here (isOpenable rejects them), and POSIX
    // never invokes a shell because the arguments are an array.
    expect(args).not.toHaveLength(0)
  })
})
