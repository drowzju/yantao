/**
 * The two workbench rails (ADR-0011). Both are plain children of our own
 * frame now — real grid columns, not slot entries — so they carry the same
 * shape: fill the column when expanded, render a compact icon column when the
 * frame collapses them. Pure presentation over plain data: every fact arrives
 * as a prop and every action as a callback.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  KbCapabilitySummary, KbPersonRelation, KbTreeFile, KbTreeSection, KbTreeSectionId,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type {
  CapabilityAdopter, CapabilityCreator, CapabilityLoader, CapabilityRegistrar, EntityCreator, FileDeleter, FileReader,
  FileWriter,
  MailFetcher, MailMarker, RelationSetter, ResourceRegistrar,
  TodoLoader, TodoWriter,
} from './remote.ts'
import { matchCapabilities } from './capability-match.ts'
import type { MailAnalyser } from './mail-analysis.ts'
import { RESOURCE_DRAG_TYPE, dropPayloadOf, type RefineGesture } from './refine.ts'
import type { ProposalTarget } from './proposal-apply.ts'
import { entitiesOfTree } from './mail-apply.ts'
import { CapabilityPanel } from './CapabilityPanel.tsx'
import { MailPanel, mailRangeOf } from './MailPanel.tsx'
import type { KbCreatableEntityType } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage } from './remote.ts'
import type { TabMode } from './tabs.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import { TodoBoard } from './TodoBoard.tsx'
import { NewEntityRow } from './NewEntityRow.tsx'

/** Loads one rail's sections; rejects with a message the rail can render. */
export type TreeLoader = () => Promise<readonly KbTreeSection[]>

/** Left-rail tabs in display order; `connector` is the 能力 tab (ADR-0021). */
const INTAKE_PANEL_IDS: readonly (KbTreeSectionId | 'connector')[] = ['resources', 'todos', 'meetings', 'connector']

/** Right-rail tabs in display order. */
const WORKSPACE_TAB_IDS: readonly KbTreeSectionId[] = ['areas', 'people', 'projects']

/** The entity kind each tree section creates. `todos` is a singleton — the server refuses it. */
const ENTITY_KINDS: Partial<Record<KbTreeSectionId, KbCreatableEntityType>> = {
  meetings: 'meeting',
  areas: 'area',
  people: 'person',
  projects: 'project',
}

/**
 * The section owning one path, when this rail's tree has it. Both rails read
 * the same selection, so each answers for its own half of the KB: a rail that
 * does not own the path simply keeps its tab.
 * @param sections - the rail's loaded sections.
 * @param path - the selected KB-relative path, if any.
 * @returns the owning section's id.
 */
function sectionOf(
  sections: readonly KbTreeSection[] | null,
  path: string | null,
): KbTreeSectionId | undefined {
  if (path === null) return undefined
  return sections?.find(section => section.files.some(file => file.path === path))?.id
}

/** Panel and tab labels as dictionary keys — translated at render through the threaded `t`. */
export const SECTION_KEYS: Record<KbTreeSectionId | 'connector', WorkbenchLocaleKey> = {
  resources: 'section.resource',
  todos: 'section.todo',
  meetings: 'section.meeting',
  connector: 'section.capability',
  areas: 'section.domain',
  people: 'section.person',
  projects: 'section.project',
}

/** The person relations the KB knows, as dictionary keys — translated at render. */
export const RELATION_KEYS: Record<KbPersonRelation, WorkbenchLocaleKey> = {
  self: 'relation.self',
  subordinate: 'relation.subordinate',
  superior: 'relation.superior',
  peer: 'relation.peer',
  external: 'relation.external',
}

/** The relation a new person gets until the human says otherwise. */
const DEFAULT_RELATION: KbPersonRelation = 'peer'

/**
 * One relation as the rail reads it. The wire value is whatever the file
 * carries — a human edits these in Obsidian — so a word the KB does not know
 * is shown as written rather than dropped.
 * @param t - the workbench translate face.
 * @param relation - the frontmatter's `relation`.
 * @returns the label, or the value itself when there is no label.
 */
function relationLabel(t: WorkbenchT, relation: string): string {
  return Object.hasOwn(RELATION_KEYS, relation) ? t(RELATION_KEYS[relation as KbPersonRelation]) : relation
}

/**
 * The relations the workbench offers — every one but 自己. `self` marks the KB
 * owner, and `kb_init` is what writes it: a second person carrying it would
 * make two owners of one knowledge base, so nobody picks it from a menu.
 * @param t - the workbench translate face.
 * @returns the pickable relation options.
 */
function relationOptions(t: WorkbenchT): readonly RelationOption[] {
  return (Object.entries(RELATION_KEYS) as [KbPersonRelation, WorkbenchLocaleKey][])
    .filter(([value]) => value !== 'self')
    .map(([value, key]) => ({ value, label: t(key) }))
}

