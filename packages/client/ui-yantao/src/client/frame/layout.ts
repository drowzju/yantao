/**
 * The `ctx.layout` face the workbench frame provides (ADR-0011). Upstream's
 * face is named after ITS columns — sidebar and details — so this one maps
 * the sidebar toggle onto ours: sidebar → the intake rail.
 *
 * 0.2.1 reshaped the face (`ILayout`): the session-navigation protocol
 * (`beginNavigation`, read by ui-workspace around every session create/
 * restore) and the global-panel selection (`panelInfo` + `selectPanel`)
 * joined it, while the details open/close pair dissolved into the
 * right-panel reporter that ui-sidebar-right owns — a plugin the workbench
 * stack does not load (ADR-0011 exclusion; our `sidebarRight` stand-in
 * answers it instead). The workbench registers no global panels, so
 * `panelInfo` is a constant "conversation selected" snapshot and
 * `selectPanel` rejects every non-null id, mirroring upstream's
 * unregistered-panel error.
 *
 * The frame owns the toggles; this class is a forwarder over a mutable seat
 * the frame fills on mount, so an early call (before mount) is a silent
 * no-op rather than an error.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

/** The panel toggle the mounted frame publishes into its seat. */
export interface PanelToggles {
  /** Collapse or expand the intake rail. */
  toggleIntake(): void
}

/** A seat whose members are no-ops until the frame claims them. */
export function createPanelSeat(): PanelToggles {
  return { toggleIntake: () => {} }
}

/** The workbench's constant panel state: only the Conversation exists. */
const CONVERSATION_ONLY_PANEL: PanelInfo = { activePanelId: null }

const CONVERSATION_ONLY_PANEL_INFO: HostObservable<PanelInfo> = {
  getSnapshot: () => CONVERSATION_ONLY_PANEL,
  subscribe: () => () => {},
}

/** The cross-plugin panel-action face behind `ctx.layout`. */
export class WorkbenchLayout implements ILayout {
  readonly #seat: PanelToggles
  #navigation = new AbortController()

  /** @param seat - the mutable seat the frame fills on mount. */
  constructor(seat: PanelToggles) {
    this.#seat = seat
  }

  /** The root store's panel selection — always the Conversation here. */
  readonly panelInfo: HostObservable<PanelInfo> = CONVERSATION_ONLY_PANEL_INFO

  /**
   * Select a global panel. None are registered in the workbench, so any
   * non-null id is rejected exactly as upstream rejects an unregistered one;
   * `null` (return to the Conversation) is the accepted call.
   */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    this.#navigation.abort()
  }

  /** @returns the new pending navigation's cancellation signal. */
  beginNavigation(): AbortSignal {
    this.#navigation.abort()
    this.#navigation = new AbortController()
    return this.#navigation.signal
  }

  /**
   * Right-panel presentation reports: accepted and dropped. The reporter's
   * owner (ui-sidebar-right) is not in the workbench stack — our
   * `sidebarRight` stand-in answers it — so no report can arrive today, and
   * the workbench frame has no upstream-style right-panel track to reserve.
   */
  openRightbar(): void {}

  /** See {@link WorkbenchLayout.openRightbar}. */
  closeRightbar(): void {}

  /** Toggle the intake rail (upstream's `sidebar`). */
  toggleSidebar(): void {
    this.#seat.toggleIntake()
  }

  /** Tear down on plugin unload: abort any pending navigation. */
  dispose(): void {
    this.#navigation.abort()
  }
}
