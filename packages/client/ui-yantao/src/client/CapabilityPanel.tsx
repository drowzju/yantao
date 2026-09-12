/**
 * The 能力 tab (ADR-0021 决定 8): 清单 + 详情 two states. The list names every
 * registered capability — the two built-ins (mail, ebook) plus anything the
 * human added through 「添加目录」 or scaffolded through 「新建能力」. The
 * mail capability's detail embeds {@link MailPanel}; every other capability's
 * detail is its manifest, read-only.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbCapabilitySummary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { CapabilityCreator, CapabilityDirRegistrar, CapabilityLoader } from './remote.ts'
import { remoteMessage } from './remote.ts'
import { NewEntityRow } from './NewEntityRow.tsx'

/** What the panel needs from the Remote and the frame. */
export interface CapabilityPanelProps {
  /** List the registered capabilities. */
  readonly load: CapabilityLoader
  /** Register one capability directory (「添加目录」). */
  readonly registerDir: CapabilityDirRegistrar
  /** Scaffold one new capability (「新建能力」). */
  readonly create: CapabilityCreator
  /** Open the host's native directory picker (「添加目录」's first half). */
  readonly pickDirectory: () => Promise<string | null>
  /** The mail capability's detail: the connector panel, transport and all. */
  readonly mail: () => ReactElement
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
export function CapabilityPanel({ load, registerDir, create, pickDirectory, mail }: CapabilityPanelProps): ReactElement {
  const [capabilities, setCapabilities] = useState<readonly KbCapabilitySummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The loader is a fresh closure on every render (inject face), so the
  // effect reads it through a ref instead of taking it as a dependency.
  const latest = useRef({ load, registerDir, create, pickDirectory })
  latest.current = { load, registerDir, create, pickDirectory }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.load()
      setCapabilities(result.capabilities)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** 「添加目录」: pick a directory, register it, reload the list. */
  const addDir = async (): Promise<void> => {
    const path = await latest.current.pickDirectory()
    if (path === null) return
    setBusy(true)
    try {
      await latest.current.registerDir(path)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  /** 「新建能力」: scaffold under `.dsh/skills/<name>` and reload the list. */
  const scaffold = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      await latest.current.create(name)
      setSelected(name)
      await refresh()
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const current = capabilities?.find(capability => capability.name === selected) ?? undefined

  return (
    <div style={wrapStyle} data-capability-panel="true">
      {error !== null && <div style={errorStyle} data-capability-error="true">{error}</div>}
      {current === undefined && (
        <>
          {capabilities !== null && capabilities.length === 0 && (
            <div style={mutedStyle}>还没有能力。添加一个技能目录，或新建一个。</div>
          )}
          {capabilities?.map(capability => (
            <CapabilityRow
              key={capability.name}
              name={capability.name}
              description={capability.description}
              onSelect={setSelected}
            />
          ))}
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void addDir() }}>
              + 添加目录
            </button>
          </div>
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
            {current.runtime} · {current.entry}
            {current.directory !== undefined ? ` · ${current.directory}` : ''}
          </div>
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
          {current.name === 'mail' && mail()}
        </>
      )}
    </div>
  )
}
