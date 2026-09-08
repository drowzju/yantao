import { describe, expect, it } from 'vitest'
import {
  initialEditorState,
  isDirty,
  isReadOnlyKbPath,
  SECTION_LABEL_KEYS,
  withDraft,
  withSaved,
} from '../src/client/editor-state.ts'

describe('editor state transitions', () => {
  it('starts clean for freshly loaded content', () => {
    const state = initialEditorState('---\ntype: project\n---\n')
    expect(isDirty(state)).toBe(false)
  })

  it('turns dirty on any draft divergence and clean again on save', () => {
    let state = initialEditorState('## 状态\n')
    state = withDraft(state, '## 状态\n\n进行中\n')
    expect(isDirty(state)).toBe(true)
    state = withSaved(state)
    expect(isDirty(state)).toBe(false)
    expect(state.saved).toBe('## 状态\n\n进行中\n')
    expect(state.draft).toBe('## 状态\n\n进行中\n')
  })

  it('keeps the saved baseline across draft edits until save', () => {
    let state = initialEditorState('one')
    state = withDraft(state, 'two')
    state = withDraft(state, 'three')
    expect(state.saved).toBe('one')
    expect(state.draft).toBe('three')
  })
})

describe('isReadOnlyKbPath', () => {
  it('marks resources originals read-only', () => {
    expect(isReadOnlyKbPath('resources/周报.eml')).toBe(true)
    expect(isReadOnlyKbPath('resources/照片.png')).toBe(true)
  })
  it('lets shadow notes and entity files be editable', () => {
    expect(isReadOnlyKbPath('resources/周报.eml.md')).toBe(false)
    expect(isReadOnlyKbPath('entities/projects/dsh 学习.md')).toBe(false)
    expect(isReadOnlyKbPath('sessions/2026-09-01.md')).toBe(false)
  })
})

describe('section label keys', () => {
  it('covers the six KB sections in domain order, then the live-session heading', () => {
    expect(Object.keys(SECTION_LABEL_KEYS)).toEqual([
      'resources',
      'meetings',
      'todos',
      'projects',
      'areas',
      'people',
      'sessions',
    ])
  })
})
