import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Image as ExpoImage } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import type { StorageImageBucket } from '@/lib/image-url'
import { supabase } from '@/lib/supabase'
import { PortfolioVideoPreview } from './PortfolioVideoPreview'
import { RemoteImage } from './RemoteImage'

export type MediaLightboxItem = {
  uri: string
  resolvedUri?: string
  label: string
  contextId?: string
  kind?: 'photo' | 'video'
  bucket?: StorageImageBucket
  requiresSignedUrl?: boolean
}

const SIGNED_URL_TTL_SECONDS = 60 * 60
const SIGNED_URL_CACHE_WINDOW_MS = 50 * 60 * 1000
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

type MediaLightboxModalProps = {
  items: MediaLightboxItem[]
  activeIndex: number | null
  onDismiss: () => void
  onOpenItemActions?: (item: MediaLightboxItem, index: number) => void
}

function inferKind(item: MediaLightboxItem) {
  if (item.kind) return item.kind
  return isVideoMediaUrl(item.uri) ? 'video' : 'photo'
}

function isAbsoluteMediaUrl(value: string) {
  return /^(https?:|file:|blob:|data:)/iu.test(value)
}

function storagePath(value: string, bucket: StorageImageBucket) {
  return value.trim().replace(/^\/+/, '').replace(new RegExp(`^${bucket}/`), '')
}

function cachedSignedUrl(key: string) {
  const cached = signedUrlCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    signedUrlCache.delete(key)
    return null
  }
  return cached.url
}

async function resolveLightboxMediaUrl(item: MediaLightboxItem) {
  const resolvedUri = item.resolvedUri?.trim()
  if (resolvedUri) return resolvedUri

  const needsSigning = !!item.requiresSignedUrl && !!item.bucket && !isAbsoluteMediaUrl(item.uri)
  if (!needsSigning || !item.bucket) return item.uri

  const key = `${item.bucket}:${item.uri}`
  const cached = cachedSignedUrl(key)
  if (cached) return cached

  const path = storagePath(item.uri, item.bucket)
  const { data, error } = await supabase.storage
    .from(item.bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return null

  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_CACHE_WINDOW_MS,
  })
  return data.signedUrl
}

function useLightboxMediaUrl(item: MediaLightboxItem | null) {
  const [signedUrl, setSignedUrl] = useState<{ key: string; url: string | null } | null>(null)
  const key = item ? `${item.bucket ?? ''}:${item.uri}` : ''
  const immediateUrl = item?.resolvedUri?.trim()
    || (item && (!item.requiresSignedUrl || !item.bucket || isAbsoluteMediaUrl(item.uri)) ? item.uri : null)
    || cachedSignedUrl(key)

  useEffect(() => {
    if (!item || immediateUrl) return undefined
    let cancelled = false
    setSignedUrl(null)
    resolveLightboxMediaUrl(item)
      .then((url) => {
        if (cancelled) return
        setSignedUrl({ key, url })
      })

    return () => {
      cancelled = true
    }
  }, [immediateUrl, item, key])

  if (!item) return null
  if (immediateUrl) return immediateUrl
  return signedUrl?.key === key ? signedUrl.url : null
}

type LightboxMediaPageProps = {
  item: MediaLightboxItem
  isActive: boolean
  shouldLoad: boolean
  width: number
}

function LightboxMediaPage({
  item,
  isActive,
  shouldLoad,
  width,
}: LightboxMediaPageProps) {
  const resolvedUri = useLightboxMediaUrl(shouldLoad ? item : null)
  const itemKind = inferKind(item)

  return (
    <View
      style={[styles.mediaPage, { width }]}
      accessibilityLabel={item.label}
    >
      {!resolvedUri ? (
        <View style={[styles.media, styles.mediaLoading]}>
          <ActivityIndicator size="large" color={Colors.textInverse} />
        </View>
      ) : itemKind === 'video' ? (
        <PortfolioVideoPreview
          uri={resolvedUri}
          style={styles.media}
          contentFit="contain"
          nativeControls
          autoplay={isActive}
          isLooping={false}
          showMuteToggle={false}
        />
      ) : (
        <RemoteImage
          uri={resolvedUri}
          bucket={item.bucket}
          containerStyle={styles.media}
          style={styles.mediaImage}
          contentFit="contain"
          transition={120}
          surface="lightbox_media"
          placeholderColor={Colors.ink}
          fallback={<View style={styles.mediaFallback} />}
        />
      )}
    </View>
  )
}

