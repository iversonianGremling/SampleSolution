export const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export const gainToDb = (gain: number) => {
  if (gain <= 0.0001) return -Infinity
  return 20 * Math.log10(gain)
}

export const formatDb = (gain: number) => {
  const db = gainToDb(gain)
  if (!Number.isFinite(db)) return '-inf dB'
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`
}
