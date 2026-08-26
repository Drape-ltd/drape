import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius } from '@/constants/theme'
import type { StorageImageBucket } from '@/lib/image-url'
import { PortfolioVideoPreview } from './PortfolioVideoPreview'
import { RemoteImage } from './RemoteImage'

export type DrapeMediaMosaicItem = {
  id: string
  uri: string | null
  kind: 'photo' | 'video'
  label: string
  bucket?: StorageImageBucket
}

type DrapeMediaMosaicProps = {
  items: DrapeMediaMosaicItem[]
  onPressItem: (item: DrapeMediaMosaicItem, index: number) => void
  onLongPressItem?: (item: DrapeMediaMosaicItem, index: number) => void
  compact?: boolean
  contentFit?: 'cover' | 'contain'
  onLoadError?: (item: DrapeMediaMosaicItem) => void
  testID?: string
}

function MediaTile({
  item,
  index,
  hiddenCount,
  onPress,
  onLongPress,
  style,
  contentFit,
  onLoadError,
  testID,
}: {
  item: DrapeMediaMosaicItem
  index: number
  hiddenCount?: number
  onPress: () => void
  onLongPress?: () => void
  style?: object
  contentFit: 'cover' | 'contain'
  onLoadError?: () => void
  testID?: string
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={item.uri ? onPress : (onLoadError ?? onPress)}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="imagebutton"
      accessibilityLabel={item.label}
      accessibilityHint="Opens this attachment in the media viewer."
      testID={testID}
      style={[styles.tile, style]}
    >
      {item.uri ? (
        item.kind === 'video' ? (
          <PortfolioVideoPreview
            uri={item.uri}
            style={styles.asset}
            contentFit={contentFit}
            nativeControls={false}
            autoplay={false}
            isLooping={false}
          />
        ) : (
          <RemoteImage
            uri={item.uri}
            bucket={item.bucket}
            containerStyle={styles.asset}
            style={styles.asset}
            contentFit={contentFit}
            transition={120}
            surface="drape_media_mosaic"
            onLoadError={onLoadError ? () => onLoadError() : undefined}
            fallback={(
              <View style={[styles.asset, styles.fallback]}>
                <Feather name="refresh-cw" size={18} color={Colors.midGrey} />
                <Text style={styles.fallbackLabel}>Tap to retry</Text>
              </View>
            )}
          />
        )
      ) : (
        <View style={[styles.asset, styles.fallback]}>
          <Feather name="refresh-cw" size={18} color={Colors.midGrey} />
          <Text style={styles.fallbackLabel}>Tap to refresh</Text>
        </View>
      )}

      {item.kind === 'video' ? (
        <View style={styles.videoBadge} pointerEvents="none">
          <Feather name="play" size={16} color={Colors.textInverse} />
        </View>
      ) : null}

      {hiddenCount && hiddenCount > 0 ? (
        <View style={styles.moreOverlay} pointerEvents="none">
          <Text style={styles.moreLabel}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  )
}

export function DrapeMediaMosaic({
  items,
  onPressItem,
  onLongPressItem,
  compact = false,
  contentFit = 'cover',
  onLoadError,
  testID,
}: DrapeMediaMosaicProps) {
  const visibleItems = items.slice(0, 4)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)
  const heightStyle = compact ? styles.compactHeight : styles.regularHeight

  if (visibleItems.length === 0) return null

  const tile = (item: DrapeMediaMosaicItem, index: number, style?: object) => (
    <MediaTile
      key={item.id}
      item={item}
      index={index}
      hiddenCount={index === visibleItems.length - 1 ? hiddenCount : 0}
      onPress={() => onPressItem(item, index)}
      onLongPress={onLongPressItem ? () => onLongPressItem(item, index) : undefined}
      style={style}
      contentFit={contentFit}
      onLoadError={onLoadError ? () => onLoadError(item) : undefined}
      testID={testID ? `${testID}-item-${index}` : undefined}
    />
  )

  if (visibleItems.length === 1) {
    return <View style={[styles.mosaic, heightStyle]} testID={testID}>{tile(visibleItems[0]!, 0, styles.fill)}</View>
  }

  if (visibleItems.length === 2) {
    return (
      <View style={[styles.mosaic, styles.row, heightStyle]} testID={testID}>
        {visibleItems.map((item, index) => tile(item, index, styles.equalRowTile))}
      </View>
    )
  }

  if (visibleItems.length === 3) {
    return (
      <View style={[styles.mosaic, styles.row, heightStyle]} testID={testID}>
        {tile(visibleItems[0]!, 0, styles.primaryTile)}
        <View style={styles.secondaryColumn}>
          {tile(visibleItems[1]!, 1, styles.flexTile)}
          {tile(visibleItems[2]!, 2, styles.flexTile)}
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.mosaic, heightStyle]} testID={testID}>
      <View style={[styles.row, styles.flexTile]}>
        {tile(visibleItems[0]!, 0, styles.equalRowTile)}
        {tile(visibleItems[1]!, 1, styles.equalRowTile)}
      </View>
      <View style={[styles.row, styles.flexTile]}>
        {tile(visibleItems[2]!, 2, styles.equalRowTile)}
        {tile(visibleItems[3]!, 3, styles.equalRowTile)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  mosaic: {
    width: '100%',
    gap: 3,
    overflow: 'hidden',
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
  },
  regularHeight: { height: 244 },
  compactHeight: { height: 216 },
  row: { flexDirection: 'row', gap: 3 },
  secondaryColumn: { flex: 0.82, gap: 3 },
  primaryTile: { flex: 1.18 },
  flexTile: { flex: 1 },
  equalRowTile: { flexGrow: 1, flexBasis: 0 },
  fill: { width: '100%', height: '100%' },
  tile: {
    position: 'relative',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: Colors.boneDeep,
  },
  asset: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.boneDeep },
  fallbackLabel: { marginTop: 6, color: Colors.midGrey, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  videoBadge: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,20,0.62)',
  },
  moreLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
})
