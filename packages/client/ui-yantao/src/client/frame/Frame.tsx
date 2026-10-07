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
  ExternalOpener, FileReader, FileWriter, ImageBinaryLoader, LinksLoader,
  MailDeleter, MailFetcher, MailMarker, MemoryAdder, MemoryDeleter, MemoryLister,
  MemoryProposalApprover, MemoryProposalDiscarder, MemoryProposalLister, PromptShortcutLister,
  PromptShortcutSaver, RelationGraphLoader, RelationSetter, ResourceDeleter, ResourceRegistrar, RevisionLoader,
  ScheduleLister, ScheduleMarker,
  ScheduleSaver, ProposalInboxLister, ProposalInboxResolver, ShortcutFiller,
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
import type { Proposal, ProposalMailRange } from '../proposal.ts'
import { applyProposal, runUndo, type ProposalApplyResult } from '../proposal-apply.ts'
import { proposalOfPayload, proposalOfRunResult, runNoticeOf } from '../capability-match.ts'
import { capabilityGestureMessage } from '../capability-gesture.ts'
import { ProposalCard } from '../ProposalCard.tsx'
import { QuestionDialog } from '../QuestionDialog.tsx'
import { ConfigDialog } from '../ConfigDialog.tsx'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../model-config.ts'
import { CapabilityMenu, SelectionMenu } from '../SelectionMenu.tsx'
import { obsidianUri, remoteMessage, type ResourceViewReader } from '../remote.ts'
import { notifySchedule, scheduleScan, type ScheduleRunner } from '../scheduler.ts'
import { SchedulePane } from '../SchedulePane.tsx'
import { frontmatterArchived } from '../markdown.ts'
import type { KbCapabilitySummary, KbDeleteResourceResult, KbLinksResult, KbMailFetchArgs, KbMailFetchResult, KbQueuedProposal, KbRelationGraphResult, KbSchedule, KbSetEntityArchivedResult, KbTreeSection, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { FileEditor, type FileEditorApi, type SaveStatus } from '../editor/FileEditor.tsx'
import { MarkdownView } from '../editor/MarkdownView.tsx'
import { ReadOnlyFile } from '../editor/ReadOnlyFile.tsx'
import { Onboarding } from '../Onboarding.tsx'
import {
  CONVERSATION_TAB, SCHEDULES_TAB, activateTab, activeFile, closeTab, emptyTabs, openTab, persistTabs, readOnlyPath,
  restoreTabs,
  type TabMode, type TabState,
} from '../tabs.ts'
import { CenterPane, type ViewMode } from './CenterPane.tsx'
import { GraphPane } from './GraphPane.tsx'
import { InboxPane } from './InboxPane.tsx'
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
  /** Load one read-only file's render view (ADR-0046 决定 3). */
  readonly readView: ResourceViewReader
  /** Fetch one local image's bytes (ADR-0048 一期) — the reading view's image preloads. */
  readonly readImage: ImageBinaryLoader
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
  /**
   * Delete one resource file under `resources/` (ADR-0020) — the resource
   * row's right-click 「删除」. Entities stay undeletable (ADR-0041 决定 8);
   * resources are dumb material with nothing pointing back at them.
   */
  readonly deleteResource: ResourceDeleter
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
  /** List the schedule definitions (ADR-0045) — the 调度 tab and the scheduler both read through this. */
  readonly scheduleList: ScheduleLister
  /** Replace the whole schedule list (ADR-0045); the host preserves stored stamps. */
  readonly scheduleSave: ScheduleSaver
  /** Patch one row's scheduler-owned stamps (ADR-0045) — the scheduler's own write path. */
  readonly scheduleMark: ScheduleMarker
  /** Fire one schedule's prompt as a background session (ADR-0045 决定 2). */
  readonly runSchedule: ScheduleRunner
  /** Read the proposal inbox (ADR-0047) — the 提议 tab's read. */
  readonly proposalInboxList: ProposalInboxLister
  /** Record the human's decision on one pending inbox entry (ADR-0047). */
  readonly proposalInboxResolve: ProposalInboxResolver
  /** Read the whole KB's typed relation graph (ADR-0049) — the 图谱 tab's read. */
  readonly relationGraph: RelationGraphLoader
  /** Read the model gateway's config view — the 配置 dialog's open read. */
  readonly loadModelsConfig: () => Promise<ModelsConfigView>
  /** Commit a 配置 dialog draft; the result separates conflict from refusal. */
  readonly saveModelsConfig: (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>
  /** The KB root changed: re-point dsh's workspace at it (ADR-0013). */
  readonly onKbRootChanged: () => void
}

const FONT = 'var(--yt-font-ui)'

/**
 * How long the link graph waits after a keystroke. `linksOf` re-reads every
 * entity file to compute incoming links, so it must not run per keystroke.
 */
const LINK_GRAPH_DEBOUNCE_MS = 350

/** How often the KB's change counter is compared (ADR-0017). */
const REVISION_POLL_MS = 3000

/** How often the scheduler scans the definitions (ADR-0045 决定 2). */
const SCHEDULE_SCAN_MS = 30_000

/** How stale a due time may be and still fire live; older is a missed fire — marked, never
 *  caught up (ADR-0045 决定 3). Well above SCHEDULE_SCAN_MS because a tray-hidden window is
 *  timer-throttled (Chromium clamps hidden pages to ≈1 tick/minute after ~5 minutes hidden):
 *  the tolerance must cover the worst-case throttled cadence, or tray-resident fires would be
 *  misclassified as missed (OCR 2026-10-03). */
const SCHEDULE_TOLERANCE_MS = 300_000

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

const footerButtonStyle = { padding: '2px 10px', minHeight: 'var(--yt-control-min-h)', boxSizing: 'border-box', fontSize: 12 } as const

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
  // Split longhand, not the `border` shorthand: the severity variants below
  // swap borderColor alone, and mixing shorthand with a longhand makes React
  // warn on rerender when the variant drops off.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(28, 26, 22, 0.15)',
  fontSize: 12,
  zIndex: 45,
  cursor: 'pointer',
} as const

