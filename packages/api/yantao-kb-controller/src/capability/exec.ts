/**
 * The execution bridge (ADR-0043 决定 2, 路线二): the agent may run a script
 * *inside an installed capability's own directory* — the host's answer to the
 * instruction-capability step "执行 python foo.py" and to a capability's own
 * CLI. The trust model is ADR-0021's, unchanged: installation is
 * authorization. A skill directory the human installed is trusted code, the
 * agent is only the hand that flips the switch — so the bridge audits no
 * verbs and reviews no command text. The one remaining limit is
 * `directory`: the resolved capability directory must stay under the KB's
 * own `.dsh/skills/`, and the subprocess's `cwd` is pinned to it.
 *
 * The envelope mirrors the declarative channel's (`run.ts`): `KB_ROOT`,
 * `CAPABILITY_NAME`, and `CAPABILITY_CHANNEL=agent` ride the environment,
 * and one JSON object (`name`, `kbRoot`, `input`, `channel`) is written to
 * stdin before it closes — so a script can serve both channels unchanged.
 * Unlike `runCapability`, stdout is *not* a JSON contract: it comes back
 * verbatim, capped alongside stderr, and the exit code — not parsed output —
 * decides `ok`.
 *
 * The environment note ({@link CAPABILITY_ENVIRONMENT_NOTE}) is the single
 * source every channel prefixes (ADR-0043 决定 3): instruction-capability
 * answers and the script-type `/name` notice carry the same host-owned
 * words, so a third-party SKILL.md never has to learn them.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/exec
 */
import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import type { SpawnLike } from '../open.ts'
import { CapabilityError } from './run.ts'

/**
 * The host-owned environment note (ADR-0043 决定 3), prefixed wherever a
 * capability's own words are handed to the model: the instruction
 * capability's SKILL.md body, and the script-type `/name` notice. The core
 * semantics stay in the (untouched) SKILL.md; these are the host facts.
 */
export const CAPABILITY_ENVIRONMENT_NOTE =
  '【环境说明】\n'
  + '- 本工作台没有通用 shell；技能指令里「执行 python xxx」这类步骤，用 kb_exec_capability_script 在该能力的目录内执行（cwd 锁定该目录，KB_ROOT 等信封经环境变量与 stdin 送达）。\n'
  + '- 能力的声明式调用走 kb_run_capability。\n'
  + '- 未特别说明时，「资源」指知识库的 resources/ 目录。\n'
  + '- 能力产出的落盘是脚本自己的事，真实位置以返回为准。'

/** Options of {@link execCapabilityScript}. */
export interface ExecCapabilityScriptOptions {
  /** The capability's kebab-case name (echoed in the envelope). */
  readonly name: string
  /** Absolute path of the KB's `.dsh/skills/` — the directory's confine. */
  readonly skillsRoot: string
  /**
   * Absolute path of the capability's skill directory; the subprocess's
   * `cwd`. Must resolve inside `skillsRoot`, or the run is refused before
   * anything spawns.
   */
  readonly directory: string
  /**
   * The command line, run through the platform shell (`cmd /d /s /c` on
   * Windows, `/bin/sh -c` elsewhere). Not reviewed (ADR-0043 决定 2): the
   * capability is installed, therefore trusted; the directory is the limit.
   */
  readonly command: string
  /** The live KB root, handed to the script as `KB_ROOT` and in the envelope. */
  readonly kbRoot: string
  /** The caller's free-text input, handed to the script in the envelope. */
  readonly input?: string
  /** How long the command may run before it is killed; defaults to 120s. */
  readonly timeoutMs?: number
  /** The spawn to use; tests pass a fake so no shell is ever touched. */
  readonly spawn?: SpawnLike
}

/** What one bridge run answered. */
export interface ExecCapabilityScriptResult {
  /** True exactly when the command exited with code 0. */
  readonly ok: boolean
  /** The process's exit code, or `null` when it never exited (killed, or the shell never started). */
  readonly exitCode: number | null
  /** Everything the command wrote to stdout, capped at 64KB with a truncation marker. */
  readonly stdout: string
  /** Everything the command wrote to stderr, capped at 64KB with a truncation marker. */
  readonly stderr: string
}

