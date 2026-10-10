import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'
import { EMPTY_OK_FIELDS as CLIENT_EMPTY_OK, KINDS as CLIENT_KINDS, REQUIRED_FIELDS as CLIENT_REQUIRED_FIELDS } from '../../../client/ui-yantao/src/client/capability-match.ts'
import { TRUNCATION_MARKER as CLIENT_TRUNCATION_MARKER } from '../../../client/ui-yantao/src/client/scheduler.ts'
import { EMPTY_OK_FIELDS, KINDS, mailSpanNote, normalizeMailRange, REQUIRED_FIELDS, validateProposedActions } from '../src/capability/proposal-actions.ts'
import { TRUNCATION_MARKER as EXEC_TRUNCATION_MARKER } from '../src/capability/exec.ts'

describe('validateProposedActions（ADR-0055 提名工具的服务端校验）', () => {
  const VALID_APPEND_LOG = { kind: 'append-log', entityPath: '项目/dsh 学习.md', entityName: 'dsh 学习', text: '有进展' }

  it('合法动作表通过（返回空诊断）', () => {
    expect(validateProposedActions([VALID_APPEND_LOG])).toEqual([])
  })

  it('空数组与非对象项都被点名', () => {
    expect(validateProposedActions([])).toEqual(['actions 不能为空——没有值得提议的就不要调用本工具'])
    const diagnostics = validateProposedActions(['不是对象', VALID_APPEND_LOG])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('第 1 项不是对象')
  })

  it('未知 kind 与缺必填字段都逐项报出，不改写不剔除', () => {
    const diagnostics = validateProposedActions([
      { kind: 'format-disk' },
      // entityPath 空串在 EMPTY_OK 名单里放行；text 空串不在，照样点名
      { kind: 'append-log', entityPath: '', entityName: 'x', text: '' },
      VALID_APPEND_LOG,
    ])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toContain('不是已知的动作类别')
    expect(diagnostics[1]).toContain('「append-log」缺必填字段 text')
  })

  it('EMPTY_OK 字段允许空串（待后补的实体路径），缺席仍算缺', () => {
    expect(EMPTY_OK_FIELDS.has('append-log:entityPath')).toBe(true)
    // entityPath 显式空串：在 EMPTY_OK 名单里，放行
    expect(validateProposedActions([{ kind: 'append-log', entityPath: '', entityName: 'x', text: 'y' }])).toEqual([])
    // 整个缺席：照样点名
    expect(validateProposedActions([{ kind: 'append-log', entityName: 'x', text: 'y' }]))
      .toEqual(['第 1 项「append-log」缺必填字段 entityPath'])
  })
})

describe('normalizeMailRange / mailSpanNote（水位范围的规范化与展示）', () => {
  it('松散时间戳规范化为 ISO Z 戳，缺 firstReadAt 可省', () => {
    expect(normalizeMailRange({ lastReadAt: '2026-10-01T06:23:54Z' }))
      .toEqual({ lastReadAt: '2026-10-01T06:23:54.000Z' })
    expect(normalizeMailRange({ lastReadAt: '2026/10/01 06:23', firstReadAt: '2026-09-17T06:23:54Z' }))
      .toEqual({ lastReadAt: new Date('2026/10/01 06:23').toISOString(), firstReadAt: '2026-09-17T06:23:54.000Z' })
  })

  it('缺 lastReadAt、非对象、乱串都是没有范围', () => {
    expect(normalizeMailRange(undefined)).toBeUndefined()
    expect(normalizeMailRange('乱写')).toBeUndefined()
    expect(normalizeMailRange({ firstReadAt: '2026-09-17' })).toBeUndefined()
    expect(normalizeMailRange({ lastReadAt: '' })).toBeUndefined()
  })

  it('mailSpanNote 与调度器 inboxNoteOf 同款措辞', () => {
    expect(mailSpanNote({ lastReadAt: '2026-10-01T06:23:54.000Z', firstReadAt: '2026-09-17T06:23:54.000Z' }))
      .toMatch(/^覆盖邮件 \d+-\d+ → \d+-\d+$/)
    expect(mailSpanNote({ lastReadAt: '2026-10-01T06:23:54.000Z' })).toMatch(/^覆盖邮件 \d+-\d+$/)
    expect(mailSpanNote(undefined)).toBeUndefined()
  })
})

