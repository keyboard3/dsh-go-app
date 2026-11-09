import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import {
  appHome, buildApk, checkToolchainComponent, configureToolchain, loadToolchain,
  toolchainCandidates, toolchainOverrides,
} from './android.js'
import { createProject, readProject } from './project.js'
import sources from './toolchain-sources.json' with { type: 'json' }

const run = promisify(execFile)
export const androidSdkTerms = 'https://developer.android.com/studio/terms'
const cache = join(appHome, 'toolchains')

function sourceProfile() {
  const profile = sources[`${process.platform}-${process.arch}`]
  if (!profile) return undefined
  const [major, minor] = (process.report.getReport().header.glibcVersionRuntime ?? '').split('.').map(Number)
  const [requiredMajor, requiredMinor] = profile.minimumGlibc.split('.').map(Number)
  if (major > requiredMajor || (major === requiredMajor && minor >= requiredMinor)) return profile
}

export async function inspectToolchain() {
  try {
    await loadToolchain()
    return { ready: true, canSetup: false, detail: 'Android toolchain is ready.' }
  } catch (error) {
    const canSetup = Boolean(sourceProfile())
    const detail = canSetup
      ? `${error.message} The first confirmed build can prepare the missing tools in an approval-enabled chat.`
      : `${error.message} Automatic setup requires Linux ARM64 with glibc 2.38 or newer.`
    return { ready: false, canSetup, detail }
  }
}

async function download(asset, destination, signal) {
  let response
  try {
    response = await fetch(asset.url, { signal })
  } catch (error) {
    throw new Error(`Could not download ${asset.name}: ${error.cause?.message ?? error.message}`, { cause: error })
  }
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') {
    await response.body?.cancel()
    throw new Error(`Download failed for ${asset.name} (HTTP ${response.status}).`)
  }
  const hash = createHash('sha256')
  let bytes = 0
  const check = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > asset.bytes) return callback(new Error(`${asset.name} exceeds its pinned download size.`))
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body), check, createWriteStream(destination, { mode: 0o600 }), { signal })
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) {
    throw new Error(`Download size or SHA-256 does not match for ${asset.name}.`)
  }
}

async function findComponent(key, paths) {
  for (const path of paths) {
    try {
      return await checkToolchainComponent(key, path)
    } catch (error) {
      if (path !== undefined && path === process.env[toolchainOverrides[key]]) throw error
    }
  }
}

async function installComponent(key, asset, target, javaHome, signal) {
  const stage = await mkdtemp(join(cache, '.download-'))
  try {
    const archive = join(stage, 'archive.' + asset.format)
    const unpacked = join(stage, 'contents')
    await mkdir(unpacked)
    await download(asset, archive, signal)
    if (asset.format === 'tar.gz') {
      await run('tar', [
        '-xzf', archive, '--no-same-owner', '--no-same-permissions',
        '--strip-components', String(asset.stripComponents ?? 0), ...(asset.entries ?? []),
      ], { cwd: unpacked, signal })
    } else {
      await run(join(javaHome, 'bin', 'jar'), ['xf', archive, ...asset.entries], { cwd: unpacked, signal })
    }
    await checkToolchainComponent(key, join(unpacked, asset.path))
    signal.throwIfAborted()
    try {
      await rename(unpacked, target)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
    }
    return await checkToolchainComponent(key, join(target, asset.path))
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export async function setupToolchain({ acceptAndroidSdkLicense, signal } = {}) {
  const current = await inspectToolchain()
  if (current.ready) return { ready: true, downloaded: [] }
  if (!current.canSetup) throw new Error(current.detail)
  if (acceptAndroidSdkLicense !== true) throw new Error(`Review ${androidSdkTerms} and run setup --accept-android-sdk-license.`)
  const deadline = AbortSignal.timeout(30 * 60_000)
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline

  const candidates = await toolchainCandidates()
  const toolchain = {}
  const downloaded = []
  await mkdir(cache, { recursive: true, mode: 0o700 })
  for (const [key, asset] of Object.entries(sourceProfile().components)) {
    const target = join(cache, `${key}-${asset.sha256}`)
    const paths = [candidates[key], join(target, asset.path)]
    if (key === 'javaHome') paths.push('/usr/lib/jvm/java-17-openjdk-arm64')
    toolchain[key] = await findComponent(key, paths)
    if (!toolchain[key]) {
      toolchain[key] = await installComponent(key, asset, target, toolchain.javaHome, signal)
      downloaded.push(asset.name)
    }
  }

  const smoke = await mkdtemp(join(cache, '.verify-'))
  try {
    await createProject(smoke, 'toolchain-check', 'Toolchain Check')
    const project = await readProject(smoke, 'toolchain-check')
    await buildApk(project, project.sha256, signal, { toolchain, signingHome: smoke })
    signal.throwIfAborted()
    const { config } = await configureToolchain(toolchain)
    return { ready: true, downloaded, config }
  } finally {
    await rm(smoke, { recursive: true, force: true })
  }
}
