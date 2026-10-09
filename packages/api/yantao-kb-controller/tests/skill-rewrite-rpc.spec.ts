import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import { stripVersionChange } from '../src/capability/rewrite.ts'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }
let configured: boolean

/** 一份带 yantao 版本 nest 的 SKILL.md。 */
function skillMd(version: number | null): string {
  return [
    '---',
    'name: mail-reader',
    'description: 读邮件',
    ...(version === null ? [] : ['metadata:', '  yantao:', `    version: ${version}`]),
    '---',
    '',
    '# 读邮件',
    '',
    '按批次读。',
    '',
  ].join('\n')
}

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-srw-rpc-'))
  const dir = join(kbRoot, '.dsh', 'skills', 'mail-reader')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(3), 'utf8')
  await writeFile(join(dir, 'notes.md'), '原始笔记\n', 'utf8')
  await writeFile(
    join(kbRoot, '.dsh', 'skills', 'yantao.json'),
    JSON.stringify({ version: 1, capabilities: { 'mail-reader': { path: 'mail-reader', invocation: ['human', 'agent'] } } }),
    'utf8',
  )
  configured = true
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return configured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

describe('stripVersionChange（版本钳制单元）', () => {
  it('版本相同原样返回', () => {
    const raw = skillMd(3)
    expect(stripVersionChange(raw, raw)).toBe(raw)
  })

  it('bump 被扣回原版本的值', () => {
    const original = skillMd(3)
    const next = skillMd(4)
    expect(stripVersionChange(original, next)).toBe(original)
  })

  it('diff 删掉了整个 metadata.yantao nest——按原版重建三元组', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      '---',
      '',
      '# 读邮件',
      '',
      '按批次读。',
      '',
    ].join('\n')
    expect(stripVersionChange(original, next)).toBe(original)
  })

  it('diff 删掉了 version 行——插回 yantao nest 之下', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      'metadata:',
      '  yantao:',
      '---',
      '',
      '# 读邮件',
      '',
      '按批次读。',
      '',
    ].join('\n')
    expect(stripVersionChange(original, next)).toBe(original)
  })

  it('原版无版本而 diff 加了版本——写回时剥掉', () => {
    const original = skillMd(null)
    const next = skillMd(7)
    expect(stripVersionChange(original, next)).toBe(original)
  })

  it('外语 version 键不受牵连：只有 metadata.yantao 下的那个被钳制', () => {
    const original = [
      '---',
      'name: mail-reader',
      'version: 99',
      'metadata:',
      '  yantao:',
      '    version: 3',
      '---',
      '',
      '正文',
    ].join('\n')
    const next = original.replace('    version: 3', '    version: 5')
    const clamped = stripVersionChange(original, next)
    expect(clamped).toBe(original)
    expect(clamped).toContain('version: 99')
  })

  it('流式 metadata（parser 看得见、lexer 定位不了）——响亮拒绝', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      'metadata: { yantao: { version: 9 } }',
      '---',
      '',
      '按批次读。',
    ].join('\n')
    expect(() => stripVersionChange(original, next)).toThrow(/版本钳制无法.*无歧义地定位/)
  })

  it('yantao 用了更深的缩进——响亮拒绝', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      'metadata:',
      '    yantao:',
      '        version: 9',
      '---',
      '',
      '按批次读。',
    ].join('\n')
    expect(() => stripVersionChange(original, next)).toThrow(/无歧义地定位/)
  })

  it('version 行深缩进到八空格——响亮拒绝', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      'metadata:',
      '  yantao:',
      '        version: 9',
      '---',
      '',
      '按批次读。',
    ].join('\n')
    expect(() => stripVersionChange(original, next)).toThrow(/标准四空格位置/)
  })

  it('四空格 version 行其实挂在别的父键下——拒绝踩踏外语键', () => {
    const original = skillMd(3)
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件',
      'metadata:',
      '  yantao:',
      '  other:',
      '    version: 9',
      '---',
      '',
      '按批次读。',
    ].join('\n')
    expect(() => stripVersionChange(original, next)).toThrow(/不属于 YAML 里的 metadata\.yantao/)
  })

  it('diff 把 frontmatter 整个剥掉了——不再静默放过（M6 吸收）', () => {
    const original = skillMd(3)
    const next = ['', '# 读邮件', '', '按批次读。', ''].join('\n')
    expect(() => stripVersionChange(original, next)).toThrow(/frontmatter 无法解析/)
  })
})

