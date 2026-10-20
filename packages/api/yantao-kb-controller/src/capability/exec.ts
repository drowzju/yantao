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
 * The envelope mirrors the mail dedicated RPC's (`run.ts`, the one surviving
 * spawn channel): `KB_ROOT`, `CAPABILITY_NAME`, and `CAPABILITY_CHANNEL=agent`
 * ride the environment, and one JSON object (`name`, `kbRoot`, `input`,
 * `state`, `channel`) is written to stdin before it closes — so a script can
 * serve both channels unchanged. Two envelope upgrades (2026-10-10, the mail
 * run's detour lesson): an `input` whose text parses as a JSON object is
 * delivered **parsed** — the dedicated RPC always hands scripts a dict, and a
 * verbatim string forced entry.py to fall back to its default window; and
 * `state` carries the capability's persisted checkpoint from the KB's
 * `state.json` (fail-open to null) instead of a constant null. Unlike
 * `runCapability`, stdout is *not* a JSON contract: it comes back verbatim,
 * capped alongside stderr, and the exit code — not parsed output — decides
 * `ok`.
 *
 * The environment note ({@link CAPABILITY_ENVIRONMENT_NOTE}) is the single
 * source every channel prefixes (ADR-0043 决定 3): instruction-capability
 * answers and the script-type `/name` notice carry the same host-owned
 * words, so a third-party SKILL.md never has to learn them.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/exec
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { SpawnLike } from '../open.ts'
import { CapabilityError } from './run.ts'
import { stagingPathOf } from './proposal-staging.ts'

/**
 * One run's scratch ledger path (the mail capability's body dedup ledger,
 * 2026-10-20 邮件窗口去重): a file under the KB's operational area, named by
 * the sanitized run token. The SCRIPT owns the file's contents — the bridge
 * only picks the path, so concurrent calls in one run merge best-effort and
 * a missing file means「no dedup」, never an error.
 * @param kbRoot - the live KB root.
 * @param runToken - the calling session's id.
 * @returns an absolute path inside `<kbRoot>/.dsh/yantao/run-ledgers/`.
 */
export function runLedgerPathOf(kbRoot: string, runToken: string): string {
  const safe = runToken.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'anonymous'
  return join(resolve(kbRoot), '.dsh', 'yantao', 'run-ledgers', `${safe}.json`)
}

/**
 * The host-owned environment note (ADR-0043 决定 3; ADR-0052 决定 3/4), prefixed
 * wherever a capability's own words are handed to the model: the instruction
 * capability's SKILL.md body. The core semantics stay in the (untouched)
 * SKILL.md; these are the host facts — the one execution channel and the
 * environment facts a skill's instructions may rely on.
 */
export const CAPABILITY_ENVIRONMENT_NOTE =
  '【环境说明】\n'
  + '- 本工作台没有通用 shell；技能指令里「执行 python xxx」这类步骤，用 kb_exec_capability_script 在该能力的目录内执行（cwd 锁定该目录，命令不做内容审查——安装即授权）。\n'
  + '- KB_ROOT（知识库根目录的绝对路径）已注入环境变量，且命令行里的 $KB_ROOT 与 %KB_ROOT% 占位符由工作台在执行前直接替换为真实路径——两种写法在任何平台都等价，无需引号包裹也无需关心平台 shell；stdin 也会送达一个 JSON 信封：input 若写成 JSON 对象/数组会先解析成字典再送达（不是 JSON 就原样传字符串），state 字段是该能力已持久化的断点（没有则为 null）。\n'
  + '- Windows 上命令经 cmd.exe 执行，两个已知语义：命令串里的换行是命令分隔符（python -c 多行载荷会在首个换行处被静默截断，退出码还是 0——单行语句或 exec(\'…\') 内嵌，或干脆让能力自带 .py 文件）；路径段里的裸 & 会截断命令行（含 & 的目录名把该段用引号包裹或避开）。\n'
  + '- 未特别说明时，「资源」指知识库的 resources/ 目录；能力产出到 $KB_ROOT/resources/，过程临时文件到 resources/temp/（用完即弃，无人清理）。\n'
  + '- 用毕自省，先做一个判定再选通道：改这个能力自己的文件（SKILL.md/脚本）能否单独消除该问题？能——哪怕毛病的诱因是宿主限制——就用 kb_propose_skill_rewrite 提名改写该能力的文件（附 original 与 new，人批准即生效），把修法固化进能力；只有技能文件改不掉的（跨能力的经验偏好、宿主策略取舍、人的习惯），才用 kb_propose_memory 沉淀为行为记忆——不要把技能能修的缺陷沉淀成绕行记忆。'

/**
 * Assemble one capability's instruction text (导语 + environment note +
 * SKILL.md body + behavior memory) — the ONE template every handover face
 * shares: the `kb_run_capability` tool's render and the scheduler-facing
 * `capabilityInstructions` RPC both call this, so the two copies can never
 * drift (2026-10-10 ocr 评审 #5).
 * @param name - the capability's display name.
 * @param content - the SKILL.md body (`runInstructions`' answer).
 * @param memory - the behavior-memory block, when the capability has one.
 * @returns the assembled instruction text.
 */
export function instructionTextOf(name: string, content: string, memory?: string): string {
  return `能力「${name}」的指令正文如下，请照其行事：\n\n${CAPABILITY_ENVIRONMENT_NOTE}\n\n${content}`
    + (memory !== undefined ? `\n\n${memory}` : '')
}

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
   * `$KB_ROOT` and `%KB_ROOT%` are replaced with the live KB root before
   * the shell runs — either spelling works on either platform.
   */
  readonly command: string
  /** The live KB root, handed to the script as `KB_ROOT` and in the envelope. */
  readonly kbRoot: string
  /** The caller's free-text input, handed to the script in the envelope. */
  readonly input?: string
  /** How long the command may run before it is killed; defaults to 120s. */
  readonly timeoutMs?: number
  /**
   * The calling session's id, when known — the run scope for scripts that
   * dedupe work across calls (the mail capability's body ledger). When set,
   * the bridge hands the script a per-run scratch ledger path via
   * `CAPABILITY_RUN_LEDGER`; absent (human channel, tests) the variable is
   * simply absent and scripts degrade to no dedup.
   */
  readonly runToken?: string
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
/**
 * The 64KB cap's truncation marker, appended to a clipped stdout/stderr.
 * Exported for the parity spec: the client-side scheduler probes its runs'
 * tool results for the SAME wording to count truncations — a wording change
 * here silently zeroes that counter, and the parity test pins the two.
 */
export const TRUNCATION_MARKER = '\n…（输出超过 64KB，已截断）'

/**
 * The caller's `input` as the envelope's `input` field: a string that parses
 * as a JSON object or array is delivered **parsed** — the dedicated RPC
 * (`run.ts`) always hands scripts a dict, and the mail run's detour (the
 * model passed `input` as a JSON-encoded string, entry.py saw no dict and
 * fell back to its 30-day default window) is the lesson. Anything else —
 * plain prose, a failed parse, a primitive — stays the verbatim string, so
 * callers who genuinely want text lose nothing.
 * @param input - the tool call's raw `input` string, when given.
 */
export function inputOf(input: string | undefined): unknown {
  if (input === undefined) return null
  const trimmed = input.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}') || trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch {
      // not JSON after all — the verbatim string is the honest delivery
    }
  }
  return input
}

