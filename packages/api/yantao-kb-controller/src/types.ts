/**
 * Wire payload vocabulary for the yantaoKb Remote namespace. Every value is
 * plain JSON: paths are KB-relative with forward slashes, and section labels
 * stay out of the payload (the Client owns its locale).
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/types
 */

/** One file row in a KB tree section. */
export interface KbTreeFile {
  /** Display name (file basename; entity notes drop the `.md` suffix). */
  readonly name: string
  /** KB-relative path with forward slashes. */
  readonly path: string
  /** Present (and true) when the entity's frontmatter carries `archive: true`. */
  readonly archived?: boolean
  /** For a resource: its shadow-note path, when the note exists. */
  readonly notePath?: string
  /** For a person entity: the declared relation, when present. */
  readonly relation?: string
}

/**
 * Stable section identifiers across both trees. The intake tree carries
 * `resources` + `meetings` + `todos`, the workspace tree `projects` +
 * `areas` + `people` — one union keeps the Client's label map total.
 */
export type KbTreeSectionId = 'resources' | 'meetings' | 'todos' | 'projects' | 'areas' | 'people'

/** One KB tree section. */
export interface KbTreeSection {
  /** Stable section id (the Client maps it to a localized label). */
  readonly id: KbTreeSectionId
  /** Files in the section, in directory read order. */
  readonly files: readonly KbTreeFile[]
}

/** One KB tree payload: the sections of the intake or the workspace side, in display order. */
export interface KbTree {
  /** The sections of this tree, every one present even when empty. */
  readonly sections: readonly KbTreeSection[]
}

/** Result of `yantaoKb.read`. */
export interface KbFileContent {
  /** The KB-relative path that was read. */
  readonly path: string
  /** The file's complete UTF-8 content. */
  readonly content: string
}

/** Result of `yantaoKb.write`. */
export interface KbWriteResult {
  /** The KB-relative path that was written. */
  readonly path: string
}

/** One `[[…]]` link a file writes out, and where it lands (ADR-0015). */
export interface KbLinkTarget {
  /** The target as written between the brackets. */
  readonly target: string
  /** The resolved KB-relative path; null when it names zero or several files. */
  readonly path: string | null
}

/** One file that links into another (ADR-0015). */
export interface KbLinkSource {
  /** KB-relative path of the linking file. */
  readonly from: string
  /** The target that file wrote. */
  readonly target: string
}

/** Result of `yantaoKb.links`: both halves of one file's link graph. */
export interface KbLinksResult {
  /** The file the graph was computed for. */
  readonly path: string
  /** What it links out to, in document order. */
  readonly outgoing: readonly KbLinkTarget[]
  /** What links into it. */
  readonly incoming: readonly KbLinkSource[]
}

/** Result of `yantaoKb.root`. */
export interface KbRootResult {
  /** The live knowledge-base root directory. */
  readonly root: string
  /** True when the root comes from a persisted override rather than the plugin's config default. */
  readonly configured: boolean
}

/** Result of `yantaoKb.setRoot`. */
export interface KbSetRootResult {
  /** The knowledge-base root now in force. */
  readonly root: string
  /** Always true: a successful `setRoot` persists the override. */
  readonly configured: boolean
  /** KB-relative paths this initialization created. */
  readonly created: readonly string[]
  /** KB-relative paths that were already there. */
  readonly existing: readonly string[]
}

/** An entity kind the UI may create; `todo` is the singleton `kb_init` owns. */
export type KbCreatableEntityType = 'project' | 'area' | 'person' | 'meeting'

/** Parameters of `yantaoKb.createEntity`. */
export interface KbCreateEntityArgs {
  /** The entity kind to create. */
  readonly type: KbCreatableEntityType
  /** The entity display name; a meeting's file name is prefixed with its date. */
  readonly name: string
  /** The meeting's own date (YYYY-MM-DD); defaults to today. */
  readonly date?: string
}

/** Result of `yantaoKb.createEntity`. */
export interface KbCreateEntityResult {
  /** The KB-relative path of the created entity file. */
  readonly path: string
}
