import { execFile } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import { DEFAULT_USER_AGENT, HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { toolchainCandidates } from './android.js'

const run = promisify(execFile)
const hosts = ['developer.android.com', 'developer.android.google.cn']
const maxExcerpt = 12_000
const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/
const docsWeb = new HttpFetchProvider({
  // Devsite puts a large navigation tree before the reference article.
  maxResponseBytes: 8_000_000,
  maxBodyChars: 8_000_000,
  timeoutMs: 25_000,
  maxRedirects: 3,
  userAgent: DEFAULT_USER_AGENT,
})

function normalizeAnchor(value) {
  try {
    value = decodeURIComponent(value)
  } catch {
    // A literal percent sign can appear in an HTML heading ID.
  }
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').replace(/\s/g, '')
}

function findSection(body, symbol, fragment) {
  if (body.kind === 'text') {
    if (fragment) return undefined
    const heading = [...body.content.matchAll(/^#{1,6}\s+([^\r\n]+)$/gm)].find((match) => match[1].replaceAll('`', '').trim() === symbol)
    if (!heading) return undefined
    return { content: body.content.slice(heading.index, heading.index + maxExcerpt), kind: 'text' }
  }

  const start = body.content.indexOf('<div class="devsite-article-body')
  if (start === -1) return undefined
  const end = body.content.indexOf('</devsite-article>', start)
  const article = body.content.slice(start, end === -1 ? undefined : end)
  const headings = [...article.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)]
  const matches = []
  for (const [index, heading] of headings.entries()) {
    const anchor = heading[2].match(/\bid=["']([^"']+)["']/i)?.[1]
    const label = heading[3].replace(/<[^>]*>/g, '').trim()
    const named = label === symbol || label.endsWith('.' + symbol)
    const matched = named && (!fragment || (anchor && normalizeAnchor(anchor) === fragment))
    if (!matched) continue
    const next = headings[index + 1]?.index ?? article.length
    matches.push(article.slice(heading.index, Math.min(next, heading.index + maxExcerpt)))
    if (fragment || matches.length === 3) break
  }
  if (!matches.length) return undefined
  return { content: matches.join('\n'), kind: 'html' }
}

export async function lookupAndroidReference({ url, api }, signal, web = docsWeb) {
  const requested = new URL(url)
  if (requested.protocol !== 'https:' || !hosts.includes(requested.host)
    || requested.username || requested.password || !requested.pathname.startsWith('/reference/')) {
    throw new Error('Supply an HTTPS Android API reference URL on developer.android.com or developer.android.google.cn.')
  }
  if (!identifier.test(api) || api.length > 160) throw new Error('Supply an API class, method, or field name.')
  const symbol = api.split('.').at(-1)
  const fragment = normalizeAnchor(requested.hash.slice(1))
  const language = requested.searchParams.get('hl')
  requested.search = ''
  if (language && /^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(language)) requested.searchParams.set('hl', language)
  const attempts = []
  for (const host of hosts) {
    signal?.throwIfAborted()
    requested.hostname = host
    const source = requested.href
    try {
      const page = await web.fetch({ url: source }, signal)
      const finalUrl = new URL(page.url)
      if (page.statusCode < 200 || page.statusCode >= 300) {
        attempts.push(`${source} returned HTTP ${page.statusCode}.`)
        continue
      }
      if (finalUrl.protocol !== 'https:' || !hosts.includes(finalUrl.host) || !finalUrl.pathname.startsWith('/reference/')) {
        attempts.push(`${source} redirected outside the official Android reference hosts.`)
        continue
      }
      const section = findSection(page.body, symbol, fragment)
      if (!section) {
        const result = page.truncated ? 'The response was incomplete' : 'No matching reference section was found'
        attempts.push(`${source}: ${result} for ${api}.`)
        continue
      }
      finalUrl.hash = requested.hash
      const excerpt = formatFetchOutput({ ...page, url: finalUrl.href, body: section }, maxExcerpt)
      return { found: true, source: finalUrl.href, excerpt, attempts }
    } catch (error) {
      signal?.throwIfAborted()
      attempts.push(`${source}: ${String(error.message).slice(0, 250)}`)
    }
  }
  return { found: false, attempts }
}

export async function verifyPlatformDeclaration(url, api, signal) {
  const path = new URL(url).pathname.replace(/^\/reference\/(?:kotlin\/)?/, '')
  if (!path.startsWith('android/')) return undefined
  const className = path.replaceAll('/', '.')
  if (!identifier.test(className)) return undefined
  let config
  try {
    config = await toolchainCandidates()
  } catch (error) {
    return `Could not read the project SDK configuration: ${String(error.message).slice(0, 250)}`
  }
  const { javaHome, androidJar } = config
  if (!javaHome || !androidJar || !isAbsolute(javaHome) || !isAbsolute(androidJar)) {
    return 'The project SDK is unavailable. Verify the signature after configuring the build tools.'
  }
  try {
    const { stdout } = await run(join(javaHome, 'bin', 'javap'), ['-public', '-classpath', androidJar, className], {
      signal, timeout: 5_000, maxBuffer: 256 * 1024,
    })
    const symbol = api.split('.').at(-1)
    const declaration = symbol === className.split('.').at(-1)
      ? /\b(class|interface|enum)\b/
      : new RegExp(`\\b${RegExp.escape(symbol)}(?=\\(|\\s*[;=])`)
    const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => declaration.test(line))
    return lines.length
      ? `Public declarations in ${androidJar}:\n${lines.slice(0, 6).join('\n')}`
      : `No direct declaration matched in ${androidJar}. Check inherited members and exact overloads.`
  } catch (error) {
    signal?.throwIfAborted()
    return `Could not verify ${className} against ${androidJar}: ${String(error.stderr || error.message).trim().slice(0, 250)}`
  }
}
