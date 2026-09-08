/**
 * yantao workbench client plugin — the three-pane skeleton.
 *
 * dsh serves OUR dist and a plugin of ours reaches `ctx.remote.yantaoKb`
 * from a React tree we render ourselves (no slot system, no shared-shell
 * UI). Until the shared shell steps aside, the middle column stays the
 * host's agent surface: the overlay is click-through and only the two rails
 * take pointer events.
 */
import { createElement, useCallback, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { Workbench } from './Workbench.tsx'
import { kbRemoteOf, remoteMessage, unwrapRemote } from './remote.ts'

export const name = 'ui-yantao'
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
export const inject = ['remote', 'remote.yantaoKb']

/** The container id the workbench owns. */
const CONTAINER_ID = 'yantao-workbench'

export function apply(ctx: Context): void {
  let container = document.getElementById(CONTAINER_ID)
  if (container === null) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    document.body.appendChild(container)
  }
  const root = createRoot(container)
  root.render(createElement(WorkbenchHost, { ctx }))
  ctx.effect(() => () => { root.unmount() }, 'ui-yantao: unmount workbench')
}

/** The stateful host: loads both trees, keeps the selection, and reports failures. */
function WorkbenchHost({ ctx }: { ctx: Context }): ReactElement {
  const [intake, setIntake] = useState<readonly KbTreeSection[] | null>(null)
  const [workspace, setWorkspace] = useState<readonly KbTreeSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const kb = kbRemoteOf(ctx)
    if (kb === undefined) {
      setError('没有挂载 yantaoKb Remote 命名空间')
      return
    }
    try {
      const nextIntake = unwrapRemote(await kb.intakeTree())
      const nextWorkspace = unwrapRemote(await kb.workspaceTree())
      setIntake(nextIntake.sections)
      setWorkspace(nextWorkspace.sections)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [ctx])

  useEffect(() => { void load() }, [load])

  return createElement(Workbench, {
    intake,
    workspace,
    error,
    selection,
    onSelect: setSelection,
    onRefresh: () => void load(),
  })
}
