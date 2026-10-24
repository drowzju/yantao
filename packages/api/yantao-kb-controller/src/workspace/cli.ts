/**
 * The workspace CLI options (2026-10-23): the codebuddy CLI's headless runs
 * normally ride the operator's interactive login. An API key lifts that
 * dependency — a cron fire no longer dies quietly when the login token ages
 * out — and an explicit model choice pins the chain away from whatever the
 * CLI's last-used model happens to be. Both arrive as environment variables
 * and an argv token at spawn time; nothing here touches the interactive
 * session channels.
 *
 * The key travels only through the credentials store and this module's env
 * assembly — never a settings document, never a log line (hard rule 5).
 *
 * Verified 2026-10-23 (d:/temp smoke): the stripped environment of the
 * runtime's spawnEnv plus exactly CODEBUDDY_API_KEY +
 * CODEBUDDY_INTERNET_ENVIRONMENT answers in seconds with skills/MCP/slash
 * commands all loaded, and 'codebuddy --help' enumerates the supported model
 * ids inline — no interactive /model needed.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace/cli
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'

/** The credential reference the workspace CLI's API key stores under. */
export const WORKSPACE_CLI_KEY_REF = 'WORKSPACE_CLI_API_KEY'

/** The settings namespace holding the non-secret half of the CLI config. */
/** The settings namespace is the controller plugin's own profile entry id:
 * settings.replace/update address plugin entries by id, so the CLI config
 * rides the yantao-kb-controller entry's Config schema (volatile fields). */
export const WORKSPACE_CLI_NAMESPACE = 'yantao-kb-controller'

/**
 * What one headless spawn needs beyond the stripped environment. All fields
 * optional: an absent piece falls back to the CLI's own default (login-state
 * auth, last-used model, ambient CODEBUDDY_INTERNET_ENVIRONMENT).
 */
export interface WorkspaceCliOptions {
  /** The raw API key, already resolved from the credentials store. */
  readonly apiKey?: string
  /** Which CodeBuddy edition endpoint family to target (e.g. cloudhosted). */
  readonly internetEnvironment?: string
  /** The global default model id, used when the workspace binds none. */
  readonly model?: string
}

/**
 * The effective options for one probe (2026-10-23): 测试连接 must test the
 * dialog's current draft, not the last saved configuration — otherwise an
 * unsaved model or endpoint reports on a configuration the human is no longer
 * looking at.
 *
 * Semantics per field: absent = keep the stored value; empty string = clear
 * it (the CLI decides). The key is the exception — an empty key draft means
 * "probe with the stored credential", since the form never shows the stored
 * value and blank therefore cannot mean "delete it".
 * @param draft - the dialog's current fields.
 * @param stored - what the settings/credentials store already holds.
 * @returns the options the probe should run with.
 */
