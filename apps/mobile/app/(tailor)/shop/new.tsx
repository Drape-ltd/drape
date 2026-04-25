import { useEffect, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Image } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  draftToSizeInventory,
  formatSizeInventorySummary,
  inventoryDraftFromSizeInventory,
  normalizeSizeInventory,
  sumSizeInventory,
  type SizeInventoryDraft,
} from '@/lib/ready-made-stock'
import {
  draftToReadyMadeSizeGuide,
  guideDraftFromSizeGuide,
  hasReadyMadeSizeGuide,
  normalizeReadyMadeSizeGuide,
  READY_MADE_FIT_FIELDS,
  READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS,
  recommendedFitFieldsForCategory,
  type ReadyMadeFitFieldKey,
  type ReadyMadeSizeGuideAdvice,
  type ReadyMadeFitUnit,
  type ReadyMadeSizeGuideDraft,
} from '@/lib/ready-made-fit'
import { deriveTailorReadiness, type TailorReadinessInput } from '@/lib/tailor-readiness'
import { stripExif } from '@/lib/stripExif'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const HOME_BG = '#F9F7F3'
const PRIMARY_GREEN = '#1D9E75'
const CHARCOAL = '#2C2C2A'
const MUTED_GREY = '#8F8D88'

const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const
const ITEM_CATEGORIES = ['Agbada', 'Kaftan', 'Suit', 'Dress', 'Crochet', 'Ready-made', 'Two-piece Set', 'Native Wear'] as const
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'] as const
const ITEM_TEMPLATES: Array<{ title: string; category: (typeof ITEM_CATEGORIES)[number]; sizes: string[] }> = [
  { title: 'Crochet Two-piece Set', category: 'Crochet', sizes: ['S', 'M', 'L'] },
  { title: 'Ready-made Agbada Set', category: 'Agbada', sizes: ['M', 'L', 'XL'] },
  { title: 'Kaftan Set', category: 'Kaftan', sizes: ['M', 'L', 'XL'] },
  { title: 'Two-piece Set', category: 'Two-piece Set', sizes: ['S', 'M', 'L'] },
]

function isMissingInventoryColumnError(error: any) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  const details = typeof error?.details === 'string' ? error.details.toLowerCase() : ''
  const hint = typeof error?.hint === 'string' ? error.hint.toLowerCase() : ''
  return [message, details, hint].some((value) =>
    value.includes('inventory_quantity') || value.includes('size_inventory') || value.includes('size_guide'),
  )
}

function fallbackInventoryQuantity(item: { stock_status?: string | null; is_live?: boolean | null }) {
  if (!item.is_live || item.stock_status === 'SOLD_OUT' || item.stock_status === 'HIDDEN') return 0
  if (item.stock_status === 'LOW_STOCK') return 1
  return 1
}

function describeInventoryState(input: { inventoryQuantity: number | null; isLive: boolean; sizes: string[] }) {
  if (input.inventoryQuantity == null || Number.isNaN(input.inventoryQuantity) || input.inventoryQuantity < 0) {
    return 'Choose sizes first, then add how many units are ready in each size.'
  }

  if (input.sizes.length === 0) {
    return 'Choose at least one size first, then add stock by size.'
  }

  if (!input.isLive) {
    if (input.inventoryQuantity === 0) {
      return 'This draft has no sellable stock yet. Add units to at least one size before you publish it.'
    }
    return `${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} across your selected sizes will be ready when you publish this live.`
  }

  if (input.inventoryQuantity === 0) {
    return 'Live items need at least 1 unit in at least one size.'
  }

  if (input.inventoryQuantity <= 2) {
    return `Low stock. Buyers will see this as limited availability with ${input.inventoryQuantity} left across your listed sizes.`
  }

  return `${input.inventoryQuantity} units are ready for sale across your listed sizes.`
}

