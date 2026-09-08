/**
 * Shared domain types for the yantao KB plugin: entity taxonomy and the
 * domain error every tool failure is reported as.
 * @module @deepseek-ai/dsh-yantao-kb/types
 */

/** Entity kinds the KB stores, each with its own shape under `entities/`. */
export type EntityType = 'project' | 'area' | 'person' | 'meeting' | 'todo'

/** Every entity kind, in listing order. */
export const ENTITY_TYPES: readonly EntityType[] = ['project', 'area', 'person', 'meeting', 'todo']

/** Entity kind → its plural name under `entities/`, also the spelling accepted by `normalizeEntityType`. */
export const ENTITY_DIRS: Record<EntityType, string> = {
  project: 'projects',
  area: 'areas',
  person: 'people',
  meeting: 'meetings',
  todo: 'todos',
}

/**
 * The singleton kinds: instead of a directory of notes, each is one file
 * directly under `entities/` — `todo` is the single `entities/todos.md`
 * checklist. `kb_init` creates it; `kb_create_entity` refuses it.
 */
export const SINGLETON_FILES: Partial<Record<EntityType, string>> = {
  todo: 'todos.md',
}

/** Person-to-owner relations carried in person frontmatter. */
export const PERSON_RELATIONS = ['self', 'subordinate', 'superior', 'peer', 'external'] as const

/** One person-to-owner relation. */
export type PersonRelation = typeof PERSON_RELATIONS[number]

/** A KB domain failure. `code` is stable for callers and tests; the message is human prose. */
export class KbError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'KbError'
  }
}