export function MediaLightboxModal({
  items,
  activeIndex,
  onDismiss,
  onOpenItemActions,
}: MediaLightboxModalProps) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const galleryRef = useRef<ScrollView>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const pageWidth = Math.max(1, windowWidth - (Spacing.md * 2))

  useEffect(() => {
    if (activeIndex == null) return
    if (activeIndex < 0 || activeIndex >= items.length) return
    setCurrentIndex(activeIndex)
    requestAnimationFrame(() => {
      galleryRef.current?.scrollTo({ x: activeIndex * pageWidth, animated: false })
    })
  }, [activeIndex, items.length, pageWidth])

  const currentItem = useMemo(() => {
    if (activeIndex == null) return null
    return items[currentIndex] ?? null
  }, [activeIndex, currentIndex, items])

  useEffect(() => {
    if (activeIndex == null) return
    const adjacentItems = [items[currentIndex - 1], items[currentIndex + 1]]
      .filter((item): item is MediaLightboxItem => !!item && inferKind(item) === 'photo')
    if (adjacentItems.length === 0) return

    void Promise.all(adjacentItems.map(resolveLightboxMediaUrl))
      .then((urls) => urls.filter((url): url is string => !!url))
      .then((urls) => urls.length > 0 ? ExpoImage.prefetch(urls, 'memory-disk') : false)
      .catch(() => undefined)
  }, [activeIndex, currentIndex, items])

  if (activeIndex == null || !currentItem) return null

  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < items.length - 1

  function showMediaAt(index: number) {
    const nextIndex = Math.max(0, Math.min(items.length - 1, index))
    setCurrentIndex(nextIndex)
    galleryRef.current?.scrollTo({ x: nextIndex * pageWidth, animated: true })
  }

  function handleGallerySettled(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.max(
      0,
      Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)),
    )
    setCurrentIndex(nextIndex)
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onDismiss}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.panel,
            {
              paddingTop: Math.max(insets.top + Spacing.md, 56),
              paddingBottom: Math.max(insets.bottom + Spacing.md, Spacing.xl),
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{currentItem.label}</Text>
              {items.length > 1 ? (
                <Text style={styles.subtitle}>
                  {currentIndex + 1} of {items.length}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerActions}>
              {onOpenItemActions ? (
                <TouchableOpacity
                  onPress={() => onOpenItemActions(currentItem, currentIndex)}
                  style={styles.headerActionButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Open actions for ${currentItem.label}`}
                >
                  <Feather name="more-horizontal" size={22} color={Colors.textInverse} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={onDismiss}
                style={styles.headerActionButton}
                accessibilityRole="button"
                accessibilityLabel="Close media preview"
              >
                <Feather name="x" size={22} color={Colors.textInverse} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.galleryFrame}>
              <ScrollView
                ref={galleryRef}
                horizontal
                pagingEnabled
                bounces={false}
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                contentOffset={{ x: currentIndex * pageWidth, y: 0 }}
                onMomentumScrollEnd={handleGallerySettled}
                style={styles.gallery}
                contentContainerStyle={styles.galleryContent}
                accessibilityRole="adjustable"
                accessibilityLabel="Media gallery"
                accessibilityValue={{
                  min: 1,
                  max: items.length,
                  now: currentIndex + 1,
                  text: `${currentIndex + 1} of ${items.length}`,
                }}
              >
                {items.map((item, index) => {
                  const itemKind = inferKind(item)
                  const isActive = index === currentIndex
                  const shouldLoad = isActive || (itemKind === 'photo' && Math.abs(index - currentIndex) <= 1)

                  return (
                    <LightboxMediaPage
                      key={`${item.uri}:${index}`}
                      item={item}
                      isActive={isActive}
                      shouldLoad={shouldLoad}
                      width={pageWidth}
                    />
                  )
                })}
              </ScrollView>
            </View>

            {items.length > 1 ? (
              <View style={styles.pagerRow}>
                <TouchableOpacity
                  onPress={() => canGoBack && showMediaAt(currentIndex - 1)}
                  disabled={!canGoBack}
                  style={[styles.pagerButton, !canGoBack && styles.pagerButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Show previous media"
                >
                  <Feather name="chevron-left" size={20} color={Colors.textInverse} />
                </TouchableOpacity>
                <View style={styles.pageDots} accessibilityElementsHidden>
                  {items.map((item, index) => (
                    <View
                      key={`${item.uri}:dot:${index}`}
                      style={[styles.pageDot, index === currentIndex && styles.pageDotActive]}
                    />
                  ))}
                </View>
                <TouchableOpacity
                  onPress={() => canGoForward && showMediaAt(currentIndex + 1)}
                  disabled={!canGoForward}
                  style={[styles.pagerButton, !canGoForward && styles.pagerButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Show next media"
                >
                  <Feather name="chevron-right" size={20} color={Colors.textInverse} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  panel: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: FontSize.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.md,
  },
  galleryFrame: {
    flex: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  gallery: {
    flex: 1,
  },
  galleryContent: {
    alignItems: 'stretch',
  },
  mediaPage: {
    flex: 1,
    backgroundColor: Colors.ink,
  },
  media: {
    width: '100%',
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaLoading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFallback: {
    width: '100%',
    flex: 1,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pagerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageDots: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  pageDotActive: {
    width: 20,
    backgroundColor: Colors.textInverse,
  },
  pagerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pagerButtonDisabled: {
    opacity: 0.35,
  },
})
