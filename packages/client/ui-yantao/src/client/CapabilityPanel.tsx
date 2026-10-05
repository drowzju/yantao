/**
 * The 能力 tab (ADR-0021 决定 8; ADR-0040 reshaped its first screen). The
 * first screen is now the 惯用提示词 list: the human's saved `/alias`
 * favorites — click a row to fill the conversation's composer with the token
 * without sending, add/edit rows inline, reorder with 上移/下移. The
 * capability inventory folds beneath it: the list names every registered
 * capability — the built-in mail one plus anything the
 * human copied into `.dsh/skills/` or scaffolded through 「新建能力」. Under it
 * sits the 未注册 group (ADR-0025 决定 1): skills that are not capabilities
 * yet, greyed rows carrying their reason. Out-of-KB rows are adoption
 * candidates — an inline confirm precedes the copy; in-KB rows (missing or
 * invalid declaration) open a guided registration that writes a route entry
 * into the central routing file `.dsh/skills/yantao.json` (ADR-0025 落地注记二).
 * The mail capability's detail
 * embeds {@link MailPanel}; every other capability's detail is its manifest,
 * read-only. A script capability's detail also lists this session's runs
 * (ADR-0044 决定 6), each with a 提炼经验 button that turns the run's
 * envelope into memory proposals through a one-shot headless session.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type {
  KbCapabilityDeclarationResult, KbCapabilitySummary, KbPromptShortcut, KbUnregisteredSkill,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type {
  CapabilityAdopter, CapabilityCreator, CapabilityDeclarationLoader, CapabilityLoader, CapabilityRegistrar,
  PromptShortcutLister, PromptShortcutSaver, ShortcutFiller,
} from './remote.ts'
import type { CapabilityRunRecord } from './capability-distill.ts'
import { remoteMessage } from './remote.ts'
import { NewEntityRow } from './NewEntityRow.tsx'
import type { WorkbenchT } from './locales.ts'

/** What the panel needs from the Remote and the frame. */
export interface CapabilityPanelProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** List the registered capabilities and the 未注册 group. */
  readonly load: CapabilityLoader
  /** Read one capability's parsed declaration (ADR-0043 决定 7) — the detail view's 声明 section. */
  readonly loadDeclaration: CapabilityDeclarationLoader
  /** Scaffold one new capability (「新建能力」). */
  readonly create: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly adopt: CapabilityAdopter
  /** Register one in-KB skill by writing its route entry into the central routing file (ADR-0025 决定 1). */
  readonly register: CapabilityRegistrar
  /** The mail capability's detail: the connector panel, transport and all; handed the capability's persisted state. */
  readonly mail: (state: unknown) => ReactElement
  /** List the prompt shortcuts (ADR-0040). */
  readonly loadShortcuts: PromptShortcutLister
  /** Replace the whole prompt-shortcut list (ADR-0040). */
  readonly saveShortcuts: PromptShortcutSaver
  /** Fill the conversation's composer with `/alias ` without sending (ADR-0040 决定 5). */
  readonly fillShortcut: ShortcutFiller
  /** This session's settled capability runs (ADR-0044 决定 6) — frontend memory, oldest first. */
  readonly runs: readonly CapabilityRunRecord[]
  /** Turn one run record into a headless distill session (ADR-0044 决定 6); outcomes arrive as frame notices. */
  readonly onDistill: (record: CapabilityRunRecord) => void
  /** The id of the record currently distilling, for the single-flight busy state. */
  readonly distilling: string | null
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 6px' } as const

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

const buttonStyle = { padding: '3px 8px', alignSelf: 'flex-start' } as const

const nameStyle = { fontWeight: 600 } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 'var(--yt-type-label)' } as const

const titleStyle = { margin: '4px 0 2px', fontSize: 'var(--yt-type-body)', fontWeight: 600, color: 'var(--yt-text-secondary)' } as const

const greyedNameStyle = { fontWeight: 600, color: 'var(--yt-text-muted)' } as const

const confirmStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-strong)',
  borderRadius: 4,
  background: 'var(--yt-surface-secondary)',
} as const

