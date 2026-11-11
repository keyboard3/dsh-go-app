import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { androidIconResources } from './icon.js'
import { gyroscopeTemplate, readProjectFile } from './project.js'

const run = promisify(execFile)
const source = fileURLToPath(new URL('./android/MainActivity.java', import.meta.url))
const gyroscopeSource = fileURLToPath(new URL('./android/GyroscopeActivity.java', import.meta.url))
const MIN_SDK = 26
const TARGET_SDK = 34
const BUILD_TOOLS = '34.0.0'
const MAX_APK = 16 * 1024 * 1024
const LOCAL_KEY_PASSWORD = 'android'
// Keep the original data directory so renamed installs reuse signing keys and toolchains.
export const appHome = resolve(process.env.DSH_GO_APP_HOME ?? join(homedir(), '.local', 'share', 'dsh-go-app'))
const toolchainFile = join(appHome, 'toolchain.json')
export const toolchainOverrides = {
  javaHome: 'DSH_GO_APP_JAVA_HOME',
  sdkTools: 'DSH_GO_APP_SDK_TOOLS',
  androidJar: 'DSH_GO_APP_ANDROID_JAR',
  toolJars: 'DSH_GO_APP_TOOL_JARS',
}

const componentFiles = {
  javaHome: { mode: constants.X_OK, files: ['bin/java', 'bin/javac', 'bin/jar', 'bin/keytool'] },
  sdkTools: { mode: constants.X_OK, files: ['aapt2', 'zipalign'] },
  androidJar: { mode: constants.R_OK, files: [''] },
  toolJars: { mode: constants.R_OK, files: ['d8.jar', 'apksigner.jar'] },
}

