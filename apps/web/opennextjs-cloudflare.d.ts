declare module '@opennextjs/cloudflare' {
  export function defineCloudflareConfig<T extends object = Record<string, never>>(
    config?: T
  ): T
}
