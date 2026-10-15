/**
 * The frame's per-tab rail widths (2026-10-15 截图评审，B 方案): each rail tab
 * declares a comfort width, applied on tab switch; a rail drag rewrites the
 * active tab's entry so a hand-tuned width survives restarts. Pure, same
 * recipe as `tabs.ts` — the frame feeds it storage and owns the React state.
 * @module @deepseek-ai/dsh-client-ui-yantao/frame/rail-widths
 */

/** localStorage key for the per-tab rail width preferences. */
export const RAIL_WIDTHS_STORAGE_KEY = 'yantao.frame.railWidths'

/** The slice of `window.localStorage` this module needs — a seam for tests. */
export interface RailWidthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Per-tab width preferences for both rails, keyed by tab id. */
export interface RailWidthPrefs {
  /** The intake (left) rail's tabs. */
  readonly intake: Record<string, number>
  /** The right rail's entity tabs (领域/人物/项目/会议). */
  readonly entities: Record<string, number>
}

/** Which rail a width preference belongs to. */
export type RailSide = keyof RailWidthPrefs

/** Empty preference set — every tab falls back to its comfort width. */
export function emptyRailWidths(): RailWidthPrefs {
  return { intake: {}, entities: {} }
}

/** Comfort widths for the intake rail's tabs; unlisted tabs take the rail default. */
export const INTAKE_COMFORT_WIDTHS: Readonly<Record<string, number>> = {
  // 工作空间 (ADR-0056): the instruction table's five columns need more than
  // the 280 default — 360 leaves the name column ~100px before ellipsis.
  workspace: 360,
}

/** Comfort widths for the right rail's entity tabs; all take the default today. */
export const ENTITIES_COMFORT_WIDTHS: Record<string, number> = {}

/** The rail default every unlisted tab falls back to (must match the frame's RAIL_DEFAULT). */
const RAIL_FALLBACK = 280

/**
 * The comfort width of one tab: its declared value, else the rail default.
 * @param side - which rail the tab lives in.
 * @param tabId - the tab's id.
 * @returns the comfort width in px.
 */
export function comfortWidth(side: RailSide, tabId: string): number {
  const map = side === 'intake' ? INTAKE_COMFORT_WIDTHS : ENTITIES_COMFORT_WIDTHS
  return map[tabId] ?? RAIL_FALLBACK
}

/**
 * Read the stored per-tab widths. A missing or unreadable entry yields the
 * empty set — a corrupt blob must never widen a rail, only lose the memory.
 * @param storage - the storage to read (defaults to `window.localStorage`).
 * @returns the parsed preferences.
 */
export function readRailWidths(storage: RailWidthStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): RailWidthPrefs {
  if (storage === undefined) return emptyRailWidths()
  try {
    const raw = storage.getItem(RAIL_WIDTHS_STORAGE_KEY)
    if (raw === null) return emptyRailWidths()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyRailWidths()
    const { intake, entities } = parsed as Record<string, unknown>
    return {
      intake: numericMap(intake),
      entities: numericMap(entities),
    }
  } catch {
    return emptyRailWidths()
  }
}

/** Keep only finite positive numbers from one stored rail's map. */
function numericMap(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
  }
  return out
}

/**
 * Write the per-tab widths through. Best-effort: quota or privacy-mode
 * failures degrade to "the width is forgotten", never to a crash.
 * @param prefs - the preferences to store.
 * @param storage - the storage to write (defaults to `window.localStorage`).
 */
export function persistRailWidths(prefs: RailWidthPrefs, storage: RailWidthStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (storage === undefined) return
  try {
    storage.setItem(RAIL_WIDTHS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Quota exceeded / storage unavailable — the drag still took visual effect.
  }
}