/**
 * One capability's persisted checkpoint, read from the KB's `state.json`
 * (`capabilities.<name>.state`) — the same ledger the dedicated RPC's state
 * round-trip maintains. Strictly fail-open: an absent file, a corrupt one, a
 * poisoned entry — any trouble reads as no state, never an error. The bridge
 * must not turn a broken ledger into a broken bridge (the usage-ledger
 * incident's discipline).
 * @param kbRoot - the live KB root.
 * @param name - the capability's kebab-case name.
 */
export async function persistedStateOf(kbRoot: string, name: string): Promise<unknown> {
  try {
    const raw = await readFile(join(resolve(kbRoot), '.dsh', 'yantao', 'state.json'), 'utf8')
    const parsed = JSON.parse(raw) as { capabilities?: Record<string, { state?: unknown }> }
    const state = parsed.capabilities?.[name]?.state
    return state === undefined ? null : state
  } catch {
    return null
  }
}

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

  // KB-root placeholder expansion, done by the bridge before the shell sees
  // the string: cmd.exe expands %KB_ROOT% but never $KB_ROOT, while sh is
  // exactly the reverse — a SKILL.md that picks one spelling cannot know
  // which platform runs it. Substituting both spellings here makes either
  // one work everywhere; the env var stays for scripts that read it as an
  // environment rather than from their argv.
  const command = options.command
    // Replacer-function form: a string replacement would interpret $-patterns
    // ($&, $`, …) in the KB root path itself, mangling it into the command.
    .replaceAll('%KB_ROOT%', () => options.kbRoot)
    .replaceAll('$KB_ROOT', () => options.kbRoot)

  const child = spawnImpl(command, [], {
    cwd: directory,
    env: {
      ...process.env,
      KB_ROOT: options.kbRoot,
      CAPABILITY_NAME: options.name,
      CAPABILITY_CHANNEL: 'agent',
      ...(options.runToken !== undefined
        ? {
          CAPABILITY_RUN_LEDGER: runLedgerPathOf(options.kbRoot, options.runToken),
          // 分批落盘（2026-10-20）：同一运行键下的暂存文件，脚本直接往里写
          // 动作行（entryId 由脚本自己从取数结果解析），最后 kb_propose_actions
          // 一次性合并成一张卡——动作 JSON 因此不必经过模型上下文。
          CAPABILITY_RUN_STAGING: stagingPathOf(options.kbRoot, options.runToken),
        }
        : {}),
      PYTHONIOENCODING: 'utf-8',
    },
    shell: true,
    windowsHide: true,
    // POSIX only: the shell becomes a process-group leader, so the timeout
    // can reap the whole tree with one signal. Windows uses taskkill /T.
    detached: process.platform !== 'win32',
  })

  const envelope = JSON.stringify({
    name: options.name,
    kbRoot: options.kbRoot,
    input: inputOf(options.input),
    state: await persistedStateOf(options.kbRoot, options.name),
    channel: 'agent',
  })

  return new Promise<ExecCapabilityScriptResult>((resolveRun) => {
    // Streams collect as raw bytes and decode once at the end: chunk-wise
    // `toString` cuts a multi-byte UTF-8 sequence in two at chunk borders,
    // and the cap must count bytes (the declared budget), not UTF-16 units.
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false

    /** Decode one stream's accumulation, capped at the byte budget with the truncation flag. */
    const decoded = (chunks: readonly Buffer[], bytes: number): { text: string; truncated: boolean } => {
      const all = Buffer.concat(chunks)
      if (bytes <= MAX_EXEC_OUTPUT_BYTES) return { text: all.toString('utf8'), truncated: false }
      // Snap the cut to the last complete UTF-8 sequence: a raw byte cut
      // would manufacture a replacement character of our own.
      const byteAt = (index: number): number => all[index] ?? 0
      let end = MAX_EXEC_OUTPUT_BYTES
      while (end > 0 && (byteAt(end - 1) & 0xC0) === 0x80) end -= 1
      const lead = byteAt(end - 1)
      // Lead-byte width table, spelled as branches: the nested ternary form
      // is hard to audit against the 0xC0/0xE0/0xF0 boundaries.
      let width = 1
      if (lead >= 0xF0) width = 4
      else if (lead >= 0xE0) width = 3
      else if (lead >= 0xC0) width = 2
      if (width > 1) end -= 1
      return { text: all.subarray(0, end).toString('utf8'), truncated: true }
    }

    /** Assemble the result; `extraStderr` carries the timeout's own note. */
    const finish = (exitCode: number | null, extraStderr = ''): void => {
      const out = decoded(stdoutChunks, stdoutBytes)
      const err = decoded(stderrChunks, stderrBytes)
      resolveRun({
        ok: exitCode === 0,
        exitCode,
        stdout: out.truncated ? out.text + TRUNCATION_MARKER : out.text,
        stderr: (err.truncated ? err.text + TRUNCATION_MARKER : err.text) + extraStderr,
      })
    }

    /**
     * Kill the whole tree, not just the shell (ADR-0043 决定 2): the real
     * workload is the shell's child, and killing the shell alone orphans it
     * while the report claims termination. POSIX signals the detached group;
     * Windows walks the tree with `taskkill /T /F` (cmd.exe does not carry
     * its children with it).
     */
    const killTree = (): void => {
      const pid = child.pid
      if (pid === undefined || pid <= 0) {
        child.kill()
        return
      }
      if (process.platform === 'win32') {
        // argv form: a single command string with `shell` unset asks Node to
        // spawn a program literally named "taskkill /pid …" — ENOENT, and the
        // error fallback would quietly reduce this to child.kill() again.
        const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.once('error', () => { child.kill() })
      } else {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }

    const timer = setTimeout(() => {
      settle(() => {
        killTree()
        finish(null, `\n…（超过 ${timeoutMs}ms 未结束，进程树已终止）`)
      })
    }, timeoutMs)

    /** End the run once; whatever the process does afterwards is ignored. */
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    child.stdin.on('error', () => {
      // A process that exits before reading stdin breaks the pipe; the close
      // handler reports the real outcome, so this only keeps the stream
      // error from crashing the host.
    })
    child.stdin.end(envelope, 'utf8')

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (stdoutBytes > MAX_EXEC_OUTPUT_BYTES) return
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      stdoutChunks.push(bytes)
      stdoutBytes += bytes.length
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderrBytes > MAX_EXEC_OUTPUT_BYTES) return
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      stderrChunks.push(bytes)
      stderrBytes += bytes.length
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
