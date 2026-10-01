// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MemoryProposalCard } from '../src/client/MemoryProposalCard.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const ARGS_RAW = JSON.stringify({ scope: 'mail', text: '代理兜底：内网网关的 key 即密码，别二次编码', source: '会话' })
const OUTPUT_TEXT = '已记入提案队列（作用域 mail，待批准 1 条）：代理兜底：内网网关的 key 即密码，别二次编码\n提案尚未生效——人批准后才沉淀为行为记忆。'

/** A running call block for kb_propose_memory. */
function running(argsRaw: string = ARGS_RAW): ToolCallBlock {
  return { callId: 'c1', name: 'kb_propose_memory', argsRaw, turn: 1, step: 1, time: 0, subCalls: [] }
}

/** A settled result block; isError/error/content drive the lifecycle. */
function settled(options: {
  argsRaw?: string
  withCallHead?: boolean
  isError?: boolean
  errorCode?: string
  contentText?: string
}): ToolCallBlock {
  const {
    argsRaw = ARGS_RAW,
    withCallHead = true,
    isError = false,
    errorCode = 'yantao-kb/rejected',
    contentText = OUTPUT_TEXT,
  } = options
  return {
    kind: 'tool-result',
    callId: 'c1',
    call: withCallHead ? { name: 'kb_propose_memory', argsRaw } : null,
    callTime: 0,
    content: [{ type: 'text', text: contentText }],
    isError,
    ...(isError ? { error: { name: 'Error', code: errorCode } } : {}),
    subCalls: [],
  }
}

/** Render the card with recorder doubles for the two verdict RPCs. */
function renderCard(block: ToolCallBlock, overrides?: {
  approve?: (scope: string, text: string) => Promise<unknown>
  discard?: (scope: string, text: string) => Promise<unknown>
}): { approve: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> } {
  const approve = vi.fn(overrides?.approve ?? (async () => ({})))
  const discard = vi.fn(overrides?.discard ?? (async () => ({})))
  render(
    <MemoryProposalCard
      callId="c1"
      toolName="kb_propose_memory"
      block={block}
      openFile={() => {}}
      loadImage={async () => ({ url: '', revoke: () => {} })}
      t={t}
      approve={approve}
      discard={discard}
    />,
  )
  return { approve, discard }
}

describe('MemoryProposalCard', () => {
  it('shows the proposed text, its scope chip, the source, and both verdict buttons', () => {
    renderCard(settled({}))
    expect(screen.getByText('记忆提案')).toBeTruthy()
    // Capability scopes render by their raw name; only `global` gets prose.
    expect(screen.getByText('作用域：mail')).toBeTruthy()
    expect(screen.getByText('代理兜底：内网网关的 key 即密码，别二次编码')).toBeTruthy()
    expect(screen.getByText('来源：会话')).toBeTruthy()
    expect(screen.getByText('批准')).toBeTruthy()
    expect(screen.getByText('丢弃')).toBeTruthy()
    expect(screen.getByText('提案尚未生效——批准后才沉淀为行为记忆。')).toBeTruthy()
  })

  it('names the global scope in prose', () => {
    const args = JSON.stringify({ scope: 'global', text: '经验' })
    renderCard(settled({ argsRaw: args, contentText: '已记入提案队列（作用域 global，待批准 1 条）：经验' }))
    expect(screen.getByText('作用域：全局')).toBeTruthy()
  })

  it('approves through the human channel and settles into the approved note', async () => {
    const { approve } = renderCard(settled({}))
    fireEvent.click(screen.getByText('批准'))
    await waitFor(() => { expect(approve).toHaveBeenCalledWith('mail', '代理兜底：内网网关的 key 即密码，别二次编码') })
    await waitFor(() => { expect(screen.getByText('已批准，沉淀为行为记忆。')).toBeTruthy() })
    expect(screen.queryByText('批准')).toBeNull()
    expect(screen.queryByText('丢弃')).toBeNull()
    expect(screen.queryByText('提案尚未生效——批准后才沉淀为行为记忆。')).toBeNull()
  })

  it('discards through the human channel and keeps the siblings untouched', async () => {
    const { discard } = renderCard(settled({}))
    fireEvent.click(screen.getByText('丢弃'))
    await waitFor(() => { expect(discard).toHaveBeenCalledWith('mail', '代理兜底：内网网关的 key 即密码，别二次编码') })
    await waitFor(() => { expect(screen.getByText('已丢弃，提案移出队列。')).toBeTruthy() })
    expect(screen.queryByText('批准')).toBeNull()
  })

  it('surfaces the queue refusal as prose and keeps the buttons when the verdict fails', async () => {
    renderCard(settled({}), {
      approve: async () => {
        throw new Error('这条经验已经是记忆了')
      },
    })
    fireEvent.click(screen.getByText('批准'))
    await waitFor(() => { expect(screen.getByText('这条经验已经是记忆了')).toBeTruthy() })
    // A failed verdict is not a verdict: both buttons stand for a retry.
    expect(screen.getByText('批准')).toBeTruthy()
    expect(screen.getByText('丢弃')).toBeTruthy()
  })

  it('holds both buttons still while a verdict is in flight', async () => {
    let release: ((value: unknown) => void) | undefined
    const { approve } = renderCard(settled({}), {
      approve: () => new Promise((resolve) => { release = resolve }),
    })
    fireEvent.click(screen.getByText('批准'))
    expect(screen.getByText('处理中…')).toBeTruthy()
    const discard = screen.getByText('丢弃') as HTMLButtonElement
    expect(discard.disabled).toBe(true)
    release?.(undefined)
    await waitFor(() => { expect(screen.getByText('已批准，沉淀为行为记忆。')).toBeTruthy() })
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it('offers no verdict while the call is still running', () => {
    renderCard(running())
    expect(screen.getByText('正在记入提案队列…')).toBeTruthy()
    expect(screen.queryByText('批准')).toBeNull()
    // The streamed text shows as soon as the args parse.
    expect(screen.getByText('代理兜底：内网网关的 key 即密码，别二次编码')).toBeTruthy()
  })

  it('renders a refused call as the refusal prose with no verdict', () => {
    renderCard(settled({ isError: true, contentText: '同样的提案已在队列里等待批准，不要重复提案。' }))
    expect(screen.getByText('同样的提案已在队列里等待批准，不要重复提案。')).toBeTruthy()
    expect(screen.queryByText('批准')).toBeNull()
    expect(screen.queryByText('丢弃')).toBeNull()
  })

  it('marks an interrupted call as nothing queued', () => {
    renderCard(settled({ isError: true, errorCode: 'interrupted', contentText: '' }))
    expect(screen.getByText('调用已中断，提案未入队。')).toBeTruthy()
    expect(screen.queryByText('批准')).toBeNull()
  })

  it('degrades to the result prose when a window cut dropped the call head', () => {
    renderCard(settled({ withCallHead: false }))
    // The prose spans two lines; match a stable prefix (whitespace is
    // normalized in the DOM).
    expect(screen.getByText(/已记入提案队列（作用域 mail，待批准 1 条）/)).toBeTruthy()
    expect(screen.queryByText('批准')).toBeNull()
  })
})
