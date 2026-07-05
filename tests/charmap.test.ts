import { describe, it, expect } from 'vitest'
import { decode, encode, mappedCharacters, TERMINATOR } from '../src/rom/charmap'

describe('gen3 charmap', () => {
  it('decodes BULBASAUR and stops at the terminator', () => {
    const bytes = new Uint8Array([
      0xbc, 0xcf, 0xc6, 0xbc, 0xbb, 0xcd, 0xbb, 0xcf, 0xcc, TERMINATOR, 0xbb,
    ])
    expect(decode(bytes)).toBe('BULBASAUR')
  })

  it('respects maxLen for fixed-width fields', () => {
    const bytes = new Uint8Array([0xbb, 0xbc, 0xbd, 0xbe])
    expect(decode(bytes, 1, 2)).toBe('BC')
  })

  it('decodes digits, punctuation, and gender symbols', () => {
    // "NIDORAN♀" and "PORYGON2"-ish fragments
    expect(decode(new Uint8Array([0xc8, 0xc3, 0xbe, 0xc9, 0xcc, 0xbb, 0xc8, 0xb6]))).toBe(
      'NIDORAN♀',
    )
    expect(decode(new Uint8Array([0xa3, 0xad, 0xae, 0xb4]))).toBe('2.-’')
  })

  it('renders unknown bytes as replacement character', () => {
    expect(decode(new Uint8Array([0xbb, 0x99, 0xbb]))).toBe('A�A')
  })

  it('round-trips every mapped character', () => {
    for (const ch of mappedCharacters()) {
      expect(decode(encode(ch))).toBe(ch)
    }
  })

  it('throws when encoding unmappable characters', () => {
    expect(() => encode('日')).toThrow(/Cannot encode/)
  })
})
