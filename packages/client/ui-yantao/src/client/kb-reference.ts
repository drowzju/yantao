/**
 * The `@` source for KB entities (ADR-0013).
 *
 * Upstream's `@` menu lists files and sessions; the workbench's own entities
 * live behind the `yantaoKb` Remote, so nothing offered them. This source
 * lists every entity the two rails can already see — 领域 / 人物 / 项目 plus
 * 会议 and 资源 — grouped by section and filtered by what the human typed.
 *
 * A pick inserts a chip whose model text is the KB-relative path
 * (`@entities/people/张三.md`): the mention stays readable in the transcript,
 * and the host-side expander resolves it to the file's content before the
 * model step. Serialization is deliberately path-only — reading the file at
 * send time would put a failure between the human and their send.
 * @module @deepseek-ai/dsh-client-ui-yantao/kb-reference
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TreeLoader } from './Workbench.tsx'
import { SECTION_LABELS } from './Workbench.tsx'

/** The two tree loaders the source lists from. */
export interface KbReferenceFaces {
  /** Load the intake sections (资源 / 待办 / 会议). */
  readonly intake: TreeLoader
  /** Load the workspace sections (领域 / 人物 / 项目). */
  readonly workspace: TreeLoader
}

/** Cap on rows offered at once: the menu is a picker, not a browser. */
const LIMIT = 40

/** What a candidate's opaque `value` carries. */
interface KbReferencePayload {
  /** KB-relative path — the mention the model receives. */
  readonly path: string
  /** Display name. */
  readonly name: string
}

/**
 * Decode one candidate payload; a hand-edited or foreign value is ignored.
 * @param value - the candidate's opaque value.
 * @returns the payload, or undefined when it is not ours.
 */
export function parseKbReference(value: string | undefined): KbReferencePayload | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value) as KbReferencePayload
  } catch {
    return undefined
  }
}

/**
 * Build the `@` source over the two rails' trees.
 * @param faces - the intake and workspace loaders.
 * @returns the source, ready for `inputTriggers.registerSource`.
 */
export function kbReferenceSource(faces: KbReferenceFaces): InputTriggerSource {
  return {
    trigger: '@',
    name: 'kb',
    // Above upstream's file source: the KB is what this workbench is about.
    order: -10,
    showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      const [intake, workspace] = await Promise.all([faces.intake(), faces.workspace()])
      if (signal.aborted) return []
      const needle = query.trim().toLocaleLowerCase()
      return [...workspace, ...intake]
        .flatMap(section => section.files.map(file => ({ section: section.id, file })))
        .filter(({ file }) => needle === ''
          || file.name.toLocaleLowerCase().includes(needle)
          || file.path.toLocaleLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map(({ section, file }) => ({
          name: file.name,
          description: file.path,
          icon: 'file' as const,
          section: SECTION_LABELS[section] ?? section,
          value: JSON.stringify({ path: file.path, name: file.name } satisfies KbReferencePayload),
        }))
    },
    onPick({ candidate }) {
      const payload = parseKbReference(candidate.value)
      if (payload === undefined) return undefined
      return {
        insert: {
          source: 'kb',
          ref: payload.path,
          label: payload.name,
          appearance: 'file',
          clipboardText: payload.path,
        },
      }
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(`@${ref}`),
    },
  }
}
