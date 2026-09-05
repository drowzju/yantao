/**
 * Shared domain types for the yantao KB plugin: entity taxonomy and the
 * domain error every tool failure is reported as.
 * @module @deepseek-ai/dsh-yantao-kb/types
 */

/** Entity kinds with a directory under `entities/`. */
export type EntityType = 'project' | 'area' | 'person'

/** Every entity kind, in directory-listing order. */
export const ENTITY_TYPES: readonly EntityType[] = ['project', 'area', 'person']

/** Entity kind → its plural directory name under `entities/`. */
export const ENTITY_DIRS: Record<EntityType, string> = {
  project: 'projects',
  area: 'areas',
  person: 'people',
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
