import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator, Animated, Modal, PanResponder, Platform, Vibration, useWindowDimensions, KeyboardAvoidingView } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import {
  Button,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  PortfolioVideoPreview,
  RemoteImage,
} from '@/components/ui'
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
import { useDrapeCapsuleNavMotion, useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { Sentry } from '@/lib/sentry'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import {
  isVideoPickerAsset as isReadyMadeVideoAsset,
  pickerVideoContentType as readyMadeVideoContentType,
  pickerVideoExtension as readyMadeVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import {
  ALLOWED_READY_MADE_ITEM_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
  isVideoMediaUrl,
} from '@drape/shared/media-policy'
import { getOnboardingProofItemIssues } from '@drape/shared/onboarding-proof-item'

const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const
const ITEM_CATEGORIES = ['Agbada', 'Kaftan', 'Suit', 'Dress', 'Crochet', 'Ready-made', 'Two-piece Set', 'Native Wear', 'Fila', 'Gele', 'Headwear'] as const
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'] as const
const MAX_ITEM_MEDIA = 6
const MAX_READY_MADE_VIDEO_BYTES = MEDIA_LIMITS_BYTES.readyMadeItemVideo
const MAX_READY_MADE_VIDEO_SECONDS = MEDIA_LIMITS_SECONDS.readyMadeItemVideo
const PRODUCT_PHOTO_ASPECT_RATIO = 4 / 5
type ItemCategory = (typeof ITEM_CATEGORIES)[number]
type CurrencyCode = (typeof CURRENCIES)[number]
type ListingSheetMode =
  | 'media'
  | 'portfolio-videos'
  | 'template'
  | 'category'
  | 'sizes'
  | 'fit-unit'
  | 'fit-fields'
  | 'size-advice'
  | 'currency'
  | 'fulfillment'
  | null

const ITEM_TEMPLATES: Array<{ title: string; category: ItemCategory; sizes: string[] }> = [
  { title: 'Crochet Two-piece Set', category: 'Crochet', sizes: ['S', 'M', 'L'] },
  { title: 'Ready-made Agbada Set', category: 'Agbada', sizes: ['M', 'L', 'XL'] },
  { title: 'Kaftan Set', category: 'Kaftan', sizes: ['M', 'L', 'XL'] },
  { title: 'Two-piece Set', category: 'Two-piece Set', sizes: ['S', 'M', 'L'] },
  { title: 'Ready-made Fila', category: 'Fila', sizes: ['M', 'L', 'XL'] },
  { title: 'Gele Set', category: 'Gele', sizes: ['One size'] },
]

type SupabaseErrorLike = {
  message?: unknown
  details?: unknown
  hint?: unknown
}

type TailorShopDefaultsRow = {
  currency: string | null
  supports_ready_made: boolean | null
  profile_completed: boolean | null
  id_verification_status: string | null
  is_live: boolean | null
  payout_currency: string | null
  payout_provider: 'PAYSTACK' | 'STRIPE' | null
  payout_reverification_required: boolean | null
  payout_account_verified: boolean | null
  payout_account_type: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  portfolio_video_urls: unknown
}

type SellerItemDraftRow = {
  id: string
  title: string | null
  category: string | null
  description: string | null
  sizes: unknown
  size_guide?: Record<string, unknown> | null
  price_amount: number | null
  currency: string | null
  photo_urls: unknown
  stock_status: string | null
  inventory_quantity?: number | null
  size_inventory?: unknown
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  is_live: boolean | null
}

function isMissingInventoryColumnError(error: unknown) {
  const candidate = error as SupabaseErrorLike | null
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''
  const details = typeof candidate?.details === 'string' ? candidate.details.toLowerCase() : ''
  const hint = typeof candidate?.hint === 'string' ? candidate.hint.toLowerCase() : ''
  return [message, details, hint].some((value) =>
    value.includes('inventory_quantity') || value.includes('size_inventory') || value.includes('size_guide'),
  )
}

function fallbackInventoryQuantity(item: { stock_status?: string | null; is_live?: boolean | null }) {
  if (!item.is_live || item.stock_status === 'SOLD_OUT' || item.stock_status === 'HIDDEN') return 0
  if (item.stock_status === 'LOW_STOCK') return 1
  return 1
}

function describeInventoryState(input: { inventoryQuantity: number | null; isLive: boolean; sizes: string[]; isOnboarding?: boolean }) {
  if (input.inventoryQuantity == null || Number.isNaN(input.inventoryQuantity) || input.inventoryQuantity < 0) {
    return 'Choose sizes first, then add how many units are ready in each size.'
  }

  if (input.sizes.length === 0) {
    return 'Choose at least one size first, then add stock by size.'
  }

  if (!input.isLive) {
    if (input.isOnboarding) {
      if (input.inventoryQuantity === 0) {
        return 'Add units to at least one size so this item can count toward setup.'
      }
      return `${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} across your selected sizes will be saved for setup and hidden from buyers for now.`
    }
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
  mediaCount: number
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
      label: input.mediaCount > 0 ? `${input.mediaCount} media item${input.mediaCount === 1 ? '' : 's'} added` : 'At least 1 media item',
      ready: input.mediaCount > 0,
      blockingMessage: 'Before this item can go live, add at least one clear photo or video so buyers can see the piece.',
    },
    {
      label: input.sizes.length > 0 ? `${input.sizes.length} size option${input.sizes.length === 1 ? '' : 's'} added` : 'At least 1 size',
      ready: input.sizes.length > 0,
      blockingMessage: 'Before this item can go live, add at least one size. Use One size if that fits this piece.',
    },
    {
      label: input.hasFitGuide ? 'Fit guide ready' : 'Fit guide required',
      ready: input.hasFitGuide,
      blockingMessage: 'Before this item can go live, add a fit guide so buyers can see what each size means and Drapeon can recommend the right fit.',
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

function parseItemPriceAmount(value: string) {
  const parsed = Number(value)
  if (!value.trim() || Number.isNaN(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

type ItemMediaSource = 'camera-photo' | 'camera-video' | 'library'

type ReadyMadeMediaItem = { type: 'photo' | 'video'; url: string }
type ReadyMadeMediaGridEntry = { item: ReadyMadeMediaItem; originalIndex: number }

function readyMadeMediaItemFromUrl(url: string): ReadyMadeMediaItem {
  return { type: isVideoMediaUrl(url) ? 'video' : 'photo', url }
}

function getReadyMadeMediaDropTargetIndex(fromIndex: number, dx: number, dy: number, itemCount: number) {
  if (itemCount <= 1) return fromIndex
  const columns = 3
  const columnShift = Math.round(dx / 104)
  const rowShift = Math.round(dy / 104) * columns
  return Math.max(0, Math.min(itemCount - 1, fromIndex + columnShift + rowShift))
}

function previewReadyMadeMediaGridEntries(
  items: ReadyMadeMediaItem[],
  dragIndex: number | null,
  hoverIndex: number | null,
): ReadyMadeMediaGridEntry[] {
  const entries = items.map((item, originalIndex) => ({ item, originalIndex }))
  if (
    dragIndex == null ||
    hoverIndex == null ||
    dragIndex < 0 ||
    hoverIndex < 0 ||
    dragIndex >= entries.length ||
    hoverIndex >= entries.length ||
    dragIndex === hoverIndex
  ) {
    return entries
  }

  const next = [...entries]
  const [dragged] = next.splice(dragIndex, 1)
  if (!dragged) return entries
  next.splice(hoverIndex, 0, dragged)
  return next
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
  return []
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function validateReadyMadeVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  return validateVideoPickerAsset(asset, {
    maxBytes: MAX_READY_MADE_VIDEO_BYTES,
    maxSeconds: MAX_READY_MADE_VIDEO_SECONDS,
    maxBytesMessage: `Choose videos under ${Math.round(MAX_READY_MADE_VIDEO_BYTES / (1024 * 1024))} MB.`,
    durationMessage: VIDEO_DURATION_LIMIT_MESSAGE,
  })
}

export default function NewShopItemScreen() {
  const params = useLocalSearchParams<{
    itemId?: string | string[]
    filter?: string | string[]
    intent?: string | string[]
    returnTo?: string | string[]
    historyChain?: string | string[]
    onboarding?: string | string[]
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { compact: actionsCompact } = useDrapeCapsuleNavMotion()
  const actionScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const userId = user?.id ?? null
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
  const [activeFitGuideSize, setActiveFitGuideSize] = useState<string | null>(null)
  const [fitNotes, setFitNotes] = useState('')
  const [stretchNotes, setStretchNotes] = useState('')
  const [sizeAdvice, setSizeAdvice] = useState<ReadyMadeSizeGuideAdvice>('ASK_SELLER')
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [portfolioVideoUrls, setPortfolioVideoUrls] = useState<string[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null)
  const [mediaReplaceIndex, setMediaReplaceIndex] = useState<number | null>(null)
  const [mediaDragIndex, setMediaDragIndex] = useState<number | null>(null)
  const [mediaHoverIndex, setMediaHoverIndex] = useState<number | null>(null)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [sellerStatus, setSellerStatus] = useState<(TailorReadinessInput & { supportsReadyMade?: boolean | null }) | null>(null)
  const [hasPickupAddress, setHasPickupAddress] = useState(false)
  const [listingSheetMode, setListingSheetMode] = useState<ListingSheetMode>(null)
  const rawItemId = firstParam(params.itemId)
  const rawFilter = firstParam(params.filter)
  const rawIntent = firstParam(params.intent)
  const rawHistoryChain = firstParam(params.historyChain)
  const rawReturnTo = firstParam(params.returnTo)
  const itemId = typeof rawItemId === 'string' && rawItemId.length > 0 ? rawItemId : null
  const returnFilter = typeof rawFilter === 'string' && rawFilter.length > 0 ? rawFilter : null
  const isRestockIntent = rawIntent === 'restock'
  const isEditing = !!itemId
  const isDraftEditor = isEditing && returnFilter !== 'SOLD' && !isRestockIntent
  const isOnboardingSetupItem = firstParam(params.onboarding) === 'tailor_setup'
  const anchoredReturnTargetRef = useRef<string | undefined>(undefined)

  if (!anchoredReturnTargetRef.current) {
    anchoredReturnTargetRef.current = pickSafeReturnTo(rawHistoryChain, rawReturnTo)
  }

  function anchoredReturnTarget() {
    return anchoredReturnTargetRef.current ?? pickSafeReturnTo(rawHistoryChain, rawReturnTo)
  }

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      anchoredReturnTarget(),
      {
        pathname: '/(tailor)/shop',
        params: returnFilter ? { filter: returnFilter } : undefined,
      },
    )
  }

  useContextualBackHandler(goBack)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSizeInventoryDraft((current) => {
        const nextDraft: SizeInventoryDraft = {}
        for (const size of sizes) {
          nextDraft[size] = current[size] ?? '0'
        }
        return nextDraft
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [sizes])

  useEffect(() => {
    const timer = setTimeout(() => {
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
    }, 0)
    return () => clearTimeout(timer)
  }, [sizes, fitGuideFields])

  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveFitGuideSize((current) => {
        if (current && sizes.includes(current)) return current
        return sizes[0] ?? null
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [sizes])

  const loadSellerDefaults = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('tailor_profiles')
      .select('currency, supports_ready_made, profile_completed, id_verification_status, is_live, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type, portfolio_video_urls')
      .eq('user_id', userId)
      .maybeSingle()

    const { data: pickupDetails } = await supabase
      .from('tailor_pickup_details')
      .select('pickup_address')
      .eq('user_id', userId)
      .maybeSingle()

    const defaults = data as TailorShopDefaultsRow | null
    setPortfolioVideoUrls(asStringList(defaults?.portfolio_video_urls))
    if (
      defaults?.currency &&
      CURRENCIES.includes(defaults.currency as (typeof CURRENCIES)[number])
    ) {
      setCurrency(defaults.currency as (typeof CURRENCIES)[number])
    }

    setSellerStatus({
      supportsReadyMade: defaults?.supports_ready_made ?? false,
      profileCompleted: defaults?.profile_completed ?? false,
      idVerificationStatus: defaults?.id_verification_status ?? 'NOT_SUBMITTED',
      isLive: defaults?.is_live ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: defaults?.payout_currency ?? null,
      payoutProvider: defaults?.payout_provider ?? null,
      payoutReverificationRequired: defaults?.payout_reverification_required ?? null,
      payoutAccountVerified: defaults?.payout_account_verified ?? null,
      payoutAccountType: defaults?.payout_account_type ?? null,
    })
    setHasPickupAddress(typeof pickupDetails?.pickup_address === 'string' && pickupDetails.pickup_address.trim().length > 0)

    if (itemId && defaults?.supports_ready_made !== undefined) {
      setLoadingItem(true)
      const { data: initialItemData, error: initialItemError } = await supabase
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

      let itemData = initialItemData as SellerItemDraftRow | null
      let itemError = initialItemError

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

        itemData = fallback.data as SellerItemDraftRow | null
        itemError = fallback.error
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
      setMediaUrls(asStringList(itemData.photo_urls))
      const normalizedGuide = normalizeReadyMadeSizeGuide(itemData.size_guide, resolvedSizes)
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
            itemData.size_inventory,
            typeof itemData.inventory_quantity === 'number'
              ? itemData.inventory_quantity
              : fallbackInventoryQuantity(itemData),
          ),
        ),
      )
      setPickupAvailable(itemData.pickup_available ?? false)
      setDeliveryAvailable(itemData.delivery_available ?? false)
      setShippingAvailable(itemData.shipping_available ?? false)
      setIsLive(itemData.is_live ?? false)
      setLoadingItem(false)
    }
  }, [itemId, returnFilter, router, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSellerDefaults()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadSellerDefaults])

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

  function openAddMediaSheet() {
    setMediaReplaceIndex(null)
    const remainingSlots = MAX_ITEM_MEDIA - mediaUrls.length
    if (remainingSlots <= 0) {
      Alert.alert('Media limit reached', `You can add up to ${MAX_ITEM_MEDIA} product media files for one item.`)
      return
    }
    setListingSheetMode('media')
  }

  function openMediaReplacePicker(index: number) {
    if (index < 0 || index >= mediaUrls.length) return
    setSelectedMediaIndex(null)
    setMediaReplaceIndex(index)
    setListingSheetMode('media')
  }

  async function addMedia(source: ItemMediaSource) {
    if (!user?.id || uploadingMedia) return
    const replacingIndex =
      mediaReplaceIndex != null && mediaReplaceIndex >= 0 && mediaReplaceIndex < mediaUrls.length
        ? mediaReplaceIndex
        : null
    const isReplacing = replacingIndex != null
    const remainingSlots = isReplacing ? 1 : MAX_ITEM_MEDIA - mediaUrls.length
    if (remainingSlots <= 0) {
      Alert.alert('Media limit reached', `You can add up to ${MAX_ITEM_MEDIA} product media files for one item.`)
      setMediaReplaceIndex(null)
      return
    }

    const permission =
      source === 'camera-photo' || source === 'camera-video'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera-photo' || source === 'camera-video'
          ? 'Allow camera access to capture item media.'
          : 'Allow photo access to choose item photos or videos.',
      )
      setMediaReplaceIndex(null)
      return
    }

    const result = await launchImagePickerSafely(
      () =>
        source === 'camera-photo'
          ? ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 0.85,
              allowsEditing: true,
              aspect: [4, 5],
            })
          : source === 'camera-video'
            ? ImagePicker.launchCameraAsync({
                mediaTypes: 'videos',
                quality: 0.8,
                videoMaxDuration: MAX_READY_MADE_VIDEO_SECONDS,
              })
            : ImagePicker.launchImageLibraryAsync(
                preferCompatibleVideoRepresentation({
                  mediaTypes: ['images', 'videos'],
                  quality: 0.85,
                  allowsMultipleSelection: !isReplacing && remainingSlots > 1,
                  selectionLimit: remainingSlots,
                  videoMaxDuration: MAX_READY_MADE_VIDEO_SECONDS,
                })
              ),
      {
        context: 'tailor_ready_made_item_media_picker',
        mediaLabel: 'product media file',
        extra: { source, userId: user?.id },
      }
    )
    if (!result) {
      setMediaReplaceIndex(null)
      return
    }

    if (result.canceled || !result.assets[0]) {
      setMediaReplaceIndex(null)
      return
    }
    const selectedAssets = result.assets.slice(0, remainingSlots)
    const invalidVideoMessage = selectedAssets
      .map((asset) => (isReadyMadeVideoAsset(asset) ? validateReadyMadeVideoAsset(asset) : null))
      .find((message): message is string => typeof message === 'string' && message.length > 0)

    if (invalidVideoMessage) {
      Alert.alert('Video not added', invalidVideoMessage)
      setMediaReplaceIndex(null)
      return
    }

    setUploadingMedia(true)
    try {
      const uploadedUrls: string[] = []

      for (const [index, asset] of selectedAssets.entries()) {
        const isVideo = isReadyMadeVideoAsset(asset)
        const contentType = isVideo ? readyMadeVideoContentType(asset) : 'image/jpeg'
        const uploadUri = isVideo
          ? asset.uri
          : await stripExif(asset.uri, {
              maxWidth: 1200,
              cropAspectRatio: PRODUCT_PHOTO_ASPECT_RATIO,
              sourceWidth: asset.width,
              sourceHeight: asset.height,
            })
        const extension = isVideo ? readyMadeVideoExtension(asset) : 'jpg'
        const filename = `shop/${user.id}/${isVideo ? 'videos' : 'photos'}/${Date.now()}-${index}.${extension}`
        const publicUrl = await uploadPublicStorageImage({
          bucket: 'seller-item-media',
          path: filename,
          uri: uploadUri,
          contentType,
          maxBytes: isVideo ? MAX_READY_MADE_VIDEO_BYTES : MEDIA_LIMITS_BYTES.image,
          allowedContentTypes: isVideo ? ALLOWED_VIDEO_CONTENT_TYPES : ALLOWED_READY_MADE_ITEM_CONTENT_TYPES,
          purpose: 'READY_MADE_ITEM',
        })
        uploadedUrls.push(publicUrl)
      }

      setMediaUrls((prev) => {
        if (!isReplacing || replacingIndex == null) return [...prev, ...uploadedUrls].slice(0, MAX_ITEM_MEDIA)
        const replacement = uploadedUrls[0]
        if (!replacement) return prev
        return prev.map((url, index) => (index === replacingIndex ? replacement : url))
      })
      if (isReplacing && replacingIndex != null) setSelectedMediaIndex(replacingIndex)
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          context: 'tailor_shop_media_upload',
          source,
          userId: user.id,
          existingMediaCount: mediaUrls.length,
          selectedCount: selectedAssets.length,
        },
      })
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not upload this media yet. Retry when the signal improves.'
          : 'Could not upload this media right now. Please try again in a moment.',
      )
    } finally {
      setUploadingMedia(false)
      setMediaReplaceIndex(null)
    }
  }

  function attachPortfolioVideo(videoUrl: string) {
    if (mediaUrls.length >= MAX_ITEM_MEDIA) {
      Alert.alert('Media limit reached', `You can add up to ${MAX_ITEM_MEDIA} product media files for one item.`)
      return
    }
    setMediaUrls((current) => {
      if (current.includes(videoUrl)) return current
      return [...current, videoUrl].slice(0, MAX_ITEM_MEDIA)
    })
    setListingSheetMode(null)
  }

  function moveMediaItem(fromIndex: number, toIndex: number) {
    let nextSelectedIndex = toIndex
    setMediaUrls((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        nextSelectedIndex = fromIndex
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      if (!item) return prev
      next.splice(toIndex, 0, item)
      return next
    })
    setSelectedMediaIndex(nextSelectedIndex)
    setMediaDragIndex(null)
    setMediaHoverIndex(null)
  }

  function handleMediaDragMove(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getReadyMadeMediaDropTargetIndex(fromIndex, dx, dy, mediaUrls.length)
    setMediaHoverIndex((current) => current === targetIndex ? current : targetIndex)
  }

  function handleMediaDragEnd(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getReadyMadeMediaDropTargetIndex(fromIndex, dx, dy, mediaUrls.length)
    if (targetIndex !== fromIndex) {
      moveMediaItem(fromIndex, targetIndex)
      return
    }
    setMediaDragIndex(null)
    setMediaHoverIndex(null)
  }

  function removeMediaItem(index: number) {
    setMediaUrls((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    setSelectedMediaIndex(null)
    setMediaDragIndex(null)
    setMediaHoverIndex(null)
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

    const priceAmount = parseItemPriceAmount(price)
    const requestedIsLive = isOnboardingSetupItem ? false : nextIsLive

    if (isOnboardingSetupItem) {
      const proofIssues = getOnboardingProofItemIssues({
        title,
        category,
        description,
        mediaCount: mediaUrls.length,
        sizes,
        inventoryQuantity: parsedInventoryQuantity,
      })
      if (proofIssues.length > 0) {
        Alert.alert('Still missing for setup', proofIssues[0]?.message ?? 'Finish the required setup item details.')
        return
      }
    } else {
      if (!title.trim()) {
        Alert.alert('Missing title', 'Give this item a simple name customers can understand.')
        return
      }
      if (!Number.isInteger(parsedInventoryQuantity) || parsedInventoryQuantity < 0) {
        Alert.alert('Missing stock', 'Add how many units are ready in each size.')
        return
      }
      if (priceAmount == null) {
        Alert.alert('Missing price', 'Add a valid price before saving this item.')
        return
      }
      if (nextIsLive) {
        if (missingLiveReadinessChecks.length > 0) {
          Alert.alert('Still missing before go live', missingLiveReadinessChecks[0].blockingMessage)
          return
        }
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
          sizeGuide: isOnboardingSetupItem ? null : nextSizeGuide,
          priceAmount: isOnboardingSetupItem ? null : priceAmount ?? 0,
          currency,
          photoUrls: mediaUrls,
          inventoryQuantity: parsedInventoryQuantity,
          pickupAvailable: isOnboardingSetupItem ? false : pickupAvailable,
          deliveryAvailable: isOnboardingSetupItem ? false : deliveryAvailable,
          shippingAvailable: isOnboardingSetupItem ? false : shippingAvailable,
          isLive: requestedIsLive,
          onboarding: isOnboardingSetupItem,
        },
      })

        if (error) {
          const message = isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. We could not save this item yet. Your details are still here, so retry when the signal improves.'
            : await readFunctionErrorMessage(error, 'Could not save this item right now. Please try again in a moment.')
          Alert.alert(requestedIsLive ? 'Not live yet' : isOnboardingSetupItem ? 'Could not add item' : 'Could not save draft', message)
          return
        }

        const nextFilter =
          data?.stockStatus === 'SOLD_OUT'
            ? 'SOLD'
            : data?.isLive
              ? 'LIVE'
              : 'DRAFTS'

        const moveToNextScreen = () => {
          const returnTarget = anchoredReturnTarget()
          if (returnTarget) {
            goBackOrReturnTo(
              router,
              navigation,
              returnTarget,
              { pathname: '/(tailor)/shop', params: { filter: nextFilter } },
            )
            return
          }

          router.replace({
            pathname: '/(tailor)/shop',
            params: { filter: nextFilter },
          })
        }

        if (isOnboardingSetupItem) {
          moveToNextScreen()
          return
        }

        if (!requestedIsLive && missingLiveReadinessChecks.length > 0) {
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

    if (requestedIsLive) {
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
    mediaCount: mediaUrls.length,
    sizes,
    hasFitGuide,
    description,
    inventoryQuantity: parsedInventoryQuantity,
    hasFulfillment: pickupAvailable || deliveryAvailable || shippingAvailable,
    hasPickupAddress,
    pickupEnabled: pickupAvailable,
  })
  const onboardingProofReadinessChecks = [
    {
      label: title.trim() && category.trim() && description.trim() ? 'Item details ready' : 'Title, category, and description',
      ready: Boolean(title.trim() && category.trim() && description.trim()),
    },
    {
      label: mediaUrls.length > 0 ? `${mediaUrls.length} media item${mediaUrls.length === 1 ? '' : 's'} added` : 'At least 1 media item',
      ready: mediaUrls.length > 0,
    },
    {
      label: sizes.length > 0 ? `${sizes.length} size option${sizes.length === 1 ? '' : 's'} added` : 'At least 1 size',
      ready: sizes.length > 0,
    },
    {
      label: parsedInventoryQuantity >= 1 ? `${parsedInventoryQuantity} unit${parsedInventoryQuantity === 1 ? '' : 's'} across sizes` : 'At least 1 unit across sizes',
      ready: parsedInventoryQuantity >= 1,
    },
  ]
  const activeReadinessChecks = isOnboardingSetupItem ? onboardingProofReadinessChecks : liveReadinessChecks
  const missingLiveReadinessChecks = liveReadinessChecks.filter((check) => !check.ready)
  const missingReadinessChecks = activeReadinessChecks.filter((check) => !check.ready)
  const visibleReadinessChecks = missingReadinessChecks.length > 0
    ? missingReadinessChecks.slice(0, 3)
    : activeReadinessChecks.filter((check) => check.ready).slice(0, 3)
  const inventoryStateHint = describeInventoryState({
    inventoryQuantity: parsedInventoryQuantity,
    isLive,
    sizes,
    isOnboarding: isOnboardingSetupItem,
  })
  const selectedTemplateLabel = ITEM_TEMPLATES.some((template) => template.title === title && template.category === category)
    ? title
    : title.trim()
      ? 'Custom listing'
      : 'Choose a starter'
  const sizeSummary = sizes.length > 0 ? sizes.join(' · ') : 'Choose sizes'
  const fitUnitLabel = fitGuideUnit === 'in' ? 'Inches' : 'Centimetres'
  const fitFieldsSummary = fitGuideFields.length > 0
    ? READY_MADE_FIT_FIELDS
        .filter((field) => fitGuideFields.includes(field.key))
        .map((field) => field.shortLabel)
        .join(' · ')
    : 'Choose measurements'
  const sizeAdviceLabel =
    READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.find((option) => option.value === sizeAdvice)?.label ?? 'Ask seller'
  const selectedFitGuideSize = activeFitGuideSize && sizes.includes(activeFitGuideSize)
    ? activeFitGuideSize
    : sizes[0] ?? null
  const isHeadwearCategory = ['Fila', 'Gele', 'Headwear'].includes(category)
  const fitGuideBodyCopy = isHeadwearCategory
    ? 'Set head and crown ranges so buyers know how this piece should sit before they order.'
    : "Drapeon can recommend a size from the customer's saved measurements when you set real body ranges here."
  const fitNotePlaceholder = isHeadwearCategory
    ? 'Fit note, e.g. Structured crown with a firm band. Best when head circumference is within range.'
    : 'Fit note, e.g. Fitted through the bust with a little ease at the waist.'
  const stretchNotePlaceholder = isHeadwearCategory
    ? 'Structure note, e.g. No stretch. Choose the larger size if between band ranges.'
    : 'Stretch note, e.g. Crochet has some give, but the waistband sits firm.'
  const fulfillmentLabel = [
    pickupAvailable ? 'Pickup' : null,
    deliveryAvailable ? 'Delivery' : null,
    shippingAvailable ? 'Shipping' : null,
  ].filter(Boolean).join(' · ') || 'Choose options'
  const fulfillmentHint = pickupAvailable || deliveryAvailable || shippingAvailable
    ? shippingAvailable
      ? 'Courier fees can vary. Confirm shipping before checkout.'
      : deliveryAvailable
        ? 'Use delivery for local handoff after confirming the fee.'
        : 'Pickup uses the private address saved in Profile.'
    : isOnboardingSetupItem
      ? 'Pick at least one so this item can count toward setup.'
      : 'Pick at least one before publishing live.'
  const mediaItems = useMemo(() => mediaUrls.map(readyMadeMediaItemFromUrl), [mediaUrls])
  const mediaGridEntries = useMemo(
    () => previewReadyMadeMediaGridEntries(mediaItems, mediaDragIndex, mediaHoverIndex),
    [mediaDragIndex, mediaHoverIndex, mediaItems],
  )
  const selectedMediaItem =
    selectedMediaIndex != null && selectedMediaIndex >= 0 && selectedMediaIndex < mediaItems.length
      ? mediaItems[selectedMediaIndex]
      : null

  const renderMediaField = () => (
    <Field label="Media">
      <View style={styles.photoGrid}>
        {mediaGridEntries.map(({ item, originalIndex }, visualIndex) => (
          <ReadyMadeMediaSortableTile
            key={`${item.url}-${originalIndex}`}
            item={item}
            index={visualIndex}
            isCover={visualIndex === 0}
            dragging={mediaDragIndex === originalIndex}
            onOpen={() => setSelectedMediaIndex(originalIndex)}
            onDelete={() => removeMediaItem(originalIndex)}
            onDragStart={() => {
              setMediaDragIndex(originalIndex)
              setMediaHoverIndex(originalIndex)
            }}
            onDragMove={(dx, dy) => handleMediaDragMove(originalIndex, dx, dy)}
            onDragEnd={(dx, dy) => handleMediaDragEnd(originalIndex, dx, dy)}
          />
        ))}
        {mediaUrls.length < MAX_ITEM_MEDIA ? (
          <TouchableOpacity
            style={[styles.photoAdd, mediaUrls.length === 0 && styles.photoAddEmpty]}
            onPress={openAddMediaSheet}
            disabled={uploadingMedia}
          >
            {uploadingMedia ? (
              <ActivityIndicator color={Colors.needleGreen} />
            ) : (
              <>
                <View style={styles.photoAddIconWrap}>
                  <Feather name="image" size={22} color={PRIMARY_GREEN} />
                </View>
                <Text style={styles.photoAddText}>{mediaUrls.length === 0 ? 'Add media' : 'Add more'}</Text>
                {mediaUrls.length === 0 ? (
                  <Text style={styles.photoAddHint}>Use clear garment-centred photos or videos. Videos must be 30 seconds or less.</Text>
                ) : null}
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      {portfolioVideoUrls.length > 0 && mediaUrls.length < MAX_ITEM_MEDIA ? (
        <TouchableOpacity
          style={styles.portfolioVideoButton}
          onPress={() => setListingSheetMode('portfolio-videos')}
          activeOpacity={0.78}
        >
          <Feather name="video" size={16} color={PRIMARY_GREEN} />
          <Text style={styles.portfolioVideoButtonText}>Choose from Portfolio Videos</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.fieldHint}>
        {mediaUrls.length > 0
          ? isOnboardingSetupItem
            ? `${mediaUrls.length}/${MAX_ITEM_MEDIA} media item${mediaUrls.length === 1 ? '' : 's'} ready for setup.`
            : `${mediaUrls.length}/${MAX_ITEM_MEDIA} media item${mediaUrls.length === 1 ? '' : 's'} ready. Live items need at least 1.`
          : isOnboardingSetupItem
            ? 'Add at least 1 clear photo or video so this item can count toward setup.'
            : 'Drafts can save without media. Add at least 1 clear photo or video before you go live.'}
      </Text>
    </Field>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBackButton} onPress={goBack}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit item' : 'Add item'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {loadingItem ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.needleGreen} size="large" />
          <Text style={styles.loadingText}>Opening your item…</Text>
        </View>
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEnabled={mediaDragIndex === null}
        onScroll={actionScroll.onScroll}
        scrollEventThrottle={actionScroll.scrollEventThrottle}
      >
        {renderMediaField()}

        {!isOnboardingSetupItem && sellerStatus && (!sellerStatus.supportsReadyMade || !readiness.canPublishPaidItems || (pickupAvailable && !hasPickupAddress)) ? (
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
                : 'Draft items are fine, but paid ready-made listings should stay hidden until Shop now is enabled on your tailor profile.'}
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
              styles.readinessCardCompact,
              missingReadinessChecks.length === 0 ? styles.readinessCardSuccess : styles.readinessCardWarning,
            ]}
          >
            <View style={styles.readinessHeaderRow}>
              <Text style={styles.readinessTitle}>
                {isOnboardingSetupItem
                  ? missingReadinessChecks.length === 0
                    ? 'Ready for setup'
                    : 'Setup item checks'
                  : missingReadinessChecks.length === 0
                    ? 'Ready to go live'
                    : 'Go-live checks'}
              </Text>
              <View style={[styles.readinessCountPill, missingReadinessChecks.length === 0 && styles.readinessCountPillReady]}>
                <Text style={[styles.readinessCountText, missingReadinessChecks.length === 0 && styles.readinessCountTextReady]}>
                  {missingReadinessChecks.length === 0
                    ? 'Ready'
                    : `${missingReadinessChecks.length} missing`}
                </Text>
              </View>
            </View>
            <Text style={styles.readinessBody}>
              {isOnboardingSetupItem
                ? missingReadinessChecks.length === 0
                  ? 'This item can count toward setup. It stays hidden from buyers for now.'
                  : 'Finish these so this item can count toward setup. It stays hidden from buyers for now.'
                : missingReadinessChecks.length === 0
                  ? 'This item can be published once the details still look right.'
                  : 'Finish these before publishing. You can save a draft anytime.'}
            </Text>
            <View style={styles.checkList}>
              {visibleReadinessChecks.map((check) => (
                <View key={check.label} style={styles.checkRow}>
                  <Feather
                    name={check.ready ? 'check-circle' : 'circle'}
                    size={16}
                    color={check.ready ? Colors.needleGreen : Colors.midGrey}
                  />
                  <Text style={[styles.checkText, check.ready && styles.checkTextReady]}>{check.label}</Text>
                </View>
              ))}
              {missingReadinessChecks.length > visibleReadinessChecks.length ? (
                <Text style={styles.readinessMeta}>
                  +{missingReadinessChecks.length - visibleReadinessChecks.length} more checked {isOnboardingSetupItem ? 'before this can count toward setup.' : 'before public publishing.'}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {!isOnboardingSetupItem ? (
          <Field label="Quick start">
            <SelectorCard
              title="Listing starter"
              value={selectedTemplateLabel}
              hint="Optional. Starts title, category, and common sizes for this item."
              onPress={() => setListingSheetMode('template')}
            />
          </Field>
        ) : null}

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Crochet Two-piece Set" placeholderTextColor={Colors.midGrey} />
        </Field>

        <Field label="Category">
          <SelectorCard
            title="Category"
            value={category || 'Choose category'}
            hint={isOnboardingSetupItem ? 'Helps reviewers understand the piece.' : 'Helps buyers understand the piece and unlocks fit defaults.'}
            warning={!category}
            onPress={() => setListingSheetMode('category')}
          />
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

        <Field label="Sizes">
          <SelectorCard
            title="Size options"
            value={sizeSummary}
            hint={sizes.length > 0 ? 'Tap to add, remove, or create custom sizes.' : 'Choose at least one size before adding stock.'}
            warning={sizes.length === 0}
            onPress={() => setListingSheetMode('sizes')}
          />
        </Field>

        {!isOnboardingSetupItem ? (
        <Field label="Fit guide">
          <View style={styles.fitGuideCard}>
            <Text style={styles.fitGuideTitle}>Help buyers understand what each size means.</Text>
            <Text style={styles.fitGuideBody}>
              {fitGuideBodyCopy}
            </Text>
            <View style={styles.fitGuideSelectors}>
              <InlineSelectorRow
                title="Unit"
                value={fitUnitLabel}
                hint="Use one unit across every size range."
                onPress={() => setListingSheetMode('fit-unit')}
              />
              <InlineSelectorRow
                title="Measurements"
                value={fitFieldsSummary}
                hint={category ? `Use ${category} defaults or pick fields manually.` : 'Pick the fields that matter for this item.'}
                warning={fitGuideFields.length === 0}
                onPress={() => setListingSheetMode('fit-fields')}
              />
              <InlineSelectorRow
                title="Buyer guidance"
                value={sizeAdviceLabel}
                hint="Tell buyers how to choose when they are between sizes."
                onPress={() => setListingSheetMode('size-advice')}
              />
            </View>
            {sizes.length === 0 ? (
              <Text style={styles.fieldHint}>Choose at least one size first, then add size ranges here.</Text>
            ) : fitGuideFields.length === 0 ? (
              <Text style={styles.fieldHint}>Pick measurement fields in the selector above. Chest, waist, and hips are a good start for most pieces.</Text>
            ) : selectedFitGuideSize ? (
              <View style={styles.fitGuideSizeList}>
                <View style={styles.fitGuideSizeTabRow}>
                  {sizes.map((size) => {
                    const selected = selectedFitGuideSize === size
                    return (
                      <TouchableOpacity
                        key={size}
                        style={[styles.fitGuideSizeTab, selected && styles.fitGuideSizeTabSelected]}
                        onPress={() => setActiveFitGuideSize(size)}
                        activeOpacity={0.78}
                      >
                        <Text style={[styles.fitGuideSizeTabText, selected && styles.fitGuideSizeTabTextSelected]}>{size}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                <View style={styles.fitGuideSizeCard}>
                  <Text style={styles.fitGuideSizeTitle}>Size {selectedFitGuideSize}</Text>
                  <Text style={styles.fitGuideSizeHint}>Enter the buyer measurement range that should fit this size.</Text>
                  {fitGuideFields.map((field) => (
                    <View key={`${selectedFitGuideSize}-${field}`} style={styles.fitGuideFieldRow}>
                      <Text style={styles.fitGuideFieldLabel}>
                        {READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field}
                      </Text>
                      <View style={styles.fitGuideRangeRow}>
                        <TextInput
                          style={[styles.input, styles.fitGuideInput]}
                          value={fitGuideDraft[selectedFitGuideSize]?.[field]?.min ?? ''}
                          onChangeText={(value) => setFitGuideRange(selectedFitGuideSize, field, 'min', value)}
                          placeholder="Min"
                          placeholderTextColor={Colors.midGrey}
                          keyboardType="decimal-pad"
                        />
                        <TextInput
                          style={[styles.input, styles.fitGuideInput]}
                          value={fitGuideDraft[selectedFitGuideSize]?.[field]?.max ?? ''}
                          onChangeText={(value) => setFitGuideRange(selectedFitGuideSize, field, 'max', value)}
                          placeholder="Max"
                          placeholderTextColor={Colors.midGrey}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <TextInput
              style={[styles.input, styles.multiline, styles.fitGuideNotesInput]}
              value={fitNotes}
              onChangeText={setFitNotes}
              placeholder={fitNotePlaceholder}
              placeholderTextColor={Colors.midGrey}
              multiline
            />
            <TextInput
              style={[styles.input, styles.multiline, styles.fitGuideNotesInput]}
              value={stretchNotes}
              onChangeText={setStretchNotes}
              placeholder={stretchNotePlaceholder}
              placeholderTextColor={Colors.midGrey}
              multiline
            />
            <Text style={styles.fieldHint}>
              {hasFitGuide
                ? 'Fit guide ready. Drapeon can now suggest a size when the buyer has saved measurements.'
                : isOnboardingSetupItem
                  ? 'Add a fit guide so this item can count toward setup.'
                  : 'Drafts can save without a fit guide, but live items require one so buyers know what each size means.'}
            </Text>
          </View>
        </Field>
        ) : null}

        {!isOnboardingSetupItem ? (
        <Field label="Price">
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="e.g. 85000" placeholderTextColor={Colors.midGrey} keyboardType="decimal-pad" />
        </Field>
        ) : null}

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

        {!isOnboardingSetupItem ? (
        <Field label="Currency">
          <SelectorCard
            title="Listing currency"
            value={currency}
            hint="Checkout provider is routed from the order currency."
            onPress={() => setListingSheetMode('currency')}
          />
        </Field>
        ) : null}

        {!isOnboardingSetupItem ? (
        <Field label="Fulfillment">
          <SelectorCard
            title="Receiving this item"
            value={fulfillmentLabel}
            hint={fulfillmentHint}
            warning={!(pickupAvailable || deliveryAvailable || shippingAvailable)}
            onPress={() => setListingSheetMode('fulfillment')}
          />
          <Text style={styles.fieldHint}>
            {pickupAvailable || deliveryAvailable || shippingAvailable
              ? pickupAvailable
                ? 'Pickup address stays private until you mark the order ready for collection.'
                : 'Buyers will see the options you turned on here.'
              : isOnboardingSetupItem
                ? 'Pick at least 1 fulfillment option so this item can count toward setup.'
                : 'Drafts can save without fulfillment chosen yet. Pick at least 1 before you go live.'}
          </Text>
        </Field>
        ) : null}

        {isDraftEditor ? (
          <Button
            label="Delete draft"
            variant="ghost"
            onPress={confirmDeleteDraft}
            disabled={saving || loadingItem}
            size="sm"
            fullWidth={false}
            style={styles.inlineDeleteButton}
          />
        ) : null}

      </ScrollView>
      )}

      {selectedMediaItem ? (
        <ReadyMadeMediaManagerModal
          items={mediaItems}
          index={selectedMediaIndex ?? 0}
          onIndexChange={setSelectedMediaIndex}
          onClose={() => setSelectedMediaIndex(null)}
          onReplace={() => {
            if (selectedMediaIndex != null) openMediaReplacePicker(selectedMediaIndex)
          }}
          onDelete={() => {
            if (selectedMediaIndex != null) removeMediaItem(selectedMediaIndex)
          }}
        />
      ) : null}

      <DrapeFloatingActionDock compactWidth={isOnboardingSetupItem ? 76 : 132} testID="shop-item-actions">
        {isOnboardingSetupItem ? (
          actionsCompact ? (
            <DrapeIconButton
              icon="check"
              accessibilityLabel="Add item to setup"
              tone="primary"
              disabled={saving || loadingItem}
              onPress={() => { void saveItem(false) }}
            />
          ) : (
            <DrapeCapsuleButton
              label="Add item to setup"
              icon="check"
              loading={saving}
              disabled={loadingItem}
              style={styles.footerSingleButton}
              onPress={() => { void saveItem(false) }}
            />
          )
        ) : (
          actionsCompact ? (
            <View style={styles.footerCompactButtons}>
              <DrapeIconButton
                icon="save"
                accessibilityLabel={isRestockIntent ? 'Save stock changes' : 'Save draft changes'}
                tone="primary"
                disabled={saving || loadingItem}
                onPress={() => { void saveItem(false) }}
              />
              <DrapeIconButton
                icon="check-circle"
                accessibilityLabel={isRestockIntent ? 'Save and relist' : 'Review and go live'}
                tone="secondary"
                disabled={saving || loadingItem}
                onPress={() => {
                  if (!canPublishLive) {
                    Alert.alert(
                      'Live publishing unavailable',
                      sellerStatus?.supportsReadyMade
                        ? readiness.body
                        : 'Enable Shop now on your tailor profile before publishing items live.',
                    )
                    return
                  }
                  void saveItem(true)
                }}
              />
            </View>
          ) : (
            <View style={styles.footerButtons}>
              <DrapeCapsuleButton
                label={isEditing
                  ? isRestockIntent
                    ? 'Save stock changes'
                    : 'Save draft changes'
                  : 'Save draft'}
                icon="save"
                loading={saving}
                disabled={loadingItem}
                style={styles.footerPrimaryButton}
                onPress={() => { void saveItem(false) }}
              />
              <DrapeCapsuleButton
                label={isEditing && isRestockIntent ? 'Save and relist' : 'Review and go live'}
                icon="check-circle"
                tone="secondary"
                disabled={saving || loadingItem}
                style={styles.footerSecondaryButton}
                onPress={() => {
                  if (!canPublishLive) {
                    Alert.alert(
                      'Live publishing unavailable',
                      sellerStatus?.supportsReadyMade
                        ? readiness.body
                        : 'Enable Shop now on your tailor profile before publishing items live.',
                    )
                    return
                  }
                  void saveItem(true)
                }}
              />
            </View>
          )
        )}
      </DrapeFloatingActionDock>
      </KeyboardAvoidingView>
      <ListingChoiceSheet
        mode={listingSheetMode}
        mediaRemainingSlots={mediaReplaceIndex != null ? 1 : MAX_ITEM_MEDIA - mediaUrls.length}
        portfolioVideoUrls={portfolioVideoUrls}
        attachedMediaUrls={mediaUrls}
        templates={ITEM_TEMPLATES}
        selectedTemplateTitle={selectedTemplateLabel}
        category={category}
        currency={currency}
        pickupAvailable={pickupAvailable}
        deliveryAvailable={deliveryAvailable}
        shippingAvailable={shippingAvailable}
        onClose={() => {
          setListingSheetMode(null)
          setMediaReplaceIndex(null)
        }}
        onMediaSource={(source) => {
          setListingSheetMode(null)
          void addMedia(source)
        }}
        onPortfolioVideo={attachPortfolioVideo}
        onTemplate={(template) => {
          applyTemplate(template)
          setListingSheetMode(null)
        }}
        onCategory={(value) => {
          setCategory((current) => (current === value ? '' : value))
          setListingSheetMode(null)
        }}
        onCurrency={(value) => {
          setCurrency(value)
          setListingSheetMode(null)
        }}
        sizes={sizes}
        customSize={customSize}
        fitGuideUnit={fitGuideUnit}
        fitGuideFields={fitGuideFields}
        sizeAdvice={sizeAdvice}
        onToggleSize={toggleSize}
        onCustomSizeChange={setCustomSize}
        onAddCustomSize={addCustomSize}
        onFitUnit={(value) => {
          setFitGuideUnit(value)
          setListingSheetMode(null)
        }}
        onToggleFitField={toggleFitField}
        onApplyRecommendedFitFields={applyRecommendedFitFields}
        onSizeAdvice={(value) => {
          setSizeAdvice(value)
          setListingSheetMode(null)
        }}
        onToggleFulfillment={(key) => {
          if (key === 'pickup') setPickupAvailable((value) => !value)
          if (key === 'delivery') setDeliveryAvailable((value) => !value)
          if (key === 'shipping') setShippingAvailable((value) => !value)
        }}
      />
    </SafeAreaView>
  )
}

function ReadyMadeMediaSortableTile({
  item,
  index,
  isCover,
  dragging,
  onOpen,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: ReadyMadeMediaItem
  index: number
  isCover: boolean
  dragging: boolean
  onOpen: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragMove: (dx: number, dy: number) => void
  onDragEnd: (dx: number, dy: number) => void
}) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragActiveRef = useRef(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const opacityAnim = useRef(new Animated.Value(1)).current
  const onDragStartRef = useRef(onDragStart)
  const onDragMoveRef = useRef(onDragMove)
  const onDragEndRef = useRef(onDragEnd)
  const onOpenRef = useRef(onOpen)
  onDragStartRef.current = onDragStart
  onDragMoveRef.current = onDragMove
  onDragEndRef.current = onDragEnd
  onOpenRef.current = onOpen

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragActiveRef.current = false
          longPressTimerRef.current = setTimeout(() => {
            dragActiveRef.current = true
            Vibration.vibrate(30)
            onDragStartRef.current()
            Animated.spring(scaleAnim, { toValue: 1.05, useNativeDriver: true, friction: 6, tension: 200 }).start()
            Animated.spring(opacityAnim, { toValue: 0.7, useNativeDriver: true, friction: 6, tension: 200 }).start()
          }, 400)
        },
        onPanResponderMove: (_, gesture) => {
          if (!dragActiveRef.current && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5)) {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
            return
          }
          if (dragActiveRef.current) onDragMoveRef.current(gesture.dx, gesture.dy)
        },
        onPanResponderRelease: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          Animated.spring(opacityAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          if (wasDrag) {
            onDragEndRef.current(gesture.dx, gesture.dy)
          } else {
            onOpenRef.current()
          }
        },
        onPanResponderTerminate: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          Animated.spring(opacityAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          if (wasDrag) onDragEndRef.current(gesture.dx, gesture.dy)
        },
      }),
    [opacityAnim, scaleAnim],
  )

  return (
    <View style={styles.photoThumbWrap}>
      <Animated.View
        style={[
          styles.photoThumbPress,
          dragging && styles.photoThumbDragging,
          { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        ]}
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={`Open product media ${index + 1}`}
      >
        {item.type === 'video' ? (
          <View style={[styles.photoThumb, styles.videoThumb]}>
            <PortfolioVideoPreview uri={item.url} style={styles.photoThumb} autoplay={false} />
            <View style={styles.mediaTypeBadge}>
              <Feather name="play" size={11} color={Colors.textInverse} />
            </View>
          </View>
        ) : (
          <RemoteImage
            uri={item.url}
            bucket="seller-item-media"
            style={styles.photoThumb}
            contentFit="cover"
            transition={180}
            surface="tailor_shop_new_media_preview"
          />
        )}
        {isCover ? (
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeText}>Cover</Text>
          </View>
        ) : null}
        {dragging ? (
          <View style={styles.mediaDragBadge}>
            <Text style={styles.mediaDragBadgeText}>Drop to reorder</Text>
          </View>
        ) : null}
      </Animated.View>
      <TouchableOpacity
        style={styles.photoRemove}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Remove product media"
      >
        <Text style={styles.photoRemoveText}>x</Text>
      </TouchableOpacity>
    </View>
  )
}

function ReadyMadeMediaManagerModal({
  items,
  index,
  onIndexChange,
  onClose,
  onReplace,
  onDelete,
}: {
  items: ReadyMadeMediaItem[]
  index: number
  onIndexChange: (index: number | null) => void
  onClose: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pageWidth = Math.max(280, width - Spacing.lg * 2)
  const activeIndex = Math.max(0, Math.min(index, items.length - 1))
  const activeItem = items[activeIndex] ?? null
  const listRef = useRef<FlatList<ReadyMadeMediaItem> | null>(null)

  useEffect(() => {
    if (!activeItem) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: activeIndex, animated: false })
    })
  }, [activeIndex, activeItem, pageWidth])

  if (!activeItem) return null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mediaManagerOverlay}>
        <TouchableOpacity style={styles.mediaManagerScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.mediaManagerSheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.mediaManagerHeader}>
            <View>
              <Text style={styles.mediaManagerEyebrow}>Product media</Text>
              <Text style={styles.mediaManagerTitle}>
                {activeIndex === 0 ? 'Cover media' : `Media ${activeIndex + 1} of ${items.length}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close media preview">
              <Text style={styles.sheetCloseText}>x</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.mediaManagerPreview, { width: pageWidth }]}>
            <FlatList
              ref={listRef}
              data={items}
              keyExtractor={(item, itemIndex) => `${item.type}-${item.url}-${itemIndex}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={activeIndex}
              getItemLayout={(_, itemIndex) => ({ length: pageWidth, offset: pageWidth * itemIndex, index: itemIndex })}
              onScrollToIndexFailed={() => undefined}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth)
                onIndexChange(Math.max(0, Math.min(items.length - 1, nextIndex)))
              }}
              renderItem={({ item, index: itemIndex }) => (
                <View style={[styles.mediaManagerCarouselPage, { width: pageWidth }]}>
                  {item.type === 'video' ? (
                    <PortfolioVideoPreview
                      uri={item.url}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="contain"
                      nativeControls
                      autoplay={itemIndex === activeIndex}
                    />
                  ) : (
                    <RemoteImage
                      uri={item.url}
                      bucket="seller-item-media"
                      containerStyle={styles.mediaManagerPreviewMedia}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="cover"
                      contentPosition="top"
                      transition={120}
                      surface="tailor_shop_item_media_manager"
                    />
                  )}
                </View>
              )}
            />
          </View>

          <View style={styles.mediaManagerDots}>
            {items.map((item, itemIndex) => (
              <View
                key={`${item.type}-${item.url}-${itemIndex}-dot`}
                style={[styles.mediaManagerDot, itemIndex === activeIndex && styles.mediaManagerDotActive]}
              />
            ))}
          </View>

          <Text style={styles.mediaManagerHint}>Drag thumbnails in the grid to change the cover and order.</Text>

          <View style={styles.mediaManagerActions}>
            <TouchableOpacity style={[styles.mediaManagerAction, styles.mediaManagerActionCompact]} onPress={onReplace} activeOpacity={0.82}>
              <Feather name="refresh-cw" size={16} color={Colors.needleGreen} />
              <Text style={styles.mediaManagerActionText}>Replace</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.mediaManagerAction, styles.mediaManagerActionCompact, styles.mediaManagerActionDestructive]} onPress={onDelete} activeOpacity={0.82}>
              <Feather name="trash-2" size={16} color={Colors.kanteRust} />
              <Text style={[styles.mediaManagerActionText, styles.mediaManagerActionTextDestructive]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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

function SelectorCard({
  title,
  value,
  hint,
  warning,
  onPress,
}: {
  title: string
  value: string
  hint: string
  warning?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.selectorCard, warning && styles.selectorCardWarning]}
      onPress={onPress}
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
    >
      <View style={styles.selectorCopy}>
        <Text style={[styles.selectorMeta, warning && styles.selectorMetaWarning]}>{title}</Text>
        <Text style={styles.selectorValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.selectorHint} numberOfLines={2}>{hint}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

function InlineSelectorRow({
  title,
  value,
  hint,
  warning,
  onPress,
}: {
  title: string
  value: string
  hint: string
  warning?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.inlineSelectorRow, warning && styles.inlineSelectorRowWarning]} onPress={onPress} activeOpacity={0.78}>
      <View style={styles.inlineSelectorCopy}>
        <Text style={[styles.inlineSelectorTitle, warning && styles.inlineSelectorTitleWarning]}>{title}</Text>
        <Text style={styles.inlineSelectorHint}>{hint}</Text>
      </View>
      <View style={styles.inlineSelectorValueWrap}>
        <Text style={styles.inlineSelectorValue} numberOfLines={1}>{value}</Text>
        <Feather name="chevron-right" size={16} color={Colors.midGrey} />
      </View>
    </TouchableOpacity>
  )
}

