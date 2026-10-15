/**
 * The two workbench rails (ADR-0011). Both are plain children of our own
 * frame now — real grid columns, not slot entries — so they carry the same
 * shape: fill the column when expanded, render a compact icon column when the
 * frame collapses them. Pure presentation over plain data: every fact arrives
 * as a prop and every action as a callback.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  KbCapabilitySummary, KbPersonRelation, KbTreeFile, KbTreeSection, KbTreeSectionId,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type {
  CapabilityAdopter, CapabilityCreator, CapabilityLoader, CapabilityRegistrar, CapabilityRouteUpdater,
  CapabilityUnregisterer,
  EntityArchiver, EntityCreator, EntityResolver, FileReader,
  FileWriter,
  MailDeleter, MailFetcher, MailMarker, MemoryAdder, MemoryDeleter, MemoryLister,
  PromptShortcutLister,
  PromptShortcutSaver, RelationSetter, ResourceDeleter, ResourceRegistrar, ShortcutFiller,
  TodoLoader, TodoWriter, Archiver,
  WorkspaceLister, WorkspaceRunner, WorkspaceRunDeleter, WorkspaceRunsClearer, WorkspaceRunsLister, WorkspaceRunStopper, WorkspaceSaver,
} from './remote.ts'
import { matchCapabilities } from './capability-match.ts'
import { useFloatingMenu } from './menu-behavior.ts'
import type { MailAnalyser } from './mail-analysis.ts'
import { RESOURCE_DRAG_TYPE, dropPayloadOf, type RefineGesture } from './refine.ts'
import type { ProposalTarget } from './proposal-apply.ts'
import { entitiesOfTree } from './mail-apply.ts'
import { CapabilityPanel } from './CapabilityPanel.tsx'
import { MailPanel, mailRangeOf } from './MailPanel.tsx'
import { ShengDePanel } from './ShengDePanel.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { createMailRun, useMailRun, type MailRunStore } from './mail-run.ts'
import type { KbCreatableEntityType } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage } from './remote.ts'
import { type TabMode, WORKSPACE_RUN_LOG_PATH } from './tabs.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import { ghostButtonStyle, raisedButtonStyle, tabItemActiveStyle, tabItemStyle } from './buttons.ts'
import { NewEntityRow } from './NewEntityRow.tsx'
import type { ValidateScope } from './validate.ts'

/** Loads one rail's sections; rejects with a message the rail can render. */
export type TreeLoader = () => Promise<readonly KbTreeSection[]>

/** Left-rail tabs in display order; `shengde` is the merged 待办+记忆 tab
    (2026-10-11 整合), `connector` is the 能力 tab (ADR-0021), `workspace` the
    工作空间 one (ADR-0056) — beside the 能力 tab, per the ADR's rail placement. */
type IntakeTabId = KbTreeSectionId | 'connector' | 'memory' | 'workspace' | 'shengde'
const INTAKE_PANEL_IDS: readonly IntakeTabId[] = [
  'resources', 'shengde', 'workspace', 'connector',
]

