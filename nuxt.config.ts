// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: false,

  modules: [
    '@tresjs/nuxt',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxtjs/tailwindcss',
  ],

  // Auto-import device adapters
  imports: {
    dirs: ['adapters', 'stores', 'composables', 'utils'],
  },

  components: [
    { path: '~/components', pathPrefix: false },
  ],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'HAIVE',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
      meta: [
        { charset: 'utf-8' },
        // Responsive viewport — the UI adapts to the actual display size.
        // Zoom is disabled because this is a kiosk surface, not a browsing surface.
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover',
        },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'theme-color', content: '#0a0a0f' },
      ],
    },
  },

  runtimeConfig: {
    // Server-only — never exposed to the client bundle.
    haUrl: process.env.HA_URL || 'http://homeassistant.local:8123',
    haToken: process.env.HA_TOKEN || '',
    // WiFi credentials surfaced via QR on the kiosk. Server-side only; the
    // public flag below lets the UI hide the button when nothing is configured.
    wifiSsid: process.env.WIFI_SSID || '',
    wifiPassword: process.env.WIFI_PASSWORD || '',
    wifiSecurity: process.env.WIFI_SECURITY || 'WPA',
    wifiHidden: process.env.WIFI_HIDDEN === 'true',
    // Restrict /api/ha/* to clients on these CIDR-prefixed local networks.
    allowedLocalPrefixes: (process.env.ALLOWED_LOCAL_PREFIXES || '127.,192.168.,10.,172.').split(','),
    // PIN required to unlock the toolbar controls. Set AUTH_PIN in .env.
    authPin: process.env.AUTH_PIN || '',
    public: {
      // Public HA URL exposed so the browser can open a WS directly to HA.
      haUrl: process.env.HA_URL || 'http://homeassistant.local:8123',
      // True when HA_TOKEN is configured — lets the UI skip the setup hint.
      haConfigured: !!process.env.HA_TOKEN,
      // True when AUTH_PIN is set — controls whether toolbar lock is enforced.
      authEnabled: !!process.env.AUTH_PIN,
    },
  },

  nitro: {
    preset: 'node-server',
  },

  typescript: {
    strict: true,
  },
})
