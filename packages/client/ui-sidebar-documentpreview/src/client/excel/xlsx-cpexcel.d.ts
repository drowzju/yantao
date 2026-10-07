/**
 * Temporary shim for the vendored-downgraded xlsx 0.18.5: upstream pins the
 * SheetJS 0.20.3 CDN tarball, whose cpexcel build ships its own typings; the
 * 0.18.5 dist does not. Drop this file when xlsx returns to 0.20.3.
 */
declare module 'xlsx/dist/cpexcel.full.mjs' {
  const cptable: unknown
  export default cptable
}
