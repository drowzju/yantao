/**
 * yantao workbench client plugin — spike slice.
 *
 * The point of this slice is to prove two things: dsh serves OUR dist, and a
 * plugin of ours reaches `ctx.remote.yantaoKb` from a React tree we render
 * ourselves (no slot system, no shared-shell UI). It renders one RPC round
 * trip verbatim; the three-pane workbench replaces it once this is green.
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ui-yantao'
export const inject = ['remote']

/** The slice of ctx.remote this slice needs, narrowed defensively. */
interface KbRemoteView {
  yantaoKb?: { tree(): Promise<unknown> }
  [key: string]: unknown
}

/** Reach the remote surface without assuming the namespace is mounted. */
function kbRemote(ctx: Context): KbRemoteView | undefined {
  return (ctx as unknown as { remote?: KbRemoteView }).remote
}

export function apply(ctx: Context): void {
  // The shared shell rows are disabled on this surface (ADR-0009), so #root
  // belongs to the workbench.
  const container = document.getElementById('root')
  if (container === null) throw new Error('ui-yantao: missing #root')
  createRoot(container).render(createElement(WorkbenchProbe, { ctx }))
}

/** Render the probe: reachable namespaces, then one tree() round trip. */
function WorkbenchProbe({ ctx }: { ctx: Context }): ReactElement {
  const [state, setState] = useState<string>('connecting…')
  useEffect(() => {
    const remote = kbRemote(ctx)
    const kb = remote?.yantaoKb
    if (kb === undefined) {
      const keys = Object.keys(remote ?? {})
      setState(`no yantaoKb namespace; reachable: ${keys.length === 0 ? '(none)' : keys.join(', ')}`)
      return
    }
    kb.tree()
      .then((tree) => { setState(`tree() ok: ${JSON.stringify(tree).slice(0, 400)}`) })
      .catch((error: unknown) => { setState(`tree() failed: ${String(error)}`) })
  }, [ctx])
  return createElement('pre', {
    style: { padding: 16, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' },
  }, `yantao 工作台 · ${state}`)
}
