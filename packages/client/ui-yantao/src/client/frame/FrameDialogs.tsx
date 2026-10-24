/**
 * The four low-frequency dialogs (2026-10-24 评审 P2-4 拆分): 模型配置, 工作空间
 * CLI, 钉钉, 快捷键目录. Split out of Frame.tsx verbatim — the frame keeps the
 * open flags (the panel seat and the Ctrl+Shift+, shortcut both reach them) and
 * this module keeps the prop wiring, so adding a dialog stops widening Frame.
 */
import type { ReactElement } from 'react'
import type { KbDingtalkBindingRow } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { ConfigDialog } from '../ConfigDialog.tsx'
import { DingTalkDialog } from '../DingTalkDialog.tsx'
import { ShortcutsDialog, type ShortcutCatalogFace, type ShortcutFixedCatalogFace } from '../ShortcutsDialog.tsx'
import { WorkspaceCliDialog } from '../WorkspaceCliDialog.tsx'
import type { DingTalkConfigDraft, DingTalkConfigView, DingTalkSaveResult } from '../dingtalk-config.ts'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../model-config.ts'
import type { SessionDetailLoader } from '../session-detail.ts'
import type { WorkspaceCliConfigDraft, WorkspaceCliConfigView, WorkspaceCliSaveResult, WorkspaceCliTestResult } from '../workspace-cli-config.ts'
import type { WorkbenchT } from '../locales.ts'

/** Everything the four dialogs need: their flags, their seams, their closers. */
export interface FrameDialogsProps {
  /** The workbench dictionary's bound translator. */
  readonly t: WorkbenchT
  /** 模型配置. */
  readonly configOpen: boolean
  readonly loadModelsConfig: () => Promise<ModelsConfigView>
  readonly saveModelsConfig: (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>
  readonly onCloseConfig: () => void
  /** 工作空间 CLI (2026-10-23). */
  readonly wsCliOpen: boolean
  readonly loadWorkspaceCliConfig: () => Promise<WorkspaceCliConfigView>
  readonly saveWorkspaceCliConfig: (draft: WorkspaceCliConfigDraft) => Promise<WorkspaceCliSaveResult>
  readonly testWorkspaceCli: (draft: WorkspaceCliConfigDraft) => Promise<WorkspaceCliTestResult>
  readonly onCloseWsCli: () => void
  /** 钉钉 (ADR-0060 决定 2). */
  readonly dingtalkOpen: boolean
  readonly loadDingTalkConfig: () => Promise<DingTalkConfigView>
  readonly saveDingTalkConfig: (draft: DingTalkConfigDraft) => Promise<DingTalkSaveResult>
  readonly loadDingTalkBindings: () => Promise<readonly KbDingtalkBindingRow[]>
  readonly setDingTalkBinding: (conversationId: string, sessionId: string | null) => Promise<void>
  readonly currentDingtalkMergeTarget: () => string | undefined
  readonly openDingtalkSession: (sessionId: string) => void
  readonly sessionDetail: SessionDetailLoader
  readonly onCloseDingtalk: () => void
  /** 快捷键目录 (2026-10-09 第四轮评审 P1). */
  readonly shortcutsOpen: boolean
  readonly shortcutCatalog: ShortcutCatalogFace
  readonly shortcutFixedCatalog: ShortcutFixedCatalogFace
  readonly onCloseShortcuts: () => void
}

/**
 * Render the four dialogs. Each is mounted only while open — closing is the
 * caller's flag, so the dialog's own state dies with it.
 * @param props - see {@link FrameDialogsProps}.
 * @returns the dialog fragment.
 */
export function FrameDialogs({
  t, configOpen, loadModelsConfig, saveModelsConfig, onCloseConfig,
  wsCliOpen, loadWorkspaceCliConfig, saveWorkspaceCliConfig, testWorkspaceCli, onCloseWsCli,
  dingtalkOpen, loadDingTalkConfig, saveDingTalkConfig, loadDingTalkBindings, setDingTalkBinding,
  currentDingtalkMergeTarget, openDingtalkSession, sessionDetail, onCloseDingtalk,
  shortcutsOpen, shortcutCatalog, shortcutFixedCatalog, onCloseShortcuts,
}: FrameDialogsProps): ReactElement {
  return (
    <>
      {configOpen && (
        <ConfigDialog
          t={t}
          load={loadModelsConfig}
          save={saveModelsConfig}
          onClose={() => { onCloseConfig() }}
        />
      )}
      {wsCliOpen && (
        <WorkspaceCliDialog
          t={t}
          load={loadWorkspaceCliConfig}
          save={saveWorkspaceCliConfig}
          test={testWorkspaceCli}
          onClose={() => { onCloseWsCli() }}
        />
      )}
      {dingtalkOpen && (
        <DingTalkDialog
          t={t}
          load={loadDingTalkConfig}
          save={saveDingTalkConfig}
          loadBindings={loadDingTalkBindings}
          mergeBinding={setDingTalkBinding}
          mergeTarget={currentDingtalkMergeTarget}
          openSession={openDingtalkSession}
          loadTranscript={sessionDetail}
          onClose={() => { onCloseDingtalk() }}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog t={t} catalog={shortcutCatalog} fixedCatalog={shortcutFixedCatalog} onClose={() => { onCloseShortcuts() }} />
      )}
    </>
  )
}
