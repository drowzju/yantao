/**
 * The 省得 tab (2026-10-11 整合裁决): the 待办 board above, the 记忆 view
 * below — one tab, two untouched data planes. The merge is presentation
 * only: todos.md keeps its singleton board (ADR-0018), memory keeps its
 * proposal lifecycle (ADR-0032/0044), and neither learns about the other.
 *
 * The two sediment layers — the DONE pane and the approved rules — start
 * collapsed so the first screen holds only what is alive: open todos and
 * pending proposals. The human's expansions persist in localStorage;
 * presentation state, never a data-plane fact.
 * @module @deepseek-ai/dsh-client-ui-yantao/ShengDePanel
 */
import { useCallback, useState, type ReactElement } from 'react'
import { TodoBoard, type TodoBoardProps } from './TodoBoard.tsx'
import { MemoryPanel, type MemoryPanelProps } from './MemoryPanel.tsx'

/** What the panel needs: both halves' RPCs, already bound to the context. */
export interface ShengDePanelProps extends TodoBoardProps, MemoryPanelProps {}

/** The expansion ledger, persisted locally: `true` means the human opened
    the layer; unset means the default — folded. Sediment starts hidden. */
interface Expansion {
  readonly done?: boolean
  readonly approved?: boolean
}

/** The localStorage key — presentation state, never a data-plane fact. */
const COLLAPSE_KEY = 'yt.shengde.collapsed'

/** Read the ledger; a corrupt or absent record reads as "nothing opened". */
function readExpansion(): Expansion {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    return raw === null ? {} : (JSON.parse(raw) as Expansion)
  } catch {
    return {}
  }
}

/** The seam between the two planes. */
const dividerStyle = { height: 1, background: 'var(--yt-border-subtle)', margin: '10px 0 6px' } as const

/**
 * Render the 省得 tab: the todo board above the memory view, each half's
 * sediment layer folded until the human opens it — and remembering having
 * done so.
 * @param props - see {@link ShengDePanelProps}.
 * @returns the panel element.
 */
export function ShengDePanel({ t, ...rest }: ShengDePanelProps): ReactElement {
  const [expansion, setExpansion] = useState<Expansion>(readExpansion)
  const write = useCallback((patch: Expansion): void => {
    setExpansion((previous) => {
      const next = { ...previous, ...patch }
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        // 私有浏览等存不进去的场景：折叠退化为会话内状态，不值得报错。
      }
      return next
    })
  }, [])

  return (
    <div data-shengde-panel="true">
      <TodoBoard
        t={t}
        load={rest.load}
        write={rest.write}
        refreshKey={rest.refreshKey}
        onOpenFile={rest.onOpenFile}
        doneOpen={expansion.done === true}
        onDoneOpenChange={(open) => { write({ done: open }) }}
      />
      <div style={dividerStyle} />
      <MemoryPanel
        t={t}
        list={rest.list}
        add={rest.add}
        remove={rest.remove}
        listProposals={rest.listProposals}
        approveProposal={rest.approveProposal}
        discardProposal={rest.discardProposal}
        approvedOpen={expansion.approved === true}
        onApprovedOpenChange={(open) => { write({ approved: open }) }}
      />
    </div>
  )
}
