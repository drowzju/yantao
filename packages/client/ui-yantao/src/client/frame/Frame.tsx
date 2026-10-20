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
import { tabItemActiveStyle, tabItemStyle, toolButtonStyle } from '../buttons.ts'
import type {
  CapabilityAdopter, CapabilityCreator, CapabilityLoader, CapabilityRegistrar, CapabilityRouteUpdater,
  CapabilityUnregisterer,
  DirectoryPicker, EntityArchiver, EntityCreator, EntityResolver,
  ExternalOpener, FileReader, FileWriter, ImageBinaryLoader, LinksLoader,
  MailDeleter, MailFetcher, MailMarker, MemoryAdder, MemoryDeleter, MemoryLister,
  MemoryProposalApprover, MemoryProposalDiscarder, MemoryProposalLister, PromptShortcutLister,
  PromptShortcutSaver, RelationGraphLoader, RelationSetter, ResourceDeleter, ResourceRegistrar, RevisionLoader,
  ScheduleLister, ScheduleMarker,
  ScheduleSaver, ProposalInboxEnqueuer, ProposalInboxLister, ProposalInboxResolver,
  ProposalInboxApplier, ProposalInboxUndoer, ShortcutFiller,
  WorkspaceLister, WorkspaceRunner, WorkspaceRunDeleter, WorkspaceRunsClearer, WorkspaceRunsLister, WorkspaceRunStopper, WorkspaceSaver,
  WorkspaceInstructionScheduleSetter,
  RootLoader, RootSetter,
  Archiver, SkillRewriteApplier,
  SessionPrompter, TodoLoader, TodoWriter,
} from '../remote.ts'
import type { AnalysisStage, MailAnalyser } from '../mail-analysis.ts'
import { createMailRun, useMailRun } from '../mail-run.ts'
import type { RefineGesture, RefineRosterEntry, RefineRunner, RefineRun } from '../refine.ts'
import type { ValidateRun, ValidateRunner, ValidateScope, ValidateStage } from '../validate.ts'
import { formatElapsed, runningCount, type TaskKind, type TaskRow, type TaskStatus } from '../task-view.ts'
import type { SessionDetailLoader } from '../session-detail.ts'
import { SessionDetailDrawer } from '../SessionDetailDrawer.tsx'
import type { Proposal, ProposalMailRange } from '../proposal.ts'
import { applyProposal, runUndo, type ProposalApplyResult, type ProposalUndo } from '../proposal-apply.ts'
import { proposalOfPayload } from '../capability-match.ts'
import { capabilityGestureMessage } from '../capability-gesture.ts'
import { ProposalCard } from '../ProposalCard.tsx'
import { QuestionDialog } from '../QuestionDialog.tsx'
import { ConfigDialog } from '../ConfigDialog.tsx'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../model-config.ts'
import { DingTalkDialog } from '../DingTalkDialog.tsx'
import type { DingTalkConfigDraft, DingTalkConfigView, DingTalkSaveResult } from '../dingtalk-config.ts'
import type { KbDingtalkBindingRow } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { CapabilityMenu, SelectionMenu } from '../SelectionMenu.tsx'
import { obsidianUri, remoteMessage, type ResourceViewReader } from '../remote.ts'
import { notifySchedule, scheduleScan, formatRunStats, type ScheduleRunner } from '../scheduler.ts'
import { SchedulePane } from '../SchedulePane.tsx'
import type { KbCapabilitySummary, KbDeleteResourceResult, KbLinksResult, KbMailFetchArgs, KbMailFetchResult, KbQueuedProposal, KbRelationGraphResult, KbSchedule, KbScheduleRunReportArgs, KbSetEntityArchivedResult, KbTreeSection, KbTreeSectionId, KbWorkspace, KbWorkspaceInstructionScheduleSetArgs } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { FileEditor, type FileEditorApi, type SaveStatus } from '../editor/FileEditor.tsx'
import { MarkdownView } from '../editor/MarkdownView.tsx'
import { ReadOnlyFile } from '../editor/ReadOnlyFile.tsx'
import { Onboarding } from '../Onboarding.tsx'
import {
  CONVERSATION_TAB, INBOX_TAB, INSIGHTS_TAB, SCHEDULE_TAB, TASKS_TAB,
  activateTab, activeFile, closeTab, emptyTabs, openTab,
  persistFixedTabs, persistTabs,
  readOnlyPath,
  restoreFixedTabs,
  restoreTabs,
  type ClosableFixedTab, type FixedTabsOpen, type TabMode, type TabState,
} from '../tabs.ts'
import { CenterPane, type ViewMode } from './CenterPane.tsx'
import { GraphPane } from './GraphPane.tsx'
import { InboxPane } from './InboxPane.tsx'
import { MemoryProposalZone } from '../MemoryProposalZone.tsx'
import { TasksPane } from './TasksPane.tsx'
import './frame.module.css'
import type { PanelToggles } from './layout.ts'
import type { SidebarRightFileSeat } from '../sidebar-right.ts'
import { NARROW, RAIL_DEFAULT, clampRail, solveColumns } from './columns.ts'
import { comfortWidth, persistRailWidths, readRailWidths, type RailWidthPrefs } from './rail-widths.ts'
import type { WorkbenchT } from '../locales.ts'
import { ShortcutsDialog, type ShortcutCatalogFace, type ShortcutFixedCatalogFace } from '../ShortcutsDialog.tsx'

