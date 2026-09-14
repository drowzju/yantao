/**
 * The mail capability's picture of the workspace (ADR-0019): the entity names
 * the analysis prompt offers the model, and the project files the proposal's
 * project notes resolve against. The writes themselves live in
 * {@link ./proposal-apply.ts} — the one applier every confirmation shares.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-apply
 */
import type { KbTreeFile, KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { KnownPerson } from './mail-analysis.ts'

/** The workspace side of the KB, in the shape the connector needs. */
export interface MailEntities {
  /** Existing project and area names, offered to the model. */
  readonly projects: readonly string[]
  /** Existing people, with their relations and addresses, offered to the model. */
  readonly people: readonly KnownPerson[]
  /** The project files themselves, so a chosen name resolves to a path. */
  readonly files: readonly KbTreeFile[]
}

/**
 * Read the workspace tree as the connector's entity picture: names for the
 * prompt, files for the writes. People carry their declared relation (a
 * `superior` is who the analysis flags as 上级) and e-mail address (the
 * strongest sender match).
 * @param tree - the workspace tree's sections.
 * @returns the entity names and the project files.
 */
export function entitiesOfTree(tree: readonly KbTreeSection[]): MailEntities {
  const section = (id: string): readonly KbTreeFile[] =>
    tree.find(entry => entry.id === id)?.files ?? []
  const projects = section('projects')
  return {
    projects: [...projects, ...section('areas')].map(file => file.name),
    people: section('people').map((file): KnownPerson => ({
      name: file.name,
      ...file.relation !== undefined ? { relation: file.relation } : {},
      ...file.email !== undefined ? { email: file.email } : {},
    })),
    files: projects,
  }
}
