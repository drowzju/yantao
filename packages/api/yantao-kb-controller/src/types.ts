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

/** Stable section identifiers of the KB tree, in display order. */
export type KbTreeSectionId = 'resources' | 'projects' | 'areas' | 'people' | 'sessions'

/** One KB tree section. */
export interface KbTreeSection {
  /** Stable section id (the Client maps it to a localized label). */
  readonly id: KbTreeSectionId
  /** Files in the section, in directory read order. */
  readonly files: readonly KbTreeFile[]
}

/** The full KB tree payload returned by `yantaoKb.tree`. */
export interface KbTree {
  /** The five sections in display order. */
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
