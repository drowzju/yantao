// @vitest-environment jsdom
// MermaidBlock (ADR-0048 决定 4): the library is mocked — the component's own
// contract is the lifecycle around it, not mermaid's rendering.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MermaidBlock } from '../src/client/editor/MermaidView.tsx'
import { DARK_ATTRIBUTE } from '../src/client/frame/theme-presenter.ts'

afterEach(() => {
  cleanup()
  // The scheme toggle is a body attribute; drop it so tests stay independent.
  document.body.removeAttribute(DARK_ATTRIBUTE)
})

// vi.mock factories hoist above imports, so the spies live in vi.hoisted.
const { initialize, renderDiagram } = vi.hoisted(() => ({
  initialize: vi.fn(),
  renderDiagram: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: {
    initialize,
    render: renderDiagram,
  },
}))

describe('MermaidBlock', () => {
  it('lazy-loads the library once, initializes it strict, and frames the SVG', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg viewBox="0 0 10 10"></svg>' })
    const { container, unmount } = render(<MermaidBlock code="graph TD;A-->B" />)
    await waitFor(() =>{  expect(container.querySelector('iframe')).not.toBeNull() })
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' }))
    expect(renderDiagram).toHaveBeenCalledWith(expect.stringContaining('yantao-mermaid-'), 'graph TD;A-->B')
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('srcdoc')).toContain('<svg viewBox="0 0 10 10">')
    expect(frame.getAttribute('srcdoc')).toContain(JSON.stringify('yantao:mermaid-height'))
    unmount()
  })

  it('shows the source while the render is in flight, then the diagram', async () => {
    let settle: ((value: { svg: string }) => void) | undefined
    renderDiagram.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    const { container } = render(<MermaidBlock code="graph TD;A-->B" />)
    expect(container.querySelector('pre[data-mermaid-pending]')?.textContent).toBe('graph TD;A-->B')
    settle?.({ svg: '<svg/>' })
    await waitFor(() =>{  expect(container.querySelector('iframe')).not.toBeNull() })
  })

  it('falls back to the annotated source when the diagram fails to parse', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error on line 2'))
    const { container } = render(<MermaidBlock code="graph TD;A-->B((" />)
    await waitFor(() =>{  expect(container.querySelector('[data-mermaid-error]')).not.toBeNull() })
    expect(screen.getByText(/Parse error on line 2/)).toBeTruthy()
    expect(container.querySelector('[data-mermaid-error]')?.textContent).toContain('graph TD;A-->B((')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('accepts only its own frame\'s height messages and clamps them', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg/>' })
    const { container } = render(<MermaidBlock code="graph TD;A-->B" />)
    await waitFor(() =>{  expect(container.querySelector('iframe')).not.toBeNull() })
    const frame = container.querySelector('iframe')!
    // A foreign source is ignored…
    window.dispatchEvent(new MessageEvent('message', { source: null, data: { type: 'yantao:mermaid-height', height: 5000 } }))
    // …an impostor type is ignored…
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'other', height: 5000 } }))
    // …a non-number is ignored…
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'yantao:mermaid-height', height: 'big' } }))
    expect(frame.style.height).toBe('60px')
    // …and a legitimate oversized report clamps to the ceiling.
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'yantao:mermaid-height', height: 9000 } }))
    await waitFor(() =>{  expect(frame.style.height).toBe('4000px') })
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'yantao:mermaid-height', height: 180 } }))
    await waitFor(() =>{  expect(frame.style.height).toBe('180px') })
  })

  it('pins the default theme in the light scheme', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg/>' })
    const { container } = render(<MermaidBlock code="graph TD;A-->B" />)
    await waitFor(() =>{  expect(container.querySelector('iframe')).not.toBeNull() })
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))
  })

  it('re-pins the dark theme and re-renders when the presenter toggles the scheme', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg/>' })
    const { container } = render(<MermaidBlock code="graph TD;A-->B" />)
    await waitFor(() =>{  expect(container.querySelector('iframe')).not.toBeNull() })
    const callsBefore = renderDiagram.mock.calls.length
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    await waitFor(() =>{  expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' })) })
    await waitFor(() =>{  expect(renderDiagram.mock.calls.length).toBeGreaterThan(callsBefore) })
    // The redraw swapped in the new SVG without dropping back to source.
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.querySelector('pre[data-mermaid-pending]')).toBeNull()
  })
})
