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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="M21.8 13H20v8h-7v-3.33l2.79-2.79l.71.12a2.1 2.1 0 1 0 0-4.2a2.1 2.1 0 0 0-2.1 2.1l.1.71l-1.5 1.52V9.65c.66-.36 1.1-1.05 1.1-1.85A2.1 2.1 0 0 0 12 5.7a2.1 2.1 0 0 0-2.1 2.1c0 .8.44 1.49 1.1 1.85v5.48l-1.5-1.52l.1-.71a2.1 2.1 0 0 0-2.1-2.1a2.1 2.1 0 0 0-2.1 2.1A2.1 2.1 0 0 0 7.5 15l.71-.12L11 17.67V21H4v-8H2.25c-.42 0-.83 0-.83-.21c.01-.22.43-.64.86-1.07L11 3c.33-.33.67-.67 1-.67s.67.34 1 .67l4 4V6h2v3l2.78 2.78c.4.4.81.81.82 1.02c0 .2-.4.2-.8.2M7.5 12a.9.9 0 0 1 .9.9a.9.9 0 0 1-.9.9a.9.9 0 0 1-.9-.9a.9.9 0 0 1 .9-.9m9 0c.5 0 .9.4.9.9s-.4.9-.9.9a.9.9 0 0 1-.9-.9a.9.9 0 0 1 .9-.9M12 6.9c.5 0 .9.4.9.9s-.4.9-.9.9s-.9-.4-.9-.9s.4-.9.9-.9"/></svg>`
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
