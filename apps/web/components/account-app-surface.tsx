'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Archive,
  ArchiveRestore,
  Banknote,
  BellRing,
  Briefcase,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ClipboardList,
  Heart,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Mic,
  MessageCircle,
  MessageSquareText,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Phone,
  Reply,
  Ruler,
  ScanLine,
  Search,
  Send,
  Share2,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Square,
  Star,
  Trash2,
  UserRound,
  Users,
  Video,
  Volume2,
  VolumeX,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Session, RealtimeChannel } from '@supabase/supabase-js'
import {
  CONTACTS,
  CORE_MEASUREMENT_FIELDS,
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  SUPPORTED_ACCOUNT_CURRENCIES,
  MEASUREMENT_FIELD_KEYS,
  buildMeasurementProfileStoragePayload,
  customOrderDefaultDeadline,
  customOrderMinimumDeliveryDate,
  deriveCancellationPolicy,
  currencySymbol,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  isMeasurementFieldKey,
  isTransientMeasurementMetadataKey,
  measurementCoreCompleteness,
  mergeMeasurementRecords,
  normalizeAccountCurrency,
  normalizePhoneForStorage,
  payoutBlockReasonMessage,
  promoteSpecialistMeasurementsToProfileValues,
  readMeasurementValue,
  specialistMeasurementProfileValueKeys,
  stripDrapeVisionFit360DraftFields,
  TAILOR_SETUP_VALIDATION,
  buildWhatsAppSupportUrl,
  getOnboardingProofItemIssues,
  getCustomOrderFabricIssues,
  buildBriefDossier,
  FABRIC_SUBSTITUTION_OPTIONS,
  BULK_FABRIC_MODE_OPTIONS,
  formatDatabaseEnumLabel,
  validatePhoneForProfile,
  validatePasswordStrength,
} from '@drape/shared'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import {
  CALL_SCHEDULING_POLICY,
  callSchedulingReasonFor,
  formatCallCountdown,
  getCallLifecycleState,
  isCallSchedulingStartValid,
} from '@drape/shared/call-scheduling-policy'
import {
  ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES,
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_REVIEW_MEDIA_CONTENT_TYPES,
  ALLOWED_READY_MADE_ITEM_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  VIDEO_DURATION_LIMIT_MESSAGE,
  isVideoMediaUrl,
  videoPosterFrameUrl,
} from '@drape/shared/media-policy'
import { canTransition, type OrderStage } from '@drape/shared/order-machine'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import { createClient } from '../lib/supabase'
import { safeEntityName, safeUserText } from '../lib/safe-display'
import { signOutWebSession } from '../lib/web-auth-session'
import { registerWebPushSubscription } from '../lib/web-push-client'
import { useSessionTimeout } from '../hooks/use-session-timeout'
import { AccountContextProvider, useAccountContext, type AccountContextValue } from './account-context'
import { OpenAppButton } from './open-app-button'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'
import { Field } from './ui/field'
import { IconButton } from './ui/icon-button'
import { Input } from './ui/input'
import { MediaViewerDialog } from './ui/media-viewer-dialog'
import { MetricCard } from './ui/metric-card'
import { NativeSelect } from './ui/native-select'
import { SegmentedControl } from './ui/segmented-control'
import { StatusChip } from './ui/status-chip'
import { Surface, SurfaceHeader } from './ui/surface'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

type StripeCardElement = {
  mount: (element: HTMLElement) => void
  unmount: () => void
  destroy?: () => void
}

type StripeElements = {
  create: (type: 'card', options?: Record<string, unknown>) => StripeCardElement
}

type StripePaymentIntent = {
  id?: string
  status?: string
}

type StripeJs = {
  elements: (options?: Record<string, unknown>) => StripeElements
  confirmCardPayment: (
    clientSecret: string,
    options: { payment_method: { card: StripeCardElement } },
  ) => Promise<{ error?: { message?: string }; paymentIntent?: StripePaymentIntent }>
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs | null
  }
}

type AccountSurface =
  | 'explore'
  | 'orders'
  | 'order-detail'
  | 'messages'
  | 'measurements'
  | 'brief'
  | 'shop'
  | 'work'
  | 'earnings'
  | 'payout'
  | 'profile'
  | 'checkout'
  | 'saved'
  | 'settings'
  | 'support'
  | 'tailor-detail'
  | 'item-detail'

const ORDER_REALTIME_SURFACES = new Set<AccountSurface>(['orders', 'order-detail', 'work', 'checkout'])
const ORDER_REALTIME_ROW_EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const
const ORDER_REALTIME_CHILD_TABLES = [
  'custom_order_details',
  'messages',
  'order_material_advances',
  'order_payments',
  'order_production_evidence',
  'order_stage_updates',
  'reviews',
] as const

const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'
const PROFILE_IMAGE_REJECTION_MESSAGE =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'

function isRealtimeFilterValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(value)
}

function uniqueRealtimeOrderIds(values: Array<string | null | undefined>) {
  const ids = new Set<string>()
  for (const value of values) {
    if (isRealtimeFilterValue(value)) ids.add(value)
  }
  return [...ids].slice(0, 60)
}

type JoinedProfile = {
  id?: string | null
  display_name?: string | null
  business_name?: string | null
  avatar_url?: string | null
  location?: string | null
  availability?: string | null
  accepts_custom_orders_now?: boolean | null
  shop_paused?: boolean | null
  is_live?: boolean | null
}

type AccountOrder = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  item_size: string | null
  garment_description: string | null
  occasion: string | null
  stage: string | null
  delivery_method: string | null
  delivery_address?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  fabric_source: string | null
  special_note: string | null
  fabric_tracking: string | null
  tracking_number?: string | null
  carrier?: string | null
  fulfillment_provider?: string | null
  fulfillment_reference?: string | null
  fulfillment_contact_name?: string | null
  fulfillment_contact_phone?: string | null
  reference_photos?: string[] | null
  customer_measurements_snapshot?: Record<string, unknown> | null
  quoted_amount: number | null
  subtotal_amount: number | null
  fulfillment_fee: number | null
  shipping_amount: number | null
  tax_amount: number | null
  platform_fee_amount: number | null
  total_amount: number | null
  currency: string | null
  quoted_currency: string | null
  created_at: string | null
  updated_at: string | null
  deadline: string | null
  quoted_completion_date: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  seller_item_id: string | null
  payment_provider: string | null
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_provider?: string | null
  fulfillment_payment_intent_id?: string | null
  fulfillment_payment_checkout_url?: string | null
  consultation_fee?: number | null
  video_call_url?: string | null
  escrow_released: boolean | null
  auto_release_at: string | null
  collection_code: string | null
  collection_code_expiry: string | null
  collection_code_used: boolean | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
  customer_profiles?: JoinedProfile | JoinedProfile[] | null
}

type AccountPayment = {
  id: string
  order_id: string
  phase: string | null
  provider: string | null
  currency: string | null
  amount: number | null
  status: string | null
  confirmed_at: string | null
  created_at: string | null
  refunded_at: string | null
}

type AccountMessage = {
  id: string
  order_id: string
  sender_id: string | null
  sender_role?: string | null
  sender_name?: string | null
  type: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
  read_at: string | null
  created_at: string | null
  is_deleted?: boolean | null
  edited_at?: string | null
  reply_to_id?: string | null
}

type AccountMessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

type StageUpdate = {
  id: string
  order_id: string
  stage: string | null
  note: string | null
  photo_url: string | null
  created_at: string | null
}

type ProductionEvidence = {
  id: string
  order_id: string
  stage_key: string | null
  note: string | null
  photo_urls: string[] | null
  created_at: string | null
}

type CustomerProfile = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  updated_at: string | null
}

type TailorProfile = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialty_tags: string[] | null
  price_range_min: number | null
  price_range_max: number | null
  currency: string | null
  tier: string | null
  availability: string | null
  accepts_custom_orders_now?: boolean | null
  shop_paused?: boolean | null
  seller_type?: string | null
  is_live: boolean | null
  is_verified: boolean | null
  avg_rating: number | null
  total_reviews: number | null
  total_orders: number | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  portfolio_photo_urls: string[] | null
  portfolio_video_urls: string[] | null
  avatar_url: string | null
  profile_completed?: boolean | null
  id_verification_status?: string | null
  id_selfie_document_url?: string | null
  id_verification_submitted_at?: string | null
  id_verification_rejection_reason?: string | null
  id_verification_rejected_at?: string | null
  id_verification_metadata?: Record<string, unknown> | null
  payout_currency?: string | null
  payout_provider?: string | null
  payout_reverification_required?: boolean | null
  payout_account_type?: string | null
  payout_account_verified?: boolean | null
  payout_account_verified_at?: string | null
  payout_bank_name?: string | null
  payout_account_name?: string | null
  payout_account_masked?: string | null
  payout_country_code?: string | null
  manual_bank_entry?: boolean | null
  manual_bank_name?: string | null
  manual_bank_country_code?: string | null
  manual_bank_country_name?: string | null
  manual_bank_swift_bic?: string | null
  manual_bank_account_name?: string | null
  manual_bank_verification_status?: string | null
  manual_bank_submitted_at?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  paystack_account_id?: string | null
  stripe_account_id?: string | null
  payout_account_change_count?: number | null
  payout_account_last_changed_at?: string | null
  payout_account_change_locked_until?: string | null
  payout_destination_hold_until?: string | null
}

type TailorPickupDetails = {
  user_id: string
  pickup_address: string | null
  pickup_instructions: string | null
  updated_at: string | null
}

type MeasurementProfile = {
  id: string
  label: string | null
  relationship: string | null
  source: string | null
  unit_preference: string | null
  measurements?: Record<string, unknown> | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}

type MeasurementScan = {
  id: string
  capture_method: string | null
  status: string | null
  confidence_overall: string | null
  created_at: string | null
}

type SellerItem = {
  id: string
  tailor_profile_id: string | null
  title: string | null
  description: string | null
  category: string | null
  sizes: string[] | null
  size_inventory?: Record<string, number> | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
  stock_status: string | null
  inventory_quantity?: number | null
  size_guide?: Record<string, unknown> | null
  is_live: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  updated_at: string | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
}

type ReadyMadeFitUnit = 'in' | 'cm'
type ReadyMadeFitAdvice = 'SIZE_UP_IF_BETWEEN' | 'SIZE_DOWN_IF_BETWEEN' | 'ASK_SELLER'
type ReadyMadeFitFieldKey =
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulderWidth'
  | 'inseam'
  | 'sleeveLength'
  | 'neckCircumference'
  | 'underBust'
  | 'height'
  | 'backLength'
  | 'outseam'
  | 'thighCircumference'
  | 'kneeCircumference'
  | 'bicepCircumference'
  | 'wristCircumference'
  | 'headCircumference'
  | 'hatBandLine'
  | 'headLength'
  | 'headWidth'
  | 'earToEarOverCrown'
  | 'frontToBackOverCrown'
  | 'filaHeight'
  | 'torsoLength'

type ReadyMadeFitRange = {
  min: number | null
  max: number | null
}

type ReadyMadeSizeGuide = {
  version: 1
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  sizeRanges: Record<string, Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>>>
  fitNotes: string | null
  stretchNotes: string | null
  sizeAdvice: ReadyMadeFitAdvice | null
}

type ReadyMadeSizeGuideDraft = Record<
  string,
  Partial<Record<ReadyMadeFitFieldKey, { min: string; max: string }>>
>

type ReadyMadeCheckoutPricingPreview = {
  currency: string
  displayCurrency?: string | null
  sourceCurrency?: string | null
  sourceSubtotal?: number | null
  fxRate?: number | null
  fxRateTimestamp?: string | null
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  taxLabel: string | null
}

type WishlistCollection = {
  id: string
  name: string | null
  cover_image_url: string | null
  item_count: number | null
  created_at: string | null
  updated_at: string | null
}

type WishlistItem = {
  id: string
  collection_id: string
  item_type: 'TAILOR' | 'READY_MADE_ITEM' | string
  tailor_id: string | null
  ready_made_item_id: string | null
  note: string | null
  created_at: string | null
}

type TailorReview = {
  id: string
  tailor_profile_id: string | null
  rating: number | null
  body: string | null
  tags: string[] | null
  media_urls: string[] | null
  reviewer_name: string | null
  tailor_response?: string | null
  created_at: string | null
  published_at: string | null
}

type AccountReview = {
  id: string
  order_id: string | null
  rating: number | null
  created_at: string | null
}

type PortfolioItem = {
  id: string
  image_url: string | null
  title: string | null
  description: string | null
  category: string | null
  sort_order: number | null
  created_at: string | null
}

type MaterialAdvance = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  requested_by: string | null
  title: string | null
  description: string | null
  amount: number | null
  currency: string | null
  status: string | null
  release_status: string | null
  estimate_photo_url?: string | null
  receipt_url?: string | null
  receipt_note?: string | null
  customer_response_note?: string | null
  payment_provider?: string | null
  provider_checkout_url?: string | null
  payment_id?: string | null
  created_at: string | null
  updated_at: string | null
}

type CustomOrderDetail = {
  order_id: string
  garment_type_other?: string | null
  gender_presentation?: string | null
  social_reference_links?: string[] | null
  style_notes?: string | null
  body_note?: string | null
  fabric_description?: string | null
  fabric_budget_amount?: number | null
  fabric_budget_currency?: string | null
  fabric_sourcing_deadline_days?: number | null
  fabric_sourcing_deadline_at?: string | null
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_approval_requested_at?: string | null
  fabric_approved_at?: string | null
  fabric_changes_requested_at?: string | null
  shipping_preference?: string | null
  delivery_instructions?: string | null
  target_delivery_date?: string | null
}

type AccountPayout = {
  id: string
  tailor_profile_id: string | null
  amount: number | null
  currency: string | null
  provider: string | null
  status: string | null
  provider_payout_id: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  processed_at: string | null
}

type AccountBaseData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  warning: string | null
}

const emptyData: AccountBaseData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  warning: null,
}

type AccountShellData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
  activeOrderCount: number
  customerActiveOrderCount: number
  tailorActiveOrderCount: number
  unreadCount: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
  warning: string | null
}

type MeasurementsSurfaceData = {
  measurementProfiles: MeasurementProfile[]
  measurementScans: MeasurementScan[]
  warning: string | null
}

type MeasurementsRenderData = MeasurementsSurfaceData & {
  customerProfile: CustomerProfile | null
}

type ExploreSurfaceData = {
  exploreTailors: TailorProfile[]
  exploreItems: SellerItem[]
  warning: string | null
}

type ExploreRenderData = ExploreSurfaceData & {
  userId: string | null
  accountCurrency: string | null
}

type OrderActorData = {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type OrdersSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  warning: string | null
}

type OrdersRenderData = OrdersSurfaceData & OrderActorData

type OrderDetailSurfaceData = {
  order: AccountOrder | null
  payments: AccountPayment[]
  messages: AccountMessage[]
  stageUpdates: StageUpdate[]
  productionEvidence: ProductionEvidence[]
  materialAdvances: MaterialAdvance[]
  customOrderDetail: CustomOrderDetail | null
  reviews: AccountReview[]
  warning: string | null
}

type OrderDetailRenderData = OrderDetailSurfaceData & OrderActorData & {
  customerProfile: CustomerProfile | null
}

type PayoutRenderData = {
  tailorProfile: TailorProfile | null
}

type SupportSurfaceData = {
  orders: AccountOrder[]
  warning: string | null
}

type SupportRenderData = SupportSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type ShopSurfaceData = {
  sellerItems: SellerItem[]
  exploreItems: SellerItem[]
  warning: string | null
}

type ShopRenderData = ShopSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
}

type WorkSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  sellerItems: SellerItem[]
  warning: string | null
}

type WorkRenderData = WorkSurfaceData & OrderActorData

type BriefSurfaceData = {
  tailor: TailorProfile | null
  measurementProfiles: MeasurementProfile[]
  warning: string | null
}

type BriefRenderData = BriefSurfaceData & {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
}

type CheckoutSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  warning: string | null
}

type CheckoutRenderData = CheckoutSurfaceData & {
  userId: string | null
}

type EarningsSurfaceData = {
  payouts: AccountPayout[]
  orders: AccountOrder[]
  warning: string | null
}

type EarningsRenderData = EarningsSurfaceData & {
  tailorProfile: TailorProfile | null
}

type ProfileSurfaceData = {
  sellerItems: SellerItem[]
  portfolioItems: PortfolioItem[]
  warning: string | null
}

type ProfileRenderData = ProfileSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
}

type SettingsSurfaceData = {
  orderCurrencies: string[]
  warning: string | null
}

type SettingsRenderData = SettingsSurfaceData & {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
}

type TailorDetailSurfaceData = {
  tailor: TailorProfile | null
  readyMade: SellerItem[]
  tailorReviews: TailorReview[]
  isSaved: boolean
  warning: string | null
}

type ItemDetailSurfaceData = {
  item: SellerItem | null
  warning: string | null
}

type ItemDetailRenderData = ItemDetailSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

type MessagesSurfaceData = {
  orders: AccountOrder[]
  messages: AccountMessage[]
  reactions: AccountMessageReaction[]
  warning: string | null
}

type MessagesRenderData = MessagesSurfaceData & {
  userId: string | null
}

type SavedSurfaceData = {
  wishlistCollections: WishlistCollection[]
  wishlistItems: WishlistItem[]
  savedTailors: TailorProfile[]
  savedItems: SellerItem[]
  warning: string | null
}

const emptyShellData: AccountShellData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  pickupDetails: null,
  activeOrderCount: 0,
  customerActiveOrderCount: 0,
  tailorActiveOrderCount: 0,
  unreadCount: 0,
  checkoutPendingCount: 0,
  payoutNeedsSetup: false,
  warning: null,
}

const emptyMeasurementsSurfaceData: MeasurementsSurfaceData = {
  measurementProfiles: [],
  measurementScans: [],
  warning: null,
}

const emptyExploreSurfaceData: ExploreSurfaceData = {
  exploreTailors: [],
  exploreItems: [],
  warning: null,
}

const emptyOrdersSurfaceData: OrdersSurfaceData = {
  orders: [],
  payments: [],
  messages: [],
  warning: null,
}

const emptyOrderDetailSurfaceData: OrderDetailSurfaceData = {
  order: null,
  payments: [],
  messages: [],
  stageUpdates: [],
  productionEvidence: [],
  materialAdvances: [],
  customOrderDetail: null,
  reviews: [],
  warning: null,
}

const emptySupportSurfaceData: SupportSurfaceData = {
  orders: [],
  warning: null,
}

const emptyShopSurfaceData: ShopSurfaceData = {
  sellerItems: [],
  exploreItems: [],
  warning: null,
}

const emptyWorkSurfaceData: WorkSurfaceData = {
  orders: [],
  payments: [],
  sellerItems: [],
  warning: null,
}

const emptyBriefSurfaceData: BriefSurfaceData = {
  tailor: null,
  measurementProfiles: [],
  warning: null,
}

const emptyCheckoutSurfaceData: CheckoutSurfaceData = {
  orders: [],
  payments: [],
  warning: null,
}

const emptyEarningsSurfaceData: EarningsSurfaceData = {
  payouts: [],
  orders: [],
  warning: null,
}

const emptyProfileSurfaceData: ProfileSurfaceData = {
  sellerItems: [],
  portfolioItems: [],
  warning: null,
}

const emptySettingsSurfaceData: SettingsSurfaceData = {
  orderCurrencies: [],
  warning: null,
}

const emptyTailorDetailSurfaceData: TailorDetailSurfaceData = {
  tailor: null,
  readyMade: [],
  tailorReviews: [],
  isSaved: false,
  warning: null,
}

const emptyItemDetailSurfaceData: ItemDetailSurfaceData = {
  item: null,
  warning: null,
}

const emptyMessagesSurfaceData: MessagesSurfaceData = {
  orders: [],
  messages: [],
  reactions: [],
  warning: null,
}

const emptySavedSurfaceData: SavedSurfaceData = {
  wishlistCollections: [],
  wishlistItems: [],
  savedTailors: [],
  savedItems: [],
  warning: null,
}

function accountDataFromShell(shellData: AccountShellData, warningOverride?: string | null): AccountBaseData {
  return {
    ...emptyData,
    userId: shellData.userId,
    accountCurrency: shellData.accountCurrency,
    customerProfile: shellData.customerProfile,
    tailorProfile: shellData.tailorProfile,
    warning: warningOverride ?? null,
  }
}

let _lastKnownSession: Session | null = null
const _shellCache = new Map<string, { shellData: AccountShellData; at: number }>()
const SHELL_CACHE_TTL = 45_000

function shellCacheRead(userId: string): AccountShellData | null {
  const e = _shellCache.get(userId)
  if (!e || Date.now() - e.at > SHELL_CACHE_TTL) return null
  return e.shellData
}

function shellCacheWrite(userId: string, shellData: AccountShellData) {
  _shellCache.set(userId, { shellData, at: Date.now() })
}

function shellCacheDelete(userId: string) {
  _shellCache.delete(userId)
}

function readCachedShellSnapshot() {
  const session = _lastKnownSession
  if (!session?.user.id) return null
  const shellData = shellCacheRead(session.user.id)
  return shellData ? { session, shellData } : null
}

async function fetchAccountShellDataCached(uid: string): Promise<AccountShellData> {
  const cached = shellCacheRead(uid)
  if (cached) return cached

  const result = await fetchAccountShellData(uid)
  shellCacheWrite(uid, result)
  return result
}

const surfaceCopy: Record<AccountSurface, { eyebrow: string; title: string; body: string }> = {
  explore: {
    eyebrow: 'Explore',
    title: 'Find the right tailor.',
    body: 'Browse tailor profiles, portfolio work, pricing, fulfillment, reviews, and ready-made pieces before you start a brief.',
  },
  orders: {
    eyebrow: 'Orders',
    title: 'Track every order from one place.',
    body: 'Review custom and ready-made work, payment state, fulfillment, production updates, and next steps.',
  },
  'order-detail': {
    eyebrow: 'Order detail',
    title: 'One order, full context.',
    body: 'Brief, payment, timeline, messages, and handoff context stay together so nobody has to guess what happened.',
  },
  messages: {
    eyebrow: 'Messages',
    title: 'Order conversations stay protected.',
    body: 'Review and reply inside real order threads. Calls, photos, and notes stay tied to the order.',
  },
  measurements: {
    eyebrow: 'Measurements',
    title: 'Fit records you can trust.',
    body: 'Named wearer profiles, Drapeon Vision scans, manual profiles, and measurement age all stay visible before ordering.',
  },
  brief: {
    eyebrow: 'Custom brief',
    title: 'Send a protected custom-order request.',
    body: 'Share the garment, references, fit context, fabric plan, and fulfillment preference. The tailor reviews the brief before quoting.',
  },
  shop: {
    eyebrow: 'Marketplace',
    title: 'Ready-made pieces from Drapeon tailors.',
    body: 'Browse available garments with price, stock, fit guidance, fulfillment options, and checkout from the item detail.',
  },
  work: {
    eyebrow: 'Tailor cockpit',
    title: 'Your business at a glance.',
    body: 'Active orders, availability, payout readiness, and the next action that needs your attention — all from one surface.',
  },
  earnings: {
    eyebrow: 'Earnings',
    title: 'Know what is pending, blocked, and paid.',
    body: 'Review payout records and order payment context from web. Money movement still follows provider checks, handoff windows, refunds, and ops controls.',
  },
  payout: {
    eyebrow: 'Payout setup',
    title: 'Keep payout readiness explicit.',
    body: 'Review payout destination status and use provider-backed setup paths where supported. Manual bank entry stays ops-reviewed before it can be trusted for payouts.',
  },
  profile: {
    eyebrow: 'Your profile',
    title: 'Storefront, setup, and trust.',
    body: 'Manage your live profile, payout readiness, portfolio, and how customers see your business on Drapeon.',
  },
  checkout: {
    eyebrow: 'Payment',
    title: 'Pay only when an order is ready.',
    body: 'Custom briefs move to payment after the tailor sends a quote. Ready-made pieces can go straight to checkout, and failed or pending payments stay attached to the order.',
  },
  saved: {
    eyebrow: 'Saved',
    title: 'Wishlists, saved tailors, and pieces.',
    body: 'Keep saved tailors, ready-made pieces, and planning lists easy to find.',
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Account settings without guesswork.',
    body: 'Review profile, currency, notifications, login security, privacy, support, and deletion routes.',
  },
  support: {
    eyebrow: 'Support',
    title: 'Get help with the right context.',
    body: 'Choose the issue type, include the order when possible, and keep payment, fit, delivery, and account questions routed clearly.',
  },
  'tailor-detail': {
    eyebrow: 'Tailor profile',
    title: 'Review the tailor before starting an order.',
    body: 'Portfolio, specialties, fulfillment, pricing, reviews, and ready-made pieces stay together before you choose.',
  },
  'item-detail': {
    eyebrow: 'Ready-made detail',
    title: 'Review the piece before checkout.',
    body: 'Images, size, stock, fit guidance, fulfillment, tailor context, and price stay focused on the ready-made purchase.',
  },
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function cleanLabel(value: string | null | undefined, fallback = 'Not set') {
  return formatDatabaseEnumLabel(value, fallback)
}

function payoutBlockedReasonCopy(value: string | null | undefined) {
  if (!value) return null
  try {
    return payoutBlockReasonMessage(value as Parameters<typeof payoutBlockReasonMessage>[0])
  } catch {
    return cleanLabel(value, 'Blocked')
  }
}

function stringList(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function safeList(value: string[] | null | undefined, fallback = 'Not listed') {
  const cleaned = stringList(value)
    .map((entry) => safeUserText(entry))
    .filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(', ') : fallback
}

function editableListText(value: string[] | null | undefined) {
  return stringList(value).join(', ')
}

function parseEditableList(value: string, maxItems: number) {
  return uniqueValues(
    value
      .split(/[,\n]/gu)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ).slice(0, maxItems)
}

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined) {
  if (typeof amountMinor !== 'number') return 'Quote pending'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amountMinor / 100)
}

function formatDate(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null
  const normalized =
    typeof value === 'string' &&
    value.includes('T') &&
    !/(?:z|[+-]\d{2}:?\d{2})$/iu.test(value.trim())
      ? `${value.trim()}Z`
      : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function timestampMs(value: string | null | undefined, fallback = 0) {
  return parseDateValue(value)?.getTime() ?? fallback
}

function formatRelative(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return 'Recently'
  const deltaMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const absoluteMinutes = Math.abs(deltaMinutes)
  if (absoluteMinutes <= 1) return 'Just now'
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (absoluteMinutes < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')
  return formatDate(value) ?? 'Recently'
}

function formatMessageRelative(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return 'Recently'
  if (date.getTime() > Date.now()) return 'Just now'
  return formatRelative(value)
}

function autoReleaseLabel(value: string | null | undefined) {
  if (!value) return null
  const dateLabel = formatDate(value)
  const relative = formatRelative(value)
  return dateLabel ? `${relative} (${dateLabel})` : relative
}

function isHandoffStage(stage: string | null | undefined) {
  return ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED'].includes(stage ?? '')
}

function readableCode(value: string | null | undefined) {
  if (!value) return null
  return value
    .replace(/\s+/g, '')
    .replace(/(.{2})/g, '$1 ')
    .trim()
}

function orderTitle(order: AccountOrder) {
  return safeUserText(order.item_title || order.garment_type, 'Drapeon order')
}

function orderAmount(order: AccountOrder) {
  return formatMoney(order.total_amount ?? order.quoted_amount, order.currency ?? order.quoted_currency)
}

function isTerminalOrder(order: AccountOrder) {
  return ['COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REFUNDED'].includes(order.stage ?? '')
}

const CUSTOMER_SELF_CANCEL_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'])
const CUSTOMER_CANCELLATION_REVIEW_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'FINISHING'])
const CUSTOMER_DELIVERY_REVIEW_STAGES = new Set(['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'])
const CUSTOMER_DISPUTE_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION'])
const CUSTOMER_RECEIPT_STAGES = new Set(['SHIPPED', 'OUT_FOR_DELIVERY'])
const CUSTOMER_COMPLETE_STAGES = new Set(['DELIVERED', 'COLLECTED'])
const CUSTOMER_AFTERCARE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])
const CUSTOMER_FABRIC_TRACKING_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'])
const PRE_CUTTING_STAGES = new Set(['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING'])
const SCOPE_CHANGE_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
])

const SCOPE_CHANGE_TYPE_OPTIONS = [
  { value: 'MEASUREMENT_AMENDMENT', label: 'Measurement amendment' },
  { value: 'STYLE_OR_REFERENCE', label: 'Style or reference' },
  { value: 'FABRIC_OR_MATERIAL', label: 'Fabric or material' },
  { value: 'ADD_OR_REMOVE_ITEM', label: 'Add or remove item' },
  { value: 'DEADLINE_OR_EVENT', label: 'Deadline or event' },
  { value: 'PAUSE_OR_RESTART', label: 'Pause or restart' },
  { value: 'REWORK_OR_ALTERATION', label: 'Rework or alteration' },
  { value: 'OTHER', label: 'Other' },
] as const

const SCOPE_CHANGE_IMPACT_OPTIONS = [
  { value: 'PRICE', label: 'Price' },
  { value: 'DEADLINE', label: 'Deadline' },
  { value: 'FIT', label: 'Fit' },
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'STYLE', label: 'Style' },
  { value: 'FULFILLMENT', label: 'Fulfillment' },
] as const

const MATERIAL_ISSUE_REASON_OPTIONS = [
  { value: 'POOR_FABRIC_QUALITY', label: 'Poor fabric quality' },
  { value: 'INSUFFICIENT_YARDAGE', label: 'Insufficient yardage' },
  { value: 'FABRIC_NOT_RECEIVED', label: 'Fabric not received' },
  { value: 'WRONG_FABRIC_TYPE', label: 'Wrong fabric type' },
  { value: 'FABRIC_DAMAGED', label: 'Fabric damaged' },
  { value: 'FABRIC_MISMATCH', label: 'Fabric mismatch' },
] as const

const MATERIAL_ISSUE_RESPONSE_OPTIONS = [
  { value: 'REPLACE_FABRIC', label: 'I will replace the fabric' },
  { value: 'ASK_TAILOR_TO_SOURCE', label: 'Ask tailor to source fabric' },
  { value: 'REVISE_DESIGN', label: 'Revise the design' },
  { value: 'CANCEL_ORDER', label: 'Request cancellation review' },
] as const

const TAILOR_CANCELLATION_REASON_OPTIONS = [
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'ITEM_DAMAGED_BEFORE_DISPATCH', label: 'Item damaged before dispatch' },
  { value: 'TAILOR_CANNOT_FULFIL', label: 'Tailor cannot fulfil' },
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'OTHER', label: 'Other' },
] as const

const TAILOR_DELIVERY_REASON_OPTIONS = [
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'DELIVERY_FAILED', label: 'Delivery failed' },
  { value: 'RETURN_TO_SENDER', label: 'Return to sender' },
  { value: 'RECIPIENT_UNREACHABLE', label: 'Recipient unreachable' },
  { value: 'OTHER', label: 'Other' },
] as const

function measurementSnapshotForOrder(order: AccountOrder) {
  const snapshot = order.customer_measurements_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

function orderNeedsMeasurementConfirmation(order: AccountOrder) {
  return measurementSnapshotForOrder(order)?.needsConfirmation === true
}

const ORDER_CALL_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
])

type OrderSupportMeta = {
  consultation?: {
    status?: string | null
    requestedBy?: string | null
    feeAmount?: number | null
    feeCurrency?: string | null
    feeCreditable?: boolean | null
    requestNote?: string | null
    requestedAt?: string | null
    proposedStartAt?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    paidAt?: string | null
    paymentTiming?: string | null
    reminderStartSentAt?: string | null
  } | null
  orderCall?: {
    status?: string | null
    reason?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    reminderStartSentAt?: string | null
    completedAt?: string | null
  } | null
  styleAlignment?: {
    requiredBeforeCutting?: boolean | null
    status?: string | null
    tailorInterpretation?: string | null
    instruction?: string | null
    customerExpectation?: string | null
    approvalRequestedAt?: string | null
    approvedAt?: string | null
    changeRequestedAt?: string | null
  } | null
  materialIssue?: {
    status?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
    response?: string | null
    responseLabel?: string | null
    responseNote?: string | null
  } | null
  scopeChange?: {
    status?: string | null
    requestedBy?: string | null
    type?: string | null
    typeLabel?: string | null
    summary?: string | null
    impacts?: string[] | null
    priceImpactMinor?: number | null
    deadlineImpact?: string | null
    responseNote?: string | null
  } | null
  cancellationReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  deliveryReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  dispatchRecord?: {
    bookedAt?: string | null
    premiumException?: boolean | null
  } | null
  fitProfile?: {
    requiresTailorReview?: boolean | null
    tailorMeasurementOverride?: boolean | null
    tailorMeasurementOverrideReason?: string | null
  } | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  fabricHandoffMode?: string | null
  fabricHandoffLabel?: string | null
}

function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as OrderSupportMeta
      : {}
  } catch {
    return {}
  }
}

function formatDateTime(value: string | null | undefined, timezone?: string | null) {
  const date = parseDateValue(value)
  if (!date) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function dateTimeLocalInputValue(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function canStartOrderCall(order: AccountOrder) {
  if (order.stage === 'CONSULTATION') return true
  return ORDER_CALL_STAGES.has(order.stage ?? '')
}

const CUSTOMER_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
])

const TAILOR_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'IN_DISPUTE',
])

function isActiveConversationOrder(order: AccountOrder, userId: string | null) {
  const stage = order.stage ?? ''
  if (order.customer_id === userId) return CUSTOMER_ACTIVE_THREAD_STAGES.has(stage)
  return TAILOR_ACTIVE_THREAD_STAGES.has(stage)
}

function isReadyMadeInquiryOrder(order: Pick<AccountOrder, 'order_kind' | 'stage' | 'seller_item_id'>) {
  return order.stage === 'PENDING_QUOTE' && (
    order.order_kind === 'READY_MADE' ||
    (typeof order.seller_item_id === 'string' && order.seller_item_id.trim().length > 0)
  )
}

function showOrderInOrdersSurface(order: AccountOrder, data: OrderActorData) {
  if (!isReadyMadeInquiryOrder(order)) return true
  return isTailorOrder(order, data)
}

function partyName(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    const tailor = firstJoinedRow(order.tailor_profiles)
    return safeEntityName(tailor?.business_name || tailor?.display_name, 'Tailor')
  }
  const customer = firstJoinedRow(order.customer_profiles)
  return safeEntityName(customer?.display_name, 'Customer')
}

function partyAvatar(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    return safeMediaUrl(firstJoinedRow(order.tailor_profiles)?.avatar_url ?? null, 'avatars')
  }
  return safeMediaUrl(firstJoinedRow(order.customer_profiles)?.avatar_url ?? null, 'avatars')
}

function partyKey(order: AccountOrder, userId: string | null): string {
  return order.customer_id === userId
    ? (order.tailor_profile_id ?? order.tailor_id ?? `_${order.id}`)
    : (order.customer_id ?? `_${order.id}`)
}

type PublicMediaBucket = 'avatars' | 'portfolio-photos' | 'seller-item-media' | 'review-media'

const PUBLIC_MEDIA_BUCKETS: PublicMediaBucket[] = ['avatars', 'portfolio-photos', 'seller-item-media', 'review-media']
const TRUSTED_EXTERNAL_IMAGE_HOSTS = new Set(['images.unsplash.com'])

function isPublicMediaBucket(value: string): value is PublicMediaBucket {
  return PUBLIC_MEDIA_BUCKETS.includes(value as PublicMediaBucket)
}

function runtimeSupabaseUrl() {
  const envUrl = process.env.DRAPEON_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (envUrl.trim()) return envUrl.replace(/\/+$/u, '')

  if (typeof window === 'undefined') return ''
  return window.__DRAPEON_PUBLIC_ENV__?.supabaseUrl?.trim().replace(/\/+$/u, '') ?? ''
}

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function publicStorageMediaUrl(src: string, fallbackBucket: PublicMediaBucket) {
  const supabaseUrl = runtimeSupabaseUrl()
  if (!supabaseUrl) return null

  const parts = src
    .trim()
    .replace(/^\/+/u, '')
    .replace(/^public\//u, '')
    .split('/')
    .filter(Boolean)

  const first = parts[0] ?? ''
  const bucket = isPublicMediaBucket(first) ? first : fallbackBucket
  const objectParts = isPublicMediaBucket(first) ? parts.slice(1) : parts
  if (objectParts[0] === 'public') objectParts.shift()
  const objectPath = encodeStoragePath(objectParts.join('/'))
  if (!objectPath) return null

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

function safeMediaUrl(src: string | null | undefined, bucket?: PublicMediaBucket) {
  if (!src) return null
  const value = src.trim()
  if (!value) return null
  if (value.startsWith('data:') || value.startsWith('blob:')) return value
  if (bucket && !/^(https?:)/iu.test(value)) return publicStorageMediaUrl(value, bucket)
  if (value.startsWith('/')) return value
  try {
    const url = new URL(value)
    const supabaseUrl = runtimeSupabaseUrl()
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : ''
    if (
      supabaseHost &&
      url.hostname === supabaseHost &&
      (url.pathname.startsWith('/storage/v1/object/public/') ||
        url.pathname.startsWith('/storage/v1/object/sign/'))
    ) {
      return value
    }
    if (url.protocol === 'https:' && TRUSTED_EXTERNAL_IMAGE_HOSTS.has(url.hostname)) {
      return value
    }
  } catch {
    return null
  }
  return null
}

function initialsForName(value: string | null | undefined) {
  const parts = safeEntityName(value, 'Drapeon')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'D'
  if (parts.length === 1) return (parts[0] ?? 'D').slice(0, 2).toUpperCase()
  return `${parts[0]?.charAt(0) ?? 'D'}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
}

function itemPhoto(item: SellerItem) {
  return stringList(item.photo_urls)
    .map((src) => safeMediaUrl(src, 'seller-item-media'))
    .filter((src): src is string => !!src)
    .find((src) => !isVideoMediaUrl(src)) ?? null
}

const READY_MADE_FIT_FIELDS: Array<{ key: ReadyMadeFitFieldKey; label: string; shortLabel: string }> = [
  { key: 'chest', label: 'Chest', shortLabel: 'Chest' },
  { key: 'waist', label: 'Waist', shortLabel: 'Waist' },
  { key: 'hips', label: 'Hips', shortLabel: 'Hips' },
  { key: 'shoulderWidth', label: 'Shoulders', shortLabel: 'Shoulders' },
  { key: 'inseam', label: 'Inseam', shortLabel: 'Inseam' },
  { key: 'sleeveLength', label: 'Sleeve length', shortLabel: 'Sleeve' },
  { key: 'neckCircumference', label: 'Neck', shortLabel: 'Neck' },
  { key: 'underBust', label: 'Under bust', shortLabel: 'Under bust' },
  { key: 'height', label: 'Height', shortLabel: 'Height' },
  { key: 'backLength', label: 'Back length', shortLabel: 'Back' },
  { key: 'outseam', label: 'Outseam', shortLabel: 'Outseam' },
  { key: 'thighCircumference', label: 'Thigh', shortLabel: 'Thigh' },
  { key: 'kneeCircumference', label: 'Knee', shortLabel: 'Knee' },
  { key: 'bicepCircumference', label: 'Bicep', shortLabel: 'Bicep' },
  { key: 'wristCircumference', label: 'Wrist', shortLabel: 'Wrist' },
  { key: 'headCircumference', label: 'Head circumference', shortLabel: 'Head' },
  { key: 'hatBandLine', label: 'Hat band line', shortLabel: 'Hat band' },
  { key: 'headLength', label: 'Head length', shortLabel: 'Head length' },
  { key: 'headWidth', label: 'Head width', shortLabel: 'Head width' },
  { key: 'earToEarOverCrown', label: 'Ear to ear over crown', shortLabel: 'Crown ear-to-ear' },
  { key: 'frontToBackOverCrown', label: 'Front to back over crown', shortLabel: 'Crown front-back' },
  { key: 'filaHeight', label: 'Fila height', shortLabel: 'Fila height' },
  { key: 'torsoLength', label: 'Torso length', shortLabel: 'Torso' },
]

const READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS: Array<{
  value: ReadyMadeFitAdvice
  label: string
  hint: string
}> = [
  {
    value: 'SIZE_UP_IF_BETWEEN',
    label: 'Size up if between',
    hint: 'Good for fitted pieces or fabric with little stretch.',
  },
  {
    value: 'SIZE_DOWN_IF_BETWEEN',
    label: 'Size down if between',
    hint: 'Good for relaxed cuts or stretch fabrics.',
  },
  {
    value: 'ASK_SELLER',
    label: 'Ask seller if between',
    hint: 'Use this when fit depends on styling or cut.',
  },
]

const FALLBACK_READY_MADE_FIT_FIELDS: ReadyMadeFitFieldKey[] = ['chest', 'waist', 'hips']

const READY_MADE_CATEGORY_FIELD_MAP: Record<string, ReadyMadeFitFieldKey[]> = {
  agbada: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  kaftan: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  suit: ['chest', 'waist', 'shoulderWidth', 'sleeveLength', 'inseam', 'outseam'],
  dress: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  crochet: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  'ready-made': ['chest', 'waist', 'hips'],
  'two-piece set': ['chest', 'waist', 'hips', 'inseam', 'outseam'],
  trousers: ['waist', 'hips', 'inseam', 'outseam', 'thighCircumference'],
  skirt: ['waist', 'hips', 'height'],
  shirt: ['chest', 'shoulderWidth', 'sleeveLength', 'neckCircumference'],
  'native wear': ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  headwear: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  hat: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  cap: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  fila: ['headCircumference', 'hatBandLine', 'earToEarOverCrown', 'frontToBackOverCrown', 'filaHeight'],
  gele: ['headCircumference', 'hatBandLine'],
}

const READY_MADE_FIT_FIELD_SET = new Set<ReadyMadeFitFieldKey>(READY_MADE_FIT_FIELDS.map((field) => field.key))

function readyMadeFitFieldLabel(field: ReadyMadeFitFieldKey) {
  return READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field
}

function recommendedReadyMadeFitFieldsForCategory(category: string | null | undefined) {
  const normalized = category?.trim().toLowerCase() ?? ''
  return READY_MADE_CATEGORY_FIELD_MAP[normalized] ?? FALLBACK_READY_MADE_FIT_FIELDS
}

function asPositiveFitNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function normalizeReadyMadeFitFields(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((field): field is ReadyMadeFitFieldKey => typeof field === 'string' && READY_MADE_FIT_FIELD_SET.has(field as ReadyMadeFitFieldKey))
    .filter((field, index, all) => all.indexOf(field) === index)
}

function normalizeReadyMadeFitRange(raw: unknown): ReadyMadeFitRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  let min = asPositiveFitNumber((raw as Record<string, unknown>).min)
  let max = asPositiveFitNumber((raw as Record<string, unknown>).max)

  if (min == null && max == null) return null
  if (min != null && max != null && max < min) {
    const nextMin = max
    max = min
    min = nextMin
  }

  return { min, max }
}

function emptyReadyMadeSizeGuide(unit: ReadyMadeFitUnit = 'in'): ReadyMadeSizeGuide {
  return {
    version: 1,
    unit,
    fields: [],
    sizeRanges: {},
    fitNotes: null,
    stretchNotes: null,
    sizeAdvice: 'ASK_SELLER',
  }
}

function normalizeWebReadyMadeSizeGuide(raw: unknown, sizes: string[]): ReadyMadeSizeGuide {
  const base = emptyReadyMadeSizeGuide()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base

  const value = raw as Record<string, unknown>
  const fields = normalizeReadyMadeFitFields(value.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}

  for (const size of sizes) {
    const rawSizeRanges =
      value.sizeRanges && typeof value.sizeRanges === 'object' && !Array.isArray(value.sizeRanges)
        ? (value.sizeRanges as Record<string, unknown>)[size]
        : null

    if (!rawSizeRanges || typeof rawSizeRanges !== 'object' || Array.isArray(rawSizeRanges)) continue

    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const range = normalizeReadyMadeFitRange((rawSizeRanges as Record<string, unknown>)[field])
      if (range) nextRanges[field] = range
    }

    if (Object.keys(nextRanges).length > 0) {
      sizeRanges[size] = nextRanges
    }
  }

  const sizeAdvice =
    value.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ||
    value.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ||
    value.sizeAdvice === 'ASK_SELLER'
      ? value.sizeAdvice
      : 'ASK_SELLER'

  return {
    version: 1,
    unit: value.unit === 'cm' ? 'cm' : 'in',
    fields,
    sizeRanges,
    fitNotes: typeof value.fitNotes === 'string' && value.fitNotes.trim().length > 0 ? value.fitNotes.trim() : null,
    stretchNotes: typeof value.stretchNotes === 'string' && value.stretchNotes.trim().length > 0 ? value.stretchNotes.trim() : null,
    sizeAdvice,
  }
}

function guideDraftFromWebReadyMadeSizeGuide(input: {
  sizes: string[]
  fields: ReadyMadeFitFieldKey[]
  guide: ReadyMadeSizeGuide | null | undefined
}): ReadyMadeSizeGuideDraft {
  const normalizedGuide = input.guide ?? emptyReadyMadeSizeGuide()
  const nextDraft: ReadyMadeSizeGuideDraft = {}

  for (const size of input.sizes) {
    nextDraft[size] = {}
    for (const field of input.fields) {
      const range = normalizedGuide.sizeRanges[size]?.[field]
      nextDraft[size][field] = {
        min: range?.min != null ? String(range.min) : '',
        max: range?.max != null ? String(range.max) : '',
      }
    }
  }

  return nextDraft
}

function draftToWebReadyMadeSizeGuide(input: {
  sizes: string[]
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  draft: ReadyMadeSizeGuideDraft
  fitNotes: string
  stretchNotes: string
  sizeAdvice: ReadyMadeFitAdvice | null
}): ReadyMadeSizeGuide {
  const fields = normalizeReadyMadeFitFields(input.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}

  for (const size of input.sizes) {
    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const rangeDraft = input.draft[size]?.[field]
      const range = normalizeReadyMadeFitRange({
        min: typeof rangeDraft?.min === 'string' && rangeDraft.min.trim().length > 0 ? Number(rangeDraft.min) : null,
        max: typeof rangeDraft?.max === 'string' && rangeDraft.max.trim().length > 0 ? Number(rangeDraft.max) : null,
      })
      if (range) nextRanges[field] = range
    }

    if (Object.keys(nextRanges).length > 0) {
      sizeRanges[size] = nextRanges
    }
  }

  return {
    version: 1,
    unit: input.unit,
    fields,
    sizeRanges,
    fitNotes: input.fitNotes.trim().slice(0, 240) || null,
    stretchNotes: input.stretchNotes.trim().slice(0, 240) || null,
    sizeAdvice: input.sizeAdvice ?? 'ASK_SELLER',
  }
}

function hasReadyMadeSizeGuide(guide: ReadyMadeSizeGuide | null | undefined, sizes?: string[]) {
  if (!guide) return false
  const relevantSizes = sizes?.length ? sizes : Object.keys(guide.sizeRanges)
  if (guide.fields.length === 0 || relevantSizes.length === 0) return false

  return relevantSizes.some((size) =>
    guide.fields.some((field) => {
      const range = guide.sizeRanges[size]?.[field]
      return Boolean(range && (range.min != null || range.max != null))
    }),
  )
}

function fitGuideInputValue(value: string) {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = normalized.split('.')
  return rest.length > 0 ? `${whole}.${rest.join('')}` : whole
}

function fitGuideFieldsSummary(fields: ReadyMadeFitFieldKey[]) {
  if (fields.length === 0) return 'Choose fields'
  const labels = fields.slice(0, 3).map((field) => readyMadeFitFieldLabel(field))
  return fields.length > 3 ? `${labels.join(', ')} +${fields.length - 3}` : labels.join(', ')
}

function tailorPhoto(tailor: TailorProfile) {
  return stringList(tailor.portfolio_photo_urls).map((src) => safeMediaUrl(src, 'portfolio-photos')).find(Boolean) ?? safeMediaUrl(tailor.avatar_url, 'avatars') ?? null
}

function tailorProfileMedia(tailor: TailorProfile) {
  const primaryPhoto = tailorPhoto(tailor)
  const portfolioPhotos = stringList(tailor.portfolio_photo_urls)
    .map((src) => safeMediaUrl(src, 'portfolio-photos'))
    .filter((src): src is string => !!src)
  const portfolioVideos = stringList(tailor.portfolio_video_urls)
    .map((src) => safeMediaUrl(src, 'portfolio-photos'))
    .filter((src): src is string => !!src)

  return uniqueValues([primaryPhoto, ...portfolioPhotos, ...portfolioVideos])
}

function hasMeasurements(profile: CustomerProfile | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}

function measurementCompleteness(measurements: Record<string, unknown> | null | undefined) {
  return measurementCoreCompleteness(measurements)
}

function measurementProfileStatusCopy(completeness: ReturnType<typeof measurementCoreCompleteness>) {
  if (completeness.missing.length === 0) {
    return {
      lead: 'Measurements saved.',
      detail: 'Tailors can use this profile in briefs.',
    }
  }

  return {
    lead: `${completeness.present.length}/${CORE_MEASUREMENT_FIELDS.length} key measurements saved.`,
    detail: `Add: ${completeness.missing.map((field) => field.label).join(', ')}.`,
  }
}

const DRAPE_VISION_FIT_360_CAPTURE_METHOD = 'DRAPE_VISION_ROTATION'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFit360VisionProfile(measurements: Record<string, unknown>) {
  const latestFitProfile = isRecord(measurements.latestFitProfile) ? measurements.latestFitProfile : null
  return measurements.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    latestFitProfile?.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    measurements.scanFlow === 'FIT_TURN_360_V1' ||
    latestFitProfile?.scanFlow === 'FIT_TURN_360_V1'
}

function normalizeMeasurementRecord(measurements: Record<string, unknown> | null | undefined) {
  if (!measurements) return measurements
  const promoted = promoteSpecialistMeasurementsToProfileValues(measurements).measurements
  if (!isFit360VisionProfile(promoted)) return promoted
  return stripDrapeVisionFit360DraftFields(promoted)
}

function measurementsForProfile(profile: MeasurementProfile, customerProfile: CustomerProfile | null) {
  const shouldMergeLegacy =
    profile.is_default === true &&
    (!profile.relationship || profile.relationship === 'SELF')
  const measurements = shouldMergeLegacy
    ? mergeMeasurementRecords(customerProfile?.measurements, profile.measurements)
    : profile.measurements ?? {}
  return normalizeMeasurementRecord(measurements) ?? {}
}

const MEASUREMENT_FIELD_LABELS: Record<(typeof MEASUREMENT_FIELD_KEYS)[number], string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulder width',
  inseam: 'Inseam',
  sleeveLength: 'Sleeve length',
  neckCircumference: 'Neck circumference',
  underBust: 'Under bust',
  height: 'Height',
  backLength: 'Back length',
  outseam: 'Outseam',
  thighCircumference: 'Thigh circumference',
  kneeCircumference: 'Knee circumference',
  bicepCircumference: 'Bicep circumference',
  wristCircumference: 'Wrist circumference',
  palmWidth: 'Palm width',
  palmLength: 'Palm length',
  sleeveOpening: 'Sleeve opening',
  banglePassOver: 'Bangle pass-over',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  torsoLength: 'Torso length',
  ankleHemOpening: 'Ankle / hem opening',
}

const MEASUREMENT_PROFILE_METADATA_KEYS = new Set([
  'unit',
  'measurementProfileLabel',
  'measurementProfileUpdatedAt',
  'wearerContext',
  'fitStyle',
  'fitPassportVersion',
  'measurementSource',
  'measurementSourceLabel',
  'fitConfidence',
  'needsConfirmation',
  'confirmationReason',
  'confirmationFields',
  'confirmationRequestedAt',
  'confirmedAt',
  'confirmedBy',
  'confirmedFields',
  'garmentContext',
  'bodyShape',
  'fitFlags',
  'bodyNote',
  'bodyFlags',
  'symmetryFlags',
  'requiresTailorReview',
  'latestFitProfile',
  'specialistMeasurements',
  'visionSpecialistProfile',
  'latestSpecialistMeasurementScanId',
  'latestSpecialistScanMode',
  'latestSpecialistScanFlow',
  'latestSpecialistScanStatus',
  'latestSpecialistScanAt',
])

function hasEditableMeasurementValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

function measurementEditorValue(
  measurements: Record<string, unknown> | null | undefined,
  field: { key: string; aliases?: readonly string[] },
) {
  if (!measurements) return undefined
  const candidates = [field.key, ...(field.aliases ?? [])]
  return candidates.map((key) => measurements[key]).find(hasEditableMeasurementValue)
}

function isEditableCustomMeasurementKey(key: string, value: unknown): boolean {
  const isTransientMetadata = isTransientMeasurementMetadataKey(String(key))
  return !isMeasurementFieldKey(key) &&
    !MEASUREMENT_PROFILE_METADATA_KEYS.has(key) &&
    !isTransientMetadata &&
    hasEditableMeasurementValue(value)
}

function coreMeasurementSummary(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  return CORE_MEASUREMENT_FIELDS.map((field) => {
    const value = readMeasurementValue(normalizedMeasurements, field)
    if (value == null) return null
    return `${field.label}: ${safeUserText(String(value), 'Saved')}`
  }).filter((value): value is string => Boolean(value))
}

const SPECIALIST_MEASUREMENT_META_KEYS = new Set([
  'unit',
  'cm',
  'title',
  'measurementScanId',
  'captureMethod',
  'captureMethodLabel',
  'captureVersion',
  'visionPipelineVersion',
  'outputKind',
  'scanFlow',
  'scanFlowLabel',
  'capturedAt',
  'confidenceOverall',
  'confidenceByField',
  'requiresTailorReview',
  'tapeInputsIn',
  'tapeSummary',
])

const SPECIALIST_SECTION_COPY: Record<string, { title: string; subtitle: string }> = {
  hand_wrist: {
    title: 'Hand & wrist scan',
    subtitle: 'Palm, cuff, bangle, and wrist values saved from Vision.',
  },
  headwear: {
    title: 'Headwear scan',
    subtitle: 'Head, crown, fila, and hat-band values saved from Vision.',
  },
  bodice_corset: {
    title: 'Bodice & corset scan',
    subtitle: 'Bodice, under-bust, torso, and ribcage values saved from Vision.',
  },
  lower_body_detail: {
    title: 'Hem & ankle openings',
    subtitle: 'Extra hem/opening values saved from the lower-body scan.',
  },
  fit_360: {
    title: 'Fit 360 scan',
    subtitle: 'Core body measurements saved from Vision.',
  },
}

const SPECIALIST_PROFILE_FIELD_ALIASES: Record<string, string> = {
  'Palm width': 'palmWidth',
  'Palm length': 'palmLength',
  'Sleeve opening': 'sleeveOpening',
  'Bangle pass-over': 'banglePassOver',
  'Bangle pass over': 'banglePassOver',
  ankleHem: 'ankleHemOpening',
  'Ankle / hem opening': 'ankleHemOpening',
}

function titleizeMeasurementKey(key: string) {
  if (isMeasurementFieldKey(key)) return MEASUREMENT_FIELD_LABELS[key]
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatSpecialistMeasurementValue(value: unknown, unit: string) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : null
  if (numericValue == null || !Number.isFinite(numericValue)) return null
  return `${numericValue.toFixed(2).replace(/\.?0+$/, '')} ${unit}`
}

function specialistMeasurementSections(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  if (!normalizedMeasurements || !isRecord(normalizedMeasurements.specialistMeasurements)) return []
  return Object.entries(normalizedMeasurements.specialistMeasurements)
    .map(([mode, rawValue]) => {
      if (!isRecord(rawValue)) return null
      const unit = rawValue.unit === 'cm' ? 'cm' : 'in'
      const copy = SPECIALIST_SECTION_COPY[mode] ?? {
        title: typeof rawValue.title === 'string' && rawValue.title.trim()
          ? rawValue.title.trim()
          : titleizeMeasurementKey(mode),
        subtitle: 'Saved scan values for this profile.',
      }
      const values = Object.entries(rawValue)
        .filter(([key]) => {
          if (SPECIALIST_MEASUREMENT_META_KEYS.has(key)) return false
          return !isMeasurementFieldKey(SPECIALIST_PROFILE_FIELD_ALIASES[key] ?? key)
        })
        .map(([key, value]) => {
          const formattedValue = formatSpecialistMeasurementValue(value, unit)
          if (!formattedValue) return null
          return { key, label: titleizeMeasurementKey(key), value: formattedValue }
        })
        .filter((value): value is { key: string; label: string; value: string } => !!value)
      if (!values.length) return null
      return { id: mode, ...copy, values }
    })
    .filter((section): section is { id: string; title: string; subtitle: string; values: Array<{ key: string; label: string; value: string }> } => !!section)
}

function SpecialistMeasurementSections({ measurements }: { measurements: Record<string, unknown> | null | undefined }) {
  const sections = specialistMeasurementSections(measurements)
  if (sections.length === 0) return null

  return (
    <div className="mt-3 grid gap-2">
      {sections.map((section) => (
        <div key={section.id} className="rounded-lg border border-needle/12 bg-needle/8 p-3">
          <p className="text-sm font-semibold text-ink">{safeUserText(section.title, 'Vision scan')}</p>
          <p className="mt-1 text-xs leading-5 text-ink/54">{safeUserText(section.subtitle, 'Saved scan values for this profile.')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {section.values.map((value) => (
              <span key={`${section.id}:${value.key}`} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                {safeUserText(value.label, 'Measurement')}: {safeUserText(value.value, 'Saved')}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function preservedMeasurementMeta(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  const meta: Record<string, unknown> = {}
  if (!normalizedMeasurements) return meta
  for (const key of [
    'latestFitProfile',
    'specialistMeasurements',
    'visionSpecialistProfile',
    'latestSpecialistMeasurementScanId',
    'latestSpecialistScanMode',
    'latestSpecialistScanFlow',
    'latestSpecialistScanStatus',
    'latestSpecialistScanAt',
    'bodyFlags',
    'symmetryFlags',
    'requiresTailorReview',
  ]) {
    if (normalizedMeasurements[key] != null) meta[key] = normalizedMeasurements[key]
  }
  return meta
}

function scanConfidenceLabel(value: string | null | undefined) {
  if (!value) return 'Confidence pending'
  const numeric = Number.parseFloat(value)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'Good confidence'
    if (numeric >= 0.6) return 'Review recommended'
    return 'Needs review'
  }
  return cleanLabel(value, 'Confidence pending')
}

function fitPreferenceFromProfile(profile: CustomerProfile | null) {
  const measurements = profile?.measurements
  if (!measurements || typeof measurements !== 'object') return 'Fit preference not set'
  const candidate =
    measurements.fitPreference ??
    measurements.fit_style ??
    measurements.fitStyle ??
    measurements.fit
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? safeUserText(candidate, 'Fit preference saved')
    : 'Fit preference not set'
}

function fulfillmentSummary({
  pickup,
  delivery,
  shipping,
  pickup_available,
  delivery_available,
  shipping_available,
}: {
  pickup?: boolean | null
  delivery?: boolean | null
  shipping?: boolean | null
  pickup_available?: boolean | null
  delivery_available?: boolean | null
  shipping_available?: boolean | null
}) {
  const values = [
    (pickup ?? pickup_available) ? 'Pickup' : null,
    (delivery ?? delivery_available) ? 'Delivery' : null,
    (shipping ?? shipping_available) ? 'Shipping' : null,
  ].filter(Boolean)
  return values.length > 0 ? values.join(' / ') : 'Fulfillment not set'
}

function latestPayment(orderId: string, payments: AccountPayment[]) {
  return payments.find((payment) => payment.order_id === orderId) ?? null
}

function latestMessage(orderId: string, messages: AccountMessage[]) {
  return messages.find((message) => message.order_id === orderId) ?? null
}

function stageUpdatesFor(orderId: string, updates: StageUpdate[]) {
  return updates.filter((update) => update.order_id === orderId)
}

function productionEvidenceFor(orderId: string, evidence: ProductionEvidence[]) {
  return evidence.filter((item) => item.order_id === orderId)
}

function mediaFingerprint(file: File) {
  return [file.name, file.type, file.size, file.lastModified]
    .join(':')
    .replace(/\s+/g, '-')
    .slice(0, 240)
}

const publicTailorProfileSelect =
  'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, accepts_custom_orders_now, shop_paused, seller_type, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, portfolio_video_urls, avatar_url'

const ownTailorProfileSelect =
  `${publicTailorProfileSelect}, profile_completed, id_verification_status, id_selfie_document_url, id_verification_submitted_at, id_verification_rejection_reason, id_verification_rejected_at, id_verification_metadata, payout_currency, payout_provider, payout_reverification_required, payout_account_type, payout_account_verified, payout_account_verified_at, payout_account_change_count, payout_account_last_changed_at, payout_account_change_locked_until, payout_destination_hold_until`

const sellerItemSelect =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, price_amount, currency, photo_urls, stock_status, inventory_quantity, size_guide, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, avatar_url, location, availability, shop_paused, is_live)'

type WebTailorReadiness = {
  profileCompleted: boolean
  identityVerified: boolean
  payoutReady: boolean
  publicDiscoveryReady: boolean
  canAcceptPaidOrders: boolean
  canPublishPaidItems: boolean
  code: 'PROFILE_INCOMPLETE' | 'IDENTITY_REVIEW_PENDING' | 'IDENTITY_VERIFICATION_REQUIRED' | 'PAYOUT_SETUP_REQUIRED' | null
  title: string
  body: string
  actionLabel: string | null
  actionHref: Route | null
  tone: 'neutral' | 'warning' | 'success'
}

function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function isVerifiedIdentityStatus(status: string | null | undefined) {
  return status === 'VERIFIED' || status === 'APPROVED'
}

function isPayoutReady(profile: TailorProfile | null | undefined) {
  if (!profile || profile.payout_reverification_required === true) return false
  if (profile.payout_account_verified === true) return true

  const manualBankStatus = String(profile.manual_bank_verification_status ?? '').toUpperCase()
  return (
    hasNonEmptyText(profile.paystack_recipient_code) ||
    hasNonEmptyText(profile.stripe_connect_account_id) ||
    hasNonEmptyText(profile.paystack_account_id) ||
    hasNonEmptyText(profile.stripe_account_id) ||
    (profile.manual_bank_entry === true && ['VERIFIED', 'APPROVED'].includes(manualBankStatus))
  )
}

function deriveWebTailorReadiness(profile: TailorProfile | null | undefined): WebTailorReadiness {
  const profileReleased = profile?.is_live === true
  const profileCompleted = profile?.profile_completed === true || profileReleased
  const idStatus = profile?.id_verification_status ?? 'NOT_SUBMITTED'
  const identityVerified = isVerifiedIdentityStatus(idStatus) || profile?.is_verified === true || profileReleased
  const needsReverification = profile?.payout_reverification_required === true
  const payoutReady = identityVerified && isPayoutReady(profile)

  if (!profileCompleted) {
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: false,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PROFILE_INCOMPLETE',
      title: 'Finish your tailor profile first',
      body: 'Your public profile, portfolio, and selling setup need to be complete before customers can discover you as a normal live business.',
      actionLabel: 'Complete profile',
      actionHref: '/account/profile' as Route,
      tone: 'warning',
    }
  }

  if (!identityVerified) {
    const pending = idStatus === 'PENDING'
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: false,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: pending ? 'IDENTITY_REVIEW_PENDING' : 'IDENTITY_VERIFICATION_REQUIRED',
      title: pending ? 'Identity review is in progress' : 'Identity verification is still needed',
      body: pending
        ? 'Your profile can finish review before paid work opens. Paid quotes and live shop publishing stay paused until identity review and payout setup are both complete.'
        : idStatus === 'REJECTED'
          ? 'Your verification needs attention before Drapeon can show you publicly or let you take paid work.'
          : 'Customers should not discover or pay an unverified tailor profile as if it were fully ready.',
      actionLabel: pending ? null : idStatus === 'REJECTED' ? 'Resubmit verification in app' : 'Finish verification in app',
      actionHref: null,
      tone: 'warning',
    }
  }

  if (!payoutReady) {
    const reconnect = needsReverification
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: true,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PAYOUT_SETUP_REQUIRED',
      title: profileReleased ? 'Live profile, checkout paused' : reconnect ? 'Reconnect your payout account' : 'Set up your payout account',
      body: profileReleased
        ? reconnect
          ? 'Your public profile is live, but payout details need review again before paid quotes, checkout, and earnings release continue.'
          : 'Customers can browse your public profile, but paid quotes, checkout, and earnings release stay paused until payout is verified.'
        : reconnect
          ? 'Your payout details changed or need review again. Reconnect your payout account before paid quotes, shop publishing, and earnings release continue.'
          : 'Set up your payout account before paid quotes and live shop items unlock.',
      actionLabel: reconnect ? 'Reconnect payout' : 'Set up payout',
      actionHref: '/account/payout' as Route,
      tone: 'warning',
    }
  }

  if (profile?.is_live !== true) {
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: true,
      canAcceptPaidOrders: true,
      canPublishPaidItems: true,
      code: null,
      title: 'You are payout-ready',
      body: 'Identity and payout checks look good. Review your storefront and go live when you are ready for standard paid work.',
      actionLabel: 'Review profile',
      actionHref: '/account/profile' as Route,
      tone: 'neutral',
    }
  }

  return {
    profileCompleted,
    identityVerified,
    payoutReady,
    publicDiscoveryReady: true,
    canAcceptPaidOrders: true,
    canPublishPaidItems: true,
    code: null,
    title: 'Live and payout-ready',
    body: 'You can accept standard paid work and publish paid items with your current setup.',
    actionLabel: null,
    actionHref: null,
    tone: 'success',
  }
}

const accountOrderSelect = `
  id, reference, order_kind, garment_type, item_title, item_size, garment_description, occasion, stage, delivery_method,
  delivery_address, recipient_name, recipient_phone,
  fabric_source, special_note, fabric_tracking, tracking_number, carrier, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos, customer_measurements_snapshot, quoted_amount, subtotal_amount, fulfillment_fee, shipping_amount,
  tax_amount, platform_fee_amount, total_amount, currency, quoted_currency, created_at, updated_at, deadline,
  quoted_completion_date, customer_id, tailor_id, tailor_profile_id, seller_item_id, payment_provider,
  fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
  consultation_fee, video_call_url, escrow_released, auto_release_at, collection_code, collection_code_expiry, collection_code_used,
  tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location)
`

async function hydrateOrderCustomerProfiles(
  supabase: ReturnType<typeof createClient>,
  orders: AccountOrder[],
): Promise<AccountOrder[]> {
  const customerIds = uniqueValues(orders.map((order) => order.customer_id))
  if (customerIds.length === 0) return orders

  const { data, error } = await supabase
    .from('customer_profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', customerIds)

  if (error) return orders

  const profilesByUserId = new Map(
    ((data ?? []) as Array<{ user_id?: string | null; display_name?: string | null; avatar_url?: string | null }>)
      .filter((profile) => profile.user_id)
      .map((profile) => [
        profile.user_id!,
        {
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        } satisfies JoinedProfile,
      ]),
  )

  return orders.map((order) => ({
    ...order,
    customer_profiles: order.customer_id ? (profilesByUserId.get(order.customer_id) ?? order.customer_profiles ?? null) : order.customer_profiles ?? null,
  }))
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

function accountRoute(path: string): Route {
  return path as Route
}

function priceRange(tailor: TailorProfile) {
  if (typeof tailor.price_range_min !== 'number' && typeof tailor.price_range_max !== 'number') return 'Pricing set in quote'
  if (typeof tailor.price_range_min === 'number' && typeof tailor.price_range_max === 'number') {
    return `${formatMoney(tailor.price_range_min, tailor.currency)} - ${formatMoney(tailor.price_range_max, tailor.currency)}`
  }
  return formatMoney(tailor.price_range_min ?? tailor.price_range_max, tailor.currency)
}

function sizeGuideSummary(sizeGuide: Record<string, unknown> | null | undefined, sizes: string[] = []) {
  const guide = normalizeWebReadyMadeSizeGuide(sizeGuide, sizes.length > 0 ? sizes : Object.keys((sizeGuide?.sizeRanges as Record<string, unknown> | undefined) ?? {}))
  if (!hasReadyMadeSizeGuide(guide, sizes)) return 'Fit guidance is not available for this item yet.'
  const fields = guide.fields.slice(0, 4).map((field) => readyMadeFitFieldLabel(field).toLowerCase())
  const sizeCount = Object.keys(guide.sizeRanges).length
  const fieldCopy = fields.length > 0 ? fields.join(', ') : 'saved measurements'
  return `Fit ranges saved for ${fieldCopy} across ${sizeCount} size${sizeCount === 1 ? '' : 's'}.`
}

function readyMadeInventoryCount(item: SellerItem) {
  if (typeof item.inventory_quantity === 'number' && Number.isFinite(item.inventory_quantity)) {
    return Math.max(0, Math.floor(item.inventory_quantity))
  }

  const sizeInventory = item.size_inventory
  if (!sizeInventory || typeof sizeInventory !== 'object' || Array.isArray(sizeInventory)) return 0

  return Object.values(sizeInventory).reduce((sum, value) => {
    const parsedValue =
      typeof value === 'number'
        ? value
        : Number.parseInt(typeof value === 'string' ? value : '', 10)
    return sum + (Number.isFinite(parsedValue) ? Math.max(0, Math.floor(parsedValue)) : 0)
  }, 0)
}

function readyMadeSizeInventoryMap(item: SellerItem) {
  const sizes = stringList(item.sizes)
  const rawInventory = item.size_inventory && typeof item.size_inventory === 'object' && !Array.isArray(item.size_inventory)
    ? item.size_inventory
    : {}
  const fallbackInventoryQuantity =
    typeof item.inventory_quantity === 'number' && Number.isFinite(item.inventory_quantity)
      ? Math.max(0, Math.floor(item.inventory_quantity))
      : 0
  let assignedUnits = 0
  const nextInventory = Object.fromEntries(sizes.map((entry) => {
    const rawValue = rawInventory[entry]
    const parsedValue =
      typeof rawValue === 'number'
        ? Math.floor(rawValue)
        : Number.parseInt(typeof rawValue === 'string' ? rawValue : '', 10)
    const quantity = Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0
    assignedUnits += quantity
    return [entry, quantity]
  }))

  if (assignedUnits === 0 && fallbackInventoryQuantity > 0 && sizes[0]) {
    nextInventory[sizes[0]] = fallbackInventoryQuantity
  }

  return nextInventory
}

function readyMadeQuantityForSize(item: SellerItem, requestedSize: string | null | undefined) {
  const size = requestedSize?.trim()
  if (!size) return readyMadeInventoryCount(item)
  return Math.max(0, Math.floor(readyMadeSizeInventoryMap(item)[size] ?? 0))
}

function hasStructuredReadyMadeSizeGuide(sizeGuide: Record<string, unknown> | null | undefined, sizes: string[]) {
  return hasReadyMadeSizeGuide(normalizeWebReadyMadeSizeGuide(sizeGuide, sizes), sizes)
}

function readyMadeLiveListingIssues(input: {
  category: string | null | undefined
  description: string
  sizes: string[]
  photoCount: number
  inventoryQuantity: number
  hasSizeGuide: boolean
  requiresPickupAddress: boolean
}) {
  const issues: string[] = []

  if (!input.category?.trim()) {
    issues.push('Before this item can go live, choose a category so buyers know where it belongs.')
  }
  if (input.photoCount === 0) {
    issues.push('Before this item can go live, add at least one clear photo so buyers can see the piece.')
  }
  if (input.sizes.length === 0) {
    issues.push('Before this item can go live, add at least one size. Use One size if that is how you sell it.')
  }
  if (!input.hasSizeGuide) {
    issues.push('Before this item can go live, add at least one fit-guide range so buyers can see what each size means and Drapeon can recommend the right fit.')
  }
  if (input.description.trim().length < 24) {
    issues.push('Before this item can go live, add a fuller description. Aim for 1 or 2 sentences on the style, fit, fabric, or occasion so buyers understand the piece.')
  }
  if (input.inventoryQuantity < 1) {
    issues.push('Before this item can go live, add at least 1 unit to at least one size so buyers can actually order it.')
  }
  if (input.requiresPickupAddress) {
    issues.push('Before pickup items can go live, add your private pickup address in Profile.')
  }

  return issues
}

function isReadyMadeBuyableOnWeb(item: SellerItem, tailor: JoinedProfile | null) {
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  return (
    item.is_live === true &&
    tailor?.is_live === true &&
    tailor?.shop_paused !== true &&
    !['SOLD_OUT', 'HIDDEN'].includes(stockStatus) &&
    readyMadeInventoryCount(item) > 0
  )
}

function canStartCustomBriefOnWeb(tailor: TailorProfile, userId: string | null) {
  return (
    tailor.is_live === true &&
    tailor.supports_custom_orders === true &&
    tailor.accepts_custom_orders_now !== false &&
    tailor.availability !== 'FULLY_BOOKED' &&
    tailor.user_id !== userId
  )
}

function customBriefUnavailableLabel(tailor: TailorProfile, userId: string | null) {
  if (tailor.user_id === userId) return 'Your tailor profile'
  if (tailor.accepts_custom_orders_now === false) return 'Custom orders paused'
  if (tailor.availability === 'FULLY_BOOKED') return 'Fully booked'
  if (tailor.is_live !== true || tailor.supports_custom_orders !== true) return 'Custom orders unavailable'
  return 'Custom orders unavailable'
}

function readyMadeUnavailableLabel(item: SellerItem, tailor: JoinedProfile | null) {
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  if (tailor?.is_live !== true) return 'Seller unavailable'
  if (tailor?.shop_paused === true) return 'Shop paused'
  if (item.is_live !== true || stockStatus === 'HIDDEN') return 'Unavailable'
  if (stockStatus === 'SOLD_OUT' || readyMadeInventoryCount(item) <= 0) return 'Sold out'
  return 'Unavailable'
}

function stockCopy(item: SellerItem) {
  const inventoryQuantity = readyMadeInventoryCount(item)
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  if (item.is_live !== true || stockStatus === 'HIDDEN') return 'No longer available'
  if (stockStatus === 'SOLD_OUT' || inventoryQuantity <= 0) return 'Sold out'
  if (inventoryQuantity === 1) return '1 left'
  if (inventoryQuantity > 1) {
    return `${inventoryQuantity} left`
  }
  return cleanLabel(item.stock_status, 'In stock')
}

function mailto(address: string, subject: string) {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

function rawErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null
}

function isMachineErrorCodeMessage(value: string) {
  const trimmed = value.trim()
  return /^[A-Z0-9_:-]+$/.test(trimmed) && !trimmed.includes(' ')
}

const GENERIC_SERVER_ERROR_MESSAGES = new Set([
  'database error',
  'internal error',
  'internal server error',
  'unauthorized',
  'forbidden',
  'not found',
])

function isGenericServerErrorMessage(value: string) {
  return GENERIC_SERVER_ERROR_MESSAGES.has(value.trim().toLowerCase())
}

function isValidationLeakMessage(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('validation error') ||
    normalized.includes('invalid discriminator') ||
    normalized.includes('expected ') ||
    normalized.includes('received ')
  )
}

function isDisplayableFunctionError(value: string) {
  return !isMachineErrorCodeMessage(value) && !isGenericServerErrorMessage(value) && !isValidationLeakMessage(value)
}

const CONNECTIVITY_ERROR_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'timed out',
  'connection lost',
  'offline',
  'internet connection appears to be offline',
]

function isLikelyConnectivityIssue(error: unknown) {
  const message = rawErrorMessage(error)?.toLowerCase() ?? ''
  return CONNECTIVITY_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

function friendlyActionError(error: unknown, fallback = 'That action could not finish right now. Please try again.') {
  if (isLikelyConnectivityIssue(error)) {
    return 'Connection looks weak. Your details are still here, so retry when the signal improves.'
  }
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown; error?: unknown }).message ?? (error as { error?: unknown }).error
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const message = candidate.replace(/^FunctionsHttpError:\s*/i, '').trim()
      if (isDisplayableFunctionError(message)) return message
    }
  }
  if (typeof error === 'string' && error.trim().length > 0 && isDisplayableFunctionError(error)) return error
  return fallback
}

async function functionHttpErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const context = (error as { context?: unknown }).context
  if (
    !context ||
    typeof context !== 'object' ||
    typeof (context as { clone?: unknown }).clone !== 'function'
  ) {
    return null
  }
  try {
    const text = await (context as Response).clone().text()
    if (!text.trim()) return null
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; code?: unknown }
      const message = typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : null
      const trimmed = message?.trim()
      return trimmed && isDisplayableFunctionError(trimmed) ? trimmed : null
    } catch {
      const trimmed = text.trim()
      return isDisplayableFunctionError(trimmed) ? trimmed : null
    }
  } catch {
    return null
  }
}

async function invokeAccountFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error((await functionHttpErrorMessage(error)) ?? friendlyActionError(error))
  const payload = (data ?? {}) as Record<string, unknown>
  const message = typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : null
  if (payload.error) throw new Error(message ?? 'That action could not finish right now. Please try again.')
  return payload as T
}

type ReauthProofPurpose = 'ACCOUNT_DELETION' | 'EMAIL_CHANGE' | 'PASSWORD_CHANGE' | 'PHONE_CHANGE' | 'PAYOUT_ACCOUNT_CHANGE'

async function issueWebReauthProof(password: string, purpose: ReauthProofPurpose) {
  const result = await invokeAccountFunction<{ proof?: string; expiresAt?: string }>('reauth-proof-action', {
    action: 'issue-proof',
    password,
    purpose,
  })
  if (!result.proof) throw new Error('Could not confirm your current password. Try again.')
  return result
}

async function ensureDefaultWishlistCollection(userId: string) {
  const supabase = createClient()
  const name = 'My Go-To Tailors'
  const { data: existing, error: existingError } = await supabase
    .from('wishlist_collections')
    .select('id, name')
    .eq('customer_id', userId)
    .eq('name', name)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as { id: string; name: string }

  const { data: created, error: createError } = await supabase
    .from('wishlist_collections')
    .insert({ customer_id: userId, name })
    .select('id, name')
    .single()

  if (createError) throw createError
  return created as { id: string; name: string }
}

async function saveTailorDirectly(userId: string, tailorProfileId: string) {
  const collection = await ensureDefaultWishlistCollection(userId)
  const supabase = createClient()
  const { error: itemError } = await supabase
    .from('wishlist_items')
    .insert({
      collection_id: collection.id,
      item_type: 'TAILOR',
      tailor_id: tailorProfileId,
    })

  if (itemError && (itemError as { code?: string }).code !== '23505') throw itemError
}

async function removeSavedTailorDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) throw collectionsError
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length > 0) {
    const { error: wishlistError } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('item_type', 'TAILOR')
      .eq('tailor_id', tailorProfileId)
      .in('collection_id', collectionIds)

    if (wishlistError) throw wishlistError
  }
}

async function isTailorSavedDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) return false
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length === 0) return false

  const { data, error } = await supabase
    .from('wishlist_items')
    .select('id')
    .eq('item_type', 'TAILOR')
    .eq('tailor_id', tailorProfileId)
    .in('collection_id', collectionIds)
    .limit(1)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}

function assertNoContactLeak(value: string, fallback?: string) {
  const filtered = filterContactInfo(value)
  if (filtered.blocked) {
    return fallback ?? filtered.userMessage
  }
  return null
}

function splitList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseMinorUnits(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const amount = Number.parseFloat(cleaned)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function minorUnitsInput(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

const WEB_GARMENT_TYPES = [
  'Agbada',
  'Kaftan',
  'Senator / Native set',
  'Iro and Buba',
  'Ankara dress',
  'Ankara co-ord',
  'Suit',
  'Dress shirt',
  'Wedding gown',
  'Evening gown',
  'Abaya',
  'Uniform',
  'Other',
]

const WEB_OCCASION_OPTIONS = [
  'Wedding',
  'Birthday',
  'Event',
  'Everyday',
  'Corporate / work',
  'Naming ceremony',
  'Religious ceremony',
  'Graduation',
  'Other',
]

function defaultDeadlineInput() {
  return customOrderDefaultDeadline().toISOString().slice(0, 10)
}

function minimumDeadlineInput() {
  return customOrderMinimumDeliveryDate().toISOString().slice(0, 10)
}

function dateInputToIso(value: string) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function linesToUrls(value: string) {
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseInventoryFromSizes(sizes: string[], inventoryValue: string) {
  const fallback = Number.parseInt(inventoryValue, 10)
  const count = Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  return Object.fromEntries(sizes.map((size, index) => [size, index === 0 ? count : 0]))
}

function isPayableOrder(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    typeof order.fulfillment_fee === 'number' &&
    order.fulfillment_fee > 0 &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return true
  }
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  if (order.order_kind === 'READY_MADE') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  return false
}

function checkoutActionLabel(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return order.delivery_method === 'LOCAL_DELIVERY' ? 'Pay delivery fee' : 'Pay shipping fee'
  }
  if (order.stage === 'QUOTE_SENT') return 'Accept quote and pay'
  return 'Start secure checkout'
}

const ORDER_STAGE_VALUES: OrderStage[] = [
  'DRAFT',
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'IN_DISPUTE',
  'REFUNDED',
  'CANCELLED',
]

const ORDER_STAGE_SET = new Set<OrderStage>(ORDER_STAGE_VALUES)
const CUSTOM_TAILOR_STAGE_TARGETS: OrderStage[] = [
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

function asOrderStage(value: string | null | undefined): OrderStage | null {
  if (!value || !ORDER_STAGE_SET.has(value as OrderStage)) return null
  return value as OrderStage
}

function filterFulfillmentStage(order: AccountOrder, stage: OrderStage) {
  if (stage === 'READY_FOR_COLLECTION') return order.delivery_method === 'LOCAL_COLLECTION'
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return order.delivery_method !== 'LOCAL_COLLECTION'
  return true
}

function nextStageOptions(order: AccountOrder): OrderStage[] {
  const currentStage = asOrderStage(order.stage)
  if (!currentStage) return []

  if (order.order_kind === 'READY_MADE') {
    if (currentStage === 'CONFIRMED') return ['FINISHING']
    if (currentStage === 'FINISHING') {
      return (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'] as OrderStage[])
        .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
        .filter((stage) => filterFulfillmentStage(order, stage))
    }
    return []
  }

  return CUSTOM_TAILOR_STAGE_TARGETS
    .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
    .filter((stage) => filterFulfillmentStage(order, stage))
}

const CUSTOMER_STAGE_FLOW: OrderStage[] = [
  'PENDING_QUOTE',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
]

const NEEDS_ACTION_STAGES = new Set(['PENDING_QUOTE', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'IN_DISPUTE'])
const PRODUCTION_STAGES = new Set(['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'])
const DISPATCH_STAGES = new Set(['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY'])
const DONE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE', 'COMPLETED'])
const CLOSED_STAGES = new Set(['DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED'])
const PROBLEM_STAGES = new Set(['PAYMENT_FAILED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED'])

function stagePillClass(stage: string | null | undefined) {
  if (PROBLEM_STAGES.has(stage ?? '')) return 'border-rust bg-rust text-white'
  if (NEEDS_ACTION_STAGES.has(stage ?? '')) return 'border-rust/18 bg-rust/12 text-rust'
  if (PRODUCTION_STAGES.has(stage ?? '')) return 'border-needle/14 bg-needle/10 text-needle'
  if (DISPATCH_STAGES.has(stage ?? '')) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (DONE_STAGES.has(stage ?? '') || CLOSED_STAGES.has(stage ?? '')) return 'border-ink/8 bg-ink/6 text-ink/54'
  return 'border-ink/8 bg-white text-ink/62'
}

function StagePill({ stage, label }: { stage: string | null | undefined; label?: string }) {
  return (
    <StatusChip
      status={label ?? stage}
      fallback="In progress"
      className={`w-fit shrink-0 whitespace-nowrap ${stagePillClass(stage)}`}
    />
  )
}

function stageProgress(order: AccountOrder) {
  const current = asOrderStage(order.stage)
  if (!current) return 0
  if (CLOSED_STAGES.has(current)) return 100
  const index = CUSTOMER_STAGE_FLOW.indexOf(current)
  if (index < 0) return 12
  return Math.max(8, Math.round(((index + 1) / CUSTOMER_STAGE_FLOW.length) * 100))
}

function StageProgressBar({ order }: { order: AccountOrder }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
      <div className="h-full rounded-full bg-needle" style={{ width: `${stageProgress(order)}%` }} />
    </div>
  )
}

function StageTimeline({ order }: { order: AccountOrder }) {
  const current = asOrderStage(order.stage)
  const currentIndex = current ? CUSTOMER_STAGE_FLOW.indexOf(current) : -1
  return (
    <div className="rounded-[8px] border border-ink/6 bg-bone/55 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Stage progress</p>
        <StagePill stage={order.stage} />
      </div>
      <div className="mt-4">
        <StageProgressBar order={order} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {CUSTOMER_STAGE_FLOW.map((stage, index) => {
          const reached = currentIndex >= 0 && index <= currentIndex
          const active = current === stage
          return (
            <li
              key={stage}
              className={`rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                active
                  ? 'border-needle bg-needle text-white'
                  : reached
                    ? 'border-needle/16 bg-needle/8 text-needle'
                    : 'border-ink/6 bg-white/72 text-ink/44'
              }`}
            >
              {cleanLabel(stage)}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function orderActionCopy(order: AccountOrder, data: OrderActorData) {
  const stage = order.stage ?? ''
  if (isCustomerOrder(order, data)) {
    if (stage === 'QUOTE_SENT') return 'Review quote'
    if (stage === 'PAYMENT_PENDING' || stage === 'PAYMENT_FAILED') return 'Payment needed'
    if (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED'].includes(stage)) {
      return 'Check handoff'
    }
    if (stage === 'IN_DISPUTE') return 'Support active'
  }
  if (isTailorOrder(order, data)) {
    if (['PENDING_QUOTE', 'CONSULTATION'].includes(stage)) return 'Quote needed'
    if (stage === 'PAYMENT_FAILED') return 'Payment issue'
    if (stage === 'IN_DISPUTE') return 'Dispute active'
    if (nextStageOptions(order).length > 0) return 'Stage update'
  }
  return null
}

function workColumnFor(order: AccountOrder) {
  const stage = order.stage ?? ''
  if (NEEDS_ACTION_STAGES.has(stage)) return 'needs-action'
  if (PRODUCTION_STAGES.has(stage)) return 'production'
  if (DISPATCH_STAGES.has(stage)) return 'dispatched'
  return 'done'
}

function isCustomerOrder(order: AccountOrder, data: Pick<OrderActorData, 'userId'>) {
  return order.customer_id === data.userId
}

function isTailorOrder(order: AccountOrder, data: OrderActorData) {
  return Boolean(data.tailorProfile && (order.tailor_profile_id === data.tailorProfile.id || order.tailor_id === data.userId))
}

function datetimeLocalToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const MESSAGE_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MESSAGE_PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PORTFOLIO_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo
const PORTFOLIO_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo
const PORTFOLIO_VIDEO_CONTENT_TYPES = new Set<string>(ALLOWED_VIDEO_CONTENT_TYPES)
const READY_MADE_MEDIA_MAX_BYTES = MEDIA_LIMITS_BYTES.readyMadeItemVideo
const READY_MADE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.readyMadeItemVideo
const READY_MADE_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_READY_MADE_ITEM_CONTENT_TYPES)
const MESSAGE_MEDIA_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.messageVideo
const MESSAGE_MEDIA_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.messageVideo
const MESSAGE_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES)
const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo
const ORDER_EVIDENCE_CONTENT_TYPES = new Set<string>(ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES)
const REVIEW_MEDIA_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.reviewVideo
const REVIEW_MEDIA_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.reviewVideo
const REVIEW_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_REVIEW_MEDIA_CONTENT_TYPES)
const MAX_READY_MADE_MEDIA = 6
const MAX_REVIEW_MEDIA = 6
const MAX_WEB_FABRIC_REFERENCE_MEDIA = 4

function validateMessagePhoto(file: File) {
  if (!MESSAGE_PHOTO_CONTENT_TYPES.has(file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  if (file.size > MESSAGE_PHOTO_MAX_BYTES) {
    return 'Choose a photo under 10 MB.'
  }
  return null
}

function extensionBackedMediaContentType(file: File, allowedContentTypes: ReadonlySet<string>) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && allowedContentTypes.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

function isVideoContentType(contentType: string | null | undefined) {
  return typeof contentType === 'string' && contentType.startsWith('video/')
}

async function prepareOperationalMediaFile(
  file: File,
  options: {
    allowedContentTypes: ReadonlySet<string>
    videoMaxBytes: number
    videoMaxSeconds: number
  },
) {
  const contentType = extensionBackedMediaContentType(file, options.allowedContentTypes)
  if (!contentType || !options.allowedContentTypes.has(contentType)) {
    throw new Error('That file type is not supported here. Please choose a photo or video from your device.')
  }

  if (isVideoContentType(contentType)) {
    if (!ALLOWED_VIDEO_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) {
      throw new Error('Choose an MP4 or MOV video.')
    }
    if (file.size > options.videoMaxBytes) {
      throw new Error(`Choose videos under ${Math.round(options.videoMaxBytes / (1024 * 1024))} MB.`)
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > options.videoMaxSeconds) {
      throw new Error(OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MEDIA_LIMITS_BYTES.image) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

function prepareMessageMediaFile(file: File) {
  return prepareOperationalMediaFile(file, {
    allowedContentTypes: MESSAGE_MEDIA_CONTENT_TYPES,
    videoMaxBytes: MESSAGE_MEDIA_VIDEO_MAX_BYTES,
    videoMaxSeconds: MESSAGE_MEDIA_VIDEO_MAX_SECONDS,
  })
}

function prepareOrderEvidenceFile(file: File) {
  return prepareOperationalMediaFile(file, {
    allowedContentTypes: ORDER_EVIDENCE_CONTENT_TYPES,
    videoMaxBytes: ORDER_EVIDENCE_VIDEO_MAX_BYTES,
    videoMaxSeconds: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
  })
}

async function prepareReviewMediaFile(file: File) {
  const contentType = extensionBackedMediaContentType(file, REVIEW_MEDIA_CONTENT_TYPES)
  if (!contentType || !REVIEW_MEDIA_CONTENT_TYPES.has(contentType)) {
    throw new Error('That file type is not supported here. Please choose a photo or video from your device.')
  }

  if (isVideoContentType(contentType)) {
    if (file.size > REVIEW_MEDIA_VIDEO_MAX_BYTES) {
      throw new Error(`Choose videos under ${Math.round(REVIEW_MEDIA_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`)
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > REVIEW_MEDIA_VIDEO_MAX_SECONDS) {
      throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MEDIA_LIMITS_BYTES.image) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

function portfolioVideoContentType(file: File) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && PORTFOLIO_VIDEO_CONTENT_TYPES.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

function readyMadeMediaContentType(file: File) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && READY_MADE_MEDIA_CONTENT_TYPES.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

async function portfolioVideoDuration(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.preload = 'metadata'
    return await new Promise<number>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video.duration)
      video.onerror = () => reject(new Error('The video could not be read.'))
      video.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function preparePortfolioVideoFile(file: File) {
  const contentType = portfolioVideoContentType(file)
  if (!contentType || !PORTFOLIO_VIDEO_CONTENT_TYPES.has(contentType)) {
    throw new Error('Choose an MP4 or MOV video.')
  }
  if (file.size > PORTFOLIO_VIDEO_MAX_BYTES) {
    throw new Error(`Choose a portfolio video under ${Math.round(PORTFOLIO_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`)
  }

  const duration = await portfolioVideoDuration(file)
  if (Number.isFinite(duration) && duration > PORTFOLIO_VIDEO_MAX_SECONDS) {
    throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
  }

  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  })
}

async function prepareReadyMadeMediaFile(file: File) {
  const contentType = readyMadeMediaContentType(file)
  if (!contentType || !READY_MADE_MEDIA_CONTENT_TYPES.has(contentType)) {
    throw new Error('That file type is not supported here. Please choose a photo or video from your device.')
  }

  if (contentType.startsWith('video/')) {
    if (file.size > READY_MADE_MEDIA_MAX_BYTES) {
      throw new Error(`Choose videos under ${Math.round(READY_MADE_MEDIA_MAX_BYTES / (1024 * 1024))} MB.`)
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > READY_MADE_VIDEO_MAX_SECONDS) {
      throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MESSAGE_PHOTO_MAX_BYTES) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

async function reencodeImageFile(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('The photo could not be prepared for upload.'))
      element.src = objectUrl
    })

    const maxDimension = 2400
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The photo could not be prepared for upload.')
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) resolve(nextBlob)
        else reject(new Error('The photo could not be prepared for upload.'))
      }, 'image/jpeg', 0.88)
    })
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'message-photo'}.jpg`
    return new File([blob], name, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function uploadPublicFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl
}

async function uploadPrivateFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return filePath
}

async function createMessageMediaSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage.from('message-media').createSignedUrl(storagePath, 3600)
  return data?.signedUrl ?? null
}

let stripeScriptPromise: Promise<void> | null = null

function stripePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ??
    ''
  ).trim()
}

function loadStripeScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Stripe checkout needs a browser.'))
  if (window.Stripe) return Promise.resolve()
  if (!stripeScriptPromise) {
    stripeScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Stripe could not load.')), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Stripe could not load.'))
      document.head.appendChild(script)
    })
  }
  return stripeScriptPromise
}

async function fetchAccountShellData(userId: string): Promise<AccountShellData> {
  const supabase = createClient()
  let warning: string | null = null

  const [accountRes, customerProfileRes, tailorProfileRes, pickupDetailsRes] = await Promise.all([
    supabase
      .from('users')
      .select('default_currency')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('customer_profiles')
      .select('user_id, display_name, avatar_url, measurements, unit_preference, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select(publicTailorProfileSelect)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_pickup_details')
      .select('user_id, pickup_address, pickup_instructions, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  let tailorProfile = tailorProfileRes.error ? null : ((tailorProfileRes.data ?? null) as TailorProfile | null)
  if (tailorProfileRes.error) {
    warning = warning ?? 'Tailor profile could not load. Refresh to retry.'
  }
  if (tailorProfile?.id) {
    const ownTailorProfileRes = await supabase
      .from('tailor_profiles')
      .select(ownTailorProfileSelect)
      .eq('user_id', userId)
      .maybeSingle()

    if (ownTailorProfileRes.error) {
      warning = warning ?? 'Payout status could not load. Refresh to retry.'
    } else if (ownTailorProfileRes.data) {
      tailorProfile = {
        ...tailorProfile,
        ...(ownTailorProfileRes.data as TailorProfile),
      }
    }
  }
  const pickupDetails = pickupDetailsRes.error ? null : ((pickupDetailsRes.data ?? null) as TailorPickupDetails | null)
  const orderFilter = tailorProfile?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfile.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  let activeOrderCount = 0
  let customerActiveOrderCount = 0
  let tailorActiveOrderCount = 0
  let unreadCount = 0
  let checkoutPendingCount = 0
  const ordersRes = await supabase
    .from('orders')
    .select('id, stage, order_kind, seller_item_id, customer_id, tailor_id, tailor_profile_id')
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  if (!ordersRes.error) {
    const orders = (ordersRes.data ?? []) as Array<{
      id: string
      stage: string | null
      order_kind: string | null
      seller_item_id: string | null
      customer_id: string | null
      tailor_id: string | null
      tailor_profile_id: string | null
    }>
    const activeOrders = orders.filter((order) => !isTerminalOrder(order as AccountOrder))
    const visibleCustomerActiveOrders = activeOrders.filter((order) => order.customer_id === userId && !isReadyMadeInquiryOrder(order))
    activeOrderCount = activeOrders.filter((order) => order.customer_id !== userId || !isReadyMadeInquiryOrder(order)).length
    customerActiveOrderCount = visibleCustomerActiveOrders.length
    tailorActiveOrderCount = activeOrders.filter((order) => (
      order.tailor_id === userId || Boolean(tailorProfile?.id && order.tailor_profile_id === tailorProfile.id)
    )).length
    checkoutPendingCount = orders.filter((order) => ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')).length

    const orderIds = orders.map((order) => order.id)
    if (orderIds.length > 0) {
      const messagesRes = await supabase
        .from('messages')
        .select('id, order_id, sender_id, read_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100)

      if (!messagesRes.error) {
        const messages = (messagesRes.data ?? []) as Array<{ sender_id: string | null; read_at: string | null }>
        unreadCount = messages.filter((message) => message.sender_id !== userId && !message.read_at).length
      }
    }
  }

  return {
    userId,
    accountCurrency: accountRes.error ? null : ((accountRes.data as { default_currency?: string | null } | null)?.default_currency ?? null),
    customerProfile: customerProfileRes.error ? null : ((customerProfileRes.data ?? null) as CustomerProfile | null),
    tailorProfile,
    pickupDetails,
    activeOrderCount,
    customerActiveOrderCount,
    tailorActiveOrderCount,
    unreadCount,
    checkoutPendingCount,
    payoutNeedsSetup: Boolean(tailorProfile && !isPayoutReady(tailorProfile)),
    warning,
  }
}

async function fetchMeasurementsSurfaceData(userId: string): Promise<MeasurementsSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [measurementProfilesRes, measurementScansRes] = await Promise.all([
    supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at')
      .eq('customer_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase
      .from('measurement_scans')
      .select('id, capture_method, status, confidence_overall, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  if (measurementProfilesRes.error || measurementScansRes.error) {
    warning = 'Measurement records could not load. Refresh to retry.'
  }

  return {
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    measurementScans: measurementScansRes.error ? [] : ((measurementScansRes.data ?? []) as MeasurementScan[]),
    warning,
  }
}

async function fetchExploreSurfaceData(userId: string): Promise<ExploreSurfaceData> {
  void userId
  const supabase = createClient()
  let warning: string | null = null

  const exploreTailorsRes = await supabase
    .from('tailor_profiles')
    .select(publicTailorProfileSelect)
    .eq('is_live', true)
    .order('avg_rating', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(24)

  if (exploreTailorsRes.error) {
    warning = 'Explore records could not load. Refresh to retry.'
  }

  return {
    exploreTailors: exploreTailorsRes.error ? [] : ((exploreTailorsRes.data ?? []) as TailorProfile[]),
    exploreItems: [],
    warning,
  }
}

async function fetchOrdersSurfaceData(userId: string, tailorProfileId?: string | null): Promise<OrdersSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Order history could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  let messages: AccountMessage[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('messages')
        .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (paymentsRes.error || messagesRes.error) {
      warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
      messages = (messagesRes.data ?? []) as AccountMessage[]
    }
  }

  return {
    orders,
    payments,
    messages,
    warning,
  }
}

async function fetchOrderDetailSurfaceData(
  userId: string,
  orderId?: string,
  tailorProfileId?: string | null,
): Promise<OrderDetailSurfaceData> {
  if (!orderId) return emptyOrderDetailSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const orderRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('id', orderId)
    .or(orderFilter)
    .maybeSingle()

  const order = orderRes.error || !orderRes.data
    ? null
    : (await hydrateOrderCustomerProfiles(supabase, [orderRes.data as AccountOrder]))[0] ?? null
  if (orderRes.error) {
    warning = 'Order detail could not load. Refresh to retry.'
  }
  if (!order) {
    return {
      ...emptyOrderDetailSurfaceData,
      warning,
    }
  }

  const [paymentsRes, messagesRes, stageUpdatesRes, productionEvidenceRes, materialAdvancesRes, customOrderDetailRes, reviewsRes] = await Promise.all([
    supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('messages')
      .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_stage_updates')
      .select('id, order_id, stage, note, photo_url, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_production_evidence')
      .select('id, order_id, stage_key, note, photo_urls, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_material_advances')
      .select('id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, receipt_url, receipt_note, customer_response_note, payment_provider, provider_checkout_url, payment_id, created_at, updated_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('custom_order_details')
      .select('order_id, garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, fabric_approval_required, fabric_approval_status, fabric_approval_requested_at, fabric_approved_at, fabric_changes_requested_at, shipping_preference, delivery_instructions, target_delivery_date')
      .eq('order_id', order.id)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, order_id, rating, created_at')
      .eq('order_id', order.id)
      .limit(80),
  ])

  if (paymentsRes.error || messagesRes.error || stageUpdatesRes.error || productionEvidenceRes.error || materialAdvancesRes.error || customOrderDetailRes.error || reviewsRes.error) {
    warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
  }

  return {
    order,
    payments: paymentsRes.error ? [] : ((paymentsRes.data ?? []) as AccountPayment[]),
    messages: messagesRes.error ? [] : ((messagesRes.data ?? []) as AccountMessage[]),
    stageUpdates: stageUpdatesRes.error ? [] : ((stageUpdatesRes.data ?? []) as StageUpdate[]),
    productionEvidence: productionEvidenceRes.error ? [] : ((productionEvidenceRes.data ?? []) as ProductionEvidence[]),
    materialAdvances: materialAdvancesRes.error ? [] : ((materialAdvancesRes.data ?? []) as MaterialAdvance[]),
    customOrderDetail: customOrderDetailRes.error ? null : ((customOrderDetailRes.data ?? null) as CustomOrderDetail | null),
    reviews: reviewsRes.error ? [] : ((reviewsRes.data ?? []) as AccountReview[]),
    warning,
  }
}

async function fetchSupportSurfaceData(userId: string, tailorProfileId?: string | null): Promise<SupportSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(12)

  if (ordersRes.error) {
    warning = 'Support order context could not load. Refresh to retry.'
  }

  return {
    orders: ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

async function fetchShopSurfaceData(userId: string, tailorProfileId?: string | null): Promise<ShopSurfaceData> {
  void userId
  const supabase = createClient()

  if (tailorProfileId) {
    const sellerItemsRes = await supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30)

    return {
      sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
      exploreItems: [],
      warning: sellerItemsRes.error ? 'Shop records could not load. Refresh to retry.' : null,
    }
  }

  const exploreItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('is_live', true)
    .neq('stock_status', 'SOLD_OUT')
    .neq('stock_status', 'HIDDEN')
    .order('updated_at', { ascending: false })
    .limit(18)

  return {
    sellerItems: [],
    exploreItems: exploreItemsRes.error ? [] : ((exploreItemsRes.data ?? []) as SellerItem[]),
    warning: exploreItemsRes.error ? 'Ready-made pieces could not load. Refresh to retry.' : null,
  }
}

async function fetchWorkSurfaceData(userId: string, tailorProfileId?: string | null): Promise<WorkSurfaceData> {
  if (!tailorProfileId) return emptyWorkSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Work queue could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Work payment state could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }
  }

  const sellerItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('tailor_profile_id', tailorProfileId)
    .order('updated_at', { ascending: false })
    .limit(30)

  if (sellerItemsRes.error) {
    warning = warning ?? 'Shop records could not load. Refresh to retry.'
  }

  return {
    orders,
    payments,
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    warning,
  }
}

async function fetchBriefSurfaceData(userId: string, tailorId?: string): Promise<BriefSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const [tailorRes, measurementProfilesRes] = await Promise.all([
    tailorId
      ? supabase
          .from('tailor_profiles')
          .select(publicTailorProfileSelect)
          .eq('id', tailorId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at')
      .eq('customer_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

  if (tailorRes.error) {
    warning = 'Tailor profile could not load. Refresh to retry.'
  }
  if (measurementProfilesRes.error) {
    warning = warning ?? 'Measurement records could not load. Refresh to retry.'
  }

  return {
    tailor: tailorRes.error ? null : ((tailorRes.data ?? null) as TailorProfile | null),
    measurementProfiles: measurementProfilesRes.error ? [] : ((measurementProfilesRes.data ?? []) as MeasurementProfile[]),
    warning,
  }
}

async function fetchMessagesSurfaceData(userId: string, tailorProfileId?: string | null): Promise<MessagesSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(
      `
        id, reference, order_kind, garment_type, item_title, item_size, stage, total_amount, quoted_amount,
        currency, quoted_currency, special_note, video_call_url, created_at, updated_at, customer_id, tailor_id, tailor_profile_id,
        tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location)
      `,
    )
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Message threads could not load. Refresh to retry.'
  }

  let messages: AccountMessage[] = []
  let reactions: AccountMessageReaction[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const messagesRes = await supabase
      .from('messages')
      .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(100)

    if (messagesRes.error) {
      warning = warning ?? 'Messages could not load. Refresh to retry.'
    } else {
      messages = (messagesRes.data ?? []) as AccountMessage[]
    }

    const messageIds = messages.map((message) => message.id)
    if (messageIds.length > 0) {
      const reactionsRes = await supabase
        .from('message_reactions')
        .select('id, message_id, order_id, user_id, emoji, created_at')
        .in('message_id', messageIds)
        .order('created_at', { ascending: true })
        .limit(500)

      if (reactionsRes.error) {
        console.warn('[messages] Message reactions could not load.', reactionsRes.error.message)
      } else {
        reactions = (reactionsRes.data ?? []) as AccountMessageReaction[]
      }
    }
  }

  return {
    orders,
    messages,
    reactions,
    warning,
  }
}

async function fetchSavedSurfaceData(userId: string): Promise<SavedSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  let wishlistCollections: WishlistCollection[] = []
  let wishlistItems: WishlistItem[] = []
  let savedTailors: TailorProfile[] = []
  let savedItems: SellerItem[] = []

  const wishlistCollectionsRes = await supabase
    .from('wishlist_collections')
    .select('id, name, cover_image_url, item_count, created_at, updated_at')
    .eq('customer_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (wishlistCollectionsRes.error) {
    warning = 'Saved records could not load. Refresh to retry.'
  } else {
    wishlistCollections = (wishlistCollectionsRes.data ?? []) as WishlistCollection[]
    const collectionIds = wishlistCollections.map((collection) => collection.id)
    if (collectionIds.length > 0) {
      const wishlistItemsRes = await supabase
        .from('wishlist_items')
        .select('id, collection_id, item_type, tailor_id, ready_made_item_id, note, created_at')
        .in('collection_id', collectionIds)
        .order('created_at', { ascending: false })
        .limit(120)

      if (wishlistItemsRes.error) {
        warning = warning ?? 'Wishlist items could not load. Refresh to retry.'
      } else {
        wishlistItems = (wishlistItemsRes.data ?? []) as WishlistItem[]
        const savedTailorIds = uniqueValues(wishlistItems.map((item) => item.tailor_id))
        const savedItemIds = uniqueValues(wishlistItems.map((item) => item.ready_made_item_id))

        if (savedTailorIds.length > 0) {
          const savedTailorsRes = await supabase
            .from('tailor_profiles')
            .select(publicTailorProfileSelect)
            .in('id', savedTailorIds)
            .limit(80)
          if (savedTailorsRes.error) {
            warning = warning ?? 'Saved tailors could not load. Refresh to retry.'
          } else {
            savedTailors = (savedTailorsRes.data ?? []) as TailorProfile[]
          }
        }

        if (savedItemIds.length > 0) {
          const savedItemsRes = await supabase
            .from('seller_items')
            .select(sellerItemSelect)
            .in('id', savedItemIds)
            .limit(80)
          if (savedItemsRes.error) {
            warning = warning ?? 'Saved ready-made items could not load. Refresh to retry.'
          } else {
            savedItems = (savedItemsRes.data ?? []) as SellerItem[]
          }
        }
      }
    }
  }

  return {
    wishlistCollections,
    wishlistItems,
    savedTailors,
    savedItems,
    warning,
  }
}

async function fetchCheckoutSurfaceData(userId: string): Promise<CheckoutSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Checkout orders could not load. Refresh to retry.'
  }

  const orderIds = orders.map((order) => order.id)
  let payments: AccountPayment[] = []

  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Checkout payment records could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }
  }

  return {
    orders,
    payments,
    warning,
  }
}

async function fetchEarningsSurfaceData(userId: string, tailorProfileId?: string | null): Promise<EarningsSurfaceData> {
  if (!tailorProfileId) return emptyEarningsSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const [payoutsRes, ordersRes] = await Promise.all([
    supabase
      .from('payouts')
      .select('id, tailor_profile_id, amount, currency, provider, status, provider_payout_id, blocked_reason, order_id, initiated_at, completed_at, failed_at, processed_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('initiated_at', { ascending: false, nullsFirst: false })
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(80),
    supabase
      .from('orders')
      .select(accountOrderSelect)
      .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (payoutsRes.error) {
    warning = 'Payout records could not load. Refresh to retry.'
  }
  if (ordersRes.error) {
    warning = warning ?? 'Payout order context could not load. Refresh to retry.'
  }

  return {
    payouts: payoutsRes.error ? [] : ((payoutsRes.data ?? []) as AccountPayout[]),
    orders: ordersRes.error ? [] : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

async function fetchProfileSurfaceData(tailorProfileId?: string | null): Promise<ProfileSurfaceData> {
  if (!tailorProfileId) return emptyProfileSurfaceData

  const supabase = createClient()
  const [sellerItemsRes, portfolioItemsRes] = await Promise.all([
    supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30),
    supabase
      .from('portfolio_items')
      .select('id, image_url, title, description, category, sort_order, created_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('sort_order', { ascending: true })
      .limit(20),
  ])

  let warning: string | null = null
  if (sellerItemsRes.error) {
    warning = 'Shop records could not load. Refresh to retry.'
  }
  if (portfolioItemsRes.error) {
    warning = warning ?? 'Portfolio records could not load. Refresh to retry.'
  }

  return {
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    portfolioItems: portfolioItemsRes.error ? [] : ((portfolioItemsRes.data ?? []) as PortfolioItem[]),
    warning,
  }
}

async function fetchSettingsSurfaceData(userId: string, tailorProfileId?: string | null): Promise<SettingsSurfaceData> {
  const supabase = createClient()
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select('currency')
    .or(orderFilter)
    .not('currency', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(3)

  return {
    orderCurrencies: ordersRes.error
      ? []
      : uniqueValues((ordersRes.data ?? []).map((order) => (order as { currency?: string | null }).currency)),
    warning: ordersRes.error ? 'Settings order context could not load. Refresh to retry.' : null,
  }
}

async function fetchTailorDetailSurfaceData(userId: string, tailorId?: string): Promise<TailorDetailSurfaceData> {
  if (!tailorId) return emptyTailorDetailSurfaceData

  const supabase = createClient()
  const [tailorRes, readyMadeRes, tailorReviewsRes, portfolioItemsRes, isSaved] = await Promise.all([
    supabase
      .from('tailor_profiles')
      .select(publicTailorProfileSelect)
      .eq('id', tailorId)
      .maybeSingle(),
    supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorId)
      .order('updated_at', { ascending: false })
      .limit(18),
    supabase
      .from('reviews')
      .select('id, tailor_profile_id, rating, body, tags, media_urls, reviewer_name, tailor_response, created_at, published_at')
      .eq('tailor_profile_id', tailorId)
      .not('published_at', 'is', null)
      .eq('flagged', false)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('portfolio_items')
      .select('image_url')
      .eq('tailor_profile_id', tailorId)
      .order('sort_order', { ascending: true })
      .limit(20),
    isTailorSavedDirectly(userId, tailorId),
  ])

  let warning: string | null = null
  if (tailorRes.error) {
    warning = 'Tailor profile could not load. Refresh to retry.'
  }
  if (readyMadeRes.error) {
    warning = warning ?? 'Ready-made pieces could not load. Refresh to retry.'
  }
  if (tailorReviewsRes.error) {
    warning = warning ?? 'Tailor reviews could not load. Refresh to retry.'
  }
  if (portfolioItemsRes.error) {
    warning = warning ?? 'Portfolio records could not load. Refresh to retry.'
  }

  const tailor = tailorRes.error ? null : ((tailorRes.data ?? null) as TailorProfile | null)
  if (tailor && !portfolioItemsRes.error) {
    const portfolioItemUrls = ((portfolioItemsRes.data ?? []) as Array<{ image_url?: string | null }>)
      .map((item) => item.image_url)
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    tailor.portfolio_photo_urls = uniqueValues([...stringList(tailor.portfolio_photo_urls), ...portfolioItemUrls])
  }

  return {
    tailor,
    readyMade: readyMadeRes.error ? [] : ((readyMadeRes.data ?? []) as SellerItem[]),
    tailorReviews: tailorReviewsRes.error ? [] : ((tailorReviewsRes.data ?? []) as TailorReview[]),
    isSaved,
    warning,
  }
}

async function fetchItemDetailSurfaceData(itemId?: string): Promise<ItemDetailSurfaceData> {
  if (!itemId) return emptyItemDetailSurfaceData

  const supabase = createClient()
  const itemRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('id', itemId)
    .maybeSingle()

  return {
    item: itemRes.error ? null : ((itemRes.data ?? null) as SellerItem | null),
    warning: itemRes.error ? 'Ready-made item could not load. Refresh to retry.' : null,
  }
}

type AccountNavIcon =
  | 'briefcase'
  | 'card'
  | 'heart'
  | 'help'
  | 'logout'
  | 'message'
  | 'orders'
  | 'profile'
  | 'ruler'
  | 'search'
  | 'settings'
  | 'wallet'

function AccountNavGlyph({ name }: { name: AccountNavIcon }) {
  const icons: Record<AccountNavIcon, LucideIcon> = {
    briefcase: Briefcase,
    card: ShoppingBag,
    heart: Heart,
    help: CircleHelp,
    logout: LogOut,
    message: MessageCircle,
    orders: ClipboardList,
    profile: UserRound,
    ruler: Ruler,
    search: Search,
    settings: Settings,
    wallet: WalletCards,
  }
  const Icon = icons[name]
  return <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
}

function AccountIdentityCard({
  session,
  shellData,
  signingOut,
  onSignOut,
  collapsed = false,
}: {
  session: Session
  shellData: AccountShellData
  signingOut: boolean
  onSignOut: () => void
  collapsed?: boolean
}) {
  const [signOutPending, setSignOutPending] = useState(false)
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function requestSignOut() {
    if (signingOut) return
    if (signOutPending) {
      if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current)
      setSignOutPending(false)
      onSignOut()
      return
    }
    setSignOutPending(true)
    signOutTimerRef.current = setTimeout(() => setSignOutPending(false), 3000)
  }

  function cancelSignOut() {
    if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current)
    setSignOutPending(false)
  }

  const email = session.user.email ?? ''
  const metadata = session.user.user_metadata ?? {}
  const metadataName = typeof metadata.display_name === 'string' ? metadata.display_name : null
  const isTailorRole = !!shellData.tailorProfile
  const customerName = shellData.customerProfile?.display_name ?? null
  const tailorName = shellData.tailorProfile?.business_name || shellData.tailorProfile?.display_name || null
  const displayName = safeEntityName(
    isTailorRole
      ? (tailorName || customerName || metadataName)
      : (customerName || tailorName || metadataName),
    email ? (email.split('@')[0] ?? 'Drapeon') : 'Drapeon',
  )
  const avatarUrl = safeMediaUrl(
    isTailorRole
      ? (shellData.tailorProfile?.avatar_url ?? shellData.customerProfile?.avatar_url)
      : (shellData.customerProfile?.avatar_url ?? shellData.tailorProfile?.avatar_url),
    'avatars',
  )

  return (
    <div className={collapsed ? 'border-t border-white/10 pt-4' : 'border-t border-white/10 px-2 pt-4'}>
      {/* Avatar — always links to settings */}
      <Link
        href="/account/settings"
        title="Account settings"
        className={collapsed ? 'flex justify-center' : 'flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-white/8'}
      >
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-sm font-semibold text-white ring-2 ring-white/14 transition group-hover:ring-white/28">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            initialsForName(displayName)
          )}
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{displayName}</p>
            {email ? <p className="mt-0.5 truncate text-xs text-white/56">{email}</p> : null}
          </div>
        ) : null}
      </Link>
      {/* Sign out — two-tap confirmation */}
      <div className={collapsed ? 'mx-auto mt-2 flex flex-col items-center gap-1' : 'mt-2 grid gap-1'}>
        <button
          type="button"
          onClick={requestSignOut}
          disabled={signingOut}
          title={signingOut ? 'Signing out' : signOutPending ? 'Tap again to confirm' : 'Sign out'}
          className={
            collapsed
              ? `grid size-11 place-items-center rounded-[8px] border transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  signOutPending
                    ? 'border-rust/40 bg-rust/20 text-rust'
                    : 'border-white/28 bg-white/14 text-white hover:border-white/40 hover:bg-white/20'
                }`
              : `inline-flex w-full items-center gap-3 rounded-[8px] border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-white/30 ${
                  signOutPending
                    ? 'border-rust/30 bg-rust/14 text-rust'
                    : 'border-white/16 bg-white/8 text-white/80 hover:border-white/28 hover:bg-white/14 hover:text-white'
                }`
          }
        >
          <AccountNavGlyph name="logout" />
          {collapsed
            ? <span className="sr-only">{signingOut ? 'Signing out...' : signOutPending ? 'Confirm sign out' : 'Sign out'}</span>
            : <span>{signingOut ? 'Signing out...' : signOutPending ? 'Tap to confirm' : 'Sign out'}</span>}
        </button>
        {signOutPending && !collapsed ? (
          <button
            type="button"
            onClick={cancelSignOut}
            className="w-full rounded-[8px] py-1 text-xs font-semibold text-white/44 transition hover:text-white/70"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AccountRouteShell({
  session,
  data,
  shellData,
  surface,
  children,
}: {
  session: Session
  data: AccountBaseData
  shellData: AccountShellData
  surface: AccountSurface
  children: ReactNode
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const hasTailorWorkspace = !!shellData.tailorProfile
  const tailorSurfaceCopy: Partial<Record<AccountSurface, { eyebrow: string; title: string; body: string }>> = {
    orders: {
      eyebrow: 'Order pipeline',
      title: 'Active, completed, and all orders.',
      body: 'Pending quotes and production orders stay at the top. Search and filter to find any order in your history.',
    },
    shop: {
      eyebrow: 'Your shop',
      title: 'Manage your ready-made catalogue.',
      body: 'Control item visibility, stock, pricing, and sizing. Published items appear to customers immediately.',
    },
    messages: {
      eyebrow: 'Messages',
      title: 'Order conversations with customers.',
      body: 'Every thread is tied to a live order. Reply here or open the app to send photos and updates.',
    },
    earnings: {
      eyebrow: 'Earnings',
      title: 'Pending, blocked, and paid — at a glance.',
      body: 'Payout records tied to each order. Money movement follows provider checks and handoff windows.',
    },
  }
  const copy = (hasTailorWorkspace ? tailorSurfaceCopy[surface] : undefined) ?? surfaceCopy[surface]
  const accountHomeHref = (hasTailorWorkspace ? '/account/work' : '/account/orders') as Route
  const customerActiveOrderCount = shellData.customerActiveOrderCount
  const tailorActiveOrderCount = shellData.tailorActiveOrderCount
  const unreadCount = shellData.unreadCount
  const checkoutPendingCount = shellData.checkoutPendingCount
  const payoutNeedsSetup = shellData.payoutNeedsSetup
  const isOrdersPath = pathname === '/account/orders' || Boolean(pathname?.startsWith('/account/orders/'))

  const groups: Array<{
    title: string
    items: Array<{ label: string; href: Route; icon: AccountNavIcon; badge?: string | null }>
  }> = hasTailorWorkspace
    ? [
        {
          title: 'Workspace',
          items: [
            { label: 'Dashboard', href: '/account/work' as Route, icon: 'briefcase' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
            { label: 'Orders', href: '/account/orders' as Route, icon: 'orders' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
            { label: 'Messages', href: '/account/messages' as Route, icon: 'message' as const, badge: unreadCount > 0 ? String(unreadCount) : null },
            { label: 'Shop', href: '/account/shop' as Route, icon: 'card' as const },
            { label: 'Earnings', href: '/account/earnings' as Route, icon: 'wallet' as const },
            { label: 'Payout', href: '/account/payout' as Route, icon: 'wallet' as const, badge: payoutNeedsSetup ? '!' : null },
            { label: 'Profile', href: '/account/profile' as Route, icon: 'profile' as const },
          ],
        },
        {
          title: 'Account',
          items: [
            { label: 'Settings', href: '/account/settings' as Route, icon: 'settings' as const },
            { label: 'Support', href: '/account/support' as Route, icon: 'help' as const },
          ],
        },
      ]
    : [
        {
          title: 'Buying',
          items: [
            { label: 'Explore', href: '/account/explore' as Route, icon: 'search' as const },
            { label: 'Marketplace', href: '/account/shop' as Route, icon: 'card' as const },
            { label: 'Saved', href: '/account/saved' as Route, icon: 'heart' as const },
            { label: 'Orders', href: '/account/orders' as Route, icon: 'orders' as const, badge: customerActiveOrderCount > 0 ? String(customerActiveOrderCount) : null },
            { label: 'Messages', href: '/account/messages' as Route, icon: 'message' as const, badge: unreadCount > 0 ? String(unreadCount) : null },
            { label: 'Measurements', href: '/account/measurements' as Route, icon: 'ruler' as const },
          ],
        },
        {
          title: 'Account',
          items: [
            { label: 'Settings', href: '/account/settings' as Route, icon: 'settings' as const },
            { label: 'Support', href: '/account/support' as Route, icon: 'help' as const },
          ],
        },
      ]

  function isActive(href: string) {
    if (!pathname) return false
    if (href === '/account/orders') return pathname === href || pathname.startsWith('/account/orders/')
    if (href === '/account/explore') return pathname === href || pathname.startsWith('/account/tailors/')
    if (href === '/account/shop') return pathname === href || pathname.startsWith('/account/items/')
    return pathname === href
  }

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setDrawerOpen(false)
    try {
      await signOutWebSession({
        reason: 'manual',
        redirectTo: '/sign-in?signed_out=1',
        scope: 'local',
      })
    } catch (error) {
      console.warn('[account-shell] Sign out failed.', error)
    }
    setSigningOut(false)
  }

  function renderNav(collapsed = false) {
    return (
      <nav aria-label="Account navigation" className={collapsed ? 'grid justify-items-center gap-2' : 'grid gap-2'}>
        {groups.map((group, groupIndex) => (
          <div key={group.title} className={collapsed ? 'grid w-full justify-items-center gap-2' : 'grid gap-2'}>
            {groupIndex > 0 ? <hr className={collapsed ? 'my-1 w-10 border-white/10' : 'my-2 border-white/10'} /> : null}
            {group.items.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  title={item.label}
                  className={
                    collapsed
                      ? active
                        ? 'relative grid size-11 place-items-center rounded-[8px] bg-needle text-white shadow-sm'
                        : 'relative grid size-11 place-items-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white'
                      : active
                        ? 'relative flex min-h-11 items-center justify-between gap-3 rounded-[8px] bg-needle px-3 py-2.5 text-sm font-semibold text-white shadow-sm'
                        : 'relative flex min-h-11 items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white'
                  }
                >
                  <span className={collapsed ? 'grid place-items-center' : 'flex min-w-0 items-center gap-3'}>
                    <AccountNavGlyph name={item.icon} />
                    {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                  </span>
                  {item.badge && !collapsed ? (
                    <span className={active ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white' : 'rounded-full bg-white/10 px-2 py-0.5 text-xs text-white'}>
                      {item.badge}
                    </span>
                  ) : null}
                  {item.badge && collapsed ? (
                    <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[#ef5b3a] px-1 text-center text-[0.62rem] font-semibold leading-4 text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    )
  }

  return (
    <main className="min-h-screen bg-ui-canvas">
      <div className="w-full px-4 py-4 sm:px-6 lg:px-0 lg:py-0 lg:pr-6">
        <div className="sticky top-2 z-30 rounded-[8px] border border-white/10 bg-[#171a18]/96 p-3 shadow-lg backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href={accountHomeHref} className="flex items-center gap-3 text-2xl font-semibold text-white">
              <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[8px]" />
              <span>Drapeon</span>
            </Link>
            <IconButton
              onClick={() => setDrawerOpen(true)}
              variant="ghost"
              className="border border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white"
              aria-expanded={drawerOpen}
              aria-controls="account-mobile-drawer"
              label="Open account menu"
            >
              <Menu />
            </IconButton>
          </div>
        </div>

        {drawerOpen ? (
          <div id="account-mobile-drawer" className="fixed inset-0 z-50 bg-ink/45 p-4 backdrop-blur-sm lg:hidden">
            <div className="flex max-h-full flex-col overflow-y-auto rounded-[8px] border border-white/10 bg-[#171a18] p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-4">
                <Link href={accountHomeHref} onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 text-2xl font-semibold text-white">
                  <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[8px]" />
                  <span>Drapeon</span>
                </Link>
                <IconButton
                  onClick={() => setDrawerOpen(false)}
                  variant="ghost"
                  className="border border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  label="Close account menu"
                >
                  <X />
                </IconButton>
              </div>
              <div className="mt-5">{renderNav(false)}</div>
              <div className="mt-5">
                <AccountIdentityCard
                  session={session}
                  shellData={shellData}
                  signingOut={signingOut}
                  onSignOut={() => {
                    void signOut()
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className={sidebarCollapsed ? 'grid gap-4 lg:min-h-screen lg:grid-cols-[5.5rem_minmax(0,1fr)] lg:gap-6' : 'grid gap-4 lg:min-h-screen lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6'}>
          <aside className={sidebarCollapsed ? 'sticky top-0 hidden h-screen border-r border-white/10 bg-[#171a18] p-3 lg:block' : 'sticky top-0 hidden h-screen border-r border-white/10 bg-[#171a18] p-4 lg:block'}>
            <div className="flex h-full flex-col">
              <IconButton
                onClick={() => setSidebarCollapsed((current) => !current)}
                size="icon-sm"
                variant="secondary"
                className="absolute -right-4 top-24 z-10 rounded-full shadow-md"
                label={sidebarCollapsed ? 'Expand account menu' : 'Collapse account menu'}
              >
                <ChevronLeft className={sidebarCollapsed ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </IconButton>
              <Link href={accountHomeHref} className={sidebarCollapsed ? 'flex justify-center' : 'flex items-center gap-3'}>
                <Image src="/icon-192.png" alt="" width={44} height={44} className="size-11 rounded-[8px]" />
                {sidebarCollapsed ? <span className="sr-only">Drapeon</span> : <span className="text-2xl font-semibold text-white">Drapeon</span>}
              </Link>
              <div className={sidebarCollapsed ? 'mt-8 flex-1 overflow-y-auto' : 'mt-8 flex-1 overflow-y-auto pr-1'}>{renderNav(sidebarCollapsed)}</div>
              <div className="mt-4">
                <AccountIdentityCard
                  session={session}
                  shellData={shellData}
                  signingOut={signingOut}
                  collapsed={sidebarCollapsed}
                  onSignOut={() => {
                    void signOut()
                  }}
                />
              </div>
            </div>
          </aside>

          <div className="min-w-0 lg:py-4">
            {surface !== 'messages' ? (
              <section className="py-3 lg:pt-0">
                <div className="app-surface p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[0.68rem] font-semibold uppercase text-needle/80">{copy.eyebrow}</p>
                      <h1 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-3xl">{copy.title}</h1>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">{copy.body}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {checkoutPendingCount > 0 ? (
                        <Button asChild variant="destructive" size="sm">
                          <Link href="/account/checkout">Pay {checkoutPendingCount > 1 ? `(${checkoutPendingCount})` : ''}</Link>
                        </Button>
                      ) : null}
                      {!isOrdersPath ? (
                        <Button asChild variant="secondary" size="sm">
                          <Link href="/account/orders"><ClipboardList /> Orders</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {data.warning ? (
                    <p className="mt-3 rounded-lg border border-rust/18 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
                      {data.warning}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

function AuthRequiredCard() {
  return (
    <main className="min-h-screen bg-ui-canvas">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="app-surface p-7">
          <p className="text-xs font-semibold uppercase text-needle/80">Account</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Sign in to continue.</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            Access your protected orders, messages, measurements, payments, and support.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg"><Link href="/sign-in">Sign in</Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/sign-up">Create account</Link></Button>
          </div>
        </div>
      </div>
    </main>
  )
}

function LoadingCard() {
  return (
    <main className="min-h-screen bg-ui-canvas">
      <p className="sr-only">Loading account.</p>
      <div className="animate-pulse">
        <div className="h-14 border-b border-ui-border bg-white" />
        <div className="mx-auto max-w-lg px-6 pt-8 flex flex-col gap-4">
          <div className="h-7 w-36 rounded-[8px] bg-ui-border" />
          <div className="h-4 w-52 rounded-[6px] bg-ui-border" />
          <div className="mt-2 h-28 rounded-[8px] bg-ui-border" />
          <div className="h-16 rounded-[8px] bg-ui-border" />
          <div className="h-16 rounded-[8px] bg-ui-border" />
          <div className="flex gap-3">
            <div className="h-20 flex-1 rounded-[8px] bg-ui-border" />
            <div className="h-20 flex-1 rounded-[8px] bg-ui-border" />
          </div>
        </div>
      </div>
    </main>
  )
}

type MutedVideoProps = {
  src: string
  className?: string
  ariaLabel?: string
  loop?: boolean
  autoPlay?: boolean
  controls?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  showMuteToggle?: boolean
}

function MutedVideo({
  src,
  className,
  ariaLabel,
  loop = true,
  autoPlay = true,
  controls = false,
  preload = 'metadata',
  showMuteToggle,
}: MutedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const shouldShowMuteToggle = showMuteToggle ?? controls
  const playbackSrc = isVideoMediaUrl(src) ? videoPosterFrameUrl(src) : src

  useEffect(() => {
    const node = videoRef.current
    if (!node) return
    node.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    const node = videoRef.current
    return () => {
      if (!node) return
      node.pause()
      node.removeAttribute('src')
      node.load()
    }
  }, [playbackSrc])

  useEffect(() => {
    function pauseWhenHidden() {
      if (document.visibilityState === 'hidden') videoRef.current?.pause()
    }

    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [])

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={playbackSrc}
        muted={isMuted}
        loop={loop}
        playsInline={true}
        autoPlay={autoPlay}
        controls={controls}
        preload={preload}
        className={className}
        aria-label={ariaLabel}
      />
      {shouldShowMuteToggle ? (
        <button
          type="button"
          onClick={() => setIsMuted((value) => !value)}
          className="absolute bottom-3 right-3 z-10 rounded-full bg-black/58 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/72"
          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
        >
          {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      ) : null}
    </div>
  )
}

function PhotoTile({ src, label }: { src: string | null; label: string }) {
  const safeSrc = safeMediaUrl(src)
  if (!safeSrc) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[8px] bg-needle/10 text-sm font-semibold text-needle">
        {label}
      </div>
    )
  }
  if (isVideoMediaUrl(safeSrc)) {
    return (
      <MutedVideo
        src={safeSrc}
        className="aspect-[4/3] w-full rounded-[8px] bg-ink object-cover"
        ariaLabel={label}
        showMuteToggle={false}
      />
    )
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[8px]">
      <Image
        src={safeSrc}
        alt={label}
        fill
        sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 90vw"
        className="object-cover"
        unoptimized
      />
    </div>
  )
}


type SortableMediaEntry = {
  id: string
  url: string
  label: string
}

function moveMediaEntry(entries: SortableMediaEntry[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= entries.length ||
    toIndex >= entries.length ||
    fromIndex === toIndex
  ) {
    return entries
  }
  const next = [...entries]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return entries
  next.splice(toIndex, 0, item)
  return next
}

function SortableMediaGrid({
  entries,
  onReorder,
  onDelete,
  onInspect,
  renderActions,
  busy,
  imageClassName = 'object-cover',
}: {
  entries: SortableMediaEntry[]
  onReorder: (nextEntries: SortableMediaEntry[]) => void
  onDelete?: (index: number) => void
  onInspect?: (index: number) => void
  renderActions?: (entry: SortableMediaEntry, index: number) => ReactNode
  busy?: boolean
  imageClassName?: string
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  if (entries.length === 0) return null

  return (
    <div className="grid grid-cols-3 gap-3">
      {entries.map((entry, index) => {
        const safeSrc = safeMediaUrl(entry.url)
        const isCover = index === 0
        return (
          <article
            key={`${entry.id}-${index}`}
            draggable={!busy}
            onDragStart={(event) => {
              setDraggingIndex(index)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              const fromIndex = Number(event.dataTransfer.getData('text/plain'))
              setDraggingIndex(null)
              if (!Number.isFinite(fromIndex)) return
              onReorder(moveMediaEntry(entries, fromIndex, index))
            }}
            onDragEnd={() => setDraggingIndex(null)}
            className={`group relative overflow-hidden rounded-[8px] border bg-white shadow-sm transition ${
              draggingIndex === index ? 'border-needle opacity-70' : 'border-ink/8 hover:border-needle/30'
            }`}
          >
            <button
              type="button"
              onClick={() => onInspect?.(index)}
              className="relative block aspect-square w-full overflow-hidden bg-bone text-left"
            >
              {safeSrc && isVideoMediaUrl(safeSrc) ? (
                <MutedVideo
                  src={safeSrc}
                  className="h-full w-full object-cover"
                  ariaLabel={entry.label}
                  showMuteToggle={false}
                />
              ) : safeSrc ? (
                <Image
                  src={safeSrc}
                  alt={entry.label}
                  fill
                  sizes="(min-width: 1024px) 12vw, 30vw"
                  className={imageClassName}
                  unoptimized
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-needle">Media</span>
              )}
              {isCover ? (
                <span className="absolute left-2 top-2 rounded-full bg-needle px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white">
                  Cover
                </span>
              ) : null}
              <span className="absolute bottom-2 left-2 rounded-full bg-ink/72 px-2 py-1 text-[0.65rem] font-semibold text-white">
                {isVideoMediaUrl(safeSrc ?? '') ? 'Video' : 'Photo'} {index + 1}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2 p-2">
              {renderActions?.(entry, index)}
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(index)}
                  disabled={busy}
                  className="rounded-full border border-rust/20 bg-white px-3 py-1 text-xs font-semibold text-rust disabled:text-ink/35"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function MediaInspectionOverlay({
  entries,
  initialIndex,
  onClose,
}: {
  entries: SortableMediaEntry[]
  initialIndex: number
  onClose: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const activeEntry = entries[activeIndex] ?? entries[0] ?? null
  const safeSrc = safeMediaUrl(activeEntry?.url)


  if (!activeEntry || !safeSrc) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close media preview" />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[8px] border border-white/12 bg-ink shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/52">Media preview</p>
            <h3 className="mt-1 text-lg font-semibold">{activeEntry.label}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-2 text-sm font-semibold text-white">Close</button>
        </div>
        <div className="relative aspect-[4/3] max-h-[72vh] bg-black">
          {isVideoMediaUrl(safeSrc) ? (
            <MutedVideo
              src={safeSrc}
              controls
              autoPlay={false}
              loop={false}
              className="h-full w-full object-contain"
              ariaLabel={activeEntry.label}
              showMuteToggle
            />
          ) : (
            <Image src={safeSrc} alt={activeEntry.label} fill sizes="90vw" className="object-contain" unoptimized />
          )}
          {entries.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current - 1 + entries.length) % entries.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/88 px-3 py-2 text-sm font-semibold text-ink shadow"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current + 1) % entries.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/88 px-3 py-2 text-sm font-semibold text-ink shadow"
              >
                Next
              </button>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-center gap-1.5 px-4 py-3">
          {entries.map((entry, index) => (
            <button
              key={`${entry.id}-${index}-dot`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`h-1.5 rounded-full transition ${index === activeIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`}
              aria-label={`Show media ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function MediaSlideshow({ media, label }: { media: string[]; label: string }) {
  const safeMedia = media.map((src) => safeMediaUrl(src)).filter((src): src is string => !!src)
  const [activeIndex, setActiveIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const activeSrc = safeMedia[activeIndex] ?? null

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-[8px] border border-ink/8 bg-white">
        <PhotoTile src={activeSrc} label={label} />
      </div>
      {safeMedia.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {safeMedia.slice(0, expanded ? safeMedia.length : 5).map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={
                activeIndex === index
                  ? 'h-14 w-14 overflow-hidden rounded-lg border-2 border-needle bg-white'
                  : 'h-14 w-14 overflow-hidden rounded-lg border border-ink/10 bg-white opacity-75 transition hover:opacity-100'
              }
              aria-label={`Show ${label} ${index + 1}`}
            >
              <PhotoTile src={src} label={`${label} ${index + 1}`} />
            </button>
          ))}
          {safeMedia.length > 5 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex h-10 items-center rounded-full border border-ink/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-bone"
            >
              {expanded ? 'Show less' : `Show all ${safeMedia.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-ui-border bg-white p-4">
      <p className="text-xs font-semibold uppercase text-needle/72">{label}</p>
      <div className="mt-2 text-sm font-semibold text-ink">{value ?? 'Not set'}</div>
    </div>
  )
}

function dossierDisplayValue(value: string | null | undefined, fallback = 'Not set') {
  const safe = safeUserText(value, fallback)
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/u.test(safe) ? formatDatabaseEnumLabel(safe, fallback) : safe
}

function BriefDossierRowView({ row }: { row: BriefDossierRow }) {
  const label = <p className="text-[0.68rem] font-semibold uppercase text-needle/72">{row.label}</p>

  if (row.presentation === 'chips' && row.values?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <div className="mt-3 flex flex-wrap gap-2">
          {row.values.map((value) => (
            <span key={value} className="rounded-full bg-rust/8 px-3 py-1 text-xs font-semibold text-rust">
              {formatDatabaseEnumLabel(value, value)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (row.presentation === 'links' && row.hrefs?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <div className="mt-3 grid gap-2">
          {row.hrefs.map((href) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold text-needle underline-offset-4 hover:underline">
              {safeUserText(href, href)}
            </a>
          ))}
        </div>
      </div>
    )
  }

  if (row.presentation === 'media' && row.mediaUrls?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          {label}
          <p className="text-xs font-semibold text-ink/46">{row.value}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {row.mediaUrls.slice(0, 6).map((src, index) => {
            const safeSrc = safeMediaUrl(src)
            if (!safeSrc) return null
            const mediaLabel = `${row.label} ${index + 1}`
            return (
              <MediaViewerDialog key={`${safeSrc}-${index}`} src={safeSrc} kind={isVideoMediaUrl(safeSrc) ? 'video' : 'image'} title={mediaLabel}>
                <button type="button" className="cursor-zoom-in rounded-[8px] text-left transition-opacity hover:opacity-90">
                  <PhotoTile src={safeSrc} label={mediaLabel} />
                </button>
              </MediaViewerDialog>
            )
          })}
        </div>
      </div>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <p className="mt-2 whitespace-pre-line break-words text-sm font-semibold leading-6 text-ink">
          {dossierDisplayValue(row.value)}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white p-4 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)] sm:items-start">
      <p className="text-[0.68rem] font-semibold uppercase text-needle/72">{row.label}</p>
      <p className="break-words text-sm font-semibold leading-6 text-ink sm:text-right">{dossierDisplayValue(row.value)}</p>
    </div>
  )
}

function BriefDossierSectionCard({ section }: { section: BriefDossierSection }) {
  return (
    <section className="rounded-[8px] border border-ui-border bg-ui-muted/45 p-4">
      <div>
        <h3 className="text-xl text-ink">{section.title}</h3>
        {section.summary ? <p className="mt-1 text-sm leading-6 text-ink/58">{section.summary}</p> : null}
      </div>
      <div className="mt-4 grid gap-3">
        {section.rows.map((row) => <BriefDossierRowView key={row.id} row={row} />)}
      </div>
    </section>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-ui-border bg-white p-6 shadow-sm">
      <h2 className="text-2xl text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/66">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function ActionNotice({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null
  return (
    <p className={`rounded-[8px] px-4 py-3 text-sm leading-6 ${error ? 'border border-rust/20 bg-rust/8 text-ink' : 'border border-needle/14 bg-needle/8 text-needle'}`}>
      {error || success}
    </p>
  )
}

function DisclosurePanel({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details open={defaultOpen} className="group rounded-[8px] border border-ink/8 bg-white/84 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:hidden">
        <span>
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? <span className="mt-1 block text-xs leading-5 text-ink/56">{summary}</span> : null}
        </span>
        <span className="shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-needle group-open:hidden">
          Show
        </span>
        <span className="hidden shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-ink/52 group-open:inline-flex">
          Hide
        </span>
      </summary>
      <div className="border-t border-ink/6 px-4 py-4">
        {children}
      </div>
    </details>
  )
}

function StripeCardAuthorization({
  clientSecret,
  label,
  submitLabel,
  onConfirm,
  onDone,
}: {
  clientSecret: string
  label: string
  submitLabel: string
  onConfirm: (paymentIntentId: string) => Promise<void>
  onDone: () => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeJs | null>(null)
  const cardRef = useRef<StripeCardElement | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let mountedCard: StripeCardElement | null = null

    async function mountCard() {
      setReady(false)
      setError(null)
      const publishableKey = stripePublishableKey()
      if (!publishableKey) {
        setError('Stripe web checkout needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.')
        return
      }
      try {
        await loadStripeScript()
        if (!active || !window.Stripe || !mountRef.current) return
        const stripe = window.Stripe(publishableKey)
        if (!stripe) {
          setError('Stripe checkout could not initialize.')
          return
        }
        const elements = stripe.elements()
        const card = elements.create('card', {
          hidePostalCode: true,
          style: {
            base: {
              color: '#1d1d1b',
              fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '16px',
              '::placeholder': { color: '#8b8a83' },
            },
            invalid: { color: '#d9542f' },
          },
        })
        card.mount(mountRef.current)
        stripeRef.current = stripe
        cardRef.current = card
        mountedCard = card
        if (active) setReady(true)
      } catch (mountError) {
        if (active) setError(friendlyActionError(mountError, 'Stripe checkout could not load.'))
      }
    }

    void mountCard()

    return () => {
      active = false
      setReady(false)
      mountedCard?.unmount()
      mountedCard?.destroy?.()
      if (cardRef.current === mountedCard) cardRef.current = null
      stripeRef.current = null
    }
  }, [clientSecret])

  async function confirmCard() {
    setError(null)
    setSuccess(null)
    const stripe = stripeRef.current
    const card = cardRef.current
    if (!stripe || !card) {
      setError('Stripe checkout is still loading.')
      return
    }
    setBusy(true)
    try {
      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
      if (result.error) {
        setError(result.error.message ?? 'Card authorization failed. Check the card details and try again.')
        return
      }
      const paymentIntentId = result.paymentIntent?.id
      if (!paymentIntentId) {
        setError('Stripe authorized the card but did not return a payment reference.')
        return
      }
      await onConfirm(paymentIntentId)
      setSuccess('Payment confirmed. The order record is updating now.')
      onDone()
    } catch (confirmError) {
      setError(friendlyActionError(confirmError, 'Payment could not be confirmed. Refresh the order before trying again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/72">Stripe card</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{label}</h3>
      </div>
      <div ref={mountRef} className="min-h-12 rounded-full border border-ink/10 bg-bone px-4 py-3" />
      <ActionNotice error={error} success={success} />
      <button type="button" onClick={confirmCard} disabled={busy || !ready} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
        {busy ? 'Confirming...' : ready ? submitLabel : 'Loading Stripe...'}
      </button>
      <p className="text-xs leading-5 text-ink/52">Card details are handled by Stripe. Drapeon never sees or stores the card number.</p>
    </div>
  )
}

function CheckoutAction({ order, onRefresh }: { order: AccountOrder; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineArmed, setDeclineArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string
    paymentIntentId?: string | null
    amount?: number | null
    currency?: string | null
  } | null>(null)

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    setStripePayment(null)
    setSuccess('Preparing payment. Do not start another checkout while this finishes.')
    try {
      const result = await invokeAccountFunction<{
        ok?: boolean
        confirmed?: boolean
        alreadyPaid?: boolean
        provider?: string
        authorizationUrl?: string | null
        clientSecret?: string | null
        paymentIntentId?: string | null
        amount?: number
        currency?: string
      }>('payment-action', { action: 'prepare-payment', orderId: order.id })

      onRefresh()
      if (result.confirmed || result.alreadyPaid) {
        setSuccess('Payment is already confirmed on this order.')
        return
      }
      if (result.authorizationUrl) {
        setSuccess('Payment is ready. Redirecting to the secure provider checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.provider === 'STRIPE' && result.clientSecret) {
        setStripePayment({
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId ?? null,
          amount: result.amount ?? null,
          currency: result.currency ?? null,
        })
        setSuccess('Card payment is ready. Enter card details below; Drapeon will not create a duplicate charge.')
        return
      }
      setSuccess('Payment is prepared. Open the app if the provider window does not appear.')
    } catch (checkoutError) {
      setError(friendlyActionError(checkoutError, 'Payment could not start cleanly. Please refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setBusy(false)
    }
  }

  async function declineQuote() {
    if (order.order_kind !== 'CUSTOM' || order.stage !== 'QUOTE_SENT') return
    setError(null)
    setSuccess(null)
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this quote.')
      return
    }
    setDeclining(true)
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'decline-quote',
        orderId: order.id,
      })
      setDeclineArmed(false)
      setSuccess('Quote declined. This order is now closed.')
      onRefresh()
    } catch (declineError) {
      setError(friendlyActionError(declineError, 'Quote could not be declined. Refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setDeclining(false)
    }
  }

  if (!isPayableOrder(order)) {
    return (
      <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is not awaiting a customer payment right now.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <button
        type="button"
        onClick={handleCheckout}
        disabled={busy}
        className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
      >
        {busy ? 'Preparing checkout...' : checkoutActionLabel(order)}
      </button>
      {order.order_kind === 'CUSTOM' && order.stage === 'QUOTE_SENT' ? (
        <button
          type="button"
          onClick={() => { void declineQuote() }}
          disabled={declining || busy}
          className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
        >
          {declining ? 'Declining...' : declineArmed ? 'Confirm decline' : 'Decline quote'}
        </button>
      ) : null}
      {stripePayment ? (
        <StripeCardAuthorization
          clientSecret={stripePayment.clientSecret}
          label={formatMoney(
            stripePayment.amount ?? order.total_amount ?? order.quoted_amount,
            stripePayment.currency ?? order.currency ?? order.quoted_currency,
          )}
          submitLabel="Authorize card"
          onConfirm={async (paymentIntentId) => {
            await invokeAccountFunction('payment-action', {
              action: 'confirm-payment',
              orderId: order.id,
              paymentIntentId,
            })
          }}
          onDone={() => {
            setStripePayment(null)
            onRefresh()
          }}
        />
      ) : null}
      <p className="text-xs leading-5 text-ink/52">
        {order.stage === 'QUOTE_SENT'
          ? 'Accepting prepares secure payment and moves the quote into payment pending. Production starts only after payment succeeds.'
          : 'If checkout is already processing, Drapeon will reuse the current attempt instead of creating a duplicate charge.'}
      </p>
    </div>
  )
}

type CustomerOrderActionName =
  | 'confirm-measurements'
  | 'cancel-order'
  | 'request-cancellation-review'
  | 'request-delivery-review'
  | 'approve-style-alignment'
  | 'request-style-alignment-change'
  | 'approve-sourced-fabric'
  | 'request-sourced-fabric-change'
  | 'respond-material-issue'
  | 'request-scope-change'
  | 'respond-scope-change'
  | 'open-dispute'
  | 'confirm-receipt'
  | 'complete-order'
  | 'request-aftercare-support'
  | 'request-emergency-support'
  | 'save-fabric-tracking'

const CUSTOMER_CANCELLATION_REASON_OPTIONS = [
  { value: 'CUSTOMER_CHANGED_MIND', label: 'Changed my mind' },
  { value: 'NEED_FULFILLMENT_CHANGE', label: 'Need pickup or delivery changed' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_DELIVERY_REASON_OPTIONS = [
  { value: 'DISPATCH_DELAY', label: 'Dispatch is taking too long' },
  { value: 'DELIVERY_FAILED', label: 'Delivery failed' },
  { value: 'RETURN_TO_SENDER', label: 'Returned to sender' },
  { value: 'MARKED_DELIVERED_NOT_RECEIVED', label: 'Marked delivered, not received' },
  { value: 'WRONG_ITEM_RECEIVED', label: 'Wrong item arrived' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_AFTERCARE_OPTIONS = [
  { value: 'FIT_ISSUE', label: 'Fit issue' },
  { value: 'FINISH_ISSUE', label: 'Finish issue' },
  { value: 'DAMAGE_OR_DEFECT', label: 'Damage or defect' },
  { value: 'ALTERATION_FOLLOW_UP', label: 'Alteration follow-up' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_DISPUTE_REASON_OPTIONS = [
  'Item was not received',
  'Quality or workmanship issue',
  'Delivery or pickup problem',
  'Timeline changed',
  'Wrong item or details',
  'Other',
] as const

function CustomerOrderActions({ order, data, onRefresh }: { order: AccountOrder; data: OrderDetailRenderData; onRefresh: () => void }) {
  const stage = order.stage ?? ''
  const supportMeta = parseOrderSupportMeta(order.special_note)
  const viewerIsCustomer = order.customer_id === data.userId
  const canConfirmMeasurements = orderNeedsMeasurementConfirmation(order)
  const canRespondStyleAlignment = order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
  const canRespondSourcedFabric = order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'TAILOR_SOURCES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    data.customOrderDetail?.fabric_approval_required === true &&
    data.customOrderDetail.fabric_approval_status === 'PENDING_CUSTOMER_APPROVAL'
  const canRespondMaterialIssue = PRE_CUTTING_STAGES.has(stage) && supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const canRequestScopeChange = order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange = SCOPE_CHANGE_STAGES.has(stage) &&
    scopeChangeOpen &&
    supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canCancelScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canSelfCancel = CUSTOMER_SELF_CANCEL_STAGES.has(stage)
  const canRequestCancellationReview = CUSTOMER_CANCELLATION_REVIEW_STAGES.has(stage) && !cancellationReviewOpen
  const canRequestDeliveryReview = CUSTOMER_DELIVERY_REVIEW_STAGES.has(stage) && !deliveryReviewOpen && !cancellationReviewOpen
  const canOpenDispute = CUSTOMER_DISPUTE_STAGES.has(stage)
  const canConfirmReceipt = CUSTOMER_RECEIPT_STAGES.has(stage)
  const canCompleteOrder = CUSTOMER_COMPLETE_STAGES.has(stage)
  const canRequestAftercare = CUSTOMER_AFTERCARE_STAGES.has(stage)
  const canRequestEmergencySupport = !isTerminalOrder(order) || CUSTOMER_AFTERCARE_STAGES.has(stage)
  const canSaveFabricTracking = order.fabric_source === 'CUSTOMER_SUPPLIES' && CUSTOMER_FABRIC_TRACKING_STAGES.has(stage)
  const hasActions =
    canConfirmMeasurements ||
    canRespondStyleAlignment ||
    canRespondSourcedFabric ||
    canRespondMaterialIssue ||
    canRequestScopeChange ||
    canRespondScopeChange ||
    canCancelScopeChange ||
    canSelfCancel ||
    canRequestCancellationReview ||
    canRequestDeliveryReview ||
    canOpenDispute ||
    canConfirmReceipt ||
    canCompleteOrder ||
    canRequestAftercare ||
    canRequestEmergencySupport ||
    canSaveFabricTracking

  const [busyAction, setBusyAction] = useState<CustomerOrderActionName | null>(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [fabricTracking, setFabricTracking] = useState(order.fabric_tracking ?? '')
  const [styleChangeNote, setStyleChangeNote] = useState('')
  const [fabricChangeNote, setFabricChangeNote] = useState('')
  const [materialIssueResponse, setMaterialIssueResponse] = useState<(typeof MATERIAL_ISSUE_RESPONSE_OPTIONS)[number]['value']>('REPLACE_FABRIC')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [customerScopeChangeType, setCustomerScopeChangeType] = useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [customerScopeChangeSummary, setCustomerScopeChangeSummary] = useState('')
  const [customerScopeChangeImpacts, setCustomerScopeChangeImpacts] = useState<string[]>([])
  const [scopeChangeDecision, setScopeChangeDecision] = useState<'ACCEPTED' | 'DECLINED'>('ACCEPTED')
  const [scopeChangeResponseNote, setScopeChangeResponseNote] = useState('')
  const [cancellationReason, setCancellationReason] = useState<(typeof CUSTOMER_CANCELLATION_REASON_OPTIONS)[number]['value']>('CUSTOMER_CHANGED_MIND')
  const [cancellationNote, setCancellationNote] = useState('')
  const [deliveryReason, setDeliveryReason] = useState<(typeof CUSTOMER_DELIVERY_REASON_OPTIONS)[number]['value']>('DISPATCH_DELAY')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [aftercareType, setAftercareType] = useState<(typeof CUSTOMER_AFTERCARE_OPTIONS)[number]['value']>('FIT_ISSUE')
  const [aftercareNote, setAftercareNote] = useState('')
  const [emergencyNote, setEmergencyNote] = useState('')
  const [disputeReason, setDisputeReason] = useState<(typeof CUSTOMER_DISPUTE_REASON_OPTIONS)[number]>('Quality or workmanship issue')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!viewerIsCustomer || !hasActions) return null

  async function runCustomerAction(action: CustomerOrderActionName, body: Record<string, unknown>, successMessage: string) {
    setBusyAction(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('customer-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setCancelArmed(false)
      setSuccess(successMessage)
      onRefresh()
    } catch (actionError) {
      setError(friendlyActionError(actionError, 'This order action could not finish. Refresh the order and try again.'))
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function confirmMeasurements() {
    await runCustomerAction('confirm-measurements', {}, 'Measurements confirmed. The tailor can continue when the order stage allows it.')
  }

  async function decideStyleAlignment(action: 'approve-style-alignment' | 'request-style-alignment-change') {
    const note = styleChangeNote.trim()
    const leak = assertNoContactLeak(note, "Style response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-style-alignment-change' && note.length < 5) {
      setError('Tell the tailor what needs to change before cutting.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-style-alignment-change' ? note : undefined },
      action === 'approve-style-alignment' ? 'Style interpretation approved.' : 'Style clarification sent to the tailor.',
    )
    if (action === 'request-style-alignment-change') setStyleChangeNote('')
  }

  async function decideSourcedFabric(action: 'approve-sourced-fabric' | 'request-sourced-fabric-change') {
    const note = fabricChangeNote.trim()
    const leak = assertNoContactLeak(note, "Fabric response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-sourced-fabric-change' && note.length < 5) {
      setError('Tell the tailor what should change about the sourced fabric.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-sourced-fabric-change' ? note : undefined },
      action === 'approve-sourced-fabric' ? 'Sourced fabric approved.' : 'Fabric change request sent to the tailor.',
    )
    if (action === 'request-sourced-fabric-change') setFabricChangeNote('')
  }

  async function respondMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(note, "Material issue response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-material-issue',
      { materialIssueResponse, note: note || undefined },
      'Material issue response sent to the tailor.',
    )
    setMaterialIssueNote('')
  }

  function toggleCustomerScopeImpact(value: string) {
    setCustomerScopeChangeImpacts((current) =>
      current.includes(value)
        ? current.filter((impact) => impact !== value)
        : [...current, value],
    )
  }

  async function requestCustomerScopeChange() {
    const summary = customerScopeChangeSummary.trim()
    const leak = assertNoContactLeak(summary, "Change requests can't include contact details.")
    setError(null)
    setSuccess(null)
    if (summary.length < 10) {
      setError('Describe what needs to change so the tailor has a clear record.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-scope-change',
      {
        scopeChangeType: customerScopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts: customerScopeChangeImpacts.length > 0 ? customerScopeChangeImpacts : undefined,
      },
      'Change request sent to the tailor.',
    )
    setCustomerScopeChangeSummary('')
    setCustomerScopeChangeImpacts([])
  }

  async function respondScopeChange(decisionOverride?: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const decision = decisionOverride ?? scopeChangeDecision
    const note = scopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change request cancelled.',
    )
    setScopeChangeResponseNote('')
  }

  async function cancelOrder() {
    if (!cancelArmed) {
      setCancelArmed(true)
      setError(null)
      setSuccess('Click cancel order once more to close this order.')
      return
    }
    await runCustomerAction('cancel-order', {}, 'Order cancelled. Any eligible refund review has started.')
  }

  async function requestCancellationReview() {
    const note = cancellationNote.trim()
    const leak = assertNoContactLeak(note, "Cancellation review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-cancellation-review',
      { cancellationReason, note: note || undefined },
      'Cancellation review opened. Drapeon will review the order timeline before handoff continues.',
    )
    setCancellationNote('')
  }

  async function requestDeliveryReview() {
    const note = deliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-delivery-review',
      { deliveryReason, note: note || undefined },
      'Delivery review opened. Drapeon will check dispatch and handoff evidence.',
    )
    setDeliveryNote('')
  }

  async function openDispute() {
    const description = disputeDescription.trim()
    const leak = assertNoContactLeak(description, "Concern details can't include contact details.")
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Add a short description so Drapeon can understand what happened.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'open-dispute',
      { reason: disputeReason, description },
      'Concern opened. The order is paused for review.',
    )
    setDisputeDescription('')
  }

  async function confirmReceipt() {
    setError(null)
    setSuccess(null)
    if (!receiptFile) {
      setError('Add proof media before confirming receipt.')
      return
    }

    setBusyAction('confirm-receipt')
    try {
      setUploadStatus('Preparing proof media...')
      const preparedPhoto = await prepareOrderEvidenceFile(receiptFile)
      setUploadStatus('Uploading proof media...')
      const receiptPhotoUrl = await uploadPublicFile('order-photos', `receipts/${order.id}`, preparedPhoto)
      await invokeAccountFunction('customer-order-action', {
        action: 'confirm-receipt',
        orderId: order.id,
        receiptPhotoUrl,
      })
      setReceiptFile(null)
      setSuccess('Receipt confirmed. You can review the order once the record refreshes.')
      onRefresh()
    } catch (receiptError) {
      setError(friendlyActionError(receiptError, 'Receipt could not be confirmed. Try a smaller proof photo or MP4/MOV video up to 60 seconds.'))
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function completeOrder() {
    await runCustomerAction('complete-order', {}, 'Order marked complete.')
  }

  async function requestAftercare() {
    const note = aftercareNote.trim()
    const leak = assertNoContactLeak(note, "Aftercare notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (note.length < 10) {
      setError('Add a short note about the fit, finish, or defect.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-aftercare-support',
      { aftercareType, note },
      'Aftercare request sent. Drapeon will review the fit or finish issue.',
    )
    setAftercareNote('')
  }

  async function requestEmergencySupport() {
    const description = emergencyNote.trim()
    const leak = assertNoContactLeak(description, "Emergency support notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Tell Drapeon what is wrong and when the event or wear date is.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-emergency-support',
      { description },
      'Emergency support request sent. Keep updates inside this order while Drapeon reviews it.',
    )
    setEmergencyNote('')
  }

  async function saveFabricTracking() {
    const value = fabricTracking.trim()
    const leak = assertNoContactLeak(value, "Tracking numbers can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!value) {
      setError('Add the carrier tracking number before saving.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'save-fabric-tracking',
      { fabricTracking: value },
      'Fabric tracking saved on this order.',
    )
  }

  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer actions</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Manage this order.</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/58">
          Actions shown here match the order stage and stay attached to the order record.
        </p>
      </div>
      <div className="mt-5 grid gap-3">
        <ActionNotice error={error} success={uploadStatus ?? success} />

        {canConfirmMeasurements ? (
          <DisclosurePanel
            title="Confirm measurements"
            summary="Let the tailor continue with the measurements attached to this order."
            defaultOpen
          >
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-ink/62">
                Confirm only if these measurements are still correct. Cutting can stay paused until this is done.
              </p>
              <button
                type="button"
                onClick={() => { void confirmMeasurements() }}
                disabled={busyAction === 'confirm-measurements'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-measurements' ? 'Confirming...' : 'Confirm measurements'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondStyleAlignment ? (
          <DisclosurePanel
            title="Style alignment"
            summary={supportMeta.styleAlignment?.tailorInterpretation ?? 'Review the tailor style interpretation before cutting.'}
            defaultOpen
          >
            <div className="grid gap-3">
              <textarea
                value={styleChangeNote}
                onChange={(event) => setStyleChangeNote(event.target.value)}
                placeholder="Optional change note if this needs clarification."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { void decideStyleAlignment('approve-style-alignment') }}
                  disabled={busyAction === 'approve-style-alignment'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-style-alignment' ? 'Approving...' : 'Approve style'}
                </button>
                <button
                  type="button"
                  onClick={() => { void decideStyleAlignment('request-style-alignment-change') }}
                  disabled={busyAction === 'request-style-alignment-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-style-alignment-change' ? 'Sending...' : 'Request clarification'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondSourcedFabric ? (
          <DisclosurePanel
            title="Sourced fabric"
            summary="Approve the tailor-sourced fabric or request a change before cutting."
            defaultOpen
          >
            <div className="grid gap-3">
              <textarea
                value={fabricChangeNote}
                onChange={(event) => setFabricChangeNote(event.target.value)}
                placeholder="Optional change note if the fabric is not right."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { void decideSourcedFabric('approve-sourced-fabric') }}
                  disabled={busyAction === 'approve-sourced-fabric'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-sourced-fabric' ? 'Approving...' : 'Approve fabric'}
                </button>
                <button
                  type="button"
                  onClick={() => { void decideSourcedFabric('request-sourced-fabric-change') }}
                  disabled={busyAction === 'request-sourced-fabric-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-sourced-fabric-change' ? 'Sending...' : 'Request fabric change'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondMaterialIssue ? (
          <DisclosurePanel
            title="Material issue"
            summary={supportMeta.materialIssue?.reasonLabel ?? 'Choose how to handle the fabric issue.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.materialIssue?.note ? (
                <p className="text-sm leading-6 text-ink/62">{safeUserText(supportMeta.materialIssue.note, '')}</p>
              ) : null}
              <select
                value={materialIssueResponse}
                onChange={(event) => setMaterialIssueResponse(event.target.value as typeof materialIssueResponse)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={materialIssueNote}
                onChange={(event) => setMaterialIssueNote(event.target.value)}
                placeholder="Optional note for the tailor."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void respondMaterialIssue() }}
                disabled={busyAction === 'respond-material-issue'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'respond-material-issue' ? 'Sending...' : 'Send material response'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel
            title="Request change"
            summary="Ask for a formal scope, fit, fabric, style, deadline, or fulfillment change."
          >
            <div className="grid gap-3">
              <select
                value={customerScopeChangeType}
                onChange={(event) => setCustomerScopeChangeType(event.target.value as typeof customerScopeChangeType)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label key={option.value} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68">
                    <input
                      type="checkbox"
                      checked={customerScopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleCustomerScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={customerScopeChangeSummary}
                onChange={(event) => setCustomerScopeChangeSummary(event.target.value)}
                placeholder="What needs to change?"
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestCustomerScopeChange() }}
                disabled={busyAction === 'request-scope-change'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Order change"
            summary={supportMeta.scopeChange?.summary ?? 'Review the open change request before work continues.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {canRespondScopeChange ? (
                <>
                  <select
                    value={scopeChangeDecision}
                    onChange={(event) => setScopeChangeDecision(event.target.value as typeof scopeChangeDecision)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
                  >
                    <option value="ACCEPTED">Accept change</option>
                    <option value="DECLINED">Decline change</option>
                  </select>
                  <textarea
                    value={scopeChangeResponseNote}
                    onChange={(event) => setScopeChangeResponseNote(event.target.value)}
                    placeholder="Optional response note."
                    className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                  />
                  <button
                    type="button"
                    onClick={() => { void respondScopeChange() }}
                    disabled={busyAction === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busyAction === 'respond-scope-change' ? 'Saving...' : 'Send change response'}
                  </button>
                </>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => { void respondScopeChange('CANCELLED') }}
                  disabled={busyAction === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'respond-scope-change' ? 'Cancelling...' : 'Cancel request'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canSaveFabricTracking ? (
          <DisclosurePanel title="Fabric tracking" summary="Add the carrier tracking number when you are sending fabric to the tailor.">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={fabricTracking}
                onChange={(event) => setFabricTracking(event.target.value)}
                placeholder="Carrier tracking number"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void saveFabricTracking() }}
                disabled={busyAction === 'save-fabric-tracking' || fabricTracking.trim() === (order.fabric_tracking ?? '')}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'save-fabric-tracking' ? 'Saving...' : 'Save tracking'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canSelfCancel ? (
          <DisclosurePanel title="Cancel order" summary="Close an early order before live production starts.">
            <button
              type="button"
              onClick={() => { void cancelOrder() }}
              disabled={busyAction === 'cancel-order'}
              className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
            >
              {busyAction === 'cancel-order' ? 'Cancelling...' : cancelArmed ? 'Confirm cancellation' : 'Cancel order'}
            </button>
          </DisclosurePanel>
        ) : null}

        {canRequestCancellationReview ? (
          <DisclosurePanel title="Cancellation review" summary="Ask Drapeon to review cancellation after production has started.">
            <div className="grid gap-3">
              <select
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value as typeof cancellationReason)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_CANCELLATION_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={cancellationNote}
                onChange={(event) => setCancellationNote(event.target.value)}
                placeholder="Add context for the review."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestCancellationReview() }}
                disabled={busyAction === 'request-cancellation-review'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-cancellation-review' ? 'Opening review...' : 'Open cancellation review'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestDeliveryReview ? (
          <DisclosurePanel title="Delivery review" summary="Use this if dispatch, delivery, or handoff looks wrong.">
            <div className="grid gap-3">
              <select
                value={deliveryReason}
                onChange={(event) => setDeliveryReason(event.target.value as typeof deliveryReason)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_DELIVERY_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={deliveryNote}
                onChange={(event) => setDeliveryNote(event.target.value)}
                placeholder="What happened with dispatch or delivery?"
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestDeliveryReview() }}
                disabled={busyAction === 'request-delivery-review'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-delivery-review' ? 'Opening review...' : 'Open delivery review'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canConfirmReceipt ? (
          <DisclosurePanel
            title="Confirm receipt"
            summary="Add proof that the item is in hand before closing delivery."
            defaultOpen
          >
            <div className="grid gap-3">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <button
                type="button"
                onClick={() => { void confirmReceipt() }}
                disabled={busyAction === 'confirm-receipt'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-receipt' ? 'Confirming...' : 'Confirm receipt'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canCompleteOrder ? (
          <DisclosurePanel title="Complete order" summary="Mark the order complete after delivery or collection is settled.">
            <button
              type="button"
              onClick={() => { void completeOrder() }}
              disabled={busyAction === 'complete-order'}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busyAction === 'complete-order' ? 'Completing...' : 'Mark complete'}
            </button>
          </DisclosurePanel>
        ) : null}

        {canRequestAftercare ? (
          <DisclosurePanel title="Aftercare" summary="Raise a fit, finish, damage, or alteration issue after handoff.">
            <div className="grid gap-3">
              <select
                value={aftercareType}
                onChange={(event) => setAftercareType(event.target.value as typeof aftercareType)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_AFTERCARE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={aftercareNote}
                onChange={(event) => setAftercareNote(event.target.value)}
                placeholder="Describe the fit, finish, or defect."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestAftercare() }}
                disabled={busyAction === 'request-aftercare-support'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-aftercare-support' ? 'Sending...' : 'Send aftercare request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canOpenDispute ? (
          <DisclosurePanel title="Raise a concern" summary="Pause the order for Drapeon review when something is wrong.">
            <div className="grid gap-3">
              <select
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value as typeof disputeReason)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_DISPUTE_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
              <textarea
                value={disputeDescription}
                onChange={(event) => setDisputeDescription(event.target.value)}
                placeholder="Describe what happened."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void openDispute() }}
                disabled={busyAction === 'open-dispute'}
                className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'open-dispute' ? 'Opening concern...' : 'Raise concern'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestEmergencySupport ? (
          <DisclosurePanel title="Event emergency" summary="Use this for urgent event or wear-date problems.">
            <div className="grid gap-3">
              <textarea
                value={emergencyNote}
                onChange={(event) => setEmergencyNote(event.target.value)}
                placeholder="What is wrong, and when is the event or wear date?"
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => { void requestEmergencySupport() }}
                disabled={busyAction === 'request-emergency-support'}
                className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'request-emergency-support' ? 'Sending...' : 'Request emergency help'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </Surface>
  )
}

function useMessageMediaUrl(raw: string | null | undefined): string | null {
  const immediate = useMemo(() => safeMediaUrl(raw) ?? null, [raw])
  const storagePath = useMemo(() => {
    if (!raw || immediate) return null
    if (raw.startsWith('messages/')) return raw
    if (raw.startsWith('message-media/')) return raw.replace(/^message-media\//, '')
    return null
  }, [immediate, raw])
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!storagePath) return undefined
    let cancelled = false
    void createMessageMediaSignedUrl(storagePath).then((url) => {
      if (!cancelled) setSigned({ path: storagePath, url })
    })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediate) return immediate
  if (!storagePath) return null
  return signed?.path === storagePath ? signed.url : null
}

function voicePlaybackMimeType(raw: string | null | undefined, fallback?: string | null) {
  const source = (raw ?? '').split('?')[0]?.toLowerCase() ?? ''
  if (/\.(m4a|mp4)$/u.test(source)) return 'audio/mp4'
  if (/\.aac$/u.test(source)) return 'audio/aac'
  if (/\.webm$/u.test(source)) return 'audio/webm; codecs="opus"'
  if (/\.ogg$/u.test(source)) return 'audio/ogg; codecs="opus"'
  if (/\.wav$/u.test(source)) return 'audio/wav'

  const normalizedFallback = fallback?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalizedFallback === 'audio/m4a' || normalizedFallback === 'audio/x-m4a') return 'audio/mp4'
  return normalizedFallback || 'audio/mp4'
}

function useMessageVoicePlayback(raw: string | null | undefined) {
  const signedUrl = useMessageMediaUrl(raw)
  const [playback, setPlayback] = useState<{
    source: string
    url: string
    mimeType: string
  } | null>(null)

  useEffect(() => {
    if (!signedUrl) return undefined

    const controller = new AbortController()
    let objectUrl: string | null = null
    void fetch(signedUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Voice note could not load.')
        const sourceBlob = await response.blob()
        const mimeType = voicePlaybackMimeType(raw, sourceBlob.type)
        const playbackBlob = sourceBlob.type === mimeType
          ? sourceBlob
          : new Blob([sourceBlob], { type: mimeType })
        objectUrl = URL.createObjectURL(playbackBlob)
        setPlayback({ source: signedUrl, url: objectUrl, mimeType })
      })
      .catch((playbackError) => {
        if (playbackError instanceof DOMException && playbackError.name === 'AbortError') return
        setPlayback({ source: signedUrl, url: signedUrl, mimeType: voicePlaybackMimeType(raw) })
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [raw, signedUrl])

  if (!signedUrl) return { url: null, fallbackUrl: null, mimeType: voicePlaybackMimeType(raw), loading: true }
  if (playback?.source !== signedUrl) {
    return { url: null, fallbackUrl: signedUrl, mimeType: voicePlaybackMimeType(raw), loading: true }
  }
  return { ...playback, fallbackUrl: signedUrl, loading: false }
}

function VoiceMessagePlayer({ raw }: { raw: string | null | undefined }) {
  const playback = useMessageVoicePlayback(raw)
  const [failedSource, setFailedSource] = useState<string | null>(null)

  if (playback.loading || !playback.url) {
    return <div className="h-10 w-full animate-pulse rounded-[8px] bg-ink/8" aria-label="Loading voice note" />
  }
  const failed = failedSource === playback.url

  return (
    <div className="grid w-full min-w-0 gap-1.5">
      <audio
        src={playback.url}
        controls
        preload="metadata"
        className="h-10 w-full min-w-0"
        onCanPlay={() => setFailedSource(null)}
        onError={() => setFailedSource(playback.url)}
      />
      {failed ? (
        <p className="text-xs leading-5 text-rust">
          This browser could not decode the voice note.{' '}
          {playback.fallbackUrl ? (
            <a href={playback.fallbackUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
              Open the original audio
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function MessageContent({ message, compact = false }: { message: AccountMessage; compact?: boolean }) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const hasVoiceAttachment = Boolean(message.voice_url)
  const rawText = safeUserText(message.body, '')
  const text = hasVoiceAttachment && /^\d+(?:\.\d+)?$/u.test(rawText) ? '' : rawText
  const hasVideoAttachment = isVideoMediaUrl(photoUrl)

  return (
    <div className="grid min-w-0 gap-2.5">
      {text ? (
        <p className={`${compact ? 'line-clamp-3' : ''} whitespace-pre-wrap break-words text-sm leading-6 text-ink/72`}>
          {text}
        </p>
      ) : null}
      {photoUrl && hasVideoAttachment ? (
        <MediaViewerDialog src={photoUrl} kind="video" title="Video attachment">
          <button type="button" className="group/media relative block w-full cursor-pointer overflow-hidden rounded-[8px] border border-ink/10 bg-ink text-left">
            <MutedVideo
              src={photoUrl}
              autoPlay={false}
              loop={false}
              controls={false}
              className="aspect-video max-h-72 w-full object-cover"
              ariaLabel="Open video attachment"
              showMuteToggle={false}
            />
            <span className="absolute inset-0 grid place-items-center bg-black/12 transition-colors group-hover/media:bg-black/22">
              <span className="grid size-11 place-items-center rounded-full bg-white/92 text-ink shadow-md">
                <Video className="size-5" />
              </span>
            </span>
          </button>
        </MediaViewerDialog>
      ) : photoUrl ? (
        <MediaViewerDialog src={photoUrl} kind="image" title="Photo attachment">
          <button type="button" className="group/media block w-full cursor-zoom-in overflow-hidden rounded-[8px] border border-ink/10 bg-white text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Order message attachment" className="max-h-72 w-full object-cover transition-opacity group-hover/media:opacity-90" />
          </button>
        </MediaViewerDialog>
      ) : null}
      {hasVoiceAttachment ? <VoiceMessagePlayer raw={message.voice_url} /> : null}
    </div>
  )
}

const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const

function MessageReactionBar({
  reactions,
  userId,
  mine,
  open,
  onOpenChange,
  onToggle,
}: {
  reactions: AccountMessageReaction[]
  userId: string | null
  mine: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (emoji: string) => void
}) {
  const counts = MESSAGE_REACTION_OPTIONS.map((emoji) => {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji)
    return {
      emoji,
      count: matching.length,
      selected: Boolean(userId && matching.some((reaction) => reaction.user_id === userId)),
    }
  })
  const visibleCounts = counts.filter(({ count }) => count > 0)

  return (
    <div className={`relative mt-2 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
      {visibleCounts.map(({ emoji, count, selected }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={
            selected
              ? mine
                ? 'rounded-full bg-white/22 px-2 py-1 text-xs font-semibold text-white'
                : 'rounded-full bg-needle/12 px-2 py-1 text-xs font-semibold text-needle'
              : mine
                ? 'rounded-full bg-white/12 px-2 py-1 text-xs font-semibold text-white/78 transition hover:bg-white/22'
                : 'rounded-full bg-ink/5 px-2 py-1 text-xs font-semibold text-ink/64 transition hover:bg-needle/10 hover:text-needle'
          }
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
        >
          <span aria-hidden="true">{emoji}</span>
          <span className="ml-1">{count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          mine
            ? 'rounded-full px-2 py-1 text-xs font-semibold text-white/48 transition hover:bg-white/12 hover:text-white'
            : 'rounded-full px-2 py-1 text-xs font-semibold text-ink/36 transition hover:bg-ink/5 hover:text-ink'
        }
        aria-expanded={open}
        aria-label={open ? 'Hide reactions' : 'React to message'}
      >
        +
      </button>
      {open ? (
        <div className={`absolute bottom-full z-20 mb-1 flex gap-1 rounded-full border border-ink/8 bg-white p-1 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>
          {counts.map(({ emoji, count, selected }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji)
                onOpenChange(false)
              }}
              className={`rounded-full px-2 py-1 text-sm transition ${selected ? 'bg-needle/12 text-needle' : 'text-ink/64 hover:bg-ink/5 hover:text-ink'}`}
              aria-pressed={selected}
              aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 ? <span className="ml-1 text-xs font-semibold">{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type WebCallLifecycleEvent = {
  kind: 'consultation' | 'ready-made'
  scheduledStartAt?: string | null
  timezone?: string | null
  reason?: string | null
  status?: string | null
  paymentRequired?: boolean
  paymentPaid?: boolean
  actionLoading?: boolean
  onJoinVideo?: () => void
  onReschedule?: () => void
  rescheduleLabel?: string
  rescheduleHref?: Route
  paymentActionLabel?: string | null
  paymentHref?: Route
}

function CallLifecycleEventCard({ event }: { event: WebCallLifecycleEvent }) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    const updateNow = () => setNow(Date.now())
    const bootTimer = window.setTimeout(updateNow, 0)
    const timer = window.setInterval(updateNow, 30_000)
    return () => {
      window.clearTimeout(bootTimer)
      window.clearInterval(timer)
    }
  }, [])

  const lifecycle = getCallLifecycleState(event.scheduledStartAt, now)
  if (lifecycle.status === 'unscheduled') return null

  const reason = event.kind === 'consultation'
    ? 'Consultation'
    : callSchedulingReasonFor(event.reason).label
  const title = event.kind === 'consultation' ? 'Consultation call' : 'Ready-made coordination call'
  const scheduledLabel = formatDateTime(event.scheduledStartAt ?? null, event.timezone) ?? 'Time not set'
  const isPaymentBlocked = event.paymentRequired === true && event.paymentPaid !== true
  const isExpired =
    event.status === 'EXPIRED' ||
    event.status === 'DECLINED' ||
    event.status === 'COMPLETED' ||
    lifecycle.status === 'expired'

  return (
    <div className={`mb-3 grid gap-3 rounded-[8px] border p-3 shadow-sm ${isExpired ? 'border-ink/8 bg-bone/65' : 'border-needle/14 bg-white'}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isExpired ? 'bg-ink/8 text-ink/44' : 'bg-needle/10 text-needle'}`}>
          <Video className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-needle">Order lifecycle event</p>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs leading-5 text-ink/54">{scheduledLabel}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-ink/42">Reason</span>
        <span className="text-right font-semibold text-ink">{reason}</span>
      </div>

      {isPaymentBlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-rust/16 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
          <span className="font-semibold">Consultation fee required before the room can open</span>
          {event.paymentHref && event.paymentActionLabel ? (
            <Link href={event.paymentHref} className="font-semibold text-needle">
              {event.paymentActionLabel}
            </Link>
          ) : null}
        </div>
      ) : isExpired ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-ink/6 px-3 py-2 text-xs leading-5 text-ink/54">
          <span className="font-semibold">Call Missed / Window Expired</span>
          {event.rescheduleHref ? (
            <Link href={event.rescheduleHref} className="font-semibold text-needle">
              {event.rescheduleLabel ?? 'Reschedule'}
            </Link>
          ) : event.onReschedule ? (
            <button
              type="button"
              onClick={event.onReschedule}
              className="font-semibold text-needle"
            >
              {event.rescheduleLabel ?? 'Reschedule'}
            </button>
          ) : null}
        </div>
      ) : lifecycle.status === 'active' ? (
        <Button
          onClick={event.onJoinVideo}
          disabled={event.actionLoading || !event.onJoinVideo}
        >
          {event.actionLoading ? 'Opening...' : 'Join Video Call Now'}
        </Button>
      ) : (
        <Button disabled variant="secondary">
          {formatCallCountdown(lifecycle.msUntilOpen)}
        </Button>
      )}
    </div>
  )
}

function MessageComposer({
  order,
  onRefresh,
  channelRef,
  replyingTo,
  onClearReply,
  editingMessage,
  onClearEdit,
}: {
  order: AccountOrder
  onRefresh: () => void
  channelRef?: React.RefObject<RealtimeChannel | null>
  replyingTo?: AccountMessage | null
  onClearReply?: () => void
  editingMessage?: AccountMessage | null
  onClearEdit?: () => void
}) {
  const account = useAccountContext()
  const [body, setBody] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [callBusy, setCallBusy] = useState<string | null>(null)
  const [callTime, setCallTime] = useState('')
  const [callReason, setCallReason] = useState('OTHER')
  const [consultationTime, setConsultationTime] = useState('')
  const [consultationNote, setConsultationNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const readyMadeCallTimeInputRef = useRef<HTMLInputElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [webRecording, setWebRecording] = useState(false)
  const [webRecordingSeconds, setWebRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const webRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const webStreamRef = useRef<MediaStream | null>(null)
  const webRecordingStartingRef = useRef(false)
  const webRecordingStoppingRef = useRef(false)
  const webRecordingFinalizingRef = useRef(false)
  const webRecordingCancelledRef = useRef(false)
  const webRecordingSecondsRef = useRef(0)
  const canMessage = !isTerminalOrder(order)
  const isReadyMade = order.order_kind === 'READY_MADE'

  // Pre-populate body when entering edit mode
  const prevEditingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingMessage && editingMessage.id !== prevEditingIdRef.current) {
      setBody(editingMessage.body ?? '')
    }
    prevEditingIdRef.current = editingMessage?.id ?? null
  }, [editingMessage])

  useEffect(() => () => {
    if (webRecordTimerRef.current) clearInterval(webRecordTimerRef.current)
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // The browser already released this recorder.
        }
      }
    }
    webStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  function broadcastTyping(isTyping: boolean) {
    const channel = channelRef?.current ?? null
    if (!channel || !account.userId) return
    void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: account.userId, isTyping } })
  }
  const isCustomOrder = order.order_kind === 'CUSTOM' || !order.order_kind
  const supportMeta = useMemo(() => parseOrderSupportMeta(order.special_note), [order.special_note])
  const consultationMeta = supportMeta.consultation ?? null
  const orderCallMeta = supportMeta.orderCall ?? null
  const viewerIsCustomer = order.customer_id === account.userId
  const consultationPaymentRequired =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS'
  const consultationPaymentPaid = consultationPaymentRequired && !!consultationMeta?.paidAt
  const consultationPaymentBlocked = consultationPaymentRequired && !consultationPaymentPaid
  const canRequestConsultation = isCustomOrder && viewerIsCustomer && order.stage === 'PENDING_QUOTE'
  const canScheduleReadyMadeCall = isReadyMade && ORDER_CALL_STAGES.has(order.stage ?? '')
  const canShowCallButtons = canStartOrderCall(order)
  const consultationLabel = formatDateTime(consultationMeta?.scheduledStartAt ?? consultationMeta?.proposedStartAt, consultationMeta?.timezone)
  const readyMadeCallLabel = formatDateTime(orderCallMeta?.scheduledStartAt, orderCallMeta?.timezone)
  const callLifecycleEvent: WebCallLifecycleEvent | null =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.status === 'SCHEDULED' &&
    consultationMeta.scheduledStartAt
      ? {
          kind: 'consultation',
          scheduledStartAt: consultationMeta.scheduledStartAt,
          timezone: consultationMeta.timezone,
          status: consultationMeta.status,
          paymentRequired: consultationPaymentRequired,
          paymentPaid: consultationPaymentPaid,
          actionLoading: !!callBusy,
          onJoinVideo: () => { void startCall('video') },
          rescheduleHref: accountRoute(`/account/orders/${order.id}`),
          rescheduleLabel: 'View order',
          paymentHref: viewerIsCustomer ? accountRoute(`/account/checkout/${order.id}`) : accountRoute(`/account/orders/${order.id}`),
          paymentActionLabel: viewerIsCustomer ? 'Pay now' : 'View order',
        }
      : isReadyMade &&
          orderCallMeta?.status === 'SCHEDULED' &&
          orderCallMeta.scheduledStartAt
        ? {
            kind: 'ready-made',
            scheduledStartAt: orderCallMeta.scheduledStartAt,
            timezone: orderCallMeta.timezone,
            status: orderCallMeta.status,
            reason: orderCallMeta.reason,
            actionLoading: !!callBusy,
            onJoinVideo: () => { void startCall('video') },
            onReschedule: () => {
              setError('Choose a new time below and tap Schedule.')
              readyMadeCallTimeInputRef.current?.focus()
              const picker = readyMadeCallTimeInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null
              picker?.showPicker?.()
            },
            rescheduleLabel: 'Reschedule',
          }
        : null

  async function sendMessage() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    broadcastTyping(false)
    const trimmed = body.trim()
    setError(null)
    setSuccess(null)
    setUploadStatus(null)

    // Edit mode: update existing message body
    if (editingMessage) {
      if (!trimmed) { setError('Message cannot be empty.'); return }
      const leak = assertNoContactLeak(trimmed)
      if (leak) { setError(leak); return }
      setBusy(true)
      try {
        await invokeAccountFunction('message-action', { action: 'edit', messageId: editingMessage.id, body: trimmed })
        setBody('')
        onClearEdit?.()
        onRefresh()
      } catch (editError) {
        setError(friendlyActionError(editError, 'Could not edit this message. Please try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!trimmed && !photoFile) {
      setError('Write a message or attach media before sending.')
      return
    }
    if (trimmed) {
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
    }
    setBusy(true)
    try {
      if (photoFile) {
        setUploadStatus('Preparing media...')
        const preparedPhoto = await prepareMessageMediaFile(photoFile)
        setUploadStatus('Uploading...')
        const storagePath = await uploadPrivateFile('message-media', `messages/${order.id}`, preparedPhoto)
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'PHOTO',
          photoUrl: storagePath,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      if (trimmed) {
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'TEXT',
          body: trimmed,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      setBody('')
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      onClearReply?.()
      setSuccess(photoFile && trimmed ? 'Media and message sent inside the protected order thread.' : photoFile ? 'Media sent inside the protected order thread.' : 'Message sent inside the protected order thread.')
      onRefresh()
    } catch (messageError) {
      setError(friendlyActionError(messageError, 'Message could not send. Please try again with smaller media or text only.'))
    } finally {
      setBusy(false)
      setUploadStatus(null)
    }
  }

  async function scheduleReadyMadeCall() {
    const scheduledStartAt = datetimeLocalToIso(callTime)
    setError(null)
    setSuccess(null)
    if (!canScheduleReadyMadeCall) {
      setError('Use Messages for item questions before checkout. Ready-made calls open after checkout when the order is active.')
      return
    }
    if (!scheduledStartAt) {
      setError('Choose a valid call time.')
      return
    }
    if (!isCallSchedulingStartValid(scheduledStartAt)) {
      setError(`Choose a call time at least ${CALL_SCHEDULING_POLICY.minLookaheadMinutes} minutes from now.`)
      return
    }
    setCallBusy('schedule')
    try {
      await invokeAccountFunction('order-call-action', {
        action: 'schedule-ready-made-call',
        orderId: order.id,
        scheduledStartAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason: callReason,
      })
      setSuccess('Ready-made clarification call scheduled. Both sides will see it in Messages.')
      onRefresh()
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not be scheduled. Please try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function requestConsultation() {
    const scheduledStartAt = datetimeLocalToIso(consultationTime)
    const note = consultationNote.trim()
    const leak = assertNoContactLeak(note, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!scheduledStartAt) {
      setError('Choose a valid consultation time.')
      return
    }
    if (!isCallSchedulingStartValid(scheduledStartAt)) {
      setError(`Choose a consultation time at least ${CALL_SCHEDULING_POLICY.minLookaheadMinutes} minutes from now.`)
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    setCallBusy('consultation')
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        note: note || undefined,
      })
      setConsultationTime('')
      setConsultationNote('')
      setSuccess('Consultation request sent. The tailor can approve, reschedule, price, or decline it from their order view.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation could not be requested. Choose another time and try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function startCall(callType: 'audio' | 'video') {
    setError(null)
    setSuccess(null)
    if (!canStartOrderCall(order)) {
      setError(order.stage === 'PENDING_QUOTE'
        ? 'Request a consultation before starting a call on this custom order.'
        : 'Calls open after payment is confirmed while the order is active.')
      return
    }
    if (isReadyMade && orderCallMeta?.status !== 'SCHEDULED') {
      setError('Schedule this ready-made call first so both sides know when to join.')
      return
    }
    if (consultationPaymentBlocked) {
      setError('Consultation fee required before the room can open')
      return
    }
    setCallBusy(callType)
    try {
      const functionName = order.stage === 'CONSULTATION' ? 'create-consultation-room' : 'create-order-call-room'
      const result = await invokeAccountFunction<{ url?: string | null; fallback?: string; message?: string }>(functionName, {
        orderId: order.id,
        callType,
      })
      onRefresh()
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
        setSuccess(order.stage === 'CONSULTATION' ? `Consultation ${callType} opened in a new tab.` : `Drape ${callType} call opened in a new tab.`)
        return
      }
      setError(result.message ?? 'Calling is unavailable right now. Continue in Messages so the order record stays protected.')
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not start right now. Keep the conversation in Messages.'))
    } finally {
      setCallBusy(null)
    }
  }

  function stopWebRecordingTimer() {
    if (webRecordTimerRef.current) {
      clearInterval(webRecordTimerRef.current)
      webRecordTimerRef.current = null
    }
  }

  function cancelWebRecording() {
    webRecordingCancelledRef.current = true
    stopWebRecordingTimer()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive' && !webRecordingStoppingRef.current) {
      webRecordingStoppingRef.current = true
      recorder.stop()
      return
    }

    audioChunksRef.current = []
    webStreamRef.current?.getTracks().forEach((track) => track.stop())
    webStreamRef.current = null
    mediaRecorderRef.current = null
    webRecordingStoppingRef.current = false
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    setWebRecording(false)
    setWebRecordingSeconds(0)
  }

  async function startWebRecording() {
    if (
      busy ||
      webRecordingStartingRef.current ||
      webRecordingStoppingRef.current ||
      webRecordingFinalizingRef.current ||
      mediaRecorderRef.current
    ) return

    setError(null)
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError('Voice recording requires a secure browser connection with microphone support.')
      return
    }

    webRecordingStartingRef.current = true
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      webStreamRef.current = stream
      audioChunksRef.current = []
      const mimeType = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
      if (!mimeType) throw new Error('CROSS_PLATFORM_VOICE_UNSUPPORTED')

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onerror = () => {
        webRecordingCancelledRef.current = true
        setError('Voice recording stopped unexpectedly. Please try again.')
      }
      recorder.onstop = () => {
        const wasCancelled = webRecordingCancelledRef.current
        const durationSeconds = webRecordingSecondsRef.current
        stopWebRecordingTimer()
        webStreamRef.current?.getTracks().forEach((track) => track.stop())
        webStreamRef.current = null
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null
        setWebRecording(false)
        setWebRecordingSeconds(0)

        if (wasCancelled) {
          audioChunksRef.current = []
          webRecordingStoppingRef.current = false
          webRecordingCancelledRef.current = false
          webRecordingSecondsRef.current = 0
          return
        }

        void finaliseWebRecording(recorder.mimeType, durationSeconds)
      }
      recorder.start()
      setWebRecording(true)
      setWebRecordingSeconds(0)
      webRecordTimerRef.current = setInterval(() => {
        webRecordingSecondsRef.current += 1
        setWebRecordingSeconds(webRecordingSecondsRef.current)
        if (webRecordingSecondsRef.current >= 60) {
          stopWebRecording()
        }
      }, 1000)
    } catch (recordingError) {
      stopWebRecordingTimer()
      stream?.getTracks().forEach((track) => track.stop())
      webStreamRef.current = null
      mediaRecorderRef.current = null
      audioChunksRef.current = []
      setWebRecording(false)
      setWebRecordingSeconds(0)

      if (recordingError instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(recordingError.name)) {
        setError('Microphone access is blocked. Allow microphone access in your browser settings and try again.')
      } else if (recordingError instanceof DOMException && recordingError.name === 'NotFoundError') {
        setError('No microphone was found on this device.')
      } else if (recordingError instanceof DOMException && recordingError.name === 'NotReadableError') {
        setError('Your microphone is busy in another app or browser tab.')
      } else if (recordingError instanceof Error && recordingError.message === 'CROSS_PLATFORM_VOICE_UNSUPPORTED') {
        setError('This browser cannot create a cross-platform voice note. Update Chrome or Safari and try again.')
      } else {
        setError('Voice recording could not start. Please try again.')
      }
    } finally {
      webRecordingStartingRef.current = false
    }
  }

  async function finaliseWebRecording(mimeType: string, recordedSeconds: number) {
    if (webRecordingFinalizingRef.current) return
    webRecordingFinalizingRef.current = true
    try {
      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (chunks.length === 0) return

      const storageContentType = voicePlaybackMimeType(null, mimeType)
      const blob = new Blob(chunks, { type: storageContentType })
      if (blob.size > MEDIA_LIMITS_BYTES.voiceNote) {
        setError('Voice note too large. Keep recordings under 25 MB.')
        return
      }

      const ext = storageContentType === 'audio/mp4' ? 'm4a' : 'aac'
      const filename = `messages/${order.id}/${Date.now()}.${ext}`
      setBusy(true)
      setUploadStatus('Uploading voice note...')
      try {
        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from('message-media')
          .upload(filename, blob, { contentType: storageContentType, upsert: false })
        if (uploadError) throw uploadError
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'VOICE',
          voiceUrl: filename,
          voiceDuration: Math.max(1, recordedSeconds),
        })
        setSuccess('Voice note sent inside the protected order thread.')
        onRefresh()
      } catch (voiceError) {
        setError(friendlyActionError(voiceError, 'Voice note could not send. Please try again.'))
      } finally {
        setBusy(false)
        setUploadStatus(null)
      }
    } finally {
      webRecordingFinalizingRef.current = false
      webRecordingStoppingRef.current = false
      webRecordingCancelledRef.current = false
      webRecordingSecondsRef.current = 0
    }
  }

  function stopWebRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive' || webRecordingStoppingRef.current) return
    webRecordingStoppingRef.current = true
    try {
      recorder.stop()
    } catch {
      webRecordingStoppingRef.current = false
      setError('Voice recording could not stop cleanly. Please try again.')
    }
  }

  function formatWebDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (!canMessage) {
    return (
      <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is closed, so the web thread is read-only.
      </p>
    )
  }

  return (
    <div className="grid min-w-0 gap-0 overflow-hidden">
      <ActionNotice error={error} success={success} />
      {callLifecycleEvent ? <CallLifecycleEventCard event={callLifecycleEvent} /> : null}

      {/* Toolbar — always visible */}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 pb-2">
        {/* Hidden file input */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null
            setError(null)
            setPhotoFile(nextFile)
          }}
          disabled={busy}
        />
        <IconButton
          title="Attach media"
          label="Attach media"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy || webRecording}
          variant={photoFile ? 'secondary' : 'ghost'}
          size="icon-sm"
        >
          <Paperclip className="size-4.5" />
        </IconButton>
        {/* Voice note */}
        {webRecording ? (
          <>
            <span className="ml-1 min-w-[2.5rem] text-xs font-semibold tabular-nums text-needle">
              {formatWebDuration(webRecordingSeconds)}
            </span>
            <IconButton
              title="Send voice note"
              label="Send voice note"
              onClick={() => { void stopWebRecording() }}
              variant="secondary"
              size="icon-sm"
            >
              <Square className="size-4 fill-current" />
            </IconButton>
            <IconButton
              title="Cancel recording"
              label="Cancel recording"
              onClick={cancelWebRecording}
              variant="destructive"
              size="icon-sm"
            >
              <X className="size-4" />
            </IconButton>
          </>
        ) : (
          <IconButton
            title="Record voice note"
            label="Record voice note"
            onClick={() => { void startWebRecording() }}
            disabled={busy}
            variant="ghost"
            size="icon-sm"
          >
            <Mic className="size-4.5" />
          </IconButton>
        )}
        {canShowCallButtons ? (
          <>
            <IconButton
              title="Audio call"
              label="Start audio call"
              onClick={() => { void startCall('audio') }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'audio' ? <LoaderCircle className="size-4 animate-spin" /> : <Phone className="size-4.5" />}
            </IconButton>
            <IconButton
              title="Video call"
              label="Start video call"
              onClick={() => { void startCall('video') }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'video' ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4.5" />}
            </IconButton>
          </>
        ) : null}
        {uploadStatus ? (
          <span className="ml-1 text-xs font-semibold text-needle">{uploadStatus}</span>
        ) : null}
        {consultationLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">Consultation: {consultationLabel}</span>
        ) : readyMadeCallLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">Call: {readyMadeCallLabel}</span>
        ) : null}
      </div>

      {consultationPaymentBlocked && !callLifecycleEvent ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-rust/16 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
          <span className="font-semibold">Consultation fee required before the room can open</span>
          <Link
            href={viewerIsCustomer ? accountRoute(`/account/checkout/${order.id}`) : accountRoute(`/account/orders/${order.id}`)}
            className="font-semibold text-needle"
          >
            {viewerIsCustomer ? 'Pay now' : 'View order'}
          </Link>
        </div>
      ) : null}

      {/* Photo preview */}
      {photoFile ? (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3 rounded-lg border border-needle/15 bg-needle/6 px-3 py-2 text-xs text-needle">
          <span className="truncate font-semibold">{photoFile.name}</span>
          <Button
            type="button"
            onClick={() => { setPhotoFile(null); if (photoInputRef.current) photoInputRef.current.value = '' }}
            variant="ghost"
            size="sm"
            className="shrink-0 text-rust hover:text-rust"
          >
            Remove
          </Button>
        </div>
      ) : null}

      {/* Textarea + send */}
      <div className="flex items-end gap-2 rounded-lg border border-ui-border bg-white p-2 shadow-sm focus-within:border-needle/45 focus-within:ring-2 focus-within:ring-needle/10">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Reply</span>
          <Textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              broadcastTyping(true)
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
              typingTimerRef.current = setTimeout(() => broadcastTyping(false), 2000)
            }}
            rows={2}
            maxLength={2000}
            className="max-h-36 min-h-11 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
            placeholder="Message..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
        </label>
        <Button
          type="button"
          onClick={() => { void sendMessage() }}
          disabled={busy || webRecording}
          size="icon"
          className="mb-0.5 shrink-0 rounded-lg"
          aria-label={busy ? 'Sending message' : 'Send message'}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4.5" />}
        </Button>
      </div>

      {canRequestConsultation ? (
        <DisclosurePanel
          title="Request consultation"
          summary={consultationTime ? 'Consultation time set' : 'Ask the tailor to meet before quoting.'}
        >
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Preferred date &amp; time</span>
                <input
                  type="datetime-local"
                  value={consultationTime}
                  onChange={(event) => setConsultationTime(event.target.value)}
                  className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
                />
              </label>
              <button
                type="button"
                onClick={() => { void requestConsultation() }}
                disabled={!!callBusy}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {callBusy === 'consultation' ? 'Sending...' : 'Request'}
              </button>
            </div>
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Optional note about fit, fabric, event timing, or questions."
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
            />
            <p className="text-xs leading-5 text-ink/48">
              Consultation requests are for custom orders before quote. The tailor must approve or reschedule before the call opens.
            </p>
          </div>
        </DisclosurePanel>
      ) : consultationMeta ? (
        <div className="mt-3 rounded-[8px] border border-needle/12 bg-needle/6 px-3 py-2 text-xs leading-5 text-needle">
          {consultationMeta.status === 'REQUESTED'
            ? `Consultation requested${consultationLabel ? ` for ${consultationLabel}` : ''}. The tailor needs to approve it before the call opens.`
            : consultationMeta.status === 'SCHEDULED'
              ? `Consultation scheduled${consultationLabel ? ` for ${consultationLabel}` : ''}. Use the call buttons near the scheduled time.`
              : `Consultation ${cleanLabel(consultationMeta.status, 'requested').toLowerCase()}${consultationLabel ? ` for ${consultationLabel}` : ''}.`}
        </div>
      ) : null}

      {/* Ready-made call schedule */}
      {canScheduleReadyMadeCall ? (
        <DisclosurePanel
          title="Schedule call"
          summary={readyMadeCallLabel ? `Scheduled ${readyMadeCallLabel}` : callTime ? 'Call time set' : 'Use a call for active-order pickup, delivery, sizing, or item-condition clarity.'}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_auto] md:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Date &amp; time</span>
              <input
                ref={readyMadeCallTimeInputRef}
                type="datetime-local"
                value={callTime}
                onChange={(event) => setCallTime(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Reason</span>
              <select
                value={callReason}
                onChange={(event) => setCallReason(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {CALL_SCHEDULING_POLICY.reasons.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => { void scheduleReadyMadeCall() }}
              disabled={!!callBusy}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 md:col-auto"
            >
              {callBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </DisclosurePanel>
      ) : isReadyMade ? (
        <p className="mt-3 rounded-[8px] border border-ink/8 bg-bone/55 px-3 py-2 text-xs leading-5 text-ink/54">
          Use Messages for item questions before checkout. Ready-made calls open after checkout when the order is active.
        </p>
      ) : null}
    </div>
  )
}

function ManualMeasurementEditor({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const account = useAccountContext()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('Me')
  const [relationship, setRelationship] = useState('SELF')
  const [unit, setUnit] = useState('in')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [customMeasurements, setCustomMeasurements] = useState<Array<{ id: string; name: string; value: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const customMeasurementCounterRef = useRef(0)
  const coreFieldNames = CORE_MEASUREMENT_FIELDS
  const coreFieldKeys = new Set<string>(coreFieldNames.map((field) => field.key))
  const additionalFieldNames = MEASUREMENT_FIELD_KEYS
    .filter((key) => !coreFieldKeys.has(key))
    .map((key) => ({ key, label: MEASUREMENT_FIELD_LABELS[key] }))
  const allFieldNames = [...coreFieldNames, ...additionalFieldNames]

  function customMeasurementId() {
    customMeasurementCounterRef.current += 1
    return `custom_${customMeasurementCounterRef.current}`
  }

  function addCustomMeasurement(name = '', value = '') {
    setCustomMeasurements((current) => [...current, { id: customMeasurementId(), name, value }])
  }

  function updateCustomMeasurement(id: string, field: 'name' | 'value', value: string) {
    setCustomMeasurements((current) => current.map((measurement) => (
      measurement.id === id ? { ...measurement, [field]: value } : measurement
    )))
  }

  function removeCustomMeasurement(id: string) {
    setCustomMeasurements((current) => current.filter((measurement) => measurement.id !== id))
  }

  function startEdit(profile: MeasurementProfile) {
    const nextMeasurements = measurementsForProfile(profile, data.customerProfile)
    const specialistBackedKeys = specialistMeasurementProfileValueKeys(nextMeasurements)
    setEditingId(profile.id)
    setLabel(profile.label ?? 'Me')
    setRelationship(profile.relationship ?? 'SELF')
    setUnit(profile.unit_preference ?? data.customerProfile?.unit_preference ?? 'in')
    setFields(Object.fromEntries(allFieldNames.map((field) => {
      const value = measurementEditorValue(nextMeasurements, field)
      return [field.key, typeof value === 'number' || typeof value === 'string' ? String(value) : '']
    })))
    setCustomMeasurements(Object.entries(nextMeasurements)
      .filter(([key, value]) => !specialistBackedKeys.has(key) && isEditableCustomMeasurementKey(key, value))
      .map(([name, value]) => ({
        id: customMeasurementId(),
        name,
        value: String(value),
      })))
    setError(null)
    setSuccess(null)
    setEditorOpen(true)
  }

  function requestEdit(profile: MeasurementProfile) {
    startEdit(profile)
  }

  function startNewProfile() {
    resetForm()
    setError(null)
    setSuccess(null)
    setEditorOpen(true)
  }

  function closeEditor() {
    resetForm()
    setError(null)
    setEditorOpen(false)
  }

  function resetForm() {
    setEditingId(null)
    setLabel('Me')
    setRelationship('SELF')
    setUnit('in')
    setFields({})
    setCustomMeasurements([])
  }

  async function saveProfile() {
    setError(null)
    setSuccess(null)
    if (!account.userId) return
    const labelLeak = assertNoContactLeak(label, "Measurement profile names can't include contact details.")
    if (labelLeak) {
      setError(labelLeak)
      return
    }
    const numericMeasurements = Object.fromEntries(
      allFieldNames
        .map((field) => [field.key, Number.parseFloat(fields[field.key] ?? '')] as const)
        .filter(([, value]) => Number.isFinite(value) && value > 0),
    ) as Record<string, number>
    const coreMeasurementCount = coreFieldNames.filter((field) => {
      const value = numericMeasurements[field.key]
      return typeof value === 'number' && Number.isFinite(value) && value > 0
    }).length
    if (coreMeasurementCount < 4) {
      setError('Add at least height, chest, waist, and hips before saving a profile.')
      return
    }
    const customMeasurementPayload: Record<string, number> = {}
    const seenCustomNames = new Set<string>()
    for (const customMeasurement of customMeasurements) {
      const name = customMeasurement.name.trim()
      const rawValue = customMeasurement.value.trim()
      if (!name && !rawValue) continue
      if (!name || !rawValue) {
        setError('Each custom measurement needs both a name and a value.')
        return
      }
      const nameLeak = assertNoContactLeak(name, "Custom measurement names can't include contact details.")
      if (nameLeak) {
        setError(nameLeak)
        return
      }
      if (!isEditableCustomMeasurementKey(name, rawValue)) {
        setError('Use a normal measurement name for custom tape points.')
        return
      }
      const duplicateKey = name.toLowerCase()
      if (seenCustomNames.has(duplicateKey)) {
        setError('Custom measurement names must be unique.')
        return
      }
      const value = Number.parseFloat(rawValue)
      if (!Number.isFinite(value) || value <= 0) {
        setError('Custom measurement values must be positive numbers.')
        return
      }
      seenCustomNames.add(duplicateKey)
      customMeasurementPayload[name] = value
    }
    setBusy(true)
    const supabase = createClient()
    const now = new Date().toISOString()
    const trimmedLabel = label.trim() || 'Me'
    const editingProfile = data.measurementProfiles.find((profile) => profile.id === editingId)
    const existingMeasurements = editingProfile ? measurementsForProfile(editingProfile, data.customerProfile) : null
    const measurements = buildMeasurementProfileStoragePayload({
      ...preservedMeasurementMeta(existingMeasurements),
      ...numericMeasurements,
      ...customMeasurementPayload,
      unit,
      measurementSource: 'MANUAL',
      measurementProfileLabel: trimmedLabel,
      measurementProfileUpdatedAt: now,
    })
    const payload = {
      label: trimmedLabel,
      relationship,
      unit_preference: unit,
      source: 'MANUAL',
      measurements,
      last_measured_at: now,
      updated_at: now,
    }
    const shouldMirrorToCustomerProfile = editingId ? editingProfile?.is_default === true : data.measurementProfiles.length === 0
    const result = editingId
      ? await supabase.from('customer_measurement_profiles').update(payload).eq('id', editingId)
      : await supabase.from('customer_measurement_profiles').insert({
          ...payload,
          customer_id: account.userId,
          is_default: data.measurementProfiles.length === 0,
        })
    if (result.error) {
      setBusy(false)
      setError('Measurements could not save. Please refresh and try again.')
      return
    }
    if (shouldMirrorToCustomerProfile) {
      const mirrorResult = await supabase.from('customer_profiles').upsert(
        {
          user_id: account.userId,
          measurements,
          unit_preference: unit,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      )
      if (mirrorResult.error) {
        setBusy(false)
        setError('Measurements saved, but app profile sync could not finish. Refresh and try again.')
        onRefresh()
        return
      }
    }
    setBusy(false)
    setSuccess(editingId ? 'Measurement profile updated.' : 'Measurement profile saved.')
    resetForm()
    setEditorOpen(false)
    onRefresh()
  }

  if (!editorOpen) {
    return (
      <Surface className="grid gap-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Measurements</p>
          <h3 className="mt-1 text-xl font-semibold text-ink">Review saved profiles</h3>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            Values stay read-only here until you choose to add or edit a profile.
          </p>
        </div>
        <ActionNotice error={error} success={success} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button onClick={startNewProfile}>
            Add measurements
          </Button>
          {data.measurementProfiles.map((profile) => (
            <Button key={profile.id} variant="secondary" onClick={() => requestEdit(profile)}>
              Edit {safeUserText(profile.label, 'profile')}
            </Button>
          ))}
        </div>
      </Surface>
    )
  }

  return (
    <Surface className="grid gap-4 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Manual profile</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{editingId ? 'Update wearer measurements' : 'Add wearer measurements'}</h3>
      </div>
      <ActionNotice error={error} success={success} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Profile name">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="Wearer">
          <NativeSelect value={relationship} onChange={(event) => setRelationship(event.target.value)}>
            <option value="SELF">Me</option>
            <option value="SPOUSE">Spouse</option>
            <option value="PARENT">Parent</option>
            <option value="CHILD">Child</option>
            <option value="FRIEND">Friend</option>
            <option value="GROUP_MEMBER">Group member</option>
            <option value="OTHER">Someone else</option>
          </NativeSelect>
        </Field>
        <Field label="Unit">
          <NativeSelect value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="in">Inches</option>
            <option value="cm">Centimetres</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {coreFieldNames.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              inputMode="decimal"
              value={fields[field.key] ?? ''}
              onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      <DisclosurePanel
        title="Additional measurements"
        summary="Add optional body areas or custom tape points a tailor asked for. Blank optional fields stay out of the saved profile."
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {additionalFieldNames.map((field) => (
              <Field key={field.key} label={field.label}>
                <Input
                  inputMode="decimal"
                  value={fields[field.key] ?? ''}
                  onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 rounded-[8px] border border-ink/6 bg-bone/35 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Custom tape points</p>
                <p className="mt-1 text-xs leading-5 text-ink/56">Use these for garment-specific points that are not listed above.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => addCustomMeasurement()} className="w-fit">
                Add custom point
              </Button>
            </div>
            {customMeasurements.length > 0 ? (
              <div className="grid gap-2">
                {customMeasurements.map((measurement) => (
                  <div key={measurement.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
                    <Input
                      value={measurement.name}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'name', event.target.value)}
                      placeholder="e.g. Ankle"
                    />
                    <Input
                      inputMode="decimal"
                      value={measurement.value}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'value', event.target.value)}
                      placeholder={`0 ${unit}`}
                    />
                    <Button variant="secondary" onClick={() => removeCustomMeasurement(measurement.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </DisclosurePanel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={saveProfile} disabled={busy}>
          {busy ? 'Saving...' : editingId ? 'Update profile' : 'Save profile'}
        </Button>
        <Button variant="secondary" onClick={closeEditor}>
          Cancel edit
        </Button>
      </div>
    </Surface>
  )
}

function SellerItemManager({
  data,
  onRefresh,
}: {
  data: Pick<ShopRenderData, 'userId' | 'tailorProfile' | 'pickupDetails' | 'sellerItems'>
  onRefresh: () => void
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(data.tailorProfile?.currency ?? 'USD')
  const [sizes, setSizes] = useState('M')
  const [inventory, setInventory] = useState('1')
  const [fitGuideUnit, setFitGuideUnit] = useState<ReadyMadeFitUnit>('in')
  const [fitGuideFields, setFitGuideFields] = useState<ReadyMadeFitFieldKey[]>(FALLBACK_READY_MADE_FIT_FIELDS)
  const [fitGuideDraft, setFitGuideDraft] = useState<ReadyMadeSizeGuideDraft>({})
  const [activeFitGuideSize, setActiveFitGuideSize] = useState<string | null>(null)
  const [fitNotes, setFitNotes] = useState('')
  const [stretchNotes, setStretchNotes] = useState('')
  const [sizeAdvice, setSizeAdvice] = useState<ReadyMadeFitAdvice>('ASK_SELLER')
  const [fulfillment, setFulfillment] = useState({ pickup: true, delivery: false, shipping: false })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [publish, setPublish] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
  const [readyMadeInspectIndex, setReadyMadeInspectIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const readiness = deriveWebTailorReadiness(data.tailorProfile)
  const sellerType = data.tailorProfile?.seller_type
  const isOnboardingProofMode = !readiness.publicDiscoveryReady && (sellerType === 'BOUTIQUE' || sellerType === 'TAILOR_SHOP')
  const canPublishLive = data.tailorProfile?.supports_ready_made === true && readiness.canPublishPaidItems
  const hasPickupAddress = hasNonEmptyText(data.pickupDetails?.pickup_address)
  const publishBlockedReason = !data.tailorProfile?.supports_ready_made
    ? 'Enable ready-made shop in Selling setup before publishing live items.'
    : !readiness.canPublishPaidItems
      ? readiness.body
      : fulfillment.pickup && !hasPickupAddress
        ? 'Add the exact private pickup address in Profile before publishing a pickup item.'
        : null
  const publishBlocked = !isOnboardingProofMode && publish && !!publishBlockedReason
  const draftSizes = splitList(sizes)
  const selectedFitGuideSize = activeFitGuideSize && draftSizes.includes(activeFitGuideSize)
    ? activeFitGuideSize
    : draftSizes[0] ?? null
  const currentSizeAdvice = READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.find((option) => option.value === sizeAdvice)
  const currentFitGuide = draftToWebReadyMadeSizeGuide({
    sizes: draftSizes,
    unit: fitGuideUnit,
    fields: fitGuideFields,
    draft: fitGuideDraft,
    fitNotes,
    stretchNotes,
    sizeAdvice,
  })
  const currentFitGuideReady = hasReadyMadeSizeGuide(currentFitGuide, draftSizes)
  const portfolioVideoUrls = stringList(data.tailorProfile?.portfolio_video_urls)
  const readyMadeMediaEntries: SortableMediaEntry[] = existingPhotoUrls.map((url, index) => ({
    id: `ready-made-${index}-${url}`,
    url,
    label: `Product media ${index + 1}`,
  }))

  function resetForm() {
    setEditingItemId(null)
    setExistingPhotoUrls([])
    setReadyMadeInspectIndex(null)
    setTitle('')
    setCategory('')
    setDescription('')
    setPrice('')
    setCurrency(data.tailorProfile?.currency ?? 'USD')
    setSizes('M')
    setInventory('1')
    setFitGuideUnit('in')
    setFitGuideFields(FALLBACK_READY_MADE_FIT_FIELDS)
    setFitGuideDraft({})
    setActiveFitGuideSize(null)
    setFitNotes('')
    setStretchNotes('')
    setSizeAdvice('ASK_SELLER')
    setFulfillment({ pickup: true, delivery: false, shipping: false })
    setPhotoFile(null)
    setPublish(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  function toggleFitGuideField(field: ReadyMadeFitFieldKey) {
    setFitGuideFields((current) =>
      current.includes(field)
        ? current.filter((entry) => entry !== field)
        : [...current, field],
    )
  }

  function setFitGuideRange(size: string, field: ReadyMadeFitFieldKey, edge: 'min' | 'max', value: string) {
    const nextValue = fitGuideInputValue(value)
    setFitGuideDraft((current) => {
      const currentSize = current[size] ?? {}
      const currentRange = currentSize[field] ?? { min: '', max: '' }
      return {
        ...current,
        [size]: {
          ...currentSize,
          [field]: {
            ...currentRange,
            [edge]: nextValue,
          },
        },
      }
    })
  }

  function applyRecommendedFitGuideFields() {
    setFitGuideFields(recommendedReadyMadeFitFieldsForCategory(category))
  }

  function startEditItem(item: SellerItem) {
    setError(null)
    setSuccess(null)
    if (item.is_live && item.stock_status !== 'SOLD_OUT') {
      setError('Unpublish this item before editing it. This prevents customers from buying while details are changing.')
      return
    }
    setEditingItemId(item.id)
    setExistingPhotoUrls(stringList(item.photo_urls))
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setPrice(minorUnitsInput(item.price_amount))
    setCurrency(item.currency ?? data.tailorProfile?.currency ?? 'USD')
    const itemSizes = stringList(item.sizes)
    setSizes(itemSizes.join(', ') || 'M')
    setInventory(String(item.inventory_quantity ?? 1))
    const normalizedGuide = normalizeWebReadyMadeSizeGuide(item.size_guide, itemSizes)
    const nextFitGuideFields = normalizedGuide.fields.length > 0
      ? normalizedGuide.fields
      : recommendedReadyMadeFitFieldsForCategory(item.category)
    setFitGuideUnit(normalizedGuide.unit)
    setFitGuideFields(nextFitGuideFields)
    setFitGuideDraft(guideDraftFromWebReadyMadeSizeGuide({
      sizes: itemSizes,
      fields: nextFitGuideFields,
      guide: normalizedGuide,
    }))
    setActiveFitGuideSize(itemSizes[0] ?? null)
    setFitNotes(normalizedGuide.fitNotes ?? '')
    setStretchNotes(normalizedGuide.stretchNotes ?? '')
    setSizeAdvice(normalizedGuide.sizeAdvice ?? 'ASK_SELLER')
    setFulfillment({
      pickup: item.pickup_available ?? true,
      delivery: item.delivery_available ?? false,
      shipping: item.shipping_available ?? false,
    })
    setPhotoFile(null)
    setPublish(item.is_live ?? false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function chooseReadyMadeMedia(file: File | null) {
    setError(null)
    if (!file) {
      setPhotoFile(null)
      return
    }
    if (existingPhotoUrls.length >= MAX_READY_MADE_MEDIA) {
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      setError(`Remove one media item first. Ready-made items can have up to ${MAX_READY_MADE_MEDIA} media files.`)
      return
    }

    try {
      await prepareReadyMadeMediaFile(file)
      setPhotoFile(file)
    } catch (mediaError) {
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      setError(friendlyActionError(mediaError, 'This media file could not be used.'))
    }
  }

  function attachPortfolioVideo(videoUrl: string) {
    setError(null)
    setExistingPhotoUrls((current) => {
      if (current.includes(videoUrl)) return current
      if (current.length >= MAX_READY_MADE_MEDIA) {
        setError(`Remove one media item first. Ready-made items can have up to ${MAX_READY_MADE_MEDIA} media files.`)
        return current
      }
      return [...current, videoUrl]
    })
  }

  async function saveItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    const textToCheck = [title, category, description, fitNotes, stretchNotes].filter(Boolean).join('\n')
    const leak = assertNoContactLeak(textToCheck, "Ready-made listings can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    const priceAmount = parseMinorUnits(price)
    const nextSizes = splitList(sizes)
    const sizeInventory = parseInventoryFromSizes(nextSizes, inventory)
    const inventoryQuantity = Object.values(sizeInventory).reduce((sum, value) => sum + value, 0)
    const nextSizeGuide = draftToWebReadyMadeSizeGuide({
      sizes: nextSizes,
      unit: fitGuideUnit,
      fields: fitGuideFields,
      draft: fitGuideDraft,
      fitNotes,
      stretchNotes,
      sizeAdvice,
    })
    const mediaCount = existingPhotoUrls.length + (photoFile ? 1 : 0)
    if (isOnboardingProofMode) {
      const proofIssues = getOnboardingProofItemIssues({
        title,
        category,
        description,
        mediaCount,
        sizes: nextSizes,
        inventoryQuantity,
      })
      if (proofIssues.length > 0) {
        setError(proofIssues[0]?.message ?? 'Finish the required setup item details.')
        return
      }
    } else {
      if (!title.trim() || !category.trim() || !description.trim() || !priceAmount || nextSizes.length === 0) {
        setError('Add title, category, description, price, and at least one size.')
        return
      }
      if (publishBlocked) {
        setError(publishBlockedReason ?? 'Finish go-live checks before publishing this item.')
        return
      }
      if (publish) {
        const liveIssues = readyMadeLiveListingIssues({
          category,
          description,
          sizes: nextSizes,
          photoCount: mediaCount,
          inventoryQuantity,
          hasSizeGuide: hasStructuredReadyMadeSizeGuide(nextSizeGuide, nextSizes),
          requiresPickupAddress: fulfillment.pickup && !hasPickupAddress,
        })
        if (liveIssues.length > 0) {
          setError(liveIssues[0] ?? 'Finish go-live checks before publishing this item.')
          return
        }
      }
    }
    setBusy(true)
    try {
      const preparedMedia = photoFile ? await prepareReadyMadeMediaFile(photoFile) : null
      const uploadedMediaUrl = preparedMedia
        ? await uploadPublicFile(
            'seller-item-media',
            `shop/${data.userId}/${readyMadeMediaContentType(preparedMedia)?.startsWith('video/') ? 'videos' : 'photos'}`,
            preparedMedia,
          )
        : null
      const photoUrls = uploadedMediaUrl
        ? [...new Set([...existingPhotoUrls, uploadedMediaUrl])].slice(0, MAX_READY_MADE_MEDIA)
        : existingPhotoUrls
      const result = await invokeAccountFunction<{ isLive?: boolean }>('seller-item-action', {
        action: editingItemId ? 'update-item' : 'create-item',
        itemId: editingItemId ?? undefined,
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        sizes: nextSizes,
        sizeInventory,
        priceAmount: isOnboardingProofMode ? null : priceAmount,
        currency,
        photoUrls,
        inventoryQuantity,
        sizeGuide: isOnboardingProofMode ? null : nextSizeGuide,
        pickupAvailable: isOnboardingProofMode ? false : fulfillment.pickup,
        deliveryAvailable: isOnboardingProofMode ? false : fulfillment.delivery,
        shippingAvailable: isOnboardingProofMode ? false : fulfillment.shipping,
        isLive: isOnboardingProofMode ? false : publish,
        onboarding: isOnboardingProofMode,
      })
      const savedLive = result.isLive === true
      setSuccess(isOnboardingProofMode
        ? 'Ready-made proof item saved for setup review.'
        : editingItemId
          ? savedLive ? 'Ready-made item updated and published.' : 'Ready-made draft updated.'
          : savedLive ? 'Ready-made item saved and publish checks passed.' : 'Ready-made draft saved.')
      resetForm()
      onRefresh()
    } catch (itemError) {
      setError(friendlyActionError(itemError, 'Ready-made item could not save. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function runSellerItemAction(action: 'publish-item' | 'hide-item' | 'delete-item', item: SellerItem) {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    if (action === 'delete-item') {
      const confirmed = window.confirm('Delete this hidden draft permanently? Items with order history cannot be deleted.')
      if (!confirmed) return
    }
    if (action === 'publish-item') {
      if (!canPublishLive) {
        setError(data.tailorProfile?.supports_ready_made === false
          ? 'Enable ready-made shop in Selling setup before publishing live items.'
          : readiness.body)
        return
      }
      const itemSizes = stringList(item.sizes)
      const liveIssues = readyMadeLiveListingIssues({
        category: item.category,
        description: item.description ?? '',
        sizes: itemSizes,
        photoCount: stringList(item.photo_urls).length,
        inventoryQuantity: readyMadeInventoryCount(item),
        hasSizeGuide: hasStructuredReadyMadeSizeGuide(item.size_guide, itemSizes),
        requiresPickupAddress: (item.pickup_available ?? false) && !hasPickupAddress,
      })
      if (liveIssues.length > 0) {
        setError(liveIssues[0] ?? 'Finish go-live checks before publishing this item.')
        return
      }
    }
    const busyKey = `${action}:${item.id}`
    setActionBusy(busyKey)
    try {
      await invokeAccountFunction('seller-item-action', {
        action,
        itemId: item.id,
      })
      if (editingItemId === item.id && (action === 'hide-item' || action === 'delete-item')) {
        resetForm()
      }
      setSuccess(action === 'publish-item'
        ? 'Item published after preflight checks.'
        : action === 'hide-item'
          ? 'Item hidden from customers.'
          : 'Hidden draft deleted.')
      onRefresh()
    } catch (itemError) {
      setError(friendlyActionError(itemError, 'Shop item action could not be completed. Refresh and try again.'))
    } finally {
      setActionBusy(null)
    }
  }

  if (!data.tailorProfile) return null

  return (
    <Surface className="overflow-hidden">
      {readyMadeInspectIndex != null ? (
        <MediaInspectionOverlay
          entries={readyMadeMediaEntries}
          initialIndex={readyMadeInspectIndex}
          onClose={() => setReadyMadeInspectIndex(null)}
        />
      ) : null}
      <SurfaceHeader
        eyebrow={isOnboardingProofMode ? 'Setup proof' : 'Catalogue'}
        title={isOnboardingProofMode ? 'Add ready-made proof item' : editingItemId ? 'Edit listing' : 'Add a listing'}
        description={isOnboardingProofMode ? 'Add one inspectable ready-made item for setup review. It stays hidden from buyers; pricing and go-live setup happen later in Catalogue.' : 'Publishing checks photos, sizes, stock, fit guide, fulfillment, and payout readiness. Unpublish items before editing.'}
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        {!isOnboardingProofMode && (!canPublishLive || (fulfillment.pickup && !hasPickupAddress)) ? (
          <div className={`rounded-[8px] border p-4 ${
            canPublishLive && fulfillment.pickup && !hasPickupAddress
              ? 'border-amber-300/35 bg-amber-400/8'
              : 'border-rust/18 bg-rust/8'
          }`}>
            <p className="text-sm font-semibold text-ink">
              {canPublishLive ? 'Pickup needs private details' : readiness.title}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-ink/62">
              {data.tailorProfile?.supports_ready_made === false
                ? 'Draft items are fine, but live ready-made listings should stay hidden until ready-made shop is enabled on your tailor profile.'
                : canPublishLive
                  ? 'Drafts can still be saved. To publish pickup items, add the exact private pickup address in Profile first.'
                  : readiness.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {!canPublishLive && readiness.actionHref ? (
                <Link href={readiness.actionHref} className="text-sm font-semibold text-needle">{readiness.actionLabel ?? 'Review readiness'} →</Link>
              ) : null}
              {(fulfillment.pickup && !hasPickupAddress) || data.tailorProfile?.supports_ready_made === false ? (
                <Link href="/account/profile" className="text-sm font-semibold text-needle">Open Selling setup →</Link>
              ) : null}
              {!readiness.identityVerified && !readiness.actionHref ? (
                <OpenAppButton label={readiness.actionLabel ?? 'Open app verification'} className="text-sm font-semibold text-needle" />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </Field>
        <div className="grid gap-3 md:grid-cols-4">
          {!isOnboardingProofMode ? (
          <Field label="Price">
            <Input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          ) : null}
          {!isOnboardingProofMode ? (
          <Field label="Currency">
            <NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
            </NativeSelect>
          </Field>
          ) : null}
          <Field label="Sizes">
            <Input value={sizes} onChange={(event) => setSizes(event.target.value)} />
          </Field>
          <Field label="Stock">
            <Input inputMode="numeric" value={inventory} onChange={(event) => setInventory(event.target.value)} />
          </Field>
        </div>
        {!isOnboardingProofMode ? (
        <div className="grid gap-4 rounded-[8px] border border-ink/8 bg-bone/35 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Fit guide</p>
              <p className="mt-1 text-xs leading-5 text-ink/56">Add the buyer measurement ranges that should fit each size.</p>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
              currentFitGuideReady ? 'bg-needle/10 text-needle' : 'bg-amber-400/12 text-amber-800'
            }`}>
              {currentFitGuideReady ? 'Fit guide ready' : 'Required before live'}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Unit">
              <NativeSelect
                value={fitGuideUnit}
                onChange={(event) => setFitGuideUnit(event.target.value === 'cm' ? 'cm' : 'in')}
              >
                <option value="in">Inches</option>
                <option value="cm">Centimetres</option>
              </NativeSelect>
            </Field>
            <Field label="Buyer guidance" hint={currentSizeAdvice?.hint ?? 'Tell buyers how to choose when they sit between sizes.'}>
              <NativeSelect
                value={sizeAdvice}
                onChange={(event) => setSizeAdvice(event.target.value as ReadyMadeFitAdvice)}
              >
                {READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Measurements</span>
                <p className="mt-1 text-xs leading-5 text-ink/52">{fitGuideFieldsSummary(fitGuideFields)}</p>
              </div>
              <Button
                onClick={applyRecommendedFitGuideFields}
                variant="secondary"
                size="sm"
                className="w-fit"
              >
                Use category defaults
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {READY_MADE_FIT_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-2 rounded-[8px] border border-ui-border bg-white px-3 py-2 text-xs font-semibold text-ink">
                  <span>{field.label}</span>
                  <Switch checked={fitGuideFields.includes(field.key)} onCheckedChange={() => toggleFitGuideField(field.key)} aria-label={`${field.label} fit field`} />
                </div>
              ))}
            </div>
          </div>
          {draftSizes.length === 0 ? (
            <p className="rounded-[8px] border border-amber-300/35 bg-white px-4 py-3 text-sm leading-6 text-ink/62">Add at least one size first, then enter size ranges here.</p>
          ) : fitGuideFields.length === 0 ? (
            <p className="rounded-[8px] border border-amber-300/35 bg-white px-4 py-3 text-sm leading-6 text-ink/62">Choose at least one measurement field. Chest, waist, and hips are a good start for most pieces.</p>
          ) : selectedFitGuideSize ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {draftSizes.map((size) => {
                  const selected = selectedFitGuideSize === size
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setActiveFitGuideSize(size)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                        selected
                          ? 'border-needle bg-needle text-white'
                          : 'border-ink/10 bg-white text-ink'
                      }`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
              <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">Size {selectedFitGuideSize}</p>
                  <p className="mt-1 text-xs leading-5 text-ink/52">Enter the buyer range that should fit this size.</p>
                </div>
                <div className="grid gap-3">
                  {fitGuideFields.map((field) => (
                    <div key={`${selectedFitGuideSize}-${field}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center">
                      <span className="text-sm font-semibold text-ink">{readyMadeFitFieldLabel(field)}</span>
                      <Input
                        inputMode="decimal"
                        value={fitGuideDraft[selectedFitGuideSize]?.[field]?.min ?? ''}
                        onChange={(event) => setFitGuideRange(selectedFitGuideSize, field, 'min', event.target.value)}
                        placeholder={`Min ${fitGuideUnit}`}
                      />
                      <Input
                        inputMode="decimal"
                        value={fitGuideDraft[selectedFitGuideSize]?.[field]?.max ?? ''}
                        onChange={(event) => setFitGuideRange(selectedFitGuideSize, field, 'max', event.target.value)}
                        placeholder={`Max ${fitGuideUnit}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Fit notes">
              <Textarea
                value={fitNotes}
                onChange={(event) => setFitNotes(event.target.value)}
                rows={3}
                placeholder="Example: relaxed through the chest, structured shoulders."
              />
            </Field>
            <Field label="Stretch notes">
              <Textarea
                value={stretchNotes}
                onChange={(event) => setStretchNotes(event.target.value)}
                rows={3}
                placeholder="Example: no stretch, choose the larger size if unsure."
              />
            </Field>
          </div>
        </div>
        ) : null}
        <div className={isOnboardingProofMode ? 'grid gap-3' : 'grid gap-3 md:grid-cols-[1fr_1fr]'}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Product media</span>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={(event) => { void chooseReadyMadeMedia(event.target.files?.[0] ?? null) }}
              className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink"
            />
            <span className="text-xs leading-5 text-ink/52">
              {editingItemId && !photoFile && existingPhotoUrls.length > 0
                ? `${existingPhotoUrls.length} existing media item${existingPhotoUrls.length === 1 ? '' : 's'} will be kept.`
                : 'Choose a garment photo or a video up to 30 seconds.'}
            </span>
            {photoFile ? (
              <span className="text-xs font-semibold text-needle">{photoFile.name} selected</span>
            ) : null}
            {readyMadeMediaEntries.length > 0 ? (
              <div className="grid gap-2 rounded-[8px] border border-ink/8 bg-bone/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Media order</span>
                  <span className="text-xs text-ink/48">First tile is cover</span>
                </div>
                <SortableMediaGrid
                  entries={readyMadeMediaEntries}
                  busy={busy}
                  onInspect={setReadyMadeInspectIndex}
                  onReorder={(nextEntries) => setExistingPhotoUrls(nextEntries.map((entry) => entry.url))}
                  onDelete={(index) => setExistingPhotoUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                />
              </div>
            ) : null}
            {portfolioVideoUrls.length > 0 ? (
              <div className="grid gap-2 rounded-[8px] border border-needle/14 bg-needle/5 p-3">
                <span className="text-xs font-semibold text-needle">Choose from Portfolio Videos</span>
                {portfolioVideoUrls.map((videoUrl, index) => (
                  <button
                    key={videoUrl}
                    type="button"
                    onClick={() => attachPortfolioVideo(videoUrl)}
                    disabled={existingPhotoUrls.includes(videoUrl)}
                    className="flex items-center justify-between gap-3 rounded-full border border-needle/14 bg-white px-4 py-2 text-left text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/36"
                  >
                    <span>Portfolio video {index + 1}</span>
                    <span className="text-needle">{existingPhotoUrls.includes(videoUrl) ? 'Attached' : 'Attach'}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          {!isOnboardingProofMode ? (
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Fulfillment</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                { key: 'pickup', label: 'Pickup' },
                { key: 'delivery', label: 'Delivery' },
                { key: 'shipping', label: 'Shipping' },
              ] as const).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-[8px] border border-ui-border bg-white px-3 py-2.5 text-sm font-semibold text-ink">
                  <span>{label}</span>
                  <Switch checked={fulfillment[key]} onCheckedChange={(checked) => setFulfillment((current) => ({ ...current, [key]: checked }))} aria-label={`${label} fulfillment`} />
                </div>
              ))}
            </div>
          </div>
          ) : null}
        </div>
        {!isOnboardingProofMode ? (
        <div className="flex max-w-md items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-ui-muted/40 px-4 py-3 text-sm font-semibold text-ink">
          <span>Publish after preflight</span>
          <Switch checked={publish} onCheckedChange={setPublish} aria-label="Publish after preflight" />
        </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={saveItem} disabled={busy || publishBlocked} className="w-full sm:w-auto">
            {busy ? 'Saving...' : isOnboardingProofMode ? 'Add item to setup' : editingItemId ? publish ? 'Update and publish' : 'Update draft' : publish ? 'Save and publish' : 'Save draft'}
          </Button>
          {editingItemId ? (
            <Button variant="secondary" onClick={resetForm} disabled={busy} className="w-full sm:w-auto">
              Cancel edit
            </Button>
          ) : null}
        </div>
      </div>
      {data.sellerItems.length > 0 ? (
        <div className="mt-6 border-t border-needle/12 pt-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-xl font-semibold text-ink">{isOnboardingProofMode ? 'Saved proof items' : 'Manage existing listings'}</h3>
            <Button variant="ghost" size="sm" onClick={resetForm}>{isOnboardingProofMode ? 'New proof item' : 'New listing'}</Button>
          </div>
          <div className="mt-4 grid gap-3">
            {data.sellerItems.map((item) => {
              const busyForItem = actionBusy?.endsWith(`:${item.id}`) ?? false
              const canEdit = !item.is_live || item.stock_status === 'SOLD_OUT'
              const isHiddenDraft = !item.is_live && item.stock_status === 'HIDDEN'
              const itemPublishBlocked = !canPublishLive || (item.pickup_available === true && !hasPickupAddress)
              return (
                <div key={item.id} className="rounded-[8px] border border-ink/8 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">{safeUserText(item.category, 'Ready-made')}</p>
                        <StatusChip status={isOnboardingProofMode ? 'HIDDEN_SETUP_PROOF' : item.is_live ? 'PUBLISHED' : item.stock_status} fallback="Draft" />
                      </div>
                      <h4 className="mt-1 font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/58">
                        <span>{formatMoney(item.price_amount, item.currency)}</span>
                        <StatusChip status={item.stock_status} fallback="In stock" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => startEditItem(item)}
                        disabled={!canEdit || busy || !!actionBusy}
                        variant="secondary"
                        size="sm"
                      >
                        Edit
                      </Button>
                      {!isOnboardingProofMode && item.is_live ? (
                        <Button
                          onClick={() => runSellerItemAction('hide-item', item)}
                          disabled={busy || !!actionBusy}
                          variant="secondary"
                          size="sm"
                        >
                          {busyForItem ? 'Hiding...' : 'Hide'}
                        </Button>
                      ) : !isOnboardingProofMode ? (
                        <Button
                          onClick={() => runSellerItemAction('publish-item', item)}
                          disabled={busy || !!actionBusy || itemPublishBlocked}
                          size="sm"
                        >
                          {busyForItem ? 'Publishing...' : itemPublishBlocked ? 'Publishing locked' : 'Publish'}
                        </Button>
                      ) : null}
                      {isHiddenDraft ? (
                        <Button
                          onClick={() => runSellerItemAction('delete-item', item)}
                          disabled={busy || !!actionBusy}
                          variant="outline"
                          size="sm"
                          className="border-rust/20 text-rust hover:bg-rust/5"
                        >
                          {busyForItem ? 'Deleting...' : 'Delete'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {!isOnboardingProofMode && !canEdit ? (
                    <p className="mt-3 text-xs leading-5 text-ink/50">Unpublish this item before editing details, photos, price, sizes, or stock.</p>
                  ) : null}
                  {!isOnboardingProofMode && itemPublishBlocked && !item.is_live ? (
                    <p className="mt-3 text-xs leading-5 text-rust">{item.pickup_available === true && !hasPickupAddress ? 'Add private pickup details before publishing this pickup item.' : readiness.body}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Surface>
  )
}

function TailorOrderActions({ order, data, onRefresh }: { order: AccountOrder; data: OrderActorData; onRefresh: () => void }) {
  const supportMeta = parseOrderSupportMeta(order.special_note)
  const consultationMeta = supportMeta.consultation
  const proposedConsultationStart = consultationMeta?.proposedStartAt ?? consultationMeta?.scheduledStartAt ?? null
  const [quoteAmount, setQuoteAmount] = useState('')
  const [quoteCurrency, setQuoteCurrency] = useState(order.currency ?? data.tailorProfile?.currency ?? 'USD')
  const [completionDate, setCompletionDate] = useState('')
  const [quoteNote, setQuoteNote] = useState('')
  const [consultationStart, setConsultationStart] = useState(() => dateTimeLocalInputValue(proposedConsultationStart))
  const [consultationFee, setConsultationFee] = useState(() => minorUnitsInput(consultationMeta?.feeAmount ?? order.consultation_fee))
  const [consultationNote, setConsultationNote] = useState('')
  const [targetStage, setTargetStage] = useState(nextStageOptions(order)[0] ?? '')
  const [stageNote, setStageNote] = useState('')
  const [stageTrackingNumber, setStageTrackingNumber] = useState('')
  const [stageFulfillmentProvider, setStageFulfillmentProvider] = useState('')
  const [stageFulfillmentReference, setStageFulfillmentReference] = useState('')
  const [stageFulfillmentContactName, setStageFulfillmentContactName] = useState('')
  const [stageFulfillmentContactPhone, setStageFulfillmentContactPhone] = useState('')
  const [stageMediaFiles, setStageMediaFiles] = useState<File[]>([])
  const [measurementNote, setMeasurementNote] = useState('')
  const [measurementFields, setMeasurementFields] = useState('')
  const [fitReadinessNote, setFitReadinessNote] = useState('')
  const [styleAlignmentNote, setStyleAlignmentNote] = useState('')
  const [fabricReceiptNote, setFabricReceiptNote] = useState('')
  const [fabricReceiptFile, setFabricReceiptFile] = useState<File | null>(null)
  const [materialIssueReason, setMaterialIssueReason] = useState<(typeof MATERIAL_ISSUE_REASON_OPTIONS)[number]['value']>('POOR_FABRIC_QUALITY')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [scopeChangeType, setScopeChangeType] = useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [scopeChangeSummary, setScopeChangeSummary] = useState('')
  const [scopeChangeImpacts, setScopeChangeImpacts] = useState<string[]>([])
  const [scopePriceImpact, setScopePriceImpact] = useState('')
  const [scopeDeadlineImpact, setScopeDeadlineImpact] = useState('')
  const [tailorScopeChangeResponseNote, setTailorScopeChangeResponseNote] = useState('')
  const [declineNote, setDeclineNote] = useState('')
  const [declineArmed, setDeclineArmed] = useState(false)
  const [pickupCode, setPickupCode] = useState('')
  const [tailorCancellationReason, setTailorCancellationReason] = useState<(typeof TAILOR_CANCELLATION_REASON_OPTIONS)[number]['value']>('TAILOR_CANNOT_FULFIL')
  const [tailorCancellationNote, setTailorCancellationNote] = useState('')
  const [tailorDeliveryReason, setTailorDeliveryReason] = useState<(typeof TAILOR_DELIVERY_REASON_OPTIONS)[number]['value']>('DISPATCH_DELAY')
  const [tailorDeliveryNote, setTailorDeliveryNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const isTailor = isTailorOrder(order, data)
  const stage = order.stage ?? ''
  const currentOrderStage = asOrderStage(order.stage)
  const measurementSnapshot = measurementSnapshotForOrder(order)
  const stageOptions = nextStageOptions(order)
  const selectedTargetStage = stageOptions.find((stage) => stage === targetStage) ?? stageOptions[0] ?? ''
  const selectedTargetNeedsDispatchMeta = selectedTargetStage === 'READY_FOR_DRAPE_DISPATCH'
  const lockedQuoteCurrency = normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? quoteCurrency
  const consultationRequestedByCustomer = order.stage === 'CONSULTATION' &&
    consultationMeta?.requestedBy === 'CUSTOMER' &&
    consultationMeta.status === 'REQUESTED'
  const tailorCanScheduleConsultation = order.order_kind !== 'READY_MADE' &&
    (order.stage === 'PENDING_QUOTE' || consultationRequestedByCustomer)
  const proposedConsultationLabel = formatDateTime(proposedConsultationStart, consultationMeta?.timezone)
  const cancellationPolicy = currentOrderStage
    ? deriveCancellationPolicy({
        orderKind: order.order_kind === 'READY_MADE' ? 'READY_MADE' : 'CUSTOM',
        stage: currentOrderStage,
        deliveryMethod: order.delivery_method,
        consultationFee: order.consultation_fee,
        consultationPaidAt: consultationMeta?.paidAt ?? null,
        consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
        fulfillmentFee: order.fulfillment_fee,
        fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at ?? null,
        fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at ?? null,
        dispatchBookedAt: supportMeta.dispatchRecord?.bookedAt ?? null,
        premiumDispatch: supportMeta.dispatchRecord?.premiumException ?? null,
      })
    : null
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const materialIssueOpen = supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const canRequestMeasurementConfirmation = PRE_CUTTING_STAGES.has(stage) && !!measurementSnapshot && Object.keys(measurementSnapshot).length > 0
  const canConfirmFitReadiness = PRE_CUTTING_STAGES.has(stage) && supportMeta.fitProfile?.requiresTailorReview === true
  const canRequestStyleAlignment = order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status !== 'APPROVED' &&
    supportMeta.styleAlignment.status !== 'NOT_REQUIRED'
  const canConfirmFabricReceived = order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    (!supportMeta.fabricReceivedAt || supportMeta.materialIssue?.response === 'REPLACE_FABRIC')
  const canOpenMaterialIssue = order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    !materialIssueOpen
  const canRequestScopeChange = order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canCancelScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canDeclineOrder = cancellationPolicy?.tailorCanDecline === true
  const canRequestCancellationReview = cancellationPolicy?.tailorCanRequestReview === true && !cancellationReviewOpen
  const canRequestDeliveryReview = ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED'].includes(stage) && !deliveryReviewOpen && !cancellationReviewOpen
  const canConfirmCollection = stage === 'READY_FOR_COLLECTION'

  if (!isTailor || isTerminalOrder(order)) return null

  async function addStageMedia(files: FileList | null) {
    if (!files?.length) return
    const nextFiles = Array.from(files)
    try {
      await Promise.all(nextFiles.map(prepareOrderEvidenceFile))
    } catch (mediaError) {
      setError(friendlyActionError(mediaError, 'Choose photos or MP4/MOV videos up to 60 seconds.'))
      return
    }
    setStageMediaFiles((current) => {
      const combined = [...current, ...nextFiles]
      if (combined.length > 6) {
        setError('Attach up to 6 proof items for a stage update.')
      }
      return combined.slice(0, 6)
    })
  }

  async function sendQuote() {
    const amount = parseMinorUnits(quoteAmount)
    const completionDateValue = completionDate ? new Date(`${completionDate}T12:00:00.000Z`) : null
    const dateIso = completionDateValue && !Number.isNaN(completionDateValue.getTime()) ? completionDateValue.toISOString() : null
    const leak = assertNoContactLeak(quoteNote, "Quote notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!amount || !dateIso) {
      setError('Add a quote amount and completion date.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    const customerDeadline = order.deadline ? new Date(order.deadline) : null
    if (customerDeadline && completionDateValue && completionDateValue.getTime() > customerDeadline.getTime()) {
      setError(`This quote date goes past the customer deadline of ${customerDeadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Choose an earlier date.`)
      return
    }
    setBusy('quote')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: 'send-quote',
        orderId: order.id,
        amount,
        currency: lockedQuoteCurrency,
        completionDate: dateIso,
        note: quoteNote.trim() || undefined,
      })
      setSuccess('Quote sent to the customer.')
      onRefresh()
    } catch (quoteError) {
      setError(friendlyActionError(quoteError, 'Quote could not be sent. Check the order state and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function saveConsultation(action: 'request-consultation' | 'approve-consultation') {
    const scheduledAt = consultationStart ? new Date(consultationStart) : null
    const leak = assertNoContactLeak(consultationNote, "Consultation notes can't include contact details.")
    const parsedFee = consultationFee.trim() ? parseMinorUnits(consultationFee) : null
    setError(null)
    setSuccess(null)
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      setError('Choose the consultation date and time.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    if (consultationFee.trim() && parsedFee === null) {
      setError('Enter a valid consultation fee or leave it blank.')
      return
    }
    setBusy(action === 'approve-consultation' ? 'consultation-approve' : 'consultation-schedule')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        scheduledStartAt: scheduledAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        consultationFee: parsedFee,
        currency: quoteCurrency,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess(action === 'approve-consultation' ? 'Consultation approved and scheduled.' : 'Consultation scheduled for the customer.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation could not be scheduled. Check the requested time and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function declineConsultation() {
    const leak = assertNoContactLeak(consultationNote, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    setBusy('consultation-decline')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: 'decline-consultation-request',
        orderId: order.id,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess('Consultation declined. The order is back in quote review.')
      onRefresh()
    } catch (consultationError) {
      setError(friendlyActionError(consultationError, 'Consultation request could not be declined. Refresh and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function runTailorLifecycleAction(action: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setDeclineArmed(false)
      setSuccess(successMessage)
      onRefresh()
      return true
    } catch (actionError) {
      setError(friendlyActionError(actionError, 'This tailor action could not finish. Refresh the order and try again.'))
      setSuccess(null)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function requestMeasurementConfirmation() {
    const note = measurementNote.trim()
    const leak = assertNoContactLeak([note, measurementFields].join('\n'), "Measurement confirmation notes can't include contact details.")
    if (note.length < 10) {
      setError('Tell the customer what needs confirming before cutting.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const fields = measurementFields
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean)
      .slice(0, 20)
    const ok = await runTailorLifecycleAction(
      'request-measurement-confirmation',
      { note, fields: fields.length > 0 ? fields : undefined },
      'Measurement confirmation requested from the customer.',
    )
    if (ok) {
      setMeasurementNote('')
      setMeasurementFields('')
    }
  }

  async function confirmFitReadiness() {
    const note = fitReadinessNote.trim()
    const leak = assertNoContactLeak(note, "Fit readiness notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain what you reviewed before clearing fit readiness.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('confirm-fit-readiness', { note }, 'Fit readiness confirmed for this order.')
    if (ok) setFitReadinessNote('')
  }

  async function requestStyleAlignment() {
    const note = styleAlignmentNote.trim()
    const leak = assertNoContactLeak(note, "Style approval notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain the style interpretation before asking for approval.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('request-style-alignment', { note }, 'Style alignment sent for customer approval.')
    if (ok) setStyleAlignmentNote('')
  }

  async function confirmFabricReceived() {
    const note = fabricReceiptNote.trim()
    const leak = assertNoContactLeak(note, "Fabric receipt notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (order.order_kind === 'CUSTOM' && !fabricReceiptFile) {
      setError('Add fabric receipt proof before confirming customer fabric.')
      return
    }
    let preparedFabricReceipt: File | null = null
    if (fabricReceiptFile) {
      try {
        preparedFabricReceipt = await prepareOrderEvidenceFile(fabricReceiptFile)
      } catch (mediaError) {
        setError(friendlyActionError(mediaError, 'Choose fabric receipt proof as a photo or MP4/MOV video up to 60 seconds.'))
        return
      }
    }
    setBusy('confirm-fabric-received')
    try {
      const photoUrl = preparedFabricReceipt
        ? await uploadPublicFile('order-photos', `fabric-receipts/${order.id}`, preparedFabricReceipt)
        : undefined
      await invokeAccountFunction('tailor-order-action', {
        action: 'confirm-fabric-received',
        orderId: order.id,
        note: note || undefined,
        photoUrl,
      })
      setFabricReceiptNote('')
      setFabricReceiptFile(null)
      setSuccess('Fabric receipt confirmed on the order timeline.')
      onRefresh()
    } catch (fabricError) {
      setError(friendlyActionError(fabricError, 'Fabric receipt could not be confirmed. Add proof and try again.'))
      setSuccess(null)
    } finally {
      setBusy(null)
    }
  }

  async function openMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(note, "Material issue notes can't include contact details.")
    if (note.length < 10) {
      setError('Describe the material issue so the customer can choose what to do next.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'open-material-issue',
      { reason: materialIssueReason, note },
      'Material issue opened for the customer.',
    )
    if (ok) setMaterialIssueNote('')
  }

  function toggleScopeImpact(value: string) {
    setScopeChangeImpacts((current) =>
      current.includes(value)
        ? current.filter((impact) => impact !== value)
        : [...current, value],
    )
  }

  async function requestScopeChange() {
    const summary = scopeChangeSummary.trim()
    const deadlineImpact = scopeDeadlineImpact.trim()
    const leak = assertNoContactLeak([summary, deadlineImpact].join('\n'), "Change requests can't include contact details.")
    const parsedPriceImpact = scopePriceImpact.trim() ? parseMinorUnits(scopePriceImpact) : null
    if (summary.length < 10) {
      setError('Explain what changed and what the customer needs to approve.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    if (scopePriceImpact.trim() && parsedPriceImpact === null) {
      setError('Enter a valid added price, or leave price impact blank.')
      setSuccess(null)
      return
    }
    const impacts = Array.from(new Set([
      ...scopeChangeImpacts,
      ...(parsedPriceImpact ? ['PRICE'] : []),
      ...(deadlineImpact ? ['DEADLINE'] : []),
    ]))
    const ok = await runTailorLifecycleAction(
      'request-scope-change',
      {
        scopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts: impacts.length > 0 ? impacts : undefined,
        priceImpactMinor: parsedPriceImpact ?? undefined,
        deadlineImpact: deadlineImpact || undefined,
      },
      'Change request sent to the customer.',
    )
    if (ok) {
      setScopeChangeSummary('')
      setScopeChangeImpacts([])
      setScopePriceImpact('')
      setScopeDeadlineImpact('')
    }
  }

  async function respondTailorScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const note = tailorScopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    const ok = await runTailorLifecycleAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change proposal cancelled.',
    )
    if (ok) setTailorScopeChangeResponseNote('')
  }

  async function declineOrder() {
    const note = declineNote.trim()
    const leak = assertNoContactLeak(note, "Decline notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this order request.')
      return
    }
    const ok = await runTailorLifecycleAction('decline-order', { note: note || undefined }, 'Order declined and closed.')
    if (ok) setDeclineNote('')
  }

  async function confirmCollection() {
    const code = pickupCode.replace(/\D/g, '')
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit pickup code from the customer.')
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction('confirm-collection', { code }, 'Collection confirmed. Handoff is closed.')
    if (ok) setPickupCode('')
  }

  async function requestTailorCancellationReview() {
    const note = tailorCancellationNote.trim()
    const leak = assertNoContactLeak(note, "Cancellation review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-cancellation-review',
      { reason: tailorCancellationReason, note: note || undefined },
      'Cancellation review opened for Drapeon.',
    )
    if (ok) setTailorCancellationNote('')
  }

  async function requestTailorDeliveryReview() {
    const note = tailorDeliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-delivery-review',
      { reason: tailorDeliveryReason, note: note || undefined },
      'Delivery review opened for Drapeon.',
    )
    if (ok) setTailorDeliveryNote('')
  }

  async function advanceStage() {
    const leak = assertNoContactLeak(stageNote, "Stage notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!selectedTargetStage || stageNote.trim().length < 10) {
      setError('Choose the next stage and add a clear note.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    if (stageMediaFiles.length === 0) {
      setError(selectedTargetNeedsDispatchMeta
        ? 'Add fresh packed-order proof before marking this order ready for Drape dispatch.'
        : 'Attach fresh proof media before updating this stage.')
      return
    }
    setBusy('stage')
    try {
      const selectedFiles = stageMediaFiles.slice(0, 6)
      const photoUrls = await Promise.all(
        selectedFiles.map(async (file) => uploadPublicFile('order-photos', `progress/${order.id}`, await prepareOrderEvidenceFile(file))),
      )
      const mediaFingerprints = selectedFiles.map(mediaFingerprint)
      await invokeAccountFunction('tailor-order-action', {
        action: 'advance-stage',
        orderId: order.id,
        targetStage: selectedTargetStage,
        note: stageNote.trim(),
        photoUrl: photoUrls[0],
        photoUrls,
        mediaFingerprints,
        trackingNumber: selectedTargetNeedsDispatchMeta ? stageTrackingNumber.trim().toUpperCase() || undefined : undefined,
        fulfillmentProvider: selectedTargetNeedsDispatchMeta ? stageFulfillmentProvider.trim() || undefined : undefined,
        fulfillmentReference: selectedTargetNeedsDispatchMeta ? stageFulfillmentReference.trim().toUpperCase() || undefined : undefined,
        fulfillmentContactName: selectedTargetNeedsDispatchMeta ? stageFulfillmentContactName.trim() || undefined : undefined,
        fulfillmentContactPhone: selectedTargetNeedsDispatchMeta ? stageFulfillmentContactPhone.trim() || undefined : undefined,
      })
      setStageNote('')
      setStageTrackingNumber('')
      setStageFulfillmentProvider('')
      setStageFulfillmentReference('')
      setStageFulfillmentContactName('')
      setStageFulfillmentContactPhone('')
      setStageMediaFiles([])
      setSuccess('Stage updated and added to the order timeline.')
      onRefresh()
    } catch (stageError) {
      setError(friendlyActionError(stageError, 'Stage could not be updated. Check approval gates and try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="tailor-actions" className="scroll-mt-28 rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor actions</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">Work this order from web</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {tailorCanScheduleConsultation ? (
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
            <div>
              <h3 className="text-xl font-semibold text-ink">
                {consultationRequestedByCustomer ? 'Approve consultation request' : 'Schedule consultation'}
              </h3>
              {consultationRequestedByCustomer ? (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Customer requested {proposedConsultationLabel ?? 'a consultation time'} before quote.
                  {consultationMeta?.requestNote ? ` ${safeUserText(consultationMeta.requestNote, '')}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Use this when a quote needs a live fit, scope, or fabric discussion first.
                </p>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_0.45fr]">
              <input
                type="datetime-local"
                value={consultationStart}
                onChange={(event) => setConsultationStart(event.target.value)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              <input
                inputMode="decimal"
                value={consultationFee}
                onChange={(event) => setConsultationFee(event.target.value)}
                placeholder="Optional fee"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              <select value={quoteCurrency} onChange={(event) => setQuoteCurrency(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              placeholder="Optional consultation note"
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { void saveConsultation(consultationRequestedByCustomer ? 'approve-consultation' : 'request-consultation') }}
                disabled={busy === 'consultation-approve' || busy === 'consultation-schedule'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'consultation-approve' || busy === 'consultation-schedule'
                  ? 'Saving...'
                  : consultationRequestedByCustomer
                    ? 'Approve consultation'
                    : 'Schedule consultation'}
              </button>
              {consultationRequestedByCustomer ? (
                <button
                  type="button"
                  onClick={() => { void declineConsultation() }}
                  disabled={busy === 'consultation-decline'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-ink/5 disabled:text-ink/38"
                >
                  {busy === 'consultation-decline' ? 'Declining...' : 'Decline'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '') ? (
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">Send quote</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input inputMode="decimal" value={quoteAmount} onChange={(event) => setQuoteAmount(event.target.value)} placeholder="Amount" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              <input value={lockedQuoteCurrency} disabled aria-label="Quote currency locked to order currency" className="rounded-full border border-ink/10 bg-bone/50 px-4 py-3 text-sm font-semibold text-ink/62 outline-none" />
              <input type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </div>
            <textarea value={quoteNote} onChange={(event) => setQuoteNote(event.target.value)} rows={2} placeholder="Optional quote note" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={sendQuote} disabled={busy === 'quote'} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'quote' ? 'Sending...' : 'Send quote'}
            </button>
          </div>
        ) : null}
        {canRequestMeasurementConfirmation || canConfirmFitReadiness || canRequestStyleAlignment || canConfirmFabricReceived || canOpenMaterialIssue ? (
          <DisclosurePanel title="Pre-cutting checks" summary="Resolve fit, style, and fabric blockers before cutting starts.">
            <div className="grid gap-4">
              {canRequestMeasurementConfirmation ? (
                <div className="grid gap-3">
                  <h3 className="font-semibold text-ink">Request measurement confirmation</h3>
                  <input
                    value={measurementFields}
                    onChange={(event) => setMeasurementFields(event.target.value)}
                    placeholder="Optional fields, comma separated"
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <textarea
                    value={measurementNote}
                    onChange={(event) => setMeasurementNote(event.target.value)}
                    rows={2}
                    placeholder="What should the customer confirm?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestMeasurementConfirmation() }}
                    disabled={busy === 'request-measurement-confirmation'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-measurement-confirmation' ? 'Sending...' : 'Request confirmation'}
                  </button>
                </div>
              ) : null}

              {canConfirmFitReadiness ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm fit readiness</h3>
                  <textarea
                    value={fitReadinessNote}
                    onChange={(event) => setFitReadinessNote(event.target.value)}
                    rows={2}
                    placeholder="What did you verify?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void confirmFitReadiness() }}
                    disabled={busy === 'confirm-fit-readiness'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fit-readiness' ? 'Confirming...' : 'Confirm fit readiness'}
                  </button>
                </div>
              ) : null}

              {canRequestStyleAlignment ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Style alignment</h3>
                  <textarea
                    value={styleAlignmentNote}
                    onChange={(event) => setStyleAlignmentNote(event.target.value)}
                    rows={3}
                    placeholder="Explain what can be matched from the references before cutting."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestStyleAlignment() }}
                    disabled={busy === 'request-style-alignment'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-style-alignment' ? 'Sending...' : 'Send style alignment'}
                  </button>
                </div>
              ) : null}

              {canConfirmFabricReceived ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm customer fabric</h3>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    onChange={(event) => setFabricReceiptFile(event.target.files?.[0] ?? null)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
                  />
                  <textarea
                    value={fabricReceiptNote}
                    onChange={(event) => setFabricReceiptNote(event.target.value)}
                    rows={2}
                    placeholder="Optional fabric receipt note"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void confirmFabricReceived() }}
                    disabled={busy === 'confirm-fabric-received'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fabric-received' ? 'Confirming...' : 'Confirm fabric received'}
                  </button>
                </div>
              ) : null}

              {canOpenMaterialIssue ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Material issue</h3>
                  <select
                    value={materialIssueReason}
                    onChange={(event) => setMaterialIssueReason(event.target.value as typeof materialIssueReason)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {MATERIAL_ISSUE_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={materialIssueNote}
                    onChange={(event) => setMaterialIssueNote(event.target.value)}
                    rows={2}
                    placeholder="Describe the fabric issue."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void openMaterialIssue() }}
                    disabled={busy === 'open-material-issue'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'open-material-issue' ? 'Opening...' : 'Open material issue'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel title="Order change request" summary="Propose a formal scope, price, deadline, fabric, or fit change.">
            <div className="grid gap-3">
              <select
                value={scopeChangeType}
                onChange={(event) => setScopeChangeType(event.target.value as typeof scopeChangeType)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label key={option.value} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68">
                    <input
                      type="checkbox"
                      checked={scopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={scopeChangeSummary}
                onChange={(event) => setScopeChangeSummary(event.target.value)}
                rows={3}
                placeholder="What changed?"
                className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  inputMode="decimal"
                  value={scopePriceImpact}
                  onChange={(event) => setScopePriceImpact(event.target.value)}
                  placeholder={`Added price (${quoteCurrency})`}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={scopeDeadlineImpact}
                  onChange={(event) => setScopeDeadlineImpact(event.target.value)}
                  placeholder="Deadline impact"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
              </div>
              <button
                type="button"
                onClick={() => { void requestScopeChange() }}
                disabled={busy === 'request-scope-change'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Open change request"
            summary={supportMeta.scopeChange?.summary ?? 'Review the open change request before production continues.'}
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.scopeChange?.impacts?.length ? (
                <p className="text-sm leading-6 text-ink/62">
                  Affects: {supportMeta.scopeChange.impacts.map((impact) => cleanLabel(impact)).join(', ')}
                </p>
              ) : null}
              {typeof supportMeta.scopeChange?.priceImpactMinor === 'number' && supportMeta.scopeChange.priceImpactMinor !== 0 ? (
                <p className="text-sm leading-6 text-ink/62">
                  Price impact: {formatMoney(Math.abs(supportMeta.scopeChange.priceImpactMinor), order.quoted_currency ?? order.currency)}
                </p>
              ) : null}
              {supportMeta.scopeChange?.deadlineImpact ? (
                <p className="text-sm leading-6 text-ink/62">Deadline: {safeUserText(supportMeta.scopeChange.deadlineImpact, '')}</p>
              ) : null}
              <textarea
                value={tailorScopeChangeResponseNote}
                onChange={(event) => setTailorScopeChangeResponseNote(event.target.value)}
                rows={2}
                placeholder="Optional response note"
                className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              {canRespondScopeChange ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => { void respondTailorScopeChange('ACCEPTED') }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Accept change'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void respondTailorScopeChange('DECLINED') }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Decline change'}
                  </button>
                </div>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => { void respondTailorScopeChange('CANCELLED') }}
                  disabled={busy === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'respond-scope-change' ? 'Cancelling...' : 'Cancel proposal'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {stageOptions.length > 0 ? (
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">Update production stage</h3>
            <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
              <select value={selectedTargetStage} onChange={(event) => setTargetStage(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {stageOptions.map((stage) => <option key={stage} value={stage}>{cleanLabel(stage)}</option>)}
              </select>
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
                    Take fresh proof
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      capture="environment"
                      onChange={(event) => { void addStageMedia(event.target.files) }}
                      className="sr-only"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer justify-center rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink">
                    Attach media
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      multiple
                      onChange={(event) => { void addStageMedia(event.target.files) }}
                      className="sr-only"
                    />
                  </label>
                </div>
                <p className="text-xs leading-5 text-ink/52">
                  Use fresh clothing proof. Photos and MP4/MOV videos up to 60 seconds are supported.
                </p>
                {stageMediaFiles.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-bone px-3 py-1 text-xs font-semibold text-ink/62">
                      {stageMediaFiles.length} proof item{stageMediaFiles.length === 1 ? '' : 's'} selected
                    </span>
                    <button type="button" onClick={() => setStageMediaFiles([])} className="text-xs font-semibold text-needle">
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {selectedTargetNeedsDispatchMeta ? (
              <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-needle/6 p-3 md:grid-cols-2">
                <input
                  value={stageFulfillmentProvider}
                  onChange={(event) => setStageFulfillmentProvider(event.target.value)}
                  placeholder="Fulfillment provider"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentReference}
                  onChange={(event) => setStageFulfillmentReference(event.target.value)}
                  placeholder="Fulfillment reference"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageTrackingNumber}
                  onChange={(event) => setStageTrackingNumber(event.target.value)}
                  placeholder="Tracking number"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentContactName}
                  onChange={(event) => setStageFulfillmentContactName(event.target.value)}
                  placeholder="Dispatch contact name"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentContactPhone}
                  onChange={(event) => setStageFulfillmentContactPhone(event.target.value)}
                  placeholder="Dispatch contact phone"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50 md:col-span-2"
                />
              </div>
            ) : null}
            <textarea value={stageNote} onChange={(event) => setStageNote(event.target.value)} rows={2} placeholder="Tell the customer what changed" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={advanceStage} disabled={busy === 'stage'} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'stage' ? 'Updating...' : 'Update stage'}
            </button>
          </div>
        ) : null}

        {canConfirmCollection ? (
          <DisclosurePanel title="Confirm collection" summary="Enter the customer pickup code to close local collection.">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={pickupCode}
                onChange={(event) => setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="4-digit pickup code"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              <button
                type="button"
                onClick={() => { void confirmCollection() }}
                disabled={busy === 'confirm-collection'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'confirm-collection' ? 'Confirming...' : 'Confirm collection'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canDeclineOrder || canRequestCancellationReview || canRequestDeliveryReview ? (
          <DisclosurePanel title="Reviews and exceptions" summary={cancellationPolicy?.tailorMessage ?? 'Use formal review for exceptions that should pause handoff.'}>
            <div className="grid gap-4">
              {canDeclineOrder ? (
                <div className="grid gap-3">
                  <h3 className="font-semibold text-ink">Decline order</h3>
                  <textarea
                    value={declineNote}
                    onChange={(event) => setDeclineNote(event.target.value)}
                    rows={2}
                    placeholder="Optional note"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void declineOrder() }}
                    disabled={busy === 'decline-order'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'decline-order' ? 'Declining...' : declineArmed ? 'Confirm decline' : 'Decline order'}
                  </button>
                </div>
              ) : null}

              {canRequestCancellationReview ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Cancellation review</h3>
                  <select
                    value={tailorCancellationReason}
                    onChange={(event) => setTailorCancellationReason(event.target.value as typeof tailorCancellationReason)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_CANCELLATION_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={tailorCancellationNote}
                    onChange={(event) => setTailorCancellationNote(event.target.value)}
                    rows={2}
                    placeholder="Add context for Drapeon."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestTailorCancellationReview() }}
                    disabled={busy === 'request-cancellation-review'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-cancellation-review' ? 'Opening...' : 'Open cancellation review'}
                  </button>
                </div>
              ) : null}

              {canRequestDeliveryReview ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Delivery review</h3>
                  <select
                    value={tailorDeliveryReason}
                    onChange={(event) => setTailorDeliveryReason(event.target.value as typeof tailorDeliveryReason)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_DELIVERY_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={tailorDeliveryNote}
                    onChange={(event) => setTailorDeliveryNote(event.target.value)}
                    rows={2}
                    placeholder="What went wrong with dispatch or delivery?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => { void requestTailorDeliveryReview() }}
                    disabled={busy === 'request-delivery-review'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-delivery-review' ? 'Opening...' : 'Open delivery review'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </section>
  )
}

function MaterialAdvancePanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'materialAdvances' | 'userId'>
  onRefresh: () => void
}) {
  const advances = data.materialAdvances.filter((advance) => advance.order_id === order.id)
  const isTailor = order.tailor_id === data.userId
  const isCustomer = order.customer_id === data.userId
  const hasActiveAdvance = advances.some((advance) => ['REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED'].includes(advance.status ?? ''))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(order.currency ?? order.quoted_currency ?? 'USD')
  const [responseNote, setResponseNote] = useState('')
  const [receiptNote, setReceiptNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripeAdvancePayment, setStripeAdvancePayment] = useState<{
    advanceId: string
    clientSecret: string
    amount?: number | null
    currency?: string | null
  } | null>(null)

  async function requestAdvance() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([title, description].join('\n'), "Material advance requests can't include contact details.")
    const parsedAmount = parseMinorUnits(amount)
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim() || description.trim().length < 10 || !parsedAmount) {
      setError('Add a title, clear reason, and valid amount.')
      return
    }
    setBusy('request')
    try {
      await invokeAccountFunction('material-advance-action', {
        action: 'request-advance',
        orderId: order.id,
        title: title.trim(),
        description: description.trim(),
        amount: parsedAmount,
        currency,
      })
      setTitle('')
      setDescription('')
      setAmount('')
      setSuccess('Material advance sent to the customer for approval.')
      onRefresh()
    } catch (advanceError) {
      setError(friendlyActionError(advanceError, 'Material advance could not be requested. Check payment state and amount limits.'))
    } finally {
      setBusy(null)
    }
  }

  async function respondAdvance(advance: MaterialAdvance, decision: 'APPROVE' | 'DECLINE') {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(responseNote, "Material advance responses can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    setBusy(`${decision}:${advance.id}`)
    try {
      await invokeAccountFunction('material-advance-action', {
        action: 'respond-advance',
        advanceId: advance.id,
        decision,
        note: responseNote.trim() || undefined,
      })
      setResponseNote('')
      setSuccess(decision === 'APPROVE' ? 'Material advance approved. Payment is now available.' : 'Material advance declined.')
      onRefresh()
    } catch (responseError) {
      setError(friendlyActionError(responseError, 'Material advance response could not save. Refresh and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function payAdvance(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    setStripeAdvancePayment(null)
    setBusy(`pay:${advance.id}`)
    try {
      const result = await invokeAccountFunction<{
        authorizationUrl?: string | null
        clientSecret?: string | null
        provider?: string | null
        amount?: number | null
        currency?: string | null
      }>('material-advance-action', {
        action: 'prepare-payment',
        advanceId: advance.id,
      })
      onRefresh()
      if (result.authorizationUrl) {
        setSuccess('Opening secure material advance checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.clientSecret) {
        setStripeAdvancePayment({
          advanceId: advance.id,
          clientSecret: result.clientSecret,
          amount: result.amount ?? advance.amount,
          currency: result.currency ?? advance.currency,
        })
        setSuccess('Material advance card payment is ready. Enter card details below.')
        return
      }
      setSuccess('Material advance payment is processing. Do not start a duplicate payment.')
    } catch (paymentError) {
      setError(friendlyActionError(paymentError, 'Material advance payment could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function uploadReceipt(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(receiptNote, "Receipt notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!receiptFile) {
      setError('Choose receipt or supplier proof first.')
      return
    }
    setBusy(`receipt:${advance.id}`)
    try {
      const receiptUrl = await uploadPublicFile('order-photos', `progress/${order.id}`, await prepareOrderEvidenceFile(receiptFile))
      await invokeAccountFunction('material-advance-action', {
        action: 'upload-receipt',
        advanceId: advance.id,
        receiptUrl,
        note: receiptNote.trim() || undefined,
      })
      setReceiptFile(null)
      setReceiptNote('')
      setSuccess('Receipt proof saved for this material advance.')
      onRefresh()
    } catch (receiptError) {
      setError(friendlyActionError(receiptError, 'Receipt proof could not upload. Try again with a clear photo or MP4/MOV video up to 60 seconds.'))
    } finally {
      setBusy(null)
    }
  }

  if (!isTailor && !isCustomer && advances.length === 0) return null

  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Material advance</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Protected material costs</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/62">Main escrow never releases early. The customer approves and pays the material amount separately before ops reviews release.</p>
      </div>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {advances.length === 0 ? (
          <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No material advance is open on this order.</p>
        ) : (
          advances.map((advance) => (
            <article key={advance.id} className="rounded-[8px] border border-ink/8 bg-bone/60 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-ink">{safeUserText(advance.title, 'Material advance')}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(advance.description, 'Material cost requested.')}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <span>{formatMoney(advance.amount, advance.currency)}</span>
                    <StatusChip status={advance.status} fallback="Requested" />
                    <StatusChip status={advance.release_status} fallback="Release pending" />
                  </div>
                </div>
                {advance.receipt_url ? (
                  <a href={advance.receipt_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-needle">View receipt</a>
                ) : null}
              </div>
              {isCustomer && advance.status === 'REQUESTED' ? (
                <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                  <textarea value={responseNote} onChange={(event) => setResponseNote(event.target.value)} rows={2} placeholder="Optional note for the tailor" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => respondAdvance(advance, 'APPROVE')} disabled={!!busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                      {busy === `APPROVE:${advance.id}` ? 'Approving...' : 'Approve'}
                    </button>
                    <button type="button" onClick={() => respondAdvance(advance, 'DECLINE')} disabled={!!busy} className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38">
                      {busy === `DECLINE:${advance.id}` ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              ) : null}
              {isCustomer && ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(advance.status ?? '') ? (
                <div className="mt-4 grid gap-3">
                  <button type="button" onClick={() => payAdvance(advance)} disabled={!!busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                    {busy === `pay:${advance.id}` ? 'Preparing...' : advance.status === 'PAYMENT_FAILED' ? 'Retry material payment' : 'Pay material advance'}
                  </button>
                  {stripeAdvancePayment?.advanceId === advance.id ? (
                    <StripeCardAuthorization
                      clientSecret={stripeAdvancePayment.clientSecret}
                      label={formatMoney(stripeAdvancePayment.amount ?? advance.amount, stripeAdvancePayment.currency ?? advance.currency)}
                      submitLabel="Authorize material payment"
                      onConfirm={async (paymentIntentId) => {
                        await invokeAccountFunction('material-advance-action', {
                          action: 'confirm-payment',
                          advanceId: advance.id,
                          paymentIntentId,
                        })
                      }}
                      onDone={() => {
                        setStripeAdvancePayment(null)
                        onRefresh()
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {isTailor && ['PAID', 'OPS_REVIEW', 'RELEASED', 'BLOCKED'].includes(advance.status ?? '') && !advance.receipt_url ? (
                <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                  <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" capture="environment" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink" />
                  <textarea value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} rows={2} placeholder="Optional receipt note" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  <button type="button" onClick={() => uploadReceipt(advance)} disabled={!!busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
                    {busy === `receipt:${advance.id}` ? 'Uploading...' : 'Upload receipt proof'}
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
        {isTailor && (order.order_kind ?? 'CUSTOM') === 'CUSTOM' && !hasActiveAdvance ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-needle/8 p-4">
            <h3 className="text-xl font-semibold text-ink">Request a material advance</h3>
            <div className="grid gap-3 md:grid-cols-[1fr_0.55fr_0.4fr]">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aso-oke embroidery deposit" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Explain the material cost and why it is needed before production continues." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
            <button type="button" onClick={requestAdvance} disabled={busy === 'request'} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
              {busy === 'request' ? 'Requesting...' : 'Request advance'}
            </button>
          </div>
        ) : null}
      </div>
    </Surface>
  )
}

const SUPPORT_CATEGORIES = [
  ['PAYMENT', 'Payment issue'],
  ['FIT', 'Fit or alteration issue'],
  ['DELIVERY_HANDOFF', 'Delivery or handoff issue'],
  ['ACCOUNT_SECURITY', 'Account or security issue'],
  ['TAILOR_PAYOUT', 'Tailor payout or setup issue'],
  ['GENERAL', 'Something else'],
] as const

function GeneralSupportForm({ data, onRefresh }: { data: SupportSurfaceData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const orderOptions = data.orders.slice(0, 12)
  const [category, setCategory] = useState<(typeof SUPPORT_CATEGORIES)[number][0]>('PAYMENT')
  const [orderId, setOrderId] = useState(linkedOrderId && data.orders.some((order) => order.id === linkedOrderId) ? linkedOrderId : '')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function submitSupport() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([subject, description].join('\n'), "Support requests can't include phone numbers, email addresses, social handles, or off-platform contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (subject.trim().length < 3 || description.trim().length < 10) {
      setError('Add a short subject and enough detail for ops to understand what happened.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ ok?: boolean; issueNumber?: number | null }>('account-support-action', {
        action: 'submit-support',
        category,
        orderId: orderId || undefined,
        subject: subject.trim(),
        description: description.trim(),
      })
      setSubject('')
      setDescription('')
      setSuccess(result.issueNumber ? `Support request opened as #${String(result.issueNumber).padStart(4, '0')}.` : 'Support request opened for ops review.')
      onRefresh()
    } catch (supportError) {
      setError(friendlyActionError(supportError, `Support could not open from web. Email ${CONTACTS.support} if this keeps happening.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader eyebrow="Support" title="Ask Drapeon for help" description="Open a protected support request from web. Attach an order when the issue is about payment, fit, delivery, payout, or production." />
      <div className="grid gap-3 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <NativeSelect value={category} onChange={(event) => setCategory(event.target.value as (typeof SUPPORT_CATEGORIES)[number][0])}>
            {SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          <NativeSelect value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">No order attached</option>
            {orderOptions.map((order) => <option key={order.id} value={order.id}>{order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}</option>)}
          </NativeSelect>
        </div>
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={120}
          placeholder="Short subject"
        />
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={1500}
          placeholder="Tell us what happened inside Drapeon. Keep phone numbers, emails, and social handles out of the request."
        />
        <Button onClick={submitSupport} disabled={busy}>
          {busy ? 'Opening support...' : 'Open support request'}
        </Button>
      </div>
    </Surface>
  )
}

function SupportIssueForm({ data, onRefresh }: { data: SupportSurfaceData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order))
  const [orderId, setOrderId] = useState(linkedOrderId && activeOrders.some((order) => order.id === linkedOrderId) ? linkedOrderId : activeOrders[0]?.id ?? '')
  const [issueType, setIssueType] = useState('NEED_DRAPE_HELP')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reportIssue() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(description, "Support notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!orderId || description.trim().length < 10) {
      setError('Choose an order and add a short description.')
      return
    }
    setBusy(true)
    try {
      await invokeAccountFunction('handoff-support-action', {
        action: 'report-issue',
        orderId,
        issueType,
        description: description.trim(),
      })
      setDescription('')
      setSuccess('Handoff issue opened on this order.')
      onRefresh()
    } catch (supportError) {
      setError(friendlyActionError(supportError, 'Handoff support is only available once pickup or delivery is in progress. Use email for other issues.'))
    } finally {
      setBusy(false)
    }
  }

  if (activeOrders.length === 0) return null

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader eyebrow="Protected support" title="Open handoff help" description="This creates a real order handoff issue when pickup or delivery is active. Use the support request above for payment, fit, account, and payout questions." />
      <div className="grid gap-3 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <NativeSelect value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            {activeOrders.map((order) => <option key={order.id} value={order.id}>{order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}</option>)}
          </NativeSelect>
          <NativeSelect value={issueType} onChange={(event) => setIssueType(event.target.value)}>
            <option value="AT_PICKUP">At pickup</option>
            <option value="CANT_FIND_LOCATION">Cannot find location</option>
            <option value="COUNTERPART_NOT_RESPONDING">Other party not responding</option>
            <option value="ORDER_NOT_READY">Order not ready</option>
            <option value="COURIER_OR_DELIVERY_ISSUE">Courier or delivery issue</option>
            <option value="NEED_DRAPE_HELP">Need Drapeon help</option>
          </NativeSelect>
        </div>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Describe what happened inside Drapeon. Do not include phone numbers or handles." />
        <Button onClick={reportIssue} disabled={busy}>
          {busy ? 'Opening help...' : 'Open handoff help'}
        </Button>
      </div>
    </Surface>
  )
}

function ReadyMadeCheckoutForm({ item, data, onRefresh }: { item: SellerItem; data: Pick<ItemDetailRenderData, 'userId'>; onRefresh: () => void }) {
  const sizes = stringList(item.sizes)
  const [size, setSize] = useState(sizes[0] ?? '')
  const [quantity, setQuantity] = useState('1')
  const [fulfillment, setFulfillment] = useState(item.pickup_available ? 'PICKUP' : item.delivery_available ? 'DELIVERY' : item.shipping_available ? 'SHIPPING' : 'SHIPPING')
  const [pickupBlocked, setPickupBlocked] = useState(false)
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingPreview, setPricingPreview] = useState<ReadyMadeCheckoutPricingPreview | null>(null)
  const [pricingKey, setPricingKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const selectedSizeInventory = readyMadeQuantityForSize(item, size || null)
  const maxCheckoutQuantity = sizes.length > 0 && size ? Math.min(3, selectedSizeInventory) : Math.min(3, readyMadeInventoryCount(item))
  const parsedQty = Number.parseInt(quantity, 10)
  const quantityInvalid = quantity.trim() !== '' && (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > maxCheckoutQuantity)
  const hasFulfillmentOption = Boolean((item.pickup_available && !pickupBlocked) || item.delivery_available || item.shipping_available)
  const needsAddress = fulfillment !== 'PICKUP'
  const fallbackFulfillment = fulfillment === 'PICKUP'
    ? item.delivery_available
      ? 'DELIVERY'
      : item.shipping_available
        ? 'SHIPPING'
        : null
    : null
  const previewKey = useMemo(() => JSON.stringify({
    itemId: item.id,
    size: size || '',
    quantity,
    fulfillment,
    address: needsAddress ? address.trim() : '',
    city: needsAddress ? city.trim() : '',
    region: needsAddress ? region.trim() : '',
    postalCode: needsAddress ? postalCode.trim() : '',
    countryCode: needsAddress ? countryCode.trim().toUpperCase() : '',
  }), [address, city, countryCode, fulfillment, item.id, needsAddress, postalCode, quantity, region, size])
  const previewIsFresh = Boolean(pricingPreview && pricingKey === previewKey)

  function validateCheckoutInput() {
    setError(null)
    setSuccess(null)
    if (!hasFulfillmentOption) {
      setError('This item is not ready for checkout yet. Ask the seller to finish fulfillment setup.')
      return null
    }
    const leak = assertNoContactLeak([address, city, region, recipientName].join('\n'), "Checkout delivery details can't include off-platform contact details.")
    if (leak) {
      setError(leak)
      return null
    }
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 3) {
      setError('Choose a quantity between 1 and 3.')
      return null
    }
    if (sizes.length > 0 && !size.trim()) {
      setError('Choose a size before checkout.')
      return null
    }
    if (sizes.length > 0 && selectedSizeInventory <= 0) {
      setError(`Size ${size} is sold out right now. Choose another size before continuing.`)
      return null
    }
    const maxQuantity = Math.min(3, selectedSizeInventory)
    if (maxQuantity < 1) {
      setError('This item just sold out. Please choose another piece.')
      return null
    }
    if (parsedQuantity > maxQuantity) {
      setError(`For now, you can check out up to ${maxQuantity} unit${maxQuantity === 1 ? '' : 's'} for this item.`)
      return null
    }
    if (needsAddress && (!address.trim() || !city.trim() || !region.trim() || !countryCode.trim())) {
      setError('Add the full delivery address before continuing. Street, city, region, and country are required.')
      return null
    }
    if (needsAddress && !recipientName.trim()) {
      setError('Enter the recipient name before continuing.')
      return null
    }
    const normalizedRecipientPhone = normalizePhoneForStorage(recipientPhone)
    const recipientPhoneError = needsAddress ? validatePhoneForProfile(normalizedRecipientPhone) : null
    if (needsAddress && recipientPhoneError) {
      setError(recipientPhoneError)
      return null
    }
    return parsedQuantity
  }

  function handlePickupSetupFallback(message: string) {
    if (!/pickup details|finished pickup details/iu.test(message)) {
      return false
    }
    setPickupBlocked(true)
    if (fallbackFulfillment) {
      setFulfillment(fallbackFulfillment)
    }
    setPricingPreview(null)
    setPricingKey('')
    setSuccess(null)
    setError(
      fallbackFulfillment
        ? `Pickup is not ready for this seller yet. Checkout has been switched to ${fallbackFulfillment.toLowerCase()}. Add recipient details and preview tax again.`
        : 'Pickup is not ready for this seller yet. Ask the seller to finish pickup setup before checkout.',
    )
    return true
  }

  async function previewCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return

    setPricingBusy(true)
    try {
      const result = await invokeAccountFunction<{ pricing?: ReadyMadeCheckoutPricingPreview }>('ready-made-order-action', {
        action: 'preview-checkout',
        sellerItemId: item.id,
        size: size || undefined,
        quantity: parsedQuantity,
        fulfillment,
        address: needsAddress ? address.trim() : undefined,
        city: needsAddress ? city.trim() : undefined,
        region: needsAddress ? region.trim() : undefined,
        postalCode: needsAddress ? postalCode.trim() : undefined,
        countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
      })
      setPricingPreview(result.pricing ?? null)
      setPricingKey(previewKey)
      setSuccess('Tax and total are ready for review.')
    } catch (previewError) {
      setPricingPreview(null)
      setPricingKey('')
      const message = friendlyActionError(previewError, 'We could not calculate tax and totals for this checkout right now.')
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setPricingBusy(false)
    }
  }

  async function startCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return
    if (!previewIsFresh) {
      setError('Review the latest tax and total before creating checkout.')
      return
    }
    if (!ack) {
      setError('Acknowledge the cancellation policy before checkout.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'create-checkout',
        sellerItemId: item.id,
        size: size || undefined,
        quantity: parsedQuantity,
        fulfillment,
        address: needsAddress ? address.trim() : undefined,
        city: needsAddress ? city.trim() : undefined,
        region: needsAddress ? region.trim() : undefined,
        postalCode: needsAddress ? postalCode.trim() : undefined,
        countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
        recipientName: needsAddress ? recipientName.trim() : undefined,
        recipientPhone: needsAddress ? normalizePhoneForStorage(recipientPhone) : undefined,
        cancellationPolicyAcknowledged: true,
      })
      onRefresh()
      if (result.orderId) {
        setSuccess('Checkout order created. Opening payment handoff.')
        window.location.assign(`/account/checkout/${result.orderId}`)
        return
      }
      setSuccess('Checkout order created. Open Orders to continue payment.')
    } catch (checkoutError) {
      const message = friendlyActionError(checkoutError, 'Ready-made checkout could not start. Refresh and try again.')
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface id="ready-made-checkout" className="scroll-mt-28 overflow-hidden">
      <SurfaceHeader eyebrow="Checkout" title="Start ready-made checkout" description="Confirm size, fulfillment, recipient details, tax, and total before payment starts." />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Size" hint={sizes.length > 0 && size ? `${selectedSizeInventory} left in ${size}` : `${readyMadeInventoryCount(item)} ready now`}>
            <NativeSelect value={size} onChange={(event) => setSize(event.target.value)}>
              {sizes.length === 0 ? <option value="">One size</option> : sizes.map((entry) => {
                const remaining = readyMadeQuantityForSize(item, entry)
                return <option key={entry} value={entry} disabled={remaining <= 0}>{remaining <= 0 ? `${entry} · sold out` : entry}</option>
              })}
            </NativeSelect>
          </Field>
          <Field label="Quantity" error={quantityInvalid ? `Enter 1–${maxCheckoutQuantity}` : undefined} hint={!quantityInvalid ? `Max ${maxCheckoutQuantity}` : undefined}>
            <Input
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={quantityInvalid ? 'border-rust/60 focus:border-rust focus:ring-rust/10' : undefined}
            />
          </Field>
          <Field label="Fulfillment">
            <NativeSelect value={fulfillment} onChange={(event) => setFulfillment(event.target.value)}>
              {item.pickup_available ? <option value="PICKUP" disabled={pickupBlocked}>{pickupBlocked ? 'Pickup not ready' : 'Pickup'}</option> : null}
              {item.delivery_available ? <option value="DELIVERY">Delivery</option> : null}
              {item.shipping_available ? <option value="SHIPPING">Shipping</option> : null}
            </NativeSelect>
          </Field>
        </div>
        {fulfillment === 'PICKUP' ? (
          <p className="text-sm leading-6 text-ink/58">Exact pickup details are shared only after the seller marks the order ready for collection.</p>
        ) : null}
        {needsAddress ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Recipient name" />
            <Input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="Recipient phone for courier only" />
            <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" className="md:col-span-2" />
            <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" />
            <Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Region/state" />
            <Input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} placeholder="Postal code" />
            <Input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} placeholder="Country code" maxLength={2} />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4 rounded-[8px] border border-ui-border bg-ui-muted/45 px-4 py-3 text-sm leading-6 text-ink/70">
          <span>I understand cancellation and handoff reviews stay inside Drapeon.</span>
          <Switch checked={ack} onCheckedChange={setAck} aria-label="Acknowledge cancellation policy" />
        </div>
        <div className="rounded-[8px] border border-ink/8 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Tax and total</p>
          {pricingPreview ? (
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">Item subtotal</span>
                <span className="font-semibold text-ink">{formatMoney(pricingPreview.subtotalAmount, pricingPreview.currency)}</span>
              </div>
              {pricingPreview.shippingAmount > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink/58">Drapeon fulfillment</span>
                  <span className="font-semibold text-ink">{formatMoney(pricingPreview.shippingAmount, pricingPreview.currency)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">{pricingPreview.taxFallback ? 'Estimated tax' : pricingPreview.taxLabel || 'Tax'}</span>
                <span className="font-semibold text-ink">{formatMoney(pricingPreview.taxAmount, pricingPreview.currency)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-ink/8 pt-3">
                <span className="font-semibold text-ink">Total</span>
                <span className="text-lg font-semibold text-needle">{formatMoney(pricingPreview.totalAmount, pricingPreview.currency)}</span>
              </div>
              {pricingPreview.taxFallback ? (
                <p className="text-xs leading-5 text-rust">Tax is estimated because live tax lookup was unavailable for this address.</p>
              ) : null}
              {!previewIsFresh ? (
                <p className="text-xs leading-5 text-rust">Checkout details changed. Refresh the tax preview before creating checkout.</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/62">Calculate the checkout preview to see locked tax and total before payment starts.</p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => { void previewCheckout() }} disabled={pricingBusy || busy || !data.userId || !hasFulfillmentOption}>
            {pricingBusy ? 'Calculating...' : 'Preview tax and total'}
          </Button>
          <Button onClick={startCheckout} disabled={busy || pricingBusy || !data.userId || !hasFulfillmentOption || !previewIsFresh}>
            {busy ? 'Starting checkout...' : 'Create checkout'}
          </Button>
        </div>
      </div>
    </Surface>
  )
}

function ProfileSettingsEditor({ data, session, onRefresh }: { data: SettingsRenderData; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const currentDisplayName = data.customerProfile?.display_name || data.tailorProfile?.display_name || data.tailorProfile?.business_name || ''
  const currentCurrency = data.accountCurrency || data.tailorProfile?.currency || 'USD'
  const [displayName, setDisplayName] = useState(currentDisplayName)
  const [currency, setCurrency] = useState(currentCurrency)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function saveDisplayName() {
    setError(null)
    setSuccess(null)
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) {
      setError(displayNameError)
      return
    }
    setBusy('name')
    try {
      await invokeAccountFunction('account-profile-action', {
        action: 'update-display-name',
        role,
        displayName: displayName.trim(),
      })
      setSuccess('Display name updated.')
      onRefresh()
    } catch (nameError) {
      setError(friendlyActionError(nameError, 'Display name could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function saveCurrency() {
    setError(null)
    setSuccess(null)
    setBusy('currency')
    try {
      await invokeAccountFunction('account-profile-action', {
        action: 'update-currency',
        role,
        currency,
      })
      setSuccess('Currency preference updated.')
      onRefresh()
    } catch (currencyError) {
      setError(friendlyActionError(currencyError, 'Currency could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader eyebrow="Editable on web" title="Profile basics" description="Update how your account is identified and which currency drives visible prices." />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Display name">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your public display name" />
          </Field>
          <Button onClick={saveDisplayName} disabled={busy === 'name'}>
            {busy === 'name' ? 'Saving...' : 'Save name'}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Currency">
            <NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
            </NativeSelect>
          </Field>
          <Button onClick={saveCurrency} disabled={busy === 'currency'}>
            {busy === 'currency' ? 'Saving...' : 'Save currency'}
          </Button>
        </div>
        <p className="text-sm leading-6 text-ink/60">
          Phone changes, OTP, payout setup, and account deletion stay behind the stronger guarded flows.
        </p>
      </div>
    </Surface>
  )
}

function AvatarUploadPanel({ data, session, onRefresh }: { data: Pick<SettingsRenderData, 'userId' | 'customerProfile' | 'tailorProfile'>; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const currentAvatar = safeMediaUrl(data.tailorProfile?.avatar_url ?? data.customerProfile?.avatar_url, 'avatars')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const avatarReviewKey = `${data.tailorProfile?.avatar_url ?? ""}:${data.tailorProfile?.id_verification_rejected_at ?? ""}:${data.tailorProfile?.id_verification_status ?? ""}`
  const [localRejectedAvatarState, setLocalRejectedAvatarState] = useState<{ key: string; cleared: boolean } | null>(null)
  const avatarPreviewKey = `${data.userId ?? ''}:${role}`
  const [savedAvatarPreview, setSavedAvatarPreview] = useState<{ key: string; url: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const savedAvatarUrl = savedAvatarPreview?.key === avatarPreviewKey ? savedAvatarPreview.url : null
  const displayAvatar = previewUrl ?? savedAvatarUrl ?? currentAvatar
  const profileImageRejectedFromData = data.tailorProfile ? isInvalidProfileImageRejected(data.tailorProfile) : false
  const localRejectedAvatarCleared = localRejectedAvatarState?.key === avatarReviewKey ? localRejectedAvatarState.cleared : false
  const profileImageRejected = profileImageRejectedFromData && !localRejectedAvatarCleared

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])


  function setSelectedAvatarFile(nextFile: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setFile(nextFile)
    if (!nextFile) {
      setPreviewUrl(null)
      return
    }
    if (profileImageRejectedFromData) setLocalRejectedAvatarState({ key: avatarReviewKey, cleared: true })
    const nextPreviewUrl = URL.createObjectURL(nextFile)
    previewUrlRef.current = nextPreviewUrl
    setPreviewUrl(nextPreviewUrl)
  }

  async function saveAvatar() {
    setError(null)
    setSuccess(null)
    if (!data.userId || !file) {
      setError('Choose a profile photo first.')
      return
    }
    const photoError = validateMessagePhoto(file)
    if (photoError) {
      setError(photoError)
      return
    }
    setBusy(true)
    try {
      const prepared = await reencodeImageFile(file)
      const avatarUrl = await uploadPublicFile('avatars', data.userId, prepared)
      await invokeAccountFunction('account-profile-action', {
        action: 'update-avatar',
        role,
        avatarUrl,
      })
      setSavedAvatarPreview({
        key: avatarPreviewKey,
        url: safeMediaUrl(avatarUrl, 'avatars') ?? avatarUrl,
      })
      setSelectedAvatarFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSuccess(profileImageRejectedFromData ? 'Profile photo replacement submitted for review.' : 'Profile photo updated.')
      setLocalRejectedAvatarState({ key: avatarReviewKey, cleared: true })
      onRefresh()
    } catch (avatarError) {
      setError(friendlyActionError(avatarError, 'Profile photo could not update.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface id="profile-photo" className={profileImageRejected ? 'border-rust/24 bg-rust/8 p-5' : 'p-5'}>
      <div className="grid gap-5 md:grid-cols-[120px_1fr] md:items-center">
        <div className={profileImageRejected ? 'relative h-28 w-28 overflow-hidden rounded-[8px] border-2 border-rust bg-bone ring-4 ring-rust/12' : 'relative h-28 w-28 overflow-hidden rounded-[8px] border border-ink/8 bg-bone'}>
          {displayAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayAvatar} alt={previewUrl ? 'Selected profile preview' : 'Current profile'} className="h-full w-full object-cover" />
          ) : null}
          {profileImageRejected ? (
            <span className="absolute inset-x-2 bottom-2 rounded-full bg-rust px-2 py-1 text-center text-[0.68rem] font-semibold text-white">
              Rejected / Invalid
            </span>
          ) : previewUrl ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-ink/72 px-2 py-1 text-[0.68rem] font-semibold text-white">
              Preview
            </span>
          ) : null}
        </div>
        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Profile photo</p>
          <h2 className="text-xl font-semibold text-ink">{profileImageRejected ? 'Replace rejected avatar' : 'Update avatar'}</h2>
          {profileImageRejected ? (
            <div className="rounded-[8px] border border-rust/20 bg-white p-4 text-sm leading-6 text-rust">
              {PROFILE_IMAGE_REJECTION_MESSAGE}
            </div>
          ) : null}
          <ActionNotice error={error} success={success} />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              setError(null)
              setSuccess(null)
              setSelectedAvatarFile(event.target.files?.[0] ?? null)
            }}
            className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
          />
          <Button onClick={saveAvatar} disabled={busy || !file} className="w-fit">
            {busy ? 'Uploading...' : 'Save profile photo'}
          </Button>
        </div>
      </div>
    </Surface>
  )
}

function PortfolioManager({ data, onRefresh }: { data: Pick<ProfileRenderData, 'userId' | 'tailorProfile' | 'portfolioItems'>; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingItem = data.portfolioItems.find((item) => item.id === editingId) ?? null
  const profileVideoUrls = stringList(data.tailorProfile?.portfolio_video_urls)
  const portfolioItemEntries: SortableMediaEntry[] = data.portfolioItems.flatMap((item, index) => (
    item.image_url
      ? [{
          id: item.id,
          url: item.image_url,
          label: safeUserText(item.title, `Portfolio ${index + 1}`),
        }]
      : []
  ))
  const profileVideoEntries: SortableMediaEntry[] = profileVideoUrls.map((url, index) => ({
    id: `portfolio-video-${index}-${url}`,
    url,
    label: `Portfolio video ${index + 1}`,
  }))
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [portfolioInspectIndex, setPortfolioInspectIndex] = useState<number | null>(null)
  const [portfolioVideoInspectIndex, setPortfolioVideoInspectIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const videoFileRef = useRef<HTMLInputElement | null>(null)

  if (!data.tailorProfile) return null

  function startEdit(item: PortfolioItem) {
    setEditingId(item.id)
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setCategory('')
    setDescription('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handlePortfolioVideoSelection(nextFile: File | null) {
    setError(null)
    setSuccess(null)
    if (!nextFile) {
      setVideoFile(null)
      return
    }

    try {
      await preparePortfolioVideoFile(nextFile)
      setVideoFile(nextFile)
    } catch (videoError) {
      setVideoFile(null)
      if (videoFileRef.current) videoFileRef.current.value = ''
      setError(friendlyActionError(videoError, 'Choose an MP4 or MOV video under the portfolio limits.'))
    }
  }

  async function savePortfolioVideo() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    if (!videoFile) {
      setError('Choose a portfolio video.')
      return
    }
    if (profileVideoUrls.length >= 4) {
      setError('You can include up to 4 portfolio videos.')
      return
    }

    setBusy('save-video')
    try {
      const preparedVideo = await preparePortfolioVideoFile(videoFile)
      const videoUrl = await uploadPublicFile('portfolio-photos', `portfolio/${data.userId}/videos`, preparedVideo)
      const videoUrls = uniqueValues([...profileVideoUrls, videoUrl]).slice(0, 4)
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls,
      })
      setVideoFile(null)
      if (videoFileRef.current) videoFileRef.current.value = ''
      setSuccess('Portfolio video added.')
      onRefresh()
    } catch (videoError) {
      setError(friendlyActionError(videoError, 'Portfolio video could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function deletePortfolioVideo(videoUrl: string) {
    setError(null)
    setSuccess(null)
    setBusy(`delete-video:${videoUrl}`)
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls: profileVideoUrls.filter((url) => url !== videoUrl),
      })
      setSuccess('Portfolio video removed.')
      onRefresh()
    } catch (videoError) {
      setError(friendlyActionError(videoError, 'Portfolio video could not be removed.'))
    } finally {
      setBusy(null)
    }
  }


  async function reorderPortfolioVideos(nextEntries: SortableMediaEntry[]) {
    const videoUrls = nextEntries.map((entry) => entry.url)
    setError(null)
    setSuccess(null)
    setBusy('reorder-videos')
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls,
      })
      setSuccess('Portfolio video order updated.')
      onRefresh()
    } catch (videoError) {
      setError(friendlyActionError(videoError, 'Portfolio video order could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function reorderPortfolioItems(nextEntries: SortableMediaEntry[]) {
    const itemIds = nextEntries.map((entry) => entry.id)
    setError(null)
    setSuccess(null)
    setBusy('reorder-items')
    try {
      await invokeAccountFunction('portfolio-item-action', {
        action: 'reorder-items',
        itemIds,
      })
      setSuccess('Portfolio order updated.')
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio order could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function savePortfolioItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    const leak = assertNoContactLeak([title, category, description].join('\n'), "Portfolio items can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim()) {
      setError('Add a portfolio title.')
      return
    }
    if (!editingItem && !file) {
      setError('Choose a portfolio image.')
      return
    }
    if (file) {
      const photoError = validateMessagePhoto(file)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy('save')
    try {
      const imageUrl = file
        ? await uploadPublicFile('portfolio-photos', `portfolio/${data.userId}`, await reencodeImageFile(file))
        : editingItem?.image_url
      if (!imageUrl) throw new Error('Choose a portfolio image.')
      await invokeAccountFunction('portfolio-item-action', editingId
        ? {
            action: 'update-item',
            itemId: editingId,
            item: {
              imageUrl,
              title: title.trim(),
              category: category.trim() || null,
              description: description.trim() || null,
            },
          }
        : {
            action: 'create-item',
            item: {
              imageUrl,
              title: title.trim(),
              category: category.trim() || null,
              description: description.trim() || null,
            },
          })
      setSuccess(editingId ? 'Portfolio item updated.' : 'Portfolio item added.')
      resetForm()
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio item could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function runPortfolioAction(action: 'delete-item' | 'set-cover', itemId: string) {
    setError(null)
    setSuccess(null)
    setBusy(`${action}:${itemId}`)
    try {
      await invokeAccountFunction('portfolio-item-action', { action, itemId })
      setSuccess(action === 'set-cover' ? 'Cover photo updated.' : 'Portfolio item deleted.')
      if (editingId === itemId) resetForm()
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio action could not finish.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Surface className="overflow-hidden">
      {portfolioInspectIndex != null ? (
        <MediaInspectionOverlay
          entries={portfolioItemEntries}
          initialIndex={portfolioInspectIndex}
          onClose={() => setPortfolioInspectIndex(null)}
        />
      ) : null}
      {portfolioVideoInspectIndex != null ? (
        <MediaInspectionOverlay
          entries={profileVideoEntries}
          initialIndex={portfolioVideoInspectIndex}
          onClose={() => setPortfolioVideoInspectIndex(null)}
        />
      ) : null}
      <SurfaceHeader
        eyebrow="Portfolio"
        title="Manage public work"
        description="Add, inspect, and arrange the work customers use to evaluate your craft."
        action={editingId ? <Button variant="ghost" size="sm" onClick={resetForm} className="text-rust hover:text-rust">Cancel edit</Button> : null}
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
          <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink md:col-span-2" />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Short description" className="md:col-span-2" />
        </div>
        <Button onClick={savePortfolioItem} disabled={busy === 'save'} className="w-fit">
          {busy === 'save' ? 'Saving...' : editingId ? 'Update portfolio item' : 'Add portfolio item'}
        </Button>

        <div className="rounded-[8px] border border-ui-border bg-ui-muted/45 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Portfolio videos</h3>
            <p className="mt-1 text-sm leading-6 text-ink/62">
              Add MP4 or MOV clips up to {PORTFOLIO_VIDEO_MAX_SECONDS} seconds and {Math.round(PORTFOLIO_VIDEO_MAX_BYTES / (1024 * 1024))} MB.
            </p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
            {profileVideoUrls.length}/4
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <input
            ref={videoFileRef}
            type="file"
            accept="video/mp4,video/quicktime"
            onChange={(event) => {
              void handlePortfolioVideoSelection(event.target.files?.[0] ?? null)
            }}
            disabled={profileVideoUrls.length >= 4}
            className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            onClick={savePortfolioVideo}
            disabled={busy === 'save-video' || !videoFile || profileVideoUrls.length >= 4}
          >
            {busy === 'save-video' ? 'Uploading...' : 'Add video'}
          </Button>
        </div>
        {profileVideoEntries.length > 0 ? (
          <div className="mt-4 grid gap-3">
            <SortableMediaGrid
              entries={profileVideoEntries}
              busy={!!busy}
              onInspect={setPortfolioVideoInspectIndex}
              onReorder={(nextEntries) => { void reorderPortfolioVideos(nextEntries) }}
              onDelete={(index) => {
                const videoUrl = profileVideoEntries[index]?.url
                if (videoUrl) void deletePortfolioVideo(videoUrl)
              }}
            />
          </div>
        ) : null}
        </div>

        <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-ink">Portfolio gallery order</h3>
          <span className="text-xs text-ink/48">First tile is cover</span>
        </div>
        {portfolioItemEntries.length === 0 ? (
          <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            No editable portfolio rows yet. Add one to make your public profile stronger.
          </p>
        ) : (
          <SortableMediaGrid
            entries={portfolioItemEntries}
            busy={!!busy}
            imageClassName="object-cover object-top"
            onInspect={setPortfolioInspectIndex}
            onReorder={(nextEntries) => { void reorderPortfolioItems(nextEntries) }}
            onDelete={(index) => {
              const entry = portfolioItemEntries[index]
              if (entry) void runPortfolioAction('delete-item', entry.id)
            }}
            renderActions={(entry) => {
              const item = data.portfolioItems.find((candidate) => candidate.id === entry.id)
              return item ? (
                <Button type="button" onClick={() => startEdit(item)} variant="secondary" size="sm">Edit</Button>
              ) : null
            }}
          />
        )}
        </div>
      </div>
    </Surface>
  )
}

function RenderExplore({ data }: { data: ExploreRenderData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasInitialFilters = searchParams.toString().length > 0
  const initialSort = searchParams.get('sort')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(hasInitialFilters)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') ?? 'all')
  const [location, setLocation] = useState(searchParams.get('location') ?? 'all')
  const [availability, setAvailability] = useState(searchParams.get('availability') ?? 'all')
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') ?? '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '')
  const [sort, setSort] = useState(initialSort === 'recent' ? 'popular' : initialSort ?? 'rating')
  const [customOnly, setCustomOnly] = useState(searchParams.get('custom') === '1')
  const specialties = uniqueValues(data.exploreTailors.flatMap((tailor) => stringList(tailor.specialty_tags))).slice(0, 18)
  const locations = uniqueValues(data.exploreTailors.map((tailor) => tailor.location).filter((value): value is string => !!value)).slice(0, 18)
  const normalizedCurrency = normalizeAccountCurrency(data.accountCurrency)
  const priceCurrencyLabel = normalizedCurrency ? `${currencySymbol(normalizedCurrency)} ${normalizedCurrency}` : 'currency'
  const parsedMinPrice = minPrice.trim() ? Number.parseFloat(minPrice.replace(/[^\d.]/g, '')) : null
  const parsedMaxPrice = maxPrice.trim() ? Number.parseFloat(maxPrice.replace(/[^\d.]/g, '')) : null

  useEffect(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (specialty !== 'all') params.set('specialty', specialty)
    if (location !== 'all') params.set('location', location)
    if (availability !== 'all') params.set('availability', availability)
    if (minPrice.trim()) params.set('minPrice', minPrice.trim())
    if (maxPrice.trim()) params.set('maxPrice', maxPrice.trim())
    if (sort !== 'rating') params.set('sort', sort)
    if (customOnly) params.set('custom', '1')
    const nextQuery = params.toString()
    const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
    router.replace(nextHref as Route, { scroll: false })
  }, [availability, customOnly, location, maxPrice, minPrice, pathname, router, search, sort, specialty])

  const filteredTailors = data.exploreTailors.filter((tailor) => {
    const haystack = [
      tailor.display_name,
      tailor.business_name,
      tailor.bio,
      tailor.location,
      ...stringList(tailor.specialty_tags),
    ].join(' ').toLowerCase()
    if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false
    if (specialty !== 'all' && !stringList(tailor.specialty_tags).includes(specialty)) return false
    if (location !== 'all' && tailor.location !== location) return false
    if (availability !== 'all' && tailor.availability !== availability) return false
    if (customOnly && !tailor.supports_custom_orders) return false
    if (parsedMinPrice && Number.isFinite(parsedMinPrice) && tailor.price_range_max && tailor.price_range_max / 100 < parsedMinPrice) return false
    if (parsedMaxPrice && Number.isFinite(parsedMaxPrice) && tailor.price_range_min && tailor.price_range_min / 100 > parsedMaxPrice) return false
    return true
  }).sort((a, b) => {
    if (sort === 'price') return (a.price_range_min ?? Number.MAX_SAFE_INTEGER) - (b.price_range_min ?? Number.MAX_SAFE_INTEGER)
    if (sort === 'popular') return (b.total_orders ?? 0) - (a.total_orders ?? 0)
    const ratingDelta = (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
    if (ratingDelta !== 0) return ratingDelta
    return (b.total_orders ?? 0) - (a.total_orders ?? 0)
  })
  const availabilityOptions = uniqueValues(data.exploreTailors.map((tailor) => tailor.availability).filter((value): value is string => !!value))
  const activeFilterCount = [
    specialty !== 'all',
    location !== 'all',
    availability !== 'all',
    minPrice.trim(),
    maxPrice.trim(),
    sort !== 'rating',
    customOnly,
  ].filter(Boolean).length

  function clearFilters() {
    setSearch('')
    setSpecialty('all')
    setLocation('all')
    setAvailability('all')
    setMinPrice('')
    setMaxPrice('')
    setSort('rating')
    setCustomOnly(false)
  }

  const filterSidebar = (
    <div className="grid gap-5">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Sort</p>
        <div className="grid gap-1">
          {([['rating', 'Top rated'], ['popular', 'Most orders'], ['price', 'Lowest price']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSort(value)}
              className={sort === value
                ? 'rounded-lg bg-needle px-3 py-2 text-left text-sm font-semibold text-white'
                : 'rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink/62 hover:bg-ink/5 hover:text-ink'}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <hr className="border-ink/6" />
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Specialty</p>
        <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">All specialties</option>
          {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Location</p>
        <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Availability</p>
        <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="all">Any availability</option>
          {availabilityOptions.map((a) => <option key={a} value={a}>{cleanLabel(a)}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Price <span className="normal-case font-normal text-ink/38">({priceCurrencyLabel})</span></p>
        <div className="flex items-center gap-2">
          <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputMode="decimal" placeholder="Min" className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
          <span className="text-xs text-ink/36">–</span>
          <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputMode="decimal" placeholder="Max" className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40" />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink/8 bg-white/72 px-3 py-2.5">
        <input type="checkbox" checked={customOnly} onChange={(e) => setCustomOnly(e.target.checked)} className="h-4 w-4 rounded accent-needle" />
        <span className="text-sm font-semibold text-ink">Custom orders only</span>
      </label>
      {activeFilterCount > 0 ? (
        <button type="button" onClick={clearFilters} className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink/66 hover:text-ink">
          Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="grid gap-4">
      {/* Search + mobile filters toggle */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
          <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by tailor, style, or location..."
          className="pl-9"
          />
        </div>
        <Button
          type="button"
          onClick={() => setMobileFiltersOpen((o) => !o)}
          variant={activeFilterCount > 0 ? 'primary' : 'secondary'}
          className="shrink-0 lg:hidden"
        >
          <SlidersHorizontal /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </div>

      {/* Mobile filter panel */}
      {mobileFiltersOpen ? (
        <Surface className="p-5 lg:hidden">
          {filterSidebar}
        </Surface>
      ) : null}

      {/* Specialty quick chips */}
      <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
        {(['all', ...specialties.slice(0, 10)] as string[]).map((tag) => (
          <Button
            key={tag}
            type="button"
            onClick={() => setSpecialty(tag)}
            variant={specialty === tag ? 'primary' : 'secondary'}
            size="sm"
            className="whitespace-nowrap"
          >
            {tag === 'all' ? 'All tailors' : tag}
          </Button>
        ))}
      </div>

      {/* Two-column layout: sidebar + results */}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 rounded-[8px] border border-ui-border bg-white p-5 shadow-sm">
            {filterSidebar}
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-ink/52">
              {filteredTailors.length} tailor{filteredTailors.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 ? ' matching filters' : ''}
            </p>
            <Link href="/account/shop" className="text-sm font-semibold text-needle">
              Ready-made pieces →
            </Link>
          </div>

          {filteredTailors.length === 0 ? (
            <EmptyState title="No tailors match these filters." body="Adjust filters or clear them to see all tailors." />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredTailors.map((tailor) => {
                const photo = tailorPhoto(tailor)
                const safeSrc = safeMediaUrl(photo)
                const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
                const canRequestBrief = canStartCustomBriefOnWeb(tailor, data.userId)
                const ratingText = tailor.total_reviews
                  ? `${Number(tailor.avg_rating ?? 0).toFixed(1)} (${tailor.total_reviews})`
                  : null
                const priceFrom = tailor.price_range_min ? `from ${formatMoney(tailor.price_range_min, tailor.currency)}` : null
                return (
                  <article key={tailor.id} className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md">
                    {/* Edge-to-edge photo with overlaid badges */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/10">
                      {safeSrc ? (
                        <Image src={safeSrc} alt={safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/60">
                          {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      {/* Overlaid badges */}
                      <div className="absolute inset-x-3 top-3 flex items-start justify-between">
                        {tailor.is_verified ? (
                          <StatusChip status="VERIFIED" className="bg-white/90 shadow-sm backdrop-blur-sm" />
                        ) : <span />}
                        {ratingText ? (
                          <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">
                            ★ {ratingText}
                          </span>
                        ) : null}
                      </div>
                      {/* Availability + price overlaid at bottom */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/78 to-transparent px-4 pb-3 pt-10">
                        <p className="text-xs font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                          {cleanLabel(tailor.availability, 'Check availability')}{priceFrom ? ` · ${priceFrom}` : ''}
                        </p>
                      </div>
                    </div>
                    {/* Card body */}
                    <div className="p-4">
                      <h3 className="text-xl font-semibold text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                      <p className="mt-0.5 text-sm text-ink/52">{safeUserText(tailor.location, 'Location pending')}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/62">
                        {safeUserText(tailor.bio, safeList(tailor.specialty_tags, 'Custom tailoring on Drapeon.'))}
                      </p>
                      {specialtyTags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {specialtyTags.map((tag) => (
                            <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-1 text-xs font-semibold text-needle">{tag}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <Button asChild variant="secondary"><Link href={accountRoute(`/account/tailors/${tailor.id}`)}>View profile</Link></Button>
                        {canRequestBrief ? (
                          <Button asChild><Link href={accountRoute(`/account/brief/${tailor.id}`)}>Request brief</Link></Button>
                        ) : (
                          <button type="button" disabled className="inline-flex cursor-not-allowed justify-center rounded-full bg-ink/10 px-4 py-2.5 text-sm font-semibold text-ink/48">
                            {customBriefUnavailableLabel(tailor, data.userId)}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function measurementSnapshotForChoice(data: Pick<BriefRenderData, 'customerProfile' | 'measurementProfiles'>, choice: string) {
  if (choice === 'legacy' && data.customerProfile?.measurements) {
    return {
      ...data.customerProfile.measurements,
      measurementSource: 'web_legacy_customer_profile',
      unit: data.customerProfile.unit_preference ?? (data.customerProfile.measurements.unit as string | undefined) ?? 'in',
      measurementProfileLabel: 'Customer profile',
      measurementProfileUpdatedAt: data.customerProfile.updated_at,
    }
  }
  const profile = data.measurementProfiles.find((entry) => entry.id === choice)
  if (!profile?.measurements) return null
  return {
    ...profile.measurements,
    measurementSource: `web_${profile.source ?? 'measurement_profile'}`,
    unit: profile.unit_preference ?? (profile.measurements.unit as string | undefined) ?? 'in',
    measurementProfileId: profile.id,
    measurementProfileLabel: profile.label ?? 'Saved measurement profile',
    measurementProfileUpdatedAt: profile.updated_at ?? profile.last_measured_at,
  }
}

function measurementTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  for (const field of ['measurementProfileUpdatedAt', 'capturedAt', 'confirmedAt']) {
    const raw = snapshot[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const date = new Date(raw)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

function measurementAgeFromSnapshot(value: unknown, now = new Date()) {
  const lastUpdated = measurementTimestamp(value)
  if (!lastUpdated) return null
  const ageMonths = Math.max(0, Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
  return {
    lastUpdatedAt: lastUpdated.toISOString(),
    ageMonths,
    stale: ageMonths >= 6,
    warningShown: ageMonths >= 6,
  }
}

function defaultDeliveryMethodForTailor(tailor: TailorProfile | null | undefined) {
  if (tailor?.pickup_available) return 'LOCAL_COLLECTION'
  if (tailor?.delivery_available) return 'LOCAL_DELIVERY'
  return 'SHIPPING'
}

function RenderBrief({ data, tailorId, onRefresh }: { data: BriefRenderData; tailorId?: string; onRefresh: () => void }) {
  const router = useRouter()
  const tailor = data.tailor
  const firstMeasurementId = data.measurementProfiles[0]?.id ?? (data.customerProfile?.measurements ? 'legacy' : 'fallback')
  const [garmentType, setGarmentType] = useState('Agbada')
  const [garmentTypeOther, setGarmentTypeOther] = useState('')
  const [genderPresentation, setGenderPresentation] = useState<'Menswear' | 'Womenswear' | 'Unisex'>('Unisex')
  const [description, setDescription] = useState('')
  const [occasion, setOccasion] = useState('Event')
  const [occasionOther, setOccasionOther] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadlineInput)
  const [wearerMode, setWearerMode] = useState<'SELF' | 'OTHER' | 'GROUP'>('SELF')
  const [wearerName, setWearerName] = useState('')
  const [bulkRecipientCount, setBulkRecipientCount] = useState('')
  const [bulkLabel, setBulkLabel] = useState('')
  const [bulkMemberNames, setBulkMemberNames] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [styleLinks, setStyleLinks] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [fitNote, setFitNote] = useState('')
  const [measurementChoice, setMeasurementChoice] = useState(firstMeasurementId)
  const [referencePhotos, setReferencePhotos] = useState<File[]>([])
  const [fabricSource, setFabricSource] = useState<'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'>('TAILOR_SOURCES')
  const [fabricDescription, setFabricDescription] = useState('')
  const [fabricBudget, setFabricBudget] = useState('')
  const [fabricBudgetCurrency, setFabricBudgetCurrency] = useState(normalizeAccountCurrency(data.accountCurrency ?? tailor?.currency ?? 'USD') ?? 'USD')
  const [fabricReferenceFiles, setFabricReferenceFiles] = useState<File[]>([])
  const [fabricReferenceLinksInput, setFabricReferenceLinksInput] = useState('')
  const [fabricSubstitutionPreference, setFabricSubstitutionPreference] = useState('')
  const [bulkFabricMode, setBulkFabricMode] = useState('')
  const [fabricVendorName, setFabricVendorName] = useState('')
  const [fabricVendorLocation, setFabricVendorLocation] = useState('')
  const [fabricVendorLink, setFabricVendorLink] = useState('')
  const [fabricVendorNotes, setFabricVendorNotes] = useState('')
  const [fabricSourcingDeadlineDays, setFabricSourcingDeadlineDays] = useState(CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS)
  const [deliveryMethod, setDeliveryMethod] = useState<'LOCAL_COLLECTION' | 'LOCAL_DELIVERY' | 'SHIPPING'>(defaultDeliveryMethodForTailor(tailor))
  const [shippingPreference, setShippingPreference] = useState<'STANDARD' | 'EXPRESS'>('STANDARD')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [recipientName, setRecipientName] = useState(data.customerProfile?.display_name ?? '')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryRegion, setDeliveryRegion] = useState('')
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('')
  const [deliveryCountryCode, setDeliveryCountryCode] = useState('US')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const fabricMediaInputRef = useRef<HTMLInputElement | null>(null)

  if (!tailor || !tailorId) {
    return (
      <EmptyState
        title="Tailor not found."
        body="Choose a tailor before starting a custom brief."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }

  if (tailor.supports_custom_orders !== true) {
    return (
      <EmptyState
        title="Custom orders are not listed for this tailor."
        body="Browse ready-made pieces or open the app if you already have an active order with this tailor."
        action={<Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="font-semibold text-needle">Back to profile</Link>}
      />
    )
  }

  if (!canStartCustomBriefOnWeb(tailor, data.userId)) {
    return (
      <EmptyState
        title={customBriefUnavailableLabel(tailor, data.userId)}
        body="This tailor is not accepting new custom briefs from this account right now. You can review the profile, save the tailor, or browse other available tailors."
        action={<Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="font-semibold text-needle">Back to profile</Link>}
      />
    )
  }

  const selectedTailor = tailor
  const baseMeasurementSnapshot = measurementChoice === 'fallback' ? null : measurementSnapshotForChoice(data, measurementChoice)
  const styleReferenceLinks = linesToUrls(styleLinks)
  const fabricReferenceLinks = linesToUrls(fabricReferenceLinksInput)
  const needsDeliveryDetails = deliveryMethod !== 'LOCAL_COLLECTION'
  const fabricBudgetAmount = parseMinorUnits(fabricBudget)
  const selectedFabricSubstitution = FABRIC_SUBSTITUTION_OPTIONS.find((option) => option.value === fabricSubstitutionPreference)
  const selectedBulkFabricMode = BULK_FABRIC_MODE_OPTIONS.find((option) => option.value === bulkFabricMode)

  async function submitBrief() {
    setError(null)
    setSuccess(null)
    setCreatedOrderId(null)
    const deadlineIso = dateInputToIso(deadline)
    const deadlineDate = deadlineIso ? new Date(deadlineIso) : null
    const normalizedRecipientPhone = needsDeliveryDetails ? normalizePhoneForStorage(recipientPhone) : ''

    const textToCheck = [
      description,
      styleNotes,
      fitNote,
      fabricDescription,
      fabricVendorName,
      fabricVendorLocation,
      fabricVendorNotes,
      wearerName,
      bulkLabel,
      bulkMemberNames,
      bulkNotes,
      deliveryInstructions,
      deliveryAddress,
      deliveryCity,
      deliveryRegion,
      recipientName,
    ].join('\n')
    const leak = assertNoContactLeak(textToCheck, "Briefs can't include phone numbers, emails, links, social handles, or off-platform contact instructions.")
    if (leak) {
      setError(leak)
      return
    }
    if (!isCustomOrderBriefLongEnough(description)) {
      setError('Write one clear paragraph, or at least 3 short lines, describing the garment.')
      return
    }
    if (!deadlineDate || Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < customOrderMinimumDeliveryDate().getTime()) {
      setError('Target delivery date must be at least 2 weeks from today.')
      return
    }
    if (garmentType === 'Other' && !garmentTypeOther.trim()) {
      setError('Describe the garment type when choosing Other.')
      return
    }
    if (styleReferenceLinks.length > CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setError(`Add no more than ${CUSTOM_ORDER_MAX_STYLE_LINKS} style links. Remove extra links before submitting.`)
      return
    }
    if (styleReferenceLinks.length === 0 && referencePhotos.length === 0) {
      setError('Add at least one Instagram, Pinterest, or TikTok reference link, or attach a reference photo.')
      return
    }
    const unsupportedStyleLink = styleReferenceLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupportedStyleLink) {
      setError('Style links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    if (fabricReferenceLinks.length > CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setError('Add no more than ' + CUSTOM_ORDER_MAX_STYLE_LINKS + ' fabric links. Remove extra links before submitting.')
      return
    }
    const unsupportedFabricLink = fabricReferenceLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupportedFabricLink) {
      setError('Fabric links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    if (fabricReferenceFiles.length > MAX_WEB_FABRIC_REFERENCE_MEDIA) {
      setError('Add no more than ' + MAX_WEB_FABRIC_REFERENCE_MEDIA + ' fabric media files.')
      return
    }
    let normalizedFabricVendorLink: string | null = null
    if (fabricVendorLink.trim()) {
      try {
        const trimmedVendorLink = fabricVendorLink.trim()
        const url = new URL(trimmedVendorLink.startsWith('http://') || trimmedVendorLink.startsWith('https://') ? trimmedVendorLink : 'https://' + trimmedVendorLink)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported vendor link')
        normalizedFabricVendorLink = url.toString()
      } catch {
        setError('Enter a valid vendor website or social link.')
        return
      }
    }
    if (wearerMode === 'OTHER' && wearerName.trim().length < 2) {
      setError('Add the wearer name for this brief.')
      return
    }
    const bulkCount = Number.parseInt(bulkRecipientCount, 10)
    if (wearerMode === 'GROUP' && (!Number.isFinite(bulkCount) || bulkCount < 2)) {
      setError('Add at least 2 wearers for a group order.')
      return
    }
    if (!baseMeasurementSnapshot) {
      setError('Add saved measurements before submitting. This gives your tailor the fit context they need for an accurate quote.')
      return
    }
    if (fitNote.trim().length < 20) {
      setError('Add a fit note with at least 20 characters before submitting.')
      return
    }
    const fabricIssues = getCustomOrderFabricIssues({
      fabricSource,
      fabricDescription,
      fabricBudgetAmount,
      fabricBudgetCurrency,
      fabricReferenceMediaCount: fabricReferenceFiles.length,
      fabricReferenceLinkCount: fabricReferenceLinks.length,
      fabricSubstitutionPreference,
      fabricHandoffMode: fabricSource === 'CUSTOMER_SUPPLIES' ? 'CUSTOMER_TO_TAILOR' : null,
      isBulkOrder: wearerMode === 'GROUP',
      bulkRecipientCount: Number.isFinite(bulkCount) ? bulkCount : null,
      bulkFabricMode,
      suggestedVendorName: fabricVendorName,
      suggestedVendorLocation: fabricVendorLocation,
      suggestedVendorLink: normalizedFabricVendorLink,
      suggestedVendorNotes: fabricVendorNotes,
    })
    const firstFabricIssue = fabricIssues[0]
    if (firstFabricIssue) {
      setError(firstFabricIssue.message)
      return
    }
    for (const photo of referencePhotos) {
      const photoError = validateMessagePhoto(photo)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    if (needsDeliveryDetails && (!recipientName.trim() || !deliveryAddress.trim() || !deliveryCity.trim() || !deliveryRegion.trim() || !deliveryCountryCode.trim())) {
      setError('Add the full delivery address before submitting. Street, city, region, and country are required.')
      return
    }
    const recipientPhoneError = needsDeliveryDetails ? validatePhoneForProfile(normalizedRecipientPhone) : null
    if (recipientPhoneError) {
      setError(recipientPhoneError)
      return
    }
    if (!acknowledged) {
      setError('Review and acknowledge the cancellation and handoff policy before submitting.')
      return
    }

    const wearerLabel = wearerMode === 'GROUP'
      ? bulkLabel.trim() || 'Group order'
      : wearerMode === 'SELF'
        ? data.customerProfile?.display_name ?? 'Me'
        : wearerName.trim()
    const wearerContext = {
      mode: wearerMode,
      label: wearerLabel,
      measurementProfileLabel: wearerMode === 'GROUP'
        ? wearerLabel
        : measurementChoice === 'fallback'
          ? 'Tailor follow-up needed'
          : wearerLabel,
      relationship: wearerMode === 'GROUP' ? 'GROUP' : wearerMode === 'SELF' ? 'BUYER' : 'NAMED_OTHER',
      selectedAt: new Date().toISOString(),
      note: wearerMode === 'GROUP'
        ? 'Group order measurements are handled per wearer before quote acceptance.'
        : wearerMode === 'OTHER'
          ? 'Customer confirmed the attached measurements are for this named wearer.'
          : null,
    }
    const measurementSnapshot = baseMeasurementSnapshot
      ? {
          ...baseMeasurementSnapshot,
          wearerContext,
          measurementProfileLabel: wearerContext.measurementProfileLabel,
        }
      : null
    const measurementAge = measurementAgeFromSnapshot(measurementSnapshot)
    const fabricPolicy = fabricSource === 'CUSTOMER_SUPPLIES'
      ? {
          approvalRequiredForTailorSourcing: true,
          rejectionReasons: [
            'Poor fabric quality',
            'Insufficient yardage',
            'Wrong fabric type',
            'Fabric damaged or mismatched',
            'Non-continuous remnants or unusable width',
          ],
          lateFabricRule: 'Production stays paused until the tailor confirms fabric receipt.',
          missingFabricRule: 'If the fabric never arrives, the customer can resend, ask the tailor to source, revise the design, or request cancellation review.',
          replacementRule: 'Replacement fabric must be confirmed inside the order before cutting resumes.',
          disagreementRule: 'If fabric suitability is disputed, Drapeon reviews the timeline before work continues.',
          prepRequirements: [
            'Share the handoff plan before the order is submitted',
            'Keep any shipping reference inside the order thread',
            'Keep receipt or dropoff proof in Drapeon if fabric value is material',
            'Do not expect cutting to start before receipt is confirmed',
          ],
        }
      : {
          approvalRequiredForTailorSourcing: true,
          replacementRule: 'Tailor-sourced fabric should only be replaced after customer approval inside Drapeon.',
          disagreementRule: 'If sourcing changes the agreed design or budget, Drapeon should review before work continues.',
          prepRequirements: [
            'Fabric sourcing is covered by the accepted quote',
            'Tailor should not buy replacement fabric without approval',
            'Fabric proof should be photographed in natural light when color matters',
          ],
        }
    const bulkMembers = bulkMemberNames
      .split(/\n|,/u)
      .map((name) => name.trim())
      .filter(Boolean)
    const bulkOrder = wearerMode === 'GROUP'
      ? {
          enabled: true,
          mode: 'OPS_MANAGED_SPECIAL_CASE',
          label: bulkLabel.trim() || null,
          recipientCount: bulkCount,
          memberNames: bulkMembers.length > 0 ? bulkMembers : null,
          memberMeasurementPolicy: 'Each wearer needs their own measurement profile before quote acceptance. Do not reuse the buyer profile unless the buyer is also that wearer.',
          payerModel: 'SINGLE_PAYER',
          measurementPrivacy: 'TAILOR_ONLY',
          statusPolicy: 'OPS_MANAGED_LINKED_CHILDREN',
          dyeLotConsistencyRequired: true,
          fabricMode: bulkFabricMode || null,
          fabricModeLabel: selectedBulkFabricMode?.label ?? null,
          notes: bulkNotes.trim() || null,
        }
      : null
    const styleAlignment = {
      requiredBeforeCutting: true,
      referencePhotoCount: referencePhotos.length,
      styleReferenceLinkCount: styleReferenceLinks.length,
      instruction: 'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.',
      customerExpectation: 'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
    }
    const supportMeta = {
      source: 'web',
      wearerContext,
      bulkOrder,
      fabricPolicy,
      fabricReference: {
        sourceMode: fabricSource,
        mediaCount: fabricReferenceFiles.length,
        linkCount: fabricReferenceLinks.length,
        links: fabricReferenceLinks,
      },
      customerFabricProof: fabricSource === 'CUSTOMER_SUPPLIES'
        ? {
            requiredBeforeQuote: true,
            mediaCount: fabricReferenceFiles.length,
            referenceLinks: fabricReferenceLinks,
          }
        : null,
      measurementAge,
      styleAlignment,
      measurementFallback: !measurementSnapshot
        ? { requiredBeforeQuote: true, note: fitNote.trim() }
        : null,
      fabricHandoffMode: fabricSource === 'CUSTOMER_SUPPLIES' ? 'CUSTOMER_TO_TAILOR' : 'NO_CUSTOMER_HANDOFF_REQUIRED',
      fabricHandoffLabel: fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer will coordinate fabric handoff in Drapeon' : 'No customer fabric handoff required',
      fabricSourcing: fabricSource === 'TAILOR_SOURCES'
        ? {
            description: fabricDescription.trim() || null,
            budgetAmount: fabricBudgetAmount,
            budgetCurrency: fabricBudgetAmount ? fabricBudgetCurrency : null,
            deadlineBusinessDays: fabricSourcingDeadlineDays,
            referenceLinks: fabricReferenceLinks,
            referenceMediaCount: fabricReferenceFiles.length,
            substitutionPreference: fabricSubstitutionPreference || null,
            substitutionLabel: selectedFabricSubstitution?.label ?? null,
            suggestedVendor: fabricVendorName.trim() || fabricVendorLocation.trim() || normalizedFabricVendorLink || fabricVendorNotes.trim()
              ? {
                  name: fabricVendorName.trim() || null,
                  location: fabricVendorLocation.trim() || null,
                  link: normalizedFabricVendorLink,
                  notes: fabricVendorNotes.trim() || null,
                }
              : null,
            bulkFabricMode: bulkFabricMode || null,
            bulkFabricModeLabel: selectedBulkFabricMode?.label ?? null,
          }
        : null,
      webBrief: {
        createdAt: new Date().toISOString(),
        styleReferenceLinkCount: styleReferenceLinks.length,
        referencePhotoCount: referencePhotos.length,
        hasReferencePhoto: referencePhotos.length > 0,
      },
    }

    const buildPayload = (
      action: 'preflight-create-order' | 'create-order',
      uploadedReferencePhotoUrls: string[],
      uploadedFabricReferenceUrls: string[] = [],
    ) => {
      const supportMetaRecord = supportMeta as Record<string, unknown>
      const payloadSupportMeta = {
        ...supportMetaRecord,
        fabricReference: {
          ...(supportMetaRecord.fabricReference as Record<string, unknown>),
          mediaUrls: uploadedFabricReferenceUrls,
        },
        ...(fabricSource === 'TAILOR_SOURCES'
          ? {
              fabricSourcing: {
                ...(supportMetaRecord.fabricSourcing as Record<string, unknown>),
                referenceMediaUrls: uploadedFabricReferenceUrls,
              },
            }
          : {
              customerFabricProof: {
                ...(supportMetaRecord.customerFabricProof as Record<string, unknown>),
                mediaUrls: uploadedFabricReferenceUrls,
              },
            }),
      }

      return {
        action,
        tailorProfileId: selectedTailor.id,
        garmentType,
        garmentTypeOther: garmentType === 'Other' ? garmentTypeOther.trim() : null,
        genderPresentation,
        description: description.trim(),
        occasion: occasion === 'Other' ? occasionOther.trim() || 'Other' : occasion || null,
        deadline: deadlineIso,
        referencePhotos: uploadedReferencePhotoUrls,
        referencePhotoCount: action === 'preflight-create-order' ? referencePhotos.length : uploadedReferencePhotoUrls.length,
        styleReferenceLinks,
        styleNotes: styleNotes.trim() || null,
        customerMeasurementsSnapshot: measurementSnapshot,
        fitNote: fitNote.trim() || null,
        bodyNote: fitNote.trim() || null,
        fabricSource,
        fabricDescription: fabricSource === 'TAILOR_SOURCES' ? fabricDescription.trim() : null,
        fabricBudgetAmount: fabricSource === 'TAILOR_SOURCES' ? fabricBudgetAmount : null,
        fabricBudgetCurrency: fabricSource === 'TAILOR_SOURCES' ? fabricBudgetCurrency : null,
        fabricSourcingDeadlineDays: fabricSource === 'TAILOR_SOURCES' ? fabricSourcingDeadlineDays : null,
        fabricReferenceMedia: uploadedFabricReferenceUrls,
        fabricReferenceMediaCount: fabricReferenceFiles.length,
        fabricReferenceLinks,
        fabricSubstitutionPreference: fabricSource === 'TAILOR_SOURCES' ? fabricSubstitutionPreference || null : null,
        bulkFabricMode: wearerMode === 'GROUP' ? bulkFabricMode || null : null,
        fabricVendorName: fabricSource === 'TAILOR_SOURCES' ? fabricVendorName.trim() || null : null,
        fabricVendorLocation: fabricSource === 'TAILOR_SOURCES' ? fabricVendorLocation.trim() || null : null,
        fabricVendorLink: fabricSource === 'TAILOR_SOURCES' ? normalizedFabricVendorLink : null,
        fabricVendorNotes: fabricSource === 'TAILOR_SOURCES' ? fabricVendorNotes.trim() || null : null,
        supportMeta: payloadSupportMeta,
        deliveryMethod,
        shippingPreference: deliveryMethod === 'SHIPPING' ? shippingPreference : null,
        deliveryInstructions: deliveryInstructions.trim() || null,
        deliveryAddress: needsDeliveryDetails ? deliveryAddress.trim() : null,
        deliveryCity: needsDeliveryDetails ? deliveryCity.trim() : null,
        deliveryRegion: needsDeliveryDetails ? deliveryRegion.trim() : null,
        deliveryPostalCode: needsDeliveryDetails ? deliveryPostalCode.trim() : null,
        deliveryCountryCode: needsDeliveryDetails ? deliveryCountryCode.trim().toUpperCase() : null,
        recipientName: needsDeliveryDetails ? recipientName.trim() : null,
        recipientPhone: needsDeliveryDetails ? normalizedRecipientPhone : null,
        cancellationPolicyAcknowledged: acknowledged,
      }
    }

    setBusy(true)
    try {
      await invokeAccountFunction('custom-order-action', buildPayload('preflight-create-order', []))
      const uploadedReferencePhotos: string[] = []
      for (const photo of referencePhotos) {
        const preparedPhoto = await reencodeImageFile(photo)
        uploadedReferencePhotos.push(await uploadPublicFile('order-photos', `brief/${data.userId}`, preparedPhoto))
      }
      const uploadedFabricReferenceUrls: string[] = []
      for (const file of fabricReferenceFiles) {
        const preparedFabricMedia = await prepareOrderEvidenceFile(file)
        uploadedFabricReferenceUrls.push(await uploadPublicFile('order-photos', 'brief/' + data.userId + '/fabric', preparedFabricMedia))
      }
      const result = await invokeAccountFunction<{ orderId?: string }>('custom-order-action', buildPayload('create-order', uploadedReferencePhotos, uploadedFabricReferenceUrls))
      setCreatedOrderId(result.orderId ?? null)
      setSuccess('Custom brief sent. Opening the new order so you can track the quote.')
      setDescription('')
      setStyleLinks('')
      setStyleNotes('')
      setFitNote('')
      setOccasionOther('')
      setWearerName('')
      setBulkRecipientCount('')
      setBulkLabel('')
      setBulkMemberNames('')
      setBulkNotes('')
      setDeliveryInstructions('')
      setReferencePhotos([])
      setFabricReferenceFiles([])
      setFabricReferenceLinksInput('')
      setFabricSubstitutionPreference('')
      setBulkFabricMode('')
      setFabricVendorName('')
      setFabricVendorLocation('')
      setFabricVendorLink('')
      setFabricVendorNotes('')
      if (photoInputRef.current) photoInputRef.current.value = ''
      if (fabricMediaInputRef.current) fabricMediaInputRef.current.value = ''
      onRefresh()
      if (result.orderId) {
        router.push(accountRoute(`/account/orders/${result.orderId}`))
      }
    } catch (briefError) {
      setError(friendlyActionError(briefError, 'Custom brief could not be submitted. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const deliveryOptions = [
    selectedTailor.pickup_available ? ['LOCAL_COLLECTION', 'Local collection'] : null,
    selectedTailor.delivery_available ? ['LOCAL_DELIVERY', 'Local delivery'] : null,
    selectedTailor.shipping_available ? ['SHIPPING', 'Shipping'] : null,
  ].filter((entry): entry is [string, string] => !!entry)
  if (deliveryOptions.length === 0) deliveryOptions.push(['LOCAL_COLLECTION', 'Local collection'])

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)] lg:items-start">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start lg:block">
            <PhotoTile src={tailorPhoto(selectedTailor)} label="Tailor profile" />
            <div>
              <h2 className="mt-3 text-2xl font-semibold text-ink sm:mt-0 lg:mt-4">{safeEntityName(selectedTailor.business_name || selectedTailor.display_name, 'Tailor')}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink/62">
                {safeUserText(selectedTailor.location, 'Location pending')} · {safeList(selectedTailor.specialty_tags, 'Custom clothing')}
              </p>
              <p className="mt-3 w-fit rounded-full bg-bone/70 px-3 py-1.5 text-xs font-semibold text-needle">
                Availability: {cleanLabel(selectedTailor.availability, 'Ask before booking')}
              </p>
            </div>
          </div>
        </div>
        <div className="self-start rounded-[8px] border border-needle/12 bg-needle/8 p-4 shadow-sm sm:p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-needle/80">Before quote</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-ink sm:text-2xl">The tailor reviews this before pricing.</h2>
          <p className="mt-2 text-sm leading-6 text-ink/66">
            This sends a pending-quote order. Add saved measurements first so the tailor can price with fit context.
          </p>
        </div>
      </section>

      <section className="rounded-[8px] border border-ink/8 bg-white/84 p-4 shadow-sm sm:p-5">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          {createdOrderId ? (
            <Link href={accountRoute(`/account/orders/${createdOrderId}`)} className="inline-flex w-fit rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">
              Open submitted order
            </Link>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment</span>
              <select value={garmentType} onChange={(event) => setGarmentType(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {WEB_GARMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit category</span>
              <select value={genderPresentation} onChange={(event) => setGenderPresentation(event.target.value as typeof genderPresentation)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="Unisex">Unisex</option>
                <option value="Menswear">Menswear</option>
                <option value="Womenswear">Womenswear</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Target date</span>
              <input type="date" value={deadline} min={minimumDeadlineInput()} onChange={(event) => setDeadline(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>
          {garmentType === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment type details</span>
              <input value={garmentTypeOther} onChange={(event) => setGarmentTypeOther(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/35 p-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Wearer</span>
              <select value={wearerMode} onChange={(event) => setWearerMode(event.target.value as typeof wearerMode)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="SELF">Me</option>
                <option value="OTHER">Someone else</option>
                <option value="GROUP">Group order</option>
              </select>
            </label>
            {wearerMode === 'OTHER' ? (
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Wearer name</span>
                <input value={wearerName} onChange={(event) => setWearerName(event.target.value)} placeholder="Name used for this measurement profile" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            ) : null}
            {wearerMode === 'GROUP' ? (
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Group name</span>
                  <input value={bulkLabel} onChange={(event) => setBulkLabel(event.target.value)} placeholder="Wedding party, choir..." className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Wearers</span>
                  <input value={bulkRecipientCount} onChange={(event) => setBulkRecipientCount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="2+" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2 md:col-span-3">
                  <span className="text-sm font-semibold text-ink">Members and notes</span>
                  <textarea value={`${bulkMemberNames}${bulkNotes ? `\n\n${bulkNotes}` : ''}`} onChange={(event) => {
                    const [members = '', ...notes] = event.target.value.split(/\n\n/u)
                    setBulkMemberNames(members)
                    setBulkNotes(notes.join('\n\n'))
                  }} rows={3} placeholder="Names separated by commas or lines, then optional notes." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
              </>
            ) : null}
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Brief</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={1200} placeholder="Describe the outfit, silhouette, occasion, fabric expectations, and anything the tailor must know." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion</span>
              <select value={occasion} onChange={(event) => setOccasion(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {WEB_OCCASION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Reference photos</span>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  if (files.length > CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) {
                    setReferencePhotos(files.slice(0, CUSTOM_ORDER_MAX_REFERENCE_PHOTOS))
                    setError(`Only the first ${CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} reference photos were selected.`)
                    return
                  }
                  setReferencePhotos(files)
                  setError(null)
                }}
                className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <span className="text-xs leading-5 text-ink/52">{referencePhotos.length}/{CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} photos selected.</span>
            </label>
          </div>
          {occasion === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion details</span>
              <input value={occasionOther} onChange={(event) => setOccasionOther(event.target.value)} placeholder="Naming ceremony, corporate gala, festival..." className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style links</span>
            <input value={styleLinks} onChange={(event) => setStyleLinks(event.target.value)} placeholder="Instagram, Pinterest, or TikTok links" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            <span className="text-xs leading-5 text-ink/52">
              Add up to {CUSTOM_ORDER_MAX_STYLE_LINKS} supported links. Extra links must be removed before submitting.
            </span>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style notes</span>
            <textarea value={styleNotes} onChange={(event) => setStyleNotes(event.target.value)} rows={3} maxLength={1200} className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Measurements</span>
              <select value={measurementChoice} onChange={(event) => setMeasurementChoice(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {data.measurementProfiles.map((profile) => <option key={profile.id} value={profile.id}>{safeUserText(profile.label, 'Saved profile')}</option>)}
                {data.customerProfile?.measurements ? <option value="legacy">Customer profile</option> : null}
                <option value="fallback" disabled>No measurements yet</option>
              </select>
              {(() => {
                const profile = data.measurementProfiles.find((p) => p.id === measurementChoice)
                const age = profile ? measurementAgeFromSnapshot({ measurementProfileUpdatedAt: profile.last_measured_at ?? profile.updated_at }) : null
                if (!age?.stale) return null
                return (
                  <span className="text-xs leading-5 text-amber-700">
                    These measurements are {age.ageMonths} months old. Update them in Profile if your fit or body shape changed before submitting this brief.
                  </span>
                )
              })()}
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit note <span className="font-normal text-ink/52">(min 20 chars)</span></span>
              <textarea value={fitNote} onChange={(event) => setFitNote(event.target.value)} rows={3} maxLength={500} placeholder="e.g. I prefer extra room in the shoulders, shorter torso, or trousers sitting high on the waist." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <span className="text-xs leading-5 text-ink/52">
                No contact details. Describe fit, coverage, posture, or comfort preferences.
              </span>
            </label>
          </div>

          <section className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/35 p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric</span>
                <select value={fabricSource} onChange={(event) => setFabricSource(event.target.value as typeof fabricSource)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="TAILOR_SOURCES">Tailor sources fabric</option>
                  <option value="CUSTOMER_SUPPLIES">Customer supplies fabric</option>
                </select>
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Fabric details</span>
                <input value={fabricDescription} onChange={(event) => setFabricDescription(event.target.value)} placeholder={fabricSource === 'TAILOR_SOURCES' ? 'Fabric type, color, weight, and what the tailor should source' : 'Fabric type, color, yardage, and how it will be handed off'} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric photos or videos</span>
                <input
                  ref={fabricMediaInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/quicktime"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    if (files.length > MAX_WEB_FABRIC_REFERENCE_MEDIA) {
                      setFabricReferenceFiles(files.slice(0, MAX_WEB_FABRIC_REFERENCE_MEDIA))
                      setError('Only the first ' + MAX_WEB_FABRIC_REFERENCE_MEDIA + ' fabric media files were selected.')
                      return
                    }
                    setFabricReferenceFiles(files)
                    setError(null)
                  }}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
                />
                <span className="text-xs leading-5 text-ink/52">
                  {fabricReferenceFiles.length}/{MAX_WEB_FABRIC_REFERENCE_MEDIA} media files selected. Use photos or short MP4/MOV clips.
                </span>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric reference links</span>
                <textarea value={fabricReferenceLinksInput} onChange={(event) => setFabricReferenceLinksInput(event.target.value)} rows={3} placeholder="Instagram, Pinterest, or TikTok links for fabric references" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                <span className="text-xs leading-5 text-ink/52">
                  Add links only for fabric references. Keep vendor contact details out of the brief.
                </span>
              </label>
            </div>

            {wearerMode === 'GROUP' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Group fabric plan</span>
                <select value={bulkFabricMode} onChange={(event) => setBulkFabricMode(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="">Choose fabric plan</option>
                  {BULK_FABRIC_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="text-xs leading-5 text-ink/52">
                  Bulk orders need a clear sourcing plan so the tailor can protect dye lot, matching, and recipient differences.
                </span>
              </label>
            ) : null}

            {fabricSource === 'TAILOR_SOURCES' ? (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Fabric budget</span>
                    <input value={fabricBudget} onChange={(event) => setFabricBudget(event.target.value)} inputMode="decimal" placeholder="Required budget" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Budget currency</span>
                    <select value={fabricBudgetCurrency} onChange={(event) => setFabricBudgetCurrency(normalizeAccountCurrency(event.target.value) ?? fabricBudgetCurrency)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                      {SUPPORTED_ACCOUNT_CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Sourcing update</span>
                    <select value={fabricSourcingDeadlineDays} onChange={(event) => setFabricSourcingDeadlineDays(Number.parseInt(event.target.value, 10))} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                      {[3, CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS, 7, 10].map((days) => (
                        <option key={days} value={days}>{days} business days</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">If the exact fabric is unavailable</span>
                  <select value={fabricSubstitutionPreference} onChange={(event) => setFabricSubstitutionPreference(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                    <option value="">Choose substitution rule</option>
                    {FABRIC_SUBSTITUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="text-xs leading-5 text-ink/52">
                    {selectedFabricSubstitution?.hint ?? 'This tells the tailor whether to ask before using a close alternative.'}
                  </span>
                </label>
                <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-white/70 p-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Suggested vendor</span>
                    <input value={fabricVendorName} onChange={(event) => setFabricVendorName(event.target.value)} placeholder="Optional vendor or shop name" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Vendor location</span>
                    <input value={fabricVendorLocation} onChange={(event) => setFabricVendorLocation(event.target.value)} placeholder="Market, city, or area" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-sm font-semibold text-ink">Vendor website or social link</span>
                    <input value={fabricVendorLink} onChange={(event) => setFabricVendorLink(event.target.value)} placeholder="Optional link only, no phone or direct payment details" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-sm font-semibold text-ink">Vendor notes</span>
                    <textarea value={fabricVendorNotes} onChange={(event) => setFabricVendorNotes(event.target.value)} rows={3} maxLength={500} placeholder="Optional sourcing context, no contact details." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                </div>
              </>
            ) : (
              <p className="rounded-[8px] border border-needle/10 bg-white/70 px-4 py-3 text-sm leading-6 text-ink/66">
                Add at least one clear fabric photo or video. The tailor will confirm fabric suitability and handoff inside the order before quoting or cutting.
              </p>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fulfillment</span>
              <select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value as typeof deliveryMethod)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {deliveryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {deliveryMethod === 'SHIPPING' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Shipping speed</span>
                <select value={shippingPreference} onChange={(event) => setShippingPreference(event.target.value as typeof shippingPreference)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="STANDARD">Standard</option>
                  <option value="EXPRESS">Express</option>
                </select>
              </label>
            ) : null}
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-semibold text-ink">Instructions</span>
              <input value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Gate, handoff, or shipping notes without contact details" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>

          {needsDeliveryDetails ? (
            <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/45 p-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Recipient name</span>
                <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Recipient phone</span>
                <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-ink">Street address</span>
                <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">City</span>
                <input value={deliveryCity} onChange={(event) => setDeliveryCity(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">State / region</span>
                <input value={deliveryRegion} onChange={(event) => setDeliveryRegion(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Postal code</span>
                <input value={deliveryPostalCode} onChange={(event) => setDeliveryPostalCode(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Country code <span className="font-normal text-ink/52">(2 letters, e.g. US, GB, NG)</span></span>
                <input value={deliveryCountryCode} onChange={(event) => setDeliveryCountryCode(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded-[8px] border border-ink/8 bg-bone/55 p-4 text-sm leading-6 text-ink/66">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            <span>
              This sends a brief for quote review, not an automatic charge. Pricing, payment, cancellation, and handoff terms stay inside Drapeon once the tailor responds.
            </span>
          </label>
          <button type="button" onClick={submitBrief} disabled={busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Submitting brief...' : 'Submit custom brief'}
          </button>
        </div>
      </section>
    </div>
  )
}

function OrderCard({ order, data }: { order: AccountOrder; data: OrdersRenderData }) {
  const payment = latestPayment(order.id, data.payments)
  const message = latestMessage(order.id, data.messages)
  const action = orderActionCopy(order, data)
  const progress = stageProgress(order)
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_14px_40px_rgba(22,28,24,0.10)]"
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/68">{cleanLabel(order.order_kind, 'Order')}</span>
              <StagePill stage={order.stage} />
              {action ? (
                <span className="rounded-full bg-rust/10 px-2.5 py-0.5 text-xs font-semibold text-rust">{action}</span>
              ) : null}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
            <p className="mt-1 text-sm text-ink/52">
              {partyName(order, data.userId)} · {cleanLabel(order.delivery_method, 'Fulfillment')}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xl font-semibold text-ink">{orderAmount(order)}</p>
            <div className="mt-1 flex justify-end"><StatusChip status={payment?.status} fallback="Payment pending" /></div>
            <p className="mt-0.5 text-xs text-ink/36">{formatRelative(order.updated_at ?? order.created_at)}</p>
          </div>
        </div>
        {message ? (
          <p className="mt-3 line-clamp-1 rounded-lg bg-ink/4 px-3 py-2 text-sm text-ink/52">
            {safeUserText(message.body, message.photo_url || message.voice_url ? 'Media attached.' : 'Message recorded.')}
          </p>
        ) : null}
      </div>
      <div className="h-1 bg-ink/6">
        <div className="h-full rounded-r-full bg-needle" style={{ width: `${progress}%` }} />
      </div>
    </Link>
  )
}

type ReviewMediaDraft = {
  id: string
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

function OrderReviewPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'reviews' | 'userId' | 'customerProfile' | 'tailorProfile'>
  onRefresh: () => void
}) {
  const existingReview = data.reviews.find((review) => review.order_id === order.id)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('Fit matched, Clear communication')
  const [reviewMediaDrafts, setReviewMediaDrafts] = useState<ReviewMediaDraft[]>([])
  const reviewMediaDraftsRef = useRef<ReviewMediaDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const readyForReview = isCustomerOrder(order, data) && ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')

  useEffect(() => {
    reviewMediaDraftsRef.current = reviewMediaDrafts
  }, [reviewMediaDrafts])

  useEffect(() => () => {
    for (const draft of reviewMediaDraftsRef.current) URL.revokeObjectURL(draft.previewUrl)
  }, [])

  if (!readyForReview) return null

  if (existingReview) {
    return (
      <section className="rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Review submitted</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Thanks for rating this order.</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          Your review helps future customers understand the tailor’s fit, communication, and delivery reliability.
        </p>
      </section>
    )
  }

  async function handleReviewMediaFiles(event: ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length === 0) return

    const remainingSlots = MAX_REVIEW_MEDIA - reviewMediaDraftsRef.current.length
    if (remainingSlots <= 0) {
      setError('You can add up to ' + MAX_REVIEW_MEDIA + ' photos or videos to a review.')
      return
    }

    const accepted: ReviewMediaDraft[] = []
    const rejected: string[] = []
    for (const file of files.slice(0, remainingSlots)) {
      try {
        const prepared = await prepareReviewMediaFile(file)
        const normalizedType = prepared.type.split(';')[0]?.trim().toLowerCase()
        accepted.push({
          id: [prepared.name, prepared.size, Date.now(), accepted.length].join(':'),
          file: prepared,
          previewUrl: URL.createObjectURL(prepared),
          type: isVideoContentType(normalizedType) ? 'video' : 'image',
        })
      } catch (mediaError) {
        rejected.push(mediaError instanceof Error ? mediaError.message : 'That media file could not be prepared.')
      }
    }

    if (accepted.length > 0) {
      setReviewMediaDrafts((current) => [...current, ...accepted].slice(0, MAX_REVIEW_MEDIA))
    }
    if (rejected.length > 0) {
      setError(Array.from(new Set(rejected)).join(' '))
    }
  }

  function removeReviewMediaDraft(id: string) {
    setReviewMediaDrafts((current) => {
      const removed = current.find((draft) => draft.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((draft) => draft.id !== id)
    })
  }

  async function submitReview() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak([body, tags].join('\n'), "Reviews can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    const reviewerName =
      data.customerProfile?.display_name ||
      data.tailorProfile?.display_name ||
      'Drapeon customer'
    setBusy(true)
    try {
      if (reviewMediaDraftsRef.current.length > 0 && !data.userId) {
        throw new Error('Sign in again before attaching review media.')
      }
      const mediaUrls: string[] = []
      for (const draft of reviewMediaDraftsRef.current) {
        mediaUrls.push(await uploadPublicFile('review-media', 'reviews/' + order.id + '/' + data.userId, draft.file))
      }
      await invokeAccountFunction('review-action', {
        action: 'submit-tailor-review',
        orderId: order.id,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags: splitList(tags),
        mediaUrls,
      })
      setSuccess('Review submitted. It may be held briefly if moderation needs to check the text.')
      setBody('')
      setReviewMediaDrafts((current) => {
        for (const draft of current) URL.revokeObjectURL(draft.previewUrl)
        return []
      })
      onRefresh()
    } catch (reviewError) {
      setError(friendlyActionError(reviewError, 'Review could not be submitted.'))
    } finally {
      setBusy(false)
    }
  }

  const ratingLabels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent']
  return (
    <section className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
      <div className="bg-needle/6 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Leave a review</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">Rate this tailor</h2>
        <p className="mt-1.5 text-sm leading-6 text-ink/62">
          Your review helps future customers understand fit quality, communication, and delivery.
        </p>
      </div>
      <div className="p-6">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          <div>
            <p className="text-sm font-semibold text-ink">Rating</p>
            <div className="mt-2 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`p-0.5 text-3xl leading-none transition ${star <= rating ? 'text-amber-400' : 'text-ink/16 hover:text-amber-200'}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-sm font-semibold text-ink/52">{ratingLabels[rating]}</span>
            </div>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Tags <span className="font-normal text-ink/40">(comma-separated)</span></span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Fit matched, Clear communication" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Review <span className="font-normal text-ink/40">(optional)</span></span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={1000} placeholder="Share your experience..." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-bone/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Photos or video</p>
                <p className="mt-0.5 text-xs text-ink/48">Add up to {MAX_REVIEW_MEDIA}. Videos must be 30 seconds or less.</p>
              </div>
              <label className={`inline-flex cursor-pointer items-center rounded-full border border-needle/20 px-4 py-2 text-sm font-semibold text-needle transition hover:bg-needle/8 ${reviewMediaDrafts.length >= MAX_REVIEW_MEDIA || busy ? 'pointer-events-none opacity-45' : ''}`}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  multiple
                  className="sr-only"
                  disabled={reviewMediaDrafts.length >= MAX_REVIEW_MEDIA || busy}
                  onChange={(event) => { void handleReviewMediaFiles(event) }}
                />
                {reviewMediaDrafts.length > 0 ? 'Add more' : 'Add media'}
              </label>
            </div>
            {reviewMediaDrafts.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {reviewMediaDrafts.map((draft) => (
                  <div key={draft.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[8px] bg-ink/8">
                    {draft.type === 'video' ? (
                      <MutedVideo src={draft.previewUrl} className="h-full w-full object-cover" autoPlay={false} loop={false} showMuteToggle={false} />
                    ) : (
                      <img src={draft.previewUrl} alt="Review attachment preview" className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeReviewMediaDraft(draft.id)}
                      className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-ink shadow-sm"
                      aria-label="Remove review media"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={submitReview} disabled={busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Submitting...' : 'Submit review'}
          </button>
        </div>
      </div>
    </section>
  )
}

function RenderOrders({ data }: { data: OrdersRenderData }) {
  const [filter, setFilter] = useState<'active' | 'action' | 'completed' | 'all'>('active')
  const [search, setSearch] = useState('')
  const orderRows = data.orders.filter((order) => showOrderInOrdersSurface(order, data))
  const activeOrders = orderRows.filter((order) => !isTerminalOrder(order))
  const pastOrders = orderRows.filter(isTerminalOrder)
  const actionOrders = orderRows.filter((order) => orderActionCopy(order, data))
  const byFilter =
    filter === 'active'
      ? activeOrders
      : filter === 'action'
        ? actionOrders
        : filter === 'completed'
          ? pastOrders
          : orderRows
  const visibleOrders = search.trim()
    ? byFilter.filter((order) => {
        const hay = [orderTitle(order), partyName(order, data.userId), cleanLabel(order.stage), cleanLabel(order.order_kind)].join(' ').toLowerCase()
        return hay.includes(search.trim().toLowerCase())
      })
    : byFilter
  const tabs: Array<[typeof filter, string, number]> = [
    ['active', 'Active', activeOrders.length],
    ['action', 'Needs action', actionOrders.length],
    ['completed', 'Completed', pastOrders.length],
    ['all', 'All', orderRows.length],
  ]
  const columns = useMemo<ColumnDef<AccountOrder>[]>(() => [
    {
      id: 'order',
      accessorFn: (order) => orderTitle(order),
      header: 'Order',
      cell: ({ row }) => (
        <div className="min-w-52">
          <Link href={`/account/orders/${row.original.id}`} className="font-semibold text-ink hover:text-needle hover:underline">
            {orderTitle(row.original)}
          </Link>
          <p className="mt-1 text-xs text-ui-subtle">{partyName(row.original, data.userId)}</p>
        </div>
      ),
    },
    {
      id: 'stage',
      accessorFn: (order) => order.stage ?? '',
      header: 'Status',
      cell: ({ row }) => <StagePill stage={row.original.stage} />,
    },
    {
      id: 'fulfillment',
      accessorFn: (order) => cleanLabel(order.delivery_method, 'Fulfillment'),
      header: 'Fulfillment',
      cell: ({ row }) => <span className="text-ui-subtle">{cleanLabel(row.original.delivery_method, 'Fulfillment')}</span>,
    },
    {
      id: 'payment',
      accessorFn: (order) => latestPayment(order.id, data.payments)?.status ?? '',
      header: 'Payment',
      cell: ({ row }) => <StatusChip status={latestPayment(row.original.id, data.payments)?.status} fallback="Payment pending" />,
    },
    {
      id: 'amount',
      accessorFn: (order) => order.quoted_amount ?? order.total_amount ?? 0,
      header: 'Amount',
      cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{orderAmount(row.original)}</span>,
    },
    {
      id: 'updated',
      accessorFn: (order) => timestampMs(order.updated_at ?? order.created_at),
      header: 'Updated',
      cell: ({ row }) => <span className="whitespace-nowrap text-ui-subtle">{formatRelative(row.original.updated_at ?? row.original.created_at)}</span>,
    },
    {
      id: 'action',
      enableSorting: false,
      header: '',
      cell: ({ row }) => {
        const action = orderActionCopy(row.original, data)
        return action ? <Badge tone="warning">{action}</Badge> : null
      },
    },
  ], [data])
  return (
    <div className="grid gap-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Active', activeOrders.length],
          ['Needs action', actionOrders.length],
          ['Completed', pastOrders.length],
        ].map(([label, count]) => (
          <div key={String(label)} className="rounded-[8px] border border-ui-border bg-white px-4 py-3">
            <p className="text-2xl font-semibold text-ink">{String(count)}</p>
            <p className="text-xs text-ink/52">{String(label)}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search orders by title, party, or status"
        className="h-11"
      />

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto rounded-[8px] border border-ui-border bg-white p-1.5 [scrollbar-width:none]">
        {tabs.map(([key, label, count]) => (
          <Button
            key={key}
            onClick={() => setFilter(key)}
            variant={filter === key ? 'primary' : 'ghost'}
            size="sm"
            className="whitespace-nowrap"
          >
            {label}
            {count > 0 ? <span className={`ml-1.5 ${filter === key ? 'opacity-70' : 'text-ink/40'}`}>{count}</span> : null}
          </Button>
        ))}
      </div>

      {/* Order list */}
      <div className="grid gap-3 md:hidden">
        {visibleOrders.length === 0 ? (
          <EmptyState
            title={search.trim() ? 'No orders match that search.' : filter === 'action' ? 'No orders need action.' : filter === 'completed' ? 'No completed orders yet.' : 'No orders here.'}
            body="Custom and ready-made orders appear here after they are created in the app or on web."
            action={data.tailorProfile
              ? <Link href="/account/work" className="font-semibold text-needle">Back to dashboard</Link>
              : <Link href="/account/explore" className="font-semibold text-needle">Browse tailors</Link>
            }
          />
        ) : (
          visibleOrders.map((order) => <OrderCard key={order.id} order={order} data={data} />)
        )}
      </div>
      {visibleOrders.length > 0 ? (
        <div className="hidden md:block">
          <DataTable columns={columns} data={visibleOrders} emptyMessage="No orders match this view." />
        </div>
      ) : null}
    </div>
  )
}

function RenderOrderDetail({ data, onRefresh }: { data: OrderDetailRenderData; onRefresh: () => void }) {
  const order = data.order
  if (!order) {
    return (
      <EmptyState
        title="Order not found."
        body="This order may belong to another account, or it may not have loaded yet. Refresh, then check the app if the issue persists."
        action={<Link href="/account/orders" className="font-semibold text-needle">Back to orders</Link>}
      />
    )
  }
  const updates = stageUpdatesFor(order.id, data.stageUpdates).sort((a, b) => {
    return timestampMs(a.created_at) - timestampMs(b.created_at)
  })
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const messages = data.messages.filter((message) => message.order_id === order.id)
  const supportMeta = parseOrderSupportMeta(order.special_note)
  const proofEvidence = productionEvidenceFor(order.id, data.productionEvidence)
  const proofMediaUrls = Array.from(new Set(
    proofEvidence
      .flatMap((item) => stringList(item.photo_urls))
      .map((src) => safeMediaUrl(src))
      .filter((src): src is string => !!src),
  ))
  const customDetail = data.customOrderDetail
    ? {
        garmentTypeOther: data.customOrderDetail.garment_type_other ?? null,
        genderPresentation: data.customOrderDetail.gender_presentation ?? null,
        socialReferenceLinks: stringList(data.customOrderDetail.social_reference_links),
        styleNotes: data.customOrderDetail.style_notes ?? null,
        bodyNote: data.customOrderDetail.body_note ?? null,
        fabricDescription: data.customOrderDetail.fabric_description ?? null,
        fabricBudgetAmount: data.customOrderDetail.fabric_budget_amount ?? null,
        fabricBudgetCurrency: data.customOrderDetail.fabric_budget_currency ?? null,
        fabricSourcingDeadlineDays: data.customOrderDetail.fabric_sourcing_deadline_days ?? null,
        fabricSourcingDeadlineAt: data.customOrderDetail.fabric_sourcing_deadline_at ?? null,
        fabricApprovalStatus: data.customOrderDetail.fabric_approval_status ?? null,
        shippingPreference: data.customOrderDetail.shipping_preference ?? null,
        deliveryInstructions: data.customOrderDetail.delivery_instructions ?? null,
        targetDeliveryDate: data.customOrderDetail.target_delivery_date ?? null,
      }
    : null
  const briefDossier = buildBriefDossier(
    {
      orderKind: order.order_kind,
      garmentType: order.garment_type,
      garmentDescription: order.garment_description,
      itemTitle: order.item_title,
      itemSize: order.item_size,
      occasion: order.occasion,
      stage: order.stage,
      quotedAmount: order.quoted_amount,
      quotedCurrency: order.quoted_currency ?? order.currency,
      quotedCompletionDate: order.quoted_completion_date,
      deadline: order.deadline,
      fabricSource: order.fabric_source,
      deliveryMethod: order.delivery_method,
      deliveryAddress: order.delivery_address ?? null,
      recipientName: order.recipient_name ?? null,
      recipientPhone: order.recipient_phone ?? null,
      fabricTracking: order.fabric_tracking,
      trackingNumber: order.tracking_number ?? null,
      carrier: order.carrier ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      fulfillmentReference: order.fulfillment_reference ?? null,
      fulfillmentContactName: order.fulfillment_contact_name ?? null,
      fulfillmentContactPhone: order.fulfillment_contact_phone ?? null,
      collectionCode: order.collection_code,
      referencePhotos: stringList(order.reference_photos),
      proofMediaUrls,
      messageCount: messages.length,
      supportMeta: supportMeta as Record<string, unknown>,
      customDetail,
      measurementSnapshot: order.customer_measurements_snapshot ?? null,
    },
    { label: cleanLabel, date: formatDate, money: formatMoney },
  )
  const viewerIsCustomer = isCustomerOrder(order, data)
  const viewerIsTailor = isTailorOrder(order, data)
  const customerCanCheckout = viewerIsCustomer && isPayableOrder(order)
  const paymentConfirmed = payments.some((payment) => ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? ''))
  const paymentFailed = order.stage === 'PAYMENT_FAILED' || payments.some((payment) => ['FAILED', 'PAYMENT_FAILED'].includes(payment.status ?? ''))
  const autoRelease = autoReleaseLabel(order.auto_release_at)
  const collectionCode = readableCode(order.collection_code)
  const shouldShowHandoffState = viewerIsCustomer && isHandoffStage(order.stage)
  const tailorCanQuote = viewerIsTailor && ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
  const tailorCanAdvance = viewerIsTailor && nextStageOptions(order).length > 0
  const nextActionTitle = customerCanCheckout
    ? 'Complete secure checkout.'
    : tailorCanQuote
      ? 'Send the customer a quote.'
      : tailorCanAdvance
        ? 'Update production progress.'
        : paymentConfirmed
          ? 'Review order progress.'
          : 'Review order state.'
  const nextActionBody = customerCanCheckout
    ? 'This order is ready for customer payment. Web checkout reuses any existing provider attempt so a refresh or double tap does not create a duplicate charge.'
    : viewerIsTailor
      ? 'Quotes, production stages, proof media, messages, and support context stay attached to this order.'
      : 'Payment, messages, consultation requests, stage updates, and proof media stay attached to this order. Drapeon Vision capture is available in the app when body scanning is needed.'
  const nextActionPrimary = customerCanCheckout ? (
      <Link href={`/account/checkout/${order.id}`} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">
        Pay now
      </Link>
  ) : viewerIsTailor && (tailorCanQuote || tailorCanAdvance) ? (
    <a href="#tailor-actions" className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">
      Work this order
    </a>
  ) : (
    <OpenAppButton label="Open order in app" />
  )
  const nextActionSecondary = customerCanCheckout ? (
    <OpenAppButton label="Open order in app" className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink" />
  ) : (
    <Link href="/account/support" className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink">
      Open support
    </Link>
  )

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{cleanLabel(order.order_kind, 'Order')}</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">{orderTitle(order)}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {safeUserText(order.garment_description || order.special_note, 'The app brief carries full order details and proof media.')}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine label="Status" value={<StagePill stage={order.stage} />} />
            <SummaryLine label="Amount" value={orderAmount(order)} />
            <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
            <SummaryLine label="Due date" value={formatDate(order.quoted_completion_date ?? order.deadline) ?? 'Pending'} />
          </div>
          <div className="mt-5">
            <StageTimeline order={order} />
          </div>
        </div>
        <div className="rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Next best action</p>
          <h3 className="mt-3 text-2xl font-semibold text-ink">{nextActionTitle}</h3>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {nextActionBody}
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {nextActionPrimary}
            {nextActionSecondary}
          </div>
        </div>
      </section>

      <OrderReviewPanel order={order} data={data} onRefresh={onRefresh} />
      <CustomerOrderActions order={order} data={data} onRefresh={onRefresh} />

      {(paymentFailed || shouldShowHandoffState || autoRelease) ? (
        <section className="grid gap-4 rounded-[8px] border border-rust/14 bg-white/86 p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Order safeguards</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Important order state.</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {paymentFailed ? (
              <div className="rounded-[8px] border border-rust/18 bg-rust/8 p-4">
                <h3 className="font-semibold text-ink">Payment needs attention</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  The latest payment attempt did not complete. Retry checkout before production continues.
                </p>
                <Link href={accountRoute(`/account/checkout/${order.id}`)} className="mt-4 inline-flex rounded-lg bg-rust px-4 py-2.5 text-sm font-semibold text-white">
                  Retry payment
                </Link>
              </div>
            ) : null}
            {shouldShowHandoffState ? (
              <div className="rounded-[8px] border border-needle/14 bg-needle/8 p-4">
                <h3 className="font-semibold text-ink">Handoff and pickup</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  {order.delivery_method === 'LOCAL_COLLECTION'
                    ? collectionCode
                      ? 'Bring this code to pickup and inspect the garment before handoff is closed.'
                      : 'Your pickup code appears here once the tailor marks the order ready for collection.'
                    : 'Track delivery here and raise a concern before auto-release if something is wrong.'}
                </p>
                {collectionCode ? (
                  <p className="mt-4 rounded-[8px] bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.2em] text-needle">
                    {collectionCode}
                  </p>
                ) : null}
                {order.collection_code_expiry ? (
                  <p className="mt-2 text-xs text-ink/50">Code expires {autoReleaseLabel(order.collection_code_expiry)}.</p>
                ) : null}
              </div>
            ) : null}
            {autoRelease ? (
              <div className="rounded-[8px] border border-ink/8 bg-bone/60 p-4">
                <h3 className="font-semibold text-ink">Auto-release timing</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Unless a concern is raised, this order can auto-confirm {autoRelease}.
                </p>
                <Link href={accountRoute(`/account/support?orderId=${order.id}`)} className="mt-4 inline-flex rounded-lg border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                  Raise a concern
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {order.customer_id === data.userId && isPayableOrder(order) ? (
        <section className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-ink">Checkout</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Start the real provider checkout from web. If this is an extra delivery or shipping fee, Drapeon uses the existing fulfillment payment request.
          </p>
          <div className="mt-5">
            <CheckoutAction order={order} onRefresh={onRefresh} />
          </div>
        </section>
      ) : null}

      <TailorOrderActions order={order} data={data} onRefresh={onRefresh} />
      <MaterialAdvancePanel order={order} data={data} onRefresh={onRefresh} />

      <Surface className="p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Order brief</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">{briefDossier.title}</h2>
          </div>
          <p className="text-sm font-semibold text-ink/48">{briefDossier.sections.length} sections</p>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {briefDossier.sections.map((section) => <BriefDossierSectionCard key={section.id} section={section} />)}
        </div>
      </Surface>

      <section className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-ink">Timeline</h2>
        <div className="mt-5 grid gap-3">
          {updates.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No production updates yet. Stage photos and videos appear here after the tailor posts them from web or the app.
            </p>
          ) : (
            updates.map((update) => (
              <div key={update.id} className="rounded-[8px] border border-ink/6 bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 rounded-full bg-needle" />
                  <div>
                    <StatusChip status={update.stage} fallback="Stage update" />
                    <p className="mt-1 text-sm leading-6 text-ink/62">{safeUserText(update.note, 'Stage updated.')}</p>
                    <p className="mt-2 text-xs text-ink/46">{formatRelative(update.created_at)}</p>
                  </div>
                </div>
                {update.photo_url ? <div className="mt-3 max-w-64"><PhotoTile src={update.photo_url} label="Stage media" /></div> : null}
              </div>
            ))
          )}
        </div>
        {proofMediaUrls.length > 0 ? (
          <div className="mt-5 border-t border-ink/6 pt-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-ink">Proof media</h3>
              <p className="text-xs font-semibold text-ink/48">{proofMediaUrls.length} item{proofMediaUrls.length === 1 ? '' : 's'}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {proofMediaUrls.slice(0, 6).map((src, index) => (
                <PhotoTile key={src + '-' + index} src={src} label={'Production proof ' + (index + 1)} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-ink">Payments</h2>
          <div className="mt-5 grid gap-3">
            {payments.length === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No payment record loaded for this order yet.</p>
            ) : (
              payments.map((payment) => (
                <SummaryLine
                  key={payment.id}
                  label={cleanLabel(payment.phase, 'Payment')}
                  value={<span className="flex flex-wrap items-center gap-2">{formatMoney(payment.amount, payment.currency)} <StatusChip status={payment.status} fallback="Pending" /></span>}
                />
              ))
            )}
          </div>
        </div>
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-ink">Messages</h2>
          <div className="mt-5 grid gap-3">
            {messages.length === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">No messages on this order yet.</p>
            ) : (
              messages.slice(0, 4).map((message) => (
                <div key={message.id} className="rounded-[8px] border border-ink/6 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {message.sender_id === data.userId ? 'You' : 'Other party'} · {formatMessageRelative(message.created_at)}
                  </p>
                  <MessageContent message={message} />
                  {message.sender_id === data.userId ? (
                    <p className="mt-3 text-xs font-semibold text-ink/42">
                      {message.read_at ? `✓✓ Read ${formatMessageRelative(message.read_at)}` : '✓ Sent'}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div className="mt-5">
            <MessageComposer order={order} onRefresh={onRefresh} />
          </div>
        </div>
      </section>
    </div>
  )
}

type MessageThreadFilter = 'active' | 'completed' | 'archived'

function currentNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

type AccountRealtimeNotice = {
  key: string
  orderId: string | null
  title: string
  body: string
}

function realtimeRecordValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function fallbackOrderTitle(orderId: string | null, ordersById: Map<string, AccountOrder>) {
  if (!orderId) return 'Drapeon order'
  return ordersById.get(orderId) ? orderTitle(ordersById.get(orderId)!) : 'Drapeon order'
}

function buildAccountRealtimeNotice({
  table,
  event,
  payload,
  ordersById,
  userId,
}: {
  table: string
  event: string
  payload: unknown
  ordersById: Map<string, AccountOrder>
  userId: string
}): AccountRealtimeNotice | null {
  const typedPayload = payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }
  const record = typedPayload.new ?? typedPayload.old ?? null
  if (!record) return null

  const recordId = realtimeRecordValue(record, 'id')
  const orderId = realtimeRecordValue(record, table === 'orders' ? 'id' : 'order_id')
  const orderCopy = fallbackOrderTitle(orderId, ordersById)
  const key = `${table}:${event}:${recordId ?? orderId ?? Date.now().toString()}`

  if (table === 'messages') {
    if (event !== 'INSERT' || realtimeRecordValue(record, 'sender_id') === userId) return null
    return {
      key,
      orderId,
      title: `New message: ${orderCopy}`,
      body: safeUserText(
        realtimeRecordValue(record, 'body'),
        realtimeRecordValue(record, 'photo_url') || realtimeRecordValue(record, 'voice_url')
          ? 'New media message'
          : 'New order message',
      ),
    }
  }

  if (table === 'orders') {
    if (event === 'INSERT') {
      return {
        key,
        orderId,
        title: realtimeRecordValue(record, 'tailor_id') === userId ? 'New order request' : 'Order created',
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    if (event === 'UPDATE') {
      return {
        key,
        orderId,
        title: `Order updated: ${orderCopy}`,
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    return null
  }

  if (table === 'order_stage_updates' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Stage update: ${orderCopy}`,
      body: safeUserText(realtimeRecordValue(record, 'note'), cleanLabel(realtimeRecordValue(record, 'stage'), 'Order stage updated')),
    }
  }

  if (table === 'order_payments' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Payment update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'phase'), 'Payment')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_material_advances' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Material advance update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'title'), 'Material advance')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_production_evidence' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Production update: ${orderCopy}`,
      body: 'New production proof was added to the order.',
    }
  }

  if (table === 'reviews' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Review update: ${orderCopy}`,
      body: 'Review activity changed on this order.',
    }
  }

  if (table === 'custom_order_details' && event === 'UPDATE') {
    return {
      key,
      orderId,
      title: `Brief updated: ${orderCopy}`,
      body: 'Custom order details changed.',
    }
  }

  return null
}

function AccountDesktopAlertsPrompt({
  permission,
  onEnable,
}: {
  permission: NotificationPermission | 'unsupported'
  onEnable: () => void
}) {
  if (permission !== 'default') return null

  return (
    <Surface className="mb-4 flex flex-col gap-3 px-4 py-3 text-sm text-ink/66 sm:flex-row sm:items-center sm:justify-between">
      <span>Enable desktop alerts for order messages, stage changes, and payment updates while web is open.</span>
      <Button onClick={onEnable} size="sm" className="shrink-0">
        <BellRing />
        Enable alerts
      </Button>
    </Surface>
  )
}

function readArchivedMessageOrderIds(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function RenderMessages({ data, onRefresh }: { data: MessagesRenderData; onRefresh: () => void }) {
  const searchParams = useSearchParams()
  const requestedOrderId = searchParams.get('orderId')
  const [realtimeMessages, setRealtimeMessages] = useState<AccountMessage[]>([])
  const [reactionPatchState, setReactionPatchState] = useState<{
    upserts: AccountMessageReaction[]
    deletedIds: Set<string>
  }>({ upserts: [], deletedIds: new Set() })
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [filter, setFilter] = useState<MessageThreadFilter>('active')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => requestedOrderId)
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<AccountMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<AccountMessage | null>(null)
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => currentNotificationPermission())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const [counterpartyIsTyping, setCounterpartyIsTyping] = useState(false)
  const [counterpartyPresence, setCounterpartyPresence] = useState<{ online: boolean; lastSeen: Date | null }>({ online: false, lastSeen: null })
  const notificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const markedReadRef = useRef<Set<string>>(new Set())
  const orderChannelRef = useRef<RealtimeChannel | null>(null)
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const orderIds = useMemo(() => data.orders.map((order) => order.id), [data.orders])
  const ordersById = useMemo(() => new Map(data.orders.map((order) => [order.id, order])), [data.orders])
  const archiveStorageKey = data.userId ? `drapeon:web:archived-message-orders:${data.userId}` : null
  const archivedOrderIds = useMemo(() => {
    void archiveRevision
    return readArchivedMessageOrderIds(archiveStorageKey)
  }, [archiveRevision, archiveStorageKey])
  const liveMessages = useMemo(() => {
    const seen = new Set<string>()
    return [...realtimeMessages, ...data.messages].filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [data.messages, realtimeMessages])
  const liveReactionMessageIds = useMemo(() => new Set(liveMessages.map((message) => message.id)), [liveMessages])
  const liveReactions = useMemo(() => {
    const reactions = new Map<string, AccountMessageReaction>()
    for (const reaction of data.reactions) {
      if (!liveReactionMessageIds.has(reaction.message_id) || reactionPatchState.deletedIds.has(reaction.id)) continue
      reactions.set(reaction.id, reaction)
    }
    for (const reaction of reactionPatchState.upserts) {
      if (!liveReactionMessageIds.has(reaction.message_id) || reactionPatchState.deletedIds.has(reaction.id)) continue
      reactions.set(reaction.id, reaction)
    }
    return [...reactions.values()]
  }, [data.reactions, liveReactionMessageIds, reactionPatchState])
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, AccountMessageReaction[]>()
    for (const reaction of liveReactions) {
      const current = map.get(reaction.message_id) ?? []
      current.push(reaction)
      map.set(reaction.message_id, current)
    }
    return map
  }, [liveReactions])

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission
  }, [notificationPermission])

  useEffect(() => {
    if (orderIds.length === 0) {
      return
    }
    const supabase = createClient()
    const orderIdSet = new Set(orderIds)
    const channel = supabase
      .channel(`account-messages:${data.userId ?? 'anonymous'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const next = payload.new as AccountMessage
        if (!orderIdSet.has(next.order_id)) return
        setRealtimeMessages((current) => current.some((message) => message.id === next.id) ? current : [next, ...current])
        const threadOrder = ordersById.get(next.order_id)
        if (
          typeof window !== 'undefined' &&
          notificationPermissionRef.current === 'granted' &&
          next.sender_id !== data.userId &&
          document.visibilityState !== 'visible'
        ) {
          const notice = new Notification(`New message: ${threadOrder ? orderTitle(threadOrder) : 'Order thread'}`, {
            body: safeUserText(next.body, next.photo_url || next.voice_url ? 'New media message' : 'New order message'),
            icon: '/icon-192.png',
          })
          notice.onclick = () => {
            window.focus()
            setSelectedOrderId(next.order_id)
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (payload) => {
        const next = payload.new as AccountMessageReaction
        if (!orderIdSet.has(next.order_id)) return
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(next.id)
          return {
            deletedIds,
            upserts: [...current.upserts.filter((reaction) => reaction.id !== next.id), next],
          }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (payload) => {
        const old = payload.old as Partial<AccountMessageReaction>
        if (!old.id) return
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.add(old.id!)
          return {
            deletedIds,
            upserts: current.upserts.filter((reaction) => reaction.id !== old.id),
          }
        })
      })
      .subscribe((status) => {
        setRealtimeStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'offline' : 'connecting')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [data.userId, orderIds, ordersById])

  // Per-order channel for presence + typing (torn down when thread changes)
  useEffect(() => {
    if (!selectedOrderId || !data.userId) {
      const resetTimer = window.setTimeout(() => {
        setCounterpartyIsTyping(false)
        setCounterpartyPresence({ online: false, lastSeen: null })
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const supabaseClient = createClient()
    const ch = supabaseClient
      .channel(`messages:${selectedOrderId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { userId: string; isTyping: boolean } }) => {
        if (payload.userId === data.userId) return
        setCounterpartyIsTyping(!!payload.isTyping)
        if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
        if (payload.isTyping) {
          typingClearTimerRef.current = setTimeout(() => setCounterpartyIsTyping(false), 4000)
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ userId: string }>()
        const others = Object.values(state).flat().filter((p) => p.userId !== data.userId)
        const isOnline = others.length > 0
        setCounterpartyPresence((prev) => ({
          online: isOnline,
          lastSeen: isOnline ? null : (prev.online ? new Date() : prev.lastSeen),
        }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ userId: data.userId })
        }
      })

    orderChannelRef.current = ch

    function handleVisibility() {
      if (document.hidden) {
        void ch.untrack()
      } else {
        void ch.track({ userId: data.userId! })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
      void supabaseClient.removeChannel(ch)
      orderChannelRef.current = null
      setCounterpartyIsTyping(false)
      setCounterpartyPresence({ online: false, lastSeen: null })
    }
  }, [selectedOrderId, data.userId])

  function persistArchived(next: Set<string>) {
    if (archiveStorageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify([...next]))
    }
  }

  function setThreadArchived(orderId: string, archived: boolean) {
    const order = ordersById.get(orderId)
    const next = new Set(archivedOrderIds)
    if (archived) next.add(orderId)
    else next.delete(orderId)
    persistArchived(next)
    setArchiveRevision((current) => current + 1)
    setSelectedOrderId(null)
    setFilter(archived ? 'archived' : order && isActiveConversationOrder(order, data.userId) ? 'active' : 'completed')
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const threads = useMemo(() => {
    return data.orders
      .map((order) => {
        const messages = liveMessages
          .filter((message) => message.order_id === order.id)
          .sort((a, b) => timestampMs(b.created_at) - timestampMs(a.created_at))
        const latest = messages[0] ?? null
        const unread = messages.filter((message) => message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)).length
        const archived = archivedOrderIds.has(order.id)
        const completed = !isActiveConversationOrder(order, data.userId)
        return {
          order,
          messages,
          latest,
          unread,
          archived,
          completed,
          searchable: [
            orderTitle(order),
            partyName(order, data.userId),
            cleanLabel(order.stage, 'Order'),
            safeUserText(latest?.body, ''),
          ].join(' ').toLowerCase(),
        }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        const aTime = timestampMs(a.latest?.created_at ?? a.order.updated_at ?? a.order.created_at)
        const bTime = timestampMs(b.latest?.created_at ?? b.order.updated_at ?? b.order.created_at)
        return bTime - aTime
      })
  }, [archivedOrderIds, data.orders, data.userId, liveMessages, localReadIds])
  const normalizedSearch = search.trim().toLowerCase()
  const activeThreads = threads.filter((thread) => !thread.archived && !thread.completed)
  const completedThreads = threads.filter((thread) => !thread.archived && thread.completed)
  const archivedThreads = threads.filter((thread) => thread.archived)
  const baseThreads = filter === 'active' ? activeThreads : filter === 'completed' ? completedThreads : archivedThreads
  const filteredThreads = baseThreads.filter((thread) => !normalizedSearch || thread.searchable.includes(normalizedSearch))

  const groups = (() => {
    const map = new Map<string, { key: string; name: string; avatarSrc: string | null; threads: typeof filteredThreads }>()
    for (const thread of filteredThreads) {
      const key = partyKey(thread.order, data.userId)
      if (!map.has(key)) {
        map.set(key, { key, name: partyName(thread.order, data.userId), avatarSrc: partyAvatar(thread.order, data.userId), threads: [] })
      }
      map.get(key)!.threads.push(thread)
    }
    return [...map.values()].map((group) => {
      const unread = group.threads.reduce((sum, t) => sum + t.unread, 0)
      const latestTime = Math.max(...group.threads.map((t) => timestampMs(t.latest?.created_at ?? t.order.updated_at ?? t.order.created_at)))
      const latestPreview = group.threads.reduce<typeof threads[0]['latest']>((best, t) => {
        if (!best) return t.latest
        if (!t.latest) return best
        return timestampMs(t.latest.created_at) > timestampMs(best.created_at) ? t.latest : best
      }, null)
      return { ...group, unread, latestTime, latestPreview }
    }).sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1
      if (b.unread > 0 && a.unread === 0) return 1
      return b.latestTime - a.latestTime
    })
  })()

  const selectedThread = threads.find((thread) => thread.order.id === selectedOrderId) ?? null
  const selectedMessages = selectedThread
    ? [...selectedThread.messages].sort((a, b) => timestampMs(a.created_at) - timestampMs(b.created_at))
    : []
  const messageVirtualizer = useVirtualizer({
    count: selectedMessages.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: (index) => {
      const message = selectedMessages[index]
      if (message?.voice_url) return 112
      if (message?.photo_url) return 300
      return 86
    },
    getItemKey: (index) => selectedMessages[index]?.id ?? index,
    overscan: 8,
  })

  useEffect(() => {
    if (!selectedOrderId || selectedMessages.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      messageVirtualizer.scrollToIndex(selectedMessages.length - 1, { align: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messageVirtualizer, selectedMessages.length, selectedOrderId])
  const selectedUnreadIds = selectedMessages
    .filter((message) => data.userId && message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id))
    .map((message) => message.id)
  const selectedUnreadKey = selectedUnreadIds.join('|')
  const unreadMessageIds = useMemo(() => {
    if (!data.userId) return []
    return liveMessages
      .filter((message) => message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id))
      .map((message) => message.id)
  }, [data.userId, liveMessages, localReadIds])
  const totalUnread = unreadMessageIds.length

  useEffect(() => {
    if (!data.userId || !selectedUnreadKey) return
    const ids = selectedUnreadKey.split('|').filter((id) => id && !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    const supabase = createClient()
    void supabase
      .from('messages')
      .update({ read_at: now })
      .in('id', ids)
      .then(({ error }) => {
        if (error) {
          ids.forEach((id) => markedReadRef.current.delete(id))
          setLocalReadIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
          })
          return
        }
        onRefresh()
      })
  }, [data.userId, onRefresh, selectedUnreadKey])

  async function markAllRead() {
    if (!data.userId || unreadMessageIds.length === 0 || markingAllRead) return
    const ids = unreadMessageIds.filter((id) => !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setMarkingAllRead(true)
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    try {
      const supabase = createClient()
      const { error } = await supabase.from('messages').update({ read_at: now }).in('id', ids)
      if (error) throw error
      onRefresh()
    } catch (readError) {
      console.warn('[messages] Mark all read failed.', readError)
      ids.forEach((id) => markedReadRef.current.delete(id))
      setLocalReadIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } finally {
      setMarkingAllRead(false)
    }
  }

  async function toggleMessageReaction(message: AccountMessage, emoji: string) {
    if (!data.userId) return
    const existing = liveReactions.find((reaction) => (
      reaction.message_id === message.id &&
      reaction.user_id === data.userId &&
      reaction.emoji === emoji
    ))
    const supabase = createClient()

    if (existing) {
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(existing.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== existing.id),
        }
      })
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        console.warn('[messages] Reaction delete failed.', error.message)
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(existing.id)
          return {
            deletedIds,
            upserts: [...current.upserts.filter((reaction) => reaction.id !== existing.id), existing],
          }
        })
      }
      return
    }

    const tempReaction: AccountMessageReaction = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: data.userId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactionPatchState((current) => ({
      deletedIds: new Set([...current.deletedIds].filter((id) => id !== tempReaction.id)),
      upserts: [...current.upserts, tempReaction],
    }))
    const { data: inserted, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: data.userId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      console.warn('[messages] Reaction insert failed.', error.message)
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(tempReaction.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== tempReaction.id),
        }
      })
      return
    }
    setReactionPatchState((current) => {
      const insertedReaction = inserted as AccountMessageReaction
      const deletedIds = new Set(current.deletedIds)
      deletedIds.add(tempReaction.id)
      deletedIds.delete(insertedReaction.id)
      return {
        deletedIds,
        upserts: [
          ...current.upserts.filter((reaction) => reaction.id !== tempReaction.id && reaction.id !== insertedReaction.id),
          insertedReaction,
        ],
      }
    })
  }

  async function handleUnsend(message: AccountMessage) {
    try {
      await invokeAccountFunction('message-action', { action: 'unsend', messageId: message.id })
    } catch (err) {
      const msg = friendlyActionError(err, 'Could not unsend this message. Please try again.')
      if (/15 minutes/i.test(msg)) {
        alert('Messages can only be unsent within 15 minutes of sending.')
      } else {
        alert(msg)
      }
    }
  }

  function renderMessageBubble(message: AccountMessage) {
    const mine = message.sender_id === data.userId
    const isDeleted = Boolean(message.is_deleted)
    const replyTarget = message.reply_to_id
      ? selectedMessages.find((candidate) => candidate.id === message.reply_to_id) ?? null
      : null
    const isHovered = hoveredMessageId === message.id
    const canUnsend = mine && !isDeleted && (() => {
      const sentAt = parseDateValue(message.created_at)
      return sentAt ? Date.now() - sentAt.getTime() < 15 * 60 * 1000 : false
    })()
    const canEdit = mine && !isDeleted && message.type === 'TEXT'
    const isVoiceMessage = !isDeleted && (message.type === 'VOICE' || Boolean(message.voice_url))
    const hasMedia = Boolean(message.photo_url)

    return (
      <div
        className={`group relative flex w-full px-3 py-1.5 sm:px-5 ${mine ? 'justify-end' : 'justify-start'}`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
      >
        {isHovered && !isDeleted ? (
          <div className={`absolute top-2 z-10 flex items-center gap-1 rounded-[8px] border border-ui-border bg-white p-1 shadow-md ${mine ? 'right-[calc(min(76%,42rem)+1.75rem)]' : 'left-[calc(min(76%,42rem)+1.75rem)]'}`}>
            <IconButton size="icon-sm" variant="ghost" label="Reply" onClick={() => setReplyingTo(message)}>
              <Reply />
            </IconButton>
            {canEdit ? (
              <IconButton size="icon-sm" variant="ghost" label="Edit message" onClick={() => setEditingMessage(message)}>
                <Pencil />
              </IconButton>
            ) : null}
            {canUnsend ? (
              <IconButton size="icon-sm" variant="ghost" label="Unsend message" className="text-rust hover:text-rust" onClick={() => { void handleUnsend(message) }}>
                <Trash2 />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <div
          className={`${isVoiceMessage ? 'w-[22rem] max-w-[84%]' : hasMedia ? 'w-[28rem] max-w-[84%]' : 'w-fit max-w-[76%]'} min-w-0 ${mine ? 'rounded-[8px] rounded-br-[3px] bg-needle px-3.5 py-2.5' : 'rounded-[8px] rounded-bl-[3px] border border-ui-border bg-white px-3.5 py-2.5 shadow-sm'} ${isDeleted ? 'opacity-60' : ''}`}
        >
          {replyTarget ? (
            <div className={`mb-2 rounded-[6px] border-l-2 px-2 py-1.5 ${mine ? 'border-white/35 bg-white/10' : 'border-needle/45 bg-ui-muted'}`}>
              <p className={`text-[0.68rem] font-semibold ${mine ? 'text-white/78' : 'text-ink/62'}`}>
                {replyTarget.sender_name ?? 'Unknown'}
              </p>
              <p className={`line-clamp-2 text-xs leading-4 ${mine ? 'text-white/62' : 'text-ui-subtle'}`}>
                {replyTarget.is_deleted
                  ? 'This message was unsent.'
                  : replyTarget.type === 'PHOTO'
                    ? 'Photo attachment'
                    : replyTarget.type === 'VOICE'
                      ? 'Voice note'
                      : safeUserText(replyTarget.body, '')}
              </p>
            </div>
          ) : null}

          {isDeleted ? (
            <p className={`text-sm italic leading-6 ${mine ? 'text-white/64' : 'text-ui-subtle'}`}>This message was unsent.</p>
          ) : (
            <div className={mine ? '[&_p]:text-white/92 [&_a]:text-white [&_audio]:opacity-90' : ''}>
              <MessageContent message={message} />
            </div>
          )}

          <div className={`mt-1.5 flex items-center justify-end gap-1 text-[0.68rem] ${mine ? 'text-white/58' : 'text-ink/38'}`} title={parseDateValue(message.created_at)?.toISOString()}>
            {message.edited_at && !isDeleted ? <span className="italic">edited</span> : null}
            <span>{formatMessageRelative(message.created_at)}</span>
            {mine ? <CheckCheck className={`size-3.5 ${message.read_at ? 'opacity-100' : 'opacity-55'}`} aria-label={message.read_at ? 'Read' : 'Sent'} /> : null}
          </div>
          {!isDeleted ? (
            <MessageReactionBar
              reactions={reactionsByMessageId.get(message.id) ?? []}
              userId={data.userId}
              mine={mine}
              open={openReactionMessageId === message.id}
              onOpenChange={(open) => setOpenReactionMessageId(open ? message.id : null)}
              onToggle={(emoji) => { void toggleMessageReaction(message, emoji) }}
            />
          ) : null}
        </div>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        title="No conversations yet."
        body="Your order conversations appear here once you start or receive an order."
        action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
      />
    )
  }

  return (
    <section className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm lg:flex lg:h-[calc(100vh-2rem)]">

      {/* ── Sidebar ── */}
      {!sidebarCollapsed ? (
        <aside className="flex w-full shrink-0 flex-col border-b border-ink/8 lg:w-72 lg:border-b-0 lg:border-r">
          {/* Search + filters */}
          <div className="border-b border-ink/8 p-3">
            <label className="sr-only" htmlFor="message-search">Search conversations</label>
            <Input
              id="message-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-ui-canvas"
              placeholder="Search conversations"
            />
            <div className="mt-2 flex gap-1">
              {(['active', 'completed', 'archived'] as const).map((key) => {
                const unreadCounts = {
                  active: activeThreads.reduce((sum, t) => sum + t.unread, 0),
                  completed: completedThreads.reduce((sum, t) => sum + t.unread, 0),
                  archived: archivedThreads.reduce((sum, t) => sum + t.unread, 0),
                }
                const labels = { active: 'Active', completed: 'Done', archived: 'Archived' }
                return (
                  <Button
                    key={key}
                    onClick={() => { setFilter(key); setSelectedOrderId(null) }}
                    variant={filter === key ? 'primary' : 'ghost'}
                    size="sm"
                    className="relative flex-1 text-xs"
                  >
                    {labels[key]}
                    {unreadCounts[key] > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[0.6rem] font-bold text-white">
                        {unreadCounts[key] > 9 ? '9+' : unreadCounts[key]}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </div>
            {notificationPermission === 'default' ? (
              <div className="mt-2">
                <Button variant="link" size="sm" onClick={() => { void requestNotifications() }}><BellRing /> Enable alerts</Button>
              </div>
            ) : null}
          </div>

          {/* Grouped conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="p-4 text-sm text-ink/48">{search ? 'No conversations match.' : 'Nothing here.'}</p>
            ) : groups.map((group) => {
              const isExpanded = expandedGroupKeys.has(group.key) || group.threads.length === 1
              const groupActive = group.threads.some((t) => t.order.id === selectedThread?.order.id)
              return (
                <div key={group.key}>
                  {/* Group header row */}
                  <button
                    type="button"
                    onClick={() => {
                      if (group.threads.length === 1) {
                        setSelectedOrderId(group.threads[0]!.order.id)
                      } else {
                        setExpandedGroupKeys((prev) => {
                          const next = new Set(prev)
                          if (next.has(group.key)) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                        if (!isExpanded) setSelectedOrderId(group.threads[0]!.order.id)
                      }
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${groupActive && group.threads.length === 1 ? 'bg-needle/8' : 'hover:bg-ink/4'}`}
                  >
                    <div className="relative shrink-0">
                      <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-needle/14 text-sm font-semibold text-needle">
                        {group.avatarSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={group.avatarSrc} alt="" className="h-full w-full object-cover" />
                        ) : initialsForName(group.name)}
                      </div>
                      {group.unread > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-0.5 text-[0.6rem] font-bold text-white">
                          {group.unread > 9 ? '9+' : group.unread}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`truncate text-sm ${group.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{group.name}</p>
                        <p className="shrink-0 text-[0.65rem] text-ink/38">{formatMessageRelative(group.latestPreview?.created_at ?? null)}</p>
                      </div>
                      <p className={`mt-0.5 truncate text-xs ${group.unread > 0 ? 'font-semibold text-ink/80' : 'text-ink/44'}`}>
                        {group.threads.length > 1
                          ? `${group.threads.length} orders`
                          : group.latestPreview
                            ? safeUserText(group.latestPreview.body, group.latestPreview.photo_url || group.latestPreview.voice_url ? 'Sent media' : 'No messages yet')
                            : 'No messages yet'}
                      </p>
                    </div>
                    {group.threads.length > 1 ? (
                      isExpanded ? <ChevronUp className="size-4 shrink-0 text-ui-subtle" /> : <ChevronDown className="size-4 shrink-0 text-ui-subtle" />
                    ) : null}
                  </button>

                  {/* Sub-threads (shown when group expanded and has >1 order) */}
                  {isExpanded && group.threads.length > 1 ? group.threads.map((thread) => {
                    const subActive = thread.order.id === selectedThread?.order.id
                    return (
                      <button
                        key={thread.order.id}
                        type="button"
                        onClick={() => setSelectedOrderId(thread.order.id)}
                        className={`flex w-full items-center gap-2 border-l-2 py-2 pl-16 pr-3 text-left transition ${subActive ? 'border-needle bg-needle/6' : 'border-ink/8 hover:bg-ink/4'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs font-semibold ${subActive ? 'text-needle' : 'text-ink/70'}`}>{orderTitle(thread.order)}</p>
                          <StatusChip status={thread.order.stage} fallback="Order" className="mt-1 py-0 text-[0.6rem]" />
                        </div>
                        {thread.unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-rust px-1.5 py-0.5 text-[0.6rem] font-bold text-white">{thread.unread}</span>
                        ) : null}
                      </button>
                    )
                  }) : null}
                </div>
              )
            })}
            {totalUnread > 0 ? (
              <div className="border-t border-ink/6 p-3">
                <Button variant="link" size="sm" onClick={() => { void markAllRead() }} disabled={markingAllRead}>
                  <CheckCheck />
                  {markingAllRead ? 'Marking...' : 'Mark all read'}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ── Chat pane ── */}
      {!selectedThread ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-needle/10 text-needle">
              <MessageSquareText className="size-6" />
            </div>
            <p className="text-sm font-semibold text-ink">Pick a conversation</p>
            <p className="mt-1 text-xs text-ink/44">Select a thread from the list to open it.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-ink/8 bg-white/70 px-3 py-2.5">
            {/* Collapse toggle */}
            <IconButton
              label={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 lg:inline-flex"
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
            {/* Avatar + name */}
            {(() => {
              const name = partyName(selectedThread.order, data.userId)
              const avatarSrc = partyAvatar(selectedThread.order, data.userId)
              return (
                <>
                  <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/14 text-xs font-semibold text-needle">
                    {avatarSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                    ) : initialsForName(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    {counterpartyPresence.online ? (
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-needle" />
                        <p className="text-xs font-semibold text-needle">Active now</p>
                      </div>
                    ) : counterpartyPresence.lastSeen ? (
                      <p className="truncate text-xs text-ink/44">Last viewed {formatMessageRelative(counterpartyPresence.lastSeen.toISOString())}</p>
                    ) : (
                      <p className="truncate text-xs text-ink/44">{orderTitle(selectedThread.order)}</p>
                    )}
                  </div>
                </>
              )
            })()}
            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              {selectedThread.order.video_call_url ? (
                <Button asChild variant="outline" size="sm">
                  <a href={selectedThread.order.video_call_url} target="_blank" rel="noreferrer"><Video /> Join call</a>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setThreadArchived(selectedThread.order.id, !selectedThread.archived)}
                className="text-ui-subtle"
              >
                {selectedThread.archived ? <ArchiveRestore /> : <Archive />}
                <span className="hidden xl:inline">{selectedThread.archived ? 'Unarchive' : 'Archive'}</span>
              </Button>
              <Button asChild size="sm"><Link href={`/account/orders/${selectedThread.order.id}`}><ClipboardList /> Order</Link></Button>
            </div>
          </div>

          {/* Messages area */}
          <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto bg-ui-canvas/70 py-3">
            {selectedMessages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="rounded-[8px] border border-ui-border bg-white px-5 py-4 text-sm leading-6 text-ui-subtle">No messages yet.</p>
              </div>
            ) : (
              <div className="relative w-full" style={{ height: messageVirtualizer.getTotalSize() }}>
                {messageVirtualizer.getVirtualItems().map((virtualRow) => {
                  const message = selectedMessages[virtualRow.index]
                  if (!message) return null
                  return (
                    <div
                      key={message.id}
                      ref={messageVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {renderMessageBubble(message)}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Typing indicator */}
          {counterpartyIsTyping ? (
            <div className="border-t border-ink/8 px-4 py-1.5">
              <p className="text-xs italic text-ink/44">{partyName(selectedThread.order, data.userId)} is typing…</p>
            </div>
          ) : null}

          {/* Reply preview bar */}
          {replyingTo ? (
            <div className="flex items-center gap-2 border-t border-needle/20 bg-needle/6 px-4 py-2">
              <div className="flex-1 overflow-hidden">
                <p className="text-[0.65rem] font-semibold text-needle">{replyingTo.sender_name ?? 'Unknown'}</p>
                <p className="truncate text-[0.65rem] text-ink/52">
                  {replyingTo.is_deleted ? 'This message was unsent.' : replyingTo.type === 'PHOTO' ? 'Photo' : replyingTo.type === 'VOICE' ? 'Voice note' : safeUserText(replyingTo.body, '')}
                </p>
              </div>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setReplyingTo(null)}
                label="Cancel reply"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Edit mode bar */}
          {editingMessage ? (
            <div className="flex items-center justify-between border-t border-ink/10 bg-bone px-4 py-2">
              <p className="text-xs font-semibold text-ink/52">Editing message</p>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditingMessage(null)}
                label="Cancel edit"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Composer */}
          <div className="border-t border-ink/8 bg-white/90 px-3 pb-3 pt-2">
            <MessageComposer
              order={selectedThread.order}
              onRefresh={onRefresh}
              channelRef={orderChannelRef}
              replyingTo={replyingTo}
              onClearReply={() => setReplyingTo(null)}
              editingMessage={editingMessage}
              onClearEdit={() => setEditingMessage(null)}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function RenderMeasurements({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const legacyMeasurementCount = hasMeasurements(data.customerProfile) ? 1 : 0
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Named profiles" value={data.measurementProfiles.length} hint="Reusable wearer profiles" icon={<Users />} />
        <MetricCard label="Drapeon Vision scans" value={data.measurementScans.length} hint="Saved guided captures" icon={<ScanLine />} />
        <MetricCard label="Profile units" value={data.customerProfile?.unit_preference || data.measurementProfiles[0]?.unit_preference || 'Not set'} hint="Applied across measurements" icon={<Ruler />} />
      </section>
      <ManualMeasurementEditor data={data} onRefresh={onRefresh} />
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Surface>
          <SurfaceHeader title="Wearer profiles" description="Review saved measurements before starting a custom brief." />
          <div className="grid gap-3 p-5">
            {data.measurementProfiles.length === 0 && legacyMeasurementCount === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No measurement profiles yet. Add manual measurements or use Drapeon Vision in the app before starting a custom order.
              </p>
            ) : (
              <>
                {data.measurementProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-[8px] border border-ui-border bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-ink">{safeUserText(profile.label, 'Measurement profile')}</h3>
                        <p className="mt-1 text-sm text-ink/60">
                          {cleanLabel(profile.relationship, 'Wearer')} · {cleanLabel(profile.source, 'Manual')}
                        </p>
                      </div>
                      <p className="text-xs font-semibold text-needle">{profile.is_default ? 'Default' : profile.unit_preference}</p>
                    </div>
                    {(() => {
                      const profileMeasurements = measurementsForProfile(profile, data.customerProfile)
                      const completeness = measurementCompleteness(profileMeasurements)
                      const statusCopy = measurementProfileStatusCopy(completeness)
                      const values = coreMeasurementSummary(profileMeasurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[8px] bg-ui-muted px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{statusCopy.lead}</span>
                            {` ${statusCopy.detail}`}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <SpecialistMeasurementSections measurements={profileMeasurements} />
                        </>
                      )
                    })()}
                    <p className="mt-3 text-xs text-ink/46">
                      Last measured {formatDate(profile.last_measured_at ?? profile.updated_at) ?? 'recently'}
                    </p>
                  </div>
                ))}
                {legacyMeasurementCount > 0 ? (
                  <div className="rounded-[8px] border border-ui-border bg-white p-4">
                    <h3 className="font-semibold text-ink">Main customer measurements</h3>
                    <p className="mt-1 text-sm text-ink/60">Legacy profile · {fitPreferenceFromProfile(data.customerProfile)}</p>
                    {(() => {
                      const completeness = measurementCompleteness(data.customerProfile?.measurements)
                      const statusCopy = measurementProfileStatusCopy(completeness)
                      const values = coreMeasurementSummary(data.customerProfile?.measurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[8px] bg-ui-muted px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{statusCopy.lead}</span>
                            {` ${statusCopy.detail}`}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <SpecialistMeasurementSections measurements={data.customerProfile?.measurements} />
                        </>
                      )
                    })()}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Surface>
        <Surface>
          <SurfaceHeader
            title="Drapeon Vision"
            description="Guided scans stay linked to the wearer profile and can be reviewed before an order is placed."
            action={<OpenAppButton label="Open Drapeon Vision" />}
          />
          <div className="grid gap-3 p-5">
            {data.measurementScans.length === 0 ? (
              <p className="rounded-[8px] bg-white/70 p-4 text-sm leading-6 text-ink/62">No scan records yet.</p>
            ) : (
              data.measurementScans.map((scan) => (
                <SummaryLine
                  key={scan.id}
                  label={cleanLabel(scan.capture_method, 'Scan')}
                  value={<span className="flex flex-wrap items-center gap-2"><StatusChip status={scan.status} fallback="Captured" /><span>{scanConfidenceLabel(scan.confidence_overall)}</span></span>}
                />
              ))
            )}
          </div>
        </Surface>
      </section>
    </div>
  )
}

function RenderShop({ data, onRefresh }: { data: ShopRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const allItems = isTailor
    ? data.sellerItems
    : data.exploreItems.filter((item) => isReadyMadeBuyableOnWeb(item, firstJoinedRow(item.tailor_profiles)))
  const [shopSearch, setShopSearch] = useState('')
  const [shopCategory, setShopCategory] = useState('all')
  const [shopSort, setShopSort] = useState('newest')

  const categories = uniqueValues(allItems.map((item) => item.category).filter((c): c is string => !!c)).slice(0, 12)

  const filteredItems = allItems.filter((item) => {
    if (shopSearch.trim()) {
      const hay = [item.title, item.description, item.category, firstJoinedRow(item.tailor_profiles)?.display_name, firstJoinedRow(item.tailor_profiles)?.business_name].join(' ').toLowerCase()
      if (!hay.includes(shopSearch.trim().toLowerCase())) return false
    }
    if (shopCategory !== 'all' && item.category !== shopCategory) return false
    return true
  }).sort((a, b) => {
    if (shopSort === 'price-asc') return (a.price_amount ?? 0) - (b.price_amount ?? 0)
    if (shopSort === 'price-desc') return (b.price_amount ?? 0) - (a.price_amount ?? 0)
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  })

  if (isTailor) {
    return (
      <div className="grid gap-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Total items" value={data.sellerItems.length} hint="All catalogue records" icon={<ShoppingBag />} />
          <MetricCard label="Published" value={data.sellerItems.filter((item) => item.is_live).length} hint="Visible to customers" icon={<CheckCheck />} />
          <MetricCard label="Payout" value={isPayoutReady(data.tailorProfile) ? 'Ready' : 'Setup needed'} hint="Controls checkout availability" icon={<WalletCards />} />
        </section>
        <SellerItemManager data={data} onRefresh={onRefresh} />
      </div>
    )
  }

  // Customer marketplace view
  return (
    <div className="grid gap-4">
      {/* Search + sort bar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
          <Input
          value={shopSearch}
          onChange={(e) => setShopSearch(e.target.value)}
          placeholder="Search pieces, categories, or tailors..."
          className="pl-9"
          />
        </div>
        <select value={shopSort} onChange={(e) => setShopSort(e.target.value)} className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/40">
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      {/* Category chips */}
      {categories.length > 0 ? (
        <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
          {(['all', ...categories] as string[]).map((cat) => (
            <Button
              key={cat}
              type="button"
              onClick={() => setShopCategory(cat)}
              variant={shopCategory === cat ? 'primary' : 'secondary'}
              size="sm"
              className="whitespace-nowrap"
            >
              {cat === 'all' ? 'All pieces' : cat}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Explore tailors link */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/52">
          {filteredItems.length} piece{filteredItems.length !== 1 ? 's' : ''}
        </p>
        <Link href="/account/explore" className="text-sm font-semibold text-needle">
          Browse tailors →
        </Link>
      </div>

      {/* Item grid */}
      {filteredItems.length === 0 ? (
        <EmptyState
          title="No pieces match your search."
          body="Try a different category or clear the search."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const tailor = firstJoinedRow(item.tailor_profiles)
            const photo = itemPhoto(item)
            const safeSrc = safeMediaUrl(photo)
            const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars')
            return (
              <article key={item.id} className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/8">
                  {safeSrc ? (
                    <Image src={safeSrc} alt={safeUserText(item.title, 'Item')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">No photo</div>
                  )}
                  {item.category ? (
                    <div className="absolute left-3 top-3">
                      <Badge tone="neutral" className="bg-white/90 shadow-sm backdrop-blur-sm">{item.category}</Badge>
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-10">
                    <p className="text-sm font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-xl font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                  {tailor ? (
                    <Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="mt-1 inline-flex items-center gap-1.5 text-sm text-needle hover:underline">
                      {tailorAvatarSrc ? (
                        <span className="relative inline-block h-5 w-5 overflow-hidden rounded-full bg-needle/10">
                          <Image src={tailorAvatarSrc} alt="" fill className="object-cover" unoptimized />
                        </span>
                      ) : null}
                      {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                    </Link>
                  ) : null}
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/58">{fulfillmentSummary(item)}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button asChild variant="secondary"><Link href={accountRoute(`/account/items/${item.id}`)}>View item</Link></Button>
                    {tailor?.id ? (
                      <Button asChild><Link href={accountRoute(`/account/tailors/${tailor.id}`)}>View tailor</Link></Button>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RenderWork({ data, onRefresh }: { data: WorkRenderData; onRefresh: () => void }) {
  const [colsOpen, setColsOpen] = useState([false, false, false, false])
  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor workspace not set up."
        body="Apply for tailor access before the web work queue can show orders, shop, payout state, and client context."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const tailorOrders = data.orders.filter((order) => order.tailor_profile_id === data.tailorProfile?.id || order.tailor_id === data.userId)
  const activeOrders = tailorOrders.filter((order) => !isTerminalOrder(order))
  const pendingReplyOrders = activeOrders.filter((order) => ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? ''))
  const columns = [
    { key: 'needs-action', title: 'Needs action', body: 'Quotes, payment issues, and disputes.', orders: activeOrders.filter((order) => workColumnFor(order) === 'needs-action') },
    { key: 'production', title: 'In production', body: 'Confirmed work moving through stages.', orders: activeOrders.filter((order) => workColumnFor(order) === 'production') },
    { key: 'dispatched', title: 'Dispatched', body: 'Collection, dispatch, and delivery handoff.', orders: activeOrders.filter((order) => workColumnFor(order) === 'dispatched') },
    { key: 'done', title: 'Done / recent', body: 'Closed or waiting on final review.', orders: tailorOrders.filter((order) => isTerminalOrder(order) || workColumnFor(order) === 'done').slice(0, 8) },
  ] as const

  const availability = data.tailorProfile.availability ?? 'OPEN'
  const availLabel = availability === 'OPEN' ? 'Open for orders' : availability === 'LIMITED' ? 'Limited availability' : 'Fully booked'
  const availHint = availability === 'OPEN' ? 'Customers can find and book you.' : availability === 'LIMITED' ? 'Visible with a slower-reply notice.' : 'New bookings paused; active orders unaffected.'
  const availDotColor = availability === 'OPEN' ? 'bg-emerald-500' : availability === 'LIMITED' ? 'bg-amber-400' : 'bg-rust'
  const payoutVerified = isPayoutReady(data.tailorProfile)
  const payoutLabel = payoutVerified ? 'Payout ready' : data.tailorProfile.payout_reverification_required ? 'Reverification needed' : data.tailorProfile.is_live ? 'Checkout paused' : 'Payout pending'
  const payoutHint = payoutVerified
    ? (data.tailorProfile.payout_bank_name ?? data.tailorProfile.payout_provider ?? 'Account verified')
    : data.tailorProfile.payout_reverification_required
      ? 'Open Payout to re-verify your account.'
      : 'Set up payouts before earnings can release.'
  const payoutBadgeStyle = payoutVerified
    ? 'bg-needle/10 text-needle'
    : data.tailorProfile.payout_reverification_required
      ? 'bg-rust/10 text-rust'
      : 'bg-amber-400/15 text-amber-600'
  const readiness = deriveWebTailorReadiness(data.tailorProfile)
  const identityStatus = data.tailorProfile.id_verification_status ?? 'NOT_SUBMITTED'
  const identityLabel = readiness.identityVerified
    ? 'Verified'
    : identityStatus === 'PENDING'
      ? 'In review'
      : identityStatus === 'REJECTED'
        ? 'Needs resubmission'
        : 'Not submitted'
  const identityBadgeStyle = readiness.identityVerified
    ? 'bg-needle/10 text-needle'
    : identityStatus === 'PENDING'
      ? 'bg-amber-400/15 text-amber-600'
      : 'bg-rust/10 text-rust'

  const todayFocus: { tone: 'warning' | 'default' | 'success'; eyebrow: string; title: string; body: string; action: string; actionHref: Route } = (() => {
    if (pendingReplyOrders.length > 0) {
      return {
        tone: 'warning',
        eyebrow: 'Today',
        title: `${pendingReplyOrders.length} quote${pendingReplyOrders.length === 1 ? '' : 's'} waiting`,
        body: 'Send clear pricing or request a consultation before the customer cools off.',
        action: 'Review orders',
        actionHref: '/account/orders' as Route,
      }
    }
    if (activeOrders.length > 0) {
      const next = activeOrders[0]
      if (next) {
        return {
          tone: 'default',
          eyebrow: 'Today',
          title: orderTitle(next),
          body: orderActionCopy(next, data) ?? 'Check the order for the next step.',
          action: 'Open active orders',
          actionHref: '/account/orders' as Route,
        }
      }
    }
    if (!readiness.canAcceptPaidOrders) {
      return {
        tone: 'warning',
        eyebrow: 'Readiness',
        title: readiness.title,
        body: readiness.body,
        action: readiness.actionLabel ?? 'Review profile',
        actionHref: readiness.actionHref ?? ('/account/profile' as Route),
      }
    }
    if (!payoutVerified) {
      return {
        tone: 'default',
        eyebrow: 'Today',
        title: payoutLabel,
        body: payoutHint,
        action: 'Set up payout',
        actionHref: '/account/payout' as Route,
      }
    }
    return {
      tone: 'success',
      eyebrow: 'Today',
      title: 'No urgent actions',
      body: 'Your queue is clear. Update your availability or review your shop while it stays quiet.',
      action: 'Manage availability',
      actionHref: '/account/profile' as Route,
    }
  })()

  function WorkOrderCard({ order }: { order: AccountOrder }) {
    const action = orderActionCopy(order, data)
    return (
      <Link
        href={`/account/orders/${order.id}`}
        className="block rounded-[8px] border border-ui-border bg-white p-3.5 shadow-sm transition hover:border-needle/30 hover:shadow-md"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle/70">
            {cleanLabel(order.order_kind, 'Order')}
          </span>
          <StagePill stage={order.stage} />
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
        <p className="mt-0.5 truncate text-xs text-ink/52">
          {partyName(order, data.userId)} · {orderAmount(order)}
        </p>
        <div className="mt-2.5">
          <StageProgressBar order={order} />
        </div>
        <p className={`mt-2 text-xs leading-4 ${action ? 'text-amber-700' : 'text-ink/38'}`}>
          {action ?? formatRelative(order.updated_at ?? order.created_at)}
        </p>
      </Link>
    )
  }

  return (
    <div className="grid gap-6">

      <Surface>
        <SurfaceHeader
          eyebrow="Tailor cockpit"
          title={safeEntityName(data.tailorProfile.business_name || data.tailorProfile.display_name, 'Dashboard')}
          description="Live order health, selling readiness, and the next task that needs attention."
          action={<StatusChip status={data.tailorProfile.is_live ? 'LIVE' : 'HIDDEN'} />}
        />
        <div className="grid gap-4 p-5">

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Active" value={activeOrders.length} hint="Orders in progress" icon={<Briefcase />} className="shadow-none" />
            <MetricCard label="Needs reply" value={pendingReplyOrders.length} hint="Quotes or consultations" icon={<MessageCircle />} className="shadow-none" />
            <MetricCard label="Completed" value={data.tailorProfile.total_orders ?? 0} hint="Lifetime finished orders" icon={<CheckCheck />} className="shadow-none" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
          <Link href="/account/profile" className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${availDotColor}`} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-needle/70">Availability</span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">{availLabel}</p>
            <p className="mt-0.5 text-xs leading-4 text-ink/52">{availHint}</p>
          </Link>
          <Link href="/account/profile" className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white">
            <div className="flex items-center gap-1.5">
              <StatusChip status={identityLabel} className={identityBadgeStyle} />
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">Identity</p>
            <p className="mt-0.5 text-xs leading-4 text-ink/52">{readiness.profileCompleted ? 'Profile setup complete.' : 'Finish profile setup before paid work.'}</p>
          </Link>
          <Link href="/account/payout" className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white">
            <div className="flex items-center gap-1.5">
              <StatusChip status={payoutLabel} className={payoutBadgeStyle} />
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">Payout</p>
            <p className="mt-0.5 text-xs leading-4 text-ink/52">{payoutHint}</p>
          </Link>
        </div>

          <div className={`rounded-[8px] border p-4 ${
          todayFocus.tone === 'warning'
            ? 'border-amber-300/40 bg-amber-400/8'
            : todayFocus.tone === 'success'
              ? 'border-needle/16 bg-needle/6'
              : 'border-ink/8 bg-bone/60'
        }`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">{todayFocus.eyebrow}</p>
          <p className="mt-1.5 text-base font-semibold text-ink">{todayFocus.title}</p>
          <p className="mt-1 text-xs leading-5 text-ink/56">{todayFocus.body}</p>
          <Button asChild size="sm" className="mt-3"><Link href={todayFocus.actionHref}>{todayFocus.action}</Link></Button>
          </div>
        </div>
      </Surface>

      {/* ── Active order queue (mobile) ── */}
      <section className="lg:hidden">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Order queue</p>
          {activeOrders.length > 0 && (
            <span className="rounded-full bg-needle/10 px-2.5 py-0.5 text-xs font-semibold text-needle">{activeOrders.length}</span>
          )}
        </div>
        {activeOrders.length === 0 ? (
          <EmptyState
            title="No active work right now."
            body="New custom briefs and ready-made orders will appear here when customers place them."
            action={<Link href="/account/shop" className="font-semibold text-needle">Review shop</Link>}
          />
        ) : (
          <div className="grid gap-2.5">
            {activeOrders.map((order) => <WorkOrderCard key={order.id} order={order} />)}
          </div>
        )}
      </section>

      {/* ── Desktop kanban ── */}
      <section className="hidden gap-3 lg:grid lg:grid-cols-4">
        {columns.map((column, i) => {
          const isOpen = colsOpen[i] ?? true
          const count = column.orders.length
          return (
            <div key={column.key} className="overflow-hidden rounded-[8px] border border-ui-border bg-white">
              <button
                type="button"
                onClick={() => setColsOpen((prev) => prev.map((v, idx) => idx === i ? !v : v))}
                className="flex w-full items-start justify-between gap-2 px-4 py-3.5 text-left transition hover:bg-ink/3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{column.title}</span>
                    {count > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${column.key === 'needs-action' ? 'bg-amber-400/20 text-amber-700' : 'bg-needle/10 text-needle'}`}>{count}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink/44">{column.body}</p>
                </div>
                <ChevronDown className={`mt-0.5 size-4 shrink-0 text-ink/30 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="grid gap-2.5 border-t border-ink/6 p-3">
                  {count === 0 ? (
                    <p className="rounded-[8px] bg-bone/60 px-3 py-2.5 text-xs text-ink/42">Nothing here.</p>
                  ) : (
                    column.orders.map((order) => <WorkOrderCard key={`${column.key}-${order.id}`} order={order} />)
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

    </div>
  )
}

function RenderCheckout({ data, orderId, onRefresh }: { data: CheckoutRenderData; orderId?: string; onRefresh: () => void }) {
  const customerOrders = data.orders.filter((entry) => isCustomerOrder(entry, data))
  const order = orderId
    ? data.orders.find((entry) => entry.id === orderId) ?? null
    : customerOrders.find(isPayableOrder) ?? customerOrders[0] ?? null
  if (!order) {
    return (
      <EmptyState
        title="No payment is waiting."
        body="Orders appear here when a quote, ready-made purchase, or retry needs customer payment. Otherwise, keep using Orders."
        action={<Link href="/account/orders" className="font-semibold text-needle">View orders</Link>}
      />
    )
  }
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const confirmed = payments.some((payment) => ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? ''))
  const viewerIsCustomer = isCustomerOrder(order, data)
  const checkoutAvailable = viewerIsCustomer && isPayableOrder(order)

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Surface className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          {confirmed ? 'Payment confirmed' : checkoutAvailable ? 'Payment needed' : 'Payment unavailable'}
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">{orderTitle(order)}</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          {confirmed
            ? 'This payment is recorded. Continue tracking production, handoff, and support from the order.'
            : checkoutAvailable
              ? 'Pay through the provider when the order is ready. If a payment is already processing, Drapeon reuses that attempt instead of creating a duplicate charge.'
              : viewerIsCustomer
                ? 'This customer order is not awaiting payment right now. Check the order timeline for the current stage.'
                : 'Payment actions are customer-only. Tailor work belongs in the work queue and order detail action panel.'}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SummaryLine label="Order total" value={orderAmount(order)} />
          <SummaryLine label="Provider" value={cleanLabel(order.payment_provider, 'Provider selected at payment')} />
          <SummaryLine label="Fulfillment" value={cleanLabel(order.delivery_method, 'Fulfillment')} />
          <SummaryLine label="Status" value={<StagePill stage={order.stage} />} />
        </div>
        <div className="mt-6">
          {viewerIsCustomer ? (
            <CheckoutAction order={order} onRefresh={onRefresh} />
          ) : (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              You are viewing this as the tailor, so payment collection stays locked to the customer account.
            </p>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <OpenAppButton label="Open in app" />
          <Button asChild variant="secondary"><Link href={`/account/orders/${order.id}`}>Back to order</Link></Button>
        </div>
      </Surface>
      <section className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-ink">Payment ledger</h2>
        <div className="mt-5 grid gap-3">
          {payments.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No provider payment has been recorded yet. If you already paid, do not pay again; open Support or the order thread.
            </p>
          ) : (
            payments.map((payment) => (
              <SummaryLine
                key={payment.id}
                label={cleanLabel(payment.phase, 'Payment')}
                value={<span className="flex flex-wrap items-center gap-2">{formatMoney(payment.amount, payment.currency)} <StatusChip status={payment.status} fallback="Pending" /></span>}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function RenderSaved({ data }: { data: SavedSurfaceData }) {
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set())
  const tailorById = new Map(data.savedTailors.map((tailor) => [tailor.id, tailor]))
  const itemById = new Map(data.savedItems.map((item) => [item.id, item]))

  function toggleCollection(id: string) {
    setExpandedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Collections" value={data.wishlistCollections.length} hint="Organized wishlists" icon={<Archive />} />
        <MetricCard label="Saved tailors" value={data.savedTailors.length} hint="People and studios" icon={<Users />} />
        <MetricCard label="Saved pieces" value={data.savedItems.length} hint="Ready-made items" icon={<ShoppingBag />} />
      </section>

      {data.wishlistCollections.length === 0 && data.savedTailors.length === 0 && data.savedItems.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          body="Save tailors from Explore and ready-made pieces from Marketplace while planning an event or comparing options."
          action={<Link href="/account/explore" className="font-semibold text-needle">Browse Explore</Link>}
        />
      ) : null}

      {data.wishlistCollections.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2">
          {data.wishlistCollections.map((collection) => {
            const allItems = data.wishlistItems.filter((item) => item.collection_id === collection.id)
            const isExpanded = expandedCollectionIds.has(collection.id)
            const visibleItems = isExpanded ? allItems : allItems.slice(0, 4)
            const fallbackPhoto =
              collection.cover_image_url ||
              allItems
                .map((entry) => {
                  if (entry.tailor_id) {
                    const tailor = tailorById.get(entry.tailor_id)
                    return tailor ? tailorPhoto(tailor) : null
                  }
                  if (entry.ready_made_item_id) {
                    const item = itemById.get(entry.ready_made_item_id)
                    return item ? itemPhoto(item) : null
                  }
                  return null
                })
                .find(Boolean) ||
              null

            return (
              <article key={collection.id} className="rounded-[8px] border border-ui-border bg-white p-5 shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleCollection(collection.id)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <div className={fallbackPhoto ? 'grid flex-1 gap-4 sm:grid-cols-[0.38fr_0.62fr]' : 'flex-1'}>
                    {fallbackPhoto ? (
                      <PhotoTile src={fallbackPhoto} label="Wishlist collection" />
                    ) : null}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Wishlist</p>
                      <h2 className="mt-2 text-2xl font-semibold text-ink">{safeUserText(collection.name, 'Wishlist')}</h2>
                      <p className="mt-2 text-sm text-ink/58">
                        {collection.item_count ?? allItems.length} {(collection.item_count ?? allItems.length) === 1 ? 'item' : 'items'} · Updated {formatRelative(collection.updated_at)}
                      </p>
                    </div>
                  </div>
                  <span className="mt-1 shrink-0 text-xs font-semibold text-needle/70">
                    {isExpanded ? 'Collapse' : 'Open'}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="mt-4 grid gap-2">
                    {visibleItems.length === 0 ? (
                      <p className="rounded-[8px] bg-bone/70 px-4 py-3 text-sm leading-6 text-ink/62">
                        Save a tailor from Explore or a ready-made piece from Marketplace to add it here.
                      </p>
                    ) : (
                      visibleItems.map((entry) => {
                        const tailor = entry.tailor_id ? tailorById.get(entry.tailor_id) : null
                        const item = entry.ready_made_item_id ? itemById.get(entry.ready_made_item_id) : null
                        const href = tailor
                          ? accountRoute(`/account/tailors/${tailor.id}`)
                          : item
                            ? accountRoute(`/account/items/${item.id}`)
                            : '/account/explore'
                        return (
                          <Link
                            key={entry.id}
                            href={href}
                            className="rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-needle/30"
                          >
                            {tailor
                              ? safeEntityName(tailor.business_name || tailor.display_name, 'Saved tailor')
                              : item
                                ? safeUserText(item.title, 'Saved ready-made item')
                                : 'Saved item'}
                          </Link>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {data.savedTailors.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Saved tailors</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedTailors.map((tailor) => {
              const photo = tailorPhoto(tailor)
              const safeSrc = safeMediaUrl(photo)
              const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
              return (
                <Link key={tailor.id} href={accountRoute(`/account/tailors/${tailor.id}`)} className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md">
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image src={safeSrc} alt={safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">{safeEntityName(tailor.business_name || tailor.display_name, 'T').slice(0, 2).toUpperCase()}</div>
                    )}
                    {tailor.is_verified ? (
                      <div className="absolute left-3 top-3">
                        <StatusChip status="VERIFIED" className="bg-white/90 shadow-sm backdrop-blur-sm" />
                      </div>
                    ) : null}
                    {tailor.avg_rating ? (
                      <div className="absolute right-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">★ {Number(tailor.avg_rating).toFixed(1)}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h3>
                    <p className="mt-0.5 text-sm text-ink/50">{safeUserText(tailor.location, 'Location pending')}</p>
                    {specialtyTags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {specialtyTags.map((tag) => (
                          <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      {data.savedItems.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Saved ready-made</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedItems.map((item) => {
              const photo = itemPhoto(item)
              const safeSrc = safeMediaUrl(photo)
              return (
                <Link key={item.id} href={accountRoute(`/account/items/${item.id}`)} className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md">
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image src={safeSrc} alt={safeUserText(item.title, 'Item')} fill sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw" className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">No photo</div>
                    )}
                    {item.category ? (
                      <div className="absolute left-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">{item.category}</span>
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-8">
                      <p className="text-sm font-semibold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">{safeUserText(item.title, 'Ready-made item')}</h3>
                    <p className="mt-0.5 text-sm font-semibold text-rust">{stockCopy(item)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function payoutStatusLabel(profile: TailorProfile | null) {
  if (!profile) return 'No tailor profile'
  if (profile.payout_reverification_required) return 'Reverification needed'
  if (isPayoutReady(profile)) return 'Ready'
  if (profile.manual_bank_entry) return `Manual bank ${cleanLabel(profile.manual_bank_verification_status, 'pending ops review')}`
  if (profile.payout_account_type === 'STRIPE_CONNECT' && profile.stripe_connect_account_id) return 'Stripe review needed'
  if (profile.payout_account_type === 'PAYSTACK' && profile.paystack_recipient_code) return 'Paystack review needed'
  return profile.is_live ? 'Checkout paused' : 'Payout pending'
}

type TxStatus = 'PENDING' | 'AVAILABLE' | 'RELEASED' | 'PAID_OUT' | 'BLOCKED' | 'FAILED'
type TxRecord = {
  orderId: string
  reference: string
  customer: string
  title: string
  orderAmount: number
  currency: string
  platformFee: number
  taxAmount: number
  netAmount: number
  status: TxStatus
  reason: string | null
  date: string
}

const NOT_PAID_ORDER_STAGES = new Set(['DRAFT', 'QUOTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELED', 'EXPIRED'])

function deriveTxStatus(order: AccountOrder, payouts: AccountPayout[]): { status: TxStatus; reason: string | null } {
  const orderPayouts = payouts
    .filter((p) => p.order_id === order.id)
    .sort((a, b) => timestampMs(b.initiated_at) - timestampMs(a.initiated_at))
  const latest = orderPayouts[0]
  if (latest?.status === 'PAID') return { status: 'PAID_OUT', reason: null }
  if (latest?.status === 'PROCESSING') return { status: 'RELEASED', reason: null }
  if (latest?.status === 'FAILED' || latest?.status === 'REVERSED' || latest?.status === 'CANCELED') {
    return { status: 'FAILED', reason: 'Payout transfer failed and needs ops review.' }
  }
  if (latest?.status === 'BLOCKED') {
    return { status: 'BLOCKED', reason: payoutBlockedReasonCopy(latest.blocked_reason) ?? 'Payout is blocked and needs ops review.' }
  }
  const stage = (order.stage ?? '').toUpperCase()
  if (stage === 'REFUNDED') return { status: 'FAILED', reason: 'Order was refunded.' }
  if (stage === 'PARTIALLY_REFUNDED') return { status: 'BLOCKED', reason: 'Partial refund applied.' }
  if (stage === 'PAYMENT_FAILED' || stage === 'CANCELED') return { status: 'FAILED', reason: null }
  if (NOT_PAID_ORDER_STAGES.has(stage)) return { status: 'PENDING', reason: 'Awaiting customer payment.' }
  if (order.escrow_released) return { status: 'RELEASED', reason: null }
  return { status: 'AVAILABLE', reason: null }
}

function txPillClass(status: TxStatus): string {
  switch (status) {
    case 'PAID_OUT': return 'border-needle/20 bg-needle/10 text-needle'
    case 'RELEASED': return 'border-needle/16 bg-needle/6 text-needle/80'
    case 'AVAILABLE': return 'border-blue-200 bg-blue-50 text-blue-700'
    case 'PENDING': return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'BLOCKED': return 'border-rust/20 bg-rust/8 text-rust'
    case 'FAILED': return 'border-red-200 bg-red-50 text-red-700'
  }
}

function txStatusLabel(status: TxStatus): string {
  switch (status) {
    case 'PAID_OUT': return 'Paid out'
    case 'RELEASED': return 'Released'
    case 'AVAILABLE': return 'Available'
    case 'PENDING': return 'Pending'
    case 'BLOCKED': return 'Blocked'
    case 'FAILED': return 'Failed'
  }
}

function buildTxCsv(rows: TxRecord[]): string {
  const headers = ['Order ID', 'Reference', 'Customer', 'Garment', 'Customer Paid', 'Platform Fee', 'Tax', 'Net Earnings', 'Currency', 'Status', 'Date']
  const dataRows = rows.map((t) => [
    t.orderId, t.reference, t.customer, t.title,
    String(t.orderAmount / 100), String(t.platformFee / 100), String(t.taxAmount / 100), String(t.netAmount / 100),
    t.currency, t.status, t.date,
  ])
  return [headers, ...dataRows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

function RenderEarnings({ data }: { data: EarningsRenderData }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'ALL'>('ALL')
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('all')
  const [now] = useState(() => Date.now())

  const allTransactions = useMemo<TxRecord[]>(() => {
    if (!data.tailorProfile) return []
    return data.orders.map((order) => {
      const { status, reason } = deriveTxStatus(order, data.payouts)
      const cp = order.customer_profiles
      const cpSingle = Array.isArray(cp) ? cp[0] : cp
      const customerFirst = (cpSingle?.display_name ?? 'Customer').split(/\s+/)[0] ?? 'Customer'
      return {
        orderId: order.id,
        reference: order.reference ?? order.id.slice(0, 8),
        customer: customerFirst,
        title: orderTitle(order),
        orderAmount: order.total_amount ?? 0,
        currency: order.currency ?? 'USD',
        platformFee: order.platform_fee_amount ?? 0,
        taxAmount: order.tax_amount ?? 0,
        netAmount: order.subtotal_amount ?? 0,
        status,
        reason,
        date: order.updated_at ?? order.created_at ?? '',
      }
    })
  }, [data.orders, data.payouts, data.tailorProfile])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allTransactions.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
      if (range !== 'all') {
        const cutoff = now - Number(range) * 24 * 60 * 60 * 1000
        if (timestampMs(t.date) < cutoff) return false
      }
      if (!needle) return true
      return [t.reference, t.customer, t.title, t.orderId].some((v) => v.toLowerCase().includes(needle))
    })
  }, [allTransactions, statusFilter, range, search, now])

  const csvHref = useMemo(() => {
    if (filtered.length === 0) return '#'
    return `data:text/csv;charset=utf-8,${encodeURIComponent(buildTxCsv(filtered))}`
  }, [filtered])

  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor earnings need a tailor profile."
        body="Apply for tailor access before web can show payout records, status breakdowns, and order-linked earnings."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const summaryCurrency = data.tailorProfile.payout_currency ?? data.tailorProfile.currency ?? 'USD'
  const totalEarnings = allTransactions.filter((t) => t.status !== 'FAILED').reduce((s, t) => s + t.netAmount, 0)
  const availableAmount = allTransactions.filter((t) => t.status === 'AVAILABLE' || t.status === 'RELEASED').reduce((s, t) => s + t.netAmount, 0)
  const pendingAmount = allTransactions.filter((t) => t.status === 'PENDING' || t.status === 'BLOCKED').reduce((s, t) => s + t.netAmount, 0)
  const paidOutAmount = allTransactions.filter((t) => t.status === 'PAID_OUT').reduce((s, t) => s + t.netAmount, 0)
  const payoutReady = isPayoutReady(data.tailorProfile)
  const transactionColumns: ColumnDef<TxRecord>[] = [
    {
      accessorKey: 'reference',
      header: 'Order',
      cell: ({ row }) => (
        <div className="min-w-[13rem]">
          <Button asChild variant="link"><Link href={`/account/orders/${row.original.orderId}` as Route}>{row.original.title}</Link></Button>
          <p className="mt-1 text-xs text-ui-subtle">#{row.original.reference} · {row.original.customer}</p>
        </div>
      ),
    },
    { accessorKey: 'date', header: 'Date', cell: ({ row }) => <span className="whitespace-nowrap text-ui-subtle">{formatDate(row.original.date) ?? 'Not recorded'}</span> },
    { accessorKey: 'orderAmount', header: 'Customer paid', cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{formatMoney(row.original.orderAmount, row.original.currency)}</span> },
    { accessorKey: 'platformFee', header: 'Platform fee', cell: ({ row }) => <span className="whitespace-nowrap">{formatMoney(row.original.platformFee, row.original.currency)}</span> },
    { accessorKey: 'taxAmount', header: 'Tax', cell: ({ row }) => <span className="whitespace-nowrap">{formatMoney(row.original.taxAmount, row.original.currency)}</span> },
    { accessorKey: 'netAmount', header: 'Net earnings', cell: ({ row }) => <span className="whitespace-nowrap font-semibold text-drape-green">{formatMoney(row.original.netAmount, row.original.currency)}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusChip status={txStatusLabel(row.original.status)} className={txPillClass(row.original.status)} /> },
  ]

  return (
    <div className="grid gap-6">
      {/* Summary stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['Total earnings', formatMoney(totalEarnings, summaryCurrency), 'Net across all settled orders'],
          ['Available / released', formatMoney(availableAmount, summaryCurrency), 'Ready for payout or in transit'],
          ['Pending release', formatMoney(pendingAmount, summaryCurrency), 'Awaiting delivery, review, or setup'],
          ['Paid out', formatMoney(paidOutAmount, summaryCurrency), 'Completed provider transfers'],
        ] as const).map(([label, value, hint]) => (
          <MetricCard key={label} label={label} value={value} hint={hint} icon={<Banknote />} />
        ))}
      </section>

      {/* Payout account status */}
      <Surface className="flex items-center gap-4 px-5 py-4">
        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${payoutReady ? 'bg-needle' : 'bg-amber-400'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {data.tailorProfile.payout_bank_name
              ? `${data.tailorProfile.payout_bank_name}${data.tailorProfile.payout_account_masked ? ' · ' + data.tailorProfile.payout_account_masked : ''}`
              : 'Payout account'}
          </p>
          <p className="mt-0.5 text-xs text-ink/48">{payoutStatusLabel(data.tailorProfile)}</p>
        </div>
        {!payoutReady && (
          <Button asChild size="sm"><Link href="/account/payout">Set up payout</Link></Button>
        )}
      </Surface>

      {/* Transaction history */}
      <Surface>
        <SurfaceHeader
          eyebrow="Earnings"
          title="Transaction history"
          description="Order amounts, platform fees, tax, and net earnings in one sortable ledger."
          action={<Button asChild variant="secondary" size="sm" className={filtered.length === 0 ? 'pointer-events-none opacity-40' : ''}><a href={csvHref} download="drapeon-earnings.csv">Export CSV</a></Button>}
        />
        <div className="grid gap-3 p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
            <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order ID, reference, customer, or garment…"
            className="pl-9"
          />
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="overflow-x-auto pb-1">
              <SegmentedControl
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel="Transaction status"
                options={(['ALL', 'PENDING', 'AVAILABLE', 'RELEASED', 'PAID_OUT', 'BLOCKED', 'FAILED'] as const).map((key) => ({ value: key, label: key === 'ALL' ? 'All' : txStatusLabel(key as TxStatus) }))}
              />
            </div>
            <SegmentedControl
              value={range}
              onChange={setRange}
              ariaLabel="Transaction date range"
              options={([['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All time']] as const).map(([value, label]) => ({ value, label }))}
            />
          </div>

          <DataTable columns={transactionColumns} data={filtered} emptyMessage={allTransactions.length === 0 ? 'No transactions yet. Completed orders will appear here once they settle.' : 'No transactions match these filters.'} />
          <p className="text-xs leading-5 text-ink/36">Amounts show net earnings in the order currency. Export includes platform fee, tax, and net for accountant reconciliation.</p>
        </div>
      </Surface>

      {/* Payout history */}
      <Surface>
        <SurfaceHeader eyebrow="Transfers" title="Payout history" description="Provider transfers and any release blockers." />
        <div className="grid gap-2 p-5">
          {data.payouts.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/52">
              No payouts yet. Once Drapeon releases a completed order, the provider reference and settlement status appear here.
            </p>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-ui-border bg-white">
              {data.payouts.map((payout, index) => {
                const order = payout.order_id ? data.orders.find((entry) => entry.id === payout.order_id) : null
                return (
                  <div key={payout.id} className={`flex items-start gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StagePill stage={payout.status} label={cleanLabel(payout.status, 'Payout')} />
                        <span className="text-xs text-ink/38">{cleanLabel(payout.provider, 'Provider')}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-ink/52">
                        {order ? `${orderTitle(order)} · #${order.reference ?? order.id.slice(0, 8)}` : payout.order_id ?? 'Standalone payout'}
                      </p>
                      {payout.blocked_reason ? (
                        <p className="mt-2 rounded-lg bg-rust/8 px-3 py-1.5 text-xs text-rust">{payoutBlockedReasonCopy(payout.blocked_reason) ?? cleanLabel(payout.blocked_reason, 'Blocked')}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-ink/36">
                        Completed {formatDate(payout.completed_at) ?? 'not yet'} · initiated {formatRelative(payout.initiated_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-semibold text-ink">{formatMoney(payout.amount, payout.currency)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Surface>
    </div>
  )
}

function RenderPayout({ data, onRefresh }: { data: PayoutRenderData; onRefresh: () => void }) {
  const profile = data.tailorProfile
  const [payoutCurrency, setPayoutCurrency] = useState(profile?.payout_currency ?? profile?.currency ?? 'USD')
  const [countryCode, setCountryCode] = useState(profile?.payout_country_code ?? 'US')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [banks, setBanks] = useState<Array<{ code: string; name: string; country?: string | null; currency?: string | null }>>([])
  const [verification, setVerification] = useState<{ resolvedAccountName: string; maskedAccountNumber: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const paystackCurrency = ['NGN', 'GHS', 'KES'].includes(payoutCurrency)
  const stripeCurrency = ['USD', 'GBP', 'EUR', 'CAD'].includes(payoutCurrency)
  const autoLoadedPaystackBanksRef = useRef<string | null>(null)
  const paystackCountryForCurrency = payoutCurrency === 'NGN' ? 'NG' : payoutCurrency === 'GHS' ? 'GH' : payoutCurrency === 'KES' ? 'KE' : countryCode
  const displayedCountryCode = paystackCurrency ? paystackCountryForCurrency : countryCode
  const bankOptions = useMemo(() => {
    const seenCodes = new Set<string>()
    return banks.filter((bank) => {
      const code = bank.code.trim()
      if (!code || seenCodes.has(code)) return false
      seenCodes.add(code)
      return true
    })
  }, [banks])

  const loadBanks = useCallback(async (options?: { quiet?: boolean }) => {
    if (!paystackCurrency) return
    setBusy('banks')
    setError(null)
    if (!options?.quiet) setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ banks?: Array<{ code: string; name: string; country?: string | null; currency?: string | null }>; warning?: string | null }>('payout-account-action', {
        action: 'list-paystack-banks',
        payoutCurrency,
        countryCode: paystackCountryForCurrency,
      })
      setBanks(result.banks ?? [])
      if (result.warning) {
        setSuccess(result.warning)
      } else if (!options?.quiet) {
        setSuccess('Bank directory refreshed.')
      }
    } catch (loadError) {
      setError(friendlyActionError(loadError, 'Bank directory could not load.'))
    } finally {
      setBusy(null)
    }
  }, [paystackCountryForCurrency, paystackCurrency, payoutCurrency])

  useEffect(() => {
    if (!profile || !paystackCurrency || busy) return
    const directoryKey = `${payoutCurrency}:${paystackCountryForCurrency}`
    if (autoLoadedPaystackBanksRef.current === directoryKey) return
    autoLoadedPaystackBanksRef.current = directoryKey
    setBanks([])
    setBankCode('')
    setBankName('')
    setVerification(null)
    void loadBanks({ quiet: true })
  }, [busy, loadBanks, paystackCountryForCurrency, paystackCurrency, payoutCurrency, profile])

  if (!profile) {
    return (
      <EmptyState
        title="Payout setup needs a tailor profile."
        body="Tailor payout setup is only available after this account has approved tailor access and a tailor profile."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  async function verifyPaystack() {
    setBusy('verify')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ verification?: { resolvedAccountName: string; maskedAccountNumber: string } }>('payout-account-action', {
        action: 'verify-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: accountName.trim() || undefined,
      })
      setVerification(result.verification ?? null)
      setSuccess(result.verification ? `Verified account name: ${result.verification.resolvedAccountName}` : 'Account verified.')
    } catch (verifyError) {
      setError(friendlyActionError(verifyError, 'Account could not be verified.'))
    } finally {
      setBusy(null)
    }
  }

  async function savePaystack() {
    if (!verification) {
      setError('Verify the account before saving it.')
      return
    }
    setBusy('save-paystack')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('payout-account-action', {
        action: 'confirm-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: verification.resolvedAccountName,
      })
      setSuccess('Paystack payout account saved and verified.')
      onRefresh()
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Payout account could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function startStripe() {
    if (typeof window === 'undefined') return
    setBusy('stripe')
    setError(null)
    setSuccess(null)
    try {
      const returnUrl = `${window.location.origin}/account/payout?setup=complete`
      const result = await invokeAccountFunction<{ onboarding?: { url?: string | null } }>('payout-account-action', {
        action: 'start-stripe-connect',
        payoutCurrency,
        countryCode,
        returnUrl,
        refreshUrl: `${window.location.origin}/account/payout?setup=refresh`,
      })
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setSuccess('Stripe onboarding started. Continue from the provider window.')
    } catch (stripeError) {
      setError(friendlyActionError(stripeError, 'Stripe onboarding could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function refreshStripe() {
    setBusy('refresh-stripe')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('payout-account-action', { action: 'refresh-stripe-connect-status' })
      setSuccess('Stripe payout status refreshed.')
      onRefresh()
    } catch (refreshError) {
      setError(friendlyActionError(refreshError, 'Stripe payout status could not refresh.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Status', payoutStatusLabel(profile)],
          ['Provider', cleanLabel(profile.payout_provider ?? profile.payout_account_type, 'Not set')],
          ['Currency', profile.payout_currency ?? 'Not set'],
          ['Hold until', formatDate(profile.payout_destination_hold_until) ?? 'No hold'],
        ].map(([label, value]) => (
          <MetricCard key={String(label)} label={String(label)} value={String(value)} icon={<WalletCards />} />
        ))}
      </section>

      <Surface>
        <SurfaceHeader eyebrow="Current destination" title="Where earnings are sent" description="Your active verified provider destination." />
        <div className="divide-y divide-ui-border px-5 pb-2">
          {[
            ['Bank', profile.payout_bank_name ?? profile.manual_bank_name ?? 'Not set'],
            ['Account', profile.payout_account_masked ?? 'Not set'],
            ['Account name', profile.payout_account_name ?? profile.manual_bank_account_name ?? 'Not set'],
            ['Paystack recipient', profile.paystack_recipient_code ? 'Saved' : 'Not saved'],
            ['Stripe Connect', profile.stripe_connect_account_id ? 'Connected' : 'Not started'],
            ['Manual bank', profile.manual_bank_entry ? cleanLabel(profile.manual_bank_verification_status, 'Pending ops review') : 'Not used'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between gap-4 py-3">
              <span className="text-xs font-semibold text-ink/42">{String(label)}</span>
              <span className="text-right text-sm font-semibold text-ink">{String(value)}</span>
            </div>
          ))}
        </div>
      </Surface>

      <Surface>
        <SurfaceHeader
          eyebrow="Provider setup"
          title="Use an automated payout route"
          description="Stripe Connect handles USD, GBP, EUR, and CAD. Paystack handles NGN, GHS, and KES."
        />
        <div className="grid gap-5 p-5">
          <ActionNotice error={error} success={success} />
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Payout currency</span>
            <select
              value={payoutCurrency}
              onChange={(event) => {
                const nextCurrency = event.target.value
                setPayoutCurrency(nextCurrency)
                setCountryCode(nextCurrency === 'NGN' ? 'NG' : nextCurrency === 'GHS' ? 'GH' : nextCurrency === 'KES' ? 'KE' : countryCode)
                setBankCode('')
                setBankName('')
                setBanks([])
                setVerification(null)
              }}
              className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
            >
              {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Country code</span>
            <Input
              value={displayedCountryCode}
              onChange={(event) => {
                setCountryCode(event.target.value.toUpperCase().slice(0, 2))
                setBankCode('')
                setBankName('')
                setBanks([])
                setVerification(null)
              }}
              placeholder="US"
              readOnly={paystackCurrency}
            />
          </label>
          <div className="flex items-end">
            {stripeCurrency ? (
              <Button type="button" onClick={startStripe} disabled={!!busy} className="w-full">
                {busy === 'stripe' ? 'Opening Stripe...' : 'Start Stripe Connect'}
              </Button>
            ) : (
              <Button type="button" onClick={() => void loadBanks()} disabled={!!busy || !paystackCurrency} className="w-full">
                {busy === 'banks' ? 'Loading banks...' : bankOptions.length > 0 ? 'Refresh banks' : 'Retry banks'}
              </Button>
            )}
          </div>
        </div>

        {profile.stripe_connect_account_id ? (
          <Button type="button" onClick={refreshStripe} disabled={!!busy} variant="secondary">
            {busy === 'refresh-stripe' ? 'Refreshing...' : 'Refresh Stripe status'}
          </Button>
        ) : null}

        {paystackCurrency ? (
          <div className="grid gap-4 rounded-[8px] border border-ui-border bg-ui-muted/45 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Bank</span>
                <select
                  value={bankCode}
                  onChange={(event) => {
                    const next = bankOptions.find((bank) => bank.code === event.target.value)
                    setBankCode(event.target.value)
                    setBankName(next?.name ?? '')
                    setVerification(null)
                  }}
                  disabled={busy === 'banks' || bankOptions.length === 0}
                  className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                >
                  <option value="">{busy === 'banks' ? 'Loading banks...' : bankOptions.length > 0 ? 'Select bank' : 'Banks unavailable'}</option>
                  {bankOptions.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Account number</span>
                <Input value={accountNumber} onChange={(event) => { setAccountNumber(event.target.value); setVerification(null) }} />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Expected account name</span>
                <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} />
              </label>
            </div>
            {verification ? (
              <p className="rounded-[8px] border border-needle/14 bg-needle/8 p-4 text-sm leading-6 text-needle">
                Verified: {verification.resolvedAccountName} · {verification.maskedAccountNumber}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={verifyPaystack} disabled={!!busy || !bankCode || !accountNumber} variant="secondary">
                {busy === 'verify' ? 'Verifying...' : 'Verify account'}
              </Button>
              <Button type="button" onClick={savePaystack} disabled={!!busy || !verification}>
                {busy === 'save-paystack' ? 'Saving...' : 'Save verified Paystack account'}
              </Button>
            </div>
          </div>
        ) : null}
        </div>
      </Surface>

      <Surface className="border-rust/20 bg-rust/5">
        <SurfaceHeader eyebrow="Manual bank entry" title="Manual bank setup requires payout support" />
        <div className="p-5">
        <p className="text-sm leading-7 text-ink/66">
          Manual bank details require an ops review and manual payout recording workflow before they can be used safely. Use Stripe or Paystack for automated setup, or contact payouts if your bank is not supported.
        </p>
        <Button asChild variant="secondary" className="mt-5 text-rust"><a href={mailto(CONTACTS.payouts, 'Manual payout setup question')}>Contact payouts</a></Button>
        </div>
      </Surface>
    </div>
  )
}

const SELLER_TYPE_WEB_OPTIONS = [
  { value: 'TAILOR', label: 'Tailor', hint: 'Custom and bespoke work made to order.' },
  { value: 'BOUTIQUE', label: 'Boutique', hint: 'Ready-made garments and stock collections.' },
  { value: 'TAILOR_SHOP', label: 'Tailor shop', hint: 'A full studio handling custom orders and ready-made collections together.' },
] as const

function TailorSellingSetupEditor({ data, onRefresh }: { data: ProfileRenderData; onRefresh: () => void }) {
  const profile = data.tailorProfile
  const [displayName, setDisplayName] = useState(profile?.display_name || profile?.business_name || '')
  const [location, setLocation] = useState(profile?.location ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [languages, setLanguages] = useState(editableListText(profile?.languages))
  const [specialties, setSpecialties] = useState(editableListText(profile?.specialty_tags))
  const [currency, setCurrency] = useState(profile?.currency ?? 'USD')
  const [availability, setAvailability] = useState(profile?.availability === 'FULLY_BOOKED' || profile?.availability === 'LIMITED' ? profile.availability : 'OPEN')
  const [sellerType, setSellerType] = useState(profile?.seller_type === 'BOUTIQUE' || profile?.seller_type === 'TAILOR_SHOP' ? profile.seller_type : 'TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(profile?.supports_custom_orders !== false)
  const [supportsReadyMade, setSupportsReadyMade] = useState(profile?.supports_ready_made === true)
  const [acceptsCustomOrdersNow, setAcceptsCustomOrdersNow] = useState(profile?.accepts_custom_orders_now !== false)
  const [shopPaused, setShopPaused] = useState(profile?.shop_paused === true)
  const [pickupAvailable, setPickupAvailable] = useState(profile?.pickup_available === true)
  const [deliveryAvailable, setDeliveryAvailable] = useState(profile?.delivery_available === true)
  const [shippingAvailable, setShippingAvailable] = useState(profile?.shipping_available === true)
  const [pickupAddress, setPickupAddress] = useState(data.pickupDetails?.pickup_address ?? '')
  const [pickupInstructions, setPickupInstructions] = useState(data.pickupDetails?.pickup_instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!profile) return null

  function applySellerType(nextType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP') {
    setSellerType(nextType)
    if (nextType === 'BOUTIQUE') {
      setSupportsCustomOrders(false)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(false)
      setShopPaused(false)
    } else if (nextType === 'TAILOR_SHOP') {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(false)
    } else {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(false)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(true)
    }
  }

  async function saveSellingSetup() {
    setError(null)
    setSuccess(null)

    const parsedLanguages = parseEditableList(languages, 12)
    const parsedSpecialties = parseEditableList(specialties, 20)
    const leak = assertNoContactLeak(
      [
        displayName,
        location,
        bio,
        parsedLanguages.join('\n'),
        parsedSpecialties.join('\n'),
        pickupInstructions,
      ].join('\n'),
      "Selling setup can't include phone numbers, emails, or off-platform contact details.",
    )
    if (leak) {
      setError(leak)
      return
    }
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) {
      setError(displayNameError)
      return
    }
    if (location.trim().length < 2) {
      setError(TAILOR_SETUP_VALIDATION.LOCATION_REQUIRED_MESSAGE)
      return
    }
    if (parsedSpecialties.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE)
      return
    }
    if (!supportsCustomOrders && !supportsReadyMade) {
      setError(TAILOR_SETUP_VALIDATION.ORDER_MODE_REQUIRED_MESSAGE)
      return
    }
    if (!pickupAvailable && !deliveryAvailable && !shippingAvailable) {
      setError(TAILOR_SETUP_VALIDATION.FULFILLMENT_REQUIRED_MESSAGE)
      return
    }
    if (pickupAvailable && pickupAddress.trim().length < 8) {
      setError(TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE)
      return
    }

    setBusy(true)
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-profile',
        profile: {
          displayName: displayName.trim(),
          location: location.trim(),
          bio: bio.trim() || null,
          languages: parsedLanguages,
          specialties: parsedSpecialties,
          currency,
          availability,
          sellerType,
          supportsCustomOrders,
          supportsReadyMade,
          acceptsCustomOrdersNow,
          shopPaused,
          pickupAvailable,
          pickupAddress: pickupAddress.trim() || null,
          pickupInstructions: pickupInstructions.trim() || null,
          deliveryAvailable,
          shippingAvailable,
        },
      })
      setSuccess('Selling setup saved.')
      onRefresh()
    } catch (setupError) {
      setError(friendlyActionError(setupError, 'Selling setup could not save.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group mt-4 border-t border-ink/6 pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 marker:hidden">
        <span>
          <span className="block text-sm font-semibold text-ink">Edit setup on web</span>
          <span className="mt-1 block text-xs leading-5 text-ink/56">Update business type, order status, fulfillment, private pickup details, public bio, specialties, and languages.</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-ui-subtle transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-4 grid gap-4">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Public display name">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City, country" />
          </Field>
          <Field label="Profile currency" hint="Customers see this currency. Payout setup follows it, so choose one you can accept payouts in.">
            <NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => <option key={code} value={code}>{code}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Availability" hint="Controls search visibility and whether customers see a slower-capacity notice.">
            <NativeSelect value={availability} onChange={(event) => setAvailability(event.target.value)}>
              <option value="OPEN">Open for orders</option>
              <option value="LIMITED">Limited availability</option>
              <option value="FULLY_BOOKED">Fully booked</option>
            </NativeSelect>
          </Field>
          <Field label="Bio" className="md:col-span-2">
            <Textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} />
          </Field>
          <Field label="Specialties">
            <Textarea value={specialties} onChange={(event) => setSpecialties(event.target.value)} rows={3} placeholder="Aso oke, Bridal, Agbada" />
          </Field>
          <Field label="Languages">
            <Textarea value={languages} onChange={(event) => setLanguages(event.target.value)} rows={3} placeholder="English, Yoruba" />
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {SELLER_TYPE_WEB_OPTIONS.map(({ value, label, hint }) => (
            <label key={value} className={`grid cursor-pointer gap-2 rounded-[8px] border px-4 py-3 text-sm font-semibold ${sellerType === value ? 'border-needle/24 bg-needle/10 text-needle' : 'border-ink/8 bg-white text-ink/68'}`}>
              <span className="flex items-center gap-3">
                <input type="radio" name="seller-type" checked={sellerType === value} onChange={() => applySellerType(value)} />
                <span>{label}</span>
              </span>
              <span className="text-xs font-medium leading-5 text-ink/56">{hint}</span>
            </label>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {supportsCustomOrders ? (
            <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm text-ink">
              <span className="font-semibold">Custom order status</span>
              <span className="text-xs leading-5 text-ink/56">Controls whether customers can send new custom briefs.</span>
              <NativeSelect value={acceptsCustomOrdersNow ? 'OPEN' : 'PAUSED'} onChange={(event) => setAcceptsCustomOrdersNow(event.target.value === 'OPEN')}>
                <option value="OPEN">Taking custom orders</option>
                <option value="PAUSED">Custom orders paused</option>
              </NativeSelect>
            </div>
          ) : null}
          {supportsReadyMade ? (
            <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm text-ink">
              <span className="font-semibold">Ready-made shop status</span>
              <span className="text-xs leading-5 text-ink/56">Controls checkout for live ready-made inventory.</span>
              <NativeSelect value={shopPaused ? 'PAUSED' : 'OPEN'} onChange={(event) => setShopPaused(event.target.value === 'PAUSED')}>
                <option value="OPEN">Shop checkout open</option>
                <option value="PAUSED">Shop checkout paused</option>
              </NativeSelect>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {([
            ['pickup', 'Pickup', pickupAvailable, setPickupAvailable],
            ['delivery', 'Delivery', deliveryAvailable, setDeliveryAvailable],
            ['shipping', 'Shipping', shippingAvailable, setShippingAvailable],
          ] as const).map(([key, label, checked, setter]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm font-semibold text-ink">
              <span>{label}</span>
              <Switch checked={checked} onCheckedChange={setter} aria-label={`${label} available`} />
            </div>
          ))}
        </div>

        {pickupAvailable ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/10 bg-needle/6 p-4">
            <Field label="Private pickup address">
              <Textarea value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} rows={3} placeholder="Full address customers unlock after collection is ready" />
            </Field>
            <Field label="Pickup instructions">
              <Input value={pickupInstructions} onChange={(event) => setPickupInstructions(event.target.value)} placeholder="e.g. Bring your collection code" />
            </Field>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={saveSellingSetup} disabled={busy}>
            {busy ? 'Saving...' : 'Save selling setup'}
          </Button>
          <Button asChild variant="ghost"><Link href="/account/shop">Manage ready-made shop <ChevronRight /></Link></Button>
          <Button asChild variant="ghost"><Link href="/account/payout">Review payout <ChevronRight /></Link></Button>
        </div>
      </div>
    </details>
  )
}

type IdentityHandoffRealtimeState = 'idle' | 'waiting' | 'opened' | 'submitted'

function readStringField(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readIdentityRejectionCode(profile: Pick<TailorProfile, 'id_verification_metadata'>) {
  const metadata = profile.id_verification_metadata && typeof profile.id_verification_metadata === 'object'
    ? profile.id_verification_metadata
    : null
  const nested = metadata?.identity_verification && typeof metadata.identity_verification === 'object'
    ? metadata.identity_verification as Record<string, unknown>
    : null
  return (
    readStringField(metadata, ['rejection_code', 'rejectionCode']) ??
    readStringField(nested, ['rejection_code', 'rejectionCode']) ??
    ''
  ).toUpperCase()
}

function isInvalidProfileImageRejected(profile: Pick<TailorProfile, 'id_verification_status' | 'id_verification_metadata'> | null | undefined) {
  return (
    profile?.id_verification_status === 'REJECTED' &&
    readIdentityRejectionCode(profile) === INVALID_PROFILE_IMAGE_REJECTION_CODE
  )
}

function identityRejectionMessage(profile: Pick<TailorProfile, 'id_verification_rejection_reason' | 'id_verification_metadata'>) {
  const rejectionCode = readIdentityRejectionCode(profile)
  if (rejectionCode === INVALID_PROFILE_IMAGE_REJECTION_CODE) return PROFILE_IMAGE_REJECTION_MESSAGE

  const direct = profile.id_verification_rejection_reason?.trim()
  if (direct) return safeUserText(direct, 'Identity review needs a clearer retake.')

  const metadata = profile.id_verification_metadata && typeof profile.id_verification_metadata === 'object'
    ? profile.id_verification_metadata
    : null
  const nested = metadata?.identity_verification && typeof metadata.identity_verification === 'object'
    ? metadata.identity_verification as Record<string, unknown>
    : null
  const reason =
    readStringField(metadata, ['rejection_reason', 'rejectionReason', 'moderation_note', 'moderationMessage', 'reason', 'note']) ??
    readStringField(nested, ['rejection_reason', 'rejectionReason', 'moderation_note', 'moderationMessage', 'reason', 'note'])

  return safeUserText(reason, 'Identity review needs a clearer retake. Capture a sharp live selfie with your face and physical ID fully visible.')
}

type IdentityHandoffSession = {
  handoffId?: string
  token?: string
  path?: string
  url?: string
  expiresAt?: string
}

function IdentityHandoffCard({
  userId,
  profile,
  onRefresh,
}: {
  userId: string | null
  profile: TailorProfile
  onRefresh: () => void
}) {
  const [session, setSession] = useState<IdentityHandoffSession | null>(null)
  const [delivery, setDelivery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [handoffState, setHandoffState] = useState<IdentityHandoffRealtimeState>('idle')
  const status = profile.id_verification_status ?? 'NOT_SUBMITTED'
  const handoffUrl = session?.url ?? ''
  const pending = status === 'PENDING'
  const verified = isVerifiedIdentityStatus(status)
  const rejected = status === 'REJECTED'
  const profileImageRejected = isInvalidProfileImageRejected(profile)
  const rejectionMessage = rejected ? identityRejectionMessage(profile) : null
  const handoffStatusText = handoffState === 'opened'
    ? '📱 Phone connected. Capturing selfie on your device...'
    : handoffState === 'submitted'
      ? '🎉 Identity Submitted for Review! Our team completes audits within 24 hours.'
      : '🔒 Waiting for secure mobile connection...'
  const payoutReady = isPayoutReady(profile)

  const checkLatestStatus = useCallback(async () => {
    if (!userId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('tailor_profiles')
      .select('id_verification_status')
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.id_verification_status === 'PENDING') {
      setHandoffState('submitted')
      setSuccess('Identity selfie submitted. Review is now pending.')
      onRefresh()
    }
  }, [onRefresh, userId])

  useEffect(() => {
    if (!userId || !session || pending || verified) return undefined
    const supabase = createClient()
    const channel = supabase
      .channel(`tailor-idv-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tailor_profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextStatus = String((payload.new as { id_verification_status?: string | null })?.id_verification_status ?? '')
          if (nextStatus === 'PENDING') {
            setHandoffState('submitted')
            setSuccess('Identity selfie submitted. Review is now pending.')
            onRefresh()
          }
        },
      )
      .subscribe()

    const interval = window.setInterval(() => {
      void checkLatestStatus()
    }, 5000)

    return () => {
      window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [checkLatestStatus, onRefresh, pending, session, userId, verified])

  useEffect(() => {
    if (!session?.handoffId || pending || verified) return undefined
    const supabase = createClient()
    const channel = supabase
      .channel(`identity-handoff-session-${session.handoffId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'identity_verification_handoffs',
          filter: `id=eq.${session.handoffId}`,
        },
        (payload) => {
          const nextStatus = String((payload.new as { status?: string | null })?.status ?? '')
          if (nextStatus === 'OPENED' || nextStatus === 'CAPTURED') {
            setHandoffState('opened')
          }
          if (nextStatus === 'SUBMITTED') {
            setHandoffState('submitted')
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [pending, session?.handoffId, verified])

  async function startSession() {
    if (!userId) return
    setBusy('create')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<IdentityHandoffSession>('identity-handoff-action', {
        action: 'create',
      })
      setSession(result)
      setHandoffState('waiting')
      setSuccess('Scan or send the secure phone link to complete live capture.')
    } catch (handoffError) {
      setError(friendlyActionError(handoffError, 'Identity handoff could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function sendLink() {
    if (!session?.token) return
    setBusy('send')
    setError(null)
    setSuccess(null)
    try {
      const channel = delivery.includes('@') ? 'EMAIL' : 'SMS'
      await invokeAccountFunction('identity-handoff-action', {
        action: 'send-link',
        token: session.token,
        channel,
        requestedDelivery: delivery,
      })
      setSuccess('Identity handoff link sent.')
    } catch (handoffError) {
      setError(friendlyActionError(handoffError, 'Identity handoff link could not send.'))
    } finally {
      setBusy(null)
    }
  }

  if (profileImageRejected) {
    return (
      <section className="rounded-[8px] border border-rust/20 bg-rust/8 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust">Identity verification</p>
        <h3 className="mt-2 text-xl font-semibold text-ink">Profile photo needs replacement</h3>
        <p className="mt-2 text-sm leading-6 text-rust/90">{PROFILE_IMAGE_REJECTION_MESSAGE}</p>
        <p className="mt-2 text-sm leading-6 text-ink/64">Your live ID selfie remains on file. Upload a clearer avatar below, then submit setup again so ops can re-review the public photo.</p>
        <a href="#profile-photo" className="mt-4 inline-flex rounded-full bg-rust px-4 py-2 text-sm font-semibold text-white">Upload replacement photo</a>
      </section>
    )
  }

  if (verified || pending) {
    return (
      <section className={`rounded-[8px] border p-5 shadow-sm transition-all duration-500 ${verified ? 'border-needle/14 bg-needle/6' : 'border-emerald-400/25 bg-emerald-400/10'}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">Identity verification</p>
        <h3 className="mt-2 text-xl font-semibold text-ink">{verified ? 'Identity verified' : '🎉 Identity Submitted for Review!'}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/64">
          {verified ? 'Your live identity selfie has passed review.' : 'Our team completes audits within 24 hours. Keep your profile details accurate while Drapeon Trust reviews it.'}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-[8px] border border-needle/12 bg-white/84 p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">Verify identity via smartphone</p>
          <h3 className="mt-2 text-2xl text-ink">Capture Identity Selfie for Review.</h3>
          <p className="mt-2 text-sm leading-6 text-ink/64">
            Use your phone camera to take one live selfie while holding your physical passport, licence, or national ID beside your face.
          </p>
          {!payoutReady ? (
            <div className="mt-4 rounded-[8px] border border-amber-300/35 bg-amber-400/8 p-4">
              <p className="text-sm font-semibold text-ink">Payout setup comes next</p>
              <p className="mt-1.5 text-sm leading-6 text-ink/62">Identity review can be submitted now. Paid quotes, live shop publishing, and earnings release stay paused until payout is verified.</p>
              <Link href="/account/payout" className="mt-3 inline-flex text-sm font-semibold text-needle">Review payout setup →</Link>
            </div>
          ) : null}
          {rejected ? (
            <div className="mt-4 rounded-[8px] border border-rust/20 bg-rust/8 p-4">
              <p className="text-sm font-semibold text-rust">Identity retake needed</p>
              <p className="mt-1.5 text-sm leading-6 text-rust/90">{rejectionMessage}</p>
            </div>
          ) : null}
          <ActionNotice error={error} success={success} />
        </div>

        <div className="w-full max-w-sm rounded-[8px] border border-ink/8 bg-bone/70 p-4 transition-all duration-500">
          {handoffState === 'submitted' ? (
            <div className="mb-4 translate-y-0 rounded-[8px] border border-emerald-400/25 bg-emerald-400/10 p-4 opacity-100 transition-all duration-500">
              <p className="text-sm font-semibold text-needle">🎉 Identity Submitted for Review!</p>
              <p className="mt-1.5 text-sm leading-6 text-ink/64">Our team completes audits within 24 hours.</p>
            </div>
          ) : null}
          {handoffUrl ? (
            <div className={`grid justify-items-center gap-4 transition-all duration-500 ${handoffState === 'submitted' ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-[560px] translate-y-0 opacity-100'}`}>
              <div className="rounded-[8px] border border-ink/8 bg-white p-3 shadow-inner" aria-label="Identity handoff QR code">
                <QRCodeSVG value={handoffUrl} size={180} includeMargin={true} />
              </div>
              <div className="flex items-center gap-2 rounded-full border border-ink/8 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/68">
                {handoffState === 'opened' ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-needle/25 border-t-needle" aria-hidden="true" />
                ) : (
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-needle opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-needle" />
                  </span>
                )}
                <span>{handoffStatusText}</span>
              </div>
              <a href={handoffUrl} className="break-all text-center text-xs font-semibold text-needle">{handoffUrl}</a>
              <div className="grid w-full gap-2">
                <input
                  value={delivery}
                  onChange={(event) => setDelivery(event.target.value)}
                  placeholder="Email or phone"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <button type="button" onClick={() => { void sendLink() }} disabled={busy === 'send' || !delivery.trim()} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:bg-ink/20">
                  {busy === 'send' ? 'Sending...' : 'Send link to myself'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { void startSession() }} disabled={busy === 'create'} className="flex w-full justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:bg-ink/20">
              {busy === 'create' ? 'Starting...' : 'Start smartphone verification'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function RenderProfile({ data, onRefresh }: { data: ProfileRenderData; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false)
  const profile = data.tailorProfile
  if (!profile) {
    return (
      <EmptyState
        title="Tailor profile not found."
        body="Customer accounts can still use orders, messages, measurements, and saved items. Tailor profile editing appears after tailor access is approved and setup is started."
        action={<Link href="/apply?source=account" className="font-semibold text-needle">Apply as a tailor</Link>}
      />
    )
  }

  const profileId = profile.id
  function handleShareProfile() {
    void navigator.clipboard?.writeText(`https://drapeon.co/tailors/${profileId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const availPillStyle = profile.availability === 'OPEN'
    ? 'bg-bone text-ink'
    : profile.availability === 'LIMITED'
      ? 'bg-amber-400/15 text-amber-700'
      : 'bg-rust/10 text-rust'
  const availText = profile.availability === 'OPEN'
    ? 'Available'
    : profile.availability === 'LIMITED'
      ? 'Limited'
      : 'Fully booked'
  const readiness = deriveWebTailorReadiness(profile)
  const identityStatus = profile.id_verification_status ?? 'NOT_SUBMITTED'
  const identityLabel = readiness.identityVerified
    ? 'Verified'
    : identityStatus === 'PENDING'
      ? 'In review'
      : identityStatus === 'REJECTED'
        ? 'Needs resubmission'
        : 'Not submitted'

  const normalizedSellerType = profile.seller_type === 'BOUTIQUE' || profile.seller_type === 'TAILOR_SHOP'
    ? profile.seller_type
    : 'TAILOR'
  const businessTypeLabel = normalizedSellerType === 'BOUTIQUE'
    ? 'Boutique'
    : normalizedSellerType === 'TAILOR_SHOP'
      ? 'Tailor shop'
      : 'Tailor'
  const priceGuideLabel = profile.price_range_min && profile.price_range_max
    ? `${formatMoney(profile.price_range_min, profile.currency)}–${formatMoney(profile.price_range_max, profile.currency)}`
    : 'Price needed'
  const portfolioProofCount = data.portfolioItems.filter((item) => Boolean(item.image_url)).length + stringList(profile.portfolio_video_urls).length
  const readyMadeProofCount = data.sellerItems.length
  const proofChecklistLabel = normalizedSellerType === 'BOUTIQUE'
    ? 'Ready-made listing'
    : normalizedSellerType === 'TAILOR_SHOP'
      ? 'Portfolio + ready-made item'
      : 'Portfolio sample'
  const proofChecklistValue = normalizedSellerType === 'BOUTIQUE'
    ? readyMadeProofCount > 0
      ? `${readyMadeProofCount} ready-made item${readyMadeProofCount === 1 ? '' : 's'}`
      : 'Needed'
    : normalizedSellerType === 'TAILOR_SHOP'
      ? portfolioProofCount > 0 && readyMadeProofCount > 0
        ? [`${portfolioProofCount} portfolio`, `${readyMadeProofCount} ready-made`].join(' · ')
        : portfolioProofCount > 0
          ? 'Need ready-made item'
          : readyMadeProofCount > 0
            ? 'Need portfolio sample'
            : 'Needed'
      : portfolioProofCount > 0
        ? `${portfolioProofCount} portfolio item${portfolioProofCount === 1 ? '' : 's'}`
        : 'Needed'
  const sellingSetupRows = [
    { label: 'Contact + public profile', value: readiness.profileCompleted ? 'Complete' : 'Setup in progress' },
    { label: 'Business type + pricing', value: `${businessTypeLabel} · ${priceGuideLabel}` },
    { label: proofChecklistLabel, value: proofChecklistValue },
    { label: 'Identity & payout readiness', value: `${identityLabel} · ${payoutStatusLabel(profile)}` },
  ]

  return (
    <div className="grid gap-6">

      {/* ── Hero card ── */}
      <Surface className="overflow-hidden">
        <div className="flex items-start gap-5 p-6 pb-4">
          {/* Avatar with live dot */}
          <div className="relative shrink-0">
            <div className="h-[76px] w-[76px] overflow-hidden rounded-full border border-ink/10 bg-needle/10">
              {safeMediaUrl(profile.avatar_url, 'avatars') ? (
                <Image
                  src={safeMediaUrl(profile.avatar_url, 'avatars') ?? ''}
                  alt=""
                  width={76}
                  height={76}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-needle">
                  {(profile.business_name || profile.display_name || '?')[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </div>
            <span className={`absolute left-1 top-1 h-3 w-3 rounded-full border-2 border-white ${profile.is_live ? 'bg-emerald-500' : 'bg-ink/30'}`} />
          </div>

          {/* Name, location, status pills */}
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-2xl text-ink">
              {safeEntityName(profile.business_name || profile.display_name, 'Tailor profile')}
            </h2>
            {profile.location ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/52">
                <MapPin className="size-3.5 shrink-0" />
                {profile.location}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip status={availText} className={availPillStyle} />
              <StatusChip status={profile.is_live ? 'LIVE' : 'NOT_LIVE'} />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px border-t border-ink/6 bg-ink/6">
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">
              {(profile.avg_rating ?? 0) > 0 ? (profile.avg_rating ?? 0).toFixed(1) : '—'}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink/48"><Star className="size-3 fill-current" /> Rating</p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_reviews ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Reviews</p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_orders ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Orders</p>
          </div>
        </div>
      </Surface>

      {/* ── Readiness ── */}
      <Surface className={`p-5 ${
        readiness.tone === 'success'
          ? 'border-needle/14 bg-needle/6'
          : readiness.tone === 'warning'
            ? 'border-amber-300/35 bg-amber-400/8'
            : 'border-ink/8 bg-white/84'
      }`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">Go-live status</p>
            <h3 className="mt-2 text-xl font-semibold text-ink">{readiness.title}</h3>
            <p className="mt-2 text-sm leading-6 text-ink/64">{readiness.body}</p>
          </div>
          {readiness.actionHref ? (
            <Button asChild className="shrink-0"><Link href={readiness.actionHref}>{readiness.actionLabel ?? 'Review'}</Link></Button>
          ) : readiness.actionLabel ? (
            <OpenAppButton label={readiness.actionLabel} className="inline-flex shrink-0 justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white" />
          ) : null}
        </div>
      </Surface>

      {!readiness.identityVerified ? (
        <IdentityHandoffCard userId={data.userId} profile={profile} onRefresh={onRefresh} />
      ) : null}

      {/* ── Selling setup ── */}
      <Surface>
        <SurfaceHeader title="Go-live checklist" description="The profile, proof, identity, and payout gates that control customer access." />
        <div className="divide-y divide-ui-border px-5">
          {sellingSetupRows.map((row) => (
            <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1fr)] sm:items-start">
              <span className="text-xs font-semibold text-ui-subtle">{row.label}</span>
              <span className="break-words text-sm font-semibold text-ink sm:text-right">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5"><TailorSellingSetupEditor data={data} onRefresh={onRefresh} /></div>
      </Surface>

      {/* ── Portfolio ── */}
      <PortfolioManager data={data} onRefresh={onRefresh} />

      {/* ── Action list ── */}
      <Surface className="overflow-hidden">
        {profile.is_live ? (
          <button
            type="button"
            onClick={handleShareProfile}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-left text-sm font-semibold text-ink transition hover:bg-bone/60"
          >
            {copied ? 'Link copied!' : 'Share my live profile'}
            <Share2 className="size-4 text-ui-subtle" />
          </button>
        ) : null}
        <Link
          href="/account/payout"
          className="flex min-h-[52px] items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          Review payout setup
          <ChevronRight className="size-4 text-ui-subtle" />
        </Link>
        <Link
          href="/account/earnings"
          className="flex min-h-[52px] items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          View earnings
          <ChevronRight className="size-4 text-ui-subtle" />
        </Link>
      </Surface>

      {/* ── App-only trust steps ── */}
      <Surface className="border-needle/12 bg-needle/6 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">Trust steps</p>
        <p className="mt-2 text-sm leading-6 text-ink/66">
          Body scans, push permissions, and stronger reauth flows still work best in the app. Identity review now starts from this secure smartphone handoff.
        </p>
        <div className="mt-4">
          <OpenAppButton label="Open app trust flows" className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white" />
        </div>
      </Surface>

    </div>
  )
}

function PasswordChangePanel({ session }: { session: Session | null }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null
  const sessionEmail = session.user.email

  async function changePassword() {
    setError(null); setSuccess(null)
    if (!currentPassword) { setError('Enter your current password first.'); return }
    const passwordError = validatePasswordStrength(newPassword, { forbiddenValues: [sessionEmail] })
    if (passwordError) { setError(passwordError); return }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'PASSWORD_CHANGE')
      const result = await invokeAccountFunction<{ emailQueued?: boolean }>('account-security-action', {
        action: 'change-password',
        reauthProof: proof.proof,
        newPassword,
      })
      setSuccess(result.emailQueued ? 'Password updated. We sent a security receipt to your email.' : 'Password updated. Use it next time you sign in.')
      setCurrentPassword(''); setNewPassword(''); setConfirm(''); setShow(false)
    } catch (err) {
      setError(friendlyActionError(err, 'Password could not update. Confirm your current password and try again.'))
    } finally { setBusy(false) }
  }

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>Change password <ChevronRight /></Button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (8+ chars)" />
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={changePassword} disabled={busy}>
          {busy ? 'Updating...' : 'Update password'}
        </Button>
        <Button variant="secondary" onClick={() => { setShow(false); setCurrentPassword(''); setNewPassword(''); setConfirm(''); setError(null); setSuccess(null) }}>
          Cancel
        </Button>
        <Button asChild variant="link"><Link href="/account/recovery">Forgot current password</Link></Button>
      </div>
    </div>
  )
}

function EmailChangePanel({ session }: { session: Session | null }) {
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const currentEmail = session?.user.email

  if (!session) return null

  async function changeEmail() {
    setError(null); setSuccess(null)
    if (!newEmail.trim() || !newEmail.includes('@')) { setError('Enter a valid email address.'); return }
    if (newEmail.trim().toLowerCase() === currentEmail?.toLowerCase()) { setError('That is already your current email.'); return }
    if (!currentPassword) { setError('Enter your current password first.'); return }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'EMAIL_CHANGE')
      const result = await invokeAccountFunction<{ currentEmailQueued?: boolean; newEmailQueued?: boolean }>('account-security-action', {
        action: 'start-email-change',
        reauthProof: proof.proof,
        newEmail: newEmail.trim(),
      })
      setSuccess(result.currentEmailQueued === false || result.newEmailQueued === false
        ? 'Email change started, but one confirmation email may be delayed. Check both inboxes before retrying.'
        : `Confirmation sent to ${newEmail.trim()} and ${currentEmail}. Click both links to complete the change.`)
      setNewEmail(''); setCurrentPassword(''); setShow(false)
    } catch (err) {
      setError(friendlyActionError(err, 'Email could not update. Confirm your current password and try again.'))
    } finally { setBusy(false) }
  }

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>Change email <ChevronRight /></Button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email address" />
        <Button onClick={changeEmail} disabled={busy}>
          {busy ? 'Sending...' : 'Send confirmation'}
        </Button>
        <Button variant="secondary" onClick={() => { setShow(false); setNewEmail(''); setCurrentPassword(''); setError(null) }}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-ink/44">Drapeon sends confirmation to both addresses. You must click both links.</p>
    </div>
  )
}

type WebNotificationPrefs = {
  orderUpdates: boolean
  messages: boolean
  quotes: boolean
  paymentConfirmations: boolean
  newOrders: boolean
  paymentReleased: boolean
  lowStockAlerts: boolean
  reviews: boolean
  platformUpdates: boolean
  promotions: boolean
}

const defaultWebNotificationPrefs: WebNotificationPrefs = {
  orderUpdates: true,
  messages: true,
  quotes: true,
  paymentConfirmations: true,
  newOrders: true,
  paymentReleased: true,
  lowStockAlerts: true,
  reviews: true,
  platformUpdates: false,
  promotions: false,
}

function boolPref(source: Record<string, unknown>, key: string) {
  return typeof source[key] === 'boolean' ? source[key] as boolean : undefined
}

function normalizeWebNotificationPrefs(metadata: Record<string, unknown> | null | undefined): WebNotificationPrefs {
  const canonical = metadata?.notif_prefs && typeof metadata.notif_prefs === 'object'
    ? metadata.notif_prefs as Record<string, unknown>
    : {}
  const legacy = metadata?.notification_prefs && typeof metadata.notification_prefs === 'object'
    ? metadata.notification_prefs as Record<string, unknown>
    : {}

  return {
    ...defaultWebNotificationPrefs,
    orderUpdates: boolPref(canonical, 'orderUpdates') ?? boolPref(legacy, 'email_order_updates') ?? defaultWebNotificationPrefs.orderUpdates,
    messages: boolPref(canonical, 'messages') ?? boolPref(legacy, 'email_messages') ?? defaultWebNotificationPrefs.messages,
    quotes: boolPref(canonical, 'quotes') ?? defaultWebNotificationPrefs.quotes,
    paymentConfirmations: boolPref(canonical, 'paymentConfirmations') ?? boolPref(legacy, 'email_payment') ?? defaultWebNotificationPrefs.paymentConfirmations,
    newOrders: boolPref(canonical, 'newOrders') ?? boolPref(legacy, 'email_order_updates') ?? defaultWebNotificationPrefs.newOrders,
    paymentReleased: boolPref(canonical, 'paymentReleased') ?? boolPref(legacy, 'email_payment') ?? defaultWebNotificationPrefs.paymentReleased,
    lowStockAlerts: boolPref(canonical, 'lowStockAlerts') ?? defaultWebNotificationPrefs.lowStockAlerts,
    reviews: boolPref(canonical, 'reviews') ?? defaultWebNotificationPrefs.reviews,
    platformUpdates: boolPref(canonical, 'platformUpdates') ?? boolPref(canonical, 'promotions') ?? boolPref(legacy, 'email_marketing') ?? defaultWebNotificationPrefs.platformUpdates,
    promotions: boolPref(canonical, 'promotions') ?? boolPref(canonical, 'platformUpdates') ?? boolPref(legacy, 'email_marketing') ?? defaultWebNotificationPrefs.promotions,
  }
}

function legacyNotificationPrefs(prefs: WebNotificationPrefs) {
  return {
    email_order_updates: prefs.orderUpdates || prefs.newOrders,
    email_messages: prefs.messages,
    email_payment: prefs.paymentConfirmations || prefs.paymentReleased,
    email_marketing: prefs.promotions || prefs.platformUpdates,
  }
}

function NotificationPrefsPanel({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  const [prefs, setPrefs] = useState<WebNotificationPrefs>(() => normalizeWebNotificationPrefs(session?.user.user_metadata))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null

  async function savePrefs() {
    setBusy(true); setError(null); setSuccess(null)
    try {
      const { error: updateError } = await createClient().auth.updateUser({
        data: {
          notif_prefs: prefs,
          notification_prefs: legacyNotificationPrefs(prefs),
        },
      })
      if (updateError) throw updateError
      setSuccess('Notification preferences saved.')
      onRefresh()
    } catch (err) {
      setError(friendlyActionError(err, 'Preferences could not save.'))
    } finally { setBusy(false) }
  }

  const toggles: Array<[keyof WebNotificationPrefs, string, string]> = [
    ['orderUpdates', 'Order updates', 'Stage changes, delivery, handoff readiness, and auto-release notices.'],
    ['messages', 'Messages and calls', 'New order messages, voice notes, photos, call activity, and consultations.'],
    ['quotes', 'Quotes', 'Quote sent, accepted, declined, or expired updates.'],
    ['paymentConfirmations', 'Customer payments', 'Checkout, refunds, receipts, and failed payment notices.'],
    ['newOrders', 'Tailor order requests', 'New custom briefs, ready-made orders, and customer requests.'],
    ['paymentReleased', 'Tailor earnings', 'Payout, release, and blocked payment notices.'],
    ['lowStockAlerts', 'Stock alerts', 'Low stock, sold out, and inventory notices.'],
    ['reviews', 'Reviews', 'Customer or tailor review activity.'],
    ['platformUpdates', 'Platform updates', 'Policy, feature, and operational announcements.'],
  ]

  return (
    <div className="grid gap-3">
      {toggles.map(([key, label, body]) => (
        <div key={key} className="flex items-start justify-between gap-4 rounded-[8px] border border-ui-border bg-ui-muted/45 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{label}</p>
            <p className="mt-0.5 text-xs text-ink/48">{body}</p>
          </div>
          <Switch checked={prefs[key]} onCheckedChange={(checked) => setPrefs((p) => ({ ...p, [key]: checked }))} aria-label={label} />
        </div>
      ))}
      <ActionNotice error={error} success={success} />
      <Button onClick={savePrefs} disabled={busy} className="w-fit">
        {busy ? 'Saving...' : 'Save preferences'}
      </Button>
    </div>
  )
}

function SessionPanel({ session }: { session: Session | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const lastSignIn = session?.user.last_sign_in_at

  if (!session) return null

  async function signOutOtherDevices() {
    setBusy(true); setError(null); setSuccess(null)
    try {
      const { error: err } = await createClient().auth.signOut({ scope: 'others' })
      if (err) throw err
      setSuccess('All other sessions ended. You remain signed in on this device.')
    } catch (err) {
      setError(friendlyActionError(err, 'Could not sign out other devices. Try again.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      {lastSignIn ? <p className="text-xs text-ink/44">Last sign-in: {formatRelative(lastSignIn)}</p> : null}
      <ActionNotice error={error} success={success} />
      <Button variant="outline" onClick={signOutOtherDevices} disabled={busy} className="w-fit border-rust/20 text-rust hover:bg-rust/5">
        {busy ? 'Signing out...' : 'Sign out all other devices'}
      </Button>
    </div>
  )
}

function AccountDeletionPanel({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null

  async function requestDeletion() {
    if (confirm.toLowerCase() !== 'delete') { setError('Type "delete" exactly to confirm.'); return }
    if (!currentPassword) { setError('Enter your current password first.'); return }
    setError(null); setSuccess(null); setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'ACCOUNT_DELETION')
      const result = await invokeAccountFunction<{
        alreadyPending?: boolean
        activeOrderCount?: number
        deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
      }>('request-account-deletion', {
        confirmationText: 'DELETE',
        reauthProof: proof.proof,
        reason: reason.trim() || undefined,
      })
      setSuccess(result.alreadyPending
        ? 'A deletion request is already pending for this account.'
        : result.activeOrderCount && result.activeOrderCount > 0
          ? `Deletion request submitted. Ops will review ${result.activeOrderCount} active order${result.activeOrderCount === 1 ? '' : 's'} before deletion proceeds.`
          : 'Deletion request submitted. Ops will confirm privacy review by email.')
      setConfirm('')
      setCurrentPassword('')
      setReason('')
      onRefresh()
    } catch (err) {
      setError(friendlyActionError(err, `Deletion request could not submit. Email ${CONTACTS.privacy} directly.`))
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-ink/50">
        This starts the guarded account deletion workflow. Active orders, disputes, payouts, or legal retention obligations must be resolved first. Type <span className="font-mono font-semibold text-rust">delete</span> and confirm your current password.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Optional note for privacy review"
        className="border-rust/20 focus:border-rust focus:ring-rust/10"
      />
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder='Type "delete" to confirm'
          className="border-rust/20 focus:border-rust focus:ring-rust/10"
        />
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="border-rust/20 focus:border-rust focus:ring-rust/10"
        />
        <Button
          onClick={requestDeletion}
          disabled={busy || confirm.toLowerCase() !== 'delete' || !currentPassword}
          variant="destructive"
        >
          {busy ? 'Submitting...' : 'Request deletion'}
        </Button>
      </div>
      <ActionNotice error={error} success={success} />
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader title={title} />
      <div className="divide-y divide-ui-border">
        {children}
      </div>
    </Surface>
  )
}

function SettingsRow({ label, sublabel, children }: { label: string; sublabel?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {sublabel ? <p className="mt-0.5 text-xs text-ink/48">{sublabel}</p> : null}
      </div>
      {children ? <div className="sm:text-right">{children}</div> : null}
    </div>
  )
}

function RenderSettings({ data, session, onRefresh }: { data: SettingsRenderData; session: Session | null; onRefresh: () => void }) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const displayName = safeEntityName(
    data.customerProfile?.display_name || data.tailorProfile?.business_name || data.tailorProfile?.display_name,
    'Drapeon member',
  )
  const currency =
    data.accountCurrency ||
    data.tailorProfile?.currency ||
    data.orderCurrencies[0] ||
    'USD'

  return (
    <div className="grid gap-5">
      {/* ── Profile ── */}
      <SettingsSection title="Profile">
        <div className="px-5 py-4">
          <AvatarUploadPanel data={data} session={session} onRefresh={onRefresh} />
        </div>
        <div className="px-5 py-4">
          <ProfileSettingsEditor
            key={`${data.customerProfile?.display_name ?? ''}:${data.tailorProfile?.display_name ?? ''}:${data.tailorProfile?.business_name ?? ''}:${data.accountCurrency ?? data.tailorProfile?.currency ?? ''}`}
            data={data}
            session={session}
            onRefresh={onRefresh}
          />
        </div>
        <SettingsRow
          label="Workspace"
          sublabel={role === 'TAILOR' ? 'Tailor workspace active. Customer tools remain available.' : 'Customer account active. Tailor access requires setup.'}
        >
          {role === 'TAILOR' ? (
            <Link href="/account/work" className="text-sm font-semibold text-needle">Open work queue →</Link>
          ) : (
            <Link href="/apply?source=account" className="text-sm font-semibold text-needle">Apply as a tailor →</Link>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* ── Security ── */}
      <SettingsSection title="Security">
        <SettingsRow
          label="Password"
          sublabel="Change the password used to sign in. You'll need to be signed in to update it."
        >
          <PasswordChangePanel session={session} />
        </SettingsRow>
        <SettingsRow
          label="Email address"
          sublabel={session?.user.email ?? 'Email unavailable'}
        >
          <EmailChangePanel session={session} />
        </SettingsRow>
        <SettingsRow
          label="Two-factor and OTP"
          sublabel="Phone OTP and SSO reauth are managed through the app or recovery flow."
        >
          <Link href="/account/recovery" className="text-sm font-semibold text-needle">
            Account recovery →
          </Link>
        </SettingsRow>
        <SettingsRow label="Active sessions">
          <SessionPanel session={session} />
        </SettingsRow>
      </SettingsSection>

      {/* ── Preferences ── */}
      <SettingsSection title="Preferences">
        <SettingsRow
          label="Currency"
          sublabel="Used for price display. Checkout still routes by order and provider."
        />
        <div className="px-5 pb-4">
          <NotificationPrefsPanel session={session} onRefresh={onRefresh} />
        </div>
      </SettingsSection>

      {/* ── Account & data ── */}
      <SettingsSection title="Account and data">
        <SettingsRow
          label="Privacy and data"
          sublabel="Measurements, order records, and messages are protected account data. Data access requests go to privacy@."
        >
          <a href={`mailto:${CONTACTS.privacy}?subject=Data access request`} className="text-sm font-semibold text-needle">
            {CONTACTS.privacy} →
          </a>
        </SettingsRow>
        <SettingsRow
          label="Payout setup"
          sublabel={role === 'TAILOR' ? 'Stripe Connect and Paystack automated payout routes.' : 'Payout setup is for tailor accounts.'}
        >
          {role === 'TAILOR' ? (
            <Link href="/account/payout" className="text-sm font-semibold text-needle">Payout setup →</Link>
          ) : null}
        </SettingsRow>
        <div className="border-t border-rust/8 bg-rust/4 px-5 py-4">
          <p className="mb-3 text-sm font-semibold text-rust">Delete account</p>
          <AccountDeletionPanel session={session} onRefresh={onRefresh} />
        </div>
      </SettingsSection>
    </div>
  )
}

function RenderSupport({ data, onRefresh }: { data: SupportRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order)).slice(0, 5)

  const issueRoutes: Array<[string, string, string]> = isTailor
    ? [
        ['Payout or earnings issue', CONTACTS.payouts, 'Tailor payout help'],
        ['Order or customer dispute', CONTACTS.support, 'Order dispute help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Platform or listing question', CONTACTS.support, 'Platform help'],
      ]
    : [
        ['Payment issue', CONTACTS.support, 'Payment help'],
        ['Fit issue', CONTACTS.support, 'Fit help'],
        ['Delivery or handoff issue', CONTACTS.support, 'Delivery help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Tailor payout or setup issue', CONTACTS.payouts, 'Tailor payout help'],
      ]

  const tailorFaqItems: Array<[string, string]> = [
    ['How do I respond to a custom order brief?', 'Go to Orders and open the brief. Tap "Send quote" to enter your price, estimated completion date, and a note. You can also request a consultation before quoting. Respond within 48 hours — customers see a response timer on their end.'],
    ['How does payout work?', 'Earnings are released after the customer confirms delivery or 7 days after dispatch if they do not respond. Funds route to your Stripe or Paystack account automatically. Manual bank routes require an ops handoff — email payouts@drapeon.co to initiate.'],
    ['Why is my payout showing "blocked"?', 'Blocked payouts are held pending dispute resolution, identity checks, or a missing reverification step. Go to Payout to check the status. If the block is unclear, email payouts@drapeon.co with your order reference.'],
    ['How do I change my availability?', 'Go to Profile, open Selling setup, and use "Edit setup on web." Availability can be set to Open, Limited, or Fully booked, and changes affect how you appear in customer search.'],
    ['How do I mark an order as dispatched?', 'Open the order in Orders, scroll to the Actions section, and select the dispatch stage. You will need to enter a fulfillment method and optionally a tracking number. Collection and self-delivery orders use different stage flows.'],
    ['How do I handle a scope change from a customer?', 'Customers can request scope changes on active briefs. Go to the order in Orders — an action card will appear asking you to approve or decline the change. You can adjust the price and timeline before accepting.'],
    ['Why is my account or listing restricted?', 'Restrictions are triggered by unresolved disputes, payment failures, or identity verification requirements. Open a support request using "Account or security issue" below and ops will review within 1 business day.'],
  ]

  const customerFaqItems: Array<[string, string]> = [
    ['How do I cancel an order?', 'Orders can be cancelled from the order detail page before production begins. Once a tailor has confirmed and started production, cancellation requires ops review. Open a support request with the order attached and select "Payment issue" as the category.'],
    ['When will I get my refund?', 'Refunds are processed within 3–7 business days after an order is cancelled or a dispute is resolved in your favour. Payout timing depends on your bank or card provider. Open a support request if a refund has not appeared after 10 days.'],
    ['How do I change my delivery address?', 'Delivery address changes must happen before a tailor marks the order dispatched. Open the order in Messages and ask the tailor directly, or open a support request so ops can update it.'],
    ['My item arrived with a fit issue — what do I do?', 'Message the tailor through the order thread first. Most fit issues are resolved with a free alteration. If the tailor is unresponsive, open a support request with "Fit or alteration issue" and attach the order. Drapeon ops will step in.'],
    ['How do I set up payout as a tailor?', 'Go to Payout in the account navigation. Stripe Connect handles GBP, USD, EUR, and CAD. Paystack handles NGN, GHS, and KES. Manual bank entry requires ops verification — email payouts@drapeon.co if your bank is not listed.'],
    ['Why is my account restricted?', 'Accounts can be restricted for unresolved disputes, payment failures, or identity verification requirements. Open a support request with "Account or security issue" and ops will review within 1 business day.'],
    ['How do I update my measurements?', 'Use Measurements on web to add or edit manual profiles and custom tape points. Drapeon Vision body scans still run in the mobile app.'],
  ]

  const faqItems = isTailor ? tailorFaqItems : customerFaqItems

  return (
    <div className="grid gap-5">
      {/* ── FAQ ── */}
      <Surface className="overflow-hidden">
        <SurfaceHeader title="Common questions" description="Operational answers for orders, payment, fulfillment, and account access." />
        {faqItems.map(([question, answer], index) => (
          <details key={question} className={`group ${index > 0 ? 'border-t border-ink/6' : ''}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
              <span className="text-sm font-semibold text-ink">{question}</span>
              <ChevronDown className="size-4 shrink-0 text-ink/36 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink/6 bg-bone/40 px-5 py-4">
              <p className="text-sm leading-6 text-ink/62">{answer}</p>
            </div>
          </details>
        ))}
      </Surface>

      {/* ── Support request form ── */}
      <GeneralSupportForm data={data} onRefresh={onRefresh} />

      {/* ── Handoff help (only when active orders exist) ── */}
      <SupportIssueForm data={data} onRefresh={onRefresh} />

      {/* ── Order-aware help ── */}
      {activeOrders.length > 0 ? (
        <Surface className="overflow-hidden">
          <SurfaceHeader title="Your active orders" description="Select an order to get help specific to its payment, stage, or delivery." />
          {activeOrders.map((order, index) => (
            <div key={order.id} className={`flex items-center gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <StagePill stage={order.stage} />
                  <span className="text-xs text-ink/46">{partyName(order, data.userId)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm"><Link href={accountRoute(`/account/orders/${order.id}`)}>View order</Link></Button>
                <Button asChild size="sm"><a href={mailto(CONTACTS.support, `Help with order: ${order.reference ?? order.id}`)}>Email support</a></Button>
                <a
                  href={buildWhatsAppSupportUrl(`Hi Drapeon, I need help with order ${order.reference ?? order.id}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center rounded-[8px] border border-needle/15 bg-white px-3 text-xs font-semibold text-needle"
                >
                  WhatsApp
                </a>
              </div>
            </div>
          ))}
        </Surface>
      ) : null}

      {/* ── Direct contact routes ── */}
      <Surface className="overflow-hidden">
        <SurfaceHeader title="Direct contacts" description="Route the issue to the right support inbox." />
        <a
          href={buildWhatsAppSupportUrl(isTailor ? 'Hi Drapeon, I need tailor support.' : 'Hi Drapeon, I need customer support.')}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 px-5 py-4 transition hover:bg-ink/3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">WhatsApp support</p>
            <p className="mt-0.5 text-xs font-semibold text-needle">Message Drapeon directly</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-ui-subtle" />
        </a>
        {issueRoutes.map(([title, email, subject]) => (
          <a key={title} href={mailto(email, subject)} className="flex items-center gap-4 border-t border-ink/6 px-5 py-4 transition hover:bg-ink/3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-xs font-semibold text-needle">{email}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-ui-subtle" />
          </a>
        ))}
        <div className="border-t border-ink/6 px-5 py-4">
          <p className="text-xs text-ink/44">Response within 1 business day for most issues. Active order disputes are reviewed within 4 hours.</p>
        </div>
      </Surface>
    </div>
  )
}

function RenderTailorDetail({ data, onRefresh }: { data: TailorDetailSurfaceData; onRefresh: () => void }) {
  const account = useAccountContext()
  const tailor = data.tailor
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [reviewPreviewMedia, setReviewPreviewMedia] = useState<string | null>(null)

  if (!tailor) {
    return (
      <EmptyState
        title="Tailor profile not available."
        body="This profile may be hidden, may belong to another account context, or may still be loading."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }
  const profileMedia = tailorProfileMedia(tailor)
  const readyMade = data.readyMade.filter((item) => (
    account.userId === tailor.user_id || isReadyMadeBuyableOnWeb(item, tailor)
  ))
  const isSaved = savedOverride ?? data.isSaved
  const canRequestCustomOrder = canStartCustomBriefOnWeb(tailor, account.userId)

  async function toggleSaved() {
    if (!tailor || busy) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      try {
        await invokeAccountFunction('saved-tailor-action', {
          action: isSaved ? 'unsave-by-profile' : 'save-tailor',
          tailorProfileId: tailor.id,
        })
      } catch {
        if (isSaved) {
          await removeSavedTailorDirectly(account.userId, tailor.id)
        } else {
          await saveTailorDirectly(account.userId, tailor.id)
        }
      }
      setSavedOverride(!isSaved)
      setSuccess(isSaved ? 'Removed from saved.' : 'Saved to your wishlist.')
      onRefresh()
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Wishlist could not update. Refresh and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const specialties = stringList(tailor.specialty_tags)
  const languages = stringList(tailor.languages)
  const heroStars = Math.round(Number(tailor.avg_rating ?? 0))

  return (
    <div className="grid gap-5">
      {/* Immersive hero card */}
      <Surface className="overflow-hidden">
        <div className="relative h-52 bg-bone sm:h-64 md:h-80">
          {profileMedia[0] && isVideoMediaUrl(profileMedia[0]) ? (
            <MutedVideo
              src={profileMedia[0]}
              className="h-full w-full object-cover"
              ariaLabel="Tailor cover"
              autoPlay={true}
              showMuteToggle
            />
          ) : profileMedia[0] ? (
            <Image src={profileMedia[0]} alt="Tailor cover" fill sizes="100vw" className="object-cover object-top" unoptimized />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{cleanLabel(tailor.tier, 'Tailor')}</p>
                <h2 className="mt-1 truncate text-2xl font-semibold text-white sm:text-3xl" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}>{safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                  {tailor.location ? <span>{tailor.location}</span> : null}
                  {tailor.avg_rating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-300 leading-none">{'★'.repeat(heroStars)}{'☆'.repeat(5 - heroStars)}</span>
                      <span>{Number(tailor.avg_rating).toFixed(1)} ({tailor.total_reviews ?? 0})</span>
                    </span>
                  ) : null}
                </div>
              </div>
              {tailor.is_verified ? (
                <StatusChip status="VERIFIED" className="shadow-sm" />
              ) : null}
            </div>
          </div>
        </div>

        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">{safeUserText(tailor.bio, 'Portfolio, fit guidance, and order context stay connected through Drapeon.')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{priceRange(tailor)}</span>
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{fulfillmentSummary(tailor)}</span>
            {tailor.supports_custom_orders ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">Custom orders</span>
            ) : null}
            {tailor.supports_ready_made ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">Ready-made</span>
            ) : null}
          </div>

          <ActionNotice error={error} success={success} />

          <div className="mt-5 flex flex-wrap gap-3">
            {canRequestCustomOrder ? (
              <Button asChild><Link href={accountRoute(`/account/brief/${tailor.id}`)}>Request custom order</Link></Button>
            ) : tailor.supports_custom_orders ? (
              <button type="button" disabled className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-ink/10 px-5 py-3 text-sm font-semibold text-ink/48">
                {customBriefUnavailableLabel(tailor, account.userId)}
              </button>
            ) : null}
            <Button
              type="button"
              onClick={() => { void toggleSaved() }}
              disabled={busy}
              variant={isSaved ? 'destructive' : 'secondary'}
            >
              {busy ? 'Updating...' : isSaved ? 'Remove from saved' : 'Save tailor'}
            </Button>
            <OpenAppButton label="Open in app" className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink" />
          </div>
        </div>
      </Surface>

      {/* Portfolio strip */}
      {profileMedia.length > 1 ? (
        <Surface className="overflow-hidden">
          <SurfaceHeader title="Portfolio" description="Open any image or video for a closer review." />
          <div className="flex gap-3 overflow-x-auto px-6 pb-5 pt-3">
            {profileMedia.slice(1).map((src, i) => (
              <MediaViewerDialog key={src} src={src} kind={isVideoMediaUrl(src) ? 'video' : 'image'} title={`Portfolio ${i + 2}`}>
                <button type="button" className="relative h-36 w-36 shrink-0 cursor-zoom-in overflow-hidden rounded-[8px] bg-bone text-left">
                  {isVideoMediaUrl(src) ? (
                    <MutedVideo
                      src={src}
                      className="h-full w-full object-cover"
                      ariaLabel={`Portfolio ${i + 2}`}
                      showMuteToggle={false}
                    />
                  ) : (
                    <Image src={src} alt={`Portfolio ${i + 2}`} fill sizes="144px" className="object-cover object-top" unoptimized />
                  )}
                </button>
              </MediaViewerDialog>
            ))}
          </div>
        </Surface>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Craft profile */}
        <Surface className="overflow-hidden">
          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Craft profile</p>
            {specialties.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {specialties.map((s) => (
                    <span key={s} className="rounded-full bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">{s}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink/44">Specialties not listed yet.</p>
            )}
            {languages.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Languages</p>
                <div className="flex flex-wrap gap-2">
                  {languages.map((l) => (
                    <span key={l} className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/66">{l}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Surface>

        {/* Reviews */}
        <Surface className="overflow-hidden">
          <div className="p-6 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Reviews</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {Number(tailor.avg_rating ?? 0).toFixed(1)}
              <span className="ml-2 text-sm font-normal text-ink/44">({tailor.total_reviews ?? 0} reviews)</span>
            </p>
          </div>
          {data.tailorReviews.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-ink/44">Public reviews will appear here after completed Drapeon orders.</p>
          ) : (
            <div className="divide-y divide-ink/6 max-h-[420px] overflow-y-auto">
              {data.tailorReviews.map((review) => {
                const reviewStars = Math.round(Number(review.rating ?? 0))
                const reviewMediaUrls = stringList(review.media_urls)
                  .map((src) => safeMediaUrl(src, 'review-media'))
                  .filter((src): src is string => Boolean(src))
                return (
                  <div key={review.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-base leading-none text-amber-400">{'★'.repeat(reviewStars)}{'☆'.repeat(5 - reviewStars)}</span>
                          <span className="text-xs font-semibold text-ink/44">{Number(review.rating ?? 0).toFixed(1)}</span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-ink">{safeEntityName(review.reviewer_name, 'Customer')}</p>
                      </div>
                      <p className="shrink-0 text-xs text-ink/38">{formatRelative(review.created_at ?? review.published_at)}</p>
                    </div>
                    {stringList(review.tags).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {stringList(review.tags).map((tag) => (
                          <span key={tag} className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {review.body ? <p className="mt-2 text-sm leading-6 text-ink/62">{safeUserText(review.body)}</p> : null}
                    {reviewMediaUrls.length > 0 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        {reviewMediaUrls.map((src, index) => (
                          <button
                            key={src}
                            type="button"
                            onClick={() => setReviewPreviewMedia(src)}
                            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[8px] bg-ink/8 text-left"
                            aria-label={`Open review media ${index + 1}`}
                          >
                            {isVideoMediaUrl(src) ? (
                              <MutedVideo src={src} className="h-full w-full object-cover" ariaLabel="Review video preview" showMuteToggle={false} />
                            ) : (
                              <img src={src} alt="Review attachment" className="h-full w-full object-cover" />
                            )}
                            {isVideoMediaUrl(src) ? (
                              <span className="absolute bottom-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.62rem] font-bold text-white">▶</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {review.tailor_response ? (
                      <div className="mt-3 rounded-[8px] bg-needle/4 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-needle/70">Tailor response</p>
                        <p className="mt-1 text-sm leading-6 text-ink/66">{safeUserText(review.tailor_response)}</p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Surface>
      </div>

      {/* Ready-made from this tailor */}
      {readyMade.length > 0 ? (
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Ready-made from this tailor</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {readyMade.map((item) => (
              <Link
                key={item.id}
                href={accountRoute(`/account/items/${item.id}`)}
                className="group overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
              >
                <div className="relative aspect-[4/3] bg-bone">
                  {itemPhoto(item) ? (
                    <Image src={itemPhoto(item)!} alt={safeUserText(item.title, 'Ready-made item')} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover transition group-hover:scale-[1.03]" unoptimized />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <p className="text-sm font-semibold leading-snug text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{safeUserText(item.title, 'Ready-made item')}</p>
                    <p className="mt-0.5 text-xs font-semibold text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{formatMoney(item.price_amount, item.currency)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {reviewPreviewMedia ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/82 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button
            type="button"
            onClick={() => setReviewPreviewMedia(null)}
            className="absolute right-4 top-4 rounded-full bg-white/92 px-4 py-2 text-sm font-semibold text-ink shadow-lg"
          >
            Close
          </button>
          <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-[8px] bg-black shadow-2xl">
            {isVideoMediaUrl(reviewPreviewMedia) ? (
              <MutedVideo src={reviewPreviewMedia} className="max-h-[82vh] w-full object-contain" ariaLabel="Review video" autoPlay={true} controls={true} showMuteToggle />
            ) : (
              <img src={reviewPreviewMedia} alt="Review attachment preview" className="max-h-[82vh] w-full object-contain" />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RenderItemDetail({ data, onRefresh }: { data: ItemDetailRenderData; onRefresh: () => void }) {
  const router = useRouter()
  const item = data.item
  const [inquiryBusy, setInquiryBusy] = useState(false)
  const [inquiryError, setInquiryError] = useState<string | null>(null)
  const [inquirySuccess, setInquirySuccess] = useState<string | null>(null)
  if (!item) {
    return (
      <EmptyState
        title="Ready-made item not available."
        body="This item may be sold out, hidden, or still loading. Return to Marketplace to browse available pieces."
        action={<Link href="/account/shop" className="font-semibold text-needle">Back to Marketplace</Link>}
      />
    )
  }
  const readyMadeItemId = item.id
  const tailor = firstJoinedRow(item.tailor_profiles)
  const gallery = stringList(item.photo_urls)
    .map((src) => safeMediaUrl(src, 'seller-item-media'))
    .filter((src): src is string => !!src)
  const heroMedia = gallery[0] ?? null
  const itemInventoryQuantity = readyMadeInventoryCount(item)
  const canUseReadyMadeItemActions = Boolean(data.userId && data.tailorProfile?.id !== item.tailor_profile_id && item.is_live)
  const itemIsBuyable = isReadyMadeBuyableOnWeb(item, tailor)
  const canStartWebCheckout = canUseReadyMadeItemActions && itemIsBuyable
  const canAskSeller = canStartWebCheckout
  const checkoutCtaLabel = itemInventoryQuantity === 1 ? 'Buy last one' : 'Start web checkout'
  const checkoutUnavailableLabel = readyMadeUnavailableLabel(item, tailor)

  const sizes = stringList(item.sizes)
  const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars') ?? null

  async function startReadyMadeInquiry() {
    if (!canAskSeller || inquiryBusy) return
    setInquiryError(null)
    setInquirySuccess(null)
    setInquiryBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'start-inquiry',
        sellerItemId: readyMadeItemId,
      })
      onRefresh()
      if (result.orderId) {
        setInquirySuccess('Opening the protected seller thread.')
        router.push(accountRoute(`/account/messages?orderId=${encodeURIComponent(result.orderId)}`))
        return
      }
      setInquirySuccess('Inquiry started. Open Messages to continue.')
    } catch (inquiryError) {
      setInquiryError(friendlyActionError(inquiryError, 'Could not start this seller conversation.'))
    } finally {
      setInquiryBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
        {/* Hero card */}
      <Surface className="overflow-hidden">
        <div className="relative h-52 bg-bone sm:h-64 md:aspect-[16/9] md:h-auto">
          {heroMedia && isVideoMediaUrl(heroMedia) ? (
            <MutedVideo
              src={heroMedia}
              className="h-full w-full object-cover"
              ariaLabel={safeUserText(item.title, 'Ready-made item')}
              showMuteToggle
            />
          ) : heroMedia ? (
            <Image src={heroMedia} alt={safeUserText(item.title, 'Ready-made item')} fill sizes="100vw" className="object-cover" unoptimized />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{safeUserText(item.category, 'Ready-made')}</p>
            <h2 className="mt-1 text-2xl font-semibold text-white sm:text-3xl" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}>{safeUserText(item.title, 'Ready-made item')}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
              <span className="text-xl font-semibold text-white sm:text-2xl">{formatMoney(item.price_amount, item.currency)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.4)] ${item.is_live ? 'bg-emerald-500/30 text-emerald-100' : 'bg-white/15 text-white/60'}`}>
                {stockCopy(item)}
              </span>
            </div>
          </div>
        </div>

        {/* Gallery strip */}
        {gallery.length > 1 ? (
          <div className="flex gap-3 overflow-x-auto bg-bone/40 px-6 py-4">
            {gallery.slice(1).map((src, i) => (
              <MediaViewerDialog key={src} src={src} kind={isVideoMediaUrl(src) ? 'video' : 'image'} title={`${safeUserText(item.title, 'Item')} media ${i + 2}`}>
                <button type="button" className="relative h-20 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-[8px] bg-bone text-left">
                  {isVideoMediaUrl(src) ? (
                    <MutedVideo
                      src={src}
                      className="h-full w-full object-cover"
                      ariaLabel={`Item video ${i + 2}`}
                      showMuteToggle={false}
                    />
                  ) : (
                    <Image src={src} alt={`Item image ${i + 2}`} fill sizes="80px" className="object-cover" unoptimized />
                  )}
                </button>
              </MediaViewerDialog>
            ))}
          </div>
        ) : null}

        {/* Info body */}
        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">{safeUserText(item.description, 'Review size, stock, fulfillment, and checkout before purchase.')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">{fulfillmentSummary(item)}</span>
            {sizes.map((s) => (
              <span key={s} className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">{s}</span>
            ))}
            {sizes.length === 0 ? (
              <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/44">Confirm sizes in app</span>
            ) : null}
          </div>

          <ActionNotice error={inquiryError} success={inquirySuccess} />

          <div className="mt-6 flex flex-wrap gap-3">
            {canStartWebCheckout ? (
              <a href="#ready-made-checkout" className="inline-flex items-center justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">
                {checkoutCtaLabel}
              </a>
            ) : canUseReadyMadeItemActions ? (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-ink/10 px-5 py-3 text-sm font-semibold text-ink/48"
              >
                {checkoutUnavailableLabel}
              </button>
            ) : (
              <OpenAppButton label="Open in app" />
            )}
            {canAskSeller ? (
              <button
                type="button"
                onClick={() => { void startReadyMadeInquiry() }}
                disabled={inquiryBusy}
                className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
              >
                {inquiryBusy ? 'Opening thread...' : 'Ask seller'}
              </button>
            ) : null}
            {item.tailor_profile_id ? (
              <Link href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)} className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink">
                View tailor
              </Link>
            ) : null}
            {canStartWebCheckout ? (
              <OpenAppButton label="Open in app" className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink" />
            ) : null}
          </div>
        </div>
      </Surface>

      {canStartWebCheckout ? (
        <ReadyMadeCheckoutForm item={item} data={data} onRefresh={onRefresh} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        {/* Tailor mini-card */}
        <div className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
          <div className="relative h-24 bg-needle/8">
            {tailorAvatarSrc ? (
              <Image src={tailorAvatarSrc} alt="Tailor" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" unoptimized />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 to-transparent" />
          </div>
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Tailor</p>
            <p className="mt-1.5 text-xl font-semibold text-ink">{safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}</p>
            {tailor?.location ? <p className="mt-0.5 text-xs text-ink/44">{tailor.location}</p> : null}
            {item.tailor_profile_id ? (
              <Link
                href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
              >
                View profile
              </Link>
            ) : null}
          </div>
        </div>

        {/* Fit guidance */}
        <div className="rounded-[8px] border border-ink/8 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Fit guidance</p>
          <p className="mt-3 text-sm leading-7 text-ink/66">{sizeGuideSummary(item.size_guide, stringList(item.sizes))}</p>
          <p className="mt-4 rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            Checkout keeps payment state, fulfillment, and order handoff together. Native push and camera-guided proof are available in the app when needed.
          </p>
        </div>
      </section>
    </div>
  )
}

export function AccountAppSurface({
  surface,
  orderId,
  tailorId,
  itemId,
}: {
  surface: AccountSurface
  orderId?: string
  tailorId?: string
  itemId?: string
}): React.JSX.Element {
  const [cachedSnapshot] = useState(readCachedShellSnapshot)
  const [session, setSession] = useState<Session | null>(cachedSnapshot?.session ?? null)
  const [data, setData] = useState<AccountBaseData>(cachedSnapshot ? accountDataFromShell(cachedSnapshot.shellData) : emptyData)
  const [shellData, setShellData] = useState<AccountShellData>(cachedSnapshot?.shellData ?? emptyShellData)
  const [measurementsData, setMeasurementsData] = useState<MeasurementsSurfaceData>(emptyMeasurementsSurfaceData)
  const [exploreData, setExploreData] = useState<ExploreSurfaceData>(emptyExploreSurfaceData)
  const [ordersData, setOrdersData] = useState<OrdersSurfaceData>(emptyOrdersSurfaceData)
  const [orderDetailData, setOrderDetailData] = useState<OrderDetailSurfaceData>(emptyOrderDetailSurfaceData)
  const [supportData, setSupportData] = useState<SupportSurfaceData>(emptySupportSurfaceData)
  const [shopData, setShopData] = useState<ShopSurfaceData>(emptyShopSurfaceData)
  const [workData, setWorkData] = useState<WorkSurfaceData>(emptyWorkSurfaceData)
  const [briefData, setBriefData] = useState<BriefSurfaceData>(emptyBriefSurfaceData)
  const [messagesData, setMessagesData] = useState<MessagesSurfaceData>(emptyMessagesSurfaceData)
  const [savedData, setSavedData] = useState<SavedSurfaceData>(emptySavedSurfaceData)
  const [checkoutData, setCheckoutData] = useState<CheckoutSurfaceData>(emptyCheckoutSurfaceData)
  const [earningsData, setEarningsData] = useState<EarningsSurfaceData>(emptyEarningsSurfaceData)
  const [profileData, setProfileData] = useState<ProfileSurfaceData>(emptyProfileSurfaceData)
  const [settingsData, setSettingsData] = useState<SettingsSurfaceData>(emptySettingsSurfaceData)
  const [tailorDetailData, setTailorDetailData] = useState<TailorDetailSurfaceData>(emptyTailorDetailSurfaceData)
  const [itemDetailData, setItemDetailData] = useState<ItemDetailSurfaceData>(emptyItemDetailSurfaceData)
  const [loading, setLoading] = useState(!cachedSnapshot)
  const [reloadKey, setReloadKey] = useState(0)
  const [orderNotificationPermission, setOrderNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => currentNotificationPermission())
  const orderNotificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const orderRealtimeNoticeKeysRef = useRef<Set<string>>(new Set())
  const accountWebPushRegistrationRef = useRef(false)
  const accountUserId = session?.user.id ?? null
  const orderRealtimeIdsKey = useMemo(() => {
    if (surface === 'order-detail') {
      return uniqueRealtimeOrderIds([orderId, orderDetailData.order?.id]).join(',')
    }
    if (surface === 'orders') {
      return uniqueRealtimeOrderIds(ordersData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'work') {
      return uniqueRealtimeOrderIds(workData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'checkout') {
      return uniqueRealtimeOrderIds([orderId, ...checkoutData.orders.map((order) => order.id)]).join(',')
    }
    return ''
  }, [checkoutData.orders, orderDetailData.order?.id, orderId, ordersData.orders, surface, workData.orders])
  const realtimeOrdersById = useMemo(() => {
    const orders = [
      ...ordersData.orders,
      ...workData.orders,
      ...checkoutData.orders,
      ...(orderDetailData.order ? [orderDetailData.order] : []),
    ]
    return new Map(orders.map((order) => [order.id, order]))
  }, [checkoutData.orders, orderDetailData.order, ordersData.orders, workData.orders])

  useSessionTimeout({ enabled: Boolean(accountUserId) })

  useEffect(() => {
    orderNotificationPermissionRef.current = orderNotificationPermission
  }, [orderNotificationPermission])

  const saveAccountWebPushSubscription = useCallback(async () => {
    if (!accountUserId) return
    const registration = await registerWebPushSubscription('/account')
    if (!registration.ok) {
      if (registration.reason !== 'not-configured') {
        console.warn('[web push] Account subscription not registered.', registration.reason)
      }
      return
    }

    const { endpoint, keys } = registration.subscription
    const { error } = await createClient()
      .from('web_push_subscriptions')
      .upsert(
        {
          audience: 'ACCOUNT',
          user_id: accountUserId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: window.navigator.userAgent,
          enabled: true,
          last_seen_at: new Date().toISOString(),
          failed_at: null,
          failure_reason: null,
        },
        { onConflict: 'endpoint' },
      )
      .select('id')
      .maybeSingle()

  if (error) {
      console.warn('[web push] Account subscription could not be saved.', error.message)
    }
  }, [accountUserId])

  async function requestOrderNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setOrderNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setOrderNotificationPermission(permission)
    if (permission !== 'granted') return
    accountWebPushRegistrationRef.current = true
    await saveAccountWebPushSubscription()
  }

  useEffect(() => {
    if (
      !accountUserId ||
      !ORDER_REALTIME_SURFACES.has(surface) ||
      orderNotificationPermission !== 'granted' ||
      accountWebPushRegistrationRef.current
    ) {
      return
    }

    accountWebPushRegistrationRef.current = true
    void saveAccountWebPushSubscription()
  }, [accountUserId, orderNotificationPermission, saveAccountWebPushSubscription, surface])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return
      _lastKnownSession = sessionData.session
      setSession(sessionData.session)
      if (!sessionData.session?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setMeasurementsData(emptyMeasurementsSurfaceData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setBriefData(emptyBriefSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setTailorDetailData(emptyTailorDetailSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setMeasurementsData(emptyMeasurementsSurfaceData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setBriefData(emptyBriefSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setTailorDetailData(emptyTailorDetailSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id || !ORDER_REALTIME_SURFACES.has(surface)) return
    const watchedOrderIds = orderRealtimeIdsKey ? orderRealtimeIdsKey.split(',') : []
    if (surface === 'order-detail' && watchedOrderIds.length === 0) return

    const userId = session.user.id
    const tailorProfileId = shellData.tailorProfile?.id ?? data.tailorProfile?.id ?? null
    const watchCustomerOrders = surface === 'orders' || surface === 'checkout'
    const watchTailorOrders = surface === 'orders' || surface === 'work'
    const supabase = createClient()
    const channel = supabase.channel(`account-order-sync:${surface}:${userId}:${orderRealtimeIdsKey || 'all'}`)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRealtimeRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        setReloadKey((current) => current + 1)
      }, 350)
    }

    const maybeNotify = (table: string, event: string, payload: unknown) => {
      if (
        typeof window === 'undefined' ||
        orderNotificationPermissionRef.current !== 'granted' ||
        document.visibilityState === 'visible'
      ) {
        return
      }
      const notice = buildAccountRealtimeNotice({
        table,
        event,
        payload,
        ordersById: realtimeOrdersById,
        userId,
      })
      if (!notice || orderRealtimeNoticeKeysRef.current.has(notice.key)) return
      orderRealtimeNoticeKeysRef.current.add(notice.key)
      const desktopNotice = new Notification(notice.title, {
        body: notice.body,
        icon: '/icon-192.png',
        tag: notice.key,
      })
      desktopNotice.onclick = () => {
        window.focus()
        if (notice.orderId) window.location.href = `/account/orders/${notice.orderId}`
      }
    }

    const watchTableFilter = (table: string, filter: string) => {
      for (const event of ORDER_REALTIME_ROW_EVENTS) {
        channel.on('postgres_changes', { event, schema: 'public', table, filter }, (payload) => {
          maybeNotify(table, event, payload)
          scheduleRealtimeRefresh()
        })
      }
    }

    if (surface === 'order-detail') {
      for (const id of watchedOrderIds) {
        watchTableFilter('orders', `id=eq.${id}`)
      }
    } else {
      if (watchCustomerOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `customer_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `tailor_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(tailorProfileId)) {
        watchTableFilter('orders', `tailor_profile_id=eq.${tailorProfileId}`)
      }
    }

    for (const id of watchedOrderIds) {
      const childTables = surface === 'order-detail'
        ? ORDER_REALTIME_CHILD_TABLES
        : surface === 'checkout'
          ? (['order_payments'] as const)
          : []
      for (const table of childTables) {
        watchTableFilter(table, `order_id=eq.${id}`)
      }
    }

    channel.subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [data.tailorProfile?.id, orderRealtimeIdsKey, realtimeOrdersById, session?.user.id, shellData.tailorProfile?.id, surface])

  useEffect(() => {
    if (!session?.user.id) return
    const userId = session.user.id
    const supabase = createClient()
    const channel = supabase.channel(`account-verification-review-sync:${userId}`)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleReviewRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        setReloadKey((current) => current + 1)
      }, 350)
    }

    for (const table of ['profile_change_requests', 'payout_change_requests'] as const) {
      for (const event of ORDER_REALTIME_ROW_EVENTS) {
        channel.on('postgres_changes', { event, schema: 'public', table, filter: `tailor_user_id=eq.${userId}` }, scheduleReviewRefresh)
      }
    }

    channel.subscribe()
    const poll = window.setInterval(scheduleReviewRefresh, 15000)

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [session?.user.id])

  useEffect(() => {
    if (!session?.user.id) return
    const currentUserId = session.user.id
    let active = true

    async function loadSurfaceData() {
      const userId = currentUserId
      if (surface === 'measurements') {
        const [nextShellData, nextMeasurementsData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchMeasurementsSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setMeasurementsData(nextMeasurementsData)
        setData(accountDataFromShell(nextShellData, nextMeasurementsData.warning))
        return
      }
      if (surface === 'explore') {
        const [nextShellData, nextExploreData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchExploreSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setExploreData(nextExploreData)
        setData(accountDataFromShell(nextShellData, nextExploreData.warning))
        return
      }
      if (surface === 'orders') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrdersData = await fetchOrdersSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setOrdersData(nextOrdersData)
        setData(accountDataFromShell(nextShellData, nextOrdersData.warning))
        return
      }
      if (surface === 'order-detail') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrderDetailData = await fetchOrderDetailSurfaceData(userId, orderId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setOrderDetailData(nextOrderDetailData)
        setData(accountDataFromShell(nextShellData, nextOrderDetailData.warning))
        return
      }
      if (surface === 'messages') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextMessagesData = await fetchMessagesSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setMessagesData(nextMessagesData)
        setData(accountDataFromShell(nextShellData, nextMessagesData.warning))
        return
      }
      if (surface === 'payout') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        if (!active) return
        setShellData(nextShellData)
        setData(accountDataFromShell(nextShellData))
        return
      }
      if (surface === 'support') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSupportData = await fetchSupportSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setSupportData(nextSupportData)
        setData(accountDataFromShell(nextShellData, nextSupportData.warning))
        return
      }
      if (surface === 'shop') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextShopData = await fetchShopSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setShopData(nextShopData)
        setData(accountDataFromShell(nextShellData, nextShopData.warning))
        return
      }
      if (surface === 'work') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextWorkData = await fetchWorkSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setWorkData(nextWorkData)
        setData(accountDataFromShell(nextShellData, nextWorkData.warning))
        return
      }
      if (surface === 'brief') {
        const [nextShellData, nextBriefData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchBriefSurfaceData(userId, tailorId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setBriefData(nextBriefData)
        setData(accountDataFromShell(nextShellData, nextBriefData.warning))
        return
      }
      if (surface === 'saved') {
        const [nextShellData, nextSavedData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchSavedSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setSavedData(nextSavedData)
        setData(accountDataFromShell(nextShellData, nextSavedData.warning))
        return
      }
      if (surface === 'checkout') {
        const [nextShellData, nextCheckoutData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchCheckoutSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setCheckoutData(nextCheckoutData)
        setData(accountDataFromShell(nextShellData, nextCheckoutData.warning))
        return
      }
      if (surface === 'earnings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextEarningsData = await fetchEarningsSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setEarningsData(nextEarningsData)
        setData(accountDataFromShell(nextShellData, nextEarningsData.warning))
        return
      }
      if (surface === 'profile') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextProfileData = await fetchProfileSurfaceData(nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setProfileData(nextProfileData)
        setData(accountDataFromShell(nextShellData, nextProfileData.warning))
        return
      }
      if (surface === 'settings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSettingsData = await fetchSettingsSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setSettingsData(nextSettingsData)
        setData(accountDataFromShell(nextShellData, nextSettingsData.warning))
        return
      }
      if (surface === 'tailor-detail') {
        const [nextShellData, nextTailorDetailData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchTailorDetailSurfaceData(userId, tailorId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setTailorDetailData(nextTailorDetailData)
        setData(accountDataFromShell(nextShellData, nextTailorDetailData.warning))
        return
      }
      if (surface === 'item-detail') {
        const [nextShellData, nextItemDetailData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchItemDetailSurfaceData(itemId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setItemDetailData(nextItemDetailData)
        setData(accountDataFromShell(nextShellData, nextItemDetailData.warning))
      }
    }

    loadSurfaceData()
      .catch(() => {
        if (!active) return
        const fallbackShellData: AccountShellData = {
          ...emptyShellData,
          userId: currentUserId,
          warning: 'Account data could not load. Refresh to retry.',
        }
        setShellData(fallbackShellData)
        setData(accountDataFromShell(fallbackShellData))
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [itemId, orderId, reloadKey, session?.user.id, surface, tailorId])

  const content = useMemo(() => {
    const onRefresh = () => {
      if (session?.user.id) shellCacheDelete(session.user.id)
      setReloadKey((current) => current + 1)
    }
    switch (surface) {
      case 'explore':
        return <RenderExplore data={{ ...exploreData, userId: shellData.userId ?? data.userId, accountCurrency: shellData.accountCurrency ?? data.accountCurrency }} />
      case 'orders':
        return <RenderOrders data={{ ...ordersData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} />
      case 'order-detail':
        return (
          <RenderOrderDetail
            data={{
              ...orderDetailData,
              userId: shellData.userId ?? data.userId,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'messages':
        return <RenderMessages data={{ ...messagesData, userId: shellData.userId ?? data.userId }} onRefresh={onRefresh} />
      case 'measurements':
        return <RenderMeasurements data={{ ...measurementsData, customerProfile: shellData.customerProfile }} onRefresh={onRefresh} />
      case 'brief':
        return (
          <RenderBrief
            data={{
              ...briefData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
            }}
            tailorId={tailorId}
            onRefresh={onRefresh}
          />
        )
      case 'shop':
        return <RenderShop data={{ ...shopData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile, pickupDetails: shellData.pickupDetails }} onRefresh={onRefresh} />
      case 'work':
        return <RenderWork data={{ ...workData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'earnings':
        return <RenderEarnings data={{ ...earningsData, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} />
      case 'payout':
        return <RenderPayout data={{ tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      case 'profile':
        return <RenderProfile data={{ ...profileData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile, pickupDetails: shellData.pickupDetails }} onRefresh={onRefresh} />
      case 'checkout':
        return <RenderCheckout data={{ ...checkoutData, userId: shellData.userId ?? data.userId }} orderId={orderId} onRefresh={onRefresh} />
      case 'saved':
        return <RenderSaved data={savedData} />
      case 'settings':
        return (
          <RenderSettings
            data={{
              ...settingsData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            session={session}
            onRefresh={onRefresh}
          />
        )
      case 'support':
        return <RenderSupport data={{ ...supportData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile }} onRefresh={onRefresh} />
      case 'tailor-detail':
        return <RenderTailorDetail key={tailorId ?? 'tailor-detail'} data={tailorDetailData} onRefresh={onRefresh} />
      case 'item-detail':
        return <RenderItemDetail data={{ ...itemDetailData, userId: shellData.userId ?? data.userId, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }} onRefresh={onRefresh} />
      default:
        return null
    }
  }, [briefData, checkoutData, data, earningsData, exploreData, itemDetailData, measurementsData, messagesData, orderDetailData, orderId, ordersData, profileData, savedData, session, settingsData, shellData.accountCurrency, shellData.customerProfile, shellData.pickupDetails, shellData.tailorProfile, shellData.userId, shopData, supportData, surface, tailorDetailData, tailorId, workData])

  const accountContextValue = useMemo<AccountContextValue | null>(() => {
    const userId = session?.user.id ?? shellData.userId ?? data.userId
    if (!userId) return null

    const customerProfile = shellData.customerProfile ?? data.customerProfile
    const tailorProfile = shellData.tailorProfile ?? data.tailorProfile
    const role = tailorProfile ? 'TAILOR' : 'CUSTOMER'

    return {
      userId,
      role,
      defaultCurrency: shellData.accountCurrency ?? data.accountCurrency,
      customerProfile: customerProfile
        ? {
            userId: customerProfile.user_id,
            displayName: safeEntityName(customerProfile.display_name, '') || null,
            avatarUrl: customerProfile.avatar_url,
          }
        : null,
      tailorProfile: tailorProfile
        ? {
            id: tailorProfile.id,
            userId: tailorProfile.user_id,
            displayName: safeEntityName(tailorProfile.display_name, '') || null,
            businessName: safeEntityName(tailorProfile.business_name, '') || null,
            avatarUrl: tailorProfile.avatar_url,
          }
        : null,
    }
  }, [
    data.accountCurrency,
    data.customerProfile,
    data.tailorProfile,
    data.userId,
    session?.user.id,
    shellData.accountCurrency,
    shellData.customerProfile,
    shellData.tailorProfile,
    shellData.userId,
  ])

  if (loading || (session?.user.id && data.userId !== session.user.id)) return <LoadingCard />
  if (!session) return <AuthRequiredCard />
  if (!accountContextValue) return <LoadingCard />

  return (
    <AccountContextProvider value={accountContextValue}>
      <AccountRouteShell session={session} data={data} shellData={shellData} surface={surface}>
        {ORDER_REALTIME_SURFACES.has(surface) ? (
          <AccountDesktopAlertsPrompt
            permission={orderNotificationPermission}
            onEnable={() => { void requestOrderNotifications() }}
          />
        ) : null}
        {content}
      </AccountRouteShell>
    </AccountContextProvider>
  )
}
