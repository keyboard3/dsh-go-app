import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { parseIcon, renderIconPreview, starterIcon } from './icon.js'

const PROJECT_ID = /^[a-z][a-z0-9-]{0,47}$/
const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._()\u2013-]{0,59}$/u
const PACKAGE_NAME = /^app\.dshgo\.generated\.[a-z][a-z0-9_]{0,47}_[a-f0-9]{12}$/
const MAX_HTML = 1024 * 1024
const MAX_ICON = 24 * 1024
const PREVIEW_TTL = 15 * 60_000
const MAX_PREVIEWS = 8

export const offlineTemplate = 'offline-webview'
export const gyroscopeTemplate = 'gyroscope-webview'

const previewPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const iconPreviewPolicy = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"

async function directory(location) {
  if (!(await lstat(location)).isDirectory()) throw new Error('Expected a real project directory.')
  return location
}

export async function readProjectFile(location, limit) {
  const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('Expected a regular file within the size limit.')
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > limit) throw new Error('Project file exceeds the size limit.')
    return buffer.subarray(0, length)
  } finally {
    await handle.close()
  }
}

async function projectRoot(workspace) {
  return join(await realpath(workspace), 'dsh-apps')
}

function validateId(id) {
  if (typeof id !== 'string' || !PROJECT_ID.test(id)) {
    throw new Error('Use a project ID of 1–48 lowercase letters, digits or hyphens, starting with a letter.')
  }
}

function validateName(name) {
  if (typeof name !== 'string' || !APP_NAME.test(name)) {
    throw new Error('Use an app name of up to 60 letters, digits, spaces or simple punctuation, starting with a letter or digit.')
  }
}

function validateTemplate(template) {
  if (template !== offlineTemplate && template !== gyroscopeTemplate) {
    throw new Error('Invalid Android app template.')
  }
}

function starterPage(name) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  body { margin: 0; background: #f5f8f6; color: #19332b; font: 1rem system-ui, sans-serif; }
  main { max-width: 32rem; margin: 3rem auto; padding: 1.5rem; }
  output { display: block; margin: 1rem 0; font-size: 2rem; }
  button { padding: .7rem 1.2rem; background: #16664d; color: white; border: 0; border-radius: .5rem; font: inherit; }
</style>
<main>
  <h1>${name}</h1>
  <output id="count" aria-live="polite"></output>
  <button id="add" type="button">Add one</button>
</main>
<script>
  let count = Number(localStorage.getItem('count') || 0)
  const output = document.getElementById('count')
  function render() { output.textContent = 'Saved count: ' + count }
  document.getElementById('add').addEventListener('click', () => {
    localStorage.setItem('count', String(++count))
    render()
  })
  render()
</script>
</html>
`
}

export async function createProject(workspace, id, name, template = offlineTemplate) {
  validateId(id)
  validateName(name)
  validateTemplate(template)
  const metadata = { name, packageName: `app.dshgo.generated.${id.replaceAll('-', '_')}_${randomBytes(6).toString('hex')}` }
  let page = starterPage(name)
  if (template === gyroscopeTemplate) {
    metadata.template = template
    const source = await readFile(new URL('./android/gyroscope.html', import.meta.url), 'utf8')
    page = source.replaceAll('{{APP_NAME}}', name)
  }
  const root = await projectRoot(workspace)
  await mkdir(root, { recursive: true })
  await directory(root)
  const path = join(root, id)
  const temporary = await mkdtemp(join(root, '.new-'))
  try {
    await writeFile(join(temporary, 'app.json'), JSON.stringify(metadata, null, 2) + '\n')
    await writeFile(join(temporary, 'index.html'), page)
    await writeFile(join(temporary, 'icon.json'), JSON.stringify(starterIcon, null, 2) + '\n')
    try {
      await lstat(path)
      throw new Error(`Project "${id}" already exists.`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return { path, page: join(path, 'index.html'), icon: join(path, 'icon.json'), packageName: metadata.packageName }
}

export async function readProject(workspace, id) {
  validateId(id)
  const root = await directory(await projectRoot(workspace))
  const path = await directory(join(root, id))
  const metadata = JSON.parse(await readProjectFile(join(path, 'app.json'), 4096))
  validateName(metadata.name)
  if (typeof metadata.packageName !== 'string' || !PACKAGE_NAME.test(metadata.packageName)) {
    throw new Error('Invalid generated Android package name.')
  }
  const template = metadata.template === undefined ? offlineTemplate : metadata.template
  validateTemplate(template)
  const page = await readProjectFile(join(path, 'index.html'), MAX_HTML)
  if (page.length === 0) throw new Error('index.html is empty.')
  let icon
  try {
    icon = parseIcon(await readProjectFile(join(path, 'icon.json'), MAX_ICON))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const digest = createHash('sha256')
  if (icon) digest.update(JSON.stringify({ template, icon }) + '\0')
  else if (template !== offlineTemplate) digest.update(template + '\0')
  return { path, name: metadata.name, packageName: metadata.packageName, template, page, icon, sha256: digest.update(page).digest('hex') }
}

export function createPreviewManager() {
  const openPreviews = new Set()
  return {
    async open(project) {
      if (openPreviews.size >= MAX_PREVIEWS) openPreviews.values().next().value.close()
      const route = '/' + randomBytes(24).toString('hex')
      const pageRoute = route + '/index.html'
      const iconRoute = route + '/icon.html'
      const iconPage = project.icon && renderIconPreview(project.name, project.icon)
      let origin
      const server = createServer((req, res) => {
        const isIcon = iconPage && req.url === iconRoute
        if (req.headers.host !== origin || (!isIcon && req.url !== pageRoute) || req.method !== 'GET') {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': isIcon ? iconPreviewPolicy : previewPolicy,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        }).end(isIcon ? iconPage : project.page)
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      origin = '127.0.0.1:' + server.address().port
      const entry = {
        project,
        close() {
          clearTimeout(timer)
          openPreviews.delete(entry)
          server.close()
          server.closeAllConnections()
        },
      }
      const timer = setTimeout(entry.close, PREVIEW_TTL)
      timer.unref()
      openPreviews.add(entry)
      const base = 'http://' + origin
      return { url: base + pageRoute, iconUrl: iconPage ? base + iconRoute : undefined, sha256: project.sha256, close: entry.close }
    },
    has(project, sha256) {
      return [...openPreviews].some(({ project: snapshot }) => snapshot.path === project.path
        && snapshot.packageName === project.packageName && snapshot.name === project.name
        && snapshot.template === project.template
        && Boolean(snapshot.icon) === Boolean(project.icon)
        && snapshot.sha256 === sha256)
    },
    close() {
      for (const preview of openPreviews) preview.close()
    },
  }
}