describe('yantaoKb.skillRewriteApply', () => {
  it('批准写回：新内容落盘，原内容备份在 capability-backups 下', async () => {
    const result = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: '改好的笔记\n',
    })
    expect(result.file).toBe('notes.md')
    expect(result.backupPath).toMatch(/^\.dsh\/yantao\/capability-backups\/mail-reader\/.+\/notes\.md$/)
    await expect(readFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'notes.md'), 'utf8')).resolves.toBe('改好的笔记\n')
    const backupDisk = join(kbRoot, result.backupPath ?? '')
    await expect(readFile(backupDisk, 'utf8')).resolves.toBe('原始笔记\n')
  })

  it('SKILL.md 的版本 bump 被钳回原值，其余改动照常落盘', async () => {
    const next = [
      '---',
      'name: mail-reader',
      'description: 读邮件（改）',
      'metadata:',
      '  yantao:',
      '    version: 4',
      '---',
      '',
      '# 读邮件',
      '',
      '按线程读。',
      '',
    ].join('\n')
    const result = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'SKILL.md', original: skillMd(3), new: next,
    })
    expect(result.file).toBe('SKILL.md')
    const written = await readFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'SKILL.md'), 'utf8')
    expect(written).toContain('version: 3')
    expect(written).not.toContain('version: 4')
    expect(written).toContain('读邮件（改）')
    expect(written).toContain('按线程读。')
  })

  it('提名后又被人改过的文件拒绝（drift），盘上内容不动', async () => {
    await writeFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'notes.md'), '人改过了\n', 'utf8')
    const failure = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: '改好的笔记\n',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/又被改动/)
    await expect(readFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'notes.md'), 'utf8')).resolves.toBe('人改过了\n')
  })

  it('已注销的能力拒绝写回', async () => {
    await writeFile(
      join(kbRoot, '.dsh', 'skills', 'yantao.json'),
      JSON.stringify({ version: 1, capabilities: {} }),
      'utf8',
    )
    const failure = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: '改好的笔记\n',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/不在中央路由/)
  })

  it('file 越界与产物目录拒绝，且不产生备份', async () => {
    for (const file of ['../../escape.md', 'state/cursor.txt', '/abs.md']) {
      const failure = await ctx.yantaoKbController.skillRewriteApply({
        name: 'mail-reader', file, original: 'x', new: 'y',
      }).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    }
    await expect(readdir(join(kbRoot, '.dsh', 'yantao', 'capability-backups').replace(/\\/g, '/'))).rejects.toThrow()
  })

  it('二进制内容拒绝写回——两侧都查', async () => {
    await writeFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'blob.md'), 'a\0b', 'utf8')
    const failure = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'blob.md', original: 'a\0b', new: 'ab',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/二进制/)
    const poisoned = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: 'a\0b',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(poisoned)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((poisoned as Error).message).toMatch(/二进制/)
  })

  it('符号链接目标拒绝写回，不穿越出能力目录', async () => {
    const outside = join(kbRoot, 'outside.md')
    await writeFile(outside, '原始笔记\n', 'utf8')
    const link = join(kbRoot, '.dsh', 'skills', 'mail-reader', 'link.md')
    try {
      await symlink(outside, link)
    } catch {
      return // Windows 无开发者模式的环境造不了符号链接，跳过
    }
    const failure = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'link.md', original: '原始笔记\n', new: '改好的笔记\n',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/符号链接/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('原始笔记\n')
  })

  it('未配置 KB 根时拒绝', async () => {
    configured = false
    const failure = await ctx.yantaoKbController.skillRewriteApply({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: '改好的笔记\n',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/还没有选择知识库目录/)
  })
})
