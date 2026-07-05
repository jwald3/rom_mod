// Gen 3 internal type order; colors follow the classic series palette.
const TYPE_COLORS: string[] = [
  '#A8A878', // NORMAL
  '#C03028', // FIGHTING
  '#A890F0', // FLYING
  '#A040A0', // POISON
  '#E0C068', // GROUND
  '#B8A038', // ROCK
  '#A8B820', // BUG
  '#705898', // GHOST
  '#B8B8D0', // STEEL
  '#68A090', // ??? (mystery)
  '#F08030', // FIRE
  '#6890F0', // WATER
  '#78C850', // GRASS
  '#F8D030', // ELECTRIC
  '#F85888', // PSYCHIC
  '#98D8D8', // ICE
  '#7038F8', // DRAGON
  '#705848', // DARK
]

export function TypeBadge({ typeId, typeNames }: { typeId: number; typeNames: string[] }) {
  const name = typeNames[typeId] ?? `T${typeId}`
  const color = TYPE_COLORS[typeId] ?? '#666'
  return (
    <span
      className="inline-block min-w-16 rounded px-1.5 py-0.5 text-center text-xs font-bold text-white"
      style={{ backgroundColor: color, textShadow: '0 1px 1px rgba(0,0,0,.5)' }}
    >
      {name}
    </span>
  )
}
