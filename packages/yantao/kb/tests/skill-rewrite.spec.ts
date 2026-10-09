import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROPOSAL_INBOX_DISPLAY_PATH, readProposalInbox } from '../src/proposal-inbox.ts'
import { SKILL_REWRITE_SOURCE, proposeSkillRewrite } from '../src/skill-rewrite.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

const SKILL_MD = [
  '---',
  'name: mail-reader',
  'description: 读邮件',
  'metadata:',
  '  yantao:',
  '    version: 3',
  '---',
  '',
  '# 读邮件',
  '',
  '按批次读。',
  '',
].join('\n')

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-srw-'))
  // 一个已注册能力：SKILL.md + 附属说明 + 运行产物目录。
  const dir = join(kbRoot, '.dsh', 'skills', 'mail-reader')
  await mkdir(join(dir, 'state'), { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), SKILL_MD, 'utf8')
  await writeFile(join(dir, 'notes.md'), '原始笔记\n', 'utf8')
  await writeFile(join(dir, 'state', 'cursor.txt'), '3\n', 'utf8')
  await writeFile(
    join(kbRoot, '.dsh', 'skills', 'yantao.json'),
    JSON.stringify({ version: 1, capabilities: { 'mail-reader': { path: 'mail-reader', invocation: ['human', 'agent'] } } }),
    'utf8',
  )
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

function nomination(overrides: Partial<Parameters<typeof proposeSkillRewrite>[1]> = {}): Parameters<typeof proposeSkillRewrite>[1] {
  return {
    name: 'mail-reader',
    file: 'notes.md',
    original: '原始笔记\n',
    new: '改好的笔记\n',
    why: '流程变了',
    ...overrides,
  }
}

describe('proposeSkillRewrite', () => {
  it('合法提名入 ADR-0047 收件箱，载荷带完整 diff 信封', async () => {
    const result = await proposeSkillRewrite(kbRoot, nomination())
    expect(result.pending).toBe(1)
    const rows = await readProposalInbox(kbRoot)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: `${SKILL_REWRITE_SOURCE}:mail-reader`,
      sourceName: 'mail-reader',
      title: '改写能力「mail-reader」的 notes.md',
      status: 'pending',
    })
    expect(rows[0]?.proposal).toEqual({
      title: '改写能力「mail-reader」的 notes.md',
      actions: [{ kind: 'skill-rewrite', name: 'mail-reader', file: 'notes.md', original: '原始笔记\n', new: '改好的笔记\n', why: '流程变了' }],
    })
  })

  it('反斜杠路径归一为正斜杠', async () => {
    await proposeSkillRewrite(kbRoot, nomination({ file: '.\\notes.md' }))
    const rows = await readProposalInbox(kbRoot)
    expect(rows[0]?.proposal).toMatchObject({ actions: [{ file: 'notes.md' }] })
  })

  it('未注册的能力拒绝（skill-not-routed）', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ name: 'ghost' }))).rejects.toMatchObject({ code: 'skill-not-routed' })
  })

  it('路由文件缺失拒绝（skill-not-routed）', async () => {
    await rm(join(kbRoot, '.dsh', 'skills', 'yantao.json'))
    await expect(proposeSkillRewrite(kbRoot, nomination())).rejects.toBeInstanceOf(KbError)
  })

  it('路由 path 越界（绝对路径 / ..）拒绝', async () => {
    const routes = join(kbRoot, '.dsh', 'skills', 'yantao.json')
    await writeFile(routes, JSON.stringify({ version: 1, capabilities: { evil: { path: '../outside', invocation: ['agent'] } } }), 'utf8')
    await expect(proposeSkillRewrite(kbRoot, nomination({ name: 'evil' }))).rejects.toMatchObject({ code: 'skill-not-routed' })
  })

  it('file 越出能力目录拒绝（bad-skill-file）', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ file: '../../outside.md' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
    await expect(proposeSkillRewrite(kbRoot, nomination({ file: '/etc/passwd' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
  })

  it('运行产物目录黑名单拒绝（state/ 等）', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ file: 'state/cursor.txt' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
  })

  it('不存在的文件拒绝（skill-file-not-found）——只提名已有文件', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ file: 'absent.md' }))).rejects.toMatchObject({ code: 'skill-file-not-found' })
  })

  it('二进制内容（NUL 字节）拒绝（skill-file-binary）', async () => {
    await writeFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'blob.md'), 'a\0b', 'utf8')
    await expect(proposeSkillRewrite(kbRoot, nomination({ file: 'blob.md', original: 'a\0b' })))
      .rejects.toMatchObject({ code: 'skill-file-binary' })
  })

  it('original 与现内容漂移拒绝（skill-file-drifted）', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ original: '过期的原文\n' })))
      .rejects.toMatchObject({ code: 'skill-file-drifted' })
  })

  it('original 与 new 相同拒绝（skill-rewrite-empty）——无 diff 不成卡', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ new: '原始笔记\n' })))
      .rejects.toMatchObject({ code: 'skill-rewrite-empty' })
  })

  it('空 name / 空 why / 空 original / 空 new 拒绝', async () => {
    await expect(proposeSkillRewrite(kbRoot, nomination({ name: '  ' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
    await expect(proposeSkillRewrite(kbRoot, nomination({ why: '  ' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
    await expect(proposeSkillRewrite(kbRoot, nomination({ original: '' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
    await expect(proposeSkillRewrite(kbRoot, nomination({ new: '' }))).rejects.toMatchObject({ code: 'bad-skill-file' })
  })

  it('单边超 20 万字拒绝（skill-file-too-large）', async () => {
    const big = 'x'.repeat(200_001)
    await expect(proposeSkillRewrite(kbRoot, nomination({ new: big }))).rejects.toMatchObject({ code: 'skill-file-too-large' })
  })

  it('提名不落盘：目标文件保持原字节', async () => {
    await proposeSkillRewrite(kbRoot, nomination())
    await expect(readFile(join(kbRoot, '.dsh', 'skills', 'mail-reader', 'notes.md'), 'utf8')).resolves.toBe('原始笔记\n')
    expect(await readFile(join(kbRoot, PROPOSAL_INBOX_DISPLAY_PATH), 'utf8')).toContain('skill-rewrite')
  })
})
