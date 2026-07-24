import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { type Href, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useForegroundNotificationNotice } from '@/lib/notifications'
import {
  FontSize,
  FontWeight,
  Fonts,
  Radius,
  Shadow,
  Spacing,
  useDrapeTheme,
} from '@/constants/theme'

const AUTO_DISMISS_MS = 8_000

export function ForegroundNotificationBanner() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useDrapeTheme()
  const { notice, dismiss } = useForegroundNotificationNotice()

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timeout)
  }, [dismiss, notice])

  if (!notice) return null

  function openNotice() {
    const path = notice?.path
    dismiss()
    if (path) router.push(path as Href)
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { paddingTop: Math.max(insets.top, Spacing.sm) }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notice.title}. ${notice.body}`}
        accessibilityHint={notice.path ? 'Opens this update' : 'Dismisses this update'}
        onPress={openNotice}
        style={({ pressed }) => [
          styles.banner,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.lightGrey,
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.needleGreen }]}>
          <Feather name="bell" size={18} color={colors.textInverse} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
            {notice.title}
          </Text>
          <Text numberOfLines={2} style={[styles.body, { color: colors.inkLight }]}>
            {notice.body}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={10}
          onPress={(event) => {
            event.stopPropagation()
            dismiss()
          }}
          style={styles.close}
        >
          <Feather name="x" size={18} color={colors.inkLight} />
        </Pressable>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    zIndex: 5000,
  },
  banner: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    maxWidth: 520,
    minHeight: 72,
    padding: Spacing.sm,
    width: '100%',
    ...Shadow.lg,
  },
  icon: {
    alignItems: 'center',
    borderRadius: Radius.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 17,
  },
  close: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.9,
  },
})
