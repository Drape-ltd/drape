import { assertEquals } from 'jsr:@std/assert@1'
import { specialtyTagSearchClauses } from './tailor-search.ts'

Deno.test('specialty search covers common casing variants', () => {
  assertEquals(specialtyTagSearchClauses('bridal'), [
    'specialty_tags.cs.{"bridal"}',
    'specialty_tags.cs.{"Bridal"}',
    'specialty_tags.cs.{"BRIDAL"}',
  ])
})

Deno.test('specialty search safely supports multi-word tags', () => {
  assertEquals(specialtyTagSearchClauses('contemporary womenswear'), [
    'specialty_tags.cs.{"contemporary womenswear"}',
    'specialty_tags.cs.{"Contemporary womenswear"}',
    'specialty_tags.cs.{"Contemporary Womenswear"}',
    'specialty_tags.cs.{"CONTEMPORARY WOMENSWEAR"}',
  ])
})

Deno.test('specialty search removes array-filter control characters', () => {
  assertEquals(specialtyTagSearchClauses(' bridal,{test} '), [
    'specialty_tags.cs.{"bridal test"}',
    'specialty_tags.cs.{"Bridal test"}',
    'specialty_tags.cs.{"Bridal Test"}',
    'specialty_tags.cs.{"BRIDAL TEST"}',
  ])
})
