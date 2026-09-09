/**
 * The KB file editor: a plain markdown textarea over the raw file (frontmatter
 * included) with debounced autosave and a conflict check. Autosave is the
 * whole point — the human never presses 保存 — so every write first re-reads
 * the server copy and compares it against the content this editor loaded: a
 * difference means somebody (the agent, another window) moved the file, and
 * the draft is held back behind a conflict bar instead of clobbering it.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { FileReader, FileWriter } from '../remote.ts'
import { remoteMessage } from '../remote.ts'

/** Autosave delay after the last keystroke. */
export const AUTOSAVE_MS = 2000

/** Save state of one open file, shown as the tab's status dot. */
export type SaveStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict'

/** The dot's Chinese label per status. */
export const STATUS_LABELS: Record<SaveStatus, string> = {
  loading: '载入中',
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  failed: '失败',
  conflict: '冲突',
}

/** What one save attempt came to. */
export type SaveOutcome = 'saved' | 'conflict' | 'failed'

/**
 * The one edit the reading view performs (ADR-0014 v2): hand a whole new
 * content to the editor that already owns this file's draft and conflict
 * check, rather than writing from a second place.
 */
export interface FileEditorApi {
  /** Replace the draft and save it through the same pre-save comparison. */
  patch(content: string): Promise<SaveOutcome>
}

/** Editor props: the file, the file channel, and the status report upward. */
export interface FileEditorProps {
  /** KB-relative path of the edited file. */
  readonly path: string
  /** Read the file's content (also used for the conflict check). */
  readonly read: FileReader
  /** Write the file's complete new content. */
  readonly write: FileWriter
  /** Report this file's save status to the tab strip; a fresh closure per render is fine. */
  readonly onStatus?: (status: SaveStatus) => void
  /**
   * Report the draft on every load and keystroke (ADR-0014). The reading view
   * is a sibling of this editor and shows the same text, so it reads the draft
   * through this callback instead of loading the file a second time.
   */
  readonly onDraft?: (content: string) => void
  /**
   * Publish (and, on unmount, retract) the one-command face the reading view
   * uses to flip a task checkbox. Keeping the write here means a checkbox
   * click and a keystroke save through the same baseline.
   */
  readonly onApi?: (api: FileEditorApi | null) => void
  /** Autosave delay in ms ({@link AUTOSAVE_MS}); overridable in tests. */
  readonly debounceMs?: number
}

const wrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const barStyle = { padding: '4px 8px', background: '#fdf3d8', color: '#6b6455', display: 'flex', gap: 6, alignItems: 'center' } as const

const errorStyle = { padding: '4px 8px', background: '#fbe9e7', color: '#b4453a' } as const

const textareaStyle = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'none',
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: 'solid',
  borderColor: '#e6e2d8',
  padding: 8,
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.5,
} as const

const diffStyle = { display: 'flex', gap: 8, minHeight: 0, flex: 1, padding: 8 } as const

const preStyle = {
  flex: 1,
  margin: 0,
  padding: 8,
  overflow: 'auto',
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 4,
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
} as const

/**
 * Edit one KB file with autosave.
 * @param props - see {@link FileEditorProps}.
 * @returns the editor element.
 */
