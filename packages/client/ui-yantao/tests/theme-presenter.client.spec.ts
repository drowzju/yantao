// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ThemePresenter } from '../src/client/frame/theme-presenter.ts'
import { YT_COLOR_TOKENS, YT_STATIC_TOKENS, ytTokensFor } from '../src/client/frame/yt-tokens.ts'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

afterEach(() => {
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.removeAttribute('style')
})

/** A minimal snapshot for one scheme — the presenter reads only these fields. */
function snapshot(scheme: 'light' | 'dark'): ThemeSnapshot {
  return {
    preference: scheme,
    fontSize: 14,
    active: { id: scheme, colorScheme: scheme, tokens: { '--ds-demo-alias': '#123456' } },
    themes: [],
    revision: 0,
  }
}

describe('ThemePresenter --yt-* tokens', () => {
  it('writes the light colour set plus the static ladders on apply', () => {
    new ThemePresenter().apply(snapshot('light'))
    const body = document.body
    for (const [name, value] of Object.entries(ytTokensFor('light'))) {
      expect(body.style.getPropertyValue(name)).toBe(value)
    }
    expect(body.style.getPropertyValue('--yt-surface-primary')).toBe(YT_COLOR_TOKENS.light['--yt-surface-primary'])
    expect(body.style.getPropertyValue('--yt-type-body')).toBe(YT_STATIC_TOKENS['--yt-type-body'])
  })

  it('rewrites the colour set when the scheme flips, keeping the ladders', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    presenter.apply(snapshot('dark'))
    const body = document.body
    for (const [name, value] of Object.entries(YT_COLOR_TOKENS.dark)) {
      expect(body.style.getPropertyValue(name)).toBe(value)
    }
    expect(body.style.getPropertyValue('--yt-surface-primary')).not.toBe(YT_COLOR_TOKENS.light['--yt-surface-primary'])
    expect(body.style.getPropertyValue('--yt-space-3')).toBe(YT_STATIC_TOKENS['--yt-space-3'])
  })

  it('retracts every --yt-* name on dispose', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    presenter.dispose()
    const body = document.body
    for (const name of Object.keys(ytTokensFor('light'))) {
      expect(body.style.getPropertyValue(name)).toBe('')
    }
  })
})
