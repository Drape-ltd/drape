import { spawn } from 'node:child_process'

const cloudflareDeployEnv = Boolean(
  process.env.CF_PAGES ||
  process.env.CF_PAGES_BRANCH ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ((process.env.CI === 'true' || process.env.CI === '1') &&
    (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID))
)

const mode = cloudflareDeployEnv ? 'deploy' : 'preview'
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = ['dlx', '@opennextjs/cloudflare@latest', mode]

if (cloudflareDeployEnv) {
  console.log('Cloudflare deploy environment detected; running OpenNext deploy instead of the long-lived preview server.')
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
})

child.on('error', (error) => {
  console.error(`Failed to run OpenNext ${mode}:`, error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