function ListingChoiceSheet({
  mode,
  mediaRemainingSlots,
  portfolioVideoUrls,
  attachedMediaUrls,
  templates,
  selectedTemplateTitle,
  category,
  currency,
  sizes,
  customSize,
  fitGuideUnit,
  fitGuideFields,
  sizeAdvice,
  pickupAvailable,
  deliveryAvailable,
  shippingAvailable,
  onClose,
  onMediaSource,
  onPortfolioVideo,
  onTemplate,
  onCategory,
  onCurrency,
  onToggleSize,
  onCustomSizeChange,
  onAddCustomSize,
  onFitUnit,
  onToggleFitField,
  onApplyRecommendedFitFields,
  onSizeAdvice,
  onToggleFulfillment,
}: {
  mode: ListingSheetMode
  mediaRemainingSlots: number
  portfolioVideoUrls: string[]
  attachedMediaUrls: string[]
  templates: typeof ITEM_TEMPLATES
  selectedTemplateTitle: string
  category: ItemCategory | ''
  currency: CurrencyCode
  sizes: string[]
  customSize: string
  fitGuideUnit: ReadyMadeFitUnit
  fitGuideFields: ReadyMadeFitFieldKey[]
  sizeAdvice: ReadyMadeSizeGuideAdvice
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  onClose: () => void
  onMediaSource: (source: ItemMediaSource) => void
  onPortfolioVideo: (url: string) => void
  onTemplate: (template: (typeof ITEM_TEMPLATES)[number]) => void
  onCategory: (value: ItemCategory) => void
  onCurrency: (value: CurrencyCode) => void
  onToggleSize: (size: string) => void
  onCustomSizeChange: (value: string) => void
  onAddCustomSize: () => void
  onFitUnit: (value: ReadyMadeFitUnit) => void
  onToggleFitField: (field: ReadyMadeFitFieldKey) => void
  onApplyRecommendedFitFields: () => void
  onSizeAdvice: (value: ReadyMadeSizeGuideAdvice) => void
  onToggleFulfillment: (key: 'pickup' | 'delivery' | 'shipping') => void
}) {
  const insets = useSafeAreaInsets()
  const [showAllFitFields, setShowAllFitFields] = useState(false)
  const sheetBottomPadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom + 52, 76)
      : Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const recommendedFitFieldKeys = recommendedFitFieldsForCategory(category || null)
  const fitFieldOptions =
    showAllFitFields || recommendedFitFieldKeys.length === 0
      ? READY_MADE_FIT_FIELDS
      : READY_MADE_FIT_FIELDS.filter((field) => recommendedFitFieldKeys.includes(field.key) || fitGuideFields.includes(field.key))
  const title =
    mode === 'media'
      ? 'Add product media'
      : mode === 'portfolio-videos'
        ? 'Portfolio videos'
        : mode === 'template'
        ? 'Choose a starter'
        : mode === 'category'
          ? 'Choose category'
          : mode === 'sizes'
            ? 'Choose sizes'
            : mode === 'fit-unit'
              ? 'Choose unit'
              : mode === 'fit-fields'
                ? 'Fit measurements'
                : mode === 'size-advice'
                  ? 'Buyer guidance'
                  : mode === 'currency'
                    ? 'Choose currency'
                    : 'Fulfillment options'

  return (
    <Modal visible={!!mode} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Text style={styles.sheetSubtitle}>
                {mode === 'media'
                  ? mediaRemainingSlots === 1
                    ? 'One media slot left. Add a photo, record a short video, or choose one from your library.'
                    : `${mediaRemainingSlots} media slots left. Photos and videos stay in this item's media list.`
                  : mode === 'portfolio-videos'
                    ? 'Attach an existing portfolio video without uploading it again.'
                  : mode === 'sizes'
                    ? 'Add standard sizes or create one custom size.'
                    : mode === 'fit-fields'
                      ? category
                        ? `Showing ${category} measurements first. Use advanced only if this piece needs more.`
                        : 'Pick only fields that actually affect this piece.'
                      : mode === 'fulfillment'
                        ? 'Choose every way customers can receive this item.'
                        : mode === 'template'
                          ? 'Pick the closest item type. You can edit the details after.'
                          : mode === 'category'
                            ? 'Pick the category customers would naturally browse.'
                            : mode === 'currency'
                              ? 'Choose the currency buyers will see at checkout.'
                              : mode === 'fit-unit'
                                ? 'Use one unit for every size range.'
                                : mode === 'size-advice'
                                  ? 'Tell buyers what to do when they are between sizes.'
                                  : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          {mode === 'media' ? (
            <>
              <SheetOption
                icon="camera"
                title="Take photo"
                body="Best for a front or detail shot on a clean background."
                onPress={() => onMediaSource('camera-photo')}
              />
              <SheetOption
                icon="video"
                title="Record video"
                body="Use a clear 30 second or shorter clip showing movement, texture, or fit."
                onPress={() => onMediaSource('camera-video')}
              />
              <SheetOption
                icon="image"
                title={mediaRemainingSlots > 1 ? 'Choose media' : 'Choose media'}
                body="Choose photos or videos from your library. Videos must be 30 seconds or less."
                onPress={() => onMediaSource('library')}
              />
            </>
          ) : null}

          {mode === 'portfolio-videos' ? (
            <View style={styles.sheetRows}>
              {portfolioVideoUrls.length > 0 ? (
                portfolioVideoUrls.map((url, index) => (
                  <SheetChoiceRow
                    key={url}
                    title={`Portfolio video ${index + 1}`}
                    body={attachedMediaUrls.includes(url) ? 'Already attached to this item.' : 'Attach this video to the item media list.'}
                    selected={attachedMediaUrls.includes(url)}
                    onPress={() => onPortfolioVideo(url)}
                  />
                ))
              ) : (
                <Text style={styles.sheetEmptyText}>No portfolio videos yet.</Text>
              )}
            </View>
          ) : null}

          {mode === 'template' ? (
            <View style={styles.sheetRows}>
              {templates.map((template) => (
                <SheetChoiceRow
                  key={template.title}
                  title={template.title}
                  body={`${template.category} · ${template.sizes.join(', ')}`}
                  selected={selectedTemplateTitle === template.title}
                  onPress={() => onTemplate(template)}
                />
              ))}
            </View>
          ) : null}

          {mode === 'category' ? (
            <View style={styles.sheetRows}>
              {ITEM_CATEGORIES.map((value) => (
                <SheetChoiceRow
                  key={value}
                  title={value}
                  body="Use the category customers would naturally browse."
                  selected={category === value}
                  onPress={() => onCategory(value)}
                />
              ))}
            </View>
          ) : null}

          {mode === 'currency' ? (
            <View style={styles.sheetRows}>
              {CURRENCIES.map((value) => (
                <SheetChoiceRow
                  key={value}
                  title={value}
                  body="Checkout and payouts use this listing currency."
                  selected={currency === value}
                  onPress={() => onCurrency(value)}
                />
              ))}
            </View>
          ) : null}

          {mode === 'sizes' ? (
            <>
              <View style={styles.sheetRows}>
                {COMMON_SIZES.map((value) => (
                  <SheetCheckRow
                    key={value}
                    title={value}
                    body={value === 'One size' ? 'Use for pieces with flexible fit.' : 'Add this size to the listing.'}
                    selected={sizes.includes(value)}
                    onPress={() => onToggleSize(value)}
                  />
                ))}
              </View>
              <View style={styles.sheetCustomRow}>
                <TextInput
                  style={[styles.input, styles.sheetCustomInput]}
                  value={customSize}
                  onChangeText={onCustomSizeChange}
                  placeholder="Custom size"
                  placeholderTextColor={Colors.midGrey}
                  returnKeyType="done"
                  onSubmitEditing={onAddCustomSize}
                />
                <TouchableOpacity style={styles.sheetCustomButton} onPress={onAddCustomSize}>
                  <Text style={styles.sheetCustomButtonText}>Add</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.sheetDoneButton} onPress={onClose}>
                <Text style={styles.sheetDoneButtonText}>Done</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {mode === 'fit-unit' ? (
            <View style={styles.sheetRows}>
              {(['in', 'cm'] as ReadyMadeFitUnit[]).map((value) => (
                <SheetChoiceRow
                  key={value}
                  title={value === 'in' ? 'Inches' : 'Centimetres'}
                  body={value === 'in' ? 'Best for UK/US sizing conversations.' : 'Best for most international size charts.'}
                  selected={fitGuideUnit === value}
                  onPress={() => onFitUnit(value)}
                />
              ))}
            </View>
          ) : null}

          {mode === 'fit-fields' ? (
            <>
              <TouchableOpacity style={styles.sheetSoftAction} onPress={onApplyRecommendedFitFields}>
                <Feather name="sliders" size={16} color={PRIMARY_GREEN} />
                <Text style={styles.sheetSoftActionText}>
                  {category ? `Use ${category} defaults` : 'Use recommended fields'}
                </Text>
              </TouchableOpacity>
              <View style={styles.sheetRows}>
                {fitFieldOptions.map((field) => (
                  <SheetCheckRow
                    key={field.key}
                    title={field.label}
                    body="Customers compare this measurement against the item fit guide."
                    selected={fitGuideFields.includes(field.key)}
                    onPress={() => onToggleFitField(field.key)}
                  />
                ))}
              </View>
              {recommendedFitFieldKeys.length > 0 ? (
                <TouchableOpacity style={styles.sheetSubtleAction} onPress={() => setShowAllFitFields((value) => !value)}>
                  <Text style={styles.sheetSubtleActionText}>
                    {showAllFitFields ? 'Show recommended only' : 'Show advanced measurements'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.sheetDoneButton} onPress={onClose}>
                <Text style={styles.sheetDoneButtonText}>Done</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {mode === 'size-advice' ? (
            <View style={styles.sheetRows}>
              {READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.map((option) => (
                <SheetChoiceRow
                  key={option.value}
                  title={option.label}
                  body={option.hint}
                  selected={sizeAdvice === option.value}
                  onPress={() => onSizeAdvice(option.value)}
                />
              ))}
            </View>
          ) : null}

          {mode === 'fulfillment' ? (
            <>
              <SheetCheckRow
                title="Pickup"
                body="Customer collects from you or your shop."
                selected={pickupAvailable}
                onPress={() => onToggleFulfillment('pickup')}
              />
              <SheetCheckRow
                title="Delivery"
                body="Local handoff by you or your team. Confirm the fee before checkout."
                selected={deliveryAvailable}
                onPress={() => onToggleFulfillment('delivery')}
              />
              <SheetCheckRow
                title="Shipping"
                body="Courier shipping for farther orders. Final fees can change by weight and destination."
                selected={shippingAvailable}
                onPress={() => onToggleFulfillment('shipping')}
              />
              <TouchableOpacity style={styles.sheetDoneButton} onPress={onClose}>
                <Text style={styles.sheetDoneButtonText}>Done</Text>
              </TouchableOpacity>
            </>
          ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function SheetOption({
  icon,
  title,
  body,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  body: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={styles.sheetOption} onPress={onPress} activeOpacity={0.78}>
      <View style={styles.sheetOptionIcon}>
        <Feather name={icon} size={18} color={Colors.needleGreen} />
      </View>
      <View style={styles.sheetOptionText}>
        <Text style={styles.sheetOptionTitle}>{title}</Text>
        <Text style={styles.sheetOptionBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

function SheetChoiceRow({
  title,
  body,
  selected,
  onPress,
}: {
  title: string
  body: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.sheetChoiceRow, selected && styles.sheetChoiceRowSelected]} onPress={onPress}>
      <View style={styles.sheetChoiceText}>
        <Text style={styles.sheetChoiceTitle}>{title}</Text>
        <Text style={styles.sheetChoiceBody}>{body}</Text>
      </View>
      {selected ? <Feather name="check-circle" size={18} color={Colors.needleGreen} /> : null}
    </TouchableOpacity>
  )
}

function SheetCheckRow({
  title,
  body,
  selected,
  onPress,
}: {
  title: string
  body: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.sheetChoiceRow, selected && styles.sheetChoiceRowSelected]} onPress={onPress}>
      <View style={[styles.sheetCheck, selected && styles.sheetCheckSelected]}>
        {selected ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
      </View>
      <View style={styles.sheetChoiceText}>
        <Text style={styles.sheetChoiceTitle}>{title}</Text>
        <Text style={styles.sheetChoiceBody}>{body}</Text>
      </View>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 19, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: Fonts.display },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.sm, paddingBottom: 150 },
  readinessCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 6, ...Shadow.sm },
  readinessCardCompact: { gap: 8 },
  readinessCardWarning: { borderWidth: 1, borderColor: Colors.warning + '35' },
  readinessCardSuccess: { borderWidth: 1, borderColor: Colors.success + '30' },
  readinessHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  readinessCountPill: {
    borderRadius: Radius.full,
    backgroundColor: Colors.warning + '18',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readinessCountPillReady: { backgroundColor: Colors.needleGreenLight },
  readinessCountText: { fontSize: 11, color: Colors.warning, fontWeight: FontWeight.semibold },
  readinessCountTextReady: { color: PRIMARY_GREEN },
  readinessTitle: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold, lineHeight: 18, fontFamily: Fonts.display },
  readinessBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  readinessMeta: { fontSize: 11, color: MUTED_GREY, lineHeight: 16 },
  checkList: { gap: 6, marginTop: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  checkTextReady: { color: CHARCOAL },
  field: { gap: 6 },
  label: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold, fontFamily: Fonts.display },
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
  photoThumbWrap: { width: 92, height: 92, borderRadius: Radius.md, overflow: 'hidden', position: 'relative', backgroundColor: Colors.lightGrey },
  photoThumbPress: { width: '100%', height: '100%', overflow: 'hidden', borderRadius: Radius.md },
  photoThumbDragging: { borderWidth: 2, borderColor: PRIMARY_GREEN, opacity: 0.78 },
  photoThumb: { width: '100%', height: '100%' },
  videoThumb: { backgroundColor: Colors.ink },
  coverBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    borderRadius: Radius.full,
    backgroundColor: PRIMARY_GREEN,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  coverBadgeText: { fontSize: 9, color: Colors.textInverse, fontWeight: FontWeight.bold, textTransform: 'uppercase' },
  mediaDragBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(17,17,17,0.72)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
  },
  mediaDragBadgeText: { color: Colors.textInverse, fontSize: 9, fontWeight: FontWeight.semibold },
  mediaTypeBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(17,17,17,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  photoRemoveText: { color: Colors.textInverse, fontSize: 11, fontWeight: FontWeight.bold },
  photoAdd: {
    width: 92,
    height: 92,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  photoAddEmpty: {
    width: '100%',
    minHeight: 172,
    backgroundColor: Colors.needleGreenLight,
    borderColor: PRIMARY_GREEN + '55',
    padding: Spacing.lg,
    gap: 8,
  },
  photoAddIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddText: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textAlign: 'center' },
  photoAddHint: { fontSize: 12, color: Colors.inkLight, lineHeight: 18, textAlign: 'center' },
  portfolioVideoButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: PRIMARY_GREEN + '55',
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  portfolioVideoButtonText: { fontSize: FontSize.sm, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  mediaManagerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17,17,17,0.48)',
  },
  mediaManagerScrim: { ...StyleSheet.absoluteFillObject },
  mediaManagerSheet: {
    backgroundColor: HOME_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    maxHeight: '88%',
  },
  mediaManagerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  mediaManagerEyebrow: { fontSize: 11, color: MUTED_GREY, fontWeight: FontWeight.bold, textTransform: 'uppercase' },
  mediaManagerTitle: { marginTop: 2, fontSize: 18, color: CHARCOAL, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  mediaManagerPreview: {
    alignSelf: 'center',
    aspectRatio: 4 / 5,
    maxHeight: 430,
    overflow: 'hidden',
    borderRadius: Radius.lg,
    backgroundColor: Colors.boneDeep,
  },
  mediaManagerPreviewMedia: { width: '100%', height: '100%' },
  mediaManagerCarouselPage: { height: '100%' },
  mediaManagerDots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  mediaManagerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.lightGrey },
  mediaManagerDotActive: { width: 18, backgroundColor: PRIMARY_GREEN },
  mediaManagerHint: { fontSize: 12, color: MUTED_GREY, lineHeight: 17, textAlign: 'center' },
  mediaManagerActions: { flexDirection: 'row', gap: Spacing.sm },
  mediaManagerAction: {
    minHeight: 44,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: PRIMARY_GREEN + '30',
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaManagerActionCompact: { flex: 1 },
  mediaManagerActionDestructive: { borderColor: Colors.kanteRust + '28' },
  mediaManagerActionText: { color: PRIMARY_GREEN, fontSize: 13, fontWeight: FontWeight.semibold },
  mediaManagerActionTextDestructive: { color: Colors.kanteRust },
  selectorCard: {
    minHeight: 76,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  selectorCardWarning: {
    borderColor: Colors.warning + '35',
    backgroundColor: Colors.white,
  },
  selectorCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  selectorMeta: {
    fontSize: FontSize.xs,
    color: MUTED_GREY,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  selectorMetaWarning: {
    color: Colors.warning,
  },
  selectorValue: {
    fontSize: FontSize.md,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
  },
  selectorHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  inlineSelectorRow: {
    minHeight: 68,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  inlineSelectorRowWarning: {
    borderColor: Colors.warning + '35',
    backgroundColor: Colors.white,
  },
  inlineSelectorCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  inlineSelectorTitle: {
    fontSize: FontSize.sm,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
  },
  inlineSelectorTitleWarning: {
    color: Colors.warning,
  },
  inlineSelectorHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  inlineSelectorValueWrap: {
    maxWidth: 148,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineSelectorValue: {
    flexShrink: 1,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
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
  fitGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 8,
    ...Shadow.sm,
  },
  fitGuideTitle: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold, fontFamily: Fonts.display },
  fitGuideBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  fitGuideSelectors: {
    gap: Spacing.sm,
  },
  fitGuideSizeList: { gap: 8 },
  fitGuideSizeTabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  fitGuideSizeTab: {
    minHeight: 40,
    minWidth: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitGuideSizeTabSelected: {
    borderColor: PRIMARY_GREEN,
    backgroundColor: Colors.needleGreenLight,
  },
  fitGuideSizeTabText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
  },
  fitGuideSizeTabTextSelected: {
    color: PRIMARY_GREEN,
  },
  fitGuideSizeCard: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
  },
  fitGuideSizeTitle: { fontSize: 13, color: CHARCOAL, fontWeight: FontWeight.semibold },
  fitGuideSizeHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 17 },
  fitGuideFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fitGuideFieldLabel: {
    width: 112,
    fontSize: 11,
    color: MUTED_GREY,
    fontWeight: FontWeight.medium,
    lineHeight: 15,
  },
  fitGuideRangeRow: { flex: 1, flexDirection: 'row', gap: 8 },
  fitGuideInput: { flex: 1, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8 },
  fitGuideNotesInput: { minHeight: 72 },
  footerButtons: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerCompactButtons: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  footerSingleButton: { flex: 1 },
  footerPrimaryButton: {
    flexBasis: 0,
    flexGrow: 1.05,
    flexShrink: 1,
  },
  footerSecondaryButton: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
  inlineDeleteButton: { alignSelf: 'center', marginTop: Spacing.md },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.ink + '66',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    maxHeight: '86%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    marginBottom: Spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  sheetTitleWrap: {
    flex: 1,
    gap: 4,
  },
  sheetTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 24,
  },
  sheetSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  sheetCloseText: { color: Colors.ink, fontSize: 16, fontWeight: FontWeight.bold },
  sheetBody: {
    flexGrow: 0,
  },
  sheetBodyContent: {
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  sheetRows: {
    gap: Spacing.sm,
  },
  sheetEmptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 70,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
  },
  sheetOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  sheetOptionText: {
    flex: 1,
    gap: 2,
  },
  sheetOptionTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  sheetOptionBody: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  sheetChoiceRow: {
    minHeight: 62,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sheetChoiceRowSelected: {
    borderColor: PRIMARY_GREEN,
    backgroundColor: Colors.needleGreenLight,
  },
  sheetChoiceText: {
    flex: 1,
    gap: 2,
  },
  sheetChoiceTitle: {
    fontSize: FontSize.sm,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
  },
  sheetChoiceBody: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  sheetCheck: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  sheetCheckSelected: {
    borderColor: PRIMARY_GREEN,
    backgroundColor: PRIMARY_GREEN,
  },
  sheetCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sheetCustomInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  sheetCustomButton: {
    minHeight: 46,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCustomButtonText: {
    color: PRIMARY_GREEN,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  sheetSoftAction: {
    minHeight: 46,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  sheetSoftActionText: {
    color: PRIMARY_GREEN,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  sheetSubtleAction: {
    minHeight: 42,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  sheetSubtleActionText: {
    color: Colors.ink,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  sheetDoneButton: {
    minHeight: 48,
    borderRadius: Radius.full,
    backgroundColor: PRIMARY_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  sheetDoneButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
})