describe('与客户端词汇表的 parity（ADR-0055：孪生表不许漂移）', () => {
  it('KINDS / REQUIRED_FIELDS / EMPTY_OK_FIELDS 与 capability-match 完全一致', () => {
    expect([...KINDS]).toEqual([...CLIENT_KINDS])
    expect(REQUIRED_FIELDS).toEqual(CLIENT_REQUIRED_FIELDS)
    expect([...EMPTY_OK_FIELDS]).toEqual([...CLIENT_EMPTY_OK])
  })

  it('TRUNCATION_MARKER 覆盖客户端的截断探测子串（ocr 评审 #8）', () => {
    // The scheduler counts truncations by probing tool-result text for ITS
    // marker; the exec bridge appends ITS marker. The latter must contain
    // the former, or a wording drift silently zeroes the counter.
    expect(EXEC_TRUNCATION_MARKER).toContain(CLIENT_TRUNCATION_MARKER)
  })

  it('每个已知 kind 的合法样本都能过校验、缺一字段就被点名', () => {
    const SAMPLES: Record<string, Record<string, string>> = {
      'create-entity': { entityType: 'person', name: '某人' },
      'create-project': { name: '某项目' },
      'append-log': { entityPath: '项目/x.md', entityName: 'x', text: '进展' },
      'write-state': { entityPath: '项目/x.md', entityName: 'x', text: '进行中' },
      'save-resource': { path: 'resources/x.md', content: '全文' },
      'create-link': { entityPath: '项目/x.md', entityName: 'x', link: '人/某人.md' },
      'add-todo': { title: '题目', body: '详情' },
      'edit-section': { path: '项目/x.md', section: '决议', after: '改为', why: '缘由' },
      'append-section': { path: '项目/x.md', section: '待办', text: '内容' },
      'add-memory': { scope: 'mail', text: '规则' },
      'delete-mails': { entryId: 'a', sender: 's@example.com', subject: '周报' },
      'archive-mails': { entryId: 'a', sender: 's@example.com', subject: '周报' },
      'skill-rewrite': { name: 'mail', file: 'SKILL.md', original: '旧', new: '新', why: '缘由' },
    }
    for (const kind of CLIENT_KINDS) {
      const sample = SAMPLES[kind]
      expect(sample, `sample missing for kind ${kind}`).toBeDefined()
      expect(validateProposedActions([{ kind, ...sample }])).toEqual([])
      const required = CLIENT_REQUIRED_FIELDS[kind] ?? []
      if (required.length > 0) {
        const stripped = Object.fromEntries(Object.entries(sample).slice(1))
        const diagnostics = validateProposedActions([{ kind, ...stripped }])
        expect(diagnostics[0]).toContain('缺必填字段')
      }
    }
  })
})

/** The tool-level harness: same stand-ins as the RPC spec, but the tool
 * registry captures definitions so `kb_propose_actions` can be driven. */
describe('kb_propose_actions 工具（注册面 + 入队）', () => {
  let kbRoot: string
  let ctx: Context
  let fiber: { dispose(): Promise<void> }
  let registered: ToolDefinition[]

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-propose-tool-'))
    ctx = new Context()
    ctx.provide('yantaoKb', {
      get root(): string {
        return kbRoot
      },
      get configured(): boolean {
        return true
      },
      setRoot(): void {},
    } satisfies YantaoKbService)
    ctx.provide('skills', { get: async () => undefined } as never)
    registered = []
    ctx.provide('tools', { register: (definition: ToolDefinition) => { registered.push(definition) } } as never)
    fiber = await ctx.plugin(YantaoKbController)
  })

  afterEach(async () => {
    await fiber.dispose()
    await rm(kbRoot, { recursive: true, force: true })
  })

  function tool(): ToolDefinition {
    const found = registered.find(entry => entry.name === 'kb_propose_actions')
    expect(found).toBeDefined()
    return found as ToolDefinition
  }

  it('合法提议入队，缺省来源是 agent:kb_propose_actions', async () => {
    const result = await tool().execute({
      title: '晨检发现',
      actions: [{ kind: 'append-log', entityPath: '项目/x.md', entityName: 'x', text: '有进展' }],
    }, {} as never) as { id: string }
    expect(result.id).toMatch(/^prp_/)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    expect(listed.proposals[0]).toMatchObject({
      status: 'pending',
      source: 'agent:kb_propose_actions',
      sourceName: '会话提议',
      title: '晨检发现',
    })
  })

  it('source/sourceName/note/mails 透传入队，水位规范化并写进 note', async () => {
    await tool().execute({
      title: '邮件清理',
      actions: [{ kind: 'delete-mails', entryId: 'a', sender: 's@example.com', subject: '周报' }],
      note: '已核对发件人',
      mails: { lastReadAt: '2026-10-01T06:23:54Z', firstReadAt: '2026-09-17T06:23:54Z' },
      source: 'schedule:sch_abc123def',
      sourceName: '晨检',
    }, {} as never)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals[0]).toMatchObject({ source: 'schedule:sch_abc123def', sourceName: '晨检' })
    expect(listed.proposals[0]?.note).toContain('已核对发件人')
    expect(listed.proposals[0]?.note).toContain('覆盖邮件')
    const proposal = listed.proposals[0]?.proposal as { mails?: { lastReadAt?: string } }
    expect(proposal.mails?.lastReadAt).toBe('2026-10-01T06:23:54.000Z')
  })

  it('非法动作整单拒绝并入队零痕迹，诊断点名每一项', async () => {
    await expect(tool().execute({
      title: '坏提议',
      actions: [{ kind: 'delete-mails', mailIds: ['a', 'b'] }, { kind: 'format-disk' }],
    }, {} as never)).rejects.toThrow(/缺必填字段 entryId、sender、subject/)
    await expect(tool().execute({ title: '空提议', actions: [] }, {} as never)).rejects.toThrow(/actions 不能为空/)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(0)
  })
})
