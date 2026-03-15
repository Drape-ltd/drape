/**
 * Drape — E2E seed script
 *
 * Auth users: Supabase Admin REST API
 * DB records: Prisma (direct Postgres, bypasses PostgREST/RLS)
 *
 * Run from packages/db:
 *   cd packages/db && npx tsx seed-e2e.ts
 */

import { PrismaClient } from '@prisma/client'

const URL_BASE    = 'https://pqptfuqogvrajozfsqzi.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxcHRmdXFvZ3ZyYWpvemZzcXppIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQ1NDEyOCwiZXhwIjoyMDg5MDMwMTI4fQ.dMm1eh_b0fsr2xvCk-qdqQlk-hH4Jk-tVpXMjJJccTI'

const CUSTOMER_EMAIL = 'e2e-customer@drape.test'
const TAILOR_EMAIL   = 'e2e-tailor@drape.test'
const PASSWORD       = 'Drape2025!'

const prisma = new PrismaClient()

const AH = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
}

function ok(msg: string)  { console.log(`  ✓ ${msg}`) }
function log(msg: string) { console.log(`  ${msg}`) }
async function bail(msg: string, detail?: any): Promise<never> {
  console.error(`  ✗ ${msg}`, detail ?? '')
  await prisma.$disconnect()
  process.exit(1)
}

async function authGET(path: string) {
  const r = await fetch(`${URL_BASE}${path}`, { headers: AH })
  return r.json() as Promise<any>
}
async function authPOST(path: string, body: any) {
  const r = await fetch(`${URL_BASE}${path}`, {
    method: 'POST', headers: AH, body: JSON.stringify(body),
  })
  const j = await r.json() as any
  if (!r.ok) throw new Error(j?.message ?? JSON.stringify(j))
  return j
}
async function authDELETE(path: string) {
  await fetch(`${URL_BASE}${path}`, { method: 'DELETE', headers: AH })
}

async function deleteUserByEmail(email: string) {
  const data = await authGET('/auth/v1/admin/users?per_page=1000')
  const user = (data.users ?? []).find((u: any) => u.email === email)
  if (user) {
    await authDELETE(`/auth/v1/admin/users/${user.id}`)
    log(`deleted existing ${email}`)
  }
}

async function createAuthUser(email: string, role: 'CUSTOMER' | 'TAILOR', displayName: string) {
  const data = await authPOST('/auth/v1/admin/users', {
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, display_name: displayName },
  })
  ok(`created auth user ${email}`)
  return data as { id: string }
}

