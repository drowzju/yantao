/**
 * The 能力 tab (ADR-0021 决定 8): 清单 + 详情 two states. The list names every
 * registered capability — the built-in mail one plus anything the
 * human copied into `.dsh/skills/` or scaffolded through 「新建能力」. Under it
 * sits the 未注册 group (ADR-0025 决定 1): skills that are not capabilities
 * yet, greyed rows carrying their reason. Out-of-KB rows are adoption
 * candidates — an inline confirm precedes the copy; in-KB rows (missing or
 * invalid declaration) open a guided registration that writes a route entry
 * into the central routing file `.dsh/skills/yantao.json` (ADR-0025 落地注记二).
 * The mail capability's detail
 * embeds {@link MailPanel}; every other capability's detail is its manifest,
 * read-only.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbCapabilitySummary, KbUnregisteredSkill } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { CapabilityAdopter, CapabilityCreator, CapabilityLoader, CapabilityRegistrar } from './remote.ts'
import { remoteMessage } from './remote.ts'
import { NewEntityRow } from './NewEntityRow.tsx'
import type { WorkbenchT } from './locales.ts'

/** What the panel needs from the Remote and the frame. */
export interface CapabilityPanelProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** List the registered capabilities and the 未注册 group. */
  readonly load: CapabilityLoader
  /** Scaffold one new capability (「新建能力」). */
  readonly create: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly adopt: CapabilityAdopter
  /** Register one in-KB skill by writing its route entry into the central routing file (ADR-0025 决定 1). */
  readonly register: CapabilityRegistrar
  /** The mail capability's detail: the connector panel, transport and all; handed the capability's persisted state. */
  readonly mail: (state: unknown) => ReactElement
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

const mutedStyle = { color: '#9a9488', fontSize: 12 } as const

const errorStyle = { color: '#b4453a', fontSize: 12 } as const

const titleStyle = { margin: '4px 0 2px', fontSize: 13, fontWeight: 600, color: '#6b6455' } as const

const greyedNameStyle = { fontWeight: 600, color: '#9a9488' } as const

const confirmStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#d8d2c4',
  borderRadius: 4,
  background: '#faf8f3',
} as const

const codeStyle = {
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#f0ede5',
  padding: '2px 4px',
  borderRadius: 3,
  wordBreak: 'break-all',
} as const

const warnStyle = { color: '#8a6d3b', fontSize: 12 } as const

const confirmButtonRowStyle = { display: 'flex', gap: 8 } as const

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
      {description !== '' && <div style={mutedStyle}>{description}</div>}
    </button>
  )
}

/**
 * Render the 能力 panel.
 * @param props - see {@link CapabilityPanelProps}.
 * @returns the panel element.
 */
export function CapabilityPanel({ t, load, create, adopt, register, mail }: CapabilityPanelProps): ReactElement {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[] | null>(null)
  const [unregistered, setUnregistered] = useState<readonly KbUnregisteredSkill[]>([])
  const [confirming, setConfirming] = useState<KbUnregisteredSkill | null>(null)
  const [registering, setRegistering] = useState<KbUnregisteredSkill | null>(null)
  const [registerReach, setRegisterReach] = useState<RegisterReach>(DEFAULT_REGISTER_REACH)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
                    {skill.description !== '' && <div style={mutedStyle}>{skill.description}</div>}
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
          {current.name === 'mail' && mail(current.state)}
        </>
      )}
    </div>
  )
}
