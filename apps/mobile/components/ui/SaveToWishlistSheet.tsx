import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type WishlistCollectionOption = {
  id: string
  name: string
  itemCount: number
}

type SaveToWishlistSheetProps = {
  visible: boolean
  collections: WishlistCollectionOption[]
  newWishlistName: string
  saving: boolean
  createPlaceholder?: string
  onChangeNewWishlistName: (value: string) => void
  onClose: () => void
  onSelect: (collectionId: string) => void
  onCreate: () => void
}

export function SaveToWishlistSheet({
  visible,
  collections,
  newWishlistName,
  saving,
  createPlaceholder = 'e.g. December Wedding',
  onChangeNewWishlistName,
  onClose,
  onSelect,
  onCreate,
}: SaveToWishlistSheetProps) {
  const hasCollections = collections.length > 0

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
        accessibilityViewIsModal
      >
        <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>
              {hasCollections ? 'Save to wishlist' : 'Create wishlist'}
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close wishlist sheet"
              activeOpacity={0.76}
            >
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          {hasCollections ? (
            <ScrollView
              style={styles.optionsScroll}
              contentContainerStyle={styles.options}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {collections.map((collection) => (
                <TouchableOpacity
                  key={collection.id}
                  style={styles.option}
                  onPress={() => onSelect(collection.id)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Save to ${collection.name}`}
                  activeOpacity={0.76}
                >
                  <Text style={styles.optionTitle} numberOfLines={1}>{collection.name}</Text>
                  <Text style={styles.optionMeta}>
                    {collection.itemCount} item{collection.itemCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.createBox}>
            {hasCollections ? (
              <Text style={styles.createLabel}>New wishlist</Text>
            ) : null}
            <TextInput
              value={newWishlistName}
              onChangeText={onChangeNewWishlistName}
              placeholder={createPlaceholder}
              placeholderTextColor={Colors.midGrey}
              style={styles.input}
              autoFocus={!hasCollections}
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={onCreate}
            />
            <TouchableOpacity
              style={[styles.createButton, (!newWishlistName.trim() || saving) && styles.createButtonDisabled]}
              onPress={onCreate}
              disabled={!newWishlistName.trim() || saving}
              accessibilityRole="button"
              accessibilityLabel="Create wishlist and save"
              activeOpacity={0.82}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.createButtonText}>Create and save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.36)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.xxxl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 90,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.lightGrey,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  optionsScroll: {
    maxHeight: 250,
  },
  options: {
    gap: Spacing.lg,
  },
  option: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.white,
  },
  optionTitle: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  optionMeta: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.inkLight,
  },
  createBox: { gap: Spacing.sm },
  createLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  input: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.bone,
  },
  createButton: {
    minHeight: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
})