export function FileEditor({
  path,
  read,
  write,
  onStatus,
  onDraft,
  onApi,
  debounceMs = AUTOSAVE_MS,
}: FileEditorProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  // The content as this editor last knew the server had it: the baseline the
  // conflict check compares the fresh read against.
  const [baseline, setBaseline] = useState<string | null>(null)
  // The server copy that lost the comparison — what 放弃我的修改 restores and
  // 查看差异 shows.
  const [serverCopy, setServerCopy] = useState<string | null>(null)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every async step reads the freshest draft through this ref: the debounce
  // callback is installed once per path, not per keystroke.
  const latest = useRef({ path, draft, baseline, read, write })
  latest.current = { path, draft, baseline, read, write }
  const statusSink = useRef(onStatus)
  statusSink.current = onStatus
  const draftSink = useRef(onDraft)
  draftSink.current = onDraft
  const apiSink = useRef(onApi)
  apiSink.current = onApi

  useEffect(() => {
    statusSink.current?.(status)
  }, [status])

  // One report per draft change: the reading view mirrors whatever the editor
  // holds, including a load and a conflict's 放弃我的修改.
  useEffect(() => {
    if (draft !== null) draftSink.current?.(draft)
  }, [draft])

  /** Drop a pending autosave. */
  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const save = useCallback(async (force: boolean): Promise<SaveOutcome> => {
    const { path: current, draft: text, baseline: known, read: load, write: store } = latest.current
    if (text === null || text === known) return 'saved'
    setStatus('saving')
    try {
      // The conflict check: one fresh read, compared against the baseline.
      // A forced save (覆盖) skips it — the human has seen both copies.
      if (!force) {
        const fresh = await load(current)
        if (fresh !== known) {
          setServerCopy(fresh)
          setStatus('conflict')
          return 'conflict'
        }
      }
      await store(current, text)
      latest.current.baseline = text
      setBaseline(text)
      setServerCopy(null)
      setError(null)
      setShowDiff(false)
      setStatus('saved')
      return 'saved'
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
      setStatus('failed')
      return 'failed'
    }
  }, [])

  // Load on mount and whenever the tab points at another file. `read` is a
  // fresh closure on every render (it comes from the inject face), so the
  // effect depends on the path alone and reaches the loader through the ref.
  useEffect(() => {
    let stale = false
    setStatus('loading')
    setError(null)
    setServerCopy(null)
    setShowDiff(false)
    setDraft(null)
    setBaseline(null)
    latest.current.read(path).then(
      (content) => {
        if (stale) return
        setDraft(content)
        setBaseline(content)
        setStatus('saved')
      },
      (failure: unknown) => {
        if (stale) return
        setError(remoteMessage(failure))
        setStatus('failed')
      },
    )
    return () => {
      stale = true
      cancel()
    }
  }, [path, cancel])

  const schedule = useCallback((): void => {
    cancel()
    timer.current = setTimeout(() => {
      timer.current = null
      void save(false)
    }, debounceMs)
  }, [cancel, save, debounceMs])

  // The reading view's write path: adopt the content as this editor's draft and
  // run the same save the keystroke path runs — one baseline, one conflict bar.
  useEffect(() => {
    apiSink.current?.({
      patch: async (next: string): Promise<SaveOutcome> => {
        if (latest.current.draft === null) return 'failed'
        latest.current.draft = next
        setDraft(next)
        return save(false)
      },
    })
    return () => {
      apiSink.current?.(null)
    }
  }, [save])

  /** Write now — bound to blur, and to 覆盖. */
  const flush = useCallback((): void => {
    cancel()
    void save(false)
  }, [cancel, save])

  /** 放弃我的修改: take the server copy back as both draft and baseline. */
  const discard = useCallback((): void => {
    if (serverCopy === null) return
    cancel()
    latest.current.baseline = serverCopy
    setDraft(serverCopy)
    setBaseline(serverCopy)
    setServerCopy(null)
    setShowDiff(false)
    setStatus('saved')
  }, [serverCopy, cancel])

  /** 覆盖: save the draft over whatever the server has, and rebase on it. */
  const overwrite = useCallback((): void => {
    cancel()
    void save(true)
  }, [cancel, save])

  return (
    <div style={wrapStyle}>
      {status === 'conflict' && serverCopy !== null && (
        <div style={barStyle} data-conflict="true">
          <span>此文件在别处已被修改，未自动保存。</span>
          <button type="button" onClick={overwrite}>覆盖</button>
          <button type="button" onClick={discard}>放弃我的修改</button>
          <button type="button" onClick={() => { setShowDiff(open => !open) }}>
            {showDiff ? '隐藏差异' : '查看差异'}
          </button>
        </div>
      )}
      {error !== null && <div style={errorStyle}>{error}</div>}
      {status === 'conflict' && serverCopy !== null && showDiff && (
        <div style={diffStyle}>
          <div style={{ ...preStyle, flex: 1 }} data-diff="mine">
            <div style={{ color: '#6b6455' }}>我的修改</div>
            {draft ?? ''}
          </div>
          <div style={preStyle} data-diff="server">
            <div style={{ color: '#6b6455' }}>服务器版本</div>
            {serverCopy}
          </div>
        </div>
      )}
      <textarea
        style={textareaStyle}
        value={draft ?? ''}
        data-status={status}
        onChange={(event) => {
          setDraft(event.target.value)
          setStatus('dirty')
          schedule()
        }}
        onBlur={flush}
      />
    </div>
  )
}
