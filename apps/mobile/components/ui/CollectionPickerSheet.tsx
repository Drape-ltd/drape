import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Fonts, FontWeight, Radius, Spacing } from '@/constants/theme'

export type CollectionPickerRow = {
  id: string
  name: string
  itemCount: number
}

type CollectionPickerSheetProps = {
  title?: string
  collections: CollectionPickerRow[]
  onSelect: (id: string) => void
}

export function CollectionPickerSheet({
  title = 'Save to wishlist',
  collections,
  onSelect,
}: CollectionPickerSheetProps) {
  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.rows}>
        {collections.map((collection) => (
          <TouchableOpacity
            key={collection.id}
            style={styles.row}
            onPress={() => onSelect(collection.id)}
            accessibilityRole="button"
            accessibilityLabel={`Save to ${collection.name}`}
            activeOpacity={0.76}
          >
            <Text style={styles.rowName} numberOfLines={1}>{collection.name}</Text>
            <Text style={styles.rowCount}>{collection.itemCount} items</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 33,
    paddingTop: 17,
    paddingBottom: Spacing.xl,
    gap: Spacing.xl,
  },
  handle: {
    width: 90,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.lightGrey,
    alignSelf: 'center',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    letterSpacing: 0,
  },
  rows: {
    gap: Spacing.lg,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  rowCount: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.inkLight,
  },
})
