import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'
import { EMPTY_OK_FIELDS as CLIENT_EMPTY_OK, KINDS as CLIENT_KINDS, REQUIRED_FIELDS as CLIENT_REQUIRED_FIELDS, deriveEntityName as CLIENT_DERIVE_ENTITY_NAME } from '../../../client/ui-yantao/src/client/capability-match.ts'
import { TRUNCATION_MARKER as CLIENT_TRUNCATION_MARKER } from '../../../client/ui-yantao/src/client/scheduler.ts'
import { deriveEntityName, EMPTY_OK_FIELDS, KINDS, mailSpanNote, normalizeMailRange, partitionProposedActions, REQUIRED_FIELDS, validateProposedActions, withDerivedEntityNames } from '../src/capability/proposal-actions.ts'
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
    // 整个缺席：照样点名，且诊断带最小合法示例（2026-10-10 补提事故：
    // 只点名不给形状，压缩后凭记忆重建漏了 entityPath，多赔了一张卡）
    expect(validateProposedActions([{ kind: 'append-log', entityName: 'x', text: 'y' }]))
      .toEqual(['第 1 项「append-log」缺必填字段 entityPath（该项形如 {"kind":"append-log","entityPath":"project:某项目","entityName":"某项目","text":"一条动态"}）'])
  })

  it('entityName 松绑（2026-10-15，本晨邮件调度两卡事故的治本）：带路径可不带名，双缺才点名', () => {
    // 三类实体落地动作：有路径无名——放行，展示名入库前由工具推导
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'project:某项目', text: '一条动态' }])).toEqual([])
    expect(validateProposedActions([{ kind: 'write-state', entityPath: '项目/x.md', text: '进行中' }])).toEqual([])
    expect(validateProposedActions([{ kind: 'create-link', entityPath: 'project:某项目', link: '[[x]]' }])).toEqual([])
    // entityName 在但不是非空字符串：同样放行（入库前推导覆盖，展示名不值得拦船）
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'project:某项目', entityName: '', text: 'x' }])).toEqual([])
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'project:某项目', entityName: 42, text: 'x' }])).toEqual([])
    // entityPath 空串且无名：没有尾段可推，entityName 回归必填（教学形状，防镜像补提）
    expect(validateProposedActions([{ kind: 'append-log', entityPath: '', text: 'x' }]))
      .toEqual(['第 1 项「append-log」的 entityPath 为空串时必须给 entityName（卡片靠它显示；形如 {"kind":"write-state","entityPath":"","entityName":"某项目","text":"当前状态一行"}）'])
    // entityPath 整个缺席：原有缺字段诊断照旧（EMPTY_OK 只赦免空串值，不赦免缺席）
    expect(validateProposedActions([{ kind: 'append-log', text: 'y' }])[0])
      .toContain('缺必填字段 entityPath')
  })

  it('entityPath 必须是可解析的实体定位：type:name 或实体路径（2026-10-13 周报流水事故）', () => {
    // 示例教的 locator 形态放行——applier 会经 resolveEntity 解析
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'project:某项目', entityName: '某项目', text: '一条动态' }])).toEqual([])
    // 实体文件路径放行；裸名字与目录值只能在落盘时哑死，这里就点名
    expect(validateProposedActions([{ kind: 'append-log', entityPath: '某项目', entityName: '某项目', text: 'x' }]))
      .toEqual(['第 1 项「append-log」的 entityPath 不是可解析的实体定位（应为 type:name 或实体文件路径，形如 {"kind":"append-log","entityPath":"project:某项目","entityName":"某项目","text":"一条动态"}）'])
    expect(validateProposedActions([{ kind: 'write-state', entityPath: '某项目', entityName: '某项目', text: 'x' }]))
      .toEqual(['第 1 项「write-state」的 entityPath 不是可解析的实体定位（应为 type:name 或实体文件路径，形如 {"kind":"write-state","entityPath":"","entityName":"某项目","text":"当前状态一行"}）'])
    // 非实体类动作不受此约束
    expect(validateProposedActions([{ kind: 'save-resource', path: '某项目', content: 'x' }])).toEqual([])
  })
})