/** How long a bridged command may run before it is killed. */
export const CAPABILITY_EXEC_TIMEOUT_MS = 120_000

/** How much of each stream is kept before truncation is marked. */
const MAX_EXEC_OUTPUT_BYTES = 64 * 1024

/** The marker appended to a stream that outgrew its cap. */
const TRUNCATION_MARKER = '\n…（输出超过 64KB，已截断）'

/**
 * Run one command inside an installed capability's directory (ADR-0043
 * 决定 2). One subprocess through the platform shell, `cwd` pinned, the
 * envelope delivered by environment and stdin. Every outcome — a non-zero
 * exit, a missing shell, a timeout — is reported in the result, never
 * thrown; only a `directory` escaping `skillsRoot` throws, before spawn.
 * @param options - see {@link ExecCapabilityScriptOptions}.
 * @returns the exit code and the capped streams.
 */
export async function execCapabilityScript(
  options: ExecCapabilityScriptOptions,
): Promise<ExecCapabilityScriptResult> {
  const skillsRoot = resolve(options.skillsRoot)
  const directory = resolve(options.directory)
  if (!directory.startsWith(skillsRoot + sep)) {
    throw new CapabilityError(
      'bad-manifest',
      `能力「${options.name}」的目录越出了 .dsh/skills/，拒绝在其中执行脚本：${options.directory}`,
      '请确认该能力的技能目录在知识库的 .dsh/skills/ 下。',
    )
  }
  const {
    spawn: spawnImpl = spawn,
    timeoutMs = CAPABILITY_EXEC_TIMEOUT_MS,
  } = options

  const child = spawnImpl(options.command, [], {
    cwd: directory,
    env: {
      ...process.env,
      KB_ROOT: options.kbRoot,
      CAPABILITY_NAME: options.name,
      CAPABILITY_CHANNEL: 'agent',
      PYTHONIOENCODING: 'utf-8',
    },
    shell: true,
    windowsHide: true,
  })

  const envelope = JSON.stringify({
    name: options.name,
    kbRoot: options.kbRoot,
    input: options.input ?? null,
    state: null,
    channel: 'agent',
  })

  return new Promise<ExecCapabilityScriptResult>((resolveRun) => {
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let settled = false

    const timer = setTimeout(() => {
      settle(() => {
        child.kill()
        finish(null, `\n…（超过 ${timeoutMs}ms 未结束，进程已终止）`)
      })
    }, timeoutMs)

    /** End the run once; whatever the process does afterwards is ignored. */
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    /** Assemble the result; `extraStderr` carries the timeout's own note. */
    const finish = (exitCode: number | null, extraStderr = ''): void => {
      resolveRun({
        ok: exitCode === 0,
        exitCode,
        stdout: stdoutTruncated ? stdout + TRUNCATION_MARKER : stdout,
        stderr: (stderrTruncated ? stderr + TRUNCATION_MARKER : stderr) + extraStderr,
      })
    }

    child.stdin.on('error', () => {
      // A process that exits before reading stdin breaks the pipe; the close
      // handler reports the real outcome, so this only keeps the stream
      // error from crashing the host.
    })
    child.stdin.end(envelope, 'utf8')

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (stdout.length > MAX_EXEC_OUTPUT_BYTES) {
        stdoutTruncated = true
        return
      }
      stdout += String(chunk)
      if (stdout.length > MAX_EXEC_OUTPUT_BYTES) {
        stdout = stdout.slice(0, MAX_EXEC_OUTPUT_BYTES)
        stdoutTruncated = true
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderr.length > MAX_EXEC_OUTPUT_BYTES) {
        stderrTruncated = true
        return
      }
      stderr += String(chunk)
      if (stderr.length > MAX_EXEC_OUTPUT_BYTES) {
        stderr = stderr.slice(0, MAX_EXEC_OUTPUT_BYTES)
        stderrTruncated = true
      }
    })
    child.on('error', (error: Error) => {
      // The platform shell itself failed to start.
      settle(() => {
        finish(null, `无法启动平台 shell：${error.message}`)
      })
    })
    child.on('close', (code: number | null) => {
      settle(() => {
        finish(code)
      })
    })
  })
}
