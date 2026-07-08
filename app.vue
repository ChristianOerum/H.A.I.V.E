<template>
  <NuxtPage />
</template>

<script setup lang="ts">
import { hslToHex, useThemeStore } from '~/stores/theme'

const theme = useThemeStore()

// Pre-populate accent from localStorage before watchEffect fires with defaults,
// preventing a brief flash of the default accent color on load.
if (import.meta.client) {
  const h = parseInt(localStorage.getItem('haive.accentHue') ?? '', 10)
  const s = parseInt(localStorage.getItem('haive.accentSat') ?? '', 10)
  const l = parseInt(localStorage.getItem('haive.accentLit') ?? '', 10)
  if (!isNaN(h)) theme.accentHue = h
  if (!isNaN(s)) theme.accentSat = s
  if (!isNaN(l)) theme.accentLit = l
}

const accentHex = computed(() =>
  hslToHex(theme.accentHue, theme.accentSat, theme.accentLit),
)

watchEffect(() => {
  if (typeof document === 'undefined') return
  const color = accentHex.value
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" fill="${color}" stroke="${color}"/><path d="M9 21V12h6v9" fill="white" stroke="white" stroke-width="1.5"/></svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    document.head.appendChild(link)
  }
  link.href = url
})
</script>
