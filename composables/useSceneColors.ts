/**
 * Reads CSS-variable-driven scene colors so 3D components can match the UI theme.
 * Returns reactive refs that update whenever the theme store flips.
 */
export function useSceneColors() {
  const theme = useThemeStore()

  function read(name: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim()
    // The CSS vars are stored as quoted strings (e.g. "#1e293b"). Strip quotes.
    return raw.replace(/^"|"$/g, '') || fallback
  }
  function readNum(name: string, fallback: number): number {
    const v = read(name, '')
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  const colors = ref({
    clear: '#1e293b',
    floor: '#334155',
    wall: '#475569',
    furniture: '#64748b',
    ambient: 0.45,
    sun: 1.1,
  })

  function refresh() {
    colors.value = {
      clear: read('--scene-clear', '#1e293b'),
      floor: read('--scene-floor', '#334155'),
      wall: read('--scene-wall', '#475569'),
      furniture: read('--scene-furniture', '#64748b'),
      ambient: readNum('--scene-ambient', 0.45),
      sun: readNum('--scene-sun', 1.1),
    }
  }

  onMounted(refresh)
  watch(() => theme.revision, refresh)

  return colors
}
