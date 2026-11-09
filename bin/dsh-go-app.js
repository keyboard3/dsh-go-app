#!/usr/bin/env node
import { buildApk, configureToolchain, loadToolchain } from '../lib/android.js'
import { createPreviewManager, createProject, readProject } from '../lib/project.js'

const help = `dsh-go-app doctor
dsh-go-app configure JAVA_HOME SDK_TOOLS ANDROID_JAR TOOL_JARS
dsh-go-app create PROJECT_ID "App name"
dsh-go-app preview PROJECT_ID
dsh-go-app build PROJECT_ID PREVIEW_SHA256`

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const workspace = process.cwd()
  switch (command) {
    case 'doctor':
      if (args.length === 0) {
        await loadToolchain()
        return { ready: true }
      }
      break
    case 'configure':
      if (args.length === 4) {
        const [javaHome, sdkTools, androidJar, toolJars] = args
        return configureToolchain({ javaHome, sdkTools, androidJar, toolJars })
      }
      break
    case 'create':
      if (args.length === 2) return createProject(workspace, args[0], args[1])
      break
    case 'preview':
      if (args.length === 1) {
        const preview = createPreviewManager()
        const { url, sha256 } = await preview.open(await readProject(workspace, args[0]))
        process.once('SIGINT', () => preview.close())
        process.once('SIGTERM', () => preview.close())
        return { url, sha256 }
      }
      break
    case 'build':
      if (args.length === 2) return buildApk(await readProject(workspace, args[0]), args[1])
      break
    case undefined:
    case '--help':
      console.log(help)
      return
  }
  throw new Error(help)
}

try {
  const output = await main()
  if (output) console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
