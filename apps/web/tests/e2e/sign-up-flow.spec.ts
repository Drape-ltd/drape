import path from 'node:path'
import { expect, test, type Page } from 'playwright/test'

const avatarFixture = path.resolve(
  process.cwd(),
  'public/editorial/drapeon-pattern-planning-v1.jpg',
)

async function fillValidCredentials(page: Page) {
  await page.getByLabel('Display name').fill('Signup QA')
  await page.getByLabel('Phone number *').fill('2025550147')
  await page.getByLabel('Email').fill('signup-qa@example.com')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Drapeon-QA-4821!')
  await page.getByRole('textbox', { name: 'Confirm password', exact: true }).fill('Drapeon-QA-4821!')
}

async function expectHeadingBelowStickyHeader(page: Page, name: string) {
  const header = await page.locator('header').boundingBox()
  const heading = await page.getByRole('heading', { name }).boundingBox()
  expect(header).not.toBeNull()
  expect(heading).not.toBeNull()
  expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
}

test.describe('create-account flow', () => {
  test('keeps validation local and explains an unsupported profile photo', async ({ page }) => {
    await page.goto('/sign-up')

    await fillValidCredentials(page)
    await page.getByRole('textbox', { name: 'Confirm password', exact: true }).fill('Different-QA-4821!')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: /passwords do not match/i })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'avatar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    })
    await expect(
      page.getByRole('alert').filter({ hasText: 'JPG, PNG, or WebP image under 10 MB' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start your Drapeon account.' })).toBeVisible()
  })

  test('previews a selected profile photo and preserves it across account-role steps', async ({ page }) => {
    await page.goto('/sign-up')

    await expect(page.getByRole('heading', { name: 'Start your Drapeon account.' })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(avatarFixture)
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change' })).toBeVisible()

    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Choose your role.' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Customer Find tailors/ })).toHaveAttribute('aria-pressed', 'true')
    await expectHeadingBelowStickyHeader(page, 'Choose your role.')

    await page.getByRole('button', { name: /Tailor Build your storefront/ }).click()
    await expect(page.getByRole('button', { name: /Tailor Build your storefront/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/studio setup follows confirmation/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your identity.' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible()
  })

  test('identifies selected customer setup choices for assistive technology', async ({ page }) => {
    await page.goto('/sign-up')
    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await page.getByRole('button', { name: 'Centimetres' }).click()
    await page.getByRole('button', { name: /Both I order/ }).click()

    await expect(page.getByRole('button', { name: 'Centimetres' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Inches' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: /Both I order/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('keeps every signup step within a narrow viewport', async ({ page }) => {
    await page.goto('/sign-up')
    await fillValidCredentials(page)

    for (const expectedHeading of [
      'Start your Drapeon account.',
      'Choose your role.',
      'Tell tailors about your style.',
    ]) {
      await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${expectedHeading} horizontal overflow`).toBeLessThanOrEqual(1)
      if (expectedHeading !== 'Tell tailors about your style.') {
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
      }
    }
  })

  test('tailor registration confirms the account before mandatory studio setup', async ({ page }) => {
    await page.goto('/sign-up?role=TAILOR')
    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page.getByRole('button', { name: /Tailor Build your storefront/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/studio setup follows confirmation/i)).toBeVisible()
    await expect(page.getByText(/Boutique and Tailor Shop accounts must add their first hidden ready-made proof item/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Your identity.' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'City or base location' })).toHaveCount(0)
  })

  test('restores the public studio draft after a reload without restoring passwords', async ({ page }) => {
    await page.goto('/sign-up')
    await page.locator('input[type="file"]').first().setInputFiles(avatarFixture)
    await fillValidCredentials(page)
    await page.getByLabel('Display name').fill('Reload Proof Tailor')
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await page.reload()

    await expect(page.getByLabel('Display name')).toHaveValue('Reload Proof Tailor')
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('')
    await expect(page.getByText(/saved signup draft was restored/i)).toBeVisible()
  })

  test('restores the current signup step and post-submit confirmation state after reload', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('drapeon.web.auth.signup-draft.v1', JSON.stringify({
        step: 6,
        pendingConfirmationEmail: 'resume@example.com',
        role: 'TAILOR',
        displayName: 'Resume Tailor',
        phone: '+12025550123',
        email: 'resume@example.com',
      }))
    })
    await page.goto('/sign-up?role=TAILOR')

    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
    await expect(page.getByText('resume@example.com')).toBeVisible()
    await expect(page.getByText(/re-enter your password/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /i've confirmed.*continue/i })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Faccount%2Fprofile%3Fsetup%3D1',
    )
  })
})
