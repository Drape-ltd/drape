/**
 * Portfolio management screen — add, edit, delete portfolio items.
 * Each item has: image, title, description, category.
 */
import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, ScrollView, Image,
  Dimensions,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const GRID_ITEM_SIZE = (SCREEN_WIDTH - Spacing.xl * 2 - Spacing.md) / 2

const CATEGORIES = ['WEDDING', 'CASUAL', 'ASOEBI', 'FORMAL', 'OTHER'] as const
const CATEGORY_LABEL: Record<string, string> = {
  WEDDING: 'Wedding', CASUAL: 'Casual', ASOEBI: 'Asoebi', FORMAL: 'Formal', OTHER: 'Other',
}

type PortfolioItem = {
  id: string
  imageUrl: string
  title: string
  description: string | null
  category: string | null
  sortOrder: number
}

type EditForm = {
  id: string | null  // null = new
  imageUrl: string
  imageUri: string   // local uri for new uploads
  title: string
  description: string
  category: string
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

const EMPTY_EDIT: EditForm = {
  id: null, imageUrl: '', imageUri: '', title: '', description: '', category: '',
}

export default function PortfolioScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  const [items, setItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [tailorProfileId, setTailorProfileId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    if (!user?.id) return
    setFetchError(false)
    try {
      const profileRes = await supabase
        .from('tailor_profiles')
        .select('id, portfolio_photo_urls')
        .eq('user_id', user.id)
        .maybeSingle()
      if (profileRes.error) throw profileRes.error
      const pid = (profileRes.data as any)?.id ?? null
      const setupPhotoUrls = asStringList((profileRes.data as any)?.portfolio_photo_urls)
      setTailorProfileId(pid)
      if (!pid) { setLoading(false); return }

      const { data, error } = await supabase
        .from('portfolio_items')
        .select('id, image_url, title, description, category, sort_order')
        .eq('tailor_profile_id', pid)
        .order('sort_order', { ascending: true })
      if (error) throw error

      const existing = ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        imageUrl: r.image_url,
        title: r.title,
        description: r.description ?? null,
        category: r.category ?? null,
        sortOrder: r.sort_order,
      }))

      let finalItems = existing

      const allBlank = existing.length > 0 && existing.every((i) => !i.imageUrl)
      if (allBlank) {
        finalItems = []
      }
      if ((existing.length === 0 || allBlank) && setupPhotoUrls.length > 0) {
        const { error: seedError } = await invokeFunction('portfolio-item-action', {
          body: { action: 'seed-from-setup', photoUrls: setupPhotoUrls },
        })
        if (seedError) throw seedError
        const { data: seeded } = await supabase
          .from('portfolio_items')
          .select('id, image_url, title, description, category, sort_order')
          .eq('tailor_profile_id', pid)
          .order('sort_order', { ascending: true })
        finalItems = ((seeded ?? []) as any[]).map((r) => ({
          id: r.id,
          imageUrl: r.image_url,
          title: r.title,
          description: r.description ?? null,
          category: r.category ?? null,
          sortOrder: r.sort_order,
        }))
      }

      setItems(finalItems)
    } catch {
      setFetchError(true)
      setItems([])
      setTailorProfileId(null)
    } finally {
      setLoading(false)
    }
  }

  async function pickImage(onPicked: (uri: string) => void) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload portfolio images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.85,
    })
    if (!result.canceled && result.assets[0]) {
      onPicked(result.assets[0].uri)
    }
  }

  async function uploadImage(uri: string): Promise<string | null> {
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      const fileName = `portfolio/${user!.id}/${Date.now()}.jpg`
      const response = await fetch(compressed.uri)
      const blob = await response.blob()
      const { error } = await supabase.storage
        .from('portfolio-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('portfolio-photos').getPublicUrl(fileName)
      return publicUrl
    } catch (err) {
      console.error('[portfolio upload]', err)
      return null
    }
  }

  function openNew() {
    setEditModal({ ...EMPTY_EDIT })
  }

  function openEdit(item: PortfolioItem) {
    setEditModal({
      id: item.id,
      imageUrl: item.imageUrl,
      imageUri: '',
      title: item.title,
      description: item.description ?? '',
      category: item.category ?? '',
    })
  }

  function goBack() {
    router.replace('/(tailor)/profile')
  }

  async function handleSave() {
    if (!editModal) return
    if (!editModal.title.trim()) {
      Alert.alert('Title required', 'Please add a title for this portfolio item.')
      return
    }
    if (!editModal.imageUrl && !editModal.imageUri) {
      Alert.alert('Image required', 'Please select an image.')
      return
    }
    if (!tailorProfileId) {
      Alert.alert('Profile required', 'Complete your tailor profile first.')
      return
    }

    setSaving(true)
    let finalImageUrl = editModal.imageUrl
    if (editModal.imageUri) {
      const uploaded = await uploadImage(editModal.imageUri)
      if (!uploaded) {
        Alert.alert('Upload failed', 'Could not upload image. Please try again.')
        setSaving(false)
        return
      }
      finalImageUrl = uploaded
    }

    let error: any
    if (editModal.id) {
      const res = await invokeFunction('portfolio-item-action', {
        body: {
          action: 'update-item',
          itemId: editModal.id,
          item: {
            imageUrl: finalImageUrl!,
            title: editModal.title.trim(),
            description: editModal.description.trim() || null,
            category: editModal.category || null,
          },
        },
      })
      error = res.error
    } else {
      const res = await invokeFunction('portfolio-item-action', {
        body: {
          action: 'create-item',
          item: {
            imageUrl: finalImageUrl!,
            title: editModal.title.trim(),
            description: editModal.description.trim() || null,
            category: editModal.category || null,
          },
        },
      })
      error = res.error
    }

    setSaving(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    setEditModal(null)
    loadData()
  }

  async function handleDelete(item: PortfolioItem) {
    if (deletingId) return
    Alert.alert(
      'Delete item?',
      `Remove "${item.title}" from your portfolio?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (deletingId) return
            setDeletingId(item.id)
            const { error } = await invokeFunction('portfolio-item-action', {
              body: { action: 'delete-item', itemId: item.id },
            })
            if (error) {
              setDeletingId(null)
              Alert.alert('Delete failed', error.message)
              return
            }
            const nextItems = items.filter((i) => i.id !== item.id)
            setItems(nextItems)
            setDeletingId(null)
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Portfolio</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your portfolio…</Text>
            <Text style={styles.stateHint}>
              We’re pulling in the work customers use to judge your craft, taste, and fit for their order.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Portfolio</Text>
            <Text style={styles.stateTitle}>Couldn't load your portfolio.</Text>
            <Text style={styles.stateHint}>
              This screen should help you keep the visual proof of your craft polished and current for new customers.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setLoading(true)
                loadData()
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/profile')}
            >
              <Text style={styles.secondaryBtnText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openNew} hitSlop={8}>
          <Feather name="plus" size={20} color={Colors.white} />
        </TouchableOpacity>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Proof of craft</Text>
        </View>
        <Text style={styles.heroTitle}>Show the work that makes customers stop and trust.</Text>
        <Text style={styles.heroSub}>
          A strong portfolio helps customers understand your range, quality, and aesthetic before
          they ever send a brief.
        </Text>
      </View>

      <View style={styles.guideCard}>
        <Text style={styles.guideEyebrow}>Best approach</Text>
        <Text style={styles.guideTitle}>Lead with the work you most want to be booked for.</Text>
        <Text style={styles.guideCopy}>
          A few strong pieces beat a crowded gallery. Use this space to signal your taste, quality, and the kind of commissions you want more of.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: Spacing.md }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyBadge}>
              <Text style={styles.emptyBadgeText}>Portfolio</Text>
            </View>
            <Feather name="image" size={40} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.emptyTitle}>No portfolio items yet</Text>
            <Text style={styles.emptyHint}>
              Showcase your best work so future customers can judge your craft, style, and fit before they book.
            </Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openNew}>
              <Feather name="plus" size={16} color={Colors.white} />
              <Text style={styles.emptyAddBtnText}>Add first item</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.gridItem}
            onPress={() => setExpandedUrl(item.imageUrl)}
            onLongPress={() => openEdit(item)}
            activeOpacity={0.85}
          >
            <Image source={{ uri: item.imageUrl }} style={styles.gridImage} resizeMode="cover" />
            <View style={styles.gridOverlay}>
              {item.category && (
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{CATEGORY_LABEL[item.category] ?? item.category}</Text>
                </View>
              )}
              <Text style={styles.gridTitle} numberOfLines={1}>{item.title}</Text>
            </View>
            <TouchableOpacity
              style={styles.editBadge}
              onPress={() => openEdit(item)}
              hitSlop={8}
            >
              <Feather name="edit-2" size={12} color={Colors.white} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />

      {/* ── Edit / Add modal ── */}
      {editModal && (
        <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={() => setEditModal(null)}>
          <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModal(null)} hitSlop={8}>
                <Feather name="x" size={22} color={Colors.ink} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editModal.id ? 'Edit item' : 'Add to portfolio'}</Text>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.saveBtnText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {/* Image picker */}
              <TouchableOpacity
                style={styles.imagePicker}
                onPress={() => pickImage((uri) => setEditModal((m) => m ? { ...m, imageUri: uri, imageUrl: uri } : m))}
                activeOpacity={0.8}
              >
                {(editModal.imageUri || editModal.imageUrl) ? (
                  <Image
                    source={{ uri: editModal.imageUri || editModal.imageUrl }}
                    style={styles.imagePickerImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.imagePickerEmpty}>
                    <Feather name="image" size={32} color={Colors.midGrey} />
                    <Text style={styles.imagePickerText}>Tap to add photo</Text>
                  </View>
                )}
                <View style={styles.imagePickerBadge}>
                  <Feather name="camera" size={14} color={Colors.white} />
                </View>
              </TouchableOpacity>

              {/* Title */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={editModal.title}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, title: v } : m)}
                  placeholder="e.g. Wedding Agbada"
                  placeholderTextColor={Colors.midGrey}
                  autoCapitalize="words"
                />
              </View>

              {/* Description */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={editModal.description}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, description: v } : m)}
                  placeholder="Fabric, occasion, or anything notable…"
                  placeholderTextColor={Colors.midGrey}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Category */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Category</Text>
                <View style={styles.catRow}>
                  {CATEGORIES.map((cat) => {
                    const active = editModal.category === cat
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.catBtn, active && styles.catBtnActive]}
                        onPress={() => setEditModal((m) => m ? { ...m, category: active ? '' : cat } : m)}
                      >
                        <Text style={[styles.catLabel, active && styles.catLabelActive]}>{CATEGORY_LABEL[cat]}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              {/* Delete button (edit mode only) */}
              {editModal.id && (
                <TouchableOpacity
                  style={[styles.deleteBtn, deletingId === editModal.id && { opacity: 0.6 }]}
                  disabled={saving || deletingId === editModal.id}
                  onPress={() => {
                    const item = items.find((i) => i.id === editModal.id)
                    if (item) { setEditModal(null); handleDelete(item) }
                  }}
                >
                  {deletingId === editModal.id ? (
                    <ActivityIndicator size="small" color={Colors.error} />
                  ) : (
                    <>
                      <Feather name="trash-2" size={16} color={Colors.error} />
                      <Text style={styles.deleteBtnText}>Delete item</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}

      {/* ── Full image expand ── */}
      {expandedUrl && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setExpandedUrl(null)}>
          <TouchableOpacity style={styles.expandOverlay} onPress={() => setExpandedUrl(null)} activeOpacity={1}>
            <Image source={{ uri: expandedUrl }} style={styles.expandedImage} resizeMode="contain" />
            <TouchableOpacity style={styles.expandClose} onPress={() => setExpandedUrl(null)}>
              <Feather name="x" size={20} color={Colors.white} />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
  },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  heroCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  guideCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  grid: { padding: Spacing.xl, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  gridItem: {
    width: GRID_ITEM_SIZE, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: Colors.white, ...Shadow.sm, position: 'relative',
  },
  gridImage: { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE * 1.2 },
  gridOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: Spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 3,
  },
  categoryPill: {
    alignSelf: 'flex-start', backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  categoryPillText: { fontSize: 10, color: Colors.white, fontWeight: FontWeight.semibold },
  gridTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.white },
  editBadge: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  empty: { alignItems: 'center', paddingTop: Spacing.xxxl, gap: Spacing.sm },
  emptyBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 260 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.md,
  },
  emptyAddBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  retryBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, marginTop: Spacing.md,
  },
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  // Modal
  modalSafe: { flex: 1, backgroundColor: Colors.white },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  modalTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 60, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  modalScroll: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  imagePicker: {
    height: 220, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: Colors.boneDeep, position: 'relative',
  },
  imagePickerImg: { width: '100%', height: '100%' },
  imagePickerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  imagePickerText: { fontSize: FontSize.sm, color: Colors.midGrey },
  imagePickerBadge: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm,
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  input: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  catBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.bone,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  catBtnActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  catLabel: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },
  catLabelActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    alignSelf: 'center', marginTop: Spacing.md, paddingVertical: Spacing.sm,
  },
  deleteBtnText: { fontSize: FontSize.sm, color: Colors.error },
  // Expand
  expandOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  expandedImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.4 },
  expandClose: {
    position: 'absolute', top: 50, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
})
