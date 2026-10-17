/** Tiny persisted string-keyed map shared by bindings / model overrides. */
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class JsonStore<T> {
  private map = new Map<string, T>()
  /** Last-seen mtime of the backing file; a changed stamp means someone else rewrote it. */
  private stamp: number | undefined

  constructor(
    private readonly file: string,
    private readonly log: (line: string) => void,
  ) {
    this.stamp = this.load(log)
  }

  get(key: string): T | undefined {
    // 外部（工作台的绑定 RPC）可能直接改写文件；mtime 变了就重读，改绑热生效。
    try {
      const stamp = statSync(this.file).mtimeMs
      if (stamp !== this.stamp) this.stamp = this.load(this.log)
    } catch {
      // 文件暂不可达：沿用内存值，下次再试。
    }
    return this.map.get(key)
  }

  set(key: string, value: T): void {
    this.map.set(key, value)
    this.save()
  }

  delete(key: string): void {
    this.map.delete(key)
    this.save()
  }

  private load(log: (line: string) => void): number | undefined {
    if (!existsSync(this.file)) return undefined
    try {
      this.map = new Map(Object.entries(JSON.parse(readFileSync(this.file, 'utf8'))))
      return statSync(this.file).mtimeMs
    } catch (err) {
      log(`${this.file} unreadable, starting empty: ${err instanceof Error ? err.message : err}`)
      this.map = new Map()
      return undefined
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.tmp.${process.pid}.${randomUUID()}`
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.map), null, 2), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.file)
    chmodSync(this.file, 0o600)
    try {
      this.stamp = statSync(this.file).mtimeMs
    } catch {
      this.stamp = undefined
    }
  }
}
