/**
 * The workbench frame: the only occupant of the runtime's built-in 'root'
 * slot (ADR-0011). Three grid columns — intake | conversation | workspace —
 * with a drag handle per rail and one click-through overlay layer. The middle
 * column is still the host's agent surface: it renders the `conversation`
 * slot, so upstream's conversation/chat/tool stack keeps working untouched.
 *
 * Panel actions reach `ctx.layout` through the `panels` seat: the frame owns
 * the state, the service face is a thin forwarder.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TreeLoader } from '../Workbench.tsx'
import { IntakeRail, WorkspaceRail } from '../Workbench.tsx'
import type {
  CapabilityAdopter, CapabilityCreator, CapabilityDeclarationLoader, CapabilityLoader, CapabilityRegistrar, CapabilityRunner,
  DirectoryPicker, EntityArchiver, EntityCreator,
  ExternalOpener, FileReader, FileWriter, LinksLoader,
  MailDeleter, MailFetcher, MailMarker, MemoryAdder, MemoryDeleter, MemoryLister,
  MemoryProposalApprover, MemoryProposalDiscarder, MemoryProposalLister, PromptShortcutLister,
  PromptShortcutSaver, RelationSetter, ResourceRegistrar, RevisionLoader, ShortcutFiller,
  RootLoader, RootSetter,
  Archiver,
  SessionPrompter, TodoLoader, TodoWriter,
} from '../remote.ts'
import type { AnalysisStage, MailAnalyser } from '../mail-analysis.ts'
import type { CapabilityDistiller, CapabilityRunRecord } from '../capability-distill.ts'
import { createMailRun, useMailRun } from '../mail-run.ts'
import type { RefineGesture, RefineRosterEntry, RefineRunner, RefineRun } from '../refine.ts'
import type { ValidateRun, ValidateRunner, ValidateScope, ValidateStage } from '../validate.ts'
import { formatElapsed, type TaskKind, type TaskRow, type TaskStatus } from '../task-view.ts'
import type { SessionDetailLoader } from '../session-detail.ts'
import { SessionDetailDrawer } from '../SessionDetailDrawer.tsx'
import type { Proposal } from '../proposal.ts'
import { applyProposal, type ProposalApplyResult } from '../proposal-apply.ts'
import { proposalOfRunResult, runNoticeOf } from '../capability-match.ts'
import { capabilityGestureMessage } from '../capability-gesture.ts'
import { ProposalCard } from '../ProposalCard.tsx'
import { QuestionDialog } from '../QuestionDialog.tsx'
import { ConfigDialog } from '../ConfigDialog.tsx'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../model-config.ts'
import { CapabilityMenu, SelectionMenu } from '../SelectionMenu.tsx'
import { obsidianUri, remoteMessage } from '../remote.ts'
import { frontmatterArchived } from '../markdown.ts'
import type { KbCapabilitySummary, KbLinksResult, KbMailFetchArgs, KbMailFetchResult, KbTreeSection, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { FileEditor, type FileEditorApi, type SaveStatus } from '../editor/FileEditor.tsx'
import { MarkdownView } from '../editor/MarkdownView.tsx'
import { ReadOnlyFile } from '../editor/ReadOnlyFile.tsx'
import { Onboarding } from '../Onboarding.tsx'
import {
  CONVERSATION_TAB, activateTab, activeFile, closeTab, emptyTabs, openTab, persistTabs, readOnlyPath, restoreTabs,
  type TabMode, type TabState,
} from '../tabs.ts'
import { CenterPane, type ViewMode } from './CenterPane.tsx'
import './frame.module.css'
import type { PanelToggles } from './layout.ts'
import { NARROW, RAIL_DEFAULT, clampRail, solveColumns } from './columns.ts'
import type { WorkbenchT } from '../locales.ts'

/** Full props: the render share for the three seats this frame declares, plus the panel-action seat. */
export type FrameProps = PropsRenderSlots<'conversation' | 'shell.overlay' | 'footer.status'> & {
  /** The workbench dictionary's bound translator. */
  readonly t: WorkbenchT
  /** Mutable seat the frame fills with its own toggles on mount. */
  readonly panels: PanelToggles
  /** Load the intake sections. */
  readonly intake: TreeLoader
  /** Load the workspace sections. */
  readonly workspace: TreeLoader
  /** Read one KB file's content. */
  readonly read: FileReader
  /** Write one KB file's content. */
  readonly write: FileWriter
  /** Archive one entity (ADR-0041 决定 7) — the entity gestures' 「归档」. */
  readonly archiveEntity: EntityArchiver
  /** Restore one archived entity (ADR-0041 决定 7) — the entity gestures' 「还原」. */
  readonly restoreEntity: EntityArchiver
  /** Rewrite one person entity's relation — the 人物 row's 「关系」. */
  readonly setRelation: RelationSetter
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Read the KB root's configuration state. */
  readonly root: RootLoader
  /** Adopt a directory as the KB root. */
  readonly setRoot: RootSetter
  /** Open the host's native directory picker. */
  readonly pickDirectory: DirectoryPicker
  /** Load one file's `[[…]]` link graph (ADR-0015). */
  readonly links: LinksLoader
  /** Read the KB's change counter (ADR-0017). */
  readonly revision: RevisionLoader
  /** Hand one KB path or allowlisted URI to the desktop's own handler (ADR-0017). */
  readonly openExternal: ExternalOpener
  /** Read the todo singleton as structured items (ADR-0018). */
  readonly todos: TodoLoader
  /** Write the todo singleton's whole item list (ADR-0018). */
  readonly writeTodos: TodoWriter
  /** Read the newest mails after the connector's cursor (ADR-0019). */
  readonly mailFetch: MailFetcher
  /** Move that cursor forward (ADR-0019). */
  readonly mailMarkRead: MailMarker
  /**
   * Swing the deletion knife (ADR-0034 决定 5); optional so embedders without
   * the face still render the card — its delete-mails rows then skip honestly.
   */
  readonly mailDelete?: MailDeleter
  /**
   * Arm the mail archive (ADR-0037 决定 2); optional for the same reason as
   * `mailDelete` — embedders without the face still render the card, whose
   * archive-mails rows then skip honestly.
   */
  readonly mailArchive?: Archiver
  /** Run one mail analysis in a dsh session (ADR-0019). */
  readonly analyseMail: MailAnalyser
  /** Run one refine analysis in a dsh session — both ADR-0029 gestures. */
  readonly refine: RefineRunner
  /** Run one whole-KB validate pass in a dsh session (ADR-0035). */
  readonly validate: ValidateRunner
  /** Copy one dropped file into `resources/` (ADR-0020). */
  readonly registerResource: ResourceRegistrar
  /** List the registered capabilities (ADR-0021). */
  readonly capabilityList: CapabilityLoader
  /** Read one capability's parsed declaration (ADR-0043 决定 7) — the 能力 tab detail view's 声明 section. */
  readonly capabilityDeclaration: CapabilityDeclarationLoader
  /** Scaffold one new capability (「新建能力」). */
  readonly capabilityCreate: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly capabilityAdopt: CapabilityAdopter
  /** Register one in-KB skill by writing its sidecar in place (ADR-0025 决定 1). */
  readonly capabilityRegister: CapabilityRegistrar
  /** Run one capability with the caller's input (ADR-0021 决定 7's row menus). */
  readonly capabilityRun: CapabilityRunner
  /** Send one prompt to the conversation the human is watching (ADR-0025 决定 4). */
  readonly promptSession: SessionPrompter
  /** Read one task session's transcript back for the 任务 tab's 「详情」 drawer (ADR-0033). */
  readonly sessionDetail: SessionDetailLoader
  /** List the behavior-memory scopes (ADR-0032) — the 记忆 tab's read. */
  readonly memoryList: MemoryLister
  /** Remember one behavior rule (ADR-0032) — the card rows' and the human's direct write. */
  readonly memoryAdd: MemoryAdder
  /** Forget one behavior rule by id (ADR-0032) — the 记忆 tab's delete. */
  readonly memoryDelete: MemoryDeleter
  /** List the in-flight proposals (ADR-0044 决定 7) — the 记忆 tab's 待批准 zone. */
  readonly memoryProposalList: MemoryProposalLister
  /** Promote one pending proposal, optionally to a re-judged scope. */
  readonly memoryProposalApprove: MemoryProposalApprover
  /** Drop one pending proposal without promoting it. */
  readonly memoryProposalDiscard: MemoryProposalDiscarder
  /** Distill one finished run's lessons into memory proposals (ADR-0044 决定 6). */
  readonly capabilityDistill: CapabilityDistiller
  /** List the prompt shortcuts (ADR-0040) — the 能力 tab's 惯用提示词 first screen. */
  readonly promptShortcutList: PromptShortcutLister
  /** Replace the whole prompt-shortcut list (ADR-0040). */
  readonly promptShortcutSave: PromptShortcutSaver
  /** Fill the conversation's composer with `/alias ` without sending (ADR-0040 决定 5). */
  readonly fillShortcut: ShortcutFiller
  /** Read the model gateway's config view — the 配置 dialog's open read. */
  readonly loadModelsConfig: () => Promise<ModelsConfigView>
  /** Commit a 配置 dialog draft; the result separates conflict from refusal. */
  readonly saveModelsConfig: (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>
  /** The KB root changed: re-point dsh's workspace at it (ADR-0013). */
  readonly onKbRootChanged: () => void
}

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

/**
 * How long the link graph waits after a keystroke. `linksOf` re-reads every
 * entity file to compute incoming links, so it must not run per keystroke.
 */
const LINK_GRAPH_DEBOUNCE_MS = 350

/** How often the KB's change counter is compared (ADR-0017). */
const REVISION_POLL_MS = 3000

const frameStyle = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1fr) auto',
  height: '100%',
  minWidth: 0,
  fontFamily: FONT,
  fontSize: 13,
} as const

