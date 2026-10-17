import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectDingtalkBindings, dingtalkStateDir, setDingtalkBinding } from '../src/dingtalk-bindings.ts'

async function seed(base: string, relative: string, content: string): Promise<void> {
  const target = join(base, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}

async function readStore(base: string, relative: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(base, relative), 'utf8'))
}

describe('collectDingtalkBindings（ADR-0061 决定 2：连接器绑定簿的总读面）', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'yantao-dingtalk-bindings-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('三族存储全收：默认机器人、accounts/*、digital-employees/*', async () => {
    await seed(base, 'bindings.json', JSON.stringify({ cid_default: 'sess_a' }))
    await seed(base, 'accounts/yantao-web/bindings.json', JSON.stringify({ cid_web: 'sess_b' }))
    await seed(base, 'digital-employees/uuid-1/bindings.json', JSON.stringify({ cid_de: 'sess_c' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([
      { conversationId: 'cid_default', sessionId: 'sess_a', kind: 'robot', owner: 'default' },
      { conversationId: 'cid_web', sessionId: 'sess_b', kind: 'robot', owner: 'yantao-web' },
      { conversationId: 'cid_de', sessionId: 'sess_c', kind: 'digital-employee', owner: 'uuid-1' },
    ])
  })

  it('坏 JSON、非对象、非字符串值、缺失文件：一律跳过不炸', async () => {
    await seed(base, 'bindings.json', '{{{ 不是 JSON')
    await seed(base, 'accounts/broken/bindings.json', '"一个字符串"')
    await seed(base, 'accounts/weird/bindings.json', JSON.stringify({ good: 'sess_ok', bad: 42, empty: '' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([{ conversationId: 'good', sessionId: 'sess_ok', kind: 'robot', owner: 'weird' }])
    // 完全空目录也一样：空集而非异常
    expect(await collectDingtalkBindings(join(base, '不存在'))).toEqual([])
  })

  it('同一 sessionId 出现在多处：后来者胜，徽标一格一会话', async () => {
    await seed(base, 'bindings.json', JSON.stringify({ cid_old: 'sess_x' }))
    await seed(base, 'accounts/newer/bindings.json', JSON.stringify({ cid_new: 'sess_x' }))
    const rows = await collectDingtalkBindings(base)
    expect(rows).toEqual([{ conversationId: 'cid_new', sessionId: 'sess_x', kind: 'robot', owner: 'newer' }])
  })

  it('dingtalkStateDir 尊重 DSH_DINGTALK_STATE_DIR，缺省落到 ~/.dsh-dingtalk', () => {
    expect(dingtalkStateDir({ DSH_DINGTALK_STATE_DIR: '/tmp/dd' } as NodeJS.ProcessEnv)).toBe('/tmp/dd')
    expect(dingtalkStateDir({} as NodeJS.ProcessEnv)).toContain('.dsh-dingtalk')
  })
})

describe('setDingtalkBinding（ADR-0062 决定 3：并入/解绑的写面）', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'yantao-dingtalk-binding-set-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('改写已有键落在原家族存储里；新键落到默认机器人存储', async () => {
    await seed(base, 'bindings.json', JSON.stringify({ cid_a: 'sess_old' }))
    await seed(base, 'accounts/web/bindings.json', JSON.stringify({ cid_b: 'sess_b' }))

    await setDingtalkBinding('cid_b', 'sess_main', base)
    expect(await readStore(base, 'accounts/web/bindings.json')).toEqual({ cid_b: 'sess_main' })
    // 默认存储未被误伤
    expect(await readStore(base, 'bindings.json')).toEqual({ cid_a: 'sess_old' })

    const { file } = await setDingtalkBinding('cid_unknown', 'sess_new', base)
    expect(file).toBe(join(base, 'bindings.json'))
    expect(await readStore(base, 'bindings.json')).toEqual({ cid_a: 'sess_old', cid_unknown: 'sess_new' })
  })

  it('sessionId 传 null 即解绑；键删光后存储保留为空对象', async () => {
    await seed(base, 'bindings.json', JSON.stringify({ cid_a: 'sess_old', cid_keep: 'sess_k' }))
    await setDingtalkBinding('cid_a', null, base)
    expect(await readStore(base, 'bindings.json')).toEqual({ cid_keep: 'sess_k' })
    await setDingtalkBinding('cid_keep', null, base)
    expect(await readStore(base, 'bindings.json')).toEqual({})
  })

  it('存储缺失时也能写（建目录落默认存储），坏 JSON 存储被重建而不炸', async () => {
    const { file } = await setDingtalkBinding('cid_fresh', 'sess_f', join(base, 'accounts', 'x'))
    expect(file).toBe(join(base, 'accounts', 'x', 'bindings.json'))
    expect(await readStore(base, 'accounts/x/bindings.json')).toEqual({ cid_fresh: 'sess_f' })

    await seed(base, 'bindings.json', '{{{ 坏的')
    await setDingtalkBinding('cid_fix', 'sess_fix', base)
    expect(await readStore(base, 'bindings.json')).toEqual({ cid_fix: 'sess_fix' })
  })
})
