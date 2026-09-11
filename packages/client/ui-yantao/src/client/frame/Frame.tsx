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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TreeLoader } from '../Workbench.tsx'
import { IntakeRail, WorkspaceRail } from '../Workbench.tsx'
import type {
  DirectoryPicker, EntityCreator, ExternalOpener, FileDeleter, FileReader, FileWriter, LinksLoader,
  MailFetcher, MailMarker, RelationSetter, ResourceExtractor, ResourceRegistrar, RevisionLoader, RootLoader, RootSetter,
  TodoLoader, TodoWriter,
} from '../remote.ts'
import type { BookReader, DomainConfirmer } from '../reading-flow.ts'
import type { MailAnalyser } from '../mail-analysis.ts'
import { obsidianUri } from '../remote.ts'
import type { KbLinksResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { FileEditor, type FileEditorApi, type SaveStatus } from '../editor/FileEditor.tsx'
import { MarkdownView } from '../editor/MarkdownView.tsx'
import { ReadOnlyFile } from '../editor/ReadOnlyFile.tsx'
import { Onboarding } from '../Onboarding.tsx'
import { ReadingDialog } from '../ReadingDialog.tsx'
import {
  CONVERSATION_TAB, activateTab, activeFile, closeTab, emptyTabs, openTab, persistTabs, readOnlyPath, restoreTabs,
  type TabMode, type TabState,
} from '../tabs.ts'
import { CenterPane, type ViewMode } from './CenterPane.tsx'
import './frame.module.css'
import type { PanelToggles } from './layout.ts'
import { NARROW, RAIL_DEFAULT, clampRail, solveColumns } from './columns.ts'

/** Full props: the render share for the two seats this frame declares, plus the panel-action seat. */
export type FrameProps = PropsRenderSlots<'conversation' | 'shell.overlay'> & {
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
  /** Delete one KB file — the rails' right-click 「删除」 on an entity row. */
  readonly deleteFile: FileDeleter
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
  /** Run one mail analysis in a dsh session (ADR-0019). */
  readonly analyseMail: MailAnalyser
  /** Copy one dropped file into `resources/` (ADR-0020). */
  readonly registerResource: ResourceRegistrar
  /** Extract one resource's text into the cache (ADR-0020). */
  readonly extractResource: ResourceExtractor
  /** Create a reading project — a `project` entity with `source:` set (ADR-0020). */
  readonly createReadingProject: (name: string, source: string) => Promise<string>
  /** Run the first reading round in a dsh session (ADR-0020). */
  readonly readBook: BookReader
  /** Land the confirmed domain links in a second round (ADR-0020). */
  readonly confirmDomains: DomainConfirmer
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
  height: '100%',
  minWidth: 0,
  fontFamily: FONT,
  fontSize: 13,
} as const

const colStyle = { minWidth: 0, overflow: 'hidden' } as const

const railColStyle = { ...colStyle, background: '#fbfaf7' } as const

const overlayStyle = { position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' } as const

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
  renderSlot, panels, intake, workspace, read, write, deleteFile, setRelation, createEntity, root, setRoot,
  pickDirectory, links, revision, openExternal, todos, writeTodos, mailFetch, mailMarkRead, analyseMail,
  registerResource, extractResource, createReadingProject, readBook, confirmDomains, onKbRootChanged,
}: FrameProps): ReactElement {
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
  // ADR-0020: the resource the reading-project dialog is open for, if any.
  const [readingTarget, setReadingTarget] = useState<string | null>(null)

  const openReading = useCallback((resourcePath: string): void => {
    setReadingTarget(resourcePath)
  }, [])

  // The 领域 the KB holds, for the reading prompt to match against.
  const knownAreas = useCallback(async (): Promise<readonly string[]> => {
    const sections = await workspace()
    return sections.find(section => section.id === 'areas')?.files.map(file => file.name) ?? []
  }, [workspace])

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

  // ADR-0017: editing belongs to Obsidian, so this only hands the file over.
  // Without a root we still open the KB-relative path and let the host resolve
  // it — the desktop's `.md` handler is usually Obsidian anyway.
  const openInObsidian = useCallback((path: string): void => {
    const target = kbRoot === '' ? path : obsidianUri(kbRoot, path)
    void openExternal(target).catch((reason: unknown) => {
      console.warn('opening the file outside the workbench failed:', reason)
    })
  }, [kbRoot, openExternal])

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
      <div style={{ ...railColStyle, borderRight: '1px solid #e6e2d8' }}>
        <IntakeRail
          collapsed={!intakeOpen}
          load={intake}
          refreshKey={treeKey}
          selection={selection}
          onExpand={() => { setIntakeOpen(true) }}
          onOpenFile={openFile}
          onCloseFile={closeFile}
          loadTodos={todos}
          writeTodos={writeTodos}
          createEntity={createEntity}
          read={read}
          write={write}
          deleteFile={deleteFile}
          setRelation={setRelation}
          workspace={workspace}
          mailFetch={mailFetch}
          mailMarkRead={mailMarkRead}
          analyseMail={analyseMail}
          registerResource={registerResource}
          onCreateReading={openReading}
        />
      </div>
      <CenterPane
        tabs={tabs}
        statuses={statuses}
        onActivate={(key) => { setTabs(state => activateTab(state, key)) }}
        onClose={closeFile}
        viewMode={viewMode}
        onViewMode={setViewMode}
        renderConversation={() => renderSlot('conversation', {})}
        renderFile={tab => tab.mode === 'read'
          ? (
            <ReadOnlyFile
              path={tab.path}
              read={read}
              onCreateReading={readOnlyPath(tab.path) ? () => { openReading(tab.path) } : undefined}
            />
          )
          : (
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
                />
              </div>
            </div>
          )}
      />
      <div style={{ ...railColStyle, borderLeft: '1px solid #e6e2d8' }}>
        <WorkspaceRail
          collapsed={!workspaceOpen}
          load={workspace}
          refreshKey={treeKey}
          selection={selection}
          onExpand={() => { setWorkspaceOpen(true) }}
          onOpenFile={openFile}
          onCloseFile={closeFile}
          loadTodos={todos}
          writeTodos={writeTodos}
          createEntity={createEntity}
          read={read}
          write={write}
          deleteFile={deleteFile}
          setRelation={setRelation}
          workspace={workspace}
          mailFetch={mailFetch}
          mailMarkRead={mailMarkRead}
          analyseMail={analyseMail}
        />
      </div>
      <div style={overlayStyle}>{renderSlot('shell.overlay', {})}</div>
      {needsRoot && (
        <Onboarding setRoot={setRoot} pickDirectory={pickDirectory} onConfigured={onConfigured} />
      )}
      {readingTarget !== null && (
        <ReadingDialog
          resourcePath={readingTarget}
          createReadingProject={createReadingProject}
          extract={extractResource}
          readBook={readBook}
          knownAreas={knownAreas}
          confirmDomains={confirmDomains}
          onDone={(projectPath) => {
            setReadingTarget(null)
            setTreeKey(key => key + 1)
            openFile(projectPath, 'edit')
          }}
          onCancel={() => { setReadingTarget(null) }}
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
