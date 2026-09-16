/**
 * A translate face bound to the zh truth, for rendering workbench components
 * in specs without the locale runtime. Resolution mirrors the locale plugin's
 * lookup chain: the workbench dictionary, then the shared common vocabulary,
 * then the raw key; interpolation mirrors its `{name}` template form.
 */
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh, type WorkbenchT } from '../src/client/locales.ts'

function testT(key: Parameters<WorkbenchT>[0], params?: Record<string, unknown>): string {
  const dicts: Record<string, string>[] = [zh, commonZh]
  let text: string = key
  for (const dict of dicts) {
    const hit = dict[key]
    if (hit !== undefined) {
      text = hit
      break
    }
  }
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** The same face, typed as the components see it. */
export const t: WorkbenchT = testT