function buildLiveReadinessChecks(input: {
  category: string
  photoCount: number
  sizes: string[]
  hasFitGuide: boolean
  description: string
  inventoryQuantity: number | null
  hasFulfillment: boolean
  hasPickupAddress: boolean
  pickupEnabled: boolean
}) {
  const checks = [
    {
      label: 'Category selected',
      ready: input.category.trim().length > 0,
      blockingMessage: 'Before this item can go live, choose a category so buyers know where it belongs.',
    },
    {
      label: input.photoCount > 0 ? `${input.photoCount} photo${input.photoCount === 1 ? '' : 's'} added` : 'At least 1 photo',
      ready: input.photoCount > 0,
      blockingMessage: 'Before this item can go live, add at least one clear photo so buyers can see the piece.',
    },
    {
      label: input.sizes.length > 0 ? `${input.sizes.length} size option${input.sizes.length === 1 ? '' : 's'} added` : 'At least 1 size',
      ready: input.sizes.length > 0,
      blockingMessage: 'Before this item can go live, add at least one size. Use One size if that fits this piece.',
    },
    {
      label: input.hasFitGuide ? 'Fit guide ready' : 'Fit guide required',
      ready: input.hasFitGuide,
      blockingMessage: 'Before this item can go live, add a fit guide so buyers can see what each size means and Drape can recommend the right fit.',
    },
    {
      label: input.description.trim().length >= 24 ? 'Description ready' : 'Fuller description',
      ready: input.description.trim().length >= 24,
      blockingMessage: 'Before this item can go live, add a fuller description. Aim for 1 or 2 sentences on the style, fit, fabric, or occasion so buyers understand the piece.',
    },
    {
      label:
        (input.inventoryQuantity ?? 0) >= 1
          ? `${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} across sizes`
          : 'At least 1 unit across sizes',
      ready: (input.inventoryQuantity ?? 0) >= 1,
      blockingMessage: 'Before this item can go live, add at least 1 unit to at least one size so buyers can actually order it.',
    },
    {
      label: input.hasFulfillment ? 'Fulfillment chosen' : 'At least 1 fulfillment option',
      ready: input.hasFulfillment,
      blockingMessage: 'Before this item can go live, pick at least one way customers can receive it.',
    },
  ]

  if (input.pickupEnabled) {
    checks.push({
      label: input.hasPickupAddress ? 'Private pickup address ready' : 'Private pickup address',
      ready: input.hasPickupAddress,
      blockingMessage: 'Before pickup items can go live, add your private pickup address in Profile.',
    })
  }

  return checks
}

function formatMissingChecksForAlert(missingChecks: Array<{ blockingMessage: string }>) {
  return missingChecks.map((check) => `• ${check.blockingMessage}`).join('\n')
}

