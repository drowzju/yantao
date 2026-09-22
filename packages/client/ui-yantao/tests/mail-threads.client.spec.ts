import { describe, expect, it } from 'vitest'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { bareSubject, groupThreads, rollupImportance, THREAD_COLLAPSE_MIN, threadKey } from '../src/client/mail-threads.ts'

function mail(overrides: Partial<KbMailMessage> & { id: string }): KbMailMessage {
  return {
    entryId: overrides.id,
    receivedAt: '2026-09-09T10:00:00+00:00',
    senderName: '张三',
    senderAddress: 'zhangsan@example.com',
    subject: '季度汇报',
    body: '',
    truncated: false,
    toMe: 'to',
    ...overrides,
  }
}

describe('bareSubject', () => {
  it('strips one reply/forward prefix in either language and colon width', () => {
    expect(bareSubject('RE: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('re: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('FW: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('FWD: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('AW: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('答复: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('回复: 季度汇报')).toBe('季度汇报')
    expect(bareSubject('转发：季度汇报')).toBe('季度汇报')
  })

  it('strips stacked prefixes and trims', () => {
    expect(bareSubject('RE: FW: 答复:  季度汇报 ')).toBe('季度汇报')
  })

  it('keeps a bare subject and empties a pure-prefix subject', () => {
    expect(bareSubject('季度汇报')).toBe('季度汇报')
    expect(bareSubject('RE:')).toBe('')
  })
})

describe('threadKey', () => {
  it('merges prefixed subjects of one conversation when no conversation id exists', () => {
    const bare = threadKey(mail({ id: 'a', subject: '季度汇报' }))
    expect(threadKey(mail({ id: 'b', subject: 'RE: 季度汇报' }))).toBe(bare)
    expect(threadKey(mail({ id: 'c', subject: 'FW:季度汇报' }))).toBe(bare)
    expect(threadKey(mail({ id: 'd', subject: '答复：季度汇报' }))).toBe(bare)
  })

  it('prefers the conversation id over the subject', () => {
    const same = threadKey(mail({ id: 'a', subject: '甲', conversationId: 'C1' }))
    expect(threadKey(mail({ id: 'b', subject: '乙', conversationId: 'C1' }))).toBe(same)
    const other = threadKey(mail({ id: 'c', subject: '甲', conversationId: 'C2' }))
    expect(other).not.toBe(same)
  })

  it('groups old wire data without conversation fields by subject alone', () => {
    const bare = threadKey(mail({ id: 'a', subject: 'RE: 季度汇报' }))
    expect(threadKey(mail({ id: 'b', subject: '季度汇报' }))).toBe(bare)
  })

  it('never lumps subjectless mails together', () => {
    expect(threadKey(mail({ id: 'a', subject: '' }))).not.toBe(threadKey(mail({ id: 'b', subject: '' })))
  })
})

describe('groupThreads', () => {
  it('orders threads by their newest member and keeps members in batch order', () => {
    const threads = groupThreads([
      mail({ id: 'newest', receivedAt: '2026-09-09T10:00:00+00:00', subject: '线程', conversationId: 'C1' }),
      mail({ id: 'single', receivedAt: '2026-09-09T09:00:00+00:00', subject: '独封' }),
      mail({ id: 'older', receivedAt: '2026-09-08T08:00:00+00:00', subject: 'RE: 线程', conversationId: 'C1' }),
    ])
    expect(threads.map(thread => thread.key)).toEqual(['cid:C1', 'subj:独封'])
    expect(threads[0]?.members.map(member => member.mail.id)).toEqual(['newest', 'older'])
    expect(threads[0]?.members.map(member => member.index)).toEqual([0, 2])
  })

  it('names a thread from the topic, falling back to the bare subject', () => {
    const [withTopic, fromSubject] = groupThreads([
      mail({ id: 'a', subject: 'RE: 线程', conversationId: 'C1', conversationTopic: '线程' }),
      mail({ id: 'b', subject: 'RE: 回退' }),
    ])
    expect(withTopic?.topic).toBe('线程')
    expect(fromSubject?.topic).toBe('回退')
  })
})

describe('rollupImportance', () => {
  it('loudest verdict wins and gaps stay normal', () => {
    expect(rollupImportance(['normal', 'focus'])).toBe('focus')
    expect(rollupImportance(['digest', 'normal'])).toBe('digest')
    expect(rollupImportance(['focus', 'digest'])).toBe('focus')
    expect(rollupImportance([undefined, undefined])).toBe('normal')
    expect(rollupImportance([])).toBe('normal')
  })
})

describe('THREAD_COLLAPSE_MIN', () => {
  it('collapses from three members on', () => {
    expect(THREAD_COLLAPSE_MIN).toBe(3)
  })
})
