import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildApk, loadToolchain } from './android.js'
import { createPreviewManager, createProject, readProject } from './project.js'

export const name = 'dsh-go-app'
export const inject = ['tools', 'workingDirectory']

const projectId = {
  type: 'string',
  required: true,
  description: 'Workspace project ID. Use lowercase letters, digits or hyphens, starting with a letter.',
}
const string = { type: 'string', required: true }

function result(properties) {
  return {
    schema: { type: 'object', additionalProperties: false, properties },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

export function apply(ctx) {
  const previews = createPreviewManager()
  ctx.effect(() => () => previews.close())

  async function workspace(exec) {
    if (exec.agent === undefined) throw new Error('Open a Harness chat with a workspace first.')
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    if (!cwd) throw new Error('Select a workspace before creating Android apps.')
    return cwd
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow' || exec.name !== 'dsh_app_build') return decision
    return {
      kind: 'ask',
      reason: 'Confirm the preview and build a signed Android APK.',
      displayReason: {
        en: 'Confirm that you reviewed the preview and want to build this Android APK.',
        'zh-CN': '请确认你已查看预览，并要将这个版本打包为 Android APK。',
      },
    }
  })

  ctx.tools.register(defineTool({
    name: 'dsh_app_doctor',
    description: 'Check whether this Harness host has an Android SDK and JDK configured for dsh-go-app.',
    parameters: {},
    output: result({ ready: { type: 'boolean', required: true }, detail: string }),
    async execute() {
      try {
        await loadToolchain()
        return { ready: true, detail: 'Android toolchain is ready.' }
      } catch (error) {
        return { ready: false, detail: error.message }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dsh_app_create',
    description: 'Start a standalone Android app project for a user request. Edit the returned index.html into a self-contained app using inline CSS and JavaScript and localStorage. Keep app.json to preserve the app identity for updates. This template supports offline pages without native bridges.',
    parameters: { projectId, name: { ...string, description: 'App display name.' } },
    output: result({ path: string, page: string, packageName: string }),
    async execute(args, exec) {
      return createProject(await workspace(exec), args.projectId, args.name)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dsh_app_preview',
    description: 'Serve a snapshot of a generated app in a browser on this same device. Show the URL to the user, wait for preview feedback or confirmation, and use the returned SHA-256 for the build. For edits, make a new preview.',
    parameters: { projectId },
    output: result({ url: string, sha256: string }),
    async execute(args, exec) {
      const { url, sha256 } = await previews.open(await readProject(await workspace(exec), args.projectId))
      return { url, sha256 }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dsh_app_build',
    description: 'Build and verify the signed APK for a confirmed app preview. Call only after the user has reviewed the preview. On success present the returned APK as a final deliverable if the present tool is available, and include a Markdown file link using the exact returned path. The user opens the APK with Android’s installer. Keep the same project for upgrades.',
    parameters: { projectId, previewSha256: { ...string, description: 'SHA-256 returned by dsh_app_preview.' } },
    output: result({ apk: string, packageName: string, version: { type: 'integer', required: true }, sha256: string }),
    timeoutMs: 300_000,
    async execute(args, exec) {
      const project = await readProject(await workspace(exec), args.projectId)
      if (!previews.has(project, args.previewSha256)) {
        throw new Error('No active preview matches this project and SHA-256. Preview again before building.')
      }
      return buildApk(project, args.previewSha256, exec.signal)
    },
  }))
}
