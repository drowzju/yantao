import { describe, expect, it } from 'vitest'
import { cronNextAfter as hostNextAfter, parseCron as hostParse } from '@deepseek-ai/dsh-yantao-kb'
import { cronNextAfter as clientNextAfter, parseCron as clientParse } from '../../../client/ui-yantao/src/client/cron.ts'

/**
 * The parity gate (ADR-0056 决定 1): the host matcher in
 * `packages/yantao/kb/src/cron.ts` is a deliberate twin of the client's
 * `ui-yantao/src/client/cron.ts` — the controller cannot import from a
 * client package (web bundle purity), but the workspace tick must decide
 * due/missed with the SAME arithmetic the 调度 tab previews. A drift between
 * the two copies would make the UI's next-fire display lie about when the
 * controller will actually fire. This spec walks a grid of expressions
 * across month boundaries and a leap February and pins the two matchers
 * equal, minute for minute.
 */

/** Expressions covering every feature the parser supports. */
const EXPRESSIONS = [
  '* * * * *',
  '0 9 * * *',
  '*/15 * * * *',
  '30 8 1 * *',
  '0 9 * * 1-5',
  '5 4 * * 0',
  '59 23 * * 7',
  '0 12 1-15/2 * *',
  '0 0 29 2 *',
  '15,45 8-11 * * *',
  '0 9-17/2 * * 1,3,5',
] as const

/** Moments straddling a month boundary, a Sunday, and DST-neutral zones. */
function sampleMoments(): Date[] {
  const moments: Date[] = []
  const push = (iso: string): void => moments.push(new Date(iso))
  // Month boundary + weekend rollover.
  for (let day = 27; day <= 31; day += 1) {
    push(`2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`)
    push(`2026-10-${String(day).padStart(2, '0')}T23:59:00.000Z`)
  }
  // Leap-year February edge (the 29th exists in 2028).
  push('2028-02-27T12:00:00.000Z')
  push('2028-02-28T23:30:00.000Z')
  push('2028-03-01T00:00:00.000Z')
  // Year boundary.
  push('2026-12-31T23:59:00.000Z')
  return moments
}

describe('cron parity: host twin vs client matcher', () => {
  it('parses identically across the expression grid', () => {
    for (const expression of EXPRESSIONS) {
      expect(hostParse(expression), expression).not.toBeNull()
      expect(clientParse(expression), expression).not.toBeNull()
      expect(JSON.stringify(hostParse(expression)), expression)
        .toBe(JSON.stringify(clientParse(expression)))
    }
  })

  it('refuses the same malformed expressions', () => {
    for (const expression of ['61 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '8 * * * 8', 'a b c d e', '* * * *']) {
      expect(hostParse(expression), expression).toBeNull()
      expect(clientParse(expression), expression).toBeNull()
    }
  })

  it('computes identical next fires across the moment grid', () => {
    for (const expression of EXPRESSIONS) {
      const host = hostParse(expression)
      const client = clientParse(expression)
      expect(host).not.toBeNull()
      expect(client).not.toBeNull()
      for (const moment of sampleMoments()) {
        expect(hostNextAfter(host!, moment).getTime(), `${expression} from ${moment.toISOString()}`)
          .toBe(clientNextAfter(client!, moment).getTime())
      }
    }
  })
})