/** The code font (design.md §3): command fragments and tool payloads wear it. */
const CODE_FONT = 'var(--yt-font-code)'

const codeStyle = {
  fontFamily: CODE_FONT,
  fontSize: 'var(--yt-type-label)',
  background: 'var(--yt-surface-secondary)',
  padding: '2px 4px',
  borderRadius: 3,
  wordBreak: 'break-all',
} as const

const warnStyle = { color: 'var(--yt-warning-text)', fontSize: 'var(--yt-type-label)' } as const

const preStyle = {
  margin: '2px 0',
  padding: 6,
  background: 'var(--yt-surface-secondary)',
  borderRadius: 4,
  fontSize: 'var(--yt-type-label)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 160,
  overflow: 'auto',
} as const

const confirmButtonRowStyle = { display: 'flex', gap: 8 } as const

const runRowStyle = { display: 'flex', alignItems: 'baseline', gap: 6 } as const

/** The reach checkboxes the register dialog offers; the type is never asked — registration always writes an instruction capability. */
interface RegisterReach {
  agentInvoke: boolean
  resourceMenu: boolean
  selectionMenu: boolean
}

/** The register dialog's defaults: human-only, no menu reach. */
const DEFAULT_REGISTER_REACH: RegisterReach = { agentInvoke: false, resourceMenu: false, selectionMenu: false }

/**
 * The route entry the guided registration will write into the central
 * routing file, previewed as JSON. A plugin repository writes one entry per
 * nested skill; the preview shows the first as the shape of all of them.
 * @param skill - the row being registered.
 * @param reach - the capability's reach as the checkboxes hold it.
 * @returns the JSON text the confirm step shows.
 */
function registerPreview(skill: KbUnregisteredSkill, reach: RegisterReach): string {
  const appliesTo = {
    ...(reach.resourceMenu ? { resource: true as const } : {}),
    ...(reach.selectionMenu ? { selection: true as const } : {}),
  }
  const path = skill.plugin === true
    ? `${skill.name}/skills/${skill.pluginSkills?.[0] ?? '<child>'}`
    : skill.name
  return JSON.stringify({
    path,
    invocation: reach.agentInvoke ? ['human', 'agent'] : ['human'],
    ...(Object.keys(appliesTo).length > 0 ? { appliesTo } : {}),
  })
}

/**
 * Why an unregistered row is greyed out, when it is.
 * @param skill - the unregistered row.
 * @returns the reason in prose, or undefined when the row can be adopted (out of the KB) or registered (in it).
 */
function greyReasonOf(skill: KbUnregisteredSkill): string | undefined {
  if (skill.inKb === true) {
    if (skill.flat) return '扁平单文件技能没有自己的目录，无法注册为能力'
    if (!skill.userInvocable) return 'SKILL.md 已标记 user-invocable: false'
    return undefined
  }
  if (skill.flat) return '扁平单文件技能不支持采纳'
  if (!skill.userInvocable) return 'SKILL.md 已标记 user-invocable: false'
  return undefined
}

/**
 * Whether the source carries a declaration adoption will NOT carry over —
 * the confirm box warns so 「外带声明不能静默生效」 is seen before the copy.
 * @param skill - the unregistered row.
 * @returns true when the source's own sidecar declares an entry or agent invocation.
 */
function declaresMore(skill: KbUnregisteredSkill): boolean {
  const sidecar = skill.sidecar
  if (typeof sidecar !== 'object' || sidecar === null || Array.isArray(sidecar)) return false
  const record = sidecar as { entry?: unknown; invocation?: unknown }
  if (record.entry !== undefined) return true
  return Array.isArray(record.invocation) && record.invocation.includes('agent')
}

/** One capability row: its name on the first line, its description under it. */
function CapabilityRow({
  name,
  description,
  onSelect,
}: {
  name: string
  description: string
  onSelect: (name: string) => void
}): ReactElement {
  return (
    <button type="button" style={rowStyle} onClick={() => { onSelect(name) }} title={name}>
      <span style={nameStyle}>{name}</span>
      {description !== '' && <div style={clampedMutedStyle} title={description}>{description}</div>}
    </button>
  )
}