describe('溯源字段与校验 A（ADR-0059 决定 1/2：内容与出处重叠核对）', () => {
  // 袁文茂事故样本回放（ADR-0059 出发点）：text 的 token 全部命中的其实是
  // 周我要的周报文件，却声称来源是袁文茂的纪要——张冠李戴，校验 A 拦下。
  const ZHOU_SOURCE = '# 周我要周报 2026-W41\n本周 MCA-255 网关黑洞定位完成，压测吞吐提升 37%，QPS 达 12000。'
  const YUAN_SOURCE = '# 袁文茂 一对一\n讨论了晋升材料与团队梯队，下周跟进调薪流程。'

  const reader = (files: Record<string, string>) =>
    (path: string): string | null => files[path] ?? null

  it('内容 token 与声称来源重叠：放行', () => {
    const action = {
      kind: 'append-log', entityPath: 'project:x', entityName: 'x',
      text: 'MCA-255 网关黑洞定位完成，吞吐提升 37%', sourcePath: 'resources/周我要.md',
    }
    expect(validateProposedActions([action], reader({ 'resources/周我要.md': ZHOU_SOURCE }))).toEqual([])
  })

  it('袁文茂张冠李戴回放：token 命中另一文件，被判坏项（校验 A）', () => {
    const action = {
      kind: 'append-log', entityPath: 'person:袁文茂', entityName: '袁文茂',
      text: 'MCA-255 网关黑洞定位完成，压测吞吐提升 37%', sourcePath: 'resources/袁文茂.md',
    }
    const diagnostics = validateProposedActions([action], reader({
      'resources/袁文茂.md': YUAN_SOURCE,
      'resources/周我要.md': ZHOU_SOURCE,
    }))
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('校验 A')
    expect(diagnostics[0]).toContain('重叠过低')
    expect(diagnostics[0]).toContain('resources/袁文茂.md')
    // 逐项容错的同一裁决：坏项走 dropped 通道，不整批退回
    const { valid, diagnostics: dropped } = partitionProposedActions([action], reader({ 'resources/袁文茂.md': YUAN_SOURCE }))
    expect(valid).toEqual([])
    expect(dropped).toHaveLength(1)
  })

  it('来源读不到、纯中文零 token、无 readSource 接缝：都不判罪', () => {
    const chinese = { kind: 'append-log', entityPath: 'person:x', entityName: 'x', text: '讨论了晋升材料与团队氛围', sourcePath: 'resources/袁文茂.md' }
    expect(validateProposedActions([chinese], reader({ 'resources/袁文茂.md': YUAN_SOURCE }))).toEqual([])
    const unreadable = { kind: 'append-log', entityPath: 'person:x', entityName: 'x', text: 'MCA-255 完成 37%', sourcePath: 'resources/不存在.md' }
    expect(validateProposedActions([unreadable], reader({}))).toEqual([])
    expect(validateProposedActions([unreadable])).toEqual([])
  })

  it('sourcePath/sourceQuote 形状不诚实被点名；纯决策类动作不得携带（豁免条款）', () => {
    // 空串与非字符串都点名
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'person:x', entityName: 'x', text: 'y', sourcePath: '' }]))
      .toEqual(['第 1 项「append-log」的 sourcePath 出现了但不是非空字符串——要么不带，要么给出来源资源的路径'])
    expect(validateProposedActions([{ kind: 'write-state', entityPath: 'person:x', entityName: 'x', text: 'y', sourceQuote: 42 }])[0])
      .toContain('sourceQuote 出现了但不是非空字符串')
    // add-todo 是纯决策类：不要求溯源，也不许装饰来源
    expect(validateProposedActions([{ kind: 'add-todo', title: 't', body: 'b', sourcePath: 'resources/x.md' }])[0])
      .toContain('不携带溯源字段 sourcePath')
    // 带 sourceQuote 的合法样本照样放行
    expect(validateProposedActions([{
      kind: 'append-log', entityPath: 'person:袁文茂', entityName: '袁文茂',
      text: '讨论了晋升材料', sourcePath: 'resources/袁文茂.md', sourceQuote: '讨论了晋升材料',
    }], reader({ 'resources/袁文茂.md': YUAN_SOURCE }))).toEqual([])
  })

  it('溯源字段是可选的：不带照样过（强制在调度约定层，不由工具层执法）', () => {
    expect(validateProposedActions([{ kind: 'append-log', entityPath: 'person:x', entityName: 'x', text: 'y' }])).toEqual([])
  })
})