/**
 * The relations one row's menu offers. The owner — the person whose file
 * carries `relation: self` — offers none: 自己 is what makes a file the KB's
 * owner, not a label somebody can hand out or take away from a menu.
 * @param t - the workbench translate face.
 * @param relation - the relation the row's file carries.
 * @returns the pickable relations, or an empty list for the owner.
 */
function relationsFor(t: WorkbenchT, relation: string | undefined): readonly RelationOption[] {
  return relation === 'self' ? [] : relationOptions(t)
}

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

/** The expanded rail: it fills the column the frame hands it. */
const railStyle = {
  width: '100%',
  height: '100%',
  padding: 12,
  boxSizing: 'border-box',
  overflowY: 'auto',
  fontFamily: FONT,
  fontSize: 13,
} as const

/** The collapsed rail: a centered icon column. */
const compactStyle = {
  width: '100%',
  height: '100%',
  paddingTop: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: FONT,
  fontSize: 13,
} as const

const titleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

const errorStyle = { color: '#b4453a', padding: '4px 6px' } as const

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '4px 6px',
  margin: '1px 0',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
} as const

const selectedRowStyle = { ...rowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } as const

/** An entity row while a resource drag hovers over it — the drop target's affordance. */
const dropHoverStyle = { outline: '2px dashed #c7d7ff', outlineOffset: -2 } as const

const tabRowStyle = { ...rowStyle, width: 'auto', flex: 1, textAlign: 'center' } as const

/** One rail's load state: the sections it renders, the last failure, and the refresh action. */
interface RailState {
  readonly sections: readonly KbTreeSection[] | null
  readonly error: string | null
  /** Reload the tree; resolves once the new sections are in state. */
  readonly refresh: () => Promise<void>
}

/**
 * Load one rail's sections once on mount, on every refresh, and whenever the
 * frame bumps its refresh key (a new KB root, a new entity).
 * @param load - the loader the frame supplies.
 * @param refreshKey - the frame's tree-generation counter.
 * @returns the load state.
 */
function useRail(load: TreeLoader, refreshKey: number): RailState {
  const [sections, setSections] = useState<readonly KbTreeSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (it comes from the inject
  // face), so the effect reads it through a ref instead of taking it as a
  // dependency.
  const latest = useRef(load)
  latest.current = load
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSections(await latest.current())
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh, refreshKey])
  return { sections, error, refresh }
}

/** Render one file row: the selection-aware button both the flat sections and the resource tree share. */
function FileRow({
  t,
  file,
  selection,
  onSelect,
  onMenu,
  indent = 0,
  drag,
  drop,
}: {
  t: WorkbenchT
  file: KbTreeFile
  selection: string | null
  onSelect: (path: string) => void
  onMenu?: ((file: KbTreeFile, x: number, y: number) => void) | undefined
  /** Indentation level inside the resource tree; 0 for flat sections. */
  indent?: number
  /** Make the row a drag source — resource rows hand their KB path over (ADR-0029 决定 2). */
  drag?: ((file: KbTreeFile, event: React.DragEvent<HTMLButtonElement>) => void) | undefined
  /** Make the row a drop target — entity rows receive a resource drop (ADR-0029 决定 2). */
  drop?: ((file: KbTreeFile, event: React.DragEvent<HTMLButtonElement>) => void) | undefined
}): ReactElement {
  const [dropHover, setDropHover] = useState(false)
  return (
    <button
      type="button"
      style={{
        ...(selection === file.path ? selectedRowStyle : rowStyle),
        ...(dropHover ? dropHoverStyle : {}),
        paddingLeft: 6 + indent * 14,
      }}
      data-selected={selection === file.path || undefined}
      data-drop-target={drop !== undefined || undefined}
      draggable={drag !== undefined || undefined}
      onClick={() => { onSelect(file.path) }}
      onContextMenu={onMenu === undefined ? undefined : (event) => {
        event.preventDefault()
        onMenu(file, event.clientX, event.clientY)
      }}
      onDragStart={drag === undefined ? undefined : (event) => {
        event.stopPropagation()
        drag(file, event)
      }}
      onDragOver={drop === undefined ? undefined : (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDropHover(true)
      }}
      onDragLeave={drop === undefined ? undefined : (event) => {
        event.stopPropagation()
        setDropHover(false)
      }}
      onDrop={drop === undefined ? undefined : (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDropHover(false)
        drop(file, event)
      }}
      title={file.path}
    >
      {file.name}
      {file.archived === true && <span style={{ color: '#9a9488' }}>{t('workbench.archived')}</span>}
      {file.relation !== undefined && (
        <span style={{ color: '#9a9488' }}>
          {' · '}
          {relationLabel(t, file.relation)}
        </span>
      )}
    </button>
  )
}