/**
 * Descriptions clamp to two lines (design.md §5: 挤则删并重) — the inventory
 * stays scannable; the row's own click opens the detail view with the full
 * text, and the tooltip carries it too.
 */
const clampedMutedStyle = {
  ...mutedStyle,
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
} as const

const shortcutRowStyle = { display: 'flex', alignItems: 'flex-start', gap: 2, margin: '1px 0' } as const

/**
 * One shortcut's expansion line: a leading `/command` (the skill-invocation
 * form) wears the code font; free-text expansions render plain.
 * @param text - the shortcut's expansion.
 */
function shortcutTextOf(text: string): ReactNode {
  if (!text.startsWith('/')) return text
  const spaceAt = text.indexOf(' ')
  const command = spaceAt === -1 ? text : text.slice(0, spaceAt)
  const rest = spaceAt === -1 ? '' : text.slice(spaceAt)
  return <><span style={{ fontFamily: CODE_FONT }}>{command}</span>{rest}</>
}

const shortcutMainStyle = {
  ...rowStyle,
  flex: 1,
  minWidth: 0,
} as const

const shortcutToolStyle = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '4px 3px',
  color: 'var(--yt-text-muted)',
  fontSize: 'var(--yt-type-label)',
} as const

const shortcutFormStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-strong)',
  borderRadius: 4,
  background: 'var(--yt-surface-secondary)',
} as const

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 6px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-label)',
} as const

const textareaStyle = {
  ...inputStyle,
  minHeight: 56,
  resize: 'vertical',
} as const

/** Which shortcut row the inline form is editing: an index, or the add form. */
type ShortcutEditing = number | 'new'

/**
 * The 惯用提示词 first screen (ADR-0040 决定 3/6/9): the human's saved
 * `/alias` favorites in display order. A row click fills the conversation's
 * composer with the token without sending (决定 5 — expansion authority is
 * the agent's, so the entry point only ever places the token); rows edit
 * inline, and 上移/下移 reorder — the store order IS the display and
 * injection order. Saves are full-list replaces through the host, which
 * validates aliases (shape, duplicates, shadowing a skill name).
 * @param props - the translate face and the three remote faces.
 * @returns the section element.
 */
