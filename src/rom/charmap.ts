// Gen 3 (Western) proprietary character encoding.
// Species/move names in the ROM are fixed-width byte strings terminated by 0xFF.

export const TERMINATOR = 0xff

const TABLE: Record<number, string> = {
  0x00: ' ',
  0x01: 'À', 0x02: 'Á', 0x03: 'Â', 0x04: 'Ç', 0x05: 'È', 0x06: 'É', 0x07: 'Ê', 0x08: 'Ë',
  0x09: 'Ì', 0x0b: 'Î', 0x0c: 'Ï', 0x0d: 'Ò', 0x0e: 'Ó', 0x0f: 'Ô',
  0x10: 'Œ', 0x11: 'Ù', 0x12: 'Ú', 0x13: 'Û', 0x14: 'Ñ', 0x15: 'ß', 0x16: 'à', 0x17: 'á',
  0x19: 'ç', 0x1a: 'è', 0x1b: 'é', 0x1c: 'ê', 0x1d: 'ë', 0x1e: 'ì',
  0x20: 'î', 0x21: 'ï', 0x22: 'ò', 0x23: 'ó', 0x24: 'ô', 0x25: 'œ', 0x26: 'ù', 0x27: 'ú',
  0x28: 'û', 0x29: 'ñ', 0x2a: 'º', 0x2b: 'ª', 0x2d: '&', 0x2e: '+',
  0x35: '=', 0x36: ';',
  0x51: '¿', 0x52: '¡',
  0x5a: 'Í', 0x5b: '%', 0x5c: '(', 0x5d: ')',
  0x68: 'â', 0x6f: 'í',
  0x85: '<', 0x86: '>',
  0xab: '!', 0xac: '?', 0xad: '.', 0xae: '-', 0xaf: '·',
  0xb0: '…', 0xb1: '“', 0xb2: '”', 0xb3: '‘', 0xb4: '’', 0xb5: '♂', 0xb6: '♀',
  0xb7: '$', 0xb8: ',', 0xb9: '×', 0xba: '/',
  0xef: '▶', 0xf0: ':', 0xf1: 'Ä', 0xf2: 'Ö', 0xf3: 'Ü', 0xf4: 'ä', 0xf5: 'ö', 0xf6: 'ü',
}
// 0xA1–0xAA → '0'–'9'
for (let i = 0; i <= 9; i++) TABLE[0xa1 + i] = String.fromCharCode(0x30 + i)
// 0xBB–0xD4 → 'A'–'Z', 0xD5–0xEE → 'a'–'z'
for (let i = 0; i < 26; i++) {
  TABLE[0xbb + i] = String.fromCharCode(65 + i)
  TABLE[0xd5 + i] = String.fromCharCode(97 + i)
}

const REVERSE = new Map<string, number>()
for (const [byte, ch] of Object.entries(TABLE)) {
  if (!REVERSE.has(ch)) REVERSE.set(ch, Number(byte))
}

/** Decode up to maxLen bytes starting at `start`, stopping at the 0xFF terminator. */
export function decode(bytes: Uint8Array, start = 0, maxLen = bytes.length - start): string {
  let out = ''
  for (let i = 0; i < maxLen; i++) {
    const b = bytes[start + i]
    if (b === TERMINATOR || b === undefined) break
    out += TABLE[b] ?? '�'
  }
  return out
}

/** Encode text to Gen 3 bytes (no terminator appended). Throws on unmappable characters. */
export function encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const b = REVERSE.get(text[i])
    if (b === undefined) throw new Error(`Cannot encode character “${text[i]}” to Gen 3 text`)
    out[i] = b
  }
  return out
}

/** All characters that round-trip through this codec (for tests). */
export function mappedCharacters(): string[] {
  return [...REVERSE.keys()]
}