/** Right-rail tabs in display order. */
const WORKSPACE_TAB_IDS: readonly KbTreeSectionId[] = ['areas', 'people', 'projects', 'meetings']

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
export const SECTION_KEYS: Record<KbTreeSectionId | 'connector' | 'memory' | 'workspace' | 'shengde', WorkbenchLocaleKey> = {
  resources: 'section.resource',
  todos: 'section.todo',
  meetings: 'section.meeting',
  connector: 'section.capability',
  memory: 'section.memory',
  workspace: 'section.workspace',
  shengde: 'section.shengde',
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

const FONT = 'var(--yt-font-ui)'

/** The expanded rail: it fills the column the frame hands it. A flex column —
    the tab strip stays pinned while only the content beneath it scrolls
    (2026-10-09: the whole rail used to scroll, sweeping the tabs away).
    顶内边距与中栏页签条一致（space-1，2026-10-12 截图评审）：三栏页签
    同高同顶，不再左右低一截。 */
const railStyle = {
  width: '100%',
  height: '100%',
  padding: 'var(--yt-space-1) var(--yt-space-3) var(--yt-space-3)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

/** The rail's scrollable body: everything beneath the tab strip. */
const railScrollStyle = { flex: 1, minHeight: 0, overflowY: 'auto' } as const

/** The collapsed rail: a centered icon column. */
const compactStyle = {
  width: '100%',
  height: '100%',
  paddingTop: 'var(--yt-space-1)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--yt-space-1)',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const titleStyle = { margin: 'var(--yt-space-3) 0 var(--yt-space-1)', fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-secondary)' } as const

// 错误行（2026-10-05 第三轮评审 P2#6）：正文字号 + role=alert——12px 彩字
// 视觉上近乎隐形，读屏则整段错过写失败。
const errorStyle = { color: 'var(--yt-error)', padding: 'var(--yt-space-1) var(--yt-space-2)', fontSize: 'var(--yt-type-body)' } as const

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  // 侧边距 ≥8px（2026-10-05 命中目标修订）：检测器实测 6px 挤掉了文本
  // 呼吸空间（cramped-padding），行也是左栏的主点击面。
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  margin: 0,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  // 行一律单行省略（2026-10-12 截图评审）：长文件名三折行把资源树撑得
  // 无法扫读；完整路径一直在行的 title 里。
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const

const selectedRowStyle = { ...rowStyle, background: 'var(--yt-accent-bg)', borderColor: 'var(--yt-accent-border)' } as const

/** An entity row while a resource drag hovers over it — the drop target's affordance. */
const dropHoverStyle = { outline: '2px dashed var(--yt-accent-border)', outlineOffset: -2 } as const

/** 资源树每层缩进量：层级是结构信息，不占间距阶梯的档位。 */
const RESOURCE_INDENT_PX = 14

/** 两栏共用的页签条容器：页签本体走 buttons.ts 的 tabItem 面
    （2026-10-12 起三栏同构）。 */
const railTabStripStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 'var(--yt-space-1)',
  marginBottom: 'var(--yt-space-2)',
} as const

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
  leaf = false,
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
  /** 资源树的叶子标记（2026-10-12 截图评审）：目录行有 ▸/▾，文件行此前
      一无所有，根层文件与目录混排只能靠猜。弱墨圆点与目录的三角成对。 */
  leaf?: boolean
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
        // 缩进必须走 calc：字符串拼接 'var(--yt-space-2)28' 是非法 CSS，
        // 浏览器静默丢弃——整棵树曾因此视觉全平（2026-10-12 评审 P1-3）。
        paddingLeft: `calc(var(--yt-space-2) + ${indent * RESOURCE_INDENT_PX}px)`,
      }}
      data-selected={selection === file.path || undefined}
      data-drop-target={drop !== undefined || undefined}
      data-hover="true"
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
      {file.relation === undefined ? (
        <>
          {leaf && <span aria-hidden="true" style={{ color: 'var(--yt-text-muted)' }}>• </span>}
          {file.name}
          {file.archived === true && <span style={{ color: 'var(--yt-text-muted)' }}>{t('workbench.archived')}</span>}
        </>
      ) : (
        // A person's relation is a tag, not a ` · ` tail (DESIGN.md §7): it
        // pins to the row's right edge as a small muted label.
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--yt-space-2)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {file.name}
            {file.archived === true && <span style={{ color: 'var(--yt-text-muted)' }}>{t('workbench.archived')}</span>}
          </span>
          <span style={{ color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', flexShrink: 0 }}>
            {relationLabel(t, file.relation)}
          </span>
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
  // ADR-0041 决定 7: archived entities stay inside their own type's section,
  // folded into a 归档 group at its bottom — collapsed by default, and the
  // fold is session-only, like the resource tree's directories.
  const [archiveOpen, setArchiveOpen] = useState(false)
  const active = section?.files.filter(file => file.archived !== true) ?? []
  const archived = section?.files.filter(file => file.archived === true) ?? []
  return (
    <div>
      {showHeading && <div style={titleStyle}>{t(SECTION_KEYS[id])}</div>}
      {section === undefined && <div style={{ color: 'var(--yt-text-muted)', padding: 'var(--yt-space-1) var(--yt-space-1)' }}>{t('common.empty')}</div>}
      {active.map(file => (
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
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            style={{ ...rowStyle, color: 'var(--yt-text-secondary)' }}
            data-archive-group={id}
            data-hover="true"
            aria-expanded={archiveOpen}
            onClick={() => { setArchiveOpen(open => !open) }}
          >
            {archiveOpen ? '▾' : '▸'} {t('workbench.archiveGroup')}（{archived.length}）
          </button>
          {archiveOpen && archived.map(file => (
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
      )}
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
  onDirMenu,
  drag,
}: {
  t: WorkbenchT
  section: KbTreeSection | undefined
  selection: string | null
  onSelect: (path: string) => void
  onMenu: (file: KbTreeFile, x: number, y: number) => void
  /** Open the directory row's right-click menu (ADR-0030's 目录级提炼到实体). */
  onDirMenu: (dir: string, x: number, y: number) => void
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
    return <div style={{ color: 'var(--yt-text-muted)', padding: 'var(--yt-space-1) var(--yt-space-1)' }}>{t('common.empty')}</div>
  }
  const renderNode = (node: ResourceDirNode, depth: number): ReactElement[] => {
    const rows: ReactElement[] = []
    for (const child of node.children) {
      const folded = !expanded.has(child.dir)
      // Like the file rows below, the label carries only the directory's own
      // segment — the indentation already gives the path context, and the
      // full path stays on data-resource-dir for the menu and the tests.
      const segment = child.dir.slice(child.dir.lastIndexOf('/') + 1)
      rows.push(
        <button data-hover="true"
          key={`dir:${child.dir}`}
          type="button"
          style={{ ...rowStyle, paddingLeft: `calc(var(--yt-space-2) + ${depth * RESOURCE_INDENT_PX}px)`, color: 'var(--yt-text-secondary)' }}
          data-resource-dir={child.dir}
          aria-expanded={!folded}
          onClick={() => { toggle(child.dir) }}
          onContextMenu={(event) => {
            event.preventDefault()
            onDirMenu(child.dir, event.clientX, event.clientY)
          }}
        >
          {folded ? '▸' : '▾'} {segment}
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
          leaf
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
  /** Present (and true) when the row's entity is archived — the menu offers 还原. */
  readonly archived?: boolean
  readonly x: number
  readonly y: number
}

const menuStyle = {
  position: 'fixed',
  zIndex: 40,
  padding: 'var(--yt-space-1)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  boxShadow: 'var(--yt-shadow-menu)',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const menuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const menuNoteStyle = { color: 'var(--yt-text-secondary)', padding: 'var(--yt-space-1) var(--yt-space-2) var(--yt-space-1)' } as const

/** 2026-10-09 第二轮评审 P2-C：关系/能力/手势/删除区之间的分隔线，替代
 * 此前只靠小字注头的分组方式——武装后的删除项不再与「拷贝链接」浑然一体。 */
const menuDividerStyle = { borderTop: '1px solid var(--yt-border-subtle)' } as const

/** One relation the row menu offers. */
interface RelationOption {
  readonly value: KbPersonRelation
  readonly label: string
}

/**
 * One file's absolute path on disk, forward slashes throughout — the form the
 * human can paste into Explorer, Obsidian or a chat. The KB root is trimmed of
 * its trailing separator and joined with the KB-relative path; with the root
 * unknown the relative path is all there is (the Obsidian button's fallback).
 * @param root - the absolute KB root, or '' when unknown.
 * @param path - KB-relative path with forward slashes.
 * @returns the path to put on the clipboard.
 */
export function absoluteKbPath(root: string, path: string): string {
  if (root === '') return path
  return `${root.replace(/[\\/]+$/, '')}/${path}`.replace(/\\/g, '/')
}

/**
 * Put one string on the clipboard. The workbench runs in the desktop shell's
 * renderer over loopback HTTP — a secure context, so the async clipboard API
 * is always there and no deprecated fallback is needed.
 * @param text - the string to copy.
 */
async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/**
 * The row menu: a person's relations, each set the moment it is picked; the
 * entity gestures (能力, 提炼, 归档/还原); and 拷贝链接. Keyboard users land
 * on the first item and walk with the arrows; Escape or a click anywhere
 * else dismisses it; the `mousedown` that opened it has already been
 * dispatched, so it cannot close itself the moment it appears.
 *
 * `relations` is the whole story the rail tells about the row: absent for a
 * row that has no relation at all, empty for the KB's owner (whose relation is
 * not the workbench's to change), and the four pickable ones otherwise.
 * `onArchive` is present only for entity rows (ADR-0041 决定 7): 归档 on an
 * active entity, 还原 on an archived one — no confirmation, the flip is
 * zero-cost reversible (决定 6). Entities are never deleted (决定 8), so the
 * menu's delete item is reserved for resource rows (ADR-0020): `onDelete` is
 * present only there, and the item arms through one confirm click — the first
 * tap reads 确认删除？, the second executes. The component remounts per row
 * (`key={menu.path}`), so the armed state never survives a dismissal.
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
  /** Start the 提炼到实体 gesture on this resource row (ADR-0030); absent for non-resource rows. */
  onDistill?: ((path: string, name: string) => void) | undefined
  /** The absolute KB root, for 「拷贝链接」; empty or absent copies the relative path. */
  kbRoot?: string
  /** Flip the row entity's archive flag (ADR-0041 决定 7); absent for non-entity rows. */
  onArchive?: ((path: string, archived: boolean) => void) | undefined
  /** Delete this resource file (ADR-0020); absent for non-resource rows. Two clicks: arm, then execute. */
  onDelete?: ((path: string) => void) | undefined
  onClose: () => void
}): ReactElement {
  const { t, target, busy, relations, onRelate, capabilities, onRunCapability, onRefine, onDistill, kbRoot = '', onArchive, onDelete, onClose } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const position = useFloatingMenu(ref, onClose, target)
  // 提炼手势区之前是否有可见分组——分隔线只画在组与组之间，不落在菜单顶边。
  const hasLeadingGroup = relations !== undefined
    || (capabilities !== undefined && capabilities.length > 0 && onRunCapability !== undefined)

  return (
    <div ref={ref} role="menu" style={{ ...menuStyle, left: position.left, top: position.top }} data-row-menu={target.path}>
      {relations !== undefined && (
        <div data-row-relations="true">
          <div style={menuNoteStyle}>{t('relation.label')}</div>
          {relations.length === 0 && <div style={menuNoteStyle}>{t('relation.ownerFixed')}</div>}
          {relations.map(option => (
            <button data-hover="true"
              key={option.value}
              type="button"
              role="menuitem"
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
        <div data-row-capabilities="true" style={relations !== undefined ? menuDividerStyle : undefined}>
          <div style={menuNoteStyle}>{t('workbench.capabilityLabel')}</div>
          {capabilities.map(capability => (
            <button data-hover="true"
              key={capability.name}
              type="button"
              role="menuitem"
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
        <button data-hover="true"
          type="button"
          role="menuitem"
          style={hasLeadingGroup ? { ...menuItemStyle, ...menuDividerStyle } : menuItemStyle}
          disabled={busy}
          data-row-refine="true"
          onClick={() => { onClose(); onRefine(target.path, target.name) }}
        >
          {t('workbench.refine')}
        </button>
      )}
      {onDistill !== undefined && (
        <button data-hover="true"
          type="button"
          role="menuitem"
          style={menuItemStyle}
          disabled={busy}
          data-row-distill="true"
          onClick={() => { onClose(); onDistill(target.path, target.name) }}
        >
          {t('workbench.distill')}
        </button>
      )}
      <button data-hover="true"
        type="button"
        style={menuItemStyle}
        data-row-copy-link="true"
        onClick={() => {
          void copyText(absoluteKbPath(kbRoot, target.path))
          onClose()
        }}
      >
        {t('workbench.copyLink')}
      </button>
      {onArchive !== undefined && (
        <button data-hover="true"
          type="button"
          role="menuitem"
          style={menuItemStyle}
          disabled={busy}
          data-row-archive="true"
          onClick={() => { onArchive(target.path, target.archived !== true) }}
        >
          {target.archived === true ? t('workbench.restore') : t('workbench.archive')}
        </button>
      )}
      {onDelete !== undefined && (
        <button data-hover="true"
          type="button"
          role="menuitem"
          style={{ ...menuItemStyle, ...menuDividerStyle, ...(deleteArmed ? { color: 'var(--yt-error)' } : {}) }}
          disabled={busy}
          data-row-delete="true"
          data-armed={deleteArmed || undefined}
          onClick={() => {
            if (!deleteArmed) {
              setDeleteArmed(true)
              return
            }
            onClose()
            onDelete(target.path)
          }}
        >
          {deleteArmed ? t('workbench.deleteArm') : t('workbench.delete')}
        </button>
      )}
    </div>
  )
}

/**
 * The resource directory's right-click menu (ADR-0030): one item, 提炼到实体,
 * which turns the whole directory — every file under it, however nested —
 * into one distill gesture each, queued in the frame. Keyboard and dismissal
 * behave like the row menu (shared useFloatingMenu).
 * @param props - the targeted directory, the busy flag, and the actions.
 * @returns the menu element.
 */
function DirMenu(props: {
  t: WorkbenchT
  target: { readonly dir: string; readonly x: number; readonly y: number }
  busy: boolean
  onDistill: (dir: string) => void
  onClose: () => void
}): ReactElement {
  const { t, target, busy, onDistill, onClose } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const position = useFloatingMenu(ref, onClose, target)
  return (
    <div ref={ref} role="menu" style={{ ...menuStyle, left: position.left, top: position.top }} data-dir-menu={target.dir}>
      <button data-hover="true"
        type="button"
        role="menuitem"
        style={menuItemStyle}
        disabled={busy}
        data-dir-distill="true"
        onClick={() => { onClose(); onDistill(target.dir) }}
      >
        {t('workbench.distill')}
      </button>
    </div>
  )
}

/** What a rail needs from its row menu: the open menu, and the actions behind it. */
interface RowMenuHost {
  readonly menu: MenuTarget | null
  /** True while an archive flip, a relation change or a resource delete is in flight. */
  readonly busy: boolean
  /** Open the menu on one row, at the pointer. */
  readonly open: (file: KbTreeFile, x: number, y: number) => void
  readonly close: () => void
  /** Flip one entity's archive flag (`archived` is the direction) and reload the tree. */
  readonly archive: (path: string, archived: boolean) => Promise<void>
  /** Write a person's relation and reload the tree. */
  readonly relate: (path: string, relation: KbPersonRelation) => Promise<void>
  /** Delete one resource file (ADR-0020); absent when the host supplies no delete face. */
  readonly remove?: ((path: string) => Promise<void>) | undefined
}

/**
 * Own one rail's row menu: opening, dismissing, and the writes behind it.
 * An archive flip (ADR-0041 决定 7) only moves the row between the active
 * list and the section's 归档 group — the file stays, so its centre-pane tab
 * stays open; a relation change likewise only rewrites one field. A resource
 * delete (ADR-0020) removes the file outright; the frame closes the tab and
 * reloads the trees, so the menu only reports the outcome.
 * @param args - the write channels and the callbacks they report to.
 * @returns the menu state and its actions.
 */
function useRowMenu(args: {
  readonly archiveEntity: EntityArchiver
  readonly restoreEntity: EntityArchiver
  readonly setRelation: RelationSetter
  readonly deleteResource?: ResourceDeleter | undefined
  readonly refresh: () => Promise<void>
  readonly onError: (message: string) => void
}): RowMenuHost {
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [busy, setBusy] = useState(false)
  // Every callback is a fresh closure on each render (inject face), so the
  // write paths reach them through a ref.
  const latest = useRef(args)
  latest.current = args
  const archive = useCallback(async (path: string, archived: boolean): Promise<void> => {
    setBusy(true)
    try {
      // flipArchive (the shared accounting wrapper) bumps the tree key on
      // success, and both rails reload from that broadcast — refreshing here
      // too would reload the tree twice for one archive write.
      await (archived ? latest.current.archiveEntity(path) : latest.current.restoreEntity(path))
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
      ...file.archived === true ? { archived: true } : {},
      x,
      y,
    })
  }, [])
  const removeAction = useCallback(async (path: string): Promise<void> => {
    setBusy(true)
    try {
      // The frame's wrapper closes the tab and bumps the tree key on
      // success, so — like archive — no refresh here, or the tree reloads
      // twice for one delete.
      await latest.current.deleteResource?.(path)
      setMenu(null)
    } catch (failure: unknown) {
      latest.current.onError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])
  const remove = args.deleteResource === undefined ? undefined : removeAction
  const close = useCallback((): void => { setMenu(null) }, [])
  return { menu, busy, open, close, archive, relate, remove }
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
function useCapabilities(
  load: CapabilityLoader,
  refreshKey: number,
): { capabilities: readonly KbCapabilitySummary[]; error: string | null } {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[]>([])
  const [error, setError] = useState<string | null>(null)
  // Same fresh-closure discipline as useRail: the loader comes from the
  // inject face, so the effect reads it through a ref.
  const latest = useRef(load)
  latest.current = load
  useEffect(() => {
    let stale = false
    void latest.current().then((result) => {
      if (!stale) {
        setCapabilities(result.capabilities)
        setError(null)
      }
    }).catch((failure: unknown) => {
      // The row menu simply offers nothing; the failure surfaces in the
      // 能力 tab as a readable error row (2026-10-09 评审 P2：不再静默).
      if (!stale) setError(remoteMessage(failure))
    })
    return () => { stale = true }
  }, [refreshKey])
  return { capabilities, error }
}

/** The compact column both rails render while collapsed. */
function CompactRail({
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
      <button type="button" style={rowStyle} data-hover="true" title={label} onClick={onExpand}>
        {side === 'intake' ? '›' : '‹'}
      </button>
      {error !== null && (
        // The collapsed rail's error marker is itself the exit: clicking it
        // expands the rail, where the full error row waits (2026-10-09 评审
        // P2：此前只是一个 title 兜底的裸字符).
        <button
          type="button"
          style={{ ...rowStyle, width: 'auto', padding: 'var(--yt-space-1) var(--yt-space-2)', color: 'var(--yt-error)' }}
          data-hover="true"
          title={error}
          onClick={onExpand}
        >
          !
        </button>
      )}
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
  /** Archive one entity (ADR-0041 决定 7) — the entity row menu's 「归档」. */
  readonly archiveEntity: EntityArchiver
  /** Restore one archived entity (ADR-0041 决定 7) — the archived row menu's 「还原」. */
  readonly restoreEntity: EntityArchiver
  /** Resolve one entity locator (`type:name` or path) to its KB-relative path — the proposal applier's normalization. */
  readonly resolveEntity: EntityResolver
  /** Rewrite one person entity's relation — the row menu's 「关系」. */
  readonly setRelation: RelationSetter
  /** Load the workspace side, so the mail analysis can name what exists (ADR-0019). */
  readonly workspace: TreeLoader
  /** Read the newest mails after the connector's cursor (ADR-0019). */
  readonly mailFetch: MailFetcher
  /** Move that cursor forward (ADR-0019). */
  readonly mailMarkRead: MailMarker
  /**
   * Swing the deletion knife (ADR-0034 决定 5) — optional, so embedders
   * without the face (tests, the frame's own targets) render delete-mails
   * rows that skip honestly instead of executing unseen.
   */
  readonly mailDelete?: MailDeleter
  /**
   * Archive nominated mails as .eml originals into resources/ (ADR-0037) —
   * optional, same honest-skip contract as mailDelete for embedders
   * without the face.
   */
  readonly mailArchive?: Archiver
  /** Run one mail analysis in a dsh session (ADR-0019). */
  readonly analyseMail: MailAnalyser
  /** Copy one dropped file into `resources/` — both rails' entity rows accept OS drops (ADR-0029 决定 2). */
  readonly registerResource: ResourceRegistrar
  /**
   * Delete one resource file under `resources/` (ADR-0020) — the resource row
   * menu's right-click 「删除」, armed with a confirm click. Optional: only
   * the intake rail deals in resources, so embedders without the face (tests,
   * the workspace rail) simply never see the item.
   */
  readonly deleteResource?: ResourceDeleter
  /** Start one refine gesture (归入 or 提炼); the frame owns the run (ADR-0029). */
  readonly onRefine: (gesture: RefineGesture) => void
  /**
   * Start one validate pass scoped to an entity kind (ADR-0035, 2026-09-29
   * 修订): the 人物 / 项目 tabs each carry a 校验 button beside 新建, and
   * the frame owns the run. Optional, so embedders without the face (tests)
   * still render the rail — the button simply does not appear.
   */
  readonly onValidate?: ((scope: ValidateScope) => void) | undefined
  /** List the registered capabilities (ADR-0021) — the row menus' 能力 group. */
  readonly capabilityList: CapabilityLoader
  /** Run one capability against a row (ADR-0021 决定 7); the frame owns the run. */
  readonly onRunCapability: (capability: KbCapabilitySummary, path: string) => void
  /**
   * The absolute KB root, so the row menu's 「拷贝链接」 can hand out a path
   * that works outside the workbench (Explorer, Obsidian, a chat). Empty when
   * the root is not (yet) known — the menu then copies the KB-relative path.
   */
  readonly kbRoot?: string
  /**
   * Report the rail's active tab to the frame (2026-10-15 截图评审，B 方案):
   * the frame retunes the rail's width from the tab's per-tab preference.
   * Optional — embedders without the face (tests) simply never report.
   */
  readonly onActiveTabChange?: (tabId: string) => void
}

/** Intake-side additions: the intake rail owns the 能力 tab (ADR-0021). */
export interface IntakeRailProps extends RailProps {
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
  /**
   * The frame-owned mail run store (ADR-0031): the analysis must be visible
   * to the 任务 tab, so the store outlives the rail the same way it already
   * outlived the panel. Absent (tests, other embedders) the rail makes its own.
   */
  readonly mailRun?: MailRunStore
  /**
   * Bumped by the frame when a 任务 row's 查看 asks for the connector tab:
   * any change brings 能力 to the front, and the carried capability name
   * (when there is one) is preselected inside the panel (2026-10-08).
   */
  readonly revealConnector?: { readonly nonce: number; readonly capability: string | null }
  /** List the behavior-memory scopes (ADR-0032) — the 记忆 tab's read. */
  readonly memoryList: MemoryLister
  /** Remember one behavior rule (ADR-0032) — the 记忆 tab's and the mail panel's direct write. */
  readonly memoryAdd: MemoryAdder
  /** Forget one behavior rule by id (ADR-0032) — the 记忆 tab's delete. */
  readonly memoryDelete: MemoryDeleter
  /** List the prompt shortcuts (ADR-0040) — the 能力 tab's 惯用提示词 first screen. */
  readonly promptShortcutList: PromptShortcutLister
  /** Replace the whole prompt-shortcut list (ADR-0040). */
  readonly promptShortcutSave: PromptShortcutSaver
  /** Fill the conversation's composer with `/alias ` without sending (ADR-0040 决定 5). */
  readonly fillShortcut: ShortcutFiller
  /** List the workspaces (ADR-0056) — the 工作空间 tab's read. */
  readonly workspaceList: WorkspaceLister
  /** Replace the whole workspace list (ADR-0056). */
  readonly workspaceSave: WorkspaceSaver
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
}

// 错误行的重试钮收敛到 ./buttons.ts 的幽灵面（P1-2 收敛，2026-10-12）——
// 私养的 railRetryStyle 退役。

/** The rail's error row: the load failure stays interactive — readable in
    place, with 重试 to reload (2026-10-09 评审 P2：此前是一个不可交互、正文
    藏在 title 里的"！"). 无错误时整行不渲染——此前的空壳 div 白吃 8px
    外边距，栏头页签与中栏页签的顶边因此对不齐（2026-10-12 截图评审）。 */
function RailHeader({ error, onRetry, t }: { error: string | null; onRetry: () => void; t: WorkbenchT }): ReactElement | null {
  if (error === null) return null
  return (
    <div style={{ marginBottom: 'var(--yt-space-2)' }}>
      <div style={errorStyle} role="alert" data-rail-error="true">
        <span style={{ display: 'block', marginBottom: 'var(--yt-space-1)' }}>{error}</span>
        <button type="button" style={ghostButtonStyle} data-hover="true" onClick={onRetry}>
          {t('workbench.retry')}
        </button>
      </div>
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
 * The intake rail: 资源 / 省得 / 工作空间 / 能力 as tabs. 省得 is the merged
 * 待办+记忆 tab (2026-10-11 整合): the singleton as a TODO / DONE board above
 * (ADR-0018), the memory management view below (ADR-0032); 资源 rows open
 * read-only; 能力 lists
 * the registered capabilities (ADR-0021), the mail one embedding the
 * connector panel.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function IntakeRail(props: IntakeRailProps): ReactElement {
  const {
    t, collapsed, load, refreshKey, selection, onExpand, onOpenFile, loadTodos, writeTodos, createEntity,
    read, write, archiveEntity, restoreEntity, resolveEntity, setRelation, workspace, mailFetch, mailMarkRead, analyseMail,
    registerResource, deleteResource, onRefine,
    capabilityList, capabilityCreate, capabilityAdopt, capabilityRegister, capabilityRouteUpdate, capabilityUnregister,
    onRunCapability, kbRoot = '',
    memoryList, memoryAdd, memoryDelete,
    promptShortcutList, promptShortcutSave, fillShortcut,
    workspaceList, workspaceSave, workspaceRun, workspaceRunStop, workspaceRunsList, workspaceRunsClear, workspaceRunDelete,
    onActiveTabChange,
  } = props
  const mailDelete = props.mailDelete
  const mailArchive = props.mailArchive
  const { sections, error, refresh } = useRail(load, refreshKey)
  const { capabilities, error: capabilityError } = useCapabilities(capabilityList, refreshKey)
  const [tab, setTab] = useState<IntakeTabId>('resources')
  // Report the active tab so the frame retunes the rail's width (B 方案).
  useEffect(() => { onActiveTabChange?.(tab) }, [onActiveTabChange, tab])
  // The mail run outlives the panel: tab switches, capability switches and a
  // collapsed rail all unmount MailPanel, and an analysis (or the proposal
  // card waiting on the human) must still be there when they come back.
  // ADR-0031: the store is the frame's when the frame supplies one — the
  // 任务 tab watches the same object — and the rail's own otherwise.
  const ownMailRun = useMemo(() => createMailRun(), [])
  const mailRun = props.mailRun ?? ownMailRun
  const mailState = useMailRun(mailRun)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropping, setDropping] = useState(false)
  const rowMenu = useRowMenu({ archiveEntity, restoreEntity, setRelation, deleteResource, refresh, onError: setActionError })
  // ADR-0030: the resource directory's right-click menu — one distill gesture
  // per file under the directory, however nested, handed to the frame's queue.
  const [dirMenu, setDirMenu] = useState<{ dir: string; x: number; y: number } | null>(null)
  // ADR-0031: a 任务 row's 查看 lands here — the connector tab comes to the
  // front (the frame has already re-expanded the rail), and the row's own
  // capability is preselected inside the panel (2026-10-08).
  useEffect(() => {
    if (props.revealConnector !== undefined && props.revealConnector.nonce > 0) setTab('connector')
  }, [props.revealConnector])
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
    // The todo singleton lives inside the merged 省得 tab now (2026-10-11).
    setTab(owner === 'todos' ? 'shengde' : owner)
  }, [sections, selection])

  if (collapsed) {
    return (
      <CompactRail label={t('workbench.expandIntake')} error={error} onExpand={onExpand} side="intake" />
    )
  }

  // ADR-0030: 提炼到实体 for a whole directory — every file under it,
  // however nested, becomes one distill gesture each; the frame queues them.
  const distillDir = (dir: string): void => {
    const files = sections?.find(entry => entry.id === 'resources')?.files
      .filter(file => file.path.startsWith(`resources/${dir}/`)) ?? []
    if (files.length === 0) {
      setActionError('该目录下没有资源。')
      return
    }
    for (const file of files) {
      onRefine({ mode: 'distill', resource: { path: file.path, name: file.path.split('/').pop() ?? file.name } })
    }
  }

  // ADR-0019: the writes a confirmed proposal lands on (mail's share of it).
  // ADR-0032 批次③: the card's 记忆 rows go through the same memoryAdd the
  // human's direct write uses — one seam, two authors.
  // ADR-0034 决定 5: the knife rides along when the host supplies the face —
  // the proposal card's tick is what arms it.
  const mailTarget: ProposalTarget = {
    createEntity, read, write, todos: loadTodos, writeTodos, memoryAdd,
    resolveEntity,
    ...(mailDelete !== undefined ? { deleteMails: mailDelete } : {}),
    ...(mailArchive !== undefined ? { archiveMails: mailArchive } : {}),
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
      style={dragOver ? { ...railStyle, outline: '2px dashed var(--yt-accent-border)', outlineOffset: -4 } : railStyle}
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
      <RailHeader error={error} onRetry={() => { void refresh() }} t={t} />
      <div style={railTabStripStyle}>
        {INTAKE_PANEL_IDS.map(id => (
          <button
            key={id}
            type="button"
            data-hover="true"
            /* 空串值：CSS 豁免只看属性存在性；data-selected="true" 保留给
               文件行（测试契约 workbench.client.spec.tsx:708,1491）。 */
            data-selected={tab === id ? '' : undefined}
            style={tab === id ? { ...tabItemActiveStyle, flex: 1 } : { ...tabItemStyle, flex: 1 }}
            onClick={() => { setTab(id) }}
          >
            {t(SECTION_KEYS[id])}
            {/* The recall hook: an analysis running (or a proposal card
                waiting) somewhere the human cannot currently see. */}
            {id === 'connector' && (mailState.review !== null || mailState.phase === 'analysing') && (
              <span
                // ● 是文本字符，读屏可能念「黑圆」也可能跳过——用 img 角色
                // 加可读名（2026-10-14 impeccable P2 修复）。
                role="img"
                aria-label={t(mailState.review !== null ? 'mail.tab.awaiting' : 'mail.tab.running')}
                style={{ marginLeft: 'var(--yt-space-1)', color: mailState.review !== null ? 'var(--yt-error)' : 'var(--yt-text-muted)' }}
                title={t(mailState.review !== null ? 'mail.tab.awaiting' : 'mail.tab.running')}
              >
                ●
              </span>
            )}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle} role="alert">{actionError}</div>}
      <div style={railScrollStyle}>
        {tab === 'shengde' && (
          <ShengDePanel
            t={t}
            load={loadTodos}
            write={writeTodos}
            refreshKey={refreshKey}
            onOpenFile={(path) => { onOpenFile(path, 'edit') }}
            list={memoryList}
            add={memoryAdd}
            remove={memoryDelete}
          />
        )}
        {tab === 'connector' && (
          <>
            {capabilityError !== null && (
              <div style={errorStyle} role="alert">{t('workbench.capabilityLoadFailed')}：{capabilityError}</div>
            )}
            <CapabilityPanel
              t={t}
              load={capabilityList}
              create={capabilityCreate}
              adopt={capabilityAdopt}
              register={capabilityRegister}
              updateRoute={capabilityRouteUpdate}
              unregister={capabilityUnregister}
              reveal={props.revealConnector}
              loadShortcuts={promptShortcutList}
              saveShortcuts={promptShortcutSave}
              fillShortcut={fillShortcut}
              mail={state => (
                <MailPanel
                  t={t}
                  fetch={mailFetch}
                  mark={mailMarkRead}
                  analyse={analyseMail}
                  target={mailTarget}
                  entities={async () => entitiesOfTree(await workspace())}
                  processed={mailRangeOf(state)}
                  store={mailRun}
                  memoryAdd={memoryAdd}
                />
              )}
            />
          </>
        )}
        {tab === 'workspace' && (
          <WorkspacePanel
            t={t}
            list={workspaceList}
            save={workspaceSave}
            run={workspaceRun}
            stop={workspaceRunStop}
            listRuns={workspaceRunsList}
            clearRuns={workspaceRunsClear}
            deleteRun={workspaceRunDelete}
            onOpenLog={(runId) => { onOpenFile(WORKSPACE_RUN_LOG_PATH(runId), 'read') }}
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
            // ADR-0030: a directory row's right-click opens the directory menu.
            onDirMenu={(dir, x, y) => { setDirMenu({ dir, x, y }) }}
            // ADR-0029 决定 2: a resource row is a drag source — dropping it on
            // an entity row starts the 归入 gesture.
            drag={(file, event) => { event.dataTransfer.setData(RESOURCE_DRAG_TYPE, file.path) }}
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
              : undefined}
            onRunCapability={onRunCapability}
            onDistill={tab === 'resources'
              ? (path) => { onRefine({ mode: 'distill', resource: { path, name: path.split('/').pop() ?? path } }) }
              : undefined}
            kbRoot={kbRoot}
            // ADR-0041 决定 2/8: a resource row is not an entity — no archive
            // gesture. Its own gesture is the delete (ADR-0020): resources are
            // dumb material, and the armed two-click item only shows on the
            // 资源 tab.
            onDelete={tab === 'resources' && rowMenu.remove !== undefined
              ? (path) => { void rowMenu.remove?.(path) }
              : undefined}
            onClose={rowMenu.close}
          />
        )}
        {dirMenu !== null && (
          <DirMenu
            t={t}
            target={dirMenu}
            busy={dropping}
            onDistill={distillDir}
            onClose={() => { setDirMenu(null) }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The workspace rail: 领域 / 人物 / 项目 / 会议 as tabs, each able to create
 * its own kind inline and open its entities as editable tabs.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function WorkspaceRail(props: RailProps): ReactElement {
  const {
    t, collapsed, load, refreshKey, selection, onExpand, onOpenFile, createEntity, archiveEntity, restoreEntity,
    setRelation: writeRelation, registerResource, onRefine, onValidate, capabilityList, onRunCapability, kbRoot = '',
    onActiveTabChange,
  } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  // The workspace rail's menus only consume the list; a load failure surfaces
  // in the intake rail's 能力 tab, the one place a capability failure shows.
  const { capabilities } = useCapabilities(capabilityList, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  // Report the active tab so the frame retunes the rail's width (B 方案).
  useEffect(() => { onActiveTabChange?.(tab) }, [onActiveTabChange, tab])
  const [actionError, setActionError] = useState<string | null>(null)
  /** The relation a new person gets; 同事 unless the human picks another. */
  const [relation, setRelation] = useState<KbPersonRelation>(DEFAULT_RELATION)
  const rowMenu = useRowMenu({ archiveEntity, restoreEntity, setRelation: writeRelation, refresh, onError: setActionError })
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
      <RailHeader error={error} onRetry={() => { void refresh() }} t={t} />
      <div style={railTabStripStyle}>
        {WORKSPACE_TAB_IDS.map(id => (
          <button
            key={id}
            type="button"
            data-hover="true"
            data-selected={tab === id ? '' : undefined}
            style={tab === id ? { ...tabItemActiveStyle, flex: 1 } : { ...tabItemStyle, flex: 1 }}
            onClick={() => { setTab(id) }}
          >
            {t(SECTION_KEYS[id])}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle} role="alert">{actionError}</div>}
      <div style={railScrollStyle}>
        {/* ADR-0035, 2026-09-29 修订: the validate entry lives in the two tabs
          it scopes — 人物 / 项目. It rides NewEntityRow's trailing slot, so
          新建 and 校验 hug each other instead of splitting to opposite ends
          of the row (DESIGN.md §5). */}
        {(tab === 'people' || tab === 'projects') && onValidate !== undefined && (
          <NewEntityRow
            t={t}
            label={t('workbench.newButton')}
            placeholder={t('workbench.entityNamePlaceholder', { section: t(SECTION_KEYS[tab]) })}
            choice={tab === 'people' ? {
              options: relationOptions(t),
              value: relation,
              onChange: (value) => { setRelation(value as KbPersonRelation) },
            } : undefined}
            submit={name => create(name).catch((failure: unknown) => {
              setActionError(failure instanceof Error ? failure.message : String(failure))
            })}
            trailing={(
              <button data-hover="true"
                type="button"
                style={{ ...raisedButtonStyle, marginTop: 'var(--yt-space-1)' }}
                onClick={() => { onValidate(tab === 'people' ? 'person' : 'project') }}
              >
                {t('workbench.validateButton')}
              </button>
            )}
          />
        )}
        {!(onValidate !== undefined && (tab === 'people' || tab === 'projects')) && (
          <NewEntityRow
            t={t}
            label={t('workbench.newButton')}
            placeholder={t('workbench.entityNamePlaceholder', { section: t(SECTION_KEYS[tab]) })}
            choice={tab === 'people' ? {
              options: relationOptions(t),
              value: relation,
              onChange: (value) => { setRelation(value as KbPersonRelation) },
            } : undefined}
            submit={name => create(name).catch((failure: unknown) => {
              setActionError(failure instanceof Error ? failure.message : String(failure))
            })}
          />
        )}
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
            kbRoot={kbRoot}
            onArchive={(path, archived) => { void rowMenu.archive(path, archived) }}
            onClose={rowMenu.close}
          />
        )}
      </div>
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
