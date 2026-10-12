/**
 * The proposal card's keyboard-verdict seat (2026-10-12 评审 P2-1). The
 * verdict keys (J/K 光标、Space 勾选、Enter 确认写入) register through the
 * shared shortcuts framework's fixed-command path — bare keys the web
 * whitelist refuses for editable commands, delivered here as owner-arbitrated
 * local input (group `approval`). The registry lives at plugin level, but only
 * the mounted card knows its row geometry, so the card claims this seat while
 * alive and the shortcuts installer forwards qualifying fixed input to it.
 *
 * The seat is a module singleton on purpose: the proposal card is a modal —
 * at most one is ever mounted (the inbox opens one card at a time, the
 * validate card replaces the pane) — and the seat pattern mirrors
 * `createPanelSeat`: an absent occupant makes the keys silent no-ops rather
 * than errors. The handler is pure navigation plus synthetic clicks on the
 * card's own controls; every verdict still lands on the human's hands.
 */

/** What the mounted proposal card answers. Each call is one keystroke's worth. */
export interface ProposalVerdictHandler {
  /** Move the row cursor down one visible row (clamped at the end). */
  moveDown(): void
  /** Move the row cursor up one visible row (clamped at the start). */
  moveUp(): void
  /** Tick or untick the row under the cursor (synthetic checkbox click). */
  toggleTick(): void
  /** Press the footer's 确认写入 button (no-op while disabled). */
  confirmWrite(): void
}

/** The `data-shortcut-modal` id the proposal card stamps on its dialog. */
export const PROPOSAL_MODAL_ID = 'proposal'

/** Held by the mounted proposal card; null whenever no card is open. */
export const proposalVerdictSeat: { current: ProposalVerdictHandler | null } = { current: null }
