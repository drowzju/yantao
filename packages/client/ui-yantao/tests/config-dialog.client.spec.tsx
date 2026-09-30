// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigDialog } from '../src/client/ConfigDialog.tsx'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../src/client/model-config.ts'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  // The dialog itself needs no observers, but keep the harness uniform with
  // the other client specs in case shared setup grows.
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

const VIEW: ModelsConfigView = {
  displayName: '内网模型网关',
  baseURL: 'https://gateway.internal/v1',
  baseDisplayName: '内网模型网关',
  baseBaseURL: 'https://gateway.internal/v1',
  apiKeyEnv: 'MODEL_GATEWAY_API_KEY',
  keyConfigured: true,
  keyWritable: true,
  models: [{ id: 'GLM5.1', name: 'inner-glm5.1' }],
  defaultModel: 'GLM5.1',
  profileRevision: 7,
  defaultRevision: 3,
  rawModels: [{ id: 'GLM5.1', name: 'inner-glm5.1', contextWindow: 131072 }],
}

type Loader = () => Promise<ModelsConfigView>
type Saver = (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>

function renderDialog(load: Loader, save: Saver): void {
  render(<ConfigDialog t={t} load={load} save={save} onClose={() => {}} />)
}

describe('ConfigDialog', () => {
  it('loads on mount and paints the gateway view', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    renderDialog(load, vi.fn<Saver>())
    await waitFor(() => { expect(screen.getByDisplayValue('内网模型网关')).toBeTruthy() })
    expect(screen.getByDisplayValue('https://gateway.internal/v1')).toBeTruthy()
    expect(screen.getByDisplayValue('inner-glm5.1')).toBeTruthy()
    // A configured key shows only its state, never a value.
    const keyInput = screen.getByPlaceholderText('已配置（留空保持不变）')
    expect((keyInput as HTMLInputElement).value).toBe('')
  })

  it('reports a load failure as an alert', async () => {
    const load = vi.fn<Loader>().mockRejectedValue(new Error('命名空间未挂载'))
    renderDialog(load, vi.fn<Saver>())
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('配置读取失败') })
  })

  it('sends the typed key and keeps the endpoint as typed; a saved run clears the key field', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    const save = vi.fn<Saver>().mockResolvedValue({ kind: 'saved' })
    renderDialog(load, save)
    const endpoint = await screen.findByDisplayValue('https://gateway.internal/v1')
    fireEvent.change(endpoint, { target: { value: 'https://h/x/v1/chat/completions' } })
    const keyInput = screen.getByPlaceholderText('已配置（留空保持不变）')
    fireEvent.change(keyInput, { target: { value: 'r92c-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.getByText('已保存')).toBeTruthy() })
    expect(save).toHaveBeenCalledTimes(1)
    const sent = save.mock.calls[0]?.[0] as ModelsConfigDraft
    expect(sent.baseURL).toBe('https://h/x/v1/chat/completions') // truncation is the saver's job
    expect(sent.apiKey).toBe('r92c-secret')
    // The dialog re-reads after a save; the key field is blank again.
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText('已配置（留空保持不变）')).toBeTruthy()
  })

  it('sends an empty key when the field is left blank', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    const save = vi.fn<Saver>().mockResolvedValue({ kind: 'saved' })
    renderDialog(load, save)
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))
    await waitFor(() => { expect(save).toHaveBeenCalled() })
    expect((save.mock.calls[0]?.[0] as ModelsConfigDraft).apiKey).toBe('')
  })

  it('on conflict alerts and reloads the fresh view', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    const save = vi.fn<Saver>().mockResolvedValue({ kind: 'conflict' })
    renderDialog(load, save)
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('已被其他地方修改') })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('renders a refusal message and keeps the draft', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    const save = vi.fn<Saver>().mockResolvedValue({ kind: 'refused', message: '网关拒绝了这次写入' })
    renderDialog(load, save)
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('网关拒绝了这次写入') })
    expect(screen.getByDisplayValue('内网模型网关')).toBeTruthy()
  })

  it('closes from the backdrop but not from a click inside the card', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(VIEW)
    const onClose = vi.fn()
    render(<ConfigDialog t={t} load={load} save={vi.fn<Saver>()} onClose={onClose} />)
    await screen.findByRole('dialog')
    // A click on the card stops propagation and must not close.
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    // The backdrop sits behind the card; onClose is the parent's cue to unmount.
    const backdrop = document.querySelector('[data-config-backdrop]')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
