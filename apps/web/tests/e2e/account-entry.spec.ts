import { expect, test } from 'playwright/test'

test.describe('authenticated web entry contract', () => {
  test('private account routes create a recoverable authentication checkpoint', async ({ page }) => {
    await page.goto('/account/orders')
    await expect(page).toHaveURL(/\/sign-in|\/account\/orders/)
    if (page.url().includes('/sign-in')) {
      await expect(page.getByRole('link', { name: /explore/i })).toBeVisible()
    } else {
      await expect(page.getByText(/sign in to continue/i)).toBeVisible()
    }
  })

  test('customer entry exposes account creation without waitlist language', async ({ page }) => {
    await page.goto('/account/customer')
    await expect(page.getByRole('link', { name: 'Create customer account' })).toBeVisible()
    await expect(page.getByText(/join (the )?waitlist/i)).toHaveCount(0)
  })

  test('tailor entry separates sign-in from application', async ({ page }) => {
    await page.goto('/account/tailor')
    await expect(page.locator('a[href="/apply?source=account"]')).toBeVisible()
    await expect(page.getByText(/join (the )?waitlist/i)).toHaveCount(0)
  })

  test('account entry pages never overflow the viewport horizontally', async ({ page }) => {
    for (const path of ['/account/customer', '/account/tailor', '/sign-in']) {
      await page.goto(path)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1)
    }
  })

  test('legacy account Explore resolves to the canonical marketplace', async ({ page }) => {
    await page.goto('/account/explore')
    await expect(page).toHaveURL(/\/explore$/)
    await expect(page.getByRole('heading', { name: /find the right tailor/i })).toBeVisible()
  })
})
