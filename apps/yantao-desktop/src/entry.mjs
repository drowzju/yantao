/**
 * Electron hands `main` to Node as a plain module, with no `--import` flag to
 * hang a loader off — so the TypeScript entry is reached by registering tsx
 * first, exactly what `node --import tsx/esm apps/cli/src/bin.ts` does from the
 * command line.
 *
 * `tsx/esm` is the CLI's flag entry and refuses to be registered this way
 * ("tsx must be loaded with --import instead of --loader"); `tsx/esm/api` is
 * the programmatic one.
 */

import { register } from 'tsx/esm/api'

register()
await import('./main.ts')
