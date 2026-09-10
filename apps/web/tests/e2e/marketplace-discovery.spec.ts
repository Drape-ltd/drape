import { expect, test } from 'playwright/test'

test.describe('customer marketplace discovery contract', () => {
  test('opens a real approved profile and preserves brief intent through auth', async ({ page }) => {
    await page.goto('/explore')

    const profileLinks = page.locator('a[href^="/tailors/"]')
    await expect(profileLinks.first()).toBeVisible()
    expect(await profileLinks.count()).toBeGreaterThan(0)

    const card = profileLinks.first()
    const cardBox = await card.boundingBox()
    expect(cardBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(420)

    await card.click()
    await expect(page).toHaveURL(/\/tailors\/[0-9a-f-]{36}$/, { timeout: 10_000 })
    await expect(page.getByText('Approved tailor')).toBeVisible()
    await expect(page.locator('main img, main video').first()).toBeVisible()

    const startBrief = page.getByRole('link', { name: /start a brief/i })
    await expect(startBrief).toBeVisible()
    const destination = await startBrief.getAttribute('href')
    expect(destination).toContain('/sign-in?next=')
    expect(decodeURIComponent(destination ?? '')).toContain('/account/brief/')
  })

  test('portfolio viewer is keyboard operable and restores focus', async ({ page }) => {
    await page.goto('/explore')
    await page.locator('a[href^="/tailors/"]').first().click()

    const portfolioTrigger = page.getByRole('button', { name: /^open .* portfolio/i }).first()
    if (await portfolioTrigger.count() === 0) return

    await portfolioTrigger.click()
    const dialog = page.getByRole('dialog', { name: /portfolio viewer/i })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close portfolio viewer' })).toBeFocused()

    const dialogBox = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(dialogBox?.x).toBe(0)
    expect(dialogBox?.y).toBe(0)
    expect(dialogBox?.width).toBe(viewport?.width)
    expect(dialogBox?.height).toBe(viewport?.height)
    await expect(dialog).toHaveCSS('position', 'fixed')
    await expect(dialog).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    const nextItem = page.getByRole('button', { name: 'Next portfolio item' })
    if (await nextItem.count()) {
      await nextItem.click()
      await expect(dialog.getByText('2 /', { exact: false })).toBeVisible()
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(portfolioTrigger).toBeFocused()
  })
})
