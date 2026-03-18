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
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '@/lib/supabase'
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

const EMPTY_EDIT: EditForm = {
  id: null, imageUrl: '', imageUri: '', title: '', description: '', category: '',
}

export default function PortfolioScreen() {
  const router = useRouter()
  const { user } = useAuth()

  const [items, setItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tailorProfileId, setTailorProfileId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    if (!user?.id) return
    const profileRes = await supabase
      .from('tailor_profiles')
      .select('id, portfolio_photo_urls')
      .eq('user_id', user.id)
      .maybeSingle()
    const pid = (profileRes.data as any)?.id ?? null
    const setupPhotoUrls: string[] = (profileRes.data as any)?.portfolio_photo_urls ?? []
    setTailorProfileId(pid)
    if (!pid) { setLoading(false); return }

    const { data } = await supabase
      .from('portfolio_items')
      .select('id, image_url, title, description, category, sort_order')
      .eq('tailor_profile_id', pid)
      .order('sort_order', { ascending: true })

    const existing = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      imageUrl: r.image_url,
      title: r.title,
      description: r.description ?? null,
      category: r.category ?? null,
      sortOrder: r.sort_order,
    }))

    // One-time seed: migrate setup wizard photos into portfolio_items.
    // Also re-seeds if all existing items have blank image URLs (stale records from before bucket fix).
    const allBlank = existing.length > 0 && existing.every((i) => !i.imageUrl)
    if (allBlank) {
      await supabase.from('portfolio_items').delete().eq('tailor_profile_id', pid)
    }
    if ((existing.length === 0 || allBlank) && setupPhotoUrls.length > 0) {
      await supabase.from('portfolio_items').insert(
        setupPhotoUrls.map((url, i) => ({
          tailor_profile_id: pid,
          image_url: url,
          title: `Portfolio photo ${i + 1}`,
          description: null,
          category: null,
          sort_order: i,
        }))
      )
      const { data: seeded } = await supabase
        .from('portfolio_items')
        .select('id, image_url, title, description, category, sort_order')
        .eq('tailor_profile_id', pid)
        .order('sort_order', { ascending: true })
      setItems(((seeded ?? []) as any[]).map((r) => ({
        id: r.id,
        imageUrl: r.image_url,
        title: r.title,
        description: r.description ?? null,
        category: r.category ?? null,
        sortOrder: r.sort_order,
      })))
    } else {
      setItems(existing)
    }

    setLoading(false)
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

    const payload = {
      tailor_profile_id: tailorProfileId,
      image_url: finalImageUrl,
      title: editModal.title.trim(),
      description: editModal.description.trim() || null,
      category: editModal.category || null,
      sort_order: editModal.id ? undefined : items.length,
    }

    let error: any
    if (editModal.id) {
      const res = await supabase
        .from('portfolio_items')
        .update({ image_url: finalImageUrl, title: payload.title, description: payload.description, category: payload.category })
        .eq('id', editModal.id)
      error = res.error
    } else {
      const res = await supabase.from('portfolio_items').insert(payload)
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
    Alert.alert(
      'Delete item?',
      `Remove "${item.title}" from your portfolio?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await supabase.from('portfolio_items').delete().eq('id', item.id)
            setItems((prev) => prev.filter((i) => i.id !== item.id))
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openNew} hitSlop={8}>
          <Feather name="plus" size={20} color={Colors.white} />
        </TouchableOpacity>
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
            <Feather name="image" size={40} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.emptyTitle}>No portfolio items yet</Text>
            <Text style={styles.emptyHint}>Showcase your work to attract more clients.</Text>
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
                  style={styles.deleteBtn}
                  onPress={() => {
                    const item = items.find((i) => i.id === editModal.id)
                    if (item) { setEditModal(null); handleDelete(item) }
                  }}
                >
                  <Feather name="trash-2" size={16} color={Colors.error} />
                  <Text style={styles.deleteBtnText}>Delete item</Text>
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
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
  },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
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
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 260 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.md,
  },
  emptyAddBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
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