/** An error notice: the error pair speaks, the human must dismiss it. */
const noticeErrorStyle = {
  background: 'var(--yt-error-bg)',
  borderColor: 'var(--yt-error)',
  color: 'var(--yt-error)',
} as const

/** A progress notice: the accent edge says "moving" without stealing the eye. */
const noticeProgressStyle = { borderColor: 'var(--yt-accent-border)' } as const

/** An undo notice: the strongest accent edge short of an error — this strip
 * is the only carrier a just-made write's reversal will ever have. */
const noticeUndoStyle = { borderColor: 'var(--yt-accent-strong)' } as const

/** How much a notice matters: info fades, progress awaits its outcome, error
 * sticks, undo holds a bounded window (longer than info, shorter than forever). */
type NoticeSeverity = 'info' | 'progress' | 'error' | 'undo'

/** Standing severities outrank passing ones: a lower-ranked notice never
 * displaces a higher-ranked one already on foot. */
const NOTICE_RANK: Record<NoticeSeverity, number> = { info: 0, progress: 1, undo: 2, error: 3 }

/** The undo window's length — long enough to leave the notice and come back,
 * far shorter than "forever": the next write supersedes the chance anyway. */
const UNDO_WINDOW_MS = 90_000

/** Caller-declared notice shape: severity is stated, never guessed off the
 * text; the action rides along for the written report's 撤销 chip. */
interface CapabilityNoticeOptions {
  readonly severity?: NoticeSeverity
  readonly action?: {
    readonly label: string
    readonly run: () => void
  }
}

/** One foot notice: the message, the discipline its severity earns, and —
 * for a written report — the one chip that takes the writes back. */
