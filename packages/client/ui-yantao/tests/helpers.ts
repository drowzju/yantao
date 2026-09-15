/**
 * A translate face bound to the zh truth, for rendering workbench components
 * in specs without the locale runtime. Interpolation mirrors the locale
 * plugin's `{name}` template form.
 */
import { zh, type WorkbenchLocaleKey, type WorkbenchT } from '../src/client/locales.ts'

export function testT(key: WorkbenchLocaleKey, params?: Record<string, unknown>): string {
  let text = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** The same face, typed as the components see it. */
export const t: WorkbenchT = testT
