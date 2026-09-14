import { expect, test } from 'playwright/test'

test.describe('authenticated web entry contract', () => {
  test('private account routes create a recoverable authentication checkpoint', async ({
    page,
  }) => {
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

  test('public tailor recruitment explains the real setup and opens onboarding', async ({
    page,
  }) => {
    await page.goto('/tailors')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Your craft. A clearer business.' })
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your identity' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'See exactly what you will set up.' })
    ).toBeVisible()
    await expect(page.getByText('Private randomized challenge video')).toBeVisible()
    await page.locator('summary').filter({ hasText: 'Who can see my trust video?' }).click()
    await expect(page.getByText(/not placed on your public profile/i)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, '/tailors horizontal overflow').toBeLessThanOrEqual(1)

    await page.getByRole('link', { name: 'Start tailor setup' }).first().click()
    await expect(page).toHaveURL(/\/sign-up\?role=TAILOR$/)
  })

  test('account entry pages never overflow the viewport horizontally', async ({ page }) => {
    for (const path of ['/account/customer', '/account/tailor', '/sign-in']) {
      await page.goto(path)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1)
    }
  })

  test('Google account access is available from both web auth entry points', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()

    await page.goto('/sign-up?role=CUSTOMER')
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect(page.getByRole('heading', { name: 'Choose your role.' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Customer Find tailors/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(
      page.getByRole('button', { name: /Tailor Build your storefront/ })
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('cancelled social sign-in returns to a usable sign-in page', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'drapeon.web.auth.oauthIntent.v1',
        JSON.stringify({
          provider: 'google',
          mode: 'sign-in',
          role: null,
          next: '/account/orders',
          startedAt: Date.now(),
        })
      )
    })
    await page.goto('/auth/callback?error=access_denied&next=%2Faccount%2Forders')

    await expect(page.getByText('Account access was cancelled. Nothing was changed.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Faccount%2Forders&notice=oauth-cancelled'
    )
  })

  test('cancelled social signup returns to the selected role without replaying the callback', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'drapeon.web.auth.oauthIntent.v1',
        JSON.stringify({
          provider: 'google',
          mode: 'sign-up',
          role: 'TAILOR',
          next: '/account/profile?setup=1',
          startedAt: Date.now(),
        })
      )
    })
    await page.goto('/auth/callback?error=access_denied&next=%2Faccount%2Fprofile%3Fsetup%3D1')

    await expect(page.getByRole('link', { name: 'Return to create account' })).toHaveAttribute(
      'href',
      '/sign-up?role=TAILOR&notice=oauth-cancelled'
    )
  })

  test('customer setup never remains on an unbounded loading screen', async ({ page }) => {
    await page.goto('/account/customer/setup')

    await expect
      .poll(
        async () => ({
          loading: await page.getByText('Loading your setup…').count(),
          url: page.url(),
          unavailable: await page.getByRole('heading', { name: 'Setup unavailable' }).count(),
        }),
        { timeout: 12_000 }
      )
      .toMatchObject({ loading: 0 })
  })

  test('account Explore stays inside the authenticated workspace', async ({ page }) => {
    await page.goto('/account/explore')
    await expect(page).toHaveURL(/\/account\/explore|\/sign-in/)
  })
})