/** Full props: the render share for the four seats this frame declares, plus the panel-action seat. */
export type FrameProps = PropsRenderSlots<'main' | 'shell.overlay' | 'center.insights' | 'center.insights.pressure'> & {
  /** The workbench dictionary's bound translator. */
  readonly t: WorkbenchT
  /** Mutable seat the frame fills with its own toggles on mount. */
  readonly panels: PanelToggles
  /** Mutable seat the frame fills with its file-opener on mount (the sidebarRight stand-in). */
  readonly sidebarFiles: SidebarRightFileSeat
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
  /** Resolve one entity locator (`type:name` or path) to its KB-relative path — the proposal applier's normalization. */
  readonly resolveEntity: EntityResolver
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
   * Arm the mail save (ADR-0037 决定 2, 2026-10-09 三提名合一); optional for
   * the same reason as `mailDelete` — embedders without the face still render
   * the card, whose archive-mails rows then skip honestly.
   */
  readonly mailArchive?: Archiver
  /**
   * Write one approved skill rewrite back (ADR-0054); optional for the same
   * reason as the mail verbs — embedders without the face render the card,
   * whose skill-rewrite rows then skip honestly.
   */
  readonly skillRewriteApply?: SkillRewriteApplier
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
  /** Scaffold one new capability (「新建能力」). */
  readonly capabilityCreate: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly capabilityAdopt: CapabilityAdopter
  /** Register one in-KB skill by writing its central-route entry (ADR-0025 决定 1, ADR-0052 决定 1). */
  readonly capabilityRegister: CapabilityRegistrar
  /** Rewrite one capability's route entry — the detail view's reach toggles (ADR-0053 决定 2). */
  readonly capabilityRouteUpdate: CapabilityRouteUpdater
  /** Remove one capability's route entry — the detail view's 注销 (ADR-0053 决定 2). */
  readonly capabilityUnregister: CapabilityUnregisterer
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
  /** Report one fired schedule's settled run to the host's 运行历史 (ADR-0045 可观测性补齐). */
  readonly scheduleRunReport: (args: KbScheduleRunReportArgs) => Promise<unknown>
  /** List the workspaces (ADR-0056) — the 工作空间 tab's read. */
  readonly workspaceList: WorkspaceLister
  /** Replace the whole workspace list (ADR-0056). */
  readonly workspaceSave: WorkspaceSaver
  /** Set one instruction's trigger rule in place (ADR-0064) — the 调度 tab's narrow write. */
  readonly workspaceInstructionScheduleSet: WorkspaceInstructionScheduleSetter
  /** Trigger one workspace instruction now (ADR-0056 决定 3). */
  readonly workspaceRun: WorkspaceRunner
  /** Kill one running chain (ADR-0056 决定 4). */
  readonly workspaceRunStop: WorkspaceRunStopper
  /** Read the run-history ring (ADR-0056 决定 6). */
  readonly workspaceRunsList: WorkspaceRunsLister
  /** Clear the run history's finalized rows. */
  readonly workspaceRunsClear: WorkspaceRunsClearer
  /** Delete one history row (2026-10-15 截图评审); a still-running row refuses. */
  readonly workspaceRunDelete: WorkspaceRunDeleter
  /** Read the proposal inbox (ADR-0047) — the 提议 tab's read. */
  readonly proposalInboxList: ProposalInboxLister
  /** Record the human's decision on one pending inbox entry (ADR-0047). */
  readonly proposalInboxResolve: ProposalInboxResolver
  /** Execute one pending inbox entry server-side (ADR-0060 决定 7) — the approve gesture's write path. */
  readonly proposalInboxApply: ProposalInboxApplier
  /** Retract one inbox apply's reversible writes (ADR-0060 决定 7) — the written report's 撤销 chip. */
  readonly proposalInboxUndo: ProposalInboxUndoer
  /** Re-queue one decided entry's content as a fresh pending proposal — the 提议 tab's discard recovery (2026-10-14). */
  readonly proposalInboxEnqueue: ProposalInboxEnqueuer
  /** Read the whole KB's typed relation graph (ADR-0049) — the 图谱 tab's read. */
  readonly relationGraph: RelationGraphLoader
  /** Read the model gateway's config view — the 配置 dialog's open read. */
  readonly loadModelsConfig: () => Promise<ModelsConfigView>
  /** The shortcuts registry's live catalog — the 快捷键 directory's read face. */
  readonly shortcutCatalog: ShortcutCatalogFace
  /** The registry's fixed-command catalog — the verdict keys (J/K/空格/回车) live here (2026-10-14 目录修复). */
  readonly shortcutFixedCatalog: ShortcutFixedCatalogFace
  /** Commit a 配置 dialog draft; the result separates conflict from refusal. */
  readonly saveModelsConfig: (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>
  /** Read the DingTalk connector's config view — the 钉钉 dialog's open read (ADR-0060 决定 2). */
  readonly loadDingTalkConfig: () => Promise<DingTalkConfigView>
  /** Commit a 钉钉 dialog draft; the result separates conflict from refusal. */
  readonly saveDingTalkConfig: (draft: DingTalkConfigDraft) => Promise<DingTalkSaveResult>
  /** Read every conversation→session binding — the 钉钉 dialog's 绑定会话 list (ADR-0061 决定 2). */
  readonly loadDingTalkBindings: () => Promise<readonly KbDingtalkBindingRow[]>
  /** Rewire one conversation's binding — merge into / sever from a session (ADR-0062 决定 3). */
  readonly setDingTalkBinding: (conversationId: string, sessionId: string | null) => Promise<void>
  /** The session the main column is showing — the merge gesture's target (ADR-0062 决定 4). */
  readonly currentDingtalkMergeTarget: () => string | undefined
  /** Jump to one bound session — the 绑定会话 row's 打开 (swings to the conversation tab). */
  readonly openDingtalkSession: (sessionId: string) => void
  /** The KB root changed: re-point dsh's workspace at it (ADR-0013). */
  readonly onKbRootChanged: () => void
}

const FONT = 'var(--yt-font-ui)'

/**
 * How long the link graph waits after a keystroke. `linksOf` re-reads every
 * entity file to compute incoming links, so it must not run per keystroke.
 */
const LINK_GRAPH_DEBOUNCE_MS = 350

/** How often the KB's change counter is compared (ADR-0017; 2026-10-11 收紧到 1.5s). */
const REVISION_POLL_MS = 1500

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
  fontSize: 'var(--yt-type-body)',
} as const

const colStyle = { minWidth: 0, overflow: 'hidden' } as const

const railColStyle = { ...colStyle, background: 'var(--yt-surface-primary)' } as const

const overlayStyle = { position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' } as const

/** The grid's reserved second row: a slim utility strip, button left-aligned. */
const footerStripStyle = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--yt-space-1) var(--yt-space-3)',
  borderTop: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

/** 页脚「配置」「快捷键」是常驻低频入口：穿共享 tool 面（无边框、label
    字号、弱墨），只保留比行内工具宽一档的内边距（2026-10-14 复评 B：
    此前是裸 UA 按钮，页脚与暖纸界面像两个软件）。 */
const footerButtonStyle = { ...toolButtonStyle, padding: 'var(--yt-space-1) var(--yt-space-3)' } as const

/** The footer switches' counter pill (2026-10-15): same cut as the 任务 hub's
    sub-tab badges — accent ground, on-accent ink — so one number reads the
    same everywhere. */
const footerBadgeStyle = {
  borderRadius: 8,
  background: 'var(--yt-accent)',
  color: 'var(--yt-on-accent)',
  fontSize: 'var(--yt-type-label)',
  lineHeight: '16px',
  padding: '0 var(--yt-space-2)',
  marginLeft: 'var(--yt-space-1)',
} as const

/** The stack holding one file's two views; both stay mounted, one is shown. */
const bothPanesStyle = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } as const

/** The 阅读 / 源码 switch rides the file pane's own header (2026-10-08): the
    old strip-end home vanished once enough file tabs crowded the single-line
    tab strip — riding the active tab keeps it always reachable. */
const fileModeBarStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 'var(--yt-space-1)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderBottom: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

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
  padding: 'var(--yt-space-2) var(--yt-space-3)',
  background: 'var(--yt-surface-raised)',
  // Split longhand, not the `border` shorthand: the severity variants below
  // swap borderColor alone, and mixing shorthand with a longhand makes React
  // warn on rerender when the variant drops off.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--yt-shadow-menu)',
  fontSize: 'var(--yt-type-label)',
  zIndex: 45,
} as const

/** The notice bar's inline chips（撤销 / 取消 / ✕）：一份私有脸收敛为一处
    定义（P1-2 收敛，2026-10-12）——此前三枚芯片各抄一遍同样的内联样式。 */
