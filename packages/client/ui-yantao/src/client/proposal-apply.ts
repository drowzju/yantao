/**
 * Applying a proposal (ADR-0021 决定 4): the one place where ticked actions
 * become KB writes, and it runs strictly after the human has ticked them.
 *
 * ADR-0060 决定 7: the engine and the unified proposal schema moved to the
 * controller's shared module — ONE implementation both human channels run
 * (the workbench binds the seams to its remote proxies; the controller binds
 * the same seams to its own methods behind `proposalInboxApply`). This module
 * is the client face of that shared module: a pure re-export, so every
 * import in the workbench keeps its shape. The client-side callers (the
 * card-flow confirm and the mail run's auto-apply) execute the same shared
 * function the DingTalk approval card reaches through the server RPC.
 * @module @deepseek-ai/dsh-client-ui-yantao/proposal-apply
 */
export * from '@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply'
