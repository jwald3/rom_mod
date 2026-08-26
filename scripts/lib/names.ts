/**
 * Re-export of the shared name helpers so scripts can `./lib/names` without
 * reaching into src/. The implementation lives in src/lib/names.ts because the
 * simulator (src/sim) needs it too.
 */
export { norm, isGapName, nameIndex, suggestNames, resolveName } from '../../src/lib/names'
