/**
 * The 提议 tab's "next undecided" seat (2026-10-24 评审 P2).
 *
 * The command that jumps to the next pending proposal lives at plugin level,
 * but only the inbox pane knows which card is open and which rows are pending,
 * so the pane claims this seat while mounted and the shortcuts installer
 * forwards the keystroke to it. Same pattern as
 * {@link ./proposal-verdict-seat.ts}: a module singleton, because at most one
 * inbox pane is ever mounted, and an absent occupant makes the key a silent
 * no-op rather than an error.
 *
 * Opening a card is navigation, never a verdict: the card still waits for the
 * human's own keys (J/K/Space/Enter) and its footer button.
 */
export const inboxSeat: { current: (() => void) | null } = { current: null }
