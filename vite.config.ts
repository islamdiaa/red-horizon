import { defineConfig, type Plugin } from 'vite';

/**
 * Where the build is served from (`base`):
 *  - `/` by default (Docker, Vercel);
 *  - `RH_BASE=/red-horizon/ npm run build` for a sub-path on a shared host (or `vite build --base /red-horizon/`);
 *  - `./` for relative builds that run from any folder: `npm run build:itch` and the desktop wrapper.
 * Runtime asset URLs go through assetUrl() (src/platform/paths.ts), so every base works.
 */
const BASE = process.env.RH_BASE || '/';

/**
 * The public address of the deployment (`https://example.com/red-horizon/`), for link previews: Open Graph and
 * Twitter cards need absolute image URLs. Set RH_SITE_URL at build time; on Vercel the production domain is
 * picked up automatically. Without it the preview image stays a root-relative path, which Discord and most
 * chat apps still resolve against the page.
 */
function siteUrl(): string {
  const raw = process.env.RH_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    return '';
  }
}

/** Link-preview meta: absolute og:image / twitter:image URLs, plus og:url and a canonical link when the site URL is known. */
function linkPreviewMeta(): Plugin {
  return {
    name: 'rh-link-preview-meta',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const site = siteUrl();
        if (!site) return html;
        const abs = (u: string) => {
          try {
            return new URL(u.replace(/^\.\//, ''), site).href;
          } catch {
            return u;
          }
        };
        const out = html.replace(/(<meta\s+(?:property="og:image(?::secure_url)?"|name="twitter:image")\s+content=")([^"]+)(")/g, (_m, a: string, u: string, b: string) => `${a}${abs(u)}${b}`);
        const esc = site.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return out.replace('<!-- og:url -->', `<meta property="og:url" content="${esc}" />\n    <link rel="canonical" href="${esc}" />`);
      },
    },
  };
}

/**
 * MP: keep `Math.pow(a, b)` calls as calls in the bundle. Multiplayer matches and ranked runs swap portable versions
 * into Math (src/net/dmath.ts) so every engine computes the same; the minifier rewrites a literal `Math.pow(a, b)`
 * into `a ** b`, which always runs the engine's own pow and would bypass the swap (map generation and the AI's
 * counter weights then differ in the last bit between Chrome, Firefox and Safari, and from the leaderboard
 * server). `(0, Math.pow)(a, b)` reads Math.pow when it runs and survives minification (tests/build-pow.test.ts).
 */
export function keepMathPow(): Plugin {
  return {
    name: 'rh-keep-math-pow',
    transform(code, id) {
      // (only the simulation and what feeds it: drawing and sound keep the engine's fast pow)
      if (!/[\\/]src[\\/](sim|maps|data|core|missions|modes|net|replay|conquest)[\\/].*\.ts$/.test(id) || !code.includes('Math.pow(')) return null;
      return { code: code.replace(/\bMath\.pow\(/g, '(0, Math.pow)('), map: null };
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [linkPreviewMeta(), keepMathPow()],
  // the public address share links point at from relative builds (src/share/links.ts)
  define: { 'import.meta.env.RH_SITE_URL': JSON.stringify(siteUrl()) },
  server: {
    port: 5173,
    host: true,
    // Poll for changes (inotify events are unreliable on network shares) and skip large local-only
    // folders: reference/ (an optional checkout of the original Red Alert source) and screenshots/.
    watch: { usePolling: true, interval: 300, ignored: ['**/reference/**', '**/screenshots/**', '**/node_modules/**', '**/desktop/**', '**/dist-*/**', '**/release/**'] },
  },
  // pre-bundle three.js add-ons together so the dev server never loads two copies of three
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/postprocessing/GTAOPass.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/Pass.js',
      'three/examples/jsm/postprocessing/ShaderPass.js',
      'three/examples/jsm/postprocessing/SMAAPass.js',
      'three/examples/jsm/shaders/FXAAShader.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/loaders/GLTFLoader.js', // baked models (src/render/models/hd.ts)
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        // three.js (core + the examples add-ons we use) in its own chunk: it changes far less often than the
        // game code, so returning players keep it cached across updates. index.html modulepreloads it, so the
        // service worker precaches it like the main bundle.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