function ShortcutSection({
  t,
  load,
  save,
  fill,
}: {
  t: WorkbenchT
  load: PromptShortcutLister
  save: PromptShortcutSaver
  fill: ShortcutFiller
}): ReactElement {
  const [shortcuts, setShortcuts] = useState<readonly KbPromptShortcut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ShortcutEditing | null>(null)
  const [alias, setAlias] = useState('')
  const [text, setText] = useState('')
  // Fresh closures from the inject face: read through a ref, like the panel.
  const latest = useRef({ load, save, fill })
  latest.current = { load, save, fill }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setShortcuts((await latest.current.load()).shortcuts)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** Persist one full-list mutation; the host's normalized answer is the truth. */
  const persist = async (next: readonly KbPromptShortcut[]): Promise<boolean> => {
    try {
      const result = await latest.current.save({ shortcuts: next })
      setShortcuts(result.shortcuts)
      setError(null)
      return true
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
      return false
    }
  }

  const openAdd = (): void => {
    setEditing('new')
    setAlias('')
    setText('')
  }

  const openEdit = (index: number): void => {
    const shortcut = shortcuts?.[index]
    if (shortcut === undefined) return
    setEditing(index)
    setAlias(shortcut.alias)
    setText(shortcut.text)
  }

  const submitEdit = async (): Promise<void> => {
    if (shortcuts === null || editing === null) return
    const entry: KbPromptShortcut = { alias: alias.trim(), text: text.replace(/\s+$/u, '') }
    if (entry.alias === '' || entry.text === '') return
    const next = editing === 'new'
      ? [...shortcuts, entry]
      : shortcuts.map((shortcut, index) => (index === editing ? entry : shortcut))
    if (await persist(next)) setEditing(null)
  }

  const remove = async (index: number): Promise<void> => {
    if (shortcuts === null) return
    await persist(shortcuts.filter((_, at) => at !== index))
  }

  const move = async (index: number, delta: number): Promise<void> => {
    if (shortcuts === null) return
    const to = index + delta
    if (to < 0 || to >= shortcuts.length) return
    const picked = shortcuts[index]
    const target = shortcuts[to]
    if (picked === undefined || target === undefined) return
    const next = shortcuts.map((shortcut, at) => (at === index ? target : at === to ? picked : shortcut))
    await persist(next)
  }

  /** The inline add/edit form, shared by both modes. */
  const form = (
    <div style={shortcutFormStyle} data-shortcut-form="true">
      <input
        style={inputStyle}
        value={alias}
        placeholder={t('shortcut.aliasPlaceholder')}
        onChange={(event) => { setAlias(event.target.value) }}
      />
      <textarea
        style={textareaStyle}
        value={text}
        placeholder={t('shortcut.textPlaceholder')}
        onChange={(event) => { setText(event.target.value) }}
      />
      <div style={confirmButtonRowStyle}>
        <button type="button" style={buttonStyle} onClick={() => { void submitEdit() }}>{t('shortcut.save')}</button>
        <button type="button" style={buttonStyle} onClick={() => { setEditing(null) }}>{t('common.cancel')}</button>
      </div>
    </div>
  )

  return (
    <div data-shortcut-section="true">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={titleStyle}>{t('shortcut.heading')}</div>
        {editing === null && (
          <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={openAdd}>
            {t('shortcut.add')}
          </button>
        )}
      </div>
      {error !== null && <div style={errorStyle} data-shortcut-error="true">{error}</div>}
      {shortcuts !== null && shortcuts.length === 0 && editing === null && (
        <div style={mutedStyle}>{t('shortcut.empty')}</div>
      )}
      {shortcuts?.map((shortcut, index) => (
        editing === index ? form : (
          <div key={shortcut.alias} style={shortcutRowStyle} data-shortcut-row={shortcut.alias}>
            <button
              type="button"
              style={shortcutMainStyle}
              title={`${t('shortcut.clickHint')}\n${shortcut.text}`}
              onClick={() => {
                try {
                  fill(shortcut.alias)
                  setError(null)
                } catch (failure: unknown) {
                  setError(remoteMessage(failure))
                }
              }}
            >
              <span style={nameStyle}>/{shortcut.alias}</span>
              <div style={mutedStyle}>{shortcutTextOf(shortcut.text)}</div>
            </button>
            <button type="button" style={shortcutToolStyle} disabled={index === 0} title={t('shortcut.up')}
              onClick={() => { void move(index, -1) }}
            >↑</button>
            <button type="button" style={shortcutToolStyle} disabled={index === shortcuts.length - 1} title={t('shortcut.down')}
              onClick={() => { void move(index, 1) }}
            >↓</button>
            <button type="button" style={shortcutToolStyle} title={t('shortcut.edit')}
              onClick={() => { openEdit(index) }}
            >{t('shortcut.edit')}</button>
            <button type="button" style={shortcutToolStyle} title={t('shortcut.delete')}
              onClick={() => { void remove(index) }}
            >{t('shortcut.delete')}</button>
          </div>
        )
      ))}
      {editing === 'new' && form}
    </div>
  )
}

/**
 * The detail view's 声明 section (ADR-0043 决定 7): the capability's parsed
 * declaration, read through the host's introspection RPC so a registration
 * problem — a missing sidecar, an unregistered route, a missing entry file —
 * is seen here, not discovered from a refused agent call. The sidecar's raw
 * text folds away; the resolved fields lie flat; every problem is a warning
 * line, never an exception that blanks the pane.
 * @param props - the translate face, the capability's name, and the RPC loader.
 * @returns the section element.
 */
