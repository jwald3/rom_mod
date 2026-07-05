import { describe, it, expect } from 'vitest'
import { parseNamedAnchors, anchorCount, anchorsFromToml } from '../src/rom/hmaToml'

const SAMPLE = `
[General]
ApplicationVersion = '''0.5.6.1'''
FreeSpaceSearch = '''71DA00'''

[[NamedAnchors]]
Name = '''data.pokemon.names'''
Address = 0x245EE0
Format = '''[name""11]412'''
DefaultHash = '''747F95CC'''

[[NamedAnchors]]
Name = '''data.pokemon.moves.names'''
Address = 0x71A780
Format = '''^[name""13]356'''
DefaultHash = '''C4BD7B07'''

[[NamedAnchors]]
Name = '''data.pokemon.moves.levelup'''
Address = 0x25D7B4
Format = '''[movesFromLevel<[pair:|t|move::::.data.pokemon.moves.names|level:::.]!FFFF>]data.pokemon.names'''
DefaultHash = '''BBF82701'''

[[NamedAnchors]]
Name = '''data.pokemon.moves.descriptions'''
Address = 0x71BA00
Format = '''[description<"">]data.pokemon.moves.names-1'''

[[NamedAnchors]]
Name = '''data.pokemon.type.names'''
Address = 0x24F1A0
Format = '''^[name""7]data.pokemon.type.length'''

[[NamedAnchors]]
Name = '''data.pokemon.stats'''
Address = 0x254784
Format = '''[hp. attack. def. speed.]data.pokemon.names'''

[[NamedAnchors]]
Name = '''data.pokemon.moves.stats.battle'''
Address = 0x71C600
Format = '''[effect.moveeffectoptions power. type.data.pokemon.type.names accuracy. pp.]data.pokemon.moves.names'''
`

describe('hmaToml', () => {
  it('parses names, addresses, and formats', () => {
    const anchors = parseNamedAnchors(SAMPLE)
    expect(anchors.get('data.pokemon.names')?.address).toBe(0x245ee0)
    expect(anchors.get('data.pokemon.moves.names')?.address).toBe(0x71a780)
    expect(anchors.get('data.pokemon.moves.levelup')?.address).toBe(0x25d7b4)
  })

  it('resolves literal counts', () => {
    const anchors = parseNamedAnchors(SAMPLE)
    expect(anchorCount('data.pokemon.names', anchors)).toBe(412)
    expect(anchorCount('data.pokemon.moves.names', anchors)).toBe(356)
  })

  it('resolves count references and arithmetic', () => {
    const anchors = parseNamedAnchors(SAMPLE)
    expect(anchorCount('data.pokemon.moves.levelup', anchors)).toBe(412)
    expect(anchorCount('data.pokemon.moves.descriptions', anchors)).toBe(355)
  })

  it('returns null for references to HMA-internal constants', () => {
    const anchors = parseNamedAnchors(SAMPLE)
    expect(anchorCount('data.pokemon.type.names', anchors)).toBeNull()
  })

  it('builds a partial AnchorMap, keeping defaults where counts are unresolvable', () => {
    const { anchors, found } = anchorsFromToml(SAMPLE)
    expect(anchors.speciesNames).toBe(0x245ee0)
    expect(anchors.speciesCount).toBe(412)
    expect(anchors.moveNames).toBe(0x71a780)
    expect(anchors.moveCount).toBe(356)
    expect(anchors.moveStats).toBe(0x71c600)
    expect(anchors.learnsets).toBe(0x25d7b4)
    expect(anchors.baseStats).toBe(0x254784)
    expect(anchors.typeNames).toBe(0x24f1a0)
    expect(anchors.typeCount).toBeUndefined() // unresolvable → caller keeps default
    expect(found).toContain('data.pokemon.moves.levelup')
  })
})
