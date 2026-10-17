import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectDingtalkBindings, dingtalkStateDir } from '../src/dingtalk-bindings.ts'

describe('collectDingtalkBindings（ADR-0061 决定 2：连接器绑定簿的总读面）', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'yantao-dingtalk-bindings-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  async function seed(relative: string, content: string): Promise<void> {
    const target = join(base, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }

  it('三族存储全收：默认机器人、accounts/*、digital-employees/*', async () => {
    await seed('bindings.json', JSON.stringify({ cid_default: 'sess_a' }))
    await seed('accounts/yantao-web/bindings.json', JSON.stringify({ cid_web: 'sess_b' }))
    await seed('digital-employees/uuid-1/bindings.json', JSON.stringify({ cid_de: 'sess_c' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([
      { conversationId: 'cid_default', sessionId: 'sess_a', kind: 'robot', owner: 'default' },
      { conversationId: 'cid_web', sessionId: 'sess_b', kind: 'robot', owner: 'yantao-web' },
      { conversationId: 'cid_de', sessionId: 'sess_c', kind: 'digital-employee', owner: 'uuid-1' },
    ])
  })

  it('坏 JSON、非对象、非字符串值、缺失文件：一律跳过不炸', async () => {
    await seed('bindings.json', '{{{ 不是 JSON')
    await seed('accounts/broken/bindings.json', '"一个字符串"')
    await seed('accounts/weird/bindings.json', JSON.stringify({ good: 'sess_ok', bad: 42, empty: '' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([{ conversationId: 'good', sessionId: 'sess_ok', kind: 'robot', owner: 'weird' }])
    // 完全空目录也一样：空集而非异常
    expect(await collectDingtalkBindings(join(base, '不存在'))).toEqual([])
  })

  it('同一 sessionId 出现在多处：后来者胜，徽标一格一会话', async () => {
    await seed('bindings.json', JSON.stringify({ cid_old: 'sess_x' }))
    await seed('accounts/newer/bindings.json', JSON.stringify({ cid_new: 'sess_x' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([{ conversationId: 'cid_new', sessionId: 'sess_x', kind: 'robot', owner: 'newer' }])
  })

  it('dingtalkStateDir 尊重 DSH_DINGTALK_STATE_DIR，缺省落到 ~/.dsh-dingtalk', () => {
    expect(dingtalkStateDir({ DSH_DINGTALK_STATE_DIR: '/tmp/dd' } as NodeJS.ProcessEnv)).toBe('/tmp/dd')
    expect(dingtalkStateDir({} as NodeJS.ProcessEnv)).toContain('.dsh-dingtalk')
  })
})