/** Render one rail section: a heading (unless the tab strip already labels it) and its file rows. */
function Section({
  t,
  id,
  section,
  selection,
  onSelect,
  onMenu,
  showHeading = true,
  drag,
  drop,
}: {
  t: WorkbenchT
  id: KbTreeSectionId
  section: KbTreeSection | undefined
  selection: string | null
  onSelect: (path: string) => void
  /** Open the row's right-click menu; absent for a section whose rows are not the human's to drop. */
  onMenu?: ((file: KbTreeFile, x: number, y: number) => void) | undefined
  showHeading?: boolean
  /** Make every row a drag source (ADR-0029 决定 2). */
  drag?: ((file: KbTreeFile, event: React.DragEvent<HTMLButtonElement>) => void) | undefined
  /** Make every row a drop target (ADR-0029 决定 2). */
  drop?: ((file: KbTreeFile, event: React.DragEvent<HTMLButtonElement>) => void) | undefined
}): ReactElement {
  return (
    <div>
      {showHeading && <div style={titleStyle}>{t(SECTION_KEYS[id])}</div>}
      {section === undefined && <div style={{ color: '#9a9488', padding: '4px 6px' }}>{t('common.empty')}</div>}
      {section?.files.map(file => (
        <FileRow
          key={file.path}
          t={t}
          file={file}
          selection={selection}
          onSelect={onSelect}
          onMenu={onMenu}
          drag={drag}
          drop={drop}
        />
      ))}
    </div>
  )
}

/** One directory node in the resource tree: its own files and its subdirectories. */
interface ResourceDirNode {
  /** Directory path relative to `resources/` — the root level is `''`. */
  readonly dir: string
  readonly files: readonly KbTreeFile[]
  readonly children: readonly ResourceDirNode[]
}

/**
 * Group the resource section's flat file list into a directory tree (ADR-0028
 * 决定 3). Pure display: the wire already carries every file's full path, so
 * the intermediate path segments are the directories — no second source of
 * truth on the server. Directories sort by name at each level; files keep
 * the wire's walk order.
 * @param files - the resource section's files, paths under `resources/`.
 * @returns the tree's root node (the `resources/` root itself is not a row).
 */
export function groupResourceFiles(files: readonly KbTreeFile[]): ResourceDirNode {
  interface MutableDir {
    files: KbTreeFile[]
    children: Map<string, MutableDir>
  }
  const root: MutableDir = { files: [], children: new Map() }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (const segment of parts.slice(1, -1)) {
      let child = node.children.get(segment)
      if (child === undefined) {
        child = { files: [], children: new Map() }
        node.children.set(segment, child)
      }
      node = child
    }
    node.files.push(file)
  }
  const build = (dir: string, node: MutableDir): ResourceDirNode => ({
    dir,
    files: node.files,
    children: [...node.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => build(dir === '' ? name : `${dir}/${name}`, child)),
  })
  return build('', root)
}

/**
 * The 资源 tab as a collapsible tree (ADR-0028 决定 3): directory rows fold
 * their subtree, files open exactly like the flat list did. Defaults to fully
 * collapsed — directories expand on click, and a newly created directory
 * starts folded too — and the展开 state is session-only.
 * @param props - the section's files plus the shared row behaviour.
 * @returns the tree element.
 */
function ResourceTree({
  t,
  section,
  selection,
  onSelect,
  onMenu,
  drag,
}: {
  t: WorkbenchT
  section: KbTreeSection | undefined
  selection: string | null
  onSelect: (path: string) => void
  onMenu: (file: KbTreeFile, x: number, y: number) => void
  /** Make every resource row a drag source (ADR-0029 决定 2's 归入). */
  drag: (file: KbTreeFile, event: React.DragEvent<HTMLButtonElement>) => void
}): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((dir: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])
  if (section === undefined) {
    return <div style={{ color: '#9a9488', padding: '4px 6px' }}>{t('common.empty')}</div>
  }
  const renderNode = (node: ResourceDirNode, depth: number): ReactElement[] => {
    const rows: ReactElement[] = []
    for (const child of node.children) {
      const folded = !expanded.has(child.dir)
      rows.push(
        <button
          key={`dir:${child.dir}`}
          type="button"
          style={{ ...rowStyle, paddingLeft: 6 + depth * 14, color: '#6b6455' }}
          data-resource-dir={child.dir}
          aria-expanded={!folded}
          onClick={() => { toggle(child.dir) }}
        >
          {folded ? '▸' : '▾'} {child.dir}
        </button>,
      )
      if (!folded) rows.push(...renderNode(child, depth + 1))
    }
    for (const file of node.files) {
      // Inside a directory the folder rows already give the path context, so
      // the row shows the file's own name — the wire name for a nested file
      // is its path below `resources/`, and the directory prefix repeats it.
      const name = node.dir !== '' && file.name.startsWith(`${node.dir}/`)
        ? file.name.slice(node.dir.length + 1)
        : file.name
      rows.push(
        <FileRow
          key={file.path}
          t={t}
          file={{ ...file, name }}
          selection={selection}
          onSelect={onSelect}
          onMenu={onMenu}
          drag={drag}
          indent={depth}
        />,
      )
    }
    return rows
  }
  return <div>{renderNode(groupResourceFiles(section.files), 0)}</div>
}

