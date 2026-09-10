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

  test('tailor entry separates sign-in from onboarding', async ({ page }) => {
    await page.goto('/account/tailor')
    await expect(page.getByRole('link', { name: 'Join as a tailor' }).first()).toBeVisible()
    await expect(page.getByText(/join (the )?waitlist/i)).toHaveCount(0)
  })

  test('public tailor recruitment explains the real setup and opens onboarding', async ({ page }) => {
    await page.goto('/tailors')

    await expect(page.getByRole('heading', { level: 1, name: 'Your craft. A clearer business.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your identity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Setup and verification' })).toBeVisible()
    await expect(page.getByText('Private randomized challenge video')).toBeVisible()
    await page.locator('summary').filter({ hasText: 'Who can see my trust video?' }).click()
    await expect(page.getByText(/not placed on your public profile/i)).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, '/tailors horizontal overflow').toBeLessThanOrEqual(1)

    await page.getByRole('link', { name: 'Start tailor setup' }).first().click()
    await expect(page).toHaveURL(/\/sign-up\?role=TAILOR$/)
  })

  test('account entry pages never overflow the viewport horizontally', async ({ page }) => {
    for (const path of ['/account/customer', '/account/tailor', '/sign-in']) {
      await page.goto(path)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1)
    }
  })

  test('account Explore stays inside the authenticated workspace', async ({ page }) => {
    await page.goto('/account/explore')
    await expect(page).toHaveURL(/\/account\/explore|\/sign-in/)
  })
})
