import {
  DRAPE_CUSTOMER_GUIDE_TOPICS,
  DRAPE_EXCEPTION_BUCKETS,
  DRAPE_EXCEPTION_LAUNCH_RAILS,
  DRAPE_EXCEPTION_RUNBOOK_ENTRIES,
  DRAPE_PUBLIC_TRUST_SECTIONS,
  DRAPE_TAILOR_GUIDE_TOPICS,
} from '../src/exception-os'

describe('exception OS launch content', () => {
  it('keeps every runbook entry tied to a known bucket', () => {
    const bucketIds = new Set(DRAPE_EXCEPTION_BUCKETS.map((bucket) => bucket.id))

    for (const entry of DRAPE_EXCEPTION_RUNBOOK_ENTRIES) {
      expect(bucketIds.has(entry.bucket)).toBe(true)
      expect(entry.keywords.length).toBeGreaterThanOrEqual(4)
      expect(entry.opsActions.length).toBeGreaterThanOrEqual(3)
      expect(entry.customerCopy.length).toBeGreaterThan(20)
      expect(entry.tailorCopy.length).toBeGreaterThan(20)
    }
  })

  it('covers the launch-critical trust buckets across guide surfaces', () => {
    expect(DRAPE_EXCEPTION_BUCKETS).toHaveLength(6)
    expect(DRAPE_EXCEPTION_LAUNCH_RAILS.length).toBeGreaterThanOrEqual(5)
    expect(DRAPE_PUBLIC_TRUST_SECTIONS.length).toBeGreaterThanOrEqual(4)
    expect(DRAPE_CUSTOMER_GUIDE_TOPICS.length).toBeGreaterThanOrEqual(6)
    expect(DRAPE_TAILOR_GUIDE_TOPICS.length).toBeGreaterThanOrEqual(6)
  })

  it('does not duplicate runbook titles', () => {
    const titles = DRAPE_EXCEPTION_RUNBOOK_ENTRIES.map((entry) => entry.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('uses the Drapeon name throughout the customer guide', () => {
    for (const topic of DRAPE_CUSTOMER_GUIDE_TOPICS) {
      expect(topic.body).not.toMatch(/\bDrape\b/)
    }
  })
})
