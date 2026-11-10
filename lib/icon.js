const color = /^#[0-9a-f]{6}$/i
const operands = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 }
const size = 108

export const starterIcon = {
  background: '#17483D',
  paths: [
    { fill: '#E5FFF3', d: 'M 39 31 H 69 Q 77 31 77 39 V 69 Q 77 77 69 77 H 39 Q 31 77 31 69 V 39 Q 31 31 39 31 Z' },
    { fill: '#17483D', d: 'M 47 41 L 68 54 L 47 67 Z' },
  ],
}

function normalizedPath(d) {
  if (typeof d !== 'string' || d.length > 1800 || !/^M[MLHVCQZ0-9.,\s]+$/.test(d)) return
  const commands = []
  for (const command of d.trim().split(/(?=[MLHVCQZ])/)) {
    const type = command[0]
    const values = command.slice(1).trim().split(/[\s,]+/).filter(Boolean)
    if (values.length !== operands[type]
      || values.some(value => !/^\d+(?:\.\d+)?$/.test(value) || Number(value) > size)) return
    commands.push([type, ...values].join(' '))
  }
  return commands.join(' ')
}

export function parseIcon(contents) {
  let icon
  try {
    icon = JSON.parse(contents)
  } catch {
    throw new Error('icon.json must be valid JSON.')
  }
  const invalidIcon = 'icon.json needs a #RRGGBB background and 1–12 filled paths with explicit M/L/H/V/C/Q/Z commands and coordinates from 0 to 108.'
  if (typeof icon?.background !== 'string' || !color.test(icon.background) || !Array.isArray(icon.paths)
    || Object.keys(icon).length !== 2 || icon.paths.length < 1 || icon.paths.length > 12) {
    throw new Error(invalidIcon)
  }
  const paths = icon.paths.map(path => {
    const d = normalizedPath(path?.d)
    if (!d || typeof path.fill !== 'string' || !color.test(path.fill) || Object.keys(path).length !== 2) {
      throw new Error(invalidIcon)
    }
    return { fill: path.fill, d }
  })
  return { background: icon.background, paths }
}

function renderIconSvg(icon) {
  const paths = icon.paths.map(({ d, fill }) => `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72" width="144" height="144"><rect width="${size}" height="${size}" fill="${icon.background}"/>${paths}</svg>`
}

export function renderIconPreview(name, icon) {
  const label = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html>
<html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${label}</title>
<style>
  body {
    margin: 0;
    color: white;
    font: 13px system-ui, sans-serif;
    background:
      radial-gradient(ellipse at 93% 9%, #b5a0c2 0%, transparent 50%),
      radial-gradient(ellipse at 4% 72%, #78a5a2 0%, transparent 47%),
      linear-gradient(155deg, #506481 6%, #63608d 47%, #263b55 100%);
  }
  .launcher {
    box-sizing: border-box;
    min-height: 100vh;
    min-height: 100dvh;
    max-width: 480px;
    margin: auto;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: clamp(64px, 19vh, 152px) 18px max(18px, env(safe-area-inset-bottom));
  }
  .apps, .dock {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    justify-items: center;
    gap: 6px;
  }
  .app {
    width: 100%;
    min-width: 0;
    color: inherit;
    text-align: center;
    text-decoration: none;
  }
  .icon {
    display: block;
    width: min(56px, 100%);
    aspect-ratio: 1;
    margin: auto;
    overflow: hidden;
    border-radius: 25%;
    box-shadow: 0 3px 8px #1b263b66;
  }
  .icon svg { display: block; width: 100%; height: 100%; }
  .app:active .icon { transform: scale(.94); }
  .app-name {
    display: block;
    margin-top: 7px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 4px #192235;
  }
  .dock {
    padding: 11px 8px;
    border: 1px solid #ffffff40;
    border-radius: 26px;
    background: #eff4ff24;
  }
  .dock svg {
    box-sizing: border-box;
    width: min(44px, 100%);
    height: auto;
    padding: 10px;
    border-radius: 25%;
    background: #1828434d;
    fill: none;
    stroke: white;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
<main class="launcher">
  <div class="apps">
    <a class="app" href="index.html">
      <span class="icon" aria-hidden="true">${renderIconSvg(icon)}</span>
      <span class="app-name">${label}</span>
    </a>
  </div>
  <div class="dock" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M4 4h4l2 5-2 2c1 2 3 4 5 5l2-2 5 2v4C12 22 2 12 4 4Z"/></svg>
    <svg viewBox="0 0 24 24"><path d="M4 5h16v12h-9l-4 3v-3H4Z M8 9h8 M8 13h5"/></svg>
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m9 15 1-5 5-1-1 5Z"/></svg>
    <svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4v12H4Z"/><circle cx="12" cy="13" r="3"/></svg>
  </div>
</main>
</html>`
}

export function androidIconResources(icon) {
  const namespace = 'xmlns:android="http://schemas.android.com/apk/res/android"'
  const paths = icon.paths.map(({ d, fill }) =>
    `  <path android:fillColor="${fill}" android:pathData="${d}" android:fillType="evenOdd"/>`).join('\n')
  return {
    'mipmap-anydpi/dsh_app_icon.xml': `<adaptive-icon ${namespace}>
  <background android:drawable="@color/dsh_app_icon_background"/>
  <foreground android:drawable="@drawable/dsh_app_icon_foreground"/>
</adaptive-icon>\n`,
    'drawable/dsh_app_icon_foreground.xml': `<vector ${namespace}
    android:width="${size}dp" android:height="${size}dp" android:viewportWidth="${size}" android:viewportHeight="${size}">
${paths}
</vector>\n`,
    'values/dsh_app_icon_colors.xml': `<resources><color name="dsh_app_icon_background">${icon.background}</color></resources>\n`,
  }
}