describe('partitionProposedActions（2026-10-10 裁决：逐项容错，一跑一卡的船不再整沉）', () => {
  const VALID_APPEND_LOG = { kind: 'append-log', entityPath: '项目/dsh 学习.md', entityName: 'dsh 学习', text: '有进展' }
  const VALID_DELETE_MAIL = { kind: 'delete-mails', entryId: 'a', sender: 's@example.com', subject: '周报' }

  it('好坏混合：合格项原样通过，坏项点名进诊断', () => {
    const { valid, diagnostics } = partitionProposedActions([
      VALID_DELETE_MAIL,
      { kind: 'delete-mails', mailIds: ['x'] },
      '不是对象',
      VALID_APPEND_LOG,
    ])
    expect(valid).toEqual([VALID_DELETE_MAIL, VALID_APPEND_LOG])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toContain('缺必填字段 entryId、sender、subject')
    expect(diagnostics[1]).toContain('第 3 项不是对象')
  })

  it('空数组：零合格 + 空输入诊断，与 validateProposedActions 同词', () => {
    expect(partitionProposedActions([]))
      .toEqual({ valid: [], diagnostics: ['actions 不能为空——没有值得提议的就不要调用本工具'] })
  })

  it('全坏：valid 为空，诊断齐全', () => {
    const { valid, diagnostics } = partitionProposedActions([{ kind: 'format-disk' }])
    expect(valid).toEqual([])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('不是已知的动作类别')
  })

  it('无名的实体行原样通过分区（注名发生在工具入库前，不在分区里改写）', () => {
    const nameless = { kind: 'append-log', entityPath: 'project:x', text: '进展' }
    const { valid, diagnostics } = partitionProposedActions([
      nameless,
      { kind: 'append-log', entityPath: '', text: 'x' },
    ])
    expect(valid).toEqual([nameless])
    expect(diagnostics).toHaveLength(1)
  })

  it('邮件刀的 entryId 填成 40 位指纹（sha1 去重键 id）被点名剔除（2026-10-19 零写入事故防线）', () => {
    const fingerprint = 'ddc60250d9f6de98d41a6bdd73af8f19465d4b61'
    const entryId = '00000000BC25E032A7F9B34982D76BE86185042E0700A7A91D5B974D3141B8F1D93686ED431800000000010C000095A6EC9EAA0FBE42BF8917053EA39ADF0003B61C2BF80000'
    const { valid, diagnostics } = partitionProposedActions([
      { kind: 'delete-mails', entryId: fingerprint, sender: 'Microsoft Outlook', subject: '邮箱快满了。' },
      { kind: 'archive-mails', entryId: fingerprint.toUpperCase(), sender: '徐军2', subject: '现状报告' },
      { kind: 'delete-mails', entryId, sender: '张旭卫', subject: '周报' },
      { kind: 'archive-mails', entryId: 'a', sender: '徐军2', subject: '现状报告' },
    ])
    // 真 EntryID（长串）与短样本照常通过；40 位指纹（含大写形态）双双点名
    expect(valid).toHaveLength(2)
    expect(diagnostics).toHaveLength(2)
    for (const line of diagnostics) {
      expect(line).toContain('40 位指纹')
      expect(line).toContain('entryId 字段')
    }
  })
})

