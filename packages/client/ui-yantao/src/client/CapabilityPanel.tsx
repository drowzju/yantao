/**
 * The 能力 tab (ADR-0021 决定 8): 清单 + 详情 two states. The list names every
 * registered capability — the built-in mail one plus anything the
 * human copied into `.dsh/skills/` or scaffolded through 「新建能力」. Under it
 * sits the 未注册 group (ADR-0025 决定 1): skills that are not capabilities
 * yet, greyed rows carrying their reason. Out-of-KB rows are adoption
 * candidates — an inline confirm precedes the copy; in-KB rows (missing or
 * invalid declaration) open a guided registration that writes the skill's
 * `yantao.json` sidecar in place. The mail capability's detail
 * embeds {@link MailPanel}; every other capability's detail is its manifest,
 * read-only.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbCapabilitySummary, KbUnregisteredSkill } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { CapabilityAdopter, CapabilityCreator, CapabilityLoader, CapabilityRegistrar } from './remote.ts'
import { remoteMessage } from './remote.ts'
import { NewEntityRow } from './NewEntityRow.tsx'

/** What the panel needs from the Remote and the frame. */
export interface CapabilityPanelProps {
  /** List the registered capabilities and the 未注册 group. */
  readonly load: CapabilityLoader
  /** Scaffold one new capability (「新建能力」). */
  readonly create: CapabilityCreator
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  readonly adopt: CapabilityAdopter
  /** Register one in-KB skill by writing its sidecar in place (ADR-0025 决定 1). */
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

const inputStyle = {
  padding: '3px 6px',
  fontFamily: 'monospace',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
} as const

/** The kind of capability the guided registration offers. */
type RegisterKind = 'instructions' | 'script'

/** Entry the register dialog prefills for a script capability. */
const DEFAULT_REGISTER_ENTRY = 'scripts/entry.py'

/**
 * The sidecar the guided registration will write, previewed as JSON.
 * @param kind - instruction or script capability.
 * @param entry - the entry path, meaningful only for a script capability.
 * @returns the JSON text the confirm step shows.
 */
function registerPreview(kind: RegisterKind, entry: string): string {
  if (kind === 'instructions') return JSON.stringify({ version: 1, invocation: ['human'] })
  return JSON.stringify({ version: 1, invocation: ['human'], entry, runtime: 'python' })
}

/**
 * Why an unregistered row is greyed out, when it is.
 * @param skill - the unregistered row.
 * @returns the reason in prose, or undefined when the row can be adopted (out of the KB) or registered (in it).
 */
function greyReasonOf(skill: KbUnregisteredSkill): string | undefined {
  if (skill.inKb === true) {
    if (skill.flat) return '扁平单文件技能没有自己的目录，无法放置 yantao.json'
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
export function CapabilityPanel({ load, create, adopt, register, mail }: CapabilityPanelProps): ReactElement {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[] | null>(null)
  const [unregistered, setUnregistered] = useState<readonly KbUnregisteredSkill[]>([])
  const [confirming, setConfirming] = useState<KbUnregisteredSkill | null>(null)
  const [registering, setRegistering] = useState<KbUnregisteredSkill | null>(null)
  const [registerKind, setRegisterKind] = useState<RegisterKind>('instructions')
  const [registerEntry, setRegisterEntry] = useState(DEFAULT_REGISTER_ENTRY)
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

  /** 「注册为能力」: write the sidecar in place, then open the capability. */
  const registerSkill = async (name: string): Promise<void> => {
    try {
      await latest.current.register(name, registerKind === 'script' ? registerEntry : undefined)
      setRegistering(null)
      setSelected(name)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }

  /** Open the guided registration for one in-KB skill, defaults reset. */
  const openRegister = (skill: KbUnregisteredSkill): void => {
    setRegistering(skill)
    setRegisterKind('instructions')
    setRegisterEntry(DEFAULT_REGISTER_ENTRY)
  }

  const current = capabilities?.find(capability => capability.name === selected) ?? undefined

  return (
    <div style={wrapStyle} data-capability-panel="true">
      {error !== null && <div style={errorStyle} data-capability-error="true">{error}</div>}
      {current === undefined && (
        <>
          {capabilities !== null && capabilities.length === 0 && (
            <div style={mutedStyle}>还没有能力。把能力目录拷进 .dsh/skills/，或新建一个。</div>
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
              <div style={titleStyle}>未注册技能（ADR-0025）</div>
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
              <div style={nameStyle}>采纳「{confirming.name}」？</div>
              <div style={mutedStyle}>
                将整个目录复制到 <span style={codeStyle}>.dsh/skills/{confirming.name}/</span>，原处保留。
              </div>
              <div style={mutedStyle}>
                默认 sidecar：<span style={codeStyle}>{'{"invocation":["human"],"version":1}'}</span>
              </div>
              {declaresMore(confirming) && (
                <div style={warnStyle}>
                  注意：该技能自带 yantao.json 声明，采纳后会被默认 sidecar 取代，外带声明不会静默生效。
                </div>
              )}
              <div style={confirmButtonRowStyle}>
                <button type="button" style={buttonStyle} onClick={() => { void adoptSkill(confirming.name) }}>采纳</button>
                <button type="button" style={buttonStyle} onClick={() => { setConfirming(null) }}>取消</button>
              </div>
            </div>
          )}
          {registering !== null && (
            <div style={confirmStyle} data-capability-register="true">
              <div style={nameStyle}>注册「{registering.name}」为能力</div>
              <div style={mutedStyle}>
                在 <span style={codeStyle}>.dsh/skills/{registering.name}/yantao.json</span> 写入能力声明，技能目录原地保留。
              </div>
              <div style={confirmButtonRowStyle}>
                <button
                  type="button"
                  style={registerKind === 'instructions' ? { ...buttonStyle, background: '#eef3ff' } : buttonStyle}
                  onClick={() => { setRegisterKind('instructions') }}
                >
                  指令型
                </button>
                <button
                  type="button"
                  style={registerKind === 'script' ? { ...buttonStyle, background: '#eef3ff' } : buttonStyle}
                  onClick={() => { setRegisterKind('script') }}
                >
                  脚本型
                </button>
              </div>
              {registerKind === 'script' && (
                <label style={mutedStyle}>
                  入口脚本（相对技能目录）：
                  <input
                    style={inputStyle}
                    value={registerEntry}
                    onChange={(event) => { setRegisterEntry(event.target.value) }}
                  />
                </label>
              )}
              <div style={mutedStyle}>
                将写入：<span style={codeStyle}>{registerPreview(registerKind, registerEntry)}</span>
              </div>
              <div style={confirmButtonRowStyle}>
                <button type="button" style={buttonStyle} onClick={() => { void registerSkill(registering.name) }}>注册</button>
                <button type="button" style={buttonStyle} onClick={() => { setRegistering(null) }}>取消</button>
              </div>
            </div>
          )}
          <NewEntityRow
            label="+ 新建能力"
            placeholder="能力名称（如 paper-digest）"
            submit={name => scaffold(name)}
          />
        </>
      )}
      {current !== undefined && (
        <>
          <button type="button" style={buttonStyle} onClick={() => { setSelected(null) }}>← 返回清单</button>
          <div style={titleStyle}>{current.name}</div>
          <div>{current.description}</div>
          <div style={mutedStyle}>
            {current.entry !== undefined
              ? `${current.runtime} · ${current.entry}`
              : '指令型能力：没有脚本，agent 调用时返回下面的 SKILL.md 指令正文'}
            {current.directory !== undefined ? ` · ${current.directory}` : ''}
          </div>
          {current.invocation.includes('agent') && (
            <div style={mutedStyle}>已对 agent 开放（kb_run_capability）</div>
          )}
          {current.appliesTo !== undefined && (
            <div style={mutedStyle}>
              接受：
              {[
                current.appliesTo.resource !== undefined ? `资源 ${current.appliesTo.resource.join(' ')}` : undefined,
                current.appliesTo.entity !== undefined ? `实体 ${current.appliesTo.entity.join(' ')}` : undefined,
                current.appliesTo.external !== undefined ? `外部 ${current.appliesTo.external.join(' ')}` : undefined,
              ].filter(Boolean).join('；')}
            </div>
          )}
          {current.lastRunAt !== undefined && (
            <div style={mutedStyle}>上次运行：{current.lastRunAt}</div>
          )}
          {current.name === 'mail' && mail(current.state)}
        </>
      )}
    </div>
  )
}