interface CapabilityNotice {
  readonly text: string
  readonly severity: NoticeSeverity
  /** When an undo notice expires (epoch ms) — the countdown's truth. */
  readonly expiresAt?: number
  readonly action?: {
    readonly label: string
    readonly run: () => void
  }
}

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
  t, renderSlot, panels, intake, workspace, read, readView, readImage, write, archiveEntity, restoreEntity, setRelation,
  createEntity, root, setRoot,
  pickDirectory, links, revision, openExternal, todos, writeTodos, mailFetch, mailMarkRead, analyseMail, refine, validate,
  registerResource, deleteResource, capabilityList, capabilityDeclaration, capabilityCreate, capabilityAdopt,
  capabilityRegister, capabilityRun,
  capabilityDistill,
  promptSession, memoryList, memoryAdd, memoryDelete, memoryProposalList, memoryProposalApprove, memoryProposalDiscard,
  sessionDetail, onKbRootChanged, mailDelete, mailArchive,
  promptShortcutList, promptShortcutSave, fillShortcut,
  scheduleList, scheduleSave, scheduleMark, runSchedule,
  proposalInboxList, proposalInboxResolve, relationGraph,
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
  // ADR-0032 批次③: the card's 记忆 rows go through the same memoryAdd. The
  // three undo-only verbs ride along so the written report can offer 撤销.
  const applyConfirmed = useCallback(
    (options: { proposal: Proposal; ticked: readonly number[] }): Promise<ProposalApplyResult> =>
      applyProposal({
        ...options,
        target: { createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource },
      }),
    [createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource],
  )

  // The one confirm path every proposal card shares (capability runs'
  // ADR-0021 决定 4, refine's ADR-0029 决定 3): apply, reload the trees, and
  // report the writes — or the failure — in the foot notice.

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
  const [capabilityNotice, setCapabilityNoticeRaw] = useState<CapabilityNotice | null>(null)
  /**
   * The foot notice's one door. Severity is declared by the caller ({@link
   * CapabilityNoticeOptions}); the text-shape guess below is a fallback only,
   * kept for any call site a future edit forgets to annotate — semantics
   * never ride on string shape by design, only by omission. Two discipline
   * rules live here, not at the call sites: a standing higher-ranked notice
   * never yields to lesser news (并发时失败不被顶掉，撤销窗不被闲话顶掉)，
   * and clearing never hides an error (dismissal is the human's click, not
   * the next event).
   */
  const setCapabilityNotice = (update: string | null, options?: CapabilityNoticeOptions): void => {
    setCapabilityNoticeRaw((previous) => {
      if (update === null) return previous?.severity === 'error' ? previous : null
      const severity = options?.severity
        ?? (/失败|错误/.test(update) ? 'error' : /…$/.test(update) ? 'progress' : 'info') satisfies NoticeSeverity
      // Only error and undo are protected seats: lesser news never displaces
      // them. progress/info stay first-come-first-served — a completion must
      // be able to retire its own 提炼中… announcement.
      if (previous !== null && (previous.severity === 'error' || previous.severity === 'undo')
        && NOTICE_RANK[severity] < NOTICE_RANK[previous.severity]) return previous
      return {
        text: update,
        severity,
        ...(severity === 'undo' ? { expiresAt: Date.now() + UNDO_WINDOW_MS } : {}),
        ...(options?.action !== undefined ? { action: options.action } : {}),
      }
    })
  }
  // info 会自己走（8s）：进展由完成/失败接管，错误常驻等人处置，撤销窗
  // 有自己的 90s 计时，只有「已完成」类的安语不该赖着不走。每条新消息重置计时。
  useEffect(() => {
    if (capabilityNotice === null || capabilityNotice.severity !== 'info') return
    const timer = setTimeout(() => { setCapabilityNoticeRaw(null) }, 8000)
    return () => { clearTimeout(timer) }
  }, [capabilityNotice])

  // The undo window's clock: one tick a second feeds the countdown read-out,
  // one timeout closes the window. When it shuts, the chance goes with it —
  // the notice is the only carrier this undo ever has.
  const [undoRemaining, setUndoRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (capabilityNotice?.severity !== 'undo' || capabilityNotice.expiresAt === undefined) {
      setUndoRemaining(null)
      return
    }
    const expiry = capabilityNotice.expiresAt
    const tick = setInterval(() => { setUndoRemaining(Math.max(0, Math.ceil((expiry - Date.now()) / 1000))) }, 1000)
    setUndoRemaining(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)))
    const timer = setTimeout(() => { setCapabilityNoticeRaw(null) }, expiry - Date.now())
    return () => { clearInterval(tick); clearTimeout(timer) }
  }, [capabilityNotice])

  // The written report both confirm paths share (ADR-0021 决定 4): the
  // writes and misses in one line, plus a 撤销 chip when the applier left
  // anything reversible. The undo severity owns its 90-second window — no
  // longer shackled to info's 8-second fade; irreversible writes (the mail
  // knives, the append-only 流水) are named in the line, never promised back.
  const confirmWritten = (result: ProposalApplyResult): void => {
    const text = [...result.written, ...result.skipped].join('；') || '没有写入任何内容。'
    const undo = result.undo
    if (undo === undefined) {
      setCapabilityNotice(text, { severity: 'info' })
      return
    }
    const suffix = undo.irreversible.length > 0 ? `（其中 ${undo.irreversible.length} 项不可撤销）` : ''
    setCapabilityNotice(text + suffix, {
      severity: 'undo',
      action: {
        label: '撤销',
        run: () => {
          setCapabilityNotice(null)
          void runUndo(undo).then(({ failed }) => {
            setTreeKey(key => key + 1)
            setCapabilityNotice(failed.length === 0 ? '已撤销刚才的写入。' : `撤销失败：${failed.join('；')}`,
              { severity: failed.length === 0 ? 'info' : 'error' })
          })
        },
      },
    })
  }

  const confirmProposal = useCallback((proposal: Proposal, ticked: readonly number[]): void => {
    void applyConfirmed({ proposal, ticked }).then((result) => {
      setTreeKey(key => key + 1)
      confirmWritten(result)
    }, (failure: unknown) => {
      setCapabilityNotice(`写入失败：${remoteMessage(failure)}`, { severity: 'error' })
    })
  }, [applyConfirmed])
  // ADR-0044 决定 6: every settled script run leaves a record — the 能力
  // tab's 运行记录 renders them, and the 提炼经验 button turns one record
  // into a distill session. Frontend memory, this session only.
  const [capabilityRuns, setCapabilityRuns] = useState<readonly CapabilityRunRecord[]>([])
  const capabilityRunSeq = useRef(0)

  // ── the 调度 tab and its scheduler (ADR-0045) ────────────────────────────
  // Definitions persist in the KB store; instances are ordinary task rows.
  // The scheduler lives and dies with this renderer: alive while the window
  // hides in the tray, dead on refresh or quit — a fire found stale on a tick
  // is marked missed, never caught up (决定 2/3).
  const [schedules, setSchedules] = useState<readonly KbSchedule[]>([])
  const [schedulesLoaded, setSchedulesLoaded] = useState(false)
  // The tick reads the ref (the interval's closure never goes stale); every
  // write below keeps the ref ahead of React's render so one tick's several
  // patches never clobber each other.
  const schedulesRef = useRef<readonly KbSchedule[]>([])
  useEffect(() => { schedulesRef.current = schedules }, [schedules])
  // Schedule ids with a run in flight: the scan never double-fires them
  // (lastFiredAt already advanced, but a re-mounted effect must not either).
  const scheduleFiring = useRef<ReadonlySet<string>>(new Set())
  // The 任务 row's cancel line: taskId → aborter (the other runners' refs' pattern).
  const scheduleAborts = useRef(new Map<string, AbortController>())

  useEffect(() => {
    let stale = false
    scheduleList().then(
      (result) => {
        if (stale) return
        schedulesRef.current = result.schedules
        setSchedules(result.schedules)
        setSchedulesLoaded(true)
      },
      (failure: unknown) => { if (!stale) setCapabilityNotice(`调度读取失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
    return () => { stale = true }
  }, [scheduleList])

  // ── the 提议 tab and its inbox (ADR-0047) ────────────────────────────────
  // The scheduler's proposals wait here for the human's verdict: 批准
  // applies through the same human-channel seams as every other card and
  // only then settles the row approved; 丢弃 settles it without writing;
  // closing the card decides nothing. The read rides the scheduler's scan
  // (declared below), so a fired run's proposal surfaces without a remount.
  const [inboxEntries, setInboxEntries] = useState<readonly KbQueuedProposal[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  const [inboxBusyId, setInboxBusyId] = useState<string | null>(null)

  // ADR-0047 验收修正 2: settling a mail-covering entry moves the mail
  // watermark past the envelope's range — the same "seen and judged" sense
  // the manual panel's confirm/dismiss carries, so the next read never
  // re-offers the batch. A failed cursor move stays silent, exactly like the
  // manual path's: the host answers from its watermark on the next read.
  const moveMailCursor = useCallback((range: ProposalMailRange | undefined): void => {
    if (range === undefined) return
    void mailMarkRead({
      lastReadAt: range.lastReadAt,
      ...(range.firstReadAt !== undefined ? { firstReadAt: range.firstReadAt } : {}),
    }).catch(() => { /* the next read re-derives from the host's watermark */ })
  }, [mailMarkRead])

  const loadInboxTick = useRef(0)
  const loadInbox = useCallback((): void => {
    // Stale-response guard (the schedule-scan and relation-graph effects'
    // pattern): mount, the 30s scan and the post-run refresh overlap, and a
    // slower older answer must not land last over a fresher one.
    const at = ++loadInboxTick.current
    void proposalInboxList().then(
      (result) => {
        if (at !== loadInboxTick.current) return
        setInboxEntries(result.proposals)
        setInboxLoaded(true)
      },
      (failure: unknown) => {
        if (at !== loadInboxTick.current) return
        setCapabilityNotice(`提议读取失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxList])

  useEffect(() => { loadInbox() }, [loadInbox])

  // ── the 图谱 tab and its relation graph (ADR-0049) ───────────────────────
  // One read at mount: the graph is a browsing overview, not a live monitor —
  // the revision poll's refresh affordances don't extend here. A failed read
  // leaves the pane on its loading text and reports through the notice line.
  const [graphData, setGraphData] = useState<KbRelationGraphResult | null>(null)

  useEffect(() => {
    let stale = false
    relationGraph().then(
      (result) => { if (!stale) setGraphData(result) },
      (failure: unknown) => { if (!stale) setCapabilityNotice(`图谱读取失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
    return () => { stale = true }
  }, [relationGraph])

  const discardInboxEntry = useCallback((entry: KbQueuedProposal): void => {
    setInboxBusyId(entry.id)
    void proposalInboxResolve({ id: entry.id, status: 'discarded' }).then(
      (result) => {
        setInboxBusyId(null)
        setInboxEntries(result.proposals)
        // 丢弃也算看过 (the manual dismiss's own sense, ADR-0047 验收修正 2).
        moveMailCursor(proposalOfPayload(entry.proposal)?.mails)
        setCapabilityNotice(`已丢弃提议「${entry.title}」。`, { severity: 'info' })
      },
      (failure: unknown) => {
        setInboxBusyId(null)
        setCapabilityNotice(`提议处置失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxResolve, moveMailCursor])

  // 批准: the writes land first — the same applyConfirmed every card shares —
  // and only then is the row settled approved. A failed apply leaves the row
  // pending for another try; a failed settle after successful writes retires
  // the row as discarded (the writes landed — a second apply would replay
  // them verbatim), with the error notice telling the human what happened.
  const confirmInboxEntry = useCallback((entry: KbQueuedProposal, ticked: readonly number[]): void => {
    const proposal = proposalOfPayload(entry.proposal)
    if (proposal === null) return
    setInboxBusyId(entry.id)
    void applyConfirmed({ proposal, ticked }).then((result) => {
      // The writes landed — the covered mails count as processed now, in
      // both settle branches (ADR-0047 验收修正 2).
      moveMailCursor(proposal.mails)
      void proposalInboxResolve({ id: entry.id, status: 'approved' }).then(
        (resolved) => {
          setInboxBusyId(null)
          setInboxEntries(resolved.proposals)
          setTreeKey(key => key + 1)
          confirmWritten(result)
        },
        (failure: unknown) => {
          setInboxBusyId(null)
          // The writes landed; only the local marking failed. The row must
          // not invite a second apply — re-approving replays the writes
          // verbatim (duplicate 流水 bullets, re-fired knives) — so it
          // retires as discarded, matching what the disk now holds.
          setInboxEntries(prev => prev.map(e => e.id === entry.id
            ? { ...e, status: 'discarded', decidedAt: new Date().toISOString() } as KbQueuedProposal
            : e))
          setCapabilityNotice(`提议已写入，但标记失败（已就地丢弃，不会再次询问）：${remoteMessage(failure)}`, { severity: 'error' })
        },
      )
    }, (failure: unknown) => {
      setInboxBusyId(null)
      setCapabilityNotice(`写入失败：${remoteMessage(failure)}`, { severity: 'error' })
    })
  }, [applyConfirmed, proposalInboxResolve, moveMailCursor])

  // One serialized write channel for every schedule write (OCR 2026-10-03):
  // the pane's full-list saves and the scheduler's stamp patches tail-chain
  // here, so a bookkeeping write can never resurrect a stale snapshot over a
  // user edit (or vice versa). A failed write re-reads the store, so the
  // optimistic local state never diverges from what the disk holds.
  const scheduleWriteQueue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueueScheduleWrite = useCallback((write: () => Promise<readonly KbSchedule[]>, label: string): Promise<boolean> => {
    const run = scheduleWriteQueue.current.then(async (): Promise<boolean> => {
      try {
        const stored = await write()
        schedulesRef.current = stored
        setSchedules(stored)
        return true
      } catch (failure: unknown) {
        try {
          const fresh = await scheduleList()
          schedulesRef.current = fresh.schedules
          setSchedules(fresh.schedules)
        } catch { /* the notice below is the report */ }
        setCapabilityNotice(`${label}：${remoteMessage(failure)}`, { severity: 'error' })
        return false
      }
    })
    scheduleWriteQueue.current = run
    return run
  }, [scheduleList])

  /** The 调度 tab's save seam: host validation has the last word; the host preserves stored stamps across the pane's stale snapshots. */
  const commitSchedules = useCallback((next: readonly KbSchedule[]): Promise<boolean> =>
    enqueueScheduleWrite(async () => (await scheduleSave({ schedules: next })).schedules, '调度保存失败'),
  [enqueueScheduleWrite, scheduleSave])

  /** The scheduler's bookkeeping seam: a single-row stamp patch, never a full-list save. */
  const markScheduleStamps = useCallback((id: string, patch: { lastFiredAt?: string | null; lastMissedAt?: string | null }): void => {
    void enqueueScheduleWrite(async () => (await scheduleMark({ id, ...patch })).schedules, '调度状态保存失败')
  }, [enqueueScheduleWrite, scheduleMark])

  useEffect(() => {
    if (!schedulesLoaded) return
    /** Optimistically apply one tick's stamp patches locally; the serialized channel persists them. */
    const applyLocal = (next: readonly KbSchedule[]): void => {
      schedulesRef.current = next
      setSchedules(next)
    }
    const startRun = (schedule: KbSchedule): void => {
      scheduleFiring.current = new Set([...scheduleFiring.current, schedule.id])
      const taskId = taskBegin('schedule', `调度「${schedule.name}」`, '执行中')
      const controller = new AbortController()
      scheduleAborts.current.set(taskId, controller)
      runSchedule({
        id: schedule.id,
        name: schedule.name,
        prompt: schedule.prompt,
        signal: controller.signal,
        onSession: (sessionId) => { taskPatch(taskId, { sessionId }) },
      }).then((result) => {
        taskEnd(taskId, 'done', '已完成')
        // ADR-0047: a run that filed a proposal points at the decision
        // surface instead of paraphrasing itself — the card is the answer.
        notifySchedule({
          title: `调度「${schedule.name}」完成`,
          body: result.proposalId !== undefined
            ? '产生了待决策的提议，去「提议」页处理'
            : result.answer.replace(/\s+/g, ' ').trim().slice(0, 80) || '已完成',
        })
        // The proposal is on the disk store the moment the run ends: pull it
        // into the pane now rather than waiting for the next scan.
        if (result.proposalId !== undefined) loadInbox()
      }, (failure: unknown) => {
        if (controller.signal.aborted) {
          taskEnd(taskId, 'cancelled', '已取消')
        } else {
          const message = remoteMessage(failure)
          taskEnd(taskId, 'failed', `失败：${message}`)
          notifySchedule({ title: `调度「${schedule.name}」失败`, body: message })
        }
      }).finally(() => {
        const next = new Set(scheduleFiring.current)
        next.delete(schedule.id)
        scheduleFiring.current = next
        scheduleAborts.current.delete(taskId)
      })
    }
    const tick = (): void => {
      const now = new Date()
      const missedIds: string[] = []
      const firingNow: KbSchedule[] = []
      let working = schedulesRef.current
      for (const schedule of schedulesRef.current) {
        if (scheduleFiring.current.has(schedule.id)) continue
        const action = scheduleScan(schedule, now, SCHEDULE_TOLERANCE_MS)
        if (action.kind === 'missed') {
          missedIds.push(schedule.id)
          // One collapsed mark for the whole downtime backlog (ADR-0045 决定 3):
          // stamping `now` jumps the baseline past every skipped occurrence,
          // so the next scan resumes forward instead of replaying one miss
          // per tick.
          working = working.map(row => row.id === schedule.id ? { ...row, lastMissedAt: now.toISOString() } : row)
        } else if (action.kind === 'fire') {
          firingNow.push(schedule)
          // Advance the baseline immediately: the next scan measures from
          // this fire, and a long run can never be re-fired by the next tick.
          const firedAt = action.at.toISOString()
          working = working.map((row) => {
            if (row.id !== schedule.id) return row
            const { lastMissedAt: _dropped, ...rest } = row
            return { ...rest, lastFiredAt: firedAt }
          })
        }
      }
      if (working !== schedulesRef.current) applyLocal(working)
      const stamp = now.toISOString()
      for (const id of missedIds) markScheduleStamps(id, { lastMissedAt: stamp })
      for (const schedule of firingNow) {
        markScheduleStamps(schedule.id, { lastFiredAt: stamp, lastMissedAt: null })
        startRun(schedule)
      }
      if (missedIds.length > 0) {
        const names = schedulesRef.current.filter(row => missedIds.includes(row.id)).map(row => row.name)
        setCapabilityNotice(`调度错过 ${missedIds.length} 次触发（应用未在运行，不补跑）：${names.join('、')}`, { severity: 'info' })
      }
      // ADR-0047: the inbox read rides the scan — a proposal enqueued by any
      // producer (today the scheduler, tomorrow others) surfaces within one
      // tick without a remount.
      loadInbox()
    }
    tick()
    const timer = setInterval(tick, SCHEDULE_SCAN_MS)
    return () => { clearInterval(timer) }
  }, [schedulesLoaded, markScheduleStamps, runSchedule, taskBegin, taskPatch, taskEnd, loadInbox])
  const [distillingRunId, setDistillingRunId] = useState<string | null>(null)
  // Cancellation (ADR-0031): the running script capability's abort controller.
  // The signal is both the RPC's cancel line and the witness that separates
  // 「人停的」 from a real failure in the rejection path.
  const capabilityAbort = useRef<AbortController | null>(null)
  // The distill gesture's own cancel line (ADR-0031): keyed by task id so a
  // capability run and a distill never sever each other's line.
  const distillAbort = useRef<AbortController | null>(null)
  const distillTaskId = useRef<string | null>(null)
  const [capabilityRunning, setCapabilityRunning] = useState(false)
  const runRowCapability = useCallback((capability: KbCapabilitySummary, path: string): void => {
    setCapabilityNotice(null)
    if (capability.entry === undefined) {
      void promptSession(capabilityGestureMessage(capability.name, { path })).then(
        () => {},
        (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
      )
      return
    }
    const aborter = new AbortController()
    capabilityAbort.current = aborter
    setCapabilityRunning(true)
    setCapabilityNotice(`能力「${capability.name}」执行中…`, { severity: 'progress' })
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
        setCapabilityNotice(runNoticeOf(result), { severity: 'info' })
        taskEnd(taskId, 'done', runNoticeOf(result))
      }
    }, (failure: unknown) => {
      capabilityAbort.current = null
      setCapabilityRunning(false)
      // A refused run is a record too: a failure is exactly where the
      // lessons live. The refusal prose rides along as the record's note —
      // without it the distiller would misread the missing envelope as an
      // instruction-type run and lose the failure's reason.
      capabilityRunSeq.current += 1
      setCapabilityRuns(rows => [{
        id: `cap-run-${capabilityRunSeq.current}`,
        name: capability.name,
        ok: false,
        note: remoteMessage(failure),
        at: Date.now(),
      }, ...rows])
      if (aborter.signal.aborted) {
        setCapabilityNotice(`能力「${capability.name}」已取消。`, { severity: 'info' })
        taskEnd(taskId, 'cancelled', '已取消')
      } else {
        setCapabilityNotice(`能力「${capability.name}」失败：${remoteMessage(failure)}`, { severity: 'error' })
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
    setCapabilityNotice(`提炼「${record.name}」经验中…`, { severity: 'progress' })
    const taskId = taskBegin('capability', `提炼「${record.name}」经验`, '提炼中')
    // The distill is a task row too, and its 取消 must bite (ADR-0031): a
    // dedicated aborter rides the RPC — cancelling tears down the local wait
    // and `session/cancel` ends the headless turn (no orphaned token burn).
    // The ref is its own, not `capabilityAbort`'s: a run and a distill may
    // legitimately overlap, and clobbering would sever one of the two lines.
    distillTaskId.current = taskId
    const aborter = new AbortController()
    distillAbort.current = aborter
    void capabilityDistill(record, aborter.signal).then((outcome) => {
      setDistillingRunId(null)
      setCapabilityNotice(`提炼完成：提案队列共 ${outcome.pending} 条待批准。`, { severity: 'info' })
      taskEnd(taskId, 'done', `提案队列共 ${outcome.pending} 条待批准`)
    }, (failure: unknown) => {
      setDistillingRunId(null)
      if (aborter.signal.aborted) {
        setCapabilityNotice(`提炼「${record.name}」已取消。`, { severity: 'info' })
        taskEnd(taskId, 'cancelled', '已取消')
      } else {
        setCapabilityNotice(`提炼失败：${remoteMessage(failure)}`, { severity: 'error' })
        taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
      }
    }).finally(() => {
      distillTaskId.current = null
      distillAbort.current = null
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
      setCapabilityNotice(`「${what}」是空文件（只有标题），已跳过。`, { severity: 'info' })
      taskEnd(taskId, 'done', '空文件，已跳过')
      settleRefine()
      return
    }
    if (!run.relevant) {
      const what = gesture.resource?.name ?? gesture.entityName
      setCapabilityNotice(`「${what}」与「${gesture.entityName ?? '知识库'}」无关：${run.reason}`, { severity: 'info' })
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
    setCapabilityNotice(`提炼「${label}」中…`, { severity: 'progress' })
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
        : `提炼失败：${remoteMessage(failure)}`,
      { severity: refineCancelled.current ? 'info' : 'error' })
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
  // 提案换届播报（2026-10-05 补课）：卡片换了届，读屏原本一片寂静。一张
  // 视觉隐藏的 live region 播报当前在场的提案标题——文字变了才播，撤场
  // 归空，不打扰别的消息。
  const liveProposal = capabilityProposal ?? refineProposal ?? validateProposal

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
    }), { severity: 'info' })
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
        setCapabilityNotice('实体校验修订已取消。', { severity: 'info' })
        taskEnd(live.taskId, 'cancelled', '已取消')
        return
      }
      setCapabilityNotice(`实体校验修订失败：${remoteMessage(failure)}`, { severity: 'error' })
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
        : `实体校验失败：${remoteMessage(failure)}`,
      { severity: validateCancelled.current ? 'info' : 'error' })
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
    if (row.kind === 'validate' || row.kind === 'schedule') {
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
    else if (row.kind === 'schedule') scheduleAborts.current.get(row.id)?.abort()
    else if (row.kind === 'mail' && row.id === mailFetchTaskId.current) mailFetchAbort.current?.abort()
    else if (row.kind === 'mail') mailRun.cancel()
    // Here `row.kind` has narrowed to 'capability' (the other four arms
    // eliminated the rest of the union), so compare only the task id: a
    // distill row cancels its own aborter, any script run falls through.
    else if (row.id === distillTaskId.current) distillAbort.current?.abort()
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
  // One accounting wrapper for every archive gesture (ADR-0041 决定 7): the
  // detail button and both rails' row menus share it, so the override and
  // the tree reload happen exactly once no matter who flipped the flag —
  // the detail button's label can never go stale after a row-menu flip.
  // Failures propagate untouched: the rail's own onError reports them, the
  // detail button catches for its notice line.
  // archiveBusy only gates the detail button; the rails' row menus call
  // flipArchive directly, so concurrency is merged per path+direction here
  // instead: a second gesture of the same direction on the same entity while
  // one flip is in flight (fast double-click, both rails showing it) joins
  // the first flight rather than racing it with a conflicting write. An
  // opposite-direction gesture is a genuine reversal, not a duplicate — it
  // goes through as its own call (the server settles the last write). Flips
  // of different entities stay independent.
  const archiveFlights = useRef(new Map<string, Promise<KbSetEntityArchivedResult>>())
  const flipArchive = useCallback((path: string, archived: boolean): Promise<KbSetEntityArchivedResult> => {
    const flightKey = `${archived ? 'archive:' : 'restore:'}${path}`
    const inFlight = archiveFlights.current.get(flightKey)
    if (inFlight !== undefined) return inFlight
    const flight = (archived ? archiveEntity(path) : restoreEntity(path)).then((result) => {
      setArchivedOverrides(current => ({ ...current, [path]: result.archived }))
      setTreeKey(key => key + 1)
      return result
    }).finally(() => {
      archiveFlights.current.delete(flightKey)
    })
    archiveFlights.current.set(flightKey, flight)
    return flight
  }, [archiveEntity, restoreEntity])
  const railArchive = useCallback((path: string): Promise<KbSetEntityArchivedResult> => flipArchive(path, true), [flipArchive])
  const railRestore = useCallback((path: string): Promise<KbSetEntityArchivedResult> => flipArchive(path, false), [flipArchive])
  const toggleArchive = useCallback((path: string, archived: boolean): void => {
    setArchiveBusy(true)
    flipArchive(path, archived).catch((failure: unknown) => {
      setCapabilityNotice(remoteMessage(failure), { severity: 'error' })
    }).finally(() => {
      setArchiveBusy(false)
    })
  }, [flipArchive])

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
      () => { setCapabilityNotice('已发送到当前会话。', { severity: 'info' }) },
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
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
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
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

  // The resource row's right-click 「删除」 (ADR-0020): remove the file, then
  // drop its tab (if open) and reload both trees. Failures propagate to the
  // rail's own onError, same as the archive gestures.
  const removeResource = useCallback((path: string): Promise<KbDeleteResourceResult> => {
    return deleteResource(path).then((result) => {
      closeFile(path)
      setTreeKey(key => key + 1)
      return result
    })
  }, [deleteResource, closeFile])

  /** A new KB root: both rails reload, and the stale tabs' statuses go away. */
  const onConfigured = useCallback((): void => {
    setNeedsRoot(false)
    setTreeKey(key => key + 1)
    setStatuses({})
    // The archive-flag overrides belong to the old root's files: a fresh
    // root re-derives every flag from a freshly read envelope.
    setArchivedOverrides({})
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
          archiveEntity={railArchive}
          restoreEntity={railRestore}
          setRelation={setRelation}
          workspace={workspace}
          mailFetch={bookedMailFetch}
          mailMarkRead={mailMarkRead}
          {...(mailDelete !== undefined ? { mailDelete } : {})}
          {...(mailArchive !== undefined ? { mailArchive } : {})}
          analyseMail={analyseMail}
          registerResource={registerResource}
          deleteResource={removeResource}
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
        // Gate the pane behind the initial read (OCR 2026-10-03): before the
        // store's rows arrive — or forever after a failed read — the pane
        // must offer no mutating affordance, or an early full-list save would
        // wipe every definition it never fetched.
        schedulePane={!schedulesLoaded ? (
          <div style={{ padding: 16, color: 'var(--yt-text-muted)' }}>调度加载中…</div>
        ) : (
          <SchedulePane
            schedules={schedules}
            onSave={commitSchedules}
            promptShortcutList={promptShortcutList}
          />
        )}
        inboxPane={!inboxLoaded ? (
          <div style={{ padding: 16, color: 'var(--yt-text-muted)' }}>提议加载中…</div>
        ) : (
          <InboxPane
            entries={inboxEntries}
            busyId={inboxBusyId}
            onConfirm={confirmInboxEntry}
            onDiscard={discardInboxEntry}
            t={t}
          />
        )}
        graphPane={graphData === null ? (
          <div style={{ padding: 16, color: 'var(--yt-text-muted)' }}>图谱加载中…</div>
        ) : (
          <GraphPane data={graphData} onOpen={(path) => { openFile(path, 'edit') }} t={t} />
        )}
        inboxPending={inboxEntries.filter(entry => entry.status === 'pending').length}
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
                readView={readView}
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
                  path={tab.path}
                  resolveImage={readImage}
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
          archiveEntity={railArchive}
          restoreEntity={railRestore}
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
        {/* ADR-0045 决定 8: the 调度 entry rides beside 配置 at the window's
            bottom-left; it opens the centre 调度 tab, not a dialog. */}
        <button
          style={footerButtonStyle}
          data-schedule-button="true"
          onClick={() => { setTabs(state => activateTab(state, SCHEDULES_TAB)) }}
        >
          {t('schedule.open')}
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
              setCapabilityNotice(`提炼失败：${remoteMessage(failure)}`, { severity: 'error' })
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
              setCapabilityNotice(`实体校验失败：${remoteMessage(failure)}`, { severity: 'error' })
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
      {/* 视觉隐藏的提案播报（aria-live）：只给读屏。 */}
      <div
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          overflow: 'hidden',
          clipPath: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
        role="status"
        aria-live="polite"
        data-proposal-announcement="true"
      >
        {liveProposal !== null ? t('proposal.arrived', { title: liveProposal.title }) : ''}
      </div>
      {capabilityNotice !== null && (
        <div
          style={{
            ...noticeStyle,
            ...(capabilityNotice.severity === 'error'
              ? noticeErrorStyle
              : capabilityNotice.severity === 'undo' ? noticeUndoStyle
                : capabilityNotice.severity === 'progress' ? noticeProgressStyle : {}),
          }}
          data-capability-notice="true"
          data-capability-notice-severity={capabilityNotice.severity}
          role={capabilityNotice.severity === 'error' ? 'alert' : 'status'}
          aria-live={capabilityNotice.severity === 'error' ? 'assertive' : 'polite'}
          title={t('frame.closeNotice')}
          onClick={() => { setCapabilityNoticeRaw(null) }}
        >
          {capabilityNotice.text}
          {/* The written report's undo chip: takes back what the applier
              just wrote, inside the undo severity's own 90-second window —
              the countdown beside the label makes the expiry legible instead
              of silent. */}
          {capabilityNotice.action !== undefined && (
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
                capabilityNotice.action?.run()
              }}
            >
              {capabilityNotice.action.label}
              {capabilityNotice.severity === 'undo' && undoRemaining !== null && (
                <span style={{ marginLeft: 4, color: 'var(--yt-text-tertiary)' }}>· {undoRemaining}s</span>
              )}
            </button>
          )}
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
