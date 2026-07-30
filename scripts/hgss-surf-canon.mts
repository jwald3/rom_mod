/**
 * Canonical HG/SS surf encounter tables, compiled from Serebii Pokéarth (HG/SS),
 * Bulbapedia, and the Project Pokémon HG/SS encounter-file spec. Keyed by the
 * ROM's resolved wild-area NAME (uppercase, matching resolveMapName output).
 *
 * HG/SS surf = 5 slots at 60/30/5/4/1%. We express each area as up to 5 slots of
 * { species, low, high }; the applier fills all 5 ROM slots from these (repeating
 * the dominant species across the 60+30 slots as the games do). Version diffs
 * (Route 41 Mantine) resolve to the SoulSilver-neutral / most-common form; noted.
 *
 * Species names must match the ROM's species table (ALLCAPS). "no surf" means the
 * location has no surfable water in canon — if the ROM has a surf table there it's
 * spurious, but we leave it (removing water tables is a separate call).
 */
export interface CanonSlot { species: string; low: number; high: number }
// Helper builders for the common 2-species 90/10 and 3-species 60/30/10 layouts.
const two = (a: string, al: number, ah: number, b: string, bl: number, bh: number): CanonSlot[] => [
  { species: a, low: al, high: ah }, // slot1 60%
  { species: a, low: al, high: ah }, // slot2 30%
  { species: a, low: al, high: ah }, // slot3 5%
  { species: b, low: bl, high: bh }, // slot4 4%
  { species: b, low: bl, high: bh }, // slot5 1%
]
const three = (
  a: string, al: number, ah: number,
  b: string, bl: number, bh: number,
  c: string, cl: number, ch: number,
): CanonSlot[] => [
  { species: a, low: al, high: ah }, // 60
  { species: b, low: bl, high: bh }, // 30
  { species: c, low: cl, high: ch }, // 5
  { species: c, low: cl, high: ch }, // 4
  { species: c, low: cl, high: ch }, // 1
]
const one = (a: string, l: number, h: number): CanonSlot[] =>
  [0,1,2,3,4].map(() => ({ species: a, low: l, high: h }))

