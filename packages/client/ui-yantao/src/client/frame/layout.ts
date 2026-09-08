/**
 * The `ctx.layout` face the workbench frame provides (ADR-0011). Upstream's
 * face is named after ITS columns — sidebar and details — so this one maps
 * those two onto ours: sidebar → the intake rail, details → the workspace
 * rail. ui-chat injects `layout` and calls `openDetails` / `closeDetails`,
 * which is how a plugin asks the frame to show or hide the right rail.
 *
 * The frame owns the state; this class is a forwarder over a mutable seat the
 * frame fills on mount, so an early call (before mount) is a silent no-op
 * rather than an error.
 */

/** The panel toggles the mounted frame publishes into its seat. */
export interface PanelToggles {
  /** Collapse or expand the intake rail. */
  toggleIntake(): void
  /** Expand the workspace rail. */
  openWorkspace(): void
  /** Collapse the workspace rail. */
  closeWorkspace(): void
}

/** A seat whose members are no-ops until the frame claims them. */
export function createPanelSeat(): PanelToggles {
  return { toggleIntake: () => {}, openWorkspace: () => {}, closeWorkspace: () => {} }
}

/** The cross-plugin panel-action face behind `ctx.layout`. */
export class WorkbenchLayout {
  readonly #seat: PanelToggles

  /** @param seat - the mutable seat the frame fills on mount. */
  constructor(seat: PanelToggles) {
    this.#seat = seat
  }

  /** Toggle the intake rail (upstream's `sidebar`). */
  toggleSidebar(): void {
    this.#seat.toggleIntake()
  }

  /** Open the workspace rail (upstream's `details`). */
  openDetails(): void {
    this.#seat.openWorkspace()
  }

  /** Close the workspace rail (upstream's `details`). */
  closeDetails(): void {
    this.#seat.closeWorkspace()
  }
}
