import * as fs from 'node:fs'

/**
 * Resolve a real ROM (and optional toml) for the integration suites, which are
 * skipped when the file isn't on this machine. The ROMs aren't in the repo, and
 * different checkouts keep them in different folders, so each ROM has an env
 * override plus a list of known-good locations; the first path that exists wins.
 *
 *   HS_ROM   — Heart & Soul (BPEE) .gba
 *   FR_ROM   — the FireRed GPT_Mods .gba   (FR_TOML for its sidecar)
 *
 * A candidate is `[gba]` or `[gba, toml]`; a toml candidate only matches when
 * both files exist, so a ROM without its sidecar doesn't half-satisfy the suite.
 */
function firstExisting(candidates: Array<string | [string, string]>): {
  rom: string
  toml?: string
} | null {
  for (const candidate of candidates) {
    const [rom, toml] = Array.isArray(candidate) ? candidate : [candidate, undefined]
    if (!rom) continue
    if (!fs.existsSync(rom)) continue
    if (toml && !fs.existsSync(toml)) continue
    return { rom, toml }
  }
  return null
}

/** Heart & Soul (BPEE). No toml needed — H&S uses its built-in anchor profile. */
export const heartAndSoulRom = firstExisting([
  process.env.HS_ROM ?? '',
  'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba',
  'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba',
])

/** The FireRed GPT_Mods ROM with its HMA toml sidecar. */
export const fireRedRom = firstExisting([
  process.env.FR_ROM && process.env.FR_TOML
    ? ([process.env.FR_ROM, process.env.FR_TOML] as [string, string])
    : '',
  [
    'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)/20260426__GPT_Mods.gba',
    'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)/20260426__GPT_Mods.toml',
  ],
  [
    'C:/Users/Jordan/Downloads/20260426__GPT_Mods.gba',
    'C:/Users/Jordan/Downloads/20260426__GPT_Mods.toml',
  ],
])