/** One row's right-click menu: the row it belongs to and where it opens. */
interface MenuTarget {
  readonly path: string
  readonly name: string
  /** The person's relation as the file carries it, so the menu can tick it. */
  readonly relation?: string
  readonly x: number
  readonly y: number
}

const menuStyle = {
  position: 'fixed',
  zIndex: 40,
  padding: 4,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 4,
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontFamily: FONT,
  fontSize: 13,
} as const

const menuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '3px 8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const menuNoteStyle = { color: '#6b6455', padding: '2px 8px 4px' } as const

/** One relation the row menu offers. */
interface RelationOption {
  readonly value: KbPersonRelation
  readonly label: string
}

/**
 * The row menu: a person's relations, each set the moment it is picked, and
 * 删除 below, which asks once before the file goes. Escape or a click anywhere
 * else dismisses it; the `mousedown` that opened it has already been
 * dispatched, so it cannot close itself the moment it appears.
 *
 * `relations` is the whole story the rail tells about the row: absent for a
 * row that has no relation at all, empty for the KB's owner (whose relation is
 * not the workbench's to change), and the four pickable ones otherwise.
 * @param props - the targeted row, the busy flag, and the actions.
 * @returns the menu element.
 */
function RowMenu(props: {
  t: WorkbenchT
  target: MenuTarget
  busy: boolean
  /** The relations this row offers, when it is a person's. */
  relations?: readonly RelationOption[] | undefined
  /** Write the row's relation; only a person row offers one. */
  onRelate?: ((path: string, relation: KbPersonRelation) => Promise<void>) | undefined
  /** The capabilities whose `appliesTo` accepts this row (ADR-0021 决定 7). */
  capabilities?: readonly KbCapabilitySummary[] | undefined
  /** Run one of those capabilities against this row (ADR-0026 决定 4 routes the run). */
  onRunCapability?: ((capability: KbCapabilitySummary, path: string) => void) | undefined
  /** Start the 提炼 gesture on this entity row (ADR-0029 决定 2); absent for non-entity rows. */
  onRefine?: ((path: string, name: string) => void) | undefined
  onDelete: (path: string) => void
  onClose: () => void
}): ReactElement {
  const { t, target, busy, relations, onRelate, capabilities, onRunCapability, onRefine, onDelete, onClose } = props
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  return (
    <div ref={ref} style={{ ...menuStyle, left: target.x, top: target.y }} data-row-menu={target.path}>
      {relations !== undefined && (
        <div data-row-relations="true">
          <div style={menuNoteStyle}>{t('relation.label')}</div>
          {relations.length === 0 && <div style={menuNoteStyle}>{t('relation.ownerFixed')}</div>}
          {relations.map(option => (
            <button
              key={option.value}
              type="button"
              style={menuItemStyle}
              disabled={busy}
              data-relation={option.value}
              data-current={option.value === target.relation || undefined}
              onClick={() => { void onRelate?.(target.path, option.value) }}
            >
              {option.value === target.relation ? `✓ ${option.label}` : option.label}
            </button>
          ))}
        </div>
      )}
      {capabilities !== undefined && capabilities.length > 0 && onRunCapability !== undefined && (
        <div data-row-capabilities="true">
          <div style={menuNoteStyle}>{t('workbench.capabilityLabel')}</div>
          {capabilities.map(capability => (
            <button
              key={capability.name}
              type="button"
              style={menuItemStyle}
              disabled={busy}
              data-capability={capability.name}
              title={capability.description}
              onClick={() => { onClose(); onRunCapability(capability, target.path) }}
            >
              {capability.name}
            </button>
          ))}
        </div>
      )}
      {onRefine !== undefined && (
        <button
          type="button"
          style={menuItemStyle}
          disabled={busy}
          data-row-refine="true"
          onClick={() => { onClose(); onRefine(target.path, target.name) }}
        >
          {t('workbench.refine')}
        </button>
      )}
      {!confirming && (
        <button type="button" style={menuItemStyle} disabled={busy} onClick={() => { setConfirming(true) }}>
          {t('workbench.deleteConfirm', { name: target.name })}
        </button>
      )}
      {confirming && (
        <div>
          <div style={menuNoteStyle}>{t('workbench.deleteIrreversible')}</div>
          <button type="button" style={menuItemStyle} disabled={busy} onClick={() => { onDelete(target.path) }}>
            {t('workbench.delete')}
          </button>
          <button type="button" style={menuItemStyle} onClick={onClose}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  )
}

/** What a rail needs from its row menu: the open menu, and the actions behind it. */
interface RowMenuHost {
  readonly menu: MenuTarget | null
  /** True while a delete or a relation change is in flight. */
  readonly busy: boolean
  /** Open the menu on one row, at the pointer. */
  readonly open: (file: KbTreeFile, x: number, y: number) => void
  readonly close: () => void
  readonly remove: (path: string) => Promise<void>
  /** Write a person's relation and reload the tree. */
  readonly relate: (path: string, relation: KbPersonRelation) => Promise<void>
}

/**
 * Own one rail's row menu: opening, dismissing, and the two writes behind it.
 * A delete goes through the host and then drops the centre pane's tab; a
 * relation change only rewrites the field, so the tab stays open.
 * @param args - the write channels and the callbacks they report to.
 * @returns the menu state and its actions.
 */
function useRowMenu(args: {
  readonly deleteFile: FileDeleter
  readonly setRelation: RelationSetter
  readonly refresh: () => Promise<void>
  readonly onCloseFile: (path: string) => void
  readonly onError: (message: string) => void
}): RowMenuHost {
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [busy, setBusy] = useState(false)
  // Every callback is a fresh closure on each render (inject face), so the
  // write paths reach them through a ref.
  const latest = useRef(args)
  latest.current = args
  const remove = useCallback(async (path: string): Promise<void> => {
    setBusy(true)
    try {
      await latest.current.deleteFile(path)
      await latest.current.refresh()
      latest.current.onCloseFile(path)
      setMenu(null)
    } catch (failure: unknown) {
      latest.current.onError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])
  const relate = useCallback(async (path: string, relation: KbPersonRelation): Promise<void> => {
    setBusy(true)
    try {
      await latest.current.setRelation(path, relation)
      await latest.current.refresh()
      setMenu(null)
    } catch (failure: unknown) {
      latest.current.onError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])
  const open = useCallback((file: KbTreeFile, x: number, y: number): void => {
    setMenu({
      path: file.path,
      name: file.name,
      ...file.relation !== undefined ? { relation: file.relation } : {},
      x,
      y,
    })
  }, [])
  const close = useCallback((): void => { setMenu(null) }, [])
  return { menu, busy, open, close, remove, relate }
}

/**
 * The registered capabilities, reloaded once per tree generation: the row
 * menus' 能力 group filters this list against the row (ADR-0021 决定 7). A
 * failed load leaves the menus without the group — the 能力 tab is where a
 * failure shows.
 * @param load - the capability loader the frame supplies.
 * @param refreshKey - the frame's tree-generation counter.
 * @returns the registered capabilities.
 */
function useCapabilities(load: CapabilityLoader, refreshKey: number): readonly KbCapabilitySummary[] {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[]>([])
  // Same fresh-closure discipline as useRail: the loader comes from the
  // inject face, so the effect reads it through a ref.
  const latest = useRef(load)
  latest.current = load
  useEffect(() => {
    let stale = false
    void latest.current().then((result) => {
      if (!stale) setCapabilities(result.capabilities)
    }).catch(() => {
      // The row menu simply offers nothing; the 能力 tab reports the failure.
    })
    return () => { stale = true }
  }, [refreshKey])
  return capabilities
}

/** The compact column both rails render while collapsed. */function CompactRail({
  label,
  error,
  onExpand,
  side,
}: {
  label: string
  error: string | null
  onExpand: () => void
  side: 'intake' | 'workspace'
}): ReactElement {
  return (
    <div style={compactStyle}>
      <button type="button" style={rowStyle} title={label} onClick={onExpand}>
        {side === 'intake' ? '›' : '‹'}
      </button>
      {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
    </div>
  )
}

/** Presentational props shared by both rails. */
export interface RailProps {
  /** The workbench translate face — every label this rail renders goes through it. */
  readonly t: WorkbenchT
  /** True while the frame renders this rail as a compact icon column. */
  readonly collapsed: boolean
  /** Load this rail's sections. */
  readonly load: TreeLoader
  /** The frame's tree-generation counter: a bump reloads the tree. */
  readonly refreshKey: number
  /** The KB file the centre pane shows, shared by both rails; null while 对话 is active. */
  readonly selection: string | null
  /** Ask the frame to expand this rail again. */
  readonly onExpand: () => void
  /** Open a KB file in the centre pane. */
  readonly onOpenFile: (path: string, mode: TabMode) => void
  /** Drop a KB file's centre-pane tab — the half of a delete the rail owes the frame. */
  readonly onCloseFile: (path: string) => void
  /** Read the todo singleton as structured items (ADR-0018). */
  readonly loadTodos: TodoLoader
  /** Write the todo singleton's whole item list (ADR-0018). */
  readonly writeTodos: TodoWriter
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Read one KB file's content — the connector appends notes with it (ADR-0019). */
  readonly read: FileReader
  /** Write one KB file's content (ADR-0019). */
  readonly write: FileWriter
  /** Delete one KB file — the row menu's 「删除」. */
  readonly deleteFile: FileDeleter
  /** Rewrite one person entity's relation — the row menu's 「关系」. */
  readonly setRelation: RelationSetter
  /** Load the workspace side, so the mail analysis can name what exists (ADR-0019). */
  readonly workspace: TreeLoader
  /** Read the newest mails after the connector's cursor (ADR-0019). */
  readonly mailFetch: MailFetcher
  /** Move that cursor forward (ADR-0019). */
  readonly mailMarkRead: MailMarker
  /** Run one mail analysis in a dsh session (ADR-0019). */
  readonly analyseMail: MailAnalyser
  /** Copy one dropped file into `resources/` — both rails' entity rows accept OS drops (ADR-0029 决定 2). */
  readonly registerResource: ResourceRegistrar
  /** Start one refine gesture (归入 or 提炼); the frame owns the run (ADR-0029). */
  readonly onRefine: (gesture: RefineGesture) => void
  /** List the registered capabilities (ADR-0021) — the row menus' 能力 group. */
  readonly capabilityList: CapabilityLoader
  /** Run one capability against a row (ADR-0021 决定 7); the frame owns the run. */
  readonly onRunCapability: (capability: KbCapabilitySummary, path: string) => void
}

/** Intake-side additions: the intake rail owns the 能力 tab (ADR-0021). */
export interface IntakeRailProps extends RailProps {
  /** Scaffold one new capability (「新建能力」). */
  readonly capabilityCreate: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly capabilityAdopt: CapabilityAdopter
  /** Register one in-KB skill by writing its sidecar in place (ADR-0025 决定 1). */
  readonly capabilityRegister: CapabilityRegistrar
}

/** The rail's error marker: it is the only thing left above the tab strip. */
function RailHeader({ error }: { error: string | null }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
    </div>
  )
}

/**
 * One entity row's drop (ADR-0029 决定 2's 归入): a library drag carries the
 * resource's KB path straight into the gesture; an OS drop registers the file
 * into `resources/` first — 「拖入入库」与「归入实体」合成一个手势 — and more
 * than one file is refused with a message (台账 #4). Every drag event stops
 * propagation at the row, so a drop on an entity never reaches the rails'
 * whole-rail registration or the conversation's composer.
 */
async function dropOnEntity(args: {
  readonly event: React.DragEvent
  readonly entity: KbTreeFile
  readonly entityType: KbCreatableEntityType
  readonly registerResource: ResourceRegistrar
  readonly onRefine: (gesture: RefineGesture) => void
  readonly onError: (message: string) => void
}): Promise<void> {
  const payload = dropPayloadOf(args.event.dataTransfer)
  if (payload === null) return
  if (payload.kind === 'resource') {
    args.onRefine({
      mode: 'intake',
      entityPath: args.entity.path,
      entityName: args.entity.name,
      entityType: args.entityType,
      resource: { path: payload.path, name: payload.path.split('/').pop() ?? payload.path },
    })
    return
  }
  if (payload.files.length > 1) {
    args.onError('一次只归入一个文件。')
    return
  }
  const file = payload.files[0]
  if (file === undefined) return
  try {
    const path = await args.registerResource(file.name, await fileToBase64(file))
    args.onRefine({
      mode: 'intake',
      entityPath: args.entity.path,
      entityName: args.entity.name,
      entityType: args.entityType,
      resource: { path, name: file.name },
    })
  } catch (failure: unknown) {
    args.onError(`${file.name}：${remoteMessage(failure)}`)
  }
}

/**
 * The intake rail: 资源 / 待办 / 会议 / 能力 as tabs. 待办 renders the
 * singleton as a TODO / DONE board inline (ADR-0018); 会议 can create a
 * meeting inline; 资源 rows open read-only; 能力 lists the registered
 * capabilities (ADR-0021), the mail one embedding the connector panel.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function IntakeRail(props: IntakeRailProps): ReactElement {
  const {
    t, collapsed, load, refreshKey, selection, onExpand, onOpenFile, onCloseFile, loadTodos, writeTodos, createEntity,
    read, write, deleteFile, setRelation, workspace, mailFetch, mailMarkRead, analyseMail, registerResource, onRefine,
    capabilityList, capabilityCreate, capabilityAdopt, capabilityRegister, onRunCapability,
  } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const capabilities = useCapabilities(capabilityList, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId | 'connector'>('resources')
  const [actionError, setActionError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropping, setDropping] = useState(false)
  const rowMenu = useRowMenu({ deleteFile, setRelation, refresh, onCloseFile, onError: setActionError })
  // Reveal a selection this rail owns: the tab carrying the file comes to the
  // front, so the highlighted row is a visible one. A selection owned by the
  // other rail leaves the human's own tab choice alone. Only a *new*
  // selection reveals: the effect re-runs after every tree reload too (a
  // relation write, a revision poll), and re-revealing then would yank the
  // tab back from the one the human has since chosen.
  const revealedFor = useRef<string | null>(null)
  useEffect(() => {
    if (revealedFor.current === selection) return
    const owner = sectionOf(sections, selection)
    if (owner === undefined) return
    revealedFor.current = selection
    setTab(owner)
  }, [sections, selection])

  if (collapsed) {
    return (
      <CompactRail label={t('workbench.expandIntake')} error={error} onExpand={onExpand} side="intake" />
    )
  }

  /** Create an entity of this section's kind, reload the tree, and open it. */
  const create = async (kind: KbCreatableEntityType, name: string): Promise<void> => {
    const path = await createEntity(kind, name)
    await refresh()
    onOpenFile(path, 'edit')
  }

  // ADR-0019: the writes a confirmed proposal lands on (mail's share of it).
  const mailTarget: ProposalTarget = {
    createEntity, read, write, todos: loadTodos, writeTodos,
  }

  // ADR-0020: dropping files onto the rail registers them — a pure copy into
  // `resources/`, one file at a time, failures reported per file while the
  // rest still land. Every drag event stops propagation here: the
  // conversation's attachment composer listens at the document level, and a
  // drag over a rail is not a drag into the conversation — only an explicit
  // drop on the middle column is.
  const onDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    setDropping(true)
    const failures: string[] = []
    try {
      for (const file of files) {
        try {
          await registerResource(file.name, await fileToBase64(file))
        } catch (failure: unknown) {
          failures.push(`${file.name}：${remoteMessage(failure)}`)
        }
      }
      setTab('resources')
      await refresh()
    } finally {
      setDropping(false)
    }
    if (failures.length > 0) setActionError(failures.join('；'))
  }

  return (
    <div
      style={dragOver ? { ...railStyle, outline: '2px dashed #c7d7ff', outlineOffset: -4 } : railStyle}
      data-drag-over={dragOver || undefined}
      onDragEnter={(event) => { event.stopPropagation() }}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        event.stopPropagation()
        setDragOver(false)
      }}
      onDrop={(event) => { void onDrop(event) }}
    >
      <RailHeader error={error} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {INTAKE_PANEL_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {t(SECTION_KEYS[id])}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      {tab === 'todos' && (
        <TodoBoard
          t={t}
          load={loadTodos}
          write={writeTodos}
          refreshKey={refreshKey}
          onOpenFile={(path) => { onOpenFile(path, 'edit') }}
        />
      )}
      {tab === 'connector' && (
        <CapabilityPanel
          t={t}
          load={capabilityList}
          create={capabilityCreate}
          adopt={capabilityAdopt}
          register={capabilityRegister}
          mail={state => (
            <MailPanel
              t={t}
              fetch={mailFetch}
              mark={mailMarkRead}
              analyse={analyseMail}
              target={mailTarget}
              entities={async () => entitiesOfTree(await workspace())}
              processed={mailRangeOf(state)}
            />
          )}
        />
      )}
      {tab === 'resources' && (
        <ResourceTree
          t={t}
          section={sections?.find(entry => entry.id === 'resources')}
          selection={selection}
          // An original opens read-only; a `.md` note is ours to edit.
          onSelect={(path) => { onOpenFile(path, path.endsWith('.md') ? 'edit' : 'read') }}
          onMenu={rowMenu.open}
          // ADR-0029 决定 2: a resource row is a drag source — dropping it on
          // an entity row starts the 归入 gesture.
          drag={(file, event) => { event.dataTransfer.setData(RESOURCE_DRAG_TYPE, file.path) }}
        />
      )}
      {tab === 'meetings' && (
        <Section
          t={t}
          id="meetings"
          section={sections?.find(entry => entry.id === 'meetings')}
          selection={selection}
          onSelect={(path) => { onOpenFile(path, path.endsWith('.md') ? 'edit' : 'read') }}
          onMenu={rowMenu.open}
          showHeading={false}
          drop={(file, event) => {
            void dropOnEntity({ event, entity: file, entityType: 'meeting', registerResource, onRefine, onError: setActionError })
          }}
        />
      )}
      {tab === 'meetings' && (
        <NewEntityRow
          t={t}
          label={t('workbench.newButton')}
          placeholder={t('workbench.meetingPlaceholder')}
          submit={name => create('meeting', name).catch((failure: unknown) => {
            setActionError(failure instanceof Error ? failure.message : String(failure))
          })}
        />
      )}
      {rowMenu.menu !== null && (
        <RowMenu
          key={rowMenu.menu.path}
          t={t}
          target={rowMenu.menu}
          busy={rowMenu.busy || dropping}
          capabilities={tab === 'resources'
            ? matchCapabilities(capabilities, { kind: 'resource', path: rowMenu.menu.path })
            : tab === 'meetings'
              ? matchCapabilities(capabilities, { kind: 'entity', path: rowMenu.menu.path, entityType: 'meeting' })
              : undefined}
          onRunCapability={onRunCapability}
          onRefine={tab === 'meetings'
            ? (path, name) => { onRefine({ mode: 'refine', entityPath: path, entityName: name, entityType: 'meeting' }) }
            : undefined}
          onDelete={(path) => { void rowMenu.remove(path) }}
          onClose={rowMenu.close}
        />
      )}
    </div>
  )
}

/**
 * The workspace rail: 领域 / 人物 / 项目 as tabs, each able to create its own
 * kind inline and open its entities as editable tabs.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function WorkspaceRail(props: RailProps): ReactElement {
  const {
    t, collapsed, load, refreshKey, selection, onExpand, onOpenFile, onCloseFile, createEntity, deleteFile,
    setRelation: writeRelation, registerResource, onRefine, capabilityList, onRunCapability,
  } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const capabilities = useCapabilities(capabilityList, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  const [actionError, setActionError] = useState<string | null>(null)
  /** The relation a new person gets; 同事 unless the human picks another. */
  const [relation, setRelation] = useState<KbPersonRelation>(DEFAULT_RELATION)
  const rowMenu = useRowMenu({ deleteFile, setRelation: writeRelation, refresh, onCloseFile, onError: setActionError })
  // Same reveal as the intake rail: a selection this rail owns pulls its tab
  // forward, one it does not own is left to the other rail — and only a *new*
  // selection reveals, so a tree reload cannot yank the tab back.
  const revealedFor = useRef<string | null>(null)
  useEffect(() => {
    if (revealedFor.current === selection) return
    const owner = sectionOf(sections, selection)
    if (owner === undefined) return
    revealedFor.current = selection
    setTab(owner)
  }, [sections, selection])

  if (collapsed) {
    return (
      <CompactRail label={t('workbench.expandWorkspace')} error={error} onExpand={onExpand} side="workspace" />
    )
  }

  const kind = ENTITY_KINDS[tab]
  /** Create an entity of this tab's kind, reload the tree, and open it. */
  const create = async (name: string): Promise<void> => {
    if (kind === undefined) return
    // Only a person carries a relation, and only a person is asked for one.
    const path = await createEntity(kind, name, kind === 'person' ? relation : undefined)
    await refresh()
    onOpenFile(path, 'edit')
  }

  return (
    <div
      style={railStyle}
      // Same separation as the intake rail: a file drag over this rail never
      // reaches the conversation's document-level drop target. The rail
      // itself accepts no drop — only its entity rows do (ADR-0029 决定 2).
      onDragEnter={(event) => { event.stopPropagation() }}
      onDragOver={(event) => { event.stopPropagation() }}
      onDragLeave={(event) => { event.stopPropagation() }}
    >
      <RailHeader error={error} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WORKSPACE_TAB_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {t(SECTION_KEYS[id])}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      <Section
        t={t}
        id={tab}
        section={sections?.find(entry => entry.id === tab)}
        selection={selection}
        onSelect={(path) => { onOpenFile(path, 'edit') }}
        onMenu={rowMenu.open}
        showHeading={false}
        // ADR-0029 决定 2: every workspace entity row is a drop target — a
        // resource (library drag or OS drop) starts the 归入 gesture.
        drop={kind === undefined ? undefined : (file, event) => {
          void dropOnEntity({ event, entity: file, entityType: kind, registerResource, onRefine, onError: setActionError })
        }}
      />
      <NewEntityRow
        t={t}
        label={t('workbench.newButton')}
        placeholder={t('workbench.entityNamePlaceholder', { section: t(SECTION_KEYS[tab]) })}
        choice={kind === 'person' ? {
          options: relationOptions(t),
          value: relation,
          onChange: (value) => { setRelation(value as KbPersonRelation) },
        } : undefined}
        submit={name => create(name).catch((failure: unknown) => {
          setActionError(failure instanceof Error ? failure.message : String(failure))
        })}
      />
      {rowMenu.menu !== null && (
        <RowMenu
          key={rowMenu.menu.path}
          t={t}
          target={rowMenu.menu}
          busy={rowMenu.busy}
          relations={tab === 'people' ? relationsFor(t, rowMenu.menu.relation) : undefined}
          onRelate={rowMenu.relate}
          capabilities={kind === undefined
            ? undefined
            : matchCapabilities(capabilities, { kind: 'entity', path: rowMenu.menu.path, entityType: kind })}
          onRunCapability={onRunCapability}
          onRefine={kind === undefined
            ? undefined
            : (path, name) => { onRefine({ mode: 'refine', entityPath: path, entityName: name, entityType: kind }) }}
          onDelete={(path) => { void rowMenu.remove(path) }}
          onClose={rowMenu.close}
        />
      )}
    </div>
  )
}

/**
 * One dropped file's bytes as base64. `FileReader` encodes natively, off the
 * main thread — a book-sized file must not freeze the workbench the way a
 * `btoa` loop over its every byte would.
 * @param file - the dropped file.
 * @returns the base64 text.
 */
function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('无法读取拖入的文件。'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = (): void => {
      reject(reader.error ?? new Error('无法读取拖入的文件。'))
    }
    reader.readAsDataURL(file)
  })
}