describe('withDerivedEntityNames / deriveEntityName（2026-10-15 松绑：展示名推导）', () => {
  it('deriveEntityName：locator 取首个分隔符后的尾段，.md 取基名去后缀', () => {
    expect(deriveEntityName('project:某项目')).toBe('某项目')
    expect(deriveEntityName(' project：某项目 ')).toBe('某项目')
    expect(deriveEntityName('entities/projects/飞书迁移.md')).toBe('飞书迁移')
    expect(deriveEntityName('entities\\people\\张三.md')).toBe('张三')
  })

  it('withDerivedEntityNames：无名的实体行注入推导名，有名行/空路径行/非实体行原样', () => {
    const named = { kind: 'append-log', entityPath: 'project:x', entityName: '自定义名', text: 't' }
    const nameless = { kind: 'append-log', entityPath: 'entities/projects/x.md', text: '进展' }
    const emptyNamed = { kind: 'write-state', entityPath: 'person:袁文茂', entityName: '', text: 's' }
    const todo = { kind: 'add-todo', title: 't', body: 'b' }
    const emptyPath = { kind: 'append-log', entityPath: '', entityName: '手填名', text: 'x' }
    expect(withDerivedEntityNames([named, nameless, emptyNamed, todo, emptyPath])).toEqual([
      named,
      { kind: 'append-log', entityPath: 'entities/projects/x.md', entityName: 'x', text: '进展' },
      { kind: 'write-state', entityPath: 'person:袁文茂', entityName: '袁文茂', text: 's' },
      todo,
      emptyPath,
    ])
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

  it('deriveEntityName 与客户端实现一致（2026-10-15 松绑的共用引擎）', () => {
    for (const path of ['project:某项目', ' project：某项目 ', 'entities/projects/飞书迁移.md', 'entities\\people\\张三.md', '某项目']) {
      expect(deriveEntityName(path)).toBe(CLIENT_DERIVE_ENTITY_NAME(path))
    }
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
    // kb_read_session_log reads through the session controller; these tests never call it.
    ctx.provide('sessionController', { follow: () => (async function* () {})(), page: async () => ({ records: [], hasMore: false }) } as never)
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

  it('无 entityName 的实体行照常入队，展示名从 entityPath 推导注入（2026-10-15 松绑）', async () => {
    await tool().execute({
      title: '无名提名',
      actions: [{ kind: 'append-log', entityPath: 'entities/projects/x.md', text: '有进展' }],
    }, {} as never) as { id: string }
    const listed = await ctx.yantaoKbController.proposalInboxList()
    const proposal = listed.proposals[0]?.proposal as { actions: Array<{ entityName?: string }> }
    expect(proposal.actions[0]?.entityName).toBe('x')
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
    }, {} as never)).rejects.toThrow(/没有一项合格/)
    await expect(tool().execute({ title: '空提议', actions: [] }, {} as never)).rejects.toThrow(/actions 不能为空/)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(0)
  })

  it('混合提名逐项容错：合格项入队，坏项点名随结果带回（2026-10-10 裁决）', async () => {
    const result = await tool().execute({
      title: '好坏混合',
      actions: [
        { kind: 'delete-mails', entryId: 'a', sender: 's@example.com', subject: '周报' },
        { kind: 'delete-mails', mailIds: ['x'] },
        { kind: 'format-disk' },
        { kind: 'append-log', entityPath: '项目/x.md', entityName: 'x', text: '有进展' },
      ],
    }, {} as never) as { id: string; dropped?: readonly string[] }
    expect(result.id).toMatch(/^prp_/)
    expect(result.dropped).toHaveLength(2)
    expect(result.dropped?.[0]).toContain('缺必填字段 entryId、sender、subject')
    expect(result.dropped?.[0]).toContain('形如 {"kind":"delete-mails"')
    expect(result.dropped?.[1]).toContain('不是已知的动作类别')
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    const proposal = listed.proposals[0]?.proposal as { actions: readonly unknown[] }
    expect(proposal.actions).toHaveLength(2)
  })
})