export default function NewShopItemScreen() {
  const params = useLocalSearchParams<{ itemId?: string; filter?: string; intent?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [loadingItem, setLoadingItem] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<(typeof ITEM_CATEGORIES)[number] | ''>('')
  const [description, setDescription] = useState('')
  const [sizes, setSizes] = useState<string[]>([])
  const [sizeInventoryDraft, setSizeInventoryDraft] = useState<SizeInventoryDraft>({})
  const [customSize, setCustomSize] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('NGN')
  const [fitGuideUnit, setFitGuideUnit] = useState<ReadyMadeFitUnit>('in')
  const [fitGuideFields, setFitGuideFields] = useState<ReadyMadeFitFieldKey[]>([])
  const [fitGuideDraft, setFitGuideDraft] = useState<ReadyMadeSizeGuideDraft>({})
  const [fitNotes, setFitNotes] = useState('')
  const [stretchNotes, setStretchNotes] = useState('')
  const [sizeAdvice, setSizeAdvice] = useState<ReadyMadeSizeGuideAdvice>('ASK_SELLER')
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [sellerStatus, setSellerStatus] = useState<(TailorReadinessInput & { supportsReadyMade?: boolean | null }) | null>(null)
  const [hasPickupAddress, setHasPickupAddress] = useState(false)
  const itemId = typeof params.itemId === 'string' && params.itemId.length > 0 ? params.itemId : null
  const returnFilter = typeof params.filter === 'string' && params.filter.length > 0 ? params.filter : null
  const isRestockIntent = params.intent === 'restock'
  const isEditing = !!itemId
  const isDraftEditor = isEditing && returnFilter !== 'SOLD' && !isRestockIntent

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace({
      pathname: '/(tailor)/shop',
      params: returnFilter ? { filter: returnFilter } : undefined,
    })
  }

  useEffect(() => {
    void loadSellerDefaults()
  }, [user?.id, itemId])

  useEffect(() => {
    setSizeInventoryDraft((current) => {
      const nextDraft: SizeInventoryDraft = {}
      for (const size of sizes) {
        nextDraft[size] = current[size] ?? '0'
      }
      return nextDraft
    })
  }, [sizes])

  useEffect(() => {
    setFitGuideDraft((current) => {
      const nextDraft: ReadyMadeSizeGuideDraft = {}
      for (const size of sizes) {
        nextDraft[size] = {}
        for (const field of fitGuideFields) {
          nextDraft[size][field] = current[size]?.[field] ?? { min: '', max: '' }
        }
      }
      return nextDraft
    })
  }, [sizes, fitGuideFields])

  async function loadSellerDefaults() {
    if (!user?.id) return
    const { data } = await supabase
      .from('tailor_profiles')
      .select('currency, supports_ready_made, profile_completed, id_verification_status, is_live, stripe_account_id, paystack_account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: pickupDetails } = await supabase
      .from('tailor_pickup_details')
      .select('pickup_address')
      .eq('user_id', user.id)
      .maybeSingle()

    if (data?.currency && CURRENCIES.includes(data.currency as (typeof CURRENCIES)[number])) {
      setCurrency(data.currency as (typeof CURRENCIES)[number])
    }

    setSellerStatus({
      supportsReadyMade: (data as any)?.supports_ready_made ?? false,
      profileCompleted: (data as any)?.profile_completed ?? false,
      idVerificationStatus: (data as any)?.id_verification_status ?? 'NOT_SUBMITTED',
      isLive: (data as any)?.is_live ?? false,
      stripeAccountId: (data as any)?.stripe_account_id ?? null,
      paystackAccountId: (data as any)?.paystack_account_id ?? null,
    })
    setHasPickupAddress(typeof pickupDetails?.pickup_address === 'string' && pickupDetails.pickup_address.trim().length > 0)

    if (itemId && (data as any)?.supports_ready_made !== undefined) {
      setLoadingItem(true)
      let { data: itemData, error: itemError } = await supabase
        .from('seller_items')
        .select(`
          id,
          title,
          category,
          description,
          sizes,
          size_guide,
          price_amount,
          currency,
          photo_urls,
          stock_status,
          inventory_quantity,
          size_inventory,
          pickup_available,
          delivery_available,
          shipping_available,
          is_live
        `)
        .eq('id', itemId)
        .maybeSingle()

      if (itemError && isMissingInventoryColumnError(itemError)) {
        const fallback = await supabase
          .from('seller_items')
          .select(`
            id,
            title,
            category,
            description,
            sizes,
            price_amount,
            currency,
            photo_urls,
            pickup_available,
            delivery_available,
            shipping_available,
            is_live,
            stock_status
          `)
          .eq('id', itemId)
          .maybeSingle()

        itemData = fallback.data as any
        itemError = fallback.error as any
      }

      if (itemError || !itemData?.id) {
        Alert.alert('Item unavailable', 'We could not reopen this item for editing right now.')
        router.replace({
          pathname: '/(tailor)/shop',
          params: returnFilter ? { filter: returnFilter } : undefined,
        })
        setLoadingItem(false)
        return
      }

      if (itemData.is_live && itemData.stock_status !== 'SOLD_OUT') {
        Alert.alert('Live item locked', 'Move this item back to draft before editing it.')
        router.replace({
          pathname: '/(tailor)/shop',
          params: { filter: 'LIVE' },
        })
        setLoadingItem(false)
        return
      }

      setTitle(itemData.title ?? '')
      setCategory(((itemData.category ?? '') as (typeof ITEM_CATEGORIES)[number] | ''))
      setDescription(itemData.description ?? '')
      const resolvedSizes = Array.isArray(itemData.sizes) ? itemData.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : []
      setSizes(resolvedSizes)
      setPrice(itemData.price_amount ? String(itemData.price_amount / 100) : '')
      if (itemData.currency && CURRENCIES.includes(itemData.currency as (typeof CURRENCIES)[number])) {
        setCurrency(itemData.currency as (typeof CURRENCIES)[number])
      }
      setPhotoUrls(Array.isArray(itemData.photo_urls) ? itemData.photo_urls.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [])
      const normalizedGuide = normalizeReadyMadeSizeGuide((itemData as any).size_guide, resolvedSizes)
      setFitGuideUnit(normalizedGuide.unit)
      setFitGuideFields(normalizedGuide.fields)
      setFitGuideDraft(guideDraftFromSizeGuide({
        sizes: resolvedSizes,
        fields: normalizedGuide.fields,
        guide: normalizedGuide,
      }))
      setFitNotes(normalizedGuide.fitNotes ?? '')
      setStretchNotes(normalizedGuide.stretchNotes ?? '')
      setSizeAdvice(normalizedGuide.sizeAdvice ?? 'ASK_SELLER')
      setSizeInventoryDraft(
        inventoryDraftFromSizeInventory(
          resolvedSizes,
          normalizeSizeInventory(
            resolvedSizes,
            (itemData as any).size_inventory,
            typeof (itemData as any).inventory_quantity === 'number'
              ? (itemData as any).inventory_quantity
              : fallbackInventoryQuantity(itemData as any),
          ),
        ),
      )
      setPickupAvailable(itemData.pickup_available ?? false)
      setDeliveryAvailable(itemData.delivery_available ?? false)
      setShippingAvailable(itemData.shipping_available ?? false)
      setIsLive(itemData.is_live ?? false)
      setLoadingItem(false)
    }
  }

  function applyTemplate(template: { title: string; category: (typeof ITEM_CATEGORIES)[number]; sizes: string[] }) {
    setTitle(template.title)
    setCategory(template.category)
    setSizes(template.sizes)
    setFitGuideFields(recommendedFitFieldsForCategory(template.category))
  }

  function toggleSize(size: string) {
    setSizes((prev) => (prev.includes(size) ? prev.filter((value) => value !== size) : [...prev, size]))
  }

  function addCustomSize() {
    const next = customSize.trim()
    if (!next) return
    if (!sizes.includes(next)) setSizes((prev) => [...prev, next])
    setCustomSize('')
  }

  function applyRecommendedFitFields() {
    const recommended = recommendedFitFieldsForCategory(category || null)
    setFitGuideFields(recommended)
  }

  function toggleFitField(field: ReadyMadeFitFieldKey) {
    setFitGuideFields((current) =>
      current.includes(field)
        ? current.filter((value) => value !== field)
        : [...current, field],
    )
  }

  function setFitGuideRange(size: string, field: ReadyMadeFitFieldKey, edge: 'min' | 'max', value: string) {
    const sanitized = value.replace(/[^0-9.]/g, '')
    setFitGuideDraft((current) => ({
      ...current,
      [size]: {
        ...(current[size] ?? {}),
        [field]: {
          min: edge === 'min' ? sanitized : current[size]?.[field]?.min ?? '',
          max: edge === 'max' ? sanitized : current[size]?.[field]?.max ?? '',
        },
      },
    }))
  }

  function setSizeQuantity(size: string, value: string) {
    const sanitized = value.replace(/[^0-9]/g, '')
    setSizeInventoryDraft((current) => ({ ...current, [size]: sanitized }))
  }

  async function addPhoto() {
    if (!user?.id || uploadingPhoto || photoUrls.length >= 6) return

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: false,
    })

    if (result.canceled || !result.assets[0]) return

    setUploadingPhoto(true)
    try {
      const cleanUri = await stripExif(result.assets[0].uri)
      const filename = `shop/${user.id}/${Date.now()}.jpg`
      const response = await fetch(cleanUri)
      const blob = await response.blob()

      if (blob.size > 10 * 1024 * 1024) {
        Alert.alert('File too large', 'Item photos must be under 10 MB.')
        setUploadingPhoto(false)
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('seller-item-media')
        .upload(filename, blob, { contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('seller-item-media').getPublicUrl(filename)
      setPhotoUrls((prev) => [...prev, data.publicUrl])
    } catch (error: any) {
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not upload this photo yet. Retry when the signal improves.'
          : error?.message ?? 'Could not upload this photo right now. Please try again in a moment.',
      )
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function saveItem(nextIsLive = isLive) {
    if (saving || !user?.id) return
    const nextSizeInventory = draftToSizeInventory(sizes, sizeInventoryDraft)
    const nextSizeGuide = draftToReadyMadeSizeGuide({
      sizes,
      unit: fitGuideUnit,
      fields: fitGuideFields,
      draft: fitGuideDraft,
      fitNotes,
      stretchNotes,
      sizeAdvice,
    })
    const parsedInventoryQuantity = sumSizeInventory(nextSizeInventory)

    if (!title.trim()) {
      Alert.alert('Missing title', 'Give this item a simple name customers can understand.')
      return
    }
    if (!Number.isInteger(parsedInventoryQuantity) || parsedInventoryQuantity < 0) {
      Alert.alert('Missing stock', 'Add how many units are ready in each size.')
      return
    }
    if (!price.trim() || Number.isNaN(Number(price)) || Number(price) <= 0) {
      Alert.alert('Missing price', 'Add a valid price before saving this item.')
      return
    }
    if (nextIsLive) {
      if (missingLiveReadinessChecks.length > 0) {
        Alert.alert('Still missing before go live', missingLiveReadinessChecks[0].blockingMessage)
        return
      }
    }

    const submit = async () => {
      setSaving(true)

      try {
        const { data, error } = await invokeFunction<{
          ok: boolean
          itemId?: string
          isLive?: boolean
          stockStatus?: string
          inventoryQuantity?: number
        }>('seller-item-action', {
        body: {
          action: isEditing ? 'update-item' : 'create-item',
          ...(itemId ? { itemId } : {}),
          title: title.trim(),
          category: category || null,
          description: description.trim() || null,
          sizes,
          sizeInventory: nextSizeInventory,
          sizeGuide: nextSizeGuide,
          priceAmount: Math.round(Number(price) * 100),
          currency,
          photoUrls,
          inventoryQuantity: parsedInventoryQuantity,
          pickupAvailable,
          deliveryAvailable,
          shippingAvailable,
          isLive: nextIsLive,
        },
      })

        if (error) {
          const message = isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. We could not save this item yet. Your details are still here, so retry when the signal improves.'
            : await readFunctionErrorMessage(error, 'Could not save this item right now. Please try again in a moment.')
          Alert.alert(nextIsLive ? 'Not live yet' : 'Could not save draft', message)
          return
        }

        const nextFilter =
          data?.stockStatus === 'SOLD_OUT'
            ? 'SOLD'
            : data?.isLive
              ? 'LIVE'
              : 'DRAFTS'

        const moveToNextScreen = () =>
          router.replace({
            pathname: '/(tailor)/shop',
            params: { filter: nextFilter },
          })

        if (!nextIsLive && missingLiveReadinessChecks.length > 0) {
          Alert.alert(
            'Draft saved',
            `This draft saved fine. Before it can go live, you still need:\n${formatMissingChecksForAlert(missingLiveReadinessChecks)}`,
            [{ text: 'Okay', onPress: moveToNextScreen }]
          )
          return
        }

        moveToNextScreen()
      } finally {
        setSaving(false)
      }
    }

    if (nextIsLive) {
      Alert.alert(
        isEditing ? 'Go live with this item?' : 'Publish this item live?',
        'Buyers will be able to discover and pay for this item. Make sure the photos, title, description, sizes, size stock, and delivery choices all look right.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: isEditing ? 'Save and go live' : 'Publish live', onPress: () => void submit() },
        ]
      )
      return
    }

    await submit()
  }

  function confirmDeleteDraft() {
    if (!itemId) return
    Alert.alert(
      'Delete draft?',
      'This draft will be removed. Drafts that already have order history cannot be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete draft',
          style: 'destructive',
          onPress: async () => {
            if (saving) return
            setSaving(true)
            try {
              const { error } = await invokeFunction('seller-item-action', {
                body: { action: 'delete-item', itemId },
              })
              if (error) {
                const message = isLikelyConnectivityIssue(error)
                  ? 'Connection looks weak. We could not delete this draft yet. Retry when the signal improves.'
                  : await readFunctionErrorMessage(error, 'Could not delete this draft right now.')
                Alert.alert('Could not delete draft', message)
                return
              }
              router.replace({
                pathname: '/(tailor)/shop',
                params: { filter: 'DRAFTS' },
              })
            } finally {
              setSaving(false)
            }
          },
        },
      ],
    )
  }

  const readiness = deriveTailorReadiness(sellerStatus)
  const canPublishLive = (sellerStatus?.supportsReadyMade ?? false) && readiness.canPublishPaidItems
  const parsedInventoryQuantity = sumSizeInventory(draftToSizeInventory(sizes, sizeInventoryDraft))
  const draftSizeGuide = draftToReadyMadeSizeGuide({
    sizes,
    unit: fitGuideUnit,
    fields: fitGuideFields,
    draft: fitGuideDraft,
    fitNotes,
    stretchNotes,
    sizeAdvice,
  })
  const hasFitGuide = hasReadyMadeSizeGuide(draftSizeGuide, sizes)
  const liveReadinessChecks = buildLiveReadinessChecks({
    category,
    photoCount: photoUrls.length,
    sizes,
    hasFitGuide,
    description,
    inventoryQuantity: parsedInventoryQuantity,
    hasFulfillment: pickupAvailable || deliveryAvailable || shippingAvailable,
    hasPickupAddress,
    pickupEnabled: pickupAvailable,
  })
  const missingLiveReadinessChecks = liveReadinessChecks.filter((check) => !check.ready)
  const inventoryStateHint = describeInventoryState({
    inventoryQuantity: parsedInventoryQuantity,
    isLive,
    sizes,
  })

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBackButton} onPress={goBack}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit item' : 'Add item'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loadingItem ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.needleGreen} size="large" />
          <Text style={styles.loadingText}>Opening your item…</Text>
        </View>
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Best use</Text>
          <Text style={styles.bestUseText}>
            {isEditing
              ? 'Drafts are editable until you go live. Use this pass to tighten the photos, stock, sizes, and delivery choices.'
              : 'Start simple: one clear title, one clear price, real stock by size, and one clear way the buyer receives it.'}
          </Text>
        </View>

        {sellerStatus ? (
          <View
            style={[
              styles.readinessCard,
              sellerStatus.supportsReadyMade && readiness.canPublishPaidItems
                ? styles.readinessCardSuccess
                : styles.readinessCardWarning,
            ]}
          >
            <Text style={styles.readinessTitle}>
              {sellerStatus.supportsReadyMade
                ? readiness.canPublishPaidItems
                  ? 'Live publishing is available'
                  : readiness.title
                : 'Enable Shop now before publishing live items'}
            </Text>
            <Text style={styles.readinessBody}>
              {sellerStatus.supportsReadyMade
                ? readiness.canPublishPaidItems
                  ? 'You can keep this as a draft or publish it live once the listing looks right.'
                  : readiness.body
                : 'Draft items are fine, but paid ready-made listings should stay hidden until Shop now is enabled on your seller profile.'}
            </Text>
            {!hasPickupAddress ? (
              <Text style={styles.readinessMeta}>
                If you offer pickup, add the exact private pickup address in Profile before you go live.
              </Text>
            ) : pickupAvailable ? (
              <Text style={styles.readinessMeta}>
                Pickup uses the private address saved in Profile. Double-check it before you go live. Buyers only see it after you mark the order ready for collection.
              </Text>
            ) : null}
          </View>
        ) : null}

        {!isLive ? (
          <View
            style={[
              styles.readinessCard,
              missingLiveReadinessChecks.length === 0 ? styles.readinessCardSuccess : styles.readinessCardWarning,
            ]}
          >
            <Text style={styles.readinessTitle}>
              {missingLiveReadinessChecks.length === 0
                ? 'Ready to go live'
                : `${missingLiveReadinessChecks.length} thing${missingLiveReadinessChecks.length === 1 ? '' : 's'} still missing before go live`}
            </Text>
            <View style={styles.checkList}>
              {liveReadinessChecks.map((check) => (
                <View key={check.label} style={styles.checkRow}>
                  <Feather
                    name={check.ready ? 'check-circle' : 'circle'}
                    size={16}
                    color={check.ready ? Colors.needleGreen : Colors.midGrey}
                  />
                  <Text style={[styles.checkText, check.ready && styles.checkTextReady]}>{check.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Field label="Quick start">
          <View style={styles.rowWrap}>
            {ITEM_TEMPLATES.map((template) => (
              <TouchableOpacity key={template.title} style={styles.templateChip} onPress={() => applyTemplate(template)}>
                <Text style={styles.templateChipText}>{template.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Crochet Two-piece Set" placeholderTextColor={Colors.midGrey} />
        </Field>

        <Field label="Category">
          <View style={styles.rowWrap}>
            {ITEM_CATEGORIES.map((value) => (
              <TouchableOpacity
                key={value}
                style={[styles.chip, category === value && styles.chipActive]}
                onPress={() => setCategory((current) => (current === value ? '' : value))}
              >
                <Text style={[styles.chipText, category === value && styles.chipTextActive]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        <Field label="Description">
          <TextInput
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short details that help a buyer understand the piece."
            placeholderTextColor={Colors.midGrey}
            multiline
          />
        </Field>

        <Field label="Photos">
          <View style={styles.photoGrid}>
            {photoUrls.map((url, index) => (
              <View key={url} style={styles.photoThumbWrap}>
                <Image source={{ uri: url }} style={styles.photoThumb} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setPhotoUrls((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Text style={styles.photoRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {photoUrls.length < 6 ? (
              <TouchableOpacity style={styles.photoAdd} onPress={addPhoto} disabled={uploadingPhoto}>
                {uploadingPhoto ? (
                  <ActivityIndicator color={Colors.needleGreen} />
                ) : (
                  <>
                    <Text style={styles.photoAddIcon}>+</Text>
                    <Text style={styles.photoAddText}>Add photo</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.fieldHint}>
            {photoUrls.length > 0
              ? `${photoUrls.length} photo${photoUrls.length === 1 ? '' : 's'} ready. Live items need at least 1.`
              : 'Drafts can save without photos. Add at least 1 photo before you go live.'}
          </Text>
        </Field>

        <Field label="Sizes">
          <View style={styles.rowWrap}>
            {COMMON_SIZES.map((value) => (
              <TouchableOpacity
                key={value}
                style={[styles.chip, sizes.includes(value) && styles.chipActive]}
                onPress={() => toggleSize(value)}
              >
                <Text style={[styles.chipText, sizes.includes(value) && styles.chipTextActive]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.customSizeRow}>
            <TextInput
              style={[styles.input, styles.customSizeInput]}
              value={customSize}
              onChangeText={setCustomSize}
              placeholder="Add another size"
              placeholderTextColor={Colors.midGrey}
              onSubmitEditing={addCustomSize}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.customSizeBtn} onPress={addCustomSize}>
              <Text style={styles.customSizeBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {sizes.length > 0 ? (
            <View style={styles.rowWrap}>
              {sizes.map((value) => (
                <TouchableOpacity key={value} style={styles.selectedSizeChip} onPress={() => toggleSize(value)}>
                  <Text style={styles.selectedSizeText}>{value} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </Field>

        <Field label="Fit guide">
          <View style={styles.fitGuideCard}>
            <Text style={styles.fitGuideTitle}>Help buyers understand what each size means.</Text>
            <Text style={styles.fitGuideBody}>
              Drape can recommend a size from the customer's saved measurements when you set real body ranges here.
            </Text>
            <View style={styles.rowWrap}>
              <TouchableOpacity style={styles.fitGuideAction} onPress={applyRecommendedFitFields}>
                <Text style={styles.fitGuideActionText}>
                  {category ? `Use ${category} defaults` : 'Use recommended fields'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.rowWrap}>
              {(['in', 'cm'] as ReadyMadeFitUnit[]).map((value) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.chip, fitGuideUnit === value && styles.chipActive]}
                  onPress={() => setFitGuideUnit(value)}
                >
                  <Text style={[styles.chipText, fitGuideUnit === value && styles.chipTextActive]}>
                    {value === 'in' ? 'Inches' : 'Centimetres'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.rowWrap}>
              {READY_MADE_FIT_FIELDS.map((field) => (
                <TouchableOpacity
                  key={field.key}
                  style={[styles.chip, fitGuideFields.includes(field.key) && styles.chipActive]}
                  onPress={() => toggleFitField(field.key)}
                >
                  <Text style={[styles.chipText, fitGuideFields.includes(field.key) && styles.chipTextActive]}>
                    {field.shortLabel}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {sizes.length === 0 ? (
              <Text style={styles.fieldHint}>Choose at least one size first, then add size ranges here.</Text>
            ) : fitGuideFields.length === 0 ? (
              <Text style={styles.fieldHint}>Pick the measurement fields that matter for this item. Chest, waist, and hips are a good start for most pieces.</Text>
            ) : (
              <View style={styles.fitGuideSizeList}>
                {sizes.map((size) => (
                  <View key={size} style={styles.fitGuideSizeCard}>
                    <Text style={styles.fitGuideSizeTitle}>{size}</Text>
                    {fitGuideFields.map((field) => (
                      <View key={`${size}-${field}`} style={styles.fitGuideFieldRow}>
                        <Text style={styles.fitGuideFieldLabel}>
                          {READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field}
                        </Text>
                        <View style={styles.fitGuideRangeRow}>
                          <TextInput
                            style={[styles.input, styles.fitGuideInput]}
                            value={fitGuideDraft[size]?.[field]?.min ?? ''}
                            onChangeText={(value) => setFitGuideRange(size, field, 'min', value)}
                            placeholder="Min"
                            placeholderTextColor={Colors.midGrey}
                            keyboardType="decimal-pad"
                          />
                          <TextInput
                            style={[styles.input, styles.fitGuideInput]}
                            value={fitGuideDraft[size]?.[field]?.max ?? ''}
                            onChangeText={(value) => setFitGuideRange(size, field, 'max', value)}
                            placeholder="Max"
                            placeholderTextColor={Colors.midGrey}
                            keyboardType="decimal-pad"
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
            <TextInput
              style={[styles.input, styles.multiline, styles.fitGuideNotesInput]}
              value={fitNotes}
              onChangeText={setFitNotes}
              placeholder="Fit note, e.g. Fitted through the bust with a little ease at the waist."
              placeholderTextColor={Colors.midGrey}
              multiline
            />
            <TextInput
              style={[styles.input, styles.multiline, styles.fitGuideNotesInput]}
              value={stretchNotes}
              onChangeText={setStretchNotes}
              placeholder="Stretch note, e.g. Crochet has some give, but the waistband sits firm."
              placeholderTextColor={Colors.midGrey}
              multiline
            />
            <View style={styles.choiceGroup}>
              {READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  title={option.label}
                  hint={option.hint}
                  active={sizeAdvice === option.value}
                  onPress={() => setSizeAdvice(option.value)}
                />
              ))}
            </View>
            <Text style={styles.fieldHint}>
              {hasFitGuide
                ? 'Fit guide ready. Drape can now suggest a size when the buyer has saved measurements.'
                : 'Drafts can save without a fit guide, but live items require one so buyers know what each size means.'}
            </Text>
          </View>
        </Field>

        <Field label="Price">
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="e.g. 85000" placeholderTextColor={Colors.midGrey} keyboardType="decimal-pad" />
        </Field>

        <Field label="Units by size">
          {sizes.length === 0 ? (
            <View style={styles.stockHelperCard}>
              <Text style={styles.stockHelperText}>Choose at least one size first, then set how many units are ready in each size.</Text>
            </View>
          ) : (
            <View style={styles.sizeStockList}>
              {sizes.map((size) => (
                <View key={size} style={styles.sizeStockRow}>
                  <View style={styles.sizeStockLabelWrap}>
                    <Text style={styles.sizeStockLabel}>{size}</Text>
                  </View>
                  <TextInput
                    style={styles.sizeStockInput}
                    value={sizeInventoryDraft[size] ?? '0'}
                    onChangeText={(value) => setSizeQuantity(size, value)}
                    placeholder="0"
                    placeholderTextColor={Colors.midGrey}
                    keyboardType="number-pad"
                  />
                </View>
              ))}
            </View>
          )}
          <Text style={styles.fieldHint}>{inventoryStateHint}</Text>
          {sizes.length > 0 ? (
            <Text style={styles.fieldHint}>{formatSizeInventorySummary(sizes, draftToSizeInventory(sizes, sizeInventoryDraft))}</Text>
          ) : null}
        </Field>

        <Field label="Currency">
          <View style={styles.rowWrap}>
            {CURRENCIES.map((value) => (
              <TouchableOpacity
                key={value}
                style={[styles.chip, currency === value && styles.chipActive]}
                onPress={() => setCurrency(value)}
              >
                <Text style={[styles.chipText, currency === value && styles.chipTextActive]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        <Field label="Fulfillment">
          <View style={styles.choiceGroup}>
            <ChoiceCard title="Pickup" hint="Customer collects from you or your shop." active={pickupAvailable} onPress={() => setPickupAvailable((value) => !value)} />
            <ChoiceCard title="Delivery" hint="You or your team deliver nearby orders." active={deliveryAvailable} onPress={() => setDeliveryAvailable((value) => !value)} />
            <ChoiceCard title="Shipping" hint="Courier or shipping partner handles it." active={shippingAvailable} onPress={() => setShippingAvailable((value) => !value)} />
          </View>
          <Text style={styles.fieldHint}>
            {pickupAvailable || deliveryAvailable || shippingAvailable
              ? pickupAvailable
                ? 'Buyers will see the options you turned on here. Pickup uses the private address saved in Profile, and buyers only see the exact address after you mark the order ready for collection.'
                : 'Buyers will see the options you turned on here.'
              : 'Drafts can save without fulfillment chosen yet. Pick at least 1 before you go live.'}
          </Text>
        </Field>

      </ScrollView>
      )}

      <View style={styles.footer}>
        <View style={styles.footerButtons}>
          <Button
            label={
              saving
                ? 'Saving…'
                : isEditing
                  ? isRestockIntent
                    ? 'Save stock changes'
                    : 'Save draft changes'
                  : 'Save draft'
            }
            onPress={() => { void saveItem(false) }}
            disabled={saving || loadingItem}
          />
          <Button
            label={
              saving
                ? 'Saving…'
                : isEditing
                  ? isRestockIntent
                    ? 'Save and relist'
                    : 'Review and go live'
                  : 'Review and go live'
            }
            variant="secondary"
            onPress={() => {
              if (!canPublishLive) {
                Alert.alert(
                  'Live publishing unavailable',
                  sellerStatus?.supportsReadyMade
                    ? readiness.body
                    : 'Enable Shop now on your seller profile before publishing items live.',
                )
                return
              }
              void saveItem(true)
            }}
            disabled={saving || loadingItem}
          />
          {isDraftEditor ? (
            <Button
              label="Delete draft"
              variant="ghost"
              onPress={confirmDeleteDraft}
              disabled={saving || loadingItem}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

function ChoiceCard({ title, hint, active, onPress, disabled }: { title: string; hint: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.choiceCard, active && styles.choiceCardActive, disabled && styles.choiceCardDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={[styles.choiceTitle, active && styles.choiceTitleActive]}>{title}</Text>
      <Text style={styles.choiceHint}>{hint}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  loadingText: { fontSize: 14, color: Colors.inkLight },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    backgroundColor: HOME_BG,
  },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FontWeight.semibold, color: CHARCOAL },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: 92 },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  readinessCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 6, ...Shadow.sm },
  readinessCardWarning: { borderWidth: 1, borderColor: Colors.warning + '35' },
  readinessCardSuccess: { borderWidth: 1, borderColor: Colors.success + '30' },
  readinessTitle: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold, lineHeight: 18 },
  readinessBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  readinessMeta: { fontSize: 11, color: MUTED_GREY, lineHeight: 16 },
  checkList: { gap: 6, marginTop: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  checkTextReady: { color: CHARCOAL },
  field: { gap: 6 },
  label: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold },
  fieldHint: { fontSize: 11, color: MUTED_GREY, lineHeight: 16 },
  input: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    color: CHARCOAL,
    fontSize: 14,
    ...Shadow.sm,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoThumbWrap: { width: 84, height: 84, borderRadius: Radius.md, overflow: 'hidden', position: 'relative', backgroundColor: Colors.lightGrey },
  photoThumb: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(17,17,17,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold },
  photoAdd: {
    width: 84,
    height: 84,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoAddIcon: { fontSize: 22, color: MUTED_GREY },
  photoAddText: { fontSize: 11, color: MUTED_GREY },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  templateChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  templateChipText: { color: CHARCOAL, fontSize: 13, fontWeight: FontWeight.medium },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.needleGreenLight, borderColor: PRIMARY_GREEN },
  chipText: { color: Colors.inkLight, fontSize: 13, fontWeight: FontWeight.medium },
  chipTextActive: { color: PRIMARY_GREEN },
  choiceGroup: { gap: 8 },
  choiceCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, borderWidth: 1.5, borderColor: Colors.lightGrey, ...Shadow.sm },
  choiceCardActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  choiceCardDisabled: { opacity: 0.6 },
  choiceTitle: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL },
  choiceTitleActive: { color: PRIMARY_GREEN },
  choiceHint: { fontSize: 11, color: MUTED_GREY, lineHeight: 16 },
  customSizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  customSizeInput: { flex: 1 },
  stockHelperCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: 12,
  },
  stockHelperText: { color: MUTED_GREY, fontSize: 13, lineHeight: 18 },
  sizeStockList: { gap: 8 },
  sizeStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sizeStockLabelWrap: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    minHeight: 44,
    justifyContent: 'center',
  },
  sizeStockLabel: { color: CHARCOAL, fontSize: 13, fontWeight: FontWeight.semibold },
  sizeStockInput: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    color: CHARCOAL,
    fontSize: 14,
  },
  customSizeBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    minHeight: 44,
    justifyContent: 'center',
  },
  customSizeBtnText: { color: CHARCOAL, fontSize: 13, fontWeight: FontWeight.semibold },
  fitGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 8,
    ...Shadow.sm,
  },
  fitGuideTitle: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold },
  fitGuideBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  fitGuideAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center',
  },
  fitGuideActionText: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  fitGuideSizeList: { gap: 8 },
  fitGuideSizeCard: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
  },
  fitGuideSizeTitle: { fontSize: 13, color: CHARCOAL, fontWeight: FontWeight.semibold },
  fitGuideFieldRow: { gap: 4 },
  fitGuideFieldLabel: { fontSize: 11, color: MUTED_GREY, fontWeight: FontWeight.medium },
  fitGuideRangeRow: { flexDirection: 'row', gap: 8 },
  fitGuideInput: { flex: 1, minHeight: 48 },
  fitGuideNotesInput: { minHeight: 72 },
  selectedSizeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  selectedSizeText: { color: PRIMARY_GREEN, fontSize: 11, fontWeight: FontWeight.medium },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 8, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
  footerButtons: { gap: 8 },
})
