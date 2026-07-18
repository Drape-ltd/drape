import type { ComponentProps } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { RemoteImage } from './RemoteImage'
import type { StorageImageBucket } from '@/lib/image-url'

const IMAGE_HEIGHT = 168

type MarketplaceCardProps = {
  title: string
  imageUrl?: string | null
  imageBucket?: StorageImageBucket
  imageLabel: string
  subtitle?: string
  rating?: number | null
  price?: string
  stockSignal?: string
  stockTone?: 'normal' | 'urgent'
  icon?: ComponentProps<typeof Feather>['name']
  onPress?: () => void
  style?: ViewStyle
  surface?: string
}

export function MarketplaceCard({
  title,
  imageUrl,
  imageBucket,
  imageLabel,
  subtitle,
  rating,
  price,
  stockSignal,
  stockTone = 'normal',
  icon = 'image',
  onPress,
  style,
  surface,
}: MarketplaceCardProps) {
  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.86}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? title : undefined}
    >
      <View style={styles.imageWrap}>
        {imageUrl ? (
          <RemoteImage
            uri={imageUrl}
            bucket={imageBucket}
            style={styles.image}
            contentFit="cover"
            transition={180}
            surface={surface}
            fallback={<ImageFallback label={imageLabel} icon={icon} />}
          />
        ) : (
          <ImageFallback label={imageLabel} icon={icon} />
        )}
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        <View style={styles.metaRow}>
          {price ? <Text style={styles.price}>{price}</Text> : null}
          {typeof rating === 'number' ? (
            <View style={styles.ratingPill}>
              <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            </View>
          ) : null}
          {stockSignal ? (
            <Text style={[styles.stock, stockTone === 'urgent' && styles.stockUrgent]} numberOfLines={1}>
              {stockSignal}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function ImageFallback({
  label,
  icon,
}: {
  label: string
  icon: ComponentProps<typeof Feather>['name']
}) {
  return (
    <View style={styles.imageFallback}>
      <Feather name={icon} size={22} color={Colors.needleGreen} />
      <Text style={styles.imageFallbackText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: 300,
    minHeight: 332,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 18,
    padding: Spacing.xxl,
    gap: Spacing.lg,
  },
  imageWrap: {
    height: IMAGE_HEIGHT,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.needleGreenLight,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.needleGreenLight,
  },
  imageFallbackText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.needleGreen,
    textAlign: 'center',
  },
  content: {
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    letterSpacing: 0,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.inkLight,
  },
  metaRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  price: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.needleGreen,
  },
  ratingPill: {
    marginLeft: 'auto',
    minWidth: 62,
    minHeight: 34,
    paddingHorizontal: Spacing.sm,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  ratingText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.needleGreen,
  },
  stock: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.needleGreen,
  },
  stockUrgent: {
    color: Colors.kanteRust,
  },
})
