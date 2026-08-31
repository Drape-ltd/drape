# Drapeon Media Presentation Contract

## Purpose

Media is a primary marketplace record, not decorative page content. An approved portfolio image or video must remain attributable, retrievable, consistently framed, openable at full size, observable on failure, and safe to publish across iOS, Android, customer web, tailor web, and Ops.

## Current audit — 2026-08-31

| Layer | Current behavior | Gap |
| --- | --- | --- |
| Storage | Originals are stored in purpose-specific Supabase buckets. | Dimensions and MIME metadata are incomplete for older assets. |
| Inventory | `media_assets` tracks owner, purpose, moderation, and public URL. | It does not own presentation metadata or derivatives. |
| Moderation | Public gateway blocks rejected, quarantined, and unavailable URLs. | Approval does not invalidate every consumer cache immediately. |
| Tailor upload | Portfolio and ready-made flows use fixed 4:5 destructive editing; other flows use a reusable crop editor. | A single destructive crop cannot serve every marketplace ratio. |
| Public mobile Explore | A fixed wide crop is rendered with `cover`. | No saved focal point; portrait work and faces are clipped. |
| Public mobile profile | Only the first portfolio photo is exposed. | No complete public gallery or video parity. |
| Authenticated mobile profile | Complete image/video gallery and full-screen preview exist. | This stronger behavior is not shared with the public surface. |
| Public web Explore | Compact cards render image/video covers. | No focal metadata, poster selection, or explicit load-failure state. |
| Public web profile | Complete media list is returned. | Previously rendered as static crops that could not be opened. |
| Ops | Moderation can approve assets. | Reviewers need destination previews and crop/focal validation. |

## Canonical asset model

The original upload is immutable. Editing presentation never overwrites the original.

Every marketplace asset must expose one shared record:

- stable asset ID, owner ID, tailor profile ID, purpose, media kind, MIME type;
- original bucket/path, byte size, width, height, duration, checksum;
- moderation status, review reason, reviewer, and reviewed time;
- normalized focal point `x` and `y` in the inclusive range `0..1`;
- optional user-authored alt text and video poster timestamp;
- ordered portfolio position and one explicit primary-cover designation;
- processing state and derivative manifest;
- terminal availability state with a safe failure reason.

URLs are delivery details. Clients must identify and order assets by asset ID rather than treating URL arrays as the canonical portfolio.

## Presentation rules

| Surface | Preview ratio | Open behavior |
| --- | --- | --- |
| Avatar | 1:1 | Profile image viewer where appropriate |
| Explore maker card | 4:5 | Opens the maker profile |
| Profile hero | 4:5 | Opens the complete portfolio viewer |
| Portfolio grid | 4:5 | Opens original-ratio image/video viewer |
| Ready-made card | 4:5 | Opens product detail |
| Product gallery | 4:5 preview | Original-ratio viewer |
| Order evidence | Source ratio | Authenticated evidence viewer |

`cover` is permitted only when paired with the saved focal point. Full viewers use `contain` and preserve the original composition. A broken or unavailable primary asset falls forward to the next approved asset; it must not silently replace the entire portfolio with a generic block.

## Upload and editing flow

1. Select image or video.
2. Validate file type, size, dimensions, duration, orientation, and count before upload.
3. Upload the immutable original and create the media inventory row.
4. Show a single editor with pan, zoom, rotate, and focal-point controls.
5. Preview Explore, profile, and product destinations before saving.
6. Persist presentation metadata separately from the original.
7. Process derivatives asynchronously and show durable pending/failed/ready states.
8. Submit for moderation. Only approved media can enter public gateway responses.
9. Permit later repositioning without re-uploading or losing moderation history unless pixels change.

Automated face or garment detection may suggest an initial focal point, but the tailor's saved choice is authoritative.

## Video behavior

- Store an explicit poster frame and focal point.
- Autoplay only muted, inline, and while sufficiently visible.
- Never autoplay every grid video simultaneously.
- Respect reduced-motion and data-saving preferences.
- Full viewer provides native controls, captions when supplied, and a clear close action.
- A failed video falls back to its approved poster, not an empty tile.

## Gateway contract

Public reads return ordered approved asset objects, not independent photo/video URL arrays:

```ts
type MarketplaceMedia = {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  url: string
  posterUrl: string | null
  width: number | null
  height: number | null
  focalX: number
  focalY: number
  altText: string | null
  isPrimary: boolean
  position: number
}
```

During migration, the gateway may derive these objects from existing URL arrays and `portfolio_items`, but new clients consume the object contract. Moderation mutations must invalidate profile and Explore caches by profile ID.

## Failure and observability contract

Every terminal load failure records asset ID, surface, platform, resolved host, HTTP/error class, attempt count, release, and correlation ID. Do not log signed URLs or customer-private media paths. Alerts aggregate repeated failures by asset and surface instead of generating one incident per render.

Synthetic checks must verify that at least one approved production profile can load its Explore cover, open its profile, enumerate its complete portfolio, and fetch every returned public asset.

## Rollout gates

1. Add presentation fields and ordered media read model without removing legacy arrays.
2. Backfill dimensions, ordering, primary cover, and centered focal defaults.
3. Update shared types and the read gateway.
4. Extend the existing crop editor into a reusable non-destructive presentation editor.
5. Update tailor mobile/web upload and edit flows.
6. Update public and authenticated mobile/web renderers and viewers.
7. Add Ops destination previews, cache invalidation, and asset-health diagnostics.
8. Verify image, video, failure fallback, repositioning, moderation, and cache refresh on every applicable surface before retiring legacy arrays.
