import { writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KbRevision } from '../src/watch.ts'

let dir: string
let other: string
let watch: KbRevision

/** Long enough for chokidar to notice plus the debounce to fire. */
const SETTLE_MS = 250

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yantao-kb-watch-'))
  other = await mkdtemp(join(tmpdir(), 'yantao-kb-watch-other-'))
  watch = new KbRevision({ debounceMs: 20 })
})

afterEach(async () => {
  watch.close()
  await rm(dir, { recursive: true, force: true })
  await rm(other, { recursive: true, force: true })
})

async function touch(root: string, name: string): Promise<void> {
  await writeFile(join(root, name), 'x', 'utf8')
}

const wait = (): Promise<void> => new Promise(resolve => setTimeout(resolve, SETTLE_MS))

describe('KbRevision', () => {
  it('starts at zero and ignores the files already there', async () => {
    await touch(dir, 'before.md')
    watch.follow(dir)
    await wait()
    expect(watch.revision).toBe(0)
    expect(watch.root).toBe(dir)
  })

  it('bumps once when a file appears', async () => {
    watch.follow(dir)
    await wait()
    await touch(dir, 'new.md')
    await wait()
    expect(watch.revision).toBe(1)
  })

  it('collapses a burst of writes into one bump', async () => {
    // Written synchronously and with a wide debounce. Three awaited writes can
    // land far enough apart to fire two bumps — that is a timing artefact of a
    // loaded machine, not the burst this case is about, and it made the test
    // flaky. `writeFileSync` puts the three inside one event-loop turn.
    const burst = new KbRevision({ debounceMs: 250 })
    try {
      burst.follow(dir)
      await wait()
      for (const name of ['a.md', 'b.md', 'c.md']) writeFileSync(join(dir, name), 'x', 'utf8')
      // Comfortably longer than this case's own 250ms debounce: the bump is
      // scheduled, not immediate.
      await new Promise(resolve => setTimeout(resolve, 700))
      expect(burst.revision).toBe(1)
    } finally {
      burst.close()
    }
  })

  it('reports the root it watches', () => {
    expect(watch.root).toBeUndefined()
    watch.follow(dir)
    expect(watch.root).toBe(dir)
  })

  it('re-points at the new root and stops counting the old one', async () => {
    watch.follow(dir)
    await wait()
    await touch(dir, 'ignored.md')
    await wait()
    expect(watch.revision).toBe(1)

    watch.follow(other)
    expect(watch.root).toBe(other)
    await touch(dir, 'after-the-move.md')
    await wait()
    expect(watch.revision).toBe(1)

    await touch(other, 'in-the-new-root.md')
    await wait()
    expect(watch.revision).toBe(2)
  })

  it('is a no-op when asked to follow the root it already follows', async () => {
    watch.follow(dir)
    await wait()
    await touch(dir, 'a.md')
    await wait()
    const seen = watch.revision
    watch.follow(dir)
    expect(watch.revision).toBe(seen)
  })

  it('stops counting after close', async () => {
    watch.follow(dir)
    await wait()
    watch.close()
    expect(watch.root).toBeUndefined()
    await touch(dir, 'later.md')
    await wait()
    expect(watch.revision).toBe(0)
    expectNoLeakedWatcher(watch)
  })
})

/** A closed revision must be re-openable, or a moved root would leave nothing watching. */
function expectNoLeakedWatcher(subject: KbRevision): void {
  subject.follow(other)
  expect(subject.root).toBe(other)
  subject.close()
}
