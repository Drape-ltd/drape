import { useEffect, useState } from 'react'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Image } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { deriveTailorReadiness, type TailorReadinessInput } from '@/lib/tailor-readiness'
import { stripExif } from '@/lib/stripExif'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES'] as const
const ITEM_CATEGORIES = ['Agbada', 'Kaftan', 'Suit', 'Dress', 'Crochet', 'Ready-made', 'Two-piece Set', 'Native Wear'] as const
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'] as const
const ITEM_TEMPLATES: Array<{ title: string; category: (typeof ITEM_CATEGORIES)[number]; sizes: string[] }> = [
  { title: 'Crochet Two-piece Set', category: 'Crochet', sizes: ['S', 'M', 'L'] },
  { title: 'Ready-made Agbada Set', category: 'Agbada', sizes: ['M', 'L', 'XL'] },
  { title: 'Kaftan Set', category: 'Kaftan', sizes: ['M', 'L', 'XL'] },
  { title: 'Two-piece Set', category: 'Two-piece Set', sizes: ['S', 'M', 'L'] },
]

export default function NewShopItemScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<(typeof ITEM_CATEGORIES)[number] | ''>('')
  const [description, setDescription] = useState('')
  const [sizes, setSizes] = useState<string[]>([])
  const [customSize, setCustomSize] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('NGN')
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [sellerStatus, setSellerStatus] = useState<(TailorReadinessInput & { supportsReadyMade?: boolean | null }) | null>(null)

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/shop')
  }

  useEffect(() => {
    void loadSellerDefaults()
  }, [user?.id])

  async function loadSellerDefaults() {
    if (!user?.id) return
    const { data } = await supabase
      .from('tailor_profiles')
      .select('currency, supports_ready_made, profile_completed, id_verification_status, is_live, stripe_account_id, paystack_account_id')
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
  }

  function applyTemplate(template: { title: string; category: (typeof ITEM_CATEGORIES)[number]; sizes: string[] }) {
    setTitle(template.title)
    setCategory(template.category)
    setSizes(template.sizes)
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

  async function saveItem() {
    if (saving || !user?.id) return
    if (!title.trim()) {
      Alert.alert('Missing title', 'Give this item a simple name customers can understand.')
      return
    }
    if (!price.trim() || Number.isNaN(Number(price)) || Number(price) <= 0) {
      Alert.alert('Missing price', 'Add a valid price before saving this item.')
      return
    }
    if (!(pickupAvailable || deliveryAvailable || shippingAvailable)) {
      Alert.alert('Choose fulfillment', 'Pick at least one way customers can receive this item.')
      return
    }

    setSaving(true)

    try {
      const { error } = await invokeFunction<{ ok: boolean; itemId?: string }>('seller-item-action', {
        body: {
          action: 'create-item',
          title: title.trim(),
          category: category || null,
          description: description.trim() || null,
          sizes,
          priceAmount: Math.round(Number(price) * 100),
          currency,
          photoUrls,
          pickupAvailable,
          deliveryAvailable,
          shippingAvailable,
          isLive,
        },
      })

      if (error) {
        const message = isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save this item yet. Your details are still here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not save this item right now. Please try again in a moment.')
        Alert.alert('Save failed', message)
        return
      }

      router.replace('/(tailor)/shop')
    } finally {
      setSaving(false)
    }
  }

  const readiness = deriveTailorReadiness(sellerStatus)
  const canPublishLive = (sellerStatus?.supportsReadyMade ?? false) && readiness.canPublishPaidItems

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add item</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Best use</Text>
          <Text style={styles.bestUseText}>Start simple: one clear title, one clear price, one clear way the buyer receives it.</Text>
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

        <Field label="Price">
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="e.g. 85000" placeholderTextColor={Colors.midGrey} keyboardType="decimal-pad" />
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
        </Field>

        <Field label="Visibility">
          <ChoiceCard
            title={isLive ? 'Live' : 'Draft'}
            hint={
              isLive
                ? 'Customers can see this item now.'
                : canPublishLive
                  ? 'Keep it hidden until you are ready.'
                  : 'Live publishing stays blocked until Shop now and payout readiness are in place.'
            }
            active={isLive}
            disabled={!canPublishLive}
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
              setIsLive((value) => !value)
            }}
          />
        </Field>
      </ScrollView>

      <View style={styles.footer}>
        <Button label={saving ? 'Saving…' : 'Save item'} onPress={saveItem} disabled={saving} />
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
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  readinessCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  readinessCardWarning: { borderWidth: 1, borderColor: Colors.warning + '35' },
  readinessCardSuccess: { borderWidth: 1, borderColor: Colors.success + '30' },
  readinessTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  readinessBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  field: { gap: Spacing.sm },
  label: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  input: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.ink,
    fontSize: FontSize.md,
    ...Shadow.sm,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoThumbWrap: { width: 96, height: 96, borderRadius: Radius.md, overflow: 'hidden', position: 'relative', backgroundColor: Colors.lightGrey },
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
    width: 96,
    height: 96,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoAddIcon: { fontSize: 24, color: Colors.midGrey },
  photoAddText: { fontSize: FontSize.xs, color: Colors.midGrey },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  templateChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  templateChipText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  chipActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  chipText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.needleGreen },
  choiceGroup: { gap: Spacing.sm },
  choiceCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4, borderWidth: 1.5, borderColor: Colors.lightGrey, ...Shadow.sm },
  choiceCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  choiceCardDisabled: { opacity: 0.6 },
  choiceTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  choiceTitleActive: { color: Colors.needleGreen },
  choiceHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  customSizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  customSizeInput: { flex: 1 },
  customSizeBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  customSizeBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  selectedSizeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  selectedSizeText: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  footer: { padding: Spacing.xl, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
})