function DeclarationSection({
  t,
  name,
  load,
}: {
  t: WorkbenchT
  name: string
  load: CapabilityDeclarationLoader
}): ReactElement {
  const [declaration, setDeclaration] = useState<KbCapabilityDeclarationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (inject face): read it
  // through a ref, like the panel, and re-read only when the name changes.
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let stale = false
    setDeclaration(null)
    setError(null)
    latest.current(name).then(
      (result) => {
        if (!stale) setDeclaration(result)
      },
      (failure: unknown) => {
        if (!stale) setError(remoteMessage(failure))
      },
    )
    return () => {
      stale = true
    }
  }, [name])

  const sidecar = declaration?.sidecar
  const resolved = sidecar?.resolved
  const route = declaration?.route

  return (
    <div data-capability-declaration="true">
      <div style={titleStyle}>{t('capability.declarationHeading')}</div>
      {error !== null && <div style={errorStyle} data-declaration-error="true">{error}</div>}
      {declaration === null && error === null && <div style={mutedStyle}>{t('capability.declarationLoading')}</div>}
      {declaration !== null && sidecar !== undefined && (
        <>
          {sidecar.present
            ? (
              <div style={mutedStyle}>
                {t(sidecar.source === 'sidecar' ? 'capability.declarationSourceSidecar' : 'capability.declarationSourceFrontmatter')}
              </div>
            )
            : <div style={warnStyle} data-declaration-problem="sidecar">{sidecar.problem}</div>}
          {sidecar.present && sidecar.problem !== undefined && (
            <div style={warnStyle} data-declaration-problem="sidecar">{sidecar.problem}</div>
          )}
          {resolved !== undefined && (
            <>
              <div style={mutedStyle} data-declaration-kind={resolved.kind}>
                {t(resolved.kind === 'script' ? 'capability.declarationKindScript' : 'capability.declarationKindInstruction')}
              </div>
              {resolved.entry !== undefined && (
                <div style={mutedStyle}>{t('capability.declarationEntry')}<span style={codeStyle}>{resolved.entry}</span></div>
              )}
              {resolved.runtime !== undefined && (
                <div style={mutedStyle}>{t('capability.declarationRuntime')}{resolved.runtime}</div>
              )}
              {resolved.version !== undefined && (
                <div style={mutedStyle}>{t('capability.declarationVersion')}{resolved.version}</div>
              )}
              <div style={mutedStyle}>
                {t('capability.declarationInvocation')}
                <span style={codeStyle}>{JSON.stringify(resolved.invocation)}</span>
              </div>
              {resolved.appliesTo !== undefined && (
                <div style={mutedStyle}>
                  {t('capability.accepts')}
                  <span style={codeStyle}>{JSON.stringify(resolved.appliesTo)}</span>
                </div>
              )}
              {resolved.kind === 'script' && (
                <>
                  {resolved.entryPath !== undefined && (
                    <div style={mutedStyle} data-declaration-entry-path="true">
                      {t('capability.declarationEntryPath')}
                      <span style={codeStyle}>{resolved.entryPath}</span>
                    </div>
                  )}
                  {resolved.entryPath === undefined && (resolved.entryCandidates?.length ?? 0) > 0 && (
                    <div style={warnStyle} data-declaration-problem="entry">{t('capability.declarationEntryMissing')}</div>
                  )}
                  {resolved.entryCandidates?.length === 0 && (
                    <div style={warnStyle} data-declaration-problem="entry">{t('capability.declarationEntryEscaped')}</div>
                  )}
                  {(resolved.entryCandidates?.length ?? 0) > 0 && (
                    <div style={mutedStyle} data-declaration-candidates="true">
                      {t('capability.declarationEntryCandidates')}
                      {resolved.entryCandidates?.map(candidate => (
                        <div key={candidate}><span style={codeStyle}>{candidate}</span></div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {sidecar.raw !== undefined && (
            <details data-declaration-raw="true">
              <summary style={mutedStyle}>{t('capability.declarationRaw')}</summary>
              <pre style={preStyle}>{sidecar.raw}</pre>
            </details>
          )}
          {route !== undefined && (
            <>
              <div style={mutedStyle}>{t('capability.declarationRouteHeading')}</div>
              {route.registered
                ? (
                  <div style={mutedStyle} data-declaration-route="registered">
                    {t('capability.declarationRouteRegistered')}
                    <span style={codeStyle}>
                      {JSON.stringify({ path: route.path, invocation: route.invocation ?? [] })}
                    </span>
                  </div>
                )
                : (
                  <div style={warnStyle} data-declaration-route="missing">
                    {route.problem ?? t('capability.declarationRouteMissing')}
                  </div>
                )}
            </>
          )}
          <div
            style={declaration.agentInvocable ? mutedStyle : warnStyle}
            data-declaration-agent={declaration.agentInvocable ? 'yes' : 'no'}
          >
            {t(declaration.agentInvocable ? 'capability.declarationAgentYes' : 'capability.declarationAgentNo')}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The detail view's 运行记录 section (ADR-0044 决定 6): this session's runs
 * of the capability, oldest first, each carrying a 提炼经验 button that hands
 * the run's envelope to a one-shot headless distill session. Distilling is
 * single-flight across the whole panel — while one record distils, every
 * button rests. The records themselves are frontend memory; they vanish with
 * the window, and the lessons they yield land in the proposal queue.
 * @param props - the translate face, the capability's name, the run records, and the distill gesture.
 * @returns the section element.
 */
function RunRecordsSection({
  t,
  name,
  runs,
  onDistill,
  distilling,
}: {
  t: WorkbenchT
  name: string
  runs: readonly CapabilityRunRecord[]
  onDistill: (record: CapabilityRunRecord) => void
  distilling: string | null
}): ReactElement {
  const mine = runs.filter(record => record.name === name)
  return (
    <div data-capability-runs="true">
      <div style={titleStyle}>{t('capability.runsHeading')}</div>
      {mine.map((record) => {
        const exec = record.exec
        const summary = [
          record.ok ? '成功' : '失败',
          exec === undefined ? undefined : (exec.exitCode === null ? '被终止' : `退出码 ${exec.exitCode}`),
          exec === undefined ? undefined : `${exec.durationMs} ms`,
          new Date(record.at).toLocaleTimeString(),
        ].filter(Boolean).join(' · ')
        return (
          <div key={record.id} style={runRowStyle} data-capability-run={record.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={record.ok ? mutedStyle : errorStyle}>{summary}</div>
              {exec !== undefined && (
                <details>
                  <summary style={mutedStyle}>{exec.command}</summary>
                  {exec.stdoutTail !== '' && <pre style={preStyle}>{exec.stdoutTail}</pre>}
                  {exec.stderrTail !== '' && <pre style={preStyle}>{exec.stderrTail}</pre>}
                </details>
              )}
            </div>
            <button
              type="button"
              style={buttonStyle}
              disabled={distilling !== null}
              data-capability-distill={record.id}
              onClick={() => { onDistill(record) }}
            >
              {distilling === record.id ? t('capability.distillRunning') : t('capability.distillRun')}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Render the 能力 panel.
 * @param props - see {@link CapabilityPanelProps}.
 * @returns the panel element.
 */
export function CapabilityPanel({
  t, load, loadDeclaration, create, adopt, register, mail, loadShortcuts, saveShortcuts, fillShortcut,
  runs, onDistill, distilling,
}: CapabilityPanelProps): ReactElement {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[] | null>(null)
  const [unregistered, setUnregistered] = useState<readonly KbUnregisteredSkill[]>([])
  const [confirming, setConfirming] = useState<KbUnregisteredSkill | null>(null)
  const [registering, setRegistering] = useState<KbUnregisteredSkill | null>(null)
  const [registerReach, setRegisterReach] = useState<RegisterReach>(DEFAULT_REGISTER_REACH)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ADR-0040 决定 6: the first screen is the 惯用提示词 list; the capability
  // inventory folds beneath it. Session-only fold state.
  const [inventoryOpen, setInventoryOpen] = useState(false)
  // The loader is a fresh closure on every render (inject face), so the
  // effect reads it through a ref instead of taking it as a dependency.
  const latest = useRef({ load, create, adopt, register })
  latest.current = { load, create, adopt, register }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.load()
      setCapabilities(result.capabilities)
      setUnregistered(result.unregistered)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** 「新建能力」: scaffold under `.dsh/skills/<name>` and reload the list. */
  const scaffold = async (name: string): Promise<void> => {
    try {
      await latest.current.create(name)
      setSelected(name)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }

  /** 「采纳」: copy the bundle into `.dsh/skills/<name>`, then open it. */
  const adoptSkill = async (name: string): Promise<void> => {
    try {
      await latest.current.adopt(name)
      setConfirming(null)
      setSelected(name)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }

  /** 「注册为能力」: write route entries into the central routing file, then open the capability. */
  const registerSkill = async (skill: KbUnregisteredSkill): Promise<void> => {
    try {
      await latest.current.register(skill.name, registerReach)
      setRegistering(null)
      setSelected(skill.plugin === true ? skill.pluginSkills?.[0] ?? null : skill.name)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }

  /** Open the guided registration for one in-KB skill, defaults reset. */
  const openRegister = (skill: KbUnregisteredSkill): void => {
    setRegistering(skill)
    setRegisterReach(DEFAULT_REGISTER_REACH)
  }

  const current = capabilities?.find(capability => capability.name === selected) ?? undefined

  return (
    <div style={wrapStyle} data-capability-panel="true">
      {error !== null && <div style={errorStyle} data-capability-error="true">{error}</div>}
      {current === undefined && (
        <>
          <ShortcutSection t={t} load={loadShortcuts} save={saveShortcuts} fill={fillShortcut} />
          <button
            type="button"
            style={{ ...buttonStyle, marginTop: 8 }}
            data-capability-inventory-toggle="true"
            aria-expanded={inventoryOpen}
            onClick={() => { setInventoryOpen(open => !open) }}
          >
            {inventoryOpen ? '▾ ' : '▸ '}{t('capability.inventoryHeading')}
          </button>
          {inventoryOpen && (
            <>
              {capabilities !== null && capabilities.length === 0 && (
                <div style={mutedStyle}>{t('capability.empty')}</div>
              )}
              {capabilities?.map(capability => (
                <CapabilityRow
                  key={capability.name}
                  name={capability.name}
                  description={capability.description}
                  onSelect={setSelected}
                />
              ))}
              {unregistered.length > 0 && (
                <>
                  <div style={titleStyle}>{t('capability.unregisteredHeading')}</div>
                  {unregistered.map((skill) => {
                    const reason = greyReasonOf(skill)
                    return (
                      <button
                        key={skill.name}
                        type="button"
                        style={rowStyle}
                        onClick={() => {
                          if (reason !== undefined) return
                          if (skill.inKb === true) openRegister(skill)
                          else setConfirming(skill)
                        }}
                        title={reason ?? skill.directory}
                      >
                        <span style={reason === undefined ? nameStyle : greyedNameStyle}>{skill.name}</span>
                        {skill.description !== '' && <div style={clampedMutedStyle} title={skill.description}>{skill.description}</div>}
                        {skill.inKb === true && skill.reason !== undefined && (
                          <div style={mutedStyle}>{skill.reason}</div>
                        )}
                        {reason !== undefined && <div style={mutedStyle}>{reason}</div>}
                      </button>
                    )
                  })}
                </>
              )}
              {confirming !== null && (
                <div style={confirmStyle} data-capability-confirm="true">
                  <div style={nameStyle}>{t('capability.adoptTitle', { name: confirming.name })}</div>
                  <div style={mutedStyle}>
                    {t('capability.adoptCopyTo', { path: `.dsh/skills/${confirming.name}/` })}
                  </div>
                  <div style={mutedStyle}>
                    {t('capability.adoptRouteTo', { path: '.dsh/skills/yantao.json' })}
                    <span style={codeStyle}>{JSON.stringify({ path: confirming.name, invocation: ['human'] })}</span>
                  </div>
                  {declaresMore(confirming) && (
                    <div style={warnStyle}>
                      {t('capability.adoptSidecarNote')}
                    </div>
                  )}
                  <div style={confirmButtonRowStyle}>
                    <button type="button" style={buttonStyle} onClick={() => { void adoptSkill(confirming.name) }}>{t('capability.adoptConfirm')}</button>
                    <button type="button" style={buttonStyle} onClick={() => { setConfirming(null) }}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
              {registering !== null && (
                <div style={confirmStyle} data-capability-register="true">
                  <div style={nameStyle}>{t('capability.registerTitle', { name: registering.name })}</div>
                  {registering.plugin === true ? (
                    <div style={mutedStyle}>
                      {t('capability.registerRepoNote', {
                        path: '.dsh/skills/yantao.json',
                        names: registering.pluginSkills?.join('、') ?? '',
                      })}
                    </div>
                  ) : (
                    <div style={mutedStyle}>
                      {t('capability.registerSimpleNote', { path: '.dsh/skills/yantao.json' })}
                    </div>
                  )}
                  <label style={mutedStyle}>
                    <input
                      type="checkbox"
                      checked={registerReach.agentInvoke}
                      onChange={(event) => { setRegisterReach(reach => ({ ...reach, agentInvoke: event.target.checked })) }}
                    />{' '}
                    {t('capability.reachAgent')}
                  </label>
                  <label style={mutedStyle}>
                    <input
                      type="checkbox"
                      checked={registerReach.resourceMenu}
                      onChange={(event) => { setRegisterReach(reach => ({ ...reach, resourceMenu: event.target.checked })) }}
                    />{' '}
                    {t('capability.reachAllResources')}
                  </label>
                  <label style={mutedStyle}>
                    <input
                      type="checkbox"
                      checked={registerReach.selectionMenu}
                      onChange={(event) => { setRegisterReach(reach => ({ ...reach, selectionMenu: event.target.checked })) }}
                    />{' '}
                    {t('capability.reachSelection')}
                  </label>
                  <div style={mutedStyle}>
                    {t('capability.routePreview')}<span style={codeStyle}>{registerPreview(registering, registerReach)}</span>
                  </div>
                  <div style={confirmButtonRowStyle}>
                    <button type="button" style={buttonStyle} onClick={() => { void registerSkill(registering) }}>{t('capability.registerConfirm')}</button>
                    <button type="button" style={buttonStyle} onClick={() => { setRegistering(null) }}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
              <NewEntityRow
                t={t}
                label={t('capability.newButton')}
                placeholder={t('capability.namePlaceholder')}
                submit={name => scaffold(name)}
              />
            </>
          )}
        </>
      )}
      {current !== undefined && (
        <>
          <button type="button" style={buttonStyle} onClick={() => { setSelected(null) }}>{t('capability.backToList')}</button>
          <div style={titleStyle}>{current.name}</div>
          <div>{current.description}</div>
          <div style={mutedStyle}>
            {current.entry !== undefined
              ? `${current.runtime} · ${current.entry}`
              : t('capability.instructionNote')}
            {current.directory !== undefined ? ` · ${current.directory}` : ''}
          </div>
          {current.invocation.includes('agent') && (
            <div style={mutedStyle}>{t('capability.openedToAgent')}</div>
          )}
          {current.appliesTo !== undefined && (
            <div style={mutedStyle}>
              {t('capability.accepts')}
              {[
                current.appliesTo.resource !== undefined
                  ? `资源 ${current.appliesTo.resource === true ? '全部' : (Array.isArray(current.appliesTo.resource) ? current.appliesTo.resource.join(' ') : '')}`
                  : undefined,
                current.appliesTo.entity !== undefined ? `实体 ${current.appliesTo.entity.join(' ')}` : undefined,
                current.appliesTo.external !== undefined ? `外部 ${current.appliesTo.external.join(' ')}` : undefined,
              ].filter(Boolean).join('；')}
            </div>
          )}
          {current.lastRunAt !== undefined && (
            <div style={mutedStyle}>{t('capability.lastRun')}{current.lastRunAt}</div>
          )}
          {runs.some(record => record.name === current.name) && (
            <RunRecordsSection t={t} name={current.name} runs={runs} onDistill={onDistill} distilling={distilling} />
          )}
          <DeclarationSection t={t} name={current.name} load={loadDeclaration} />
          {current.name === 'mail' && mail(current.state)}
        </>
      )}
    </div>
  )
}