const colStyle = { minWidth: 0, overflow: 'hidden' } as const

const railColStyle = { ...colStyle, background: 'var(--yt-surface-primary)' } as const

const overlayStyle = { position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' } as const

/** The grid's reserved second row: a slim utility strip, button left-aligned. */
const footerStripStyle = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderTop: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

const footerButtonStyle = { padding: '2px 10px', fontSize: 12 } as const

/** The stack holding one file's two views; both stay mounted, one is shown. */
const bothPanesStyle = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } as const

/**
 * Visibility of one of a file's two views — hidden, never unmounted, so its
 * draft and scroll position survive a switch.
 * @param shown - whether this view is the visible one.
 * @returns the pane style.
 */
function paneStyleFor(shown: boolean): React.CSSProperties {
  return { display: shown ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }
}

const handleStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 8,
  marginLeft: -4,
  cursor: 'col-resize',
  zIndex: 21,
  touchAction: 'none',
} as const

/** The one-line notice a capability run (or its confirmed writes) reports. */
const noticeStyle = {
  position: 'absolute',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: '80%',
  padding: '6px 12px',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(28, 26, 22, 0.15)',
  fontSize: 12,
  zIndex: 45,
  cursor: 'pointer',
} as const

/** The tree sections that carry entities, and the entity kind each one is. */
const ROSTER_SECTIONS: Partial<Record<KbTreeSectionId, string>> = {
  meetings: 'meeting',
  areas: 'area',
  people: 'person',
  projects: 'project',
}

/**
 * Every entity in the KB, from both trees, as the distill roster (ADR-0030):
 * name, type, path — the resources and todo sections contribute nothing.
 * @param left - the intake tree.
 * @param right - the workspace tree.
 * @returns the roster entries.
 */
function rosterOfTrees(
  left: readonly KbTreeSection[],
  right: readonly KbTreeSection[],
): RefineRosterEntry[] {
  return [...left, ...right].flatMap((section) => {
    const type = ROSTER_SECTIONS[section.id]
    if (type === undefined) return []
    return section.files.map(file => ({ name: file.name, type, path: file.path }))
  })
}

/**
 * Whether one KB path is an archivable entity file (ADR-0041 决定 2): one of
 * the four kinds under `entities/` — the todo singleton carries no archive
 * semantics, and resources are not entities at all.
 * @param path - KB-relative path with forward slashes.
 * @returns true when the path names an entity the archive gesture accepts.
 */
function archivableEntityPath(path: string): boolean {
  return /^entities\/(?:projects|areas|people|meetings)\/[^/]+\.md$/u.test(path)
}

/** One queued gesture plus its 任务 row (ADR-0031). */
interface RefineQueued {
  readonly gesture: RefineGesture
  readonly taskId: string
}

/**
 * A refine gesture's 「动作＋对象」 line: the resource for 归入 and 提炼到实
 * 体, the entity for the row menu's 提炼.
 * @param gesture - the queued gesture.
 * @returns the 任务 row's title.
 */
function refineTitle(gesture: RefineGesture): string {
  const what = gesture.mode === 'refine'
    ? gesture.entityName ?? ''
    : gesture.resource?.name ?? '资源'
  return gesture.mode === 'intake' ? `归入「${what}」` : `提炼「${what}」`
}

/**
 * One rail drag handle: pointer capture plus rAF-throttled dx reports against
 * the drag-start origin (the AppFrame pattern).
 * @param props.left - handle position in px.
 * @param props.onDrag - receives the pointer delta since drag start.
 * @returns the handle element.
 */
function DragHandle(props: {
  side: 'intake' | 'workspace'
  left: number
  onDrag: (dx: number) => void
}): ReactElement {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
  }, [])

  return (
    <div
      style={{ ...handleStyle, left: props.left }}
      data-rail-handle={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    />
  )
}

/**
 * Render the three panes.
 * @param props - see {@link FrameProps}.
 * @returns the frame element.
 */