export function probeOptions(
  draft: { readonly model?: string; readonly internetEnvironment?: string; readonly apiKey?: string },
  stored: WorkspaceCliOptions,
): WorkspaceCliOptions {
  const pick = (draftValue: string | undefined, storedValue: string | undefined): string | undefined => {
    if (draftValue === undefined) return storedValue
    return draftValue === '' ? undefined : draftValue
  }
  const apiKey = draft.apiKey !== undefined && draft.apiKey !== '' ? draft.apiKey : stored.apiKey
  const model = pick(draft.model, stored.model)
  const internetEnvironment = pick(draft.internetEnvironment, stored.internetEnvironment)
  return {
    ...(model !== undefined ? { model } : {}),
    ...(internetEnvironment !== undefined ? { internetEnvironment } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
  }
}

/**
 * Layer the CLI options onto a stripped environment. Values win over the
 * inherited environment by construction — the stripper already removed every
 * CODEBUDDY_* variable, so these two names cannot collide with the parent
 * session's identity variables the strip exists to remove.
 * @param env - the stripped environment (mutated in place).
 * @param cli - the resolved options, when configured.
 * @returns the same object, for call-site fluency.
 */
export function applyCliEnv(env: NodeJS.ProcessEnv, cli: WorkspaceCliOptions | undefined): NodeJS.ProcessEnv {
  if (cli === undefined) return env
  if (cli.apiKey !== undefined && cli.apiKey !== '') env.CODEBUDDY_API_KEY = cli.apiKey
  if (cli.internetEnvironment !== undefined && cli.internetEnvironment !== '') {
    env.CODEBUDDY_INTERNET_ENVIRONMENT = cli.internetEnvironment
  }
  return env
}

/**
 * The effective --model for one chain: the workspace's own binding wins
 * (per-space intent beats a global default), the global default answers when
 * the workspace binds none, and no configuration at all means the CLI decides.
 * @param spaceModel - the workspace definition's model binding, when present.
 * @param cli - the resolved global options, when configured.
 * @returns the model id to pass as --model, or undefined for none.
 */
export function resolveStepModel(spaceModel: string | undefined, cli: WorkspaceCliOptions | undefined): string | undefined {
  if (spaceModel !== undefined && spaceModel !== '') return spaceModel
  const global = cli?.model
  return global !== undefined && global !== '' ? global : undefined
}

/**
 * Pull the supported model ids out of one 'codebuddy --help' text. The
 * '--model <model>' line ends with a parenthesized comma-separated id list
 * (verified 2026-10-23, CLI 2.172.1); anything else about the line is prose
 * and ignored.
 * @param helpText - the CLI's combined stdout/stderr.
 * @returns the model ids, in the order the CLI lists them.
 */
export function parseModelIds(helpText: string): string[] {
  const line = helpText.split(/\r?\n/).find(candidate => candidate.includes('--model'))
  if (line === undefined) return []
  const open = line.lastIndexOf('(')
  const close = line.lastIndexOf(')')
  if (open === -1 || close === -1 || close <= open) return []
  return line.slice(open + 1, close)
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
}

/** One settled probe answer. */
export interface CliProbeOutcome {
  /** Whether the CLI answered a parsable success result. */
  readonly ok: boolean
  /** The result text on success, or the diagnostic on any failure. */
  readonly detail: string
}

/**
 * Run one minimal headless call against the configured CLI: the 测试连接
 * gesture's engine. Spawns 'codebuddy -p -y --output-format json' with a
 * one-word prompt and bounds the wait — unlike the workspace chains
 * (ADR-0056 决定 4: deliberately untimed), a probe is an interactive gesture
 * whose whole point is a timely answer.
 * @param options - the CLI options to probe (key, network environment, model).
 * @param spawnImpl - the spawn to use; tests swap this.
 * @param timeoutMs - how long the probe may run before its tree is killed.
 * @returns the probe outcome, never a rejection (spawn errors included).
 */
export function probeCodebuddy(
  options: WorkspaceCliOptions,
  spawnImpl: typeof nodeSpawn,
  timeoutMs = 60_000,
): Promise<CliProbeOutcome> {
  return new Promise((resolveProbe) => {
    const args = ['-p', '-y', '--output-format', 'json']
    const model = resolveStepModel(undefined, options)
    if (model !== undefined) args.push('--model', model)
    let child: ChildProcess
    try {
      child = spawnImpl('codebuddy', args, {
        env: applyCliEnv(stripSessionEnv(), options),
        shell: true, // Windows: the npm shim is a .cmd; the prompt rides stdin
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: unknown) {
      resolveProbe({ ok: false, detail: '无法启动 codebuddy：' + (error as Error).message })
      return
    }
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const pid = child.pid
      if (pid !== undefined && pid > 0 && process.platform === 'win32') {
        spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
      settle({ ok: false, detail: '探测超时（' + Math.round(timeoutMs / 1000) + ' 秒无应答）' })
    }, timeoutMs)
    const settle = (outcome: CliProbeOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveProbe(outcome)
    }
    child.on('error', (error: Error) => { settle({ ok: false, detail: '无法启动 codebuddy：' + error.message }) })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end('只回答两个字符：OK', 'utf8')
    child.stdout?.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    })
    child.on('close', (code: number | null) => {
      const stdout = Buffer.concat(chunks).toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8').trim()
      if (code !== 0) {
        settle({ ok: false, detail: '退出码 ' + (code ?? '未知') + (stderr !== '' ? '：' + stderr.slice(-2000) : '') })
        return
      }
      // The buffered json format prints one event ARRAY at exit; the result
      // event carries the answer. (Same contract as output-parse.ts.)
      try {
        const parsed: unknown = JSON.parse(stdout)
        const events = Array.isArray(parsed) ? parsed : [parsed]
        let result: Record<string, unknown> | undefined
        for (let at = events.length - 1; at >= 0; at -= 1) {
          const entry = events[at]
          if (typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).type === 'result') {
            result = entry as Record<string, unknown>
            break
          }
        }
        if (result === undefined) {
          settle({ ok: false, detail: '输出里没有 result 事件' })
          return
        }
        if (result.is_error === true) {
          settle({ ok: false, detail: 'codebuddy 报告失败：' + String(result.result ?? '').slice(0, 2000) })
          return
        }
        settle({ ok: true, detail: String(result.result ?? '') })
      } catch {
        settle({ ok: false, detail: '输出无法解析：' + stdout.slice(0, 500) })
      }
    })
  })
}

/**
 * The inherited environment minus the session-scoped variables — the same
 * narrowing runtime.ts performs before a workspace spawn. Kept as a twin here
 * (rather than imported) so the probe stays usable from the controller's RPC
 * layer without reaching into the runtime's internals.
 * @returns the stripped environment.
 */
function stripSessionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(?:CODEBUDDY_|SERVER__|TRACEPARENT$|BAGGAGE$)/.test(key)) env[key] = value
  }
  return env
}
