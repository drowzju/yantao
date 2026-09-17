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
 * send time would put a failure between the human and their send. Since
 * ADR-0028 the resource section also offers its subdirectories as folder
 * candidates (the host expands a directory mention into a listing), and a
 * path with spaces serializes in the host regex's quoted form.
 * @module @deepseek-ai/dsh-client-ui-yantao/kb-reference
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TreeLoader } from './Workbench.tsx'
import { SECTION_KEYS } from './Workbench.tsx'
import type { WorkbenchT } from './locales.ts'

/** The two tree loaders the source lists from, plus the translate face for section group labels. */
export interface KbReferenceFaces {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** Load the intake sections (资源 / 待办 / 会议). */
  readonly intake: TreeLoader
  /** Load the workspace sections (领域 / 人物 / 项目). */
  readonly workspace: TreeLoader
}

/** Cap on rows offered at once: the menu is a picker, not a browser. */
const LIMIT = 40

/** One offerable row: a resource file, or a directory synthesized from resource paths (ADR-0028 决定 4). */
interface KbReferenceRow {
  readonly section: KbTreeSectionId
  readonly path: string
  readonly name: string
  readonly folder: boolean
}

/**
 * The directories worth offering, synthesized from the resource files' path
 * segments: every intermediate directory of a nested resource becomes a
 * candidate (`resources/报告` out of `resources/报告/周报.md`). The
 * `resources/` root itself is not offered — the menu is a selector, not a
 * browser, and a whole-library mention is too easy to lose control of; a
 * hand-typed `@resources/` still works, the host resolves it the same way.
 * @param rows - the rails' flat file rows.
 * @returns the directory rows, sorted by path.
 */
function directoryRowsOf(rows: readonly KbReferenceRow[]): readonly KbReferenceRow[] {
  const dirs = new Set<string>()
  for (const row of rows) {
    if (row.section !== 'resources') continue
    const parts = row.path.split('/')
    for (let index = 2; index < parts.length; index++) {
      dirs.add(parts.slice(0, index).join('/'))
    }
  }
  return [...dirs]
    .sort((left, right) => left.localeCompare(right))
    .map(dir => ({
      section: 'resources' as const,
      path: `${dir}/`,
      name: dir.split('/').pop() ?? dir,
      folder: true,
    }))
}

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
      const fileRows: readonly KbReferenceRow[] = [...workspace, ...intake]
        .flatMap(section => section.files.map(file => ({
          section: section.id,
          path: file.path,
          name: file.name,
          folder: false,
        })))
      // Within 资源 the directories come first: they are the broader pick.
      // Every other section keeps its rail order.
      const dirRows = directoryRowsOf(fileRows)
      const ordered = [...workspace, ...intake].flatMap((section) => {
        if (section.id === 'resources') return [...dirRows, ...fileRows.filter(row => row.section === 'resources')]
        return fileRows.filter(row => row.section === section.id)
      })
      return ordered
        .filter(row => needle === ''
          || row.name.toLocaleLowerCase().includes(needle)
          || row.path.toLocaleLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map(row => ({
          name: row.name,
          description: row.path,
          icon: row.folder ? ('folder' as const) : ('file' as const),
          section: faces.t(SECTION_KEYS[row.section]),
          value: JSON.stringify({ path: row.path, name: row.name } satisfies KbReferencePayload),
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
          appearance: payload.path.endsWith('/') ? 'folder' : 'file',
          clipboardText: payload.path,
        },
      }
    },
    codec: {
      clipboardText: ref => ref,
      // The host's mention regex reads a quoted form for paths with spaces
      // (ADR-0028 决定 4); without the quotes the bare form dies at the
      // space and the mention silently fails to resolve.
      serialize: ref => Promise.resolve(ref.includes(' ') ? `@"${ref}"` : `@${ref}`),
    },
  }
}
