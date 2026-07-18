import { buildOpsVerificationEvidenceSummary } from '../src/ops-verification-evidence'

describe('ops verification evidence summary', () => {
  it('summarizes public profile, portfolio, proof item, and private ID evidence for review', () => {
    const summary = buildOpsVerificationEvidenceSummary({
      avatarUrl: 'https://cdn.drape.test/avatar.jpg',
      idDocumentUrl: 'https://signed.drape.test/id-selfie.jpg',
      portfolioPhotoUrls: [
        'https://cdn.drape.test/portfolio-1.jpg',
        'https://cdn.drape.test/portfolio-2.jpg',
      ],
      portfolioVideoUrls: ['https://cdn.drape.test/portfolio-video.mp4'],
      proofItems: [
        {
          id: 'item-1',
          title: 'Ankara two-piece set',
          category: 'Ready-made',
          description: 'A completed piece for onboarding review.',
          mediaUrls: ['https://cdn.drape.test/item-1.jpg', 'https://cdn.drape.test/item-2.mp4'],
          isLive: false,
          stockStatus: 'HIDDEN',
          inventoryQuantity: 2,
          sizes: ['M', 'L'],
          createdAt: '2026-07-17T00:00:00.000Z',
          updatedAt: '2026-07-17T00:00:00.000Z',
        },
      ],
    })

    expect(summary.portfolioMediaCount).toBe(3)
    expect(summary.proofItemCount).toBe(1)
    expect(summary.proofItemMediaCount).toBe(2)
    expect(summary.readyCount).toBe(4)
    expect(summary.missingLabels).toEqual([])
    expect(summary.checklist.map((item) => [item.key, item.ready])).toEqual([
      ['public_avatar', true],
      ['portfolio_media', true],
      ['proof_item', true],
      ['live_id', true],
    ])
  })

  it('names the missing evidence reviewers need before approval', () => {
    const summary = buildOpsVerificationEvidenceSummary({
      avatarUrl: null,
      idDocumentUrl: null,
      portfolioPhotoUrls: [],
      portfolioVideoUrls: [],
      proofItems: [],
    })

    expect(summary.readyCount).toBe(0)
    expect(summary.missingLabels).toEqual([
      'Public avatar',
      'Portfolio media',
      'Onboarding proof item',
      'Live selfie + ID',
    ])
  })
})
