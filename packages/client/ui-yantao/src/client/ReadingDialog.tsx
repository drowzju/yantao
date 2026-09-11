/**
 * The reading-project dialog (ADR-0020): the app-level confirm that stands
 * between a resource and its 读书项目. The question it asks is a known
 * two-choice — name the project, and whether the agent should read the book
 * now — so it is a dialog, not an agent round-trip.
 *
 * The confirm chain it owns: create the project (its `source:` names the
 * resource), extract the book's text when reading was asked for, then run the
 * first reading round and show what it proposes. An extraction failure ends
 * the chain with the error on screen and the project kept — a failed read
 * never un-creates the project it was for.
 */
import { useState, type ReactElement } from 'react'
import type { ResourceExtractor } from './remote.ts'
import { remoteDetails, remoteMessage } from './remote.ts'
import type { BookReader, DomainConfirmer, ReadingProgress, ReadingRun } from './reading-flow.ts'
import { ReadingProposal } from './ReadingProposal.tsx'

/** Dialog props. */
export interface ReadingDialogProps {
  /** The resource the project reads, `resources/…`. */
  readonly resourcePath: string
  /** Create the project entity with `source:` set; resolves its path. */
  readonly createReadingProject: (name: string, source: string) => Promise<string>
  /** Extract the book's text into the cache (ADR-0020). */
  readonly extract: ResourceExtractor
  /** Run the first reading round in a dsh session. */
  readonly readBook: BookReader
  /** Read the 领域 the KB already holds, for the prompt. */
  readonly knownAreas: () => Promise<readonly string[]>
  /** Land the confirmed domain links in a second round. */
  readonly confirmDomains: DomainConfirmer
  /** The project exists (and any links landed): open it and reload the tree. */
  readonly onDone: (projectPath: string) => void
  /** Close without creating anything. */
  readonly onCancel: () => void
}

type Phase = 'form' | 'busy' | 'proposal' | 'failed'

/** What a busy phase is doing — the dialog shows it as a line of prose. */
type BusyStage = 'creating' | 'extracting' | 'writing' | ReadingProgress['stage']

/** The stage lines the dialog shows while it works. */
const STAGE_LABELS: Record<BusyStage, string> = {
  creating: '正在创建读书项目…',
  extracting: '正在抽取书籍文本…（第一次可能需要安装 Python 解析库）',
  session: '正在创建会话…',
  prompt: '正在向模型布置任务…',
  reading: '模型正在读书…（一本书可能要读几分钟）',
  parse: '正在解析领域建议…',
  writing: '正在写入领域关联…',
}

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(251, 250, 247, 0.94)',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const cardStyle = {
  minWidth: 340,
  maxWidth: 'min(480px, 92vw)',
  padding: 24,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const

const errorStyle = { color: '#b4453a' } as const

const hintStyle = { color: '#6b6455', fontSize: 12 } as const

const inputStyle = { padding: '4px 6px', width: '100%', boxSizing: 'border-box' } as const

/**
 * The book's display name, read out of the resource's file name: the
 * extension goes, the rest is the human's to edit.
 * @param resourcePath - the resource's KB-relative path.
 * @returns the pre-filled book title.
 */
export function bookTitleOf(resourcePath: string): string {
  const base = resourcePath.slice(resourcePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Render the reading-project dialog and run its confirm chain.
 * @param props - see {@link ReadingDialogProps}.
 * @returns the dialog element.
 */
export function ReadingDialog(props: ReadingDialogProps): ReactElement {
  const [title, setTitle] = useState(bookTitleOf(props.resourcePath))
  const [read, setRead] = useState(true)
  const [phase, setPhase] = useState<Phase>('form')
  const [stage, setStage] = useState<BusyStage>('creating')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [run, setRun] = useState<ReadingRun | null>(null)

  /** Create the project, and when reading was asked for, run the first round. */
  const confirm = async (): Promise<void> => {
    setPhase('busy')
    setStage('creating')
    setError(null)
    setHint(null)
    try {
      const path = await props.createReadingProject(title, props.resourcePath)
      setProjectPath(path)
      if (!read) {
        props.onDone(path)
        return
      }
      setStage('extracting')
      await props.extract(props.resourcePath)
      setStage('session')
      const areas = await props.knownAreas()
      const result = await props.readBook({
        bookTitle: title,
        projectPath: path,
        resourcePath: props.resourcePath,
        knownAreas: areas,
        onProgress: (progress) => { setStage(progress.stage) },
      })
      setRun(result)
      setPhase('proposal')
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
      setHint(remoteDetails(failure)?.hint ?? null)
      setPhase('failed')
    }
  }

  /** Land what the human ticked, then hand the project back to the frame. */
  const apply = async (domains: readonly string[], newDomain?: string): Promise<void> => {
    if (run === null || projectPath === null) return
    setPhase('busy')
    setStage('writing')
    try {
      await props.confirmDomains({
        sessionId: run.sessionId,
        projectPath,
        domains,
        ...newDomain !== undefined ? { newDomain } : {},
      })
      props.onDone(projectPath)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
      setHint(remoteDetails(failure)?.hint ?? null)
      setPhase('failed')
    }
  }

  return (
    <div style={overlayStyle} data-reading-dialog="true">
      <div style={cardStyle}>
        {phase === 'form' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>创建读书项目</div>
            <div style={hintStyle}>
              为 <span title={props.resourcePath}>{bookTitleOf(props.resourcePath)}</span> 建一个项目，
              frontmatter 里会记下它读的是哪本书。
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              书名
              <input
                type="text"
                style={inputStyle}
                value={title}
                onChange={(event) => { setTitle(event.target.value) }}
                aria-label="书名"
              />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={read}
                onChange={() => { setRead(value => !value) }}
                aria-label="读取书籍内容"
              />
              是否需要我读取书籍内容为你整理大纲？
            </label>
            {error !== null && <div style={errorStyle}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={{ padding: '4px 10px' }} onClick={props.onCancel}>取消</button>
              <button
                type="button"
                style={{ padding: '4px 10px' }}
                disabled={title.trim() === ''}
                onClick={() => { void confirm() }}
              >
                创建
              </button>
            </div>
          </>
        )}
        {phase === 'busy' && <div data-reading-stage={stage}>{STAGE_LABELS[stage]}</div>}
        {phase === 'proposal' && run !== null && projectPath !== null && (
          <ReadingProposal
            proposal={run.proposal}
            onConfirm={(domains, newDomain) => { void apply(domains, newDomain) }}
            onDismiss={() => { props.onDone(projectPath) }}
          />
        )}
        {phase === 'failed' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>读书流程没有走完</div>
            <div style={errorStyle} data-reading-error="true">{error}</div>
            {hint !== null && <div style={hintStyle}>{hint}</div>}
            {projectPath !== null && <div style={hintStyle}>读书项目已创建，可以稍后在它里面继续。</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={{ padding: '4px 10px' }}
                onClick={() => {
                  if (projectPath !== null) props.onDone(projectPath)
                  else props.onCancel()
                }}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
