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
      // Anti-FOUC: apply dark/light class, palette vars, and accent vars from
      // localStorage synchronously before first paint, so there is no flash of
      // the default theme before Vue hydrates.
      script: [
        {
          innerHTML: `(function(){try{
  var root=document.documentElement,ls=localStorage;
  var mode=ls.getItem('cove.theme')||'auto',dark;
  if(mode==='dark'){dark=true}
  else if(mode==='light'){dark=false}
  else{var hr=new Date().getHours();dark=hr<6||hr>=20}
  dark?root.classList.add('dark'):root.classList.add('light');
  var dk={
    slate:  {bg:'30 41 59',  bp:'51 65 85',   be:'71 85 105',  fg:'226 232 240',fm:'148 163 184'},
    deep:   {bg:'7 11 22',   bp:'17 24 39',   be:'30 41 59',   fg:'226 232 240',fm:'148 163 184'},
    neutral:{bg:'24 24 27',  bp:'39 39 42',   be:'63 63 70',   fg:'228 228 231',fm:'161 161 170'}
  };
  var lk={
    warm: {bg:'248 245 238',bp:'243 238 226',be:'229 222 207',fg:'41 37 36',fm:'120 113 108'},
    white:{bg:'255 255 255',bp:'245 245 247',be:'229 229 235',fg:'24 24 27', fm:'113 113 122'},
    beige:{bg:'237 228 210',bp:'224 213 190',be:'207 193 166',fg:'41 37 36',fm:'120 113 108'}
  };
  var vk=dark?(ls.getItem('cove.darkVariant')||'slate'):(ls.getItem('cove.lightVariant')||'warm');
  var pal=dark?(dk[vk]||dk.slate):(lk[vk]||lk.warm);
  root.style.setProperty('--bg',pal.bg);root.style.setProperty('--bg-panel',pal.bp);
  root.style.setProperty('--bg-elevated',pal.be);root.style.setProperty('--fg',pal.fg);
  root.style.setProperty('--fg-muted',pal.fm);
  function h2r(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
  function rgb(h,s,l){h/=360;s/=100;l/=100;var rv,g,b;if(s===0){rv=g=b=l}else{var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;rv=h2r(p,q,h+1/3);g=h2r(p,q,h);b=h2r(p,q,h-1/3)}return Math.round(rv*255)+' '+Math.round(g*255)+' '+Math.round(b*255)}
  var aH=parseInt(ls.getItem('cove.accentHue')||'',10),aS=parseInt(ls.getItem('cove.accentSat')||'',10),aL=parseInt(ls.getItem('cove.accentLit')||'',10);
  if(!isNaN(aH)&&!isNaN(aS)&&!isNaN(aL)){
    var ss=dark?aS:Math.round(aS*(70/78)),ll=dark?aL:Math.round(aL*(42/62));
    root.style.setProperty('--accent',rgb(aH,ss,ll));
    root.style.setProperty('--accent-dim',rgb(aH,Math.max(0,ss-(dark?6:2)),Math.max(0,ll-(dark?16:7))))
  }
  // Inject favicon with correct accent color immediately — before the browser
  // paints — so the tab icon never shows the wrong color.
  var fH=isNaN(aH)?174:aH,fS=isNaN(aS)?78:aS,fL=isNaN(aL)?62:aL;
  var fss=dark?fS:Math.round(fS*(70/78)),fll=dark?fL:Math.round(fL*(42/62));
  function toHex(n){return Math.round(n*255).toString(16).padStart(2,'0')}
  function hslHex(h,s,l){h/=360;s/=100;l/=100;var rv,g,b;if(s===0){rv=g=b=l}else{var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;rv=h2r(p,q,h+1/3);g=h2r(p,q,h);b=h2r(p,q,h-1/3)}return'#'+toHex(rv)+toHex(g)+toHex(b)}
  var fc=hslHex(fH,fss,fll);
  var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" fill="'+fc+'" stroke="'+fc+'"/><path d="M9 21V12h6v9" fill="white" stroke="white" stroke-width="1.5"/></svg>';
  var ico=document.createElement('link');ico.rel='icon';ico.type='image/svg+xml';
  ico.href='data:image/svg+xml,'+encodeURIComponent(svg);
  document.head.appendChild(ico);
}catch(e){}})()`,
        },
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
