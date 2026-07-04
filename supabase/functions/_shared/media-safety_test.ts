import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { filterBlockedMediaUrls, findBlockedMediaUrls } from './media-safety.ts'

type MediaAssetRow = {
  public_url: string
  status: string
  moderation_status: string
}

function fakeMediaClient(rows: MediaAssetRow[], capturedLookups: string[][] = []) {
  return {
    from: (table: string) => {
      assertEquals(table, 'media_assets')
      return {
        select: () => ({
          in: (_column: string, values: string[]) => {
            capturedLookups.push(values)
            return Promise.resolve({
              data: rows.filter((row) => values.includes(row.public_url)),
              error: null,
            })
          },
        }),
      }
    },
  }
}

Deno.test('findBlockedMediaUrls treats pending public media as unsafe', async () => {
  const url = 'https://example.supabase.co/storage/v1/object/public/portfolio-photos/tailor/a.jpg'
  const blocked = await findBlockedMediaUrls(fakeMediaClient([
    { public_url: url, status: 'ACTIVE', moderation_status: 'PENDING_REVIEW' },
  ]) as never, [url])

  assertEquals([...blocked], [url])
})

Deno.test('filterBlockedMediaUrls keeps approved public media visible', async () => {
  const url = 'https://example.supabase.co/storage/v1/object/public/portfolio-photos/tailor/a.jpg'
  const safe = await filterBlockedMediaUrls(fakeMediaClient([
    { public_url: url, status: 'ACTIVE', moderation_status: 'APPROVED' },
  ]) as never, [url])

  assertEquals(safe, [url])
})

Deno.test('findBlockedMediaUrls matches cache-busting query variants', async () => {
  const canonical = 'https://example.supabase.co/storage/v1/object/public/avatars/user/avatar.jpg'
  const input = `${canonical}?t=1783033492`
  const lookups: string[][] = []
  const blocked = await findBlockedMediaUrls(fakeMediaClient([
    { public_url: canonical, status: 'ACTIVE', moderation_status: 'AUTO_BLOCKED' },
  ], lookups) as never, [input])

  assertEquals(lookups[0]?.includes(canonical), true)
  assertEquals([...blocked], [input])
})
