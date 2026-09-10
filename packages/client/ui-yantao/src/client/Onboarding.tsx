/**
 * First-run directory choice. The KB root is the one thing the workbench
 * cannot invent: until the human points it at a directory there is no tree to
 * show, so the frame puts this overlay over everything and asks once. Nothing
 * in the UI re-opens it: a later root change is a `setRoot` call from outside.
 */
import { useState, type ReactElement } from 'react'
import type { DirectoryPicker, RootSetter } from './remote.ts'
import { remoteMessage } from './remote.ts'

/** Onboarding props. */
export interface OnboardingProps {
  /** Adopt a directory as the KB root. */
  readonly setRoot: RootSetter
  /** Open the host's native directory picker. */
  readonly pickDirectory: DirectoryPicker
  /** Called once a root is in force: the frame hides the overlay and reloads its trees. */
  readonly onConfigured: () => void
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
  minWidth: 320,
  padding: 24,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const

const errorStyle = { color: '#b4453a' } as const

/**
 * The directory-choice overlay.
 * @param props - see {@link OnboardingProps}.
 * @returns the overlay element.
 */
export function Onboarding({ setRoot, pickDirectory, onConfigured }: OnboardingProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Pick a directory, adopt it, then hand control back to the frame. */
  const choose = (): void => {
    setBusy(true)
    setError(null)
    void pickDirectory().then(
      (picked) => {
        if (picked === null) {
          setBusy(false)
          return
        }
        return setRoot(picked).then(
          () => { onConfigured() },
          (failure: unknown) => {
            setError(remoteMessage(failure))
            setBusy(false)
          },
        )
      },
      (failure: unknown) => {
        setError(remoteMessage(failure))
        setBusy(false)
      },
    )
  }

  return (
    <div style={overlayStyle} data-onboarding="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>选择知识库目录</div>
        <div style={{ color: '#6b6455' }}>
          yantao 把知识库存成纯 Markdown 文件。选择一个空目录或已有知识库目录，缺少的结构会自动创建。
        </div>
        {error !== null && <div style={errorStyle}>{error}</div>}
        <button type="button" style={{ padding: '6px 12px' }} disabled={busy} onClick={choose}>
          {busy ? '处理中…' : '选择目录'}
        </button>
      </div>
    </div>
  )
}
