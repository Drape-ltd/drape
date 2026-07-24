import {
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  cacheControlForReadAction,
  PRIVATE_READ_CACHE_CONTROL,
  PUBLIC_READ_CACHE_CONTROL,
} from './read-cache-policy.ts'

Deno.test('personalized tailor profiles are never shared-cacheable', () => {
  assertEquals(cacheControlForReadAction('tailor-profile'), PRIVATE_READ_CACHE_CONTROL)
})

Deno.test('anonymous catalogue reads retain the public edge cache policy', () => {
  assertEquals(cacheControlForReadAction('tailor-shop'), PUBLIC_READ_CACHE_CONTROL)
  assertEquals(cacheControlForReadAction('seller-item'), PUBLIC_READ_CACHE_CONTROL)
  assertEquals(cacheControlForReadAction('explore-tailors'), PUBLIC_READ_CACHE_CONTROL)
})