function manifest(project, version, activity) {
  const icon = project.icon ? '\n      android:icon="@mipmap/dsh_app_icon"' : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${project.packageName}" android:versionCode="${version}" android:versionName="1.0.${version}">
  <uses-sdk android:minSdkVersion="${MIN_SDK}" android:targetSdkVersion="${TARGET_SDK}"/>
  <application android:label="${project.name}" android:allowBackup="false"${icon}
      android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity android:name="app.dshgo.shell.${activity}" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`
}

export async function checkToolchainComponent(key, location) {
  if (typeof location !== 'string' || !isAbsolute(location)) {
    throw new Error('Set absolute toolchain paths with dsh-go-android-app configure or JAVA_HOME and ANDROID_HOME.')
  }
  const { files, mode } = componentFiles[key]
  for (const relative of files) {
    const path = join(location, relative)
    try {
      await access(path, mode)
    } catch (error) {
      throw new Error(`Android toolchain file unavailable: ${path}`, { cause: error })
    }
  }
  return location
}

async function checkedToolchain(config) {
  for (const key of Object.keys(componentFiles)) await checkToolchainComponent(key, config[key])
  return config
}

export async function configureToolchain(config) {
  await checkedToolchain(config)
  await mkdir(appHome, { recursive: true, mode: 0o700 })
  const temporary = await mkdtemp(join(appHome, '.config-'))
  try {
    const file = join(temporary, 'toolchain.json')
    await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
    await rename(file, toolchainFile)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return { config: toolchainFile }
}

export async function toolchainCandidates() {
  let saved = {}
  try {
    saved = JSON.parse(await readProjectFile(toolchainFile, 8192))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const sdkTools = process.env[toolchainOverrides.sdkTools] ?? saved.sdkTools
    ?? (sdk && join(sdk, 'build-tools', BUILD_TOOLS))
  return {
    javaHome: process.env[toolchainOverrides.javaHome] ?? saved.javaHome ?? process.env.JAVA_HOME,
    sdkTools,
    androidJar: process.env[toolchainOverrides.androidJar] ?? saved.androidJar
      ?? (sdk && join(sdk, 'platforms', 'android-' + TARGET_SDK, 'android.jar')),
    toolJars: process.env[toolchainOverrides.toolJars] ?? saved.toolJars ?? (sdkTools && join(sdkTools, 'lib')),
  }
}

export async function loadToolchain() {
  return checkedToolchain(await toolchainCandidates())
}

async function execute(executable, args, signal) {
  try {
    return await run(executable, args, { signal, timeout: 60_000, maxBuffer: 256 * 1024 })
  } catch (error) {
    const diagnostics = String(error.stderr || error.message).trim().slice(0, 2000)
    throw new Error(`Android build step failed (${executable}): ${diagnostics}`, { cause: error })
  }
}

async function signingKey(project, toolchain, version, signal, signingHome) {
  const keys = join(signingHome, 'signing')
  await mkdir(keys, { recursive: true, mode: 0o700 })
  const projectKeys = join(keys, project.packageName)
  const key = join(projectKeys, 'key.p12')
  try {
    if (!(await lstat(projectKeys)).isDirectory()) throw new Error('Expected a real signing directory.')
    if (!(await lstat(key)).isFile()) throw new Error('Expected a regular signing key file.')
    return key
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (version > 1) throw new Error('The signing key for this app is missing. Restore it before building an update.')
  const temporary = await mkdtemp(join(keys, '.new-'))
  try {
    const candidate = join(temporary, 'key.p12')
    await execute(join(toolchain.javaHome, 'bin', 'keytool'), [
      '-genkeypair', '-keystore', candidate, '-storetype', 'PKCS12', '-storepass', LOCAL_KEY_PASSWORD,
      '-alias', 'app', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-dname', 'CN=DSH Go App Local Development',
    ], signal)
    await chmod(candidate, 0o600)
    try {
      await rename(temporary, projectKeys)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
      if (!(await lstat(projectKeys)).isDirectory()) throw new Error('Expected a real signing directory.')
      if (!(await lstat(key)).isFile()) throw new Error('Expected a regular signing key file.')
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return key
}

export async function buildApk(project, expectedSha256, signal, options = {}) {
  if (expectedSha256 !== project.sha256) {
    throw new Error('The app differs from the confirmed preview. Preview again before building.')
  }
  const toolchain = options.toolchain ?? await loadToolchain()
  const dist = join(project.path, 'dist')
  await mkdir(dist, { recursive: true })
  if (!(await lstat(dist)).isDirectory()) throw new Error('Expected a real output directory.')
  const previous = (await readdir(dist))
    .map(name => /^v([1-9][0-9]{0,9})$/.exec(name))
    .filter(Boolean)
    .map(match => Number(match[1]))
  const version = previous.reduce((highest, value) => Math.max(highest, value), 0) + 1
  if (version > 2100000000) throw new Error('Android version code limit reached.')
  const stage = await mkdtemp(join(project.path, '.build-'))
  try {
    const java = join(toolchain.javaHome, 'bin', 'java')
    const runJava = (program, args) => execute(join(toolchain.javaHome, 'bin', program), args, signal)
    const runSdk = (program, args) => execute(join(toolchain.sdkTools, program), args, signal)
    const sign = args => execute(java, ['-jar', join(toolchain.toolJars, 'apksigner.jar'), ...args], signal)
    const assets = join(stage, 'assets')
    const classes = join(stage, 'classes')
    const androidManifest = join(stage, 'AndroidManifest.xml')
    const archive = join(stage, 'classes.jar')
    const raw = join(stage, 'raw.apk')
    const aligned = join(stage, 'aligned.apk')
    const signed = join(stage, 'signed.apk')
    const gyroscope = project.template === gyroscopeTemplate
    const activity = gyroscope ? 'GyroscopeActivity' : 'MainActivity'
    const sources = gyroscope ? [source, gyroscopeSource] : [source]
    await mkdir(assets)
    await mkdir(classes)
    await writeFile(join(assets, 'index.html'), project.page)
    await writeFile(androidManifest, manifest(project, version, activity))
    const linkArgs = ['link', '-I', toolchain.androidJar, '--manifest', androidManifest, '-A', assets, '-o', raw]
    if (project.icon) {
      const resources = join(stage, 'res')
      for (const [resource, xml] of Object.entries(androidIconResources(project.icon))) {
        const location = join(resources, resource)
        await mkdir(dirname(location), { recursive: true })
        await writeFile(location, xml)
      }
      const compiled = join(stage, 'resources.zip')
      await runSdk('aapt2', ['compile', '--dir', resources, '-o', compiled])
      linkArgs.push(compiled)
    }
    await runSdk('aapt2', linkArgs)
    await runJava('javac', ['--release', '8', '-proc:none', '-classpath', toolchain.androidJar, '-d', classes, ...sources])
    await runJava('jar', ['cf', archive, '-C', classes, '.'])
    await execute(java, [
      '-cp', join(toolchain.toolJars, 'd8.jar'), 'com.android.tools.r8.D8',
      '--min-api', String(MIN_SDK), '--lib', toolchain.androidJar, '--output', stage, archive,
    ], signal)
    await runJava('jar', ['uf', raw, '-C', stage, 'classes.dex'])
    await runSdk('zipalign', ['-f', '4', raw, aligned])
    const key = await signingKey(project, toolchain, version, signal, options.signingHome ?? appHome)
    await sign(['sign', '--ks', key, '--ks-pass', 'pass:' + LOCAL_KEY_PASSWORD,
      '--ks-key-alias', 'app', '--v4-signing-enabled', 'false', '--out', signed, aligned])
    await sign(['verify', signed])
    const bytes = await readProjectFile(signed, MAX_APK)
    const filename = `app-v${version}.apk`
    const delivery = join(stage, 'delivery')
    const release = join(dist, 'v' + version)
    await mkdir(delivery)
    await rename(signed, join(delivery, filename))
    signal?.throwIfAborted()
    try {
      await rename(delivery, release)
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
        throw new Error('Another build published this version. Run build again.')
      }
      throw error
    }
    const apk = join(release, filename)
    return { apk, packageName: project.packageName, version, sha256: createHash('sha256').update(bytes).digest('hex') }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