async function main() {
  console.log('\n🌱  Seeding e2e test data…\n')

  console.log('Cleaning up old accounts…')
  await deleteUserByEmail(CUSTOMER_EMAIL)
  await deleteUserByEmail(TAILOR_EMAIL)

  console.log('\nCreating auth accounts…')
  const customer = await createAuthUser(CUSTOMER_EMAIL, 'CUSTOMER', 'Test Customer')
  const tailor   = await createAuthUser(TAILOR_EMAIL,   'TAILOR',   'Test Tailor')

  // Purge ALL e2e data in FK-safe order, then recreate clean
  console.log('\nPurging stale e2e data…')
  // Child tables first (FK constraints)
  await prisma.contactBypassLog.deleteMany({})
  await prisma.pushToken.deleteMany({})
  await prisma.dispute.deleteMany({})
  await prisma.orderPhoto.deleteMany({})
  await prisma.orderStageUpdate.deleteMany({})
  await prisma.message.deleteMany({})
  await prisma.review.deleteMany({})
  await prisma.payout.deleteMany({})
  await prisma.order.deleteMany({})
  await prisma.offlineOrder.deleteMany({})
  await prisma.tailorClientNote.deleteMany({})
  await prisma.tailorClient.deleteMany({})
  await prisma.portfolioPhoto.deleteMany({})
  await prisma.tailorProfile.deleteMany({})
  await prisma.customerProfile.deleteMany({})
  ok('stale data purged')

  console.log('\nCreating customer profile…')
  try {
    await prisma.customerProfile.upsert({
      where:  { userId: customer.id },
      update: {},
      create: {
        userId:      customer.id,
        displayName: 'Test Customer',
        measurements: {
          chest: 40, waist: 34, hips: 38, shoulderWidth: 18,
          inseam: 32, sleeveLength: 25, neckCircumference: 16, height: 72,
          unit: 'in', fitStyle: 'Regular',
          garmentContext: 'MENSWEAR', bodyShape: 'RECTANGLE',
          fitFlags: [], bodyNote: null,
        },
      },
    })
    ok('customer profile + measurements saved')
  } catch (e: any) { await bail('customer_profile', e.message) }

  console.log('\nCreating tailor profile…')
  let tailorProfile: { id: string }
  try {
    tailorProfile = await prisma.tailorProfile.upsert({
      where:  { userId: tailor.id },
      update: {},
      create: {
        userId:             tailor.id,
        displayName:        'Test Tailor',
        businessName:       'Test Tailors Ltd',
        bio:                'Specialising in bespoke menswear and occasion wear.',
        location:           'London, UK',
        languages:          ['English'],
        specialtyTags:      ['Suits', 'Menswear'],
        priceRangeMin:      5000,
        priceRangeMax:      30000,
        currency:           'GBP',
        tier:               'VERIFIED',
        availability:       'OPEN',
        isVerified:         true,
        isLive:             true,
        avgRating:          4.8,
        totalReviews:       12,
        totalOrders:        24,
        portfolioPhotoUrls: [],
      },
    })
    ok(`tailor profile saved (id: ${tailorProfile.id})`)
  } catch (e: any) { await bail('tailor_profile', e.message) }

  console.log('\nCreating fixture orders…')
  const snap = {
    chest: 40, waist: 34, hips: 38, shoulderWidth: 18,
    inseam: 32, sleeveLength: 25, unit: 'in', fitStyle: 'Regular',
    garmentContext: 'MENSWEAR', bodyShape: 'RECTANGLE', fitFlags: [],
  }

  try {
    await prisma.order.create({ data: {
      reference:                    `E2ECONF${Date.now().toString(36).toUpperCase()}`,
      customerId:                   customer.id,
      tailorId:                     tailor.id,
      tailorProfileId:              tailorProfile!.id,
      garmentType:                  'Suit',
      garmentDescription:           'Two-piece navy suit for e2e testing.',
      fabricSource:                 'TAILOR_SOURCES',
      deliveryMethod:               'SHIPPING',
      quotedAmount:                 45000,
      quotedCompletionDate:         new Date(Date.now() + 30 * 86400000),
      stage:                        'CONFIRMED',
      customerMeasurementsSnapshot: snap,
    }})
    ok('CONFIRMED order created (flows 03, 05)')
  } catch (e: any) { await bail('CONFIRMED order', e.message) }

  try {
    await prisma.order.create({ data: {
      reference:                    `E2ESHIP${Date.now().toString(36).toUpperCase()}`,
      customerId:                   customer.id,
      tailorId:                     tailor.id,
      tailorProfileId:              tailorProfile!.id,
      garmentType:                  'Kaftan',
      garmentDescription:           'Embroidered kaftan for e2e dispute testing.',
      fabricSource:                 'TAILOR_SOURCES',
      deliveryMethod:               'SHIPPING',
      quotedAmount:                 25000,
      quotedCompletionDate:         new Date(Date.now() - 7 * 86400000),
      stage:                        'SHIPPED',
      customerMeasurementsSnapshot: snap,
    }})
    ok('SHIPPED order created (flow 06)')
  } catch (e: any) { await bail('SHIPPED order', e.message) }

  await prisma.$disconnect()

  console.log(`
✅  Seed complete.

  CUSTOMER  ${CUSTOMER_EMAIL}
  TAILOR    ${TAILOR_EMAIL}
  PASSWORD  ${PASSWORD}

Run tests:
  cd /Users/onaopemipodimowo/drape
  source .maestro/env.sh && maestro test .maestro/flows/
`)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
