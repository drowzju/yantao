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
  /** Existing project names, offered to the model. */
  readonly projects: readonly string[]
  /** Existing area names, listed apart from projects (ADR-0034 决定 2). */
  readonly areas: readonly string[]
  /** Existing meeting names, offered to the model (ADR-0034 决定 3). */
  readonly meetings: readonly string[]
  /** Existing people, with their relations and addresses, offered to the model. */
  readonly people: readonly KnownPerson[]
  /** The project files themselves, so a chosen name resolves to a path. */
  readonly files: readonly KbTreeFile[]
  /** The meeting files themselves, so a chosen meeting name resolves to a path. */
  readonly meetingFiles: readonly KbTreeFile[]
}

/**
 * Read the workspace tree as the connector's entity picture: names for the
 * prompt, files for the writes. Projects and areas are listed apart — one
 * flat mix read as an invitation to relate a project to an area that is
 * really its sibling (ADR-0034 决定 2). The owner's own person (relation
 * `self`) is left out: nobody matches against themselves, and the prompt's
 * relation set has no self to offer. People carry their declared relation (a
 * `superior` is who the analysis flags as 上级) and e-mail address (the
 * strongest sender match).
 * @param tree - the workspace tree's sections.
 * @returns the entity names and the project files.
 */
export function entitiesOfTree(tree: readonly KbTreeSection[]): MailEntities {
  const section = (id: string): readonly KbTreeFile[] =>
    tree.find(entry => entry.id === id)?.files ?? []
  const projects = section('projects')
  const meetings = section('meetings')
  return {
    projects: projects.map(file => file.name),
    areas: section('areas').map(file => file.name),
    meetings: meetings.map(file => file.name),
    people: section('people')
      .filter(file => file.relation !== 'self')
      .map((file): KnownPerson => ({
        name: file.name,
        ...file.relation !== undefined ? { relation: file.relation } : {},
        ...file.email !== undefined ? { email: file.email } : {},
      })),
    files: projects,
    meetingFiles: meetings,
  }
}