export function Frame({
  t, renderSlot, panels, intake, workspace, read, write, archiveEntity, restoreEntity, setRelation, createEntity, root, setRoot,
  pickDirectory, links, revision, openExternal, todos, writeTodos, mailFetch, mailMarkRead, analyseMail, refine, validate,
  registerResource, capabilityList, capabilityDeclaration, capabilityCreate, capabilityAdopt, capabilityRegister, capabilityRun,
  capabilityDistill,
  promptSession, memoryList, memoryAdd, memoryDelete, memoryProposalList, memoryProposalApprove, memoryProposalDiscard,
  sessionDetail, onKbRootChanged, mailDelete, mailArchive,
  promptShortcutList, promptShortcutSave, fillShortcut,
  loadModelsConfig, saveModelsConfig,
}: FrameProps): ReactElement {
  const [configOpen, setConfigOpen] = useState(false)
  const [intakeWidth, setIntakeWidth] = useState(RAIL_DEFAULT)
  const [workspaceWidth, setWorkspaceWidth] = useState(RAIL_DEFAULT)
  const [intakeOpen, setIntakeOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const frameRef = useRef<HTMLDivElement | null>(null)
  // The frame measures itself, not the window: the grid is the thing the
  // columns have to fit into.
  useEffect(() => {
    const el = frameRef.current
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports start with both rails collapsed; crossing the breakpoint
  // re-applies that default once per crossing, and a manual toggle still wins
  // until the next crossing.
  const narrow = viewport < NARROW
  useEffect(() => {
    setIntakeOpen(!narrow)
    setWorkspaceOpen(!narrow)
  }, [narrow])

  // Publish this frame's toggles into the seat `ctx.layout` reads.
  useEffect(() => {
    panels.toggleIntake = () => { setIntakeOpen(open => !open) }
    panels.openWorkspace = () => { setWorkspaceOpen(true) }
    panels.closeWorkspace = () => { setWorkspaceOpen(false) }
  }, [panels])

  const cols = solveColumns(
    viewport,
    intakeOpen ? intakeWidth : 0,
    workspaceOpen ? workspaceWidth : 0,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols

  const onIntakeDrag = useCallback((dx: number) => {
    setIntakeWidth(clampRail(colsRef.current.intake + dx))
  }, [])
  const onWorkspaceDrag = useCallback((dx: number) => {
    setWorkspaceWidth(clampRail(colsRef.current.workspace - dx))
  }, [])

  // ── the centre pane's tabs ────────────────────────────────────────────────
  // Session switching never touches this state: the frame is root-scoped, so
  // file tabs (and the draft inside each mounted editor) survive it.
  const [tabs, setTabs] = useState<TabState>(emptyTabs)
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({})
  // ADR-0014: a file opens on its reading view; the source editor stays mounted
  // beside it (hidden) and reports its draft, so the reading view shows the
  // same text without a second read and without owning a draft of its own.
  const [viewMode, setViewMode] = useState<ViewMode>('read')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // The mounted editors' one-command face, keyed by path: a checkbox click in
  // the reading view saves through the editor that owns that file's baseline.
  const editors = useRef(new Map<string, FileEditorApi>())
  // Persistence is armed only after the restore pass: writing the initial
  // empty state first would erase last session's tabs.
  const [restored, setRestored] = useState(false)
  const [treeKey, setTreeKey] = useState(0)
  const [needsRoot, setNeedsRoot] = useState(false)

  // The KB root, kept only so "在 Obsidian 中打开" can name an absolute path.
  const [kbRoot, setKbRoot] = useState('')
  useEffect(() => {
    let stale = false
    void root().then((next) => {
      if (!stale) setKbRoot(next.root)
    }).catch(() => {
      // A root the workbench cannot read is the first-run flow's problem, not
      // this button's; it falls back to opening the relative path.
    })
    return () => {
      stale = true
    }
  }, [root, treeKey])

  // Every loader is a fresh closure on each render (inject face), so the
  // mount-only effects reach them through a ref.
  const faces = useRef({ read, root })
  faces.current = { read, root }

  // Restore the persisted tabs, dropping any path that no longer reads.
  useEffect(() => {
    const paths = restoreTabs()
    if (paths.length === 0) {
      setRestored(true)
      return
    }
    let stale = false
    void Promise.all(paths.map(path => faces.current.read(path).then(
      () => path,
      () => null,
    ))).then((kept) => {
      if (stale) return
      // A path that no longer reads is dropped silently: a stale tab is worse
      // than a missing one. A restored tab is restored, not entered — the
      // conversation is what the human sees first.
      const next = kept
        .filter((path): path is string => path !== null)
        .reduce<TabState>(
          (state, path) => openTab(state, path, readOnlyPath(path) ? 'read' : 'edit'),
          emptyTabs(),
        )
      setTabs(activateTab(next, CONVERSATION_TAB))
      setRestored(true)
    })
    return () => {
      stale = true
    }
  }, [])

  useEffect(() => {
    if (restored) persistTabs(tabs)
  }, [tabs, restored])

  // First run: no configured KB root means there is nothing to show yet.
  useEffect(() => {
    let stale = false
    faces.current.root().then(
      (info) => { if (!stale) setNeedsRoot(!info.configured) },
      () => { if (stale) return; setNeedsRoot(true) },
    )
    return () => {
      stale = true
    }
  }, [])

  const openFile = useCallback((path: string, mode: TabMode): void => {
    setTabs(state => openTab(state, path, mode))
  }, [])

  // ADR-0021 决定 4: the confirmed proposal lands through the shared applier's
  // direct RPCs — the frame owns the KB seams, the task owns the state machine.
  // ADR-0032 批次③: the card's 记忆 rows go through the same memoryAdd.
  const applyConfirmed = useCallback(
    (options: { proposal: Proposal; ticked: readonly number[] }): Promise<ProposalApplyResult> =>
      applyProposal({ ...options, target: { createEntity, read, write, todos, writeTodos, memoryAdd } }),
    [createEntity, read, write, todos, writeTodos, memoryAdd],
  )

  // The one confirm path every proposal card shares (capability runs'
  // ADR-0021 决定 4, refine's ADR-0029 决定 3): apply, reload the trees, and
  // report the writes — or the failure — in the foot notice.
  const confirmProposal = useCallback((proposal: Proposal, ticked: readonly number[]): void => {
    void applyConfirmed({ proposal, ticked }).then((result) => {
      setTreeKey(key => key + 1)
      setCapabilityNotice([...result.written, ...result.skipped].join('；') || '没有写入任何内容。')
    }, (failure: unknown) => {
      setCapabilityNotice(`写入失败：${remoteMessage(failure)}`)
    })
  }, [applyConfirmed])

  // ── the 任务 tab's rows (ADR-0031) ────────────────────────────────────────
  // One row per execution the workbench itself started — refine gestures,
  // mail analyses, script capability runs — this session only, frontend
  // memory only. The three run owners report their transitions here; the
  // running-on-top ordering happens at render time in sortTaskRows.
  const [taskRows, setTaskRows] = useState<readonly TaskRow[]>([])
  const taskSeq = useRef(0)
  const taskBegin = useCallback((kind: TaskKind, title: string, stage: string): string => {
    taskSeq.current += 1
    const id = `task-${taskSeq.current}`
    setTaskRows(rows => [
      { id, kind, title, stage, detail: null, status: 'running', startedAt: Date.now(), endedAt: null, sessionId: null },
      ...rows,
    ])
    return id
  }, [])
  const taskPatch = useCallback((
    id: string,
    patch: Partial<Pick<TaskRow, 'stage' | 'detail' | 'status' | 'endedAt' | 'sessionId'>>,
  ): void => {
    setTaskRows(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row))
  }, [])
  const taskEnd = useCallback((id: string, status: TaskStatus, stage: string): void => {
    taskPatch(id, { status, stage, endedAt: Date.now() })
  }, [taskPatch])

  // ADR-0021 决定 7 + ADR-0026 决定 4: a row menu's capability run. A
  // script capability still runs through `capabilityRun` — a run that
  // answers with a proposal (`{ actions: [...] }`) opens the shared card,
  // anything else is one dismissable notice at the frame's foot. An
  // instruction capability is the gesture instead: the client sends the
  // plain user message `/name @path` — no fetch, no concatenation — and the
  // controller's pre-step (ADR-0025 决定 3) injects the SKILL.md body. The
  // message lands in the transcript exactly as if the human had typed it.
  const [capabilityProposal, setCapabilityProposal] = useState<Proposal | null>(null)
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null)
  // ADR-0044 决定 6: every settled script run leaves a record — the 能力
  // tab's 运行记录 renders them, and the 提炼经验 button turns one record
  // into a distill session. Frontend memory, this session only.
  const [capabilityRuns, setCapabilityRuns] = useState<readonly CapabilityRunRecord[]>([])
  const capabilityRunSeq = useRef(0)
  const [distillingRunId, setDistillingRunId] = useState<string | null>(null)
  // Cancellation (ADR-0031): the running script capability's abort controller.
  // The signal is both the RPC's cancel line and the witness that separates
  // 「人停的」 from a real failure in the rejection path.
  const capabilityAbort = useRef<AbortController | null>(null)
  const [capabilityRunning, setCapabilityRunning] = useState(false)
  const runRowCapability = useCallback((capability: KbCapabilitySummary, path: string): void => {
    setCapabilityNotice(null)
    if (capability.entry === undefined) {
      void promptSession(capabilityGestureMessage(capability.name, { path })).then(
        () => {},
        (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`) },
      )
      return
    }
    const aborter = new AbortController()
    capabilityAbort.current = aborter
    setCapabilityRunning(true)
    setCapabilityNotice(`能力「${capability.name}」执行中…`)
    // The run is a task row too (ADR-0031); its 取消 drives the same aborter.
    const taskId = taskBegin('capability', `能力「${capability.name}」`, '执行中')
    void capabilityRun({ name: capability.name, input: { path } }, aborter.signal).then((result) => {
      capabilityAbort.current = null
      setCapabilityRunning(false)
      // The run's observable envelope is the distill gesture's input — keep
      // it while the session lives (ADR-0044 决定 6).
      const exec = result.exec
      capabilityRunSeq.current += 1
      setCapabilityRuns(rows => [{
        id: `cap-run-${capabilityRunSeq.current}`,
        name: capability.name,
        ok: exec === undefined || exec.exitCode === 0,
        ...(exec !== undefined ? { exec } : {}),
        at: Date.now(),
      }, ...rows])
      const proposal = proposalOfRunResult(result)
      if (proposal !== null) {
        setCapabilityProposal(proposal)
        taskEnd(taskId, 'done', '提议已出，待确认')
      } else {
        setCapabilityNotice(runNoticeOf(result))
        taskEnd(taskId, 'done', runNoticeOf(result))
      }
    }, (failure: unknown) => {
      capabilityAbort.current = null
      setCapabilityRunning(false)
      // A refused run is a record too: a failure is exactly where the
      // lessons live, and the distiller reads the refusal prose as the
      // envelope's absence.
      capabilityRunSeq.current += 1
      setCapabilityRuns(rows => [{
        id: `cap-run-${capabilityRunSeq.current}`,
        name: capability.name,
        ok: false,
        at: Date.now(),
      }, ...rows])
      if (aborter.signal.aborted) {
        setCapabilityNotice(`能力「${capability.name}」已取消。`)
        taskEnd(taskId, 'cancelled', '已取消')
      } else {
        setCapabilityNotice(`能力「${capability.name}」失败：${remoteMessage(failure)}`)
        taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
      }
    })
  }, [capabilityRun, promptSession, taskBegin, taskEnd])

  /** Stop the running script capability (ADR-0031): the subprocess is killed server-side. */
  const cancelCapability = useCallback((): void => {
    capabilityAbort.current?.abort()
  }, [])

  // ADR-0044 决定 6: the 提炼经验 gesture on one run record — a headless
  // session proposes 0–3 memory candidates through kb_propose_memory. The
  // queue count is the outcome; the session is kept for re-reading. One
  // distill at a time: each burns a model call, and stacking them hides
  // that cost.
  const distillRun = useCallback((record: CapabilityRunRecord): void => {
    if (distillingRunId !== null) return
    setDistillingRunId(record.id)
    setCapabilityNotice(`提炼「${record.name}」经验中…`)
    const taskId = taskBegin('capability', `提炼「${record.name}」经验`, '提炼中')
    void capabilityDistill(record).then((outcome) => {
      setDistillingRunId(null)
      setCapabilityNotice(`提炼完成：提案队列共 ${outcome.pending} 条待批准。`)
      taskEnd(taskId, 'done', `提案队列共 ${outcome.pending} 条待批准`)
    }, (failure: unknown) => {
      setDistillingRunId(null)
      setCapabilityNotice(`提炼失败：${remoteMessage(failure)}`)
      taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
    })
  }, [capabilityDistill, distillingRunId, taskBegin, taskEnd])

  // ADR-0029 + ADR-0030: the refine gestures — 归入 (a resource dropped on an
  // entity row), 提炼 (an entity row's menu item) and 提炼到实体 (a resource
  // row's or a directory's menu item) — all land here. Gestures queue and run
  // strictly one at a time: a directory's distill enqueues one gesture per
  // file, and the next run starts only after the previous one's card or
  // question dialog has been dealt with. The frame gathers the sibling entity
  // names for `[[双链]]` suggestions from the workspace tree, and the distill
  // roster — every entity in the KB, with its type — from both trees. An
  // irrelevant intake verdict is a toast with the reason — no card, no log,
  // no trace (决定 2); anything else opens the same proposal card the
  // capability runs use.
  const [refineProposal, setRefineProposal] = useState<Proposal | null>(null)
  // The paused run: its verdict asked questions, and the dialog holds the
  // human's answers until they continue the same session.
  const [refineQuestion, setRefineQuestion] = useState<{
    run: RefineRun
    gesture: RefineGesture
    taskId: string
  } | null>(null)
  const [refineContinuing, setRefineContinuing] = useState(false)
  const refineQueue = useRef<RefineQueued[]>([])
  const refineDraining = useRef(false)
  const drainRefineRef = useRef<() => void>(() => {})
  // Cancellation (ADR-0031): the running gesture's abort controller, and the
  // flag that tells the failure path apart from a real failure. The queue is
  // the truth of 「还有没有在跑」, mirrored into state only for the cancel
  // button's visibility.
  const refineAbort = useRef<AbortController | null>(null)
  const refineCancelled = useRef(false)
  const [refineActive, setRefineActive] = useState(false)

  /** Release the drain gate and start the next queued gesture, if any. */
  const settleRefine = useCallback((): void => {
    refineDraining.current = false
    setRefineActive(false)
    drainRefineRef.current()
  }, [])

  /** Stop everything the refine pipeline is doing: drop the queue, kill the run. */
  const cancelRefine = useCallback((): void => {
    for (const queued of refineQueue.current) taskEnd(queued.taskId, 'cancelled', '已取消')
    refineQueue.current = []
    if (refineQuestion !== null) {
      setRefineQuestion(null)
      taskEnd(refineQuestion.taskId, 'cancelled', '已取消')
      settleRefine()
    }
    if (refineDraining.current) {
      refineCancelled.current = true
      refineAbort.current?.abort()
    }
  }, [refineQuestion, settleRefine, taskEnd])

  /** One run's end: a toast for an irrelevant intake, a card for the rest. */
  const showRefineRun = useCallback((run: RefineRun, gesture: RefineGesture, taskId: string): void => {
    if (run.skippedEmpty === true) {
      const what = gesture.resource?.name ?? gesture.entityName
      setCapabilityNotice(`「${what}」是空文件（只有标题），已跳过。`)
      taskEnd(taskId, 'done', '空文件，已跳过')
      settleRefine()
      return
    }
    if (!run.relevant) {
      const what = gesture.resource?.name ?? gesture.entityName
      setCapabilityNotice(`「${what}」与「${gesture.entityName ?? '知识库'}」无关：${run.reason}`)
      taskEnd(taskId, 'done', `无关：${run.reason}`)
      settleRefine()
      return
    }
    setCapabilityNotice(null)
    if (run.proposal !== undefined) {
      setRefineProposal(run.proposal)
      taskEnd(taskId, 'done', '提议已出，待确认')
    } else {
      taskEnd(taskId, 'done', '无需改动')
      settleRefine()
    }
  }, [settleRefine, taskEnd])

  const drainRefine = useCallback((): void => {
    if (refineDraining.current) return
    const queued = refineQueue.current.shift()
    if (queued === undefined) return
    refineDraining.current = true
    refineCancelled.current = false
    const aborter = new AbortController()
    refineAbort.current = aborter
    setRefineActive(true)
    taskPatch(queued.taskId, { stage: '分析中' })
    const label = queued.gesture.mode === 'distill' ? queued.gesture.resource?.name ?? '资源' : queued.gesture.entityName ?? ''
    setCapabilityNotice(`提炼「${label}」中…`)
    void (async () => {
      if (queued.gesture.mode === 'distill') {
        const [intakeTree, workspaceTree] = await Promise.all([intake(), workspace()])
        return refine({ ...queued.gesture, roster: rosterOfTrees(intakeTree, workspaceTree), signal: aborter.signal })
      }
      const tree = await workspace()
      const siblings = [...new Set(tree.flatMap(section => section.files.map(file => file.name)))]
      return refine({ ...queued.gesture, siblings, signal: aborter.signal })
    })().then((run) => {
      setRefineActive(false)
      // Anchor the row's 「详情」 entry to the run's session (ADR-0033); the
      // skipped-empty run never made one, and its '' sentinel maps to null.
      taskPatch(queued.taskId, { sessionId: run.sessionId === '' ? null : run.sessionId })
      // Questions take precedence: the dialog pauses the queue until the
      // human answers (the same session continues) or abandons the run.
      if (run.questions !== undefined && run.questions.length > 0) {
        setCapabilityNotice(null)
        taskPatch(queued.taskId, { status: 'waiting', stage: '有问题等你回答' })
        setRefineQuestion({ run, gesture: queued.gesture, taskId: queued.taskId })
        return
      }
      showRefineRun(run, queued.gesture, queued.taskId)
    }, (failure: unknown) => {
      setRefineActive(false)
      setCapabilityNotice(refineCancelled.current
        ? '提炼已取消。'
        : `提炼失败：${remoteMessage(failure)}`)
      taskEnd(queued.taskId, refineCancelled.current ? 'cancelled' : 'failed',
        refineCancelled.current ? '已取消' : `失败：${remoteMessage(failure)}`)
      settleRefine()
    })
  }, [refine, intake, workspace, showRefineRun, settleRefine, taskPatch, taskEnd])
  drainRefineRef.current = drainRefine

  const runRefineGesture = useCallback((gesture: RefineGesture): void => {
    const taskId = taskBegin('refine', refineTitle(gesture), '排队中')
    refineQueue.current.push({ gesture, taskId })
    drainRefine()
  }, [drainRefine, taskBegin])

  // ── the validate gesture (ADR-0035) ───────────────────────────────────────
  // The fourth gesture, and the simplest run shape: no queue — at most ONE
  // run at a time, guarded both by state (the buttons' enablement reads it)
  // and by a synchronous ref (two clicks inside one tick must not slip past
  // React's batching). No roster gathering (the runner prescans the graph
  // itself), one session, one verdict. Stage reports ride the runner's
  // onStage; the closing notice carries the stats tally home.
  const [validateProposal, setValidateProposal] = useState<Proposal | null>(null)
  const [validateQuestion, setValidateQuestion] = useState<{ run: ValidateRun; taskId: string } | null>(null)
  // The run behind the shown card: the free-input box's continuation hangs
  // off it (2026-09-30 修订) — each instruction round replaces both.
  const [validateLive, setValidateLive] = useState<{ run: ValidateRun; taskId: string } | null>(null)
  const [validateContinuing, setValidateContinuing] = useState(false)
  const validateAbort = useRef<AbortController | null>(null)
  const validateCancelled = useRef(false)
  const validateBusy = useRef(false)
  const [validateActive, setValidateActive] = useState(false)

  /** One validate run's end: the stats notice, then the card. */
  const showValidateRun = useCallback((run: ValidateRun, taskId: string): void => {
    taskEnd(taskId, 'done', '提议已出，待确认')
    setCapabilityNotice(t('validate.notice', {
      entities: run.stats.entities,
      prescan: run.stats.prescan,
      findings: run.stats.findings,
      filtered: run.stats.filtered,
      tokens: run.stats.tokens,
      elapsed: formatElapsed(run.stats.elapsedMs),
    }))
    if (run.proposal !== undefined) {
      setValidateProposal(run.proposal)
      setValidateLive({ run, taskId })
    }
  }, [t, taskEnd])

  /** One instruction round from the card's free-input box: revise in place. */
  const sendValidateInstruction = useCallback((text: string): Promise<void> => {
    const live = validateLive
    if (live === null || live.run.continueWithInstruction === undefined) return Promise.resolve()
    // A continuation occupies the same slot a fresh pass would: gate it with
    // the same busy flag, or a second validate could run alongside it
    // (OCR review 2026-09-30).
    validateBusy.current = true
    setValidateActive(true)
    setValidateContinuing(true)
    taskPatch(live.taskId, { status: 'running', stage: '正在按意见修订…', endedAt: null })
    return live.run.continueWithInstruction(text).then((final) => {
      showValidateRun(final, live.taskId)
    }, (failure: unknown) => {
      if (validateCancelled.current) {
        setCapabilityNotice('实体校验修订已取消。')
        taskEnd(live.taskId, 'cancelled', '已取消')
        return
      }
      setCapabilityNotice(`实体校验修订失败：${remoteMessage(failure)}`)
      taskEnd(live.taskId, 'failed', `失败：${remoteMessage(failure)}`)
      // Rethrow so the card's free-input box keeps the draft for retry.
      throw failure
    }).finally(() => {
      validateBusy.current = false
      setValidateActive(false)
      setValidateContinuing(false)
    })
  }, [showValidateRun, taskEnd, taskPatch, validateLive])

  const runValidateGesture = useCallback((scope: ValidateScope): void => {
    // One at a time: a running pass or an unanswered question round swallows
    // any further trigger (the ref answers synchronously, within one tick).
    if (validateBusy.current || validateQuestion !== null) return
    validateBusy.current = true
    setCapabilityNotice(null)
    const aborter = new AbortController()
    validateAbort.current = aborter
    validateCancelled.current = false
    setValidateActive(true)
    const taskId = taskBegin('validate', t(scope === 'person' ? 'validate.task.person' : 'validate.task.project'), t('validate.stage.prescan'))
    const stageOf = (stage: ValidateStage): string =>
      stage === 'prescan' ? t('validate.stage.prescan') : stage === 'analyse' ? t('validate.stage.analyse') : t('validate.stage.proposal')
    // Anchor the session onto the task row the instant it exists: 查看/详情
    // then work while the run is in flight, and after a failure too.
    void validate({
      scope,
      signal: aborter.signal,
      onStage: (stage) => { taskPatch(taskId, { stage: stageOf(stage) }) },
      onSession: (sessionId) => { taskPatch(taskId, { sessionId }) },
    }).then((run) => {
      validateBusy.current = false
      setValidateActive(false)
      // Belt and braces: onSession already anchored the session at creation;
      // this patch covers runners that never fire it.
      taskPatch(taskId, { sessionId: run.sessionId })
      if (run.questions !== undefined && run.questions.length > 0) {
        taskPatch(taskId, { status: 'waiting', stage: '有问题等你回答' })
        setValidateQuestion({ run, taskId })
        return
      }
      showValidateRun(run, taskId)
    }, (failure: unknown) => {
      validateBusy.current = false
      setValidateActive(false)
      setCapabilityNotice(validateCancelled.current
        ? '实体校验已取消。'
        : `实体校验失败：${remoteMessage(failure)}`)
      taskEnd(taskId, validateCancelled.current ? 'cancelled' : 'failed',
        validateCancelled.current ? '已取消' : `失败：${remoteMessage(failure)}`)
    })
  }, [showValidateRun, t, taskBegin, taskEnd, taskPatch, validate, validateQuestion])

  /** Stop the running validate (or abandon its question round). */
  const cancelValidate = useCallback((): void => {
    if (validateQuestion !== null) {
      setValidateQuestion(null)
      taskEnd(validateQuestion.taskId, 'cancelled', '已放弃')
      return
    }
    validateCancelled.current = true
    validateAbort.current?.abort()
  }, [taskEnd, validateQuestion])

  // ── the mail run (ADR-0031) ──────────────────────────────────────────────
  // The frame owns the mail run store now: the 任务 tab mirrors every
  // analysis as a row, so the store must live where the frame can watch it.
  // It already outlived the panel; now it outlives the rail's tab strip too.
  const mailRun = useMemo(() => createMailRun(), [])
  const mailState = useMailRun(mailRun)
  // The analysis's row, from `analysing` through the proposal card to the
  // write (or the dismiss) — the store's phase transitions drive it.
  const mailTaskId = useRef<string | null>(null)
  useEffect(() => {
    const stageOf = (stage: AnalysisStage): string =>
      stage === 'session' ? '创建会话' : stage === 'prompt' ? '准备分析' : '分批判定'
    if (mailState.phase === 'analysing') {
      const id = mailTaskId.current ?? taskBegin('mail', `邮件分析（${mailState.mails.length} 封）`, '创建会话')
      mailTaskId.current = id
      const progress = mailState.progress
      const detail = progress !== null && progress.done !== undefined && progress.total !== undefined
        ? `已判 ${progress.done}/${progress.total} 封`
        : null
      taskPatch(id, {
        stage: progress === null ? '创建会话' : stageOf(progress.stage),
        ...(detail !== null ? { detail } : {}),
        // Anchor the row's 「详情」 entry once the run's session exists (ADR-0033).
        ...(mailState.sessionId !== null ? { sessionId: mailState.sessionId } : {}),
      })
      return
    }
    if (mailState.phase === 'applying') {
      if (mailTaskId.current !== null) taskPatch(mailTaskId.current, { status: 'running', stage: '正在写入' })
      return
    }
    if (mailTaskId.current === null) return
    const id = mailTaskId.current
    if (mailState.review !== null) {
      // 待确认不是这条行的终点：确认后的写入、或关掉卡片，都是同一行的
      // 后续阶段 —— 所以这里只挂起行，id 必须留着（清了它，确认写入后
      // 的 applying/idle 两拍都会因拿不到 id 而 return，行永远停在待确认）。
      taskPatch(id, { status: 'waiting', stage: '提议待确认' })
      return
    }
    mailTaskId.current = null
    if (mailState.cancelled) taskEnd(id, 'cancelled', '已取消，已完成的判定保留')
    else if (mailState.error !== null) taskEnd(id, 'failed', mailState.error)
    else if (mailState.summary.length > 0) taskEnd(id, 'done', `已写入 ${mailState.summary.length} 项`)
    else taskEnd(id, 'done', '已忽略')
  }, [mailState, taskBegin, taskPatch, taskEnd])

  // The fetch is an execution the workbench started too (ADR-0031 落地注记二):
  // the panel's 读取 buttons go through this wrapper, so the read shows as a
  // row of its own — 「读取邮件」 — with the same cancel line as any
  // capability run: the signal rides the RPC and an abort kills the reader
  // subprocess server-side. Its row is watched by id, not by the analysis's
  // store — the two lifecycles never overlap (the analysis starts from the
  // fetch's result).
  const mailFetchTaskId = useRef<string | null>(null)
  const mailFetchAbort = useRef<AbortController | null>(null)
  const bookedMailFetch = useCallback(async (args: KbMailFetchArgs): Promise<KbMailFetchResult> => {
    const taskId = taskBegin('mail', '读取邮件', '读取中')
    mailFetchTaskId.current = taskId
    const aborter = new AbortController()
    mailFetchAbort.current = aborter
    try {
      const result = await mailFetch(args, aborter.signal)
      taskEnd(taskId, 'done', `已读 ${result.messages.length} 封`)
      return result
    } catch (failure: unknown) {
      if (aborter.signal.aborted) taskEnd(taskId, 'cancelled', '已取消')
      else taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
      throw failure
    } finally {
      mailFetchTaskId.current = null
      mailFetchAbort.current = null
    }
  }, [mailFetch, taskBegin, taskEnd])

  // ADR-0033: the 任务 row's 「详情」 — a read-only drawer over the run's
  // session log. The row anchors to a session only when its run made one
  // (refine and mail analysis do; script capabilities are bare subprocesses),
  // so TasksPane renders the verb only for those rows.
  const [detailRow, setDetailRow] = useState<TaskRow | null>(null)
  const onTaskDetail = useCallback((row: TaskRow): void => { setDetailRow(row) }, [])
  const closeTaskDetail = useCallback((): void => { setDetailRow(null) }, [])

  // ADR-0031: the 任务 row's two verbs. 查看 goes to where the outcome
  // lives — refine speaks through the conversation's cards and notices, the
  // other two through the intake rail's 能力 tab. A validate row's outcome
  // is the card, already popped here, so its 查看 opens the ADR-0033 detail
  // drawer instead: the run's session log carries the prescan lists and the
  // model's full judgement (they ride inside the prompt), which is the
  // "more" a curious human wants. While the run has not anchored a session
  // yet there is nothing to open. 取消 reuses the exact cancel path each
  // runner already owns.
  const [connectorNonce, setConnectorNonce] = useState(0)
  const jumpTask = useCallback((row: TaskRow): void => {
    if (row.kind === 'validate') {
      if (row.sessionId !== null) setDetailRow(row)
      return
    }
    if (row.kind === 'refine') setTabs(state => activateTab(state, CONVERSATION_TAB))
    else {
      setIntakeOpen(true)
      setConnectorNonce(nonce => nonce + 1)
    }
  }, [])
  const cancelTask = useCallback((row: TaskRow): void => {
    if (row.kind === 'refine') cancelRefine()
    else if (row.kind === 'validate') cancelValidate()
    else if (row.kind === 'mail' && row.id === mailFetchTaskId.current) mailFetchAbort.current?.abort()
    else if (row.kind === 'mail') mailRun.cancel()
    else cancelCapability()
  }, [cancelRefine, cancelValidate, cancelCapability, mailRun])

  // ADR-0017: editing belongs to Obsidian, so this only hands the file over.
  // Without a root we still open the KB-relative path and let the host resolve
  // it — the desktop's `.md` handler is usually Obsidian anyway.
  const openInObsidian = useCallback((path: string): void => {
    const target = kbRoot === '' ? path : obsidianUri(kbRoot, path)
    void openExternal(target).catch((reason: unknown) => {
      console.warn('opening the file outside the workbench failed:', reason)
    })
  }, [kbRoot, openExternal])

  // ADR-0041 决定 7: the detail view's 归档/还原 button — the primary
  // gesture, sharing the row menu's RPC pair. The host rewrites the file, so
  // an open editor's baseline goes stale exactly as after a row-menu relation
  // write (its conflict bar is the guard); the button's own label is patched
  // from the RPC's answer, since the draft still carries the old envelope.
  const [archivedOverrides, setArchivedOverrides] = useState<Readonly<Record<string, boolean>>>({})
  const [archiveBusy, setArchiveBusy] = useState(false)
  const toggleArchive = useCallback((path: string, archived: boolean): void => {
    setArchiveBusy(true)
    void (archived ? archiveEntity(path) : restoreEntity(path)).then((result) => {
      setArchivedOverrides(current => ({ ...current, [path]: result.archived }))
      setTreeKey(key => key + 1)
    }, (failure: unknown) => {
      setCapabilityNotice(remoteMessage(failure))
    }).finally(() => {
      setArchiveBusy(false)
    })
  }, [archiveEntity, restoreEntity])

  // ── the selection right-click (ADR-0025 决定 5) ───────────────────────────
  // The menu's capability list: the instruction capabilities that opted in
  // through `appliesTo.selection: true` — the menu must not grow with every
  // capability that has no better idea than bare text. Reloaded with the
  // tree: a KB revision may have brought new skills.
  const [selectionCaps, setSelectionCaps] = useState<KbCapabilitySummary[]>([])
  useEffect(() => {
    let stale = false
    void capabilityList().then((result) => {
      if (stale) return
      setSelectionCaps(result.capabilities.filter(capability =>
        capability.entry === undefined
        && capability.appliesTo?.selection === true
        && capability.invocation.includes('human')))
    }, () => {
      // A failed load just leaves the menu with 「发送到会话」.
    })
    return () => {
      stale = true
    }
  }, [capabilityList, treeKey])

  // One document-level mouseup reads the selection from the two v1 surfaces —
  // the source editor's textarea (its own selectionStart/End; the DOM
  // selection never sees textarea text) and the reading view's rendered body
  // (window.getSelection, scoped by the body's data marker). Everything else —
  // including the conversation's own composer — leaves the menu alone.
  const [selectionMenu, setSelectionMenu] = useState<{ text: string; x: number; y: number } | null>(null)
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // A mouseup inside the menu itself must not re-evaluate the selection:
      // it lands before the item's click and would close the menu unclicked.
      if (target.closest('[data-selection-menu="true"]') !== null) return
      let text = ''
      if (target instanceof HTMLTextAreaElement && target.dataset.kbEditor === 'true') {
        const { selectionStart, selectionEnd, value } = target
        text = value.slice(selectionStart, selectionEnd)
      } else {
        const selection = window.getSelection()
        const anchor = selection?.anchorNode
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement
        if (anchorElement?.closest('[data-markdown-body="true"]') !== null) text = selection?.toString() ?? ''
      }
      if (text.trim() === '') return
      setSelectionMenu({ text, x: event.clientX, y: event.clientY })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // 「发送到会话」: the selection *is* the prompt.
  const sendSelection = useCallback((text: string): void => {
    setCapabilityNotice(null)
    void promptSession(text).then(
      () => { setCapabilityNotice('已发送到当前会话。') },
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`) },
    )
  }, [promptSession])

  // The no-selection sibling (ADR-0025 决定 5): right-clicking the middle
  // pane's md surfaces with nothing selected offers the same opted-in
  // capabilities, the open file riding along as the object — runRowCapability
  // sends it as the `/name @path` gesture message (ADR-0026 决定 4), the
  // resource right-click's exact form. A selection keeps the mouseup menu in
  // charge; a bare right-click opens this one, and only when some capability
  // opted in.
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activeFile(tabs)?.path ?? null
  const selectionCapsRef = useRef(selectionCaps)
  selectionCapsRef.current = selectionCaps
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const inBody = target.closest('[data-markdown-body="true"]') !== null
      const inEditor = target instanceof HTMLTextAreaElement && target.dataset.kbEditor === 'true'
      if (!inBody && !inEditor) return
      let hasSelection: boolean
      if (inEditor) {
        hasSelection = target.selectionStart !== target.selectionEnd
      } else {
        hasSelection = (window.getSelection()?.toString() ?? '').trim() !== ''
      }
      if (hasSelection) return
      const path = activePathRef.current
      if (path === null || selectionCapsRef.current.length === 0) return
      event.preventDefault()
      setFileMenu({ path, x: event.clientX, y: event.clientY })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // ADR-0026 决定 4: the selection gesture is a plain user message — `/name`
  // with the selection riding inline (a `> ` quote block once it spans lines)
  // — and the controller's pre-step (ADR-0025 决定 3) injects the SKILL.md
  // body. No client-side fetch, no concatenation; the message is visible in
  // the transcript as if the human had typed it.
  const runSelectionCapability = useCallback((name: string, selection: string): void => {
    setCapabilityNotice(null)
    void promptSession(capabilityGestureMessage(name, { selection })).then(
      () => {},
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`) },
    )
  }, [promptSession])

  // The active file's link graph, host-computed: one call per activation, and
  // again after a tree reload, which is when a new file could have appeared.
  //
  // The file's own text is a dependency too — otherwise typing `[[…]]` leaves
  // the stale graph in place and the link reads as literal brackets until the
  // tab is switched away and back. It is debounced because `linksOf` re-reads
  // every entity file to compute incoming links.
  const [linkGraph, setLinkGraph] = useState<KbLinksResult | undefined>(undefined)
  const activePath = tabs.files.find(tab => tab.path === tabs.active)?.path
  const activeContent = activePath === undefined ? undefined : drafts[activePath]
  useEffect(() => {
    if (activePath === undefined) return
    let stale = false
    const timer = setTimeout(() => {
      void links(activePath).then((graph) => {
        if (!stale) setLinkGraph(graph)
      })
    }, LINK_GRAPH_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [activePath, activeContent, treeKey, links])

  // ADR-0017: what the KB looked like the last time we asked. The host watches
  // the root with chokidar and bumps a counter; we compare it across polls
  // instead of subscribing to pushed events, which would need a line in the
  // upstream forwarded-event allowlist (outside the merge surface).
  useEffect(() => {
    let stale = false
    let seen = -1
    const check = (): void => {
      if (stale || document.hidden) return
      void revision().then((next) => {
        if (stale) return
        if (seen >= 0 && next.revision !== seen) setTreeKey(key => key + 1)
        seen = next.revision
      })
    }
    check()
    const timer = setInterval(check, REVISION_POLL_MS)
    const onVisible = (): void => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      stale = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [revision])

  // One selection for both rails: the file the centre pane shows, so a row
  // stays highlighted through tab switches and a restored tab finds its row.
  const selection = activeFile(tabs)?.path ?? null

  const closeFile = useCallback((path: string): void => {
    setTabs(state => closeTab(state, path))
    setStatuses((current) => {
      const next: Record<string, SaveStatus> = {}
      for (const [key, value] of Object.entries(current)) {
        if (key !== path) next[key] = value
      }
      return next
    })
    // The archive-flag override dies with the tab: a reopen derives the flag
    // from a freshly read envelope.
    setArchivedOverrides((current) => {
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(current)) {
        if (key !== path) next[key] = value
      }
      return next
    })
  }, [])

  /** A new KB root: both rails reload, and the stale tabs' statuses go away. */
  const onConfigured = useCallback((): void => {
    setNeedsRoot(false)
    setTreeKey(key => key + 1)
    setStatuses({})
    onKbRootChanged()
  }, [onKbRootChanged])

  return (
    <div
      ref={frameRef}
      style={{
        ...frameStyle,
        position: 'relative',
        gridTemplateColumns: `${cols.intake}px minmax(0, 1fr) ${cols.workspace}px`,
      }}
      data-narrow={narrow || undefined}
    >
      <div style={{ ...railColStyle, borderRight: '1px solid var(--yt-border-subtle)' }}>
        <IntakeRail
          collapsed={!intakeOpen}
          load={intake}
          refreshKey={treeKey}
          selection={selection}
          onExpand={() => { setIntakeOpen(true) }}
          onOpenFile={openFile}
          loadTodos={todos}
          writeTodos={writeTodos}
          createEntity={createEntity}
          read={read}
          write={write}
          archiveEntity={archiveEntity}
          restoreEntity={restoreEntity}
          setRelation={setRelation}
          workspace={workspace}
          mailFetch={bookedMailFetch}
          mailMarkRead={mailMarkRead}
          {...(mailDelete !== undefined ? { mailDelete } : {})}
          {...(mailArchive !== undefined ? { mailArchive } : {})}
          analyseMail={analyseMail}
          registerResource={registerResource}
          capabilityList={capabilityList}
          capabilityDeclaration={capabilityDeclaration}
          capabilityCreate={capabilityCreate}
          capabilityAdopt={capabilityAdopt}
          capabilityRegister={capabilityRegister}
          mailRun={mailRun}
          revealConnector={connectorNonce}
          memoryList={memoryList}
          memoryAdd={memoryAdd}
          memoryDelete={memoryDelete}
          memoryProposalList={memoryProposalList}
          memoryProposalApprove={memoryProposalApprove}
          memoryProposalDiscard={memoryProposalDiscard}
          promptShortcutList={promptShortcutList}
          promptShortcutSave={promptShortcutSave}
          fillShortcut={fillShortcut}
          onRunCapability={runRowCapability}
          onRefine={runRefineGesture}
          capabilityRuns={capabilityRuns}
          onDistillCapability={distillRun}
          distillingRunId={distillingRunId}
          kbRoot={kbRoot}
          t={t}
        />
      </div>
      <CenterPane
        tabs={tabs}
        statuses={statuses}
        taskRows={taskRows}
        onTaskCancel={cancelTask}
        onTaskJump={jumpTask}
        onTaskDetail={onTaskDetail}
        taskDetail={detailRow === null ? null : (
          <SessionDetailDrawer
            key={detailRow.id}
            row={detailRow}
            load={sessionDetail}
            onClose={closeTaskDetail}
            t={t}
          />
        )}
        onActivate={(key) => { setTabs(state => activateTab(state, key)) }}
        onClose={closeFile}
        viewMode={viewMode}
        onViewMode={setViewMode}
        renderConversation={() => renderSlot('conversation', {})}
        renderFile={(tab) => {
          if (tab.mode === 'read') {
            return (
              <ReadOnlyFile
                path={tab.path}
                read={read}
                t={t}
              />
            )
          }
          // ADR-0041 决定 7: an entity's detail view carries the archive
          // gesture — 还原 when the envelope (or the last flip's answer) says
          // archived, 归档 otherwise. Non-entity files get no button.
          const archived = archivedOverrides[tab.path] ?? frontmatterArchived(drafts[tab.path] ?? '')
          return (
            <div style={bothPanesStyle}>
              <div style={paneStyleFor(viewMode === 'read')}>
                <MarkdownView
                  content={drafts[tab.path] ?? ''}
                  links={tab.path === linkGraph?.path ? linkGraph : undefined}
                  onOpenExternal={() => { openInObsidian(tab.path) }}
                  onOpen={(path) => { openFile(path, 'edit') }}
                  onEdit={(next) => {
                    void editors.current.get(tab.path)?.patch(next).then((outcome) => {
                      // A conflict lives in the editor's own bar, which the
                      // reading view is hiding: show it rather than losing it.
                      if (outcome === 'conflict') setViewMode('source')
                    })
                  }}
                  onUnresolved={() => { setViewMode('source') }}
                  {...(archivableEntityPath(tab.path) ? {
                    archive: {
                      archived,
                      busy: archiveBusy,
                      onToggle: () => { toggleArchive(tab.path, !archived) },
                    },
                  } : {})}
                  t={t}
                />
              </div>
              <div style={paneStyleFor(viewMode === 'source')}>
                <FileEditor
                  path={tab.path}
                  read={read}
                  write={write}
                  onStatus={(status) => {
                    setStatuses(current => ({ ...current, [tab.path]: status }))
                  }}
                  onDraft={(content) => {
                    setDrafts(current => ({ ...current, [tab.path]: content }))
                  }}
                  onApi={(api) => {
                    if (api === null) editors.current.delete(tab.path)
                    else editors.current.set(tab.path, api)
                  }}
                  t={t}
                />
              </div>
            </div>
          )
        }}
        t={t}
      />
      <div style={{ ...railColStyle, borderLeft: '1px solid var(--yt-border-subtle)' }}>
        <WorkspaceRail
          collapsed={!workspaceOpen}
          load={workspace}
          refreshKey={treeKey}
          selection={selection}
          onExpand={() => { setWorkspaceOpen(true) }}
          onOpenFile={openFile}
          loadTodos={todos}
          writeTodos={writeTodos}
          createEntity={createEntity}
          read={read}
          write={write}
          archiveEntity={archiveEntity}
          restoreEntity={restoreEntity}
          setRelation={setRelation}
          workspace={workspace}
          mailFetch={bookedMailFetch}
          mailMarkRead={mailMarkRead}
          {...(mailDelete !== undefined ? { mailDelete } : {})}
          {...(mailArchive !== undefined ? { mailArchive } : {})}
          analyseMail={analyseMail}
          registerResource={registerResource}
          capabilityList={capabilityList}
          onRunCapability={runRowCapability}
          onRefine={runRefineGesture}
          onValidate={runValidateGesture}
          kbRoot={kbRoot}
          t={t}
        />
      </div>
      {/* The reserved grid row: 配置 lives at the window's bottom-left, a
          flow child so it survives intake collapse. The context status bar
          (ADR-0039) rides beside it through the session-scoped child slot. */}
      <div style={footerStripStyle}>
        <button style={footerButtonStyle} data-config-button="true" onClick={() => { setConfigOpen(true) }}>
          {t('config.open')}
        </button>
        {renderSlot('footer.status', {})}
      </div>
      <div style={overlayStyle}>{renderSlot('shell.overlay', {})}</div>
      {needsRoot && (
        <Onboarding setRoot={setRoot} pickDirectory={pickDirectory} onConfigured={onConfigured} t={t} />
      )}
      {configOpen && (
        <ConfigDialog
          t={t}
          load={loadModelsConfig}
          save={saveModelsConfig}
          onClose={() => { setConfigOpen(false) }}
        />
      )}
      {capabilityProposal !== null && (
        <ProposalCard
          proposal={capabilityProposal}
          onConfirm={(ticked) => {
            const proposal = capabilityProposal
            setCapabilityProposal(null)
            confirmProposal(proposal, ticked)
          }}
          onDismiss={() => { setCapabilityProposal(null) }}
          t={t}
        />
      )}
      {refineProposal !== null && (
        <ProposalCard
          proposal={refineProposal}
          onConfirm={(ticked) => {
            const proposal = refineProposal
            setRefineProposal(null)
            confirmProposal(proposal, ticked)
            // The card was this run's gate: closing it starts the next
            // queued gesture (ADR-0030's one-at-a-time queue).
            settleRefine()
          }}
          onDismiss={() => { setRefineProposal(null); settleRefine() }}
          t={t}
        />
      )}
      {refineQuestion !== null && (
        <QuestionDialog
          run={refineQuestion.run}
          busy={refineContinuing}
          onSubmit={(answers) => {
            const { run, gesture, taskId } = refineQuestion
            setRefineContinuing(true)
            taskPatch(taskId, { status: 'running', stage: '继续分析' })
            void run.continueWithAnswers?.(answers).then((final) => {
              setRefineQuestion(null)
              setRefineContinuing(false)
              showRefineRun(final, gesture, taskId)
            }, (failure: unknown) => {
              setRefineQuestion(null)
              setRefineContinuing(false)
              setCapabilityNotice(`提炼失败：${remoteMessage(failure)}`)
              taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
              settleRefine()
            })
          }}
          onAbort={() => {
            setRefineQuestion(null)
            taskEnd(refineQuestion.taskId, 'cancelled', '已放弃')
            settleRefine()
          }}
          t={t}
        />
      )}
      {validateProposal !== null && (
        <ProposalCard
          proposal={validateProposal}
          onConfirm={(ticked) => {
            const proposal = validateProposal
            setValidateProposal(null)
            setValidateLive(null)
            confirmProposal(proposal, ticked)
          }}
          onDismiss={() => {
            setValidateProposal(null)
            setValidateLive(null)
          }}
          onInstruction={sendValidateInstruction}
          busy={validateContinuing}
          t={t}
        />
      )}
      {validateQuestion !== null && (
        <QuestionDialog
          run={validateQuestion.run}
          busy={validateContinuing}
          onSubmit={(answers) => {
            const { run, taskId } = validateQuestion
            setValidateContinuing(true)
            taskPatch(taskId, { status: 'running', stage: '继续分析' })
            void run.continueWithAnswers?.(answers).then((final) => {
              setValidateQuestion(null)
              setValidateContinuing(false)
              showValidateRun(final, taskId)
            }, (failure: unknown) => {
              setValidateQuestion(null)
              setValidateContinuing(false)
              setCapabilityNotice(`实体校验失败：${remoteMessage(failure)}`)
              taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
            })
          }}
          onAbort={() => {
            setValidateQuestion(null)
            taskEnd(validateQuestion.taskId, 'cancelled', '已放弃')
          }}
          t={t}
        />
      )}
      {capabilityNotice !== null && (
        <div
          style={noticeStyle}
          data-capability-notice="true"
          title={t('frame.closeNotice')}
          onClick={() => { setCapabilityNotice(null) }}
        >
          {capabilityNotice}
          {/* A running refine is cancellable right where it announces itself
              (ADR-0031): the chip stops the run and drops the queue. */}
          {(refineActive || capabilityRunning || validateActive) && (
            <button
              type="button"
              style={{
                marginLeft: 10,
                padding: '1px 8px',
                border: '1px solid var(--yt-border-strong)',
                borderRadius: 4,
                background: 'var(--yt-surface-raised)',
                cursor: 'pointer',
                fontSize: 12,
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (refineActive) cancelRefine()
                if (capabilityRunning) cancelCapability()
                if (validateActive) cancelValidate()
              }}
            >
              取消
            </button>
          )}
        </div>
      )}
      {selectionMenu !== null && (
        <SelectionMenu
          text={selectionMenu.text}
          x={selectionMenu.x}
          y={selectionMenu.y}
          capabilities={selectionCaps}
          onSend={sendSelection}
          onRun={runSelectionCapability}
          onClose={() => { setSelectionMenu(null) }}
          t={t}
        />
      )}
      {fileMenu !== null && (
        <CapabilityMenu
          x={fileMenu.x}
          y={fileMenu.y}
          capabilities={selectionCaps}
          onRun={(capability) => {
            setFileMenu(null)
            runRowCapability(capability, fileMenu.path)
          }}
          onClose={() => { setFileMenu(null) }}
          t={t}
        />
      )}
      {/* A handle exists whenever its rail is expanded — including at the
          width limits, because the handle is the only way back from one. */}
      {intakeOpen && (
        <DragHandle side="intake" left={cols.intake} onDrag={onIntakeDrag} />
      )}
      {workspaceOpen && (
        <DragHandle side="workspace" left={viewport - cols.workspace} onDrag={onWorkspaceDrag} />
      )}
    </div>
  )
}