const noticeChipStyle = {
  marginLeft: 'var(--yt-space-3)',
  padding: '0 var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  border: '1px solid var(--yt-border-strong)',
  borderRadius: 4,
  background: 'var(--yt-surface-raised)',
  cursor: 'pointer',
  fontSize: 'var(--yt-type-label)',
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
  t, renderSlot, panels, sidebarFiles, intake, workspace, read, readView, readImage, write, archiveEntity, restoreEntity,
  resolveEntity, setRelation,
  createEntity, root, setRoot,
  pickDirectory, links, revision, openExternal, todos, writeTodos, mailFetch, mailMarkRead, analyseMail, refine, validate,
  registerResource, deleteResource, capabilityList, capabilityCreate, capabilityAdopt,
  capabilityRegister, capabilityRouteUpdate, capabilityUnregister,
  promptSession, memoryList, memoryAdd, memoryDelete, memoryProposalList, memoryProposalApprove, memoryProposalDiscard,
  sessionDetail, onKbRootChanged, mailDelete, mailArchive, skillRewriteApply,
  promptShortcutList, promptShortcutSave, fillShortcut,
  scheduleList, scheduleSave, scheduleMark, runSchedule, scheduleRunReport,
  workspaceList, workspaceSave, workspaceInstructionScheduleSet, workspaceRun, workspaceRunStop,
  workspaceRunsList, workspaceRunsClear, workspaceRunDelete,
  proposalInboxList, proposalInboxResolve, proposalInboxEnqueue, proposalInboxApply, proposalInboxUndo, relationGraph,
  loadModelsConfig, saveModelsConfig, loadDingTalkConfig, saveDingTalkConfig, loadDingTalkBindings, setDingTalkBinding,
  currentDingtalkMergeTarget, openDingtalkSession,
  shortcutCatalog, shortcutFixedCatalog,
}: FrameProps): ReactElement {
  const [configOpen, setConfigOpen] = useState(false)
  const [dingtalkOpen, setDingtalkOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [intakeWidth, setIntakeWidth] = useState(RAIL_DEFAULT)
  const [workspaceWidth, setWorkspaceWidth] = useState(RAIL_DEFAULT)
  // Per-tab rail widths (2026-10-15 截图评审，B 方案): each tab declares a
  // comfort width, a switch applies it, a drag rewrites the active tab's
  // entry (persisted, so a hand-tuned width survives restarts).
  const [widthPrefs] = useState<RailWidthPrefs>(readRailWidths)
  const activeIntakeTab = useRef<string | null>(null)
  const activeEntitiesTab = useRef<string | null>(null)
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

  // The fixed centre tabs (任务/调度/洞察) are closeable since 2026-10-15;
  // the footer's four switches (任务/提议/调度/洞察) reopen them. 提议 is
  // pinned open (2026-10-15 平铺化用户裁决：提议默认打开在中部，不可关闭) —
  // it joins no persistence and offers no close button. The open flags
  // persist to localStorage; a closed tab's pane stays mounted
  // (display:none), so a reopen costs nothing and the schedule draft /
  // open card survive.
  const [fixedOpen, setFixedOpen] = useState<FixedTabsOpen>(restoreFixedTabs)
  const fixedOpenRef = useRef(fixedOpen)
  fixedOpenRef.current = fixedOpen
  const setFixedTabsOpen = useCallback((next: FixedTabsOpen): void => {
    fixedOpenRef.current = next
    setFixedOpen(next)
    persistFixedTabs(next)
  }, [])
  const openFixedTab = useCallback((tab: ClosableFixedTab): void => {
    setFixedTabsOpen({ ...fixedOpenRef.current, [tab]: true })
  }, [setFixedTabsOpen])
  const closeFixedTab = useCallback((tab: ClosableFixedTab): void => {
    setFixedTabsOpen({ ...fixedOpenRef.current, [tab]: false })
    // Closing the active tab falls back to the conversation — the one
    // tab that can never close.
    const closed = tab === 'tasks' ? TASKS_TAB : tab === 'schedule' ? SCHEDULE_TAB : INSIGHTS_TAB
    setTabs(state => state.active === closed ? activateTab(state, CONVERSATION_TAB) : state)
  }, [setFixedTabsOpen])

  // One activation for every caller (2026-10-10 ocr 评审：八处闭包逐字重复，
  // 提成单一稳定回调)——seat 发布、pane 跳转、tab 条点击共用。
  const activate = useCallback((key: string): void => {
    // A closed fixed tab reopens on demand: the g+2/g+3 shortcuts, the layout
    // command and any stray jump all land on a visible page.
    if (key === TASKS_TAB && !fixedOpenRef.current.tasks) openFixedTab('tasks')
    if (key === SCHEDULE_TAB && !fixedOpenRef.current.schedule) openFixedTab('schedule')
    if (key === INSIGHTS_TAB && !fixedOpenRef.current.insights) openFixedTab('insights')
    setTabs(state => activateTab(state, key))
  }, [openFixedTab])

  // Publish this frame's toggle into the seat `ctx.layout` reads, and the
  // file opener into the seat `ctx.sidebarRight` (the 0.2.1 stand-in) reads.
  // Unmount restores the no-ops, so a torn-down frame never fires into a
  // dead component.
  useEffect(() => {
    panels.toggleIntake = () => { setIntakeOpen(open => !open) }
    panels.activateTab = activate
    panels.setConfigOpen = (open) => { setConfigOpen(open) }
    sidebarFiles.openFile = (path) => { setTabs(state => openTab(state, path, readOnlyPath(path) ? 'read' : 'edit')) }
    return () => {
      panels.toggleIntake = () => {}
      panels.activateTab = () => {}
      panels.setConfigOpen = () => {}
      sidebarFiles.openFile = () => {}
    }
  }, [panels, sidebarFiles, activate])

  const cols = solveColumns(
    viewport,
    intakeOpen ? intakeWidth : 0,
    workspaceOpen ? workspaceWidth : 0,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols

  const onIntakeDrag = useCallback((dx: number) => {
    const next = clampRail(colsRef.current.intake + dx)
    setIntakeWidth(next)
    // The drag retunes the active tab's comfort width and remembers it.
    const tab = activeIntakeTab.current
    if (tab !== null) {
      widthPrefs.intake[tab] = next
      persistRailWidths(widthPrefs)
    }
  }, [widthPrefs])

  const onWorkspaceDrag = useCallback((dx: number) => {
    const next = clampRail(colsRef.current.workspace - dx)
    setWorkspaceWidth(next)
    const tab = activeEntitiesTab.current
    if (tab !== null) {
      widthPrefs.entities[tab] = next
      persistRailWidths(widthPrefs)
    }
  }, [widthPrefs])

  /** A rail reports its active tab; the width follows the tab's preference. */
  const onIntakeTabChange = useCallback((tabId: string) => {
    activeIntakeTab.current = tabId
    setIntakeWidth(widthPrefs.intake[tabId] ?? comfortWidth('intake', tabId))
  }, [widthPrefs])

  const onEntitiesTabChange = useCallback((tabId: string) => {
    activeEntitiesTab.current = tabId
    setWorkspaceWidth(widthPrefs.entities[tabId] ?? comfortWidth('entities', tabId))
  }, [widthPrefs])

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
  // The mail verbs and the skill writeback ride along too (their absence made
  // inbox-approved 删除/归档/下载 rows skip honestly — the inbox IS their
  // decision surface, so the knives belong here), each only when the host
  // supplied the face.
  const applyConfirmed = useCallback(
    (options: { proposal: Proposal; ticked: readonly number[] }): Promise<ProposalApplyResult> =>
      applyProposal({
        ...options,
        target: {
          createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource,
          resolveEntity,
          ...(mailDelete !== undefined ? { deleteMails: mailDelete } : {}),
          ...(mailArchive !== undefined ? { archiveMails: mailArchive } : {}),
          ...(skillRewriteApply !== undefined ? { skillRewrite: skillRewriteApply } : {}),
        },
      }),
    [createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource,
      resolveEntity, mailDelete, mailArchive, skillRewriteApply],
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
  const taskBegin = useCallback((kind: TaskKind, title: string, stage: string, target?: string): string => {
    taskSeq.current += 1
    const id = `task-${taskSeq.current}`
    setTaskRows(rows => [
      {
        id, kind, title, stage, detail: null, status: 'running', startedAt: Date.now(), endedAt: null,
        sessionId: null, ...(target !== undefined ? { target } : {}),
      },
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
  /** Erase one row outright — for runs that turn out to be no-ops (a mail
      read that came back empty leaves nothing worth a line in the ledger). */
  const taskDrop = useCallback((id: string): void => {
    setTaskRows(rows => rows.filter(row => row.id !== id))
  }, [])

  // ADR-0021 决定 7 + ADR-0052 决定 3: a row menu's capability click is
  // always the gesture now — the client sends the plain user message
  // `/name @path` — no fetch, no concatenation — and the controller's
  // pre-step (ADR-0025 决定 3) injects the SKILL.md body. The message lands
  // in the transcript exactly as if the human had typed it. Scripts the
  // human channel may run deterministically survive only as builtin RPCs
  // (the mail verbs); the generic run path is gone.
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
  // An inbox-approved row passes its entry id (ADR-0060 决定 7): the undo
  // stash lives server-side now, so the chip replays through the RPC — the
  // card callback's undo rides the same stash. The report accepts either
  // the card flow's full result or the inbox RPC's wire-safe trail (its
  // undo carries the irreversible names only — the steps never left home).
  type ConfirmWrittenResult = Omit<ProposalApplyResult, 'undo'> & { undo?: Pick<ProposalUndo, 'irreversible'> }
  const confirmWritten = (result: ConfirmWrittenResult, entryId?: string): void => {
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
          if (entryId !== undefined) {
            void proposalInboxUndo({ id: entryId }).then(({ failed }) => {
              setTreeKey(key => key + 1)
              setCapabilityNotice(failed.length === 0 ? '已撤销刚才的写入。' : `撤销失败：${failed.join('；')}`,
                { severity: failed.length === 0 ? 'info' : 'error' })
            }, (failure: unknown) => {
              setCapabilityNotice(`撤销失败：${remoteMessage(failure)}`, { severity: 'error' })
            })
            return
          }
          // Card flow only: this branch never runs for an inbox row, whose
          // trail carries no steps — the cast restores the full undo shape.
          void runUndo(undo as ProposalUndo).then(({ failed }) => {
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

  // ── ADR-0064: the 调度 tab's second section reads the workspace store ────
  // Instruction rules stay in workspaces.json (the controller's tick is still
  // the executor); the pane edits one row's cron through the narrow RPC, and
  // this read feeds the pane's list — nothing else ever writes through it.
  const [workspaces, setWorkspaces] = useState<readonly KbWorkspace[]>([])
  useEffect(() => {
    let stale = false
    workspaceList().then(
      (result) => { if (!stale) setWorkspaces(result.workspaces) },
      (failure: unknown) => { if (!stale) setCapabilityNotice(`工作空间读取失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
    return () => { stale = true }
  }, [workspaceList])

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

  // 2026-10-10 分流提示：提议卡里指向已注册能力的 add-memory 行要附一句
  // 「考虑改提技能改写」——能力名清单挂载时读一次即可，读失败只是没提示。
  const [capabilityScopes, setCapabilityScopes] = useState<readonly string[]>([])
  useEffect(() => {
    let gone = false
    void capabilityList().then(
      (result) => {
        if (!gone) setCapabilityScopes(result.capabilities.map(row => row.name))
      },
      () => { /* 提示是装饰，读取失败不值得打扰 */ },
    )
    return () => { gone = true }
  }, [capabilityList])

  useEffect(() => { loadInbox() }, [loadInbox])

  // ── the 图谱 tab and its relation graph (ADR-0049) ───────────────────────
  // One read at mount: the graph is a browsing overview, not a live monitor —
  // the revision poll's refresh affordances don't extend here. A failed read
  // leaves the pane on its loading text and reports through the notice line.
  // The pane's 刷新 button re-runs the same read (2026-10-11).
  const [graphData, setGraphData] = useState<KbRelationGraphResult | null>(null)

  const reloadGraph = useCallback((): void => {
    void relationGraph().then(
      (result) => { setGraphData(result) },
      (failure: unknown) => { setCapabilityNotice(`图谱读取失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
  }, [relationGraph])

  useEffect(() => { reloadGraph() }, [reloadGraph])

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

  // 重新入队（2026-10-14 丢弃后悔药）：误丢弃的恢复不是撤销旧决策（决策
  // 终态不可改，入库闸门单向），而是把条目内容原样投回队列——新 id、新
  // 时间戳、pending 等待重新裁决；旧的已丢弃条目留在列表里当痕迹。
  const reenqueueInboxEntry = useCallback((entry: KbQueuedProposal): void => {
    setInboxBusyId(entry.id)
    void proposalInboxEnqueue({
      source: entry.source,
      sourceName: entry.sourceName,
      title: entry.title,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
      proposal: entry.proposal,
    }).then(
      (result) => {
        setInboxBusyId(null)
        setInboxEntries(result.proposals)
        setCapabilityNotice(`已重新入队提议「${entry.title}」，等待重新裁决。`, { severity: 'info' })
      },
      (failure: unknown) => {
        setInboxBusyId(null)
        setCapabilityNotice(`重新入队失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxEnqueue])

  // 批准: the whole thing is one server RPC now (ADR-0060 决定 7) — the
  // controller binds the KB seams itself, applies, and settles the row in
  // the SAME call, so the client no longer choreographs apply → settle or
  // compensates a failed settle (the server's discard re-push covers that).
  // The result is a three-way verdict: applied (with the settlement status),
  // preflight-blocked (nothing written, the row stays pending — the remedy
  // is a restart, not a re-ask), already-decided (a repeated card callback
  // or double-click — idempotent no-op, the list refreshes to what's stored).
  // Something landed → the covered mails count as processed (ADR-0047
  // 验收修正 2); a zero-write apply leaves the mails unprocessed so the
  // nomination can come again.
  const confirmInboxEntry = useCallback((entry: KbQueuedProposal, ticked: readonly number[]): void => {
    setInboxBusyId(entry.id)
    void proposalInboxApply({ id: entry.id, ticked }).then((outcome) => {
      setInboxBusyId(null)
      if (outcome.kind === 'already-decided') {
        void proposalInboxList().then(list => setInboxEntries(list.proposals))
        setCapabilityNotice(`提议「${entry.title}」已被处理过（${outcome.status}），无需重复操作。`, { severity: 'info' })
        return
      }
      if (outcome.kind === 'preflight-blocked') {
        setCapabilityNotice(outcome.message, { severity: 'error' })
        return
      }
      const result = outcome.apply
      const proposal = proposalOfPayload(entry.proposal)
      if (proposal !== null && result.perAction.some(row => row.ok)) moveMailCursor(proposal.mails)
      setInboxEntries(outcome.proposals)
      if (outcome.status === 'failed') {
        const detail = result.perAction.filter(row => !row.ok).map(row => row.error).join('；')
        setCapabilityNotice(`提议「${entry.title}」零写入，已记为失败：${detail}`, { severity: 'error' })
        return
      }
      setTreeKey(key => key + 1)
      confirmWritten(result, entry.id)
    }, (failure: unknown) => {
      setInboxBusyId(null)
      // An apply-level surprise — the row stays pending on disk either way.
      setCapabilityNotice(`写入失败：${remoteMessage(failure)}`, { severity: 'error' })
    })
  }, [proposalInboxApply, proposalInboxList, confirmWritten, moveMailCursor])

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

  /**
   * ADR-0065: the tick re-pulls the store through the same write queue, so
   * definitions written outside this window — the agent's kb_add/update/
   * remove_schedule, a manual file edit — surface within one scan cycle.
   * Tail-chaining on the write queue keeps the order total: a reload can
   * never stomp an in-flight local write, and a local write queued after a
   * reload always lands on top. Failures stay silent — the mount-time load
   * already reports read errors, and a transient miss is healed next tick.
   */
  const reloadSchedules = useCallback((): void => {
    const run = scheduleWriteQueue.current.then(async (): Promise<void> => {
      try {
        const fresh = await scheduleList()
        schedulesRef.current = fresh.schedules
        setSchedules(fresh.schedules)
      } catch { /* silent: retried on the next tick */ }
    })
    scheduleWriteQueue.current = run
  }, [scheduleList])

  /** ADR-0064: the 调度 tab's narrow write into one instruction's rule —
      resolves null on success (the pane treats that as saved), else the
      error prose for the editor's inline alert. The returned list refreshes
      the frame's workspace snapshot in place. */
  const commitInstructionSchedule = useCallback(async (args: KbWorkspaceInstructionScheduleSetArgs): Promise<string | null> => {
    try {
      const result = await workspaceInstructionScheduleSet(args)
      setWorkspaces(result.workspaces)
      return null
    } catch (failure: unknown) {
      return remoteMessage(failure)
    }
  }, [workspaceInstructionScheduleSet])

  // ADR-0064: the 调度 tab's 查看运行记录 jumps the left rail to the
  // 工作空间 tab — the nonce mirror of connectorReveal (ADR-0031).
  const [workspaceReveal, setWorkspaceReveal] = useState(0)

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
      const firedAt = new Date().toISOString()
      const taskId = taskBegin('schedule', `调度「${schedule.name}」`, '执行中')
      const controller = new AbortController()
      scheduleAborts.current.set(taskId, controller)
      runSchedule({
        id: schedule.id,
        name: schedule.name,
        prompt: schedule.prompt,
        ...(schedule.capability !== undefined && schedule.capability !== '' ? { capability: schedule.capability } : {}),
        signal: controller.signal,
        onSession: (sessionId) => { taskPatch(taskId, { sessionId }) },
      }).then((result) => {
        // 2026-10-10 性能统计：任务行与完成通知都带上这次运行的账——
        // 用时/步数/重试等待/工具量/截断，晨间复盘不再需要手工开日志。
        const statsLine = result.stats !== undefined ? formatRunStats(result.stats) : undefined
        taskEnd(taskId, 'done', statsLine ?? '已完成')
        // ADR-0047: a run that filed a proposal points at the decision
        // surface instead of paraphrasing itself — the card is the answer.
        const statsSuffix = statsLine !== undefined ? `（${statsLine}）` : ''
        // 2026-10-15 评审：直答分支同样用括号后缀挂统计行（§7 禁 ` · ` 缀尾，
        // 此前这里是同函数里唯一残留的 join(' · ') 姿势）。
        const answerExcerpt = result.answer.replace(/\s+/g, ' ').trim().slice(0, 80)
        // ADR-0059 决定 2：读取闭合的违例已附到卡上，通知里点名数量——
        // 无人值守场景下这是「先去看警告再批准」的第一声铃。
        const warningSuffix = result.warnings !== undefined && result.warnings.length > 0
          ? `，校验警告 ${result.warnings.length} 条`
          : ''
        notifySchedule({
          title: `调度「${schedule.name}」完成`,
          body: result.proposalId !== undefined
            ? `产生了待决策的提议，去「提议」页处理${warningSuffix}${statsSuffix}`
            : (answerExcerpt !== ''
              ? `${answerExcerpt}${statsSuffix}`
              : statsLine ?? '已完成'),
        })
        // The proposal is on the disk store the moment the run ends: pull it
        // into the pane now rather than waiting for the next scan.
        if (result.proposalId !== undefined) loadInbox()
        // 运行上报（born-terminal）：把这次点火记进运行历史并广播出去——钉钉
        // 推送和 kb_list_workspace_runs 都从这条链上看到调度运行。上报失败只
        // 警告：丢行可诊断，不值得打断已成功的运行。
        void scheduleRunReport({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          sessionId: result.sessionId,
          prompt: schedule.prompt,
          status: 'success',
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          finalResult: result.answer,
        }).catch((reason: unknown) => {
          console.warn(`run report for schedule ${schedule.id} failed; the history row is lost:`, reason)
        })
      }, (failure: unknown) => {
        if (controller.signal.aborted) {
          taskEnd(taskId, 'cancelled', '已取消')
          void scheduleRunReport({
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            prompt: schedule.prompt,
            status: 'stopped',
            startedAt: firedAt,
            finishedAt: new Date().toISOString(),
          }).catch((reason: unknown) => {
            console.warn(`run report for schedule ${schedule.id} failed; the history row is lost:`, reason)
          })
        } else {
          const message = remoteMessage(failure)
          taskEnd(taskId, 'failed', `失败：${message}`)
          notifySchedule({ title: `调度「${schedule.name}」失败`, body: message })
          void scheduleRunReport({
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            prompt: schedule.prompt,
            status: 'failed',
            startedAt: firedAt,
            finishedAt: new Date().toISOString(),
            error: message,
          }).catch((reason: unknown) => {
            console.warn(`run report for schedule ${schedule.id} failed; the history row is lost:`, reason)
          })
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
      // ADR-0065: the schedule store re-read rides the scan too — the agent's
      // scheduling tools write the file host-side, and the in-memory snapshot
      // must not outlive it by more than one cycle.
      reloadSchedules()
    }
    tick()
    const timer = setInterval(tick, SCHEDULE_SCAN_MS)
    return () => { clearInterval(timer) }
  }, [schedulesLoaded, markScheduleStamps, runSchedule, scheduleRunReport, taskBegin, taskPatch, taskEnd, loadInbox, reloadSchedules])
  // A row menu's capability click (ADR-0052 决定 3): always the gesture —
  // the plain user message rides the watched session, and the controller's
  // pre-step injects the SKILL.md body. No subprocess, no abort line, no
  // run record: the persistent 运行摘要 (ADR-0053 决定 3) counts the
  // instruction call at the host seam instead.
  const runRowCapability = useCallback((capability: KbCapabilitySummary, path: string): void => {
    setCapabilityNotice(null)
    void promptSession(capabilityGestureMessage(capability.name, { path })).then(
      () => {},
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
  }, [promptSession])

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
  const liveProposal = refineProposal ?? validateProposal

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
      const id = mailTaskId.current ?? taskBegin('mail', `邮件分析（${mailState.mails.length} 封）`, '创建会话', 'mail')
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
    const taskId = taskBegin('mail', '读取邮件', '读取中', 'mail')
    mailFetchTaskId.current = taskId
    const aborter = new AbortController()
    mailFetchAbort.current = aborter
    try {
      const result = await mailFetch(args, aborter.signal)
      // An empty read is a no-op (the watermark already covers the range) —
      // it leaves no row behind instead of a done-line that says nothing.
      if (result.messages.length === 0) taskDrop(taskId)
      else taskEnd(taskId, 'done', `已读 ${result.messages.length} 封`)
      return result
    } catch (failure: unknown) {
      if (aborter.signal.aborted) taskEnd(taskId, 'cancelled', '已取消')
      else taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
      throw failure
    } finally {
      mailFetchTaskId.current = null
      mailFetchAbort.current = null
    }
  }, [mailFetch, taskBegin, taskEnd, taskDrop])

  // ADR-0033: the 任务 row's 「详情」 — a read-only drawer over the run's
  // session log. The row anchors to a session only when its run made one
  // (refine and mail analysis do; script capabilities are bare subprocesses),
  // so TasksPane renders the verb only for those rows.
  const [detailRow, setDetailRow] = useState<TaskRow | null>(null)
  const onTaskDetail = useCallback((row: TaskRow): void => { setDetailRow(row) }, [])
  const closeTaskDetail = useCallback((): void => { setDetailRow(null) }, [])

  // ADR-0031: the 任务 row's two verbs. 查看 goes to where the outcome
  // lives — refine speaks through the conversation's cards and notices; mail
  // and capability rows land in the intake rail's 能力 tab with the row's
  // own capability preselected (2026-10-08: previously the panel's first
  // screen greeted the human regardless of which capability had run). A
  // validate row's outcome is the card, already popped here, so its 查看
  // opens the ADR-0033 detail drawer instead: the run's session log carries
  // the prescan lists and the model's full judgement (they ride inside the
  // prompt), which is the "more" a curious human wants. While the run has
  // not anchored a session yet there is nothing to open. 取消 reuses the
  // exact cancel path each runner already owns.
  const [connectorReveal, setConnectorReveal] = useState<{ nonce: number; capability: string | null }>({ nonce: 0, capability: null })
  const jumpTask = useCallback((row: TaskRow): void => {
    if (row.kind === 'validate' || row.kind === 'schedule') {
      if (row.sessionId !== null) setDetailRow(row)
      return
    }
    if (row.kind === 'refine') activate(CONVERSATION_TAB)
    else {
      setIntakeOpen(true)
      setConnectorReveal(({ nonce }) => ({ nonce: nonce + 1, capability: row.target ?? null }))
    }
  }, [activate])
  const cancelTask = useCallback((row: TaskRow): void => {
    if (row.kind === 'refine') cancelRefine()
    else if (row.kind === 'validate') cancelValidate()
    else if (row.kind === 'schedule') scheduleAborts.current.get(row.id)?.abort()
    else if (row.kind === 'mail' && row.id === mailFetchTaskId.current) mailFetchAbort.current?.abort()
    else if (row.kind === 'mail') mailRun.cancel()
    // ADR-0052 决定 3 retired the generic capability run, so no 'capability'
    // task row is minted any more — nothing to cancel here.
  }, [cancelRefine, cancelValidate, mailRun])

  // ADR-0017: editing belongs to Obsidian, so this only hands the file over.
  // Without a root we still open the KB-relative path and let the host resolve
  // it — the desktop's `.md` handler is usually Obsidian anyway.
  const openInObsidian = useCallback((path: string): void => {
    const target = kbRoot === '' ? path : obsidianUri(kbRoot, path)
    void openExternal(target).catch((reason: unknown) => {
      console.warn('opening the file outside the workbench failed:', reason)
    })
  }, [kbRoot, openExternal])

  // One accounting wrapper for every archive gesture (ADR-0041 决定 2): both
  // rails' row menus share it, so the tree reload happens exactly once no
  // matter who flipped the flag. Failures propagate untouched: the rail's
  // own onError reports them. Concurrency is merged per path+direction here:
  // a second gesture of the same direction on the same entity while one flip
  // is in flight (fast double-click, both rails showing it) joins the first
  // flight rather than racing it with a conflicting write. An
  // opposite-direction gesture is a genuine reversal, not a duplicate — it
  // goes through as its own call (the server settles the last write). Flips
  // of different entities stay independent.
  const archiveFlights = useRef(new Map<string, Promise<KbSetEntityArchivedResult>>())
  const flipArchive = useCallback((path: string, archived: boolean): Promise<KbSetEntityArchivedResult> => {
    const flightKey = `${archived ? 'archive:' : 'restore:'}${path}`
    const inFlight = archiveFlights.current.get(flightKey)
    if (inFlight !== undefined) return inFlight
    const flight = (archived ? archiveEntity(path) : restoreEntity(path)).then((result) => {
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
        capability.appliesTo?.selection === true
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

  // 「发送到会话」: the selection *is* the prompt. The gesture may fire from
  // any tab (the menu rides the reading view and the source editor), so the
  // frame switches to the conversation first — a message landing in a tab
  // the human cannot see is no feedback at all (2026-10-08).
  const sendSelection = useCallback((text: string): void => {
    setCapabilityNotice(null)
    activate(CONVERSATION_TAB)
    void promptSession(text).then(
      () => { setCapabilityNotice('已发送到当前会话。', { severity: 'info' }) },
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
  }, [promptSession, activate])

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
  // the transcript as if the human had typed it. The frame switches to the
  // conversation tab before sending: the run's feedback (cards, notices,
  // streaming text) lives there, and the human may have fired the menu from
  // the reading view of any tab (2026-10-08 — the missing switch was the
  // 「画图无反馈」 report).
  const runSelectionCapability = useCallback((name: string, selection: string): void => {
    setCapabilityNotice(null)
    activate(CONVERSATION_TAB)
    void promptSession(capabilityGestureMessage(name, { selection })).then(
      () => {},
      (failure: unknown) => { setCapabilityNotice(`发送失败：${remoteMessage(failure)}`, { severity: 'error' }) },
    )
  }, [promptSession, activate])

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
  }, [])

  // The tab strip's close gesture (2026-10-09 第四轮评审 P2)：先把 debounce
  // 窗口里的脏草稿写下去，再拆 tab——否则 ≤2s 的编辑随 tab 一起蒸发。
  // 注意 delete 路径（removeResource）不走这里：文件已经没了，flush 会
  // 把陈旧草稿写回去复活它。
  // 2026-10-10 ocr 评审（高危）：flush 是跨两个 await 的异步写，fire-and-forget
  // 会在 conflict（没写盘）/failed（写盘出错）时照样拆 tab——冲突条和错误随
  // 编辑器一起卸载，草稿无声丢失。等到 'saved' 才拆；其余结局留 tab 让人处置。
  const closeFileTab = useCallback((path: string): void => {
    const editor = editors.current.get(path)
    if (editor === undefined) {
      closeFile(path)
      return
    }
    void editor.flushNow().then((outcome) => {
      if (outcome === 'saved') closeFile(path)
    })
  }, [closeFile])

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
    onKbRootChanged()
  }, [onKbRootChanged])

  // The footer switches' counter pills (2026-10-12; 2026-10-15 平铺化后这些
  // 计数同时喂中栏页签的信号点): 任务=running tasks, 提议=待批提议 +
  // pendingMemories（kb_propose_memory 的在途队列）。
  const runningTasks = runningCount(taskRows)
  const pendingProposals = inboxEntries.filter(entry => entry.status === 'pending').length
  const [pendingMemories, setPendingMemories] = useState(0)
  // The insights pressure slot renders once and feeds two mouths: CenterPane's
  // tab strip (while the tab is open) and the footer 洞察 switch (once it is
  // closed — ADR-0057).
  const insightsPressure = renderSlot('center.insights.pressure', {})

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
          resolveEntity={resolveEntity}
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
          capabilityCreate={capabilityCreate}
          capabilityAdopt={capabilityAdopt}
          capabilityRegister={capabilityRegister}
          capabilityRouteUpdate={capabilityRouteUpdate}
          capabilityUnregister={capabilityUnregister}
          mailRun={mailRun}
          revealConnector={connectorReveal}
          memoryList={memoryList}
          memoryAdd={memoryAdd}
          memoryDelete={memoryDelete}
          promptShortcutList={promptShortcutList}
          promptShortcutSave={promptShortcutSave}
          fillShortcut={fillShortcut}
          workspaceList={workspaceList}
          workspaceSave={workspaceSave}
          revealWorkspace={{ nonce: workspaceReveal }}
          onOpenSchedule={() => { activate(SCHEDULE_TAB) }}
          workspaceRun={workspaceRun}
          workspaceRunStop={workspaceRunStop}
          workspaceRunsList={workspaceRunsList}
          workspaceRunsClear={workspaceRunsClear}
          workspaceRunDelete={workspaceRunDelete}
          onRunCapability={runRowCapability}
          onRefine={runRefineGesture}
          kbRoot={kbRoot}
          onActiveTabChange={onIntakeTabChange}
          t={t}
        />
      </div>
      <CenterPane
        tabs={tabs}
        statuses={statuses}
        fixedOpen={fixedOpen}
        onCloseFixed={closeFixedTab}
        taskRows={taskRows}
        // 2026-10-15 平铺化：任务/提议/调度各自成为独立 tab，三个 pane 的
        // 装配从 TasksHubPane 的 props 挪到这里。The 详情 drawer overlays
        // the 任务 pane (position:relative wrapper, ADR-0033). The schedule
        // gate keeps the pane read-only until the initial read lands
        // (OCR 2026-10-03): before the store's rows arrive — or forever after
        // a failed read — the pane must offer no mutating affordance, or an
        // early full-list save would wipe every definition it never fetched.
        tasksPane={(
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
            <TasksPane rows={taskRows} onCancel={cancelTask} onJump={jumpTask} onDetail={onTaskDetail} />
            {detailRow === null ? null : (
              <SessionDetailDrawer
                key={detailRow.id}
                row={detailRow}
                load={sessionDetail}
                onClose={closeTaskDetail}
                t={t}
              />
            )}
          </div>
        )}
        inboxPane={(
          <>
            {/* 2026-10-15 迁入：kb_propose_memory 的在途队列从省得搬进
                提议 tab——所有待裁决的事住同一个 tab。空队列时整块隐形；
                读取独立于 inbox 的加载门，两边互不遮蔽。 */}
            <MemoryProposalZone
              t={t}
              list={memoryProposalList}
              approve={memoryProposalApprove}
              discard={memoryProposalDiscard}
              onPendingChange={setPendingMemories}
            />
            {!inboxLoaded ? (
              <div style={{ padding: 'var(--yt-space-4)', color: 'var(--yt-text-muted)' }}>提议加载中…</div>
            ) : (
              <InboxPane
                entries={inboxEntries}
                busyId={inboxBusyId}
                onConfirm={confirmInboxEntry}
                onDiscard={discardInboxEntry}
                onReenqueue={reenqueueInboxEntry}
                capabilityScopes={capabilityScopes}
                t={t}
              />
            )}
          </>
        )}
        schedulePane={!schedulesLoaded ? (
          <div style={{ padding: 'var(--yt-space-4)', color: 'var(--yt-text-muted)' }}>调度加载中…</div>
        ) : (
          <SchedulePane
            schedules={schedules}
            onSave={commitSchedules}
            workspaces={workspaces}
            onInstructionScheduleSave={commitInstructionSchedule}
            onViewRunRecords={() => { setWorkspaceReveal(nonce => nonce + 1) }}
            promptShortcutList={promptShortcutList}
            capabilityNames={capabilityScopes}
          />
        )}
        insightsPane={renderSlot('center.insights', {
          // ADR-0050: the overview's session-card jump — opening the session
          // is the card's own gesture; switching to the conversation tab is
          // the frame's, passed through as owner props. `active` gates the
          // pane's reads on the tab actually being visible (lazy load).
          // ADR-0057: the 关系图谱 sub-page's body rides along as an owner
          // prop — the graph is the sub-page's whole content.
          onSwitchToConversation: () => { activate(CONVERSATION_TAB) },
          active: tabs.active === INSIGHTS_TAB,
          graph: graphData === null ? (
            <div style={{ padding: 'var(--yt-space-4)', color: 'var(--yt-text-muted)' }}>图谱加载中…</div>
          ) : (
            <GraphPane data={graphData} onOpen={(path) => { openFile(path, 'edit') }} onReload={reloadGraph} t={t} />
          ),
        })}
        insightsPressure={insightsPressure}
        inboxPending={pendingProposals + pendingMemories}
        onActivate={(key) => { activate(key) }}
        onClose={closeFileTab}
        renderConversation={() => renderSlot('main', {}, { entryKey: 'conversation' })}
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
          // The 阅读 / 源码 switch lives in the file pane's own header — see
          // fileModeBarStyle. The detail view no longer carries the archive
          // gesture (ADR-0041 决定 7 的收窄，2026-10-08)：两侧栏的行菜单仍是
          // 归档的家，浏览态不再混入写动作。
          return (
            <div style={bothPanesStyle}>
              <div style={fileModeBarStyle}>
                <button
                  type="button"
                  data-hover="tab"
                  data-selected={viewMode === 'read' ? '' : undefined}
                  style={viewMode === 'read' ? tabItemActiveStyle : tabItemStyle}
                  onClick={() => { setViewMode('read') }}
                >
                  {t('center.read')}
                </button>
                <button
                  type="button"
                  data-hover="tab"
                  data-selected={viewMode === 'source' ? '' : undefined}
                  style={viewMode === 'source' ? tabItemActiveStyle : tabItemStyle}
                  onClick={() => { setViewMode('source') }}
                >
                  {t('center.source')}
                </button>
                {/* 2026-10-08：与 阅读/源码 并排——都是「这份文件怎么看」的一组
                    控制，原先散在 MarkdownView 的属性条里，两行两处不好找。 */}
                <button
                  type="button"
                  data-hover="tab"
                  style={{ ...tabItemStyle, marginLeft: 'auto' }}
                  title={t('md.openExternallyTitle')}
                  onClick={() => { openInObsidian(tab.path) }}
                >
                  {t('md.openInObsidian')}
                </button>
              </div>
              <div style={paneStyleFor(viewMode === 'read')}>
                <MarkdownView
                  content={drafts[tab.path] ?? ''}
                  path={tab.path}
                  resolveImage={readImage}
                  links={tab.path === linkGraph?.path ? linkGraph : undefined}
                  onOpen={(path) => { openFile(path, 'edit') }}
                  onEdit={(next) => {
                    void editors.current.get(tab.path)?.patch(next).then((outcome) => {
                      // A conflict lives in the editor's own bar, which the
                      // reading view is hiding: show it rather than losing it.
                      if (outcome === 'conflict') setViewMode('source')
                    })
                  }}
                  onUnresolved={() => { setViewMode('source') }}
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
          resolveEntity={resolveEntity}
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
          onActiveTabChange={onEntitiesTabChange}
          t={t}
        />
      </div>
      {/* The reserved grid row: the four fixed-tab switches (任务/提议/调度/
          洞察) live at the window's bottom-left (2026-10-15 截图评审)；配置
          与快捷键是低频入口，沉到右下角（同日用户裁决，配置改名模型配置）。
          点击开关直达各自的平铺 tab（任务 hub 的子页壳同日拆除）；有信号的
          开关戴计数胶囊（任务=运行中，提议=待批提议+待批记忆），洞察关闭时
          压力点随钮走，警报不失明。 */}
      <div style={footerStripStyle}>
        <button style={footerButtonStyle} data-footer-tasks="true" data-hover="true" onClick={() => { activate(TASKS_TAB) }}>
          {t('footer.tasks')}
          {runningTasks > 0 && <span data-footer-badge="tasks" style={footerBadgeStyle}>{runningTasks}</span>}
        </button>
        <button style={footerButtonStyle} data-footer-inbox="true" data-hover="true" onClick={() => { activate(INBOX_TAB) }}>
          {t('footer.inbox')}
          {pendingProposals + pendingMemories > 0 && <span data-footer-badge="inbox" style={footerBadgeStyle}>{pendingProposals + pendingMemories}</span>}
        </button>
        <button style={footerButtonStyle} data-footer-schedule="true" data-hover="true" onClick={() => { activate(SCHEDULE_TAB) }}>
          {t('footer.schedule')}
        </button>
        <button style={footerButtonStyle} data-footer-insights="true" data-hover="true" onClick={() => { activate(INSIGHTS_TAB) }}>
          {t('footer.insights')}
          {/* The pressure alarm rides the tab label while the tab is open;
              once it closes, the footer switch is its only home — the alarm
              must stay globally visible (ADR-0057). */}
          {!fixedOpen.insights && insightsPressure}
        </button>
        <button style={{ ...footerButtonStyle, marginLeft: 'auto' }} data-config-button="true" data-hover="true" onClick={() => { setConfigOpen(true) }}>
          {t('config.open')}
        </button>
        {/* ADR-0060 决定 2：底部状态条的钉钉入口，配置对话框沿模型配置范式。 */}
        <button style={footerButtonStyle} data-dingtalk-button="true" data-hover="true" onClick={() => { setDingtalkOpen(true) }}>
          {t('dingtalk.open')}
        </button>
        {/* 2026-10-09 第四轮评审 P1：8 条热键注册后无处可见——这个只读目录
            是它们的展示面，键帽实时读注册表 catalog（改键/平台差异自动跟随）。 */}
        <button style={footerButtonStyle} data-shortcuts-button="true" data-hover="true" onClick={() => { setShortcutsOpen(true) }}>
          {t('shortcuts.open')}
        </button>
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
      {dingtalkOpen && (
        <DingTalkDialog
          t={t}
          load={loadDingTalkConfig}
          save={saveDingTalkConfig}
          loadBindings={loadDingTalkBindings}
          mergeBinding={setDingTalkBinding}
          mergeTarget={currentDingtalkMergeTarget}
          openSession={openDingtalkSession}
          loadTranscript={sessionDetail}
          onClose={() => { setDingtalkOpen(false) }}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog t={t} catalog={shortcutCatalog} fixedCatalog={shortcutFixedCatalog} onClose={() => { setShortcutsOpen(false) }} />
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
        >
          {capabilityNotice.text}
          {/* The written report's undo chip: takes back what the applier
              just wrote, inside the undo severity's own 90-second window —
              the countdown beside the label makes the expiry legible instead
              of silent. */}
          {capabilityNotice.action !== undefined && (
            <button data-hover="true"
              type="button"
              style={noticeChipStyle}
              onClick={(event) => {
                event.stopPropagation()
                capabilityNotice.action?.run()
              }}
            >
              {capabilityNotice.action.label}
              {capabilityNotice.severity === 'undo' && undoRemaining !== null && (
                // --yt-text-tertiary 从未定义（2026-10-09 评审 P3）：倒计时
                // 曾因此继承父色，severity 配色形同虚设——回落到 muted。
                <span style={{ marginLeft: 'var(--yt-space-1)', color: 'var(--yt-text-muted)' }}>· {undoRemaining}s</span>
              )}
            </button>
          )}
          {/* A running refine is cancellable right where it announces itself
              (ADR-0031): the chip stops the run and drops the queue. */}
          {(refineActive || validateActive) && (
            <button data-hover="true"
              type="button"
              style={noticeChipStyle}
              onClick={(event) => {
                event.stopPropagation()
                if (refineActive) cancelRefine()
                if (validateActive) cancelValidate()
              }}
            >
              取消
            </button>
          )}
          {/* Explicit close (2026-10-09 评审 P2)：此前整条通知点任意处即消失，
              想选中错误文字复制时正好把它点没了——关闭收进一枚明确的钮，
              错误正文可以安心停留、复制。 */}
          <button
            type="button"
            style={{ ...noticeChipStyle, color: 'inherit' }}
            title={t('frame.closeNotice')}
            data-notice-close="true"
            data-hover="close"
            onClick={() => { setCapabilityNoticeRaw(null) }}
          >
            ✕
          </button>
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