export const HGSS_SURF: Record<string, CanonSlot[]> = {
  // ── JOHTO routes ──
  'ROUTE 30': two('POLIWAG',10,25,'POLIWHIRL',15,32),
  'ROUTE 31': two('POLIWAG',10,25,'POLIWHIRL',15,32),
  'ROUTE 32': three('TENTACOOL',10,20,'QUAGSIRE',15,25,'TENTACRUEL',15,36),
  'ROUTE 34': two('TENTACOOL',10,25,'TENTACRUEL',15,29),
  'ROUTE 35': two('PSYDUCK',10,25,'GOLDUCK',15,31),
  'ROUTE 40': two('TENTACOOL',10,25,'TENTACRUEL',15,25),
  'ROUTE 41': three('TENTACOOL',15,25,'TENTACRUEL',15,25,'MANTINE',20,25), // HG w/ Mantine
  'ROUTE 42': two('GOLDEEN',10,25,'SEAKING',15,25),
  'ROUTE 43': one('MAGIKARP',5,20),
  'ROUTE 44': two('POLIWAG',15,30,'POLIWHIRL',20,30),
  'ROUTE 45': one('MAGIKARP',2,20),
  'ROUTE 47': three('TENTACOOL',15,25,'SEEL',10,20,'STARYU',15,25),
  // ── JOHTO towns ──
  'NEW BARK TOWN': two('TENTACOOL',25,29,'TENTACRUEL',30,35),
  'CHERRYGROVE CITY': two('TENTACOOL',15,24,'TENTACRUEL',20,30),
  'OLIVINE CITY': two('TENTACOOL',15,24,'TENTACRUEL',20,30),
  'CIANWOOD CITY': two('TENTACOOL',15,24,'TENTACRUEL',20,30),
  'VIOLET CITY': two('POLIWAG',15,24,'POLIWHIRL',20,30),
  'ECRUTEAK CITY': two('POLIWAG',15,24,'POLIWHIRL',20,30),
  // ── JOHTO water bodies / caves ──
  'LAKE OF RAGE': two('MAGIKARP',5,20,'GYARADOS',10,20),
  'UNION CAVE': three('TENTACOOL',10,20,'QUAGSIRE',15,25,'TENTACRUEL',15,25),
  'ILEX FOREST': two('PSYDUCK',5,20,'GOLDUCK',10,20),
  'SLOWPOKE WELL': two('SLOWPOKE',10,25,'SLOWBRO',15,30),
  'MT MORTAR': two('GOLDEEN',10,25,'SEAKING',15,25),
  'MT. MORTAR': two('GOLDEEN',10,25,'SEAKING',15,25),
  'WHIRL ISLANDS': three('TENTACOOL',15,25,'HORSEA',10,20,'TENTACRUEL',15,25),
  'DRAGON’S DEN': two('MAGIKARP',5,20,'DRATINI',5,15),
  "DRAGON'S DEN": two('MAGIKARP',5,20,'DRATINI',5,15),
  'DARK CAVE': one('MAGIKARP',2,20),
  'RUINS OF ALPH': two('WOOPER',10,20,'QUAGSIRE',10,25),
  'TOHJO FALLS': three('GOLDEEN',20,20,'SLOWPOKE',20,20,'SEAKING',20,20),
  'MT. SILVER': two('GOLDEEN',30,40,'SEAKING',30,50),
  'MT SILVER': two('GOLDEEN',30,40,'SEAKING',30,50),
  // ── KANTO routes ──
  'ROUTE 6': two('PSYDUCK',5,10,'GOLDUCK',10,10),
  'ROUTE 9': two('GOLDEEN',10,15,'SEAKING',15,15),
  'ROUTE 10': two('GOLDEEN',10,15,'SEAKING',15,15),
  'ROUTE 12': three('TENTACOOL',25,25,'TENTACRUEL',25,25,'QUAGSIRE',25,25),
  'ROUTE 13': three('TENTACOOL',25,25,'QUAGSIRE',25,25,'TENTACRUEL',25,25),
  'ROUTE 19': two('TENTACOOL',30,35,'TENTACRUEL',35,35),
  'ROUTE 20': two('TENTACOOL',30,35,'TENTACRUEL',35,35),
  'ROUTE 21': two('TENTACOOL',30,35,'TENTACRUEL',35,35),
  'ROUTE 22': two('POLIWAG',5,10,'POLIWHIRL',10,10),
  'ROUTE 24': two('GOLDEEN',5,10,'SEAKING',10,10),
  'ROUTE 25': two('GOLDEEN',5,10,'SEAKING',10,10),
  'ROUTE 26': two('TENTACOOL',25,30,'TENTACRUEL',30,30),
  'ROUTE 27': two('TENTACOOL',15,20,'TENTACRUEL',20,20),
  'ROUTE 28': two('POLIWAG',35,40,'POLIWHIRL',40,40),
  // ── KANTO towns ──
  'PALLET TOWN': two('TENTACOOL',5,35,'TENTACRUEL',35,40),
  'VERMILION CITY': two('TENTACOOL',5,35,'TENTACRUEL',35,40),
  'CINNABAR ISLAND': two('TENTACOOL',5,35,'TENTACRUEL',35,40),
  'CERULEAN CITY': two('GOLDEEN',5,10,'SEAKING',10,10),
  'VIRIDIAN CITY': two('POLIWAG',5,10,'POLIWHIRL',10,10),
  'FUCHSIA CITY': one('MAGIKARP',5,20),
  // ── KANTO caves ──
  'SEAFOAM ISLANDS': three('SEEL',30,40,'HORSEA',30,40,'SLOWBRO',35,50),

  // ── Additional coverage: bank-27 (Emerald-legacy) maps that still carry
  // Wingull/Pelipper. Most of these locations have NO surfable water in HG/SS,
  // but the vestigial tables are neutralised to sensible canon so no Hoenn gull
  // survives anywhere. Values follow the region's nearest canon water.
  'ROUTE 33': two('TENTACOOL',10,20,'TENTACRUEL',15,25),   // Azalea side, sea-adjacent
  'ROUTE 36': two('POLIWAG',10,25,'POLIWHIRL',15,30),       // freshwater
  'ROUTE 39': two('TENTACOOL',10,25,'TENTACRUEL',15,30),    // Olivine coast side
  'ROUTE 46': two('MAGIKARP',5,20,'POLIWAG',10,20),         // little pond
  'ROUTE 29': two('POLIWAG',10,25,'POLIWHIRL',15,30),       // no canon surf; freshwater filler
  'ROUTE 48': two('TENTACOOL',15,25,'TENTACRUEL',20,30),    // Safari coast filler
  'NATIONAL PARK': two('POLIWAG',10,20,'POLIWHIRL',15,25),  // pond filler
  'CONTEST HALL': two('TENTACOOL',15,25,'TENTACRUEL',20,30),
  'CLIFF CAVE': three('TENTACOOL',5,35,'WOOPER',5,20,'QUAGSIRE',15,30),
  'ICE PATH': three('SEEL',20,30,'DEWGONG',25,35,'TENTACRUEL',20,30),
  'SPROUT TOWER': one('MAGIKARP',5,20),                     // no water in canon; neutralise
}
