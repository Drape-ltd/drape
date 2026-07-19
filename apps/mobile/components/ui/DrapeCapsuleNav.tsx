import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Tabs, useFocusEffect, useRouter, useSegments, type Router } from 'expo-router'
import { Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Spacing,
  getDrapeColorScheme,
} from '@/constants/theme'

type ExpoTabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>
type DrapeCapsuleNavProps = Parameters<ExpoTabBarRenderer>[0] & { hidden?: boolean }
type TabRootTarget = Parameters<Router['replace']>[0]

export const DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE = 140

type DrapeCapsuleNavMotion = {
  compact: boolean
  setCompact: (compact: boolean) => void
}

const DrapeCapsuleNavMotionContext = createContext<DrapeCapsuleNavMotion>({
  compact: false,
  setCompact: () => undefined,
})

function tabRootTarget(group: string | undefined, routeName: string): TabRootTarget | null {
  if (group === '(customer)') {
    if (routeName === 'index') return '/(customer)'
    if (routeName === 'saved') return '/(customer)/saved'
    if (routeName === 'orders') return { pathname: '/(customer)/orders', params: { tab: 'active' } }
    if (routeName === 'messages') return '/(customer)/messages'
    if (routeName === 'profile') return '/(customer)/profile'
  }

  if (group === '(tailor)') {
    if (routeName === 'index') return '/(tailor)'
    if (routeName === 'clients') return '/(tailor)/clients'
    if (routeName === 'orders') return '/(tailor)/orders'
    if (routeName === 'shop') return '/(tailor)/shop'
    if (routeName === 'profile') return '/(tailor)/profile'
  }

  return null
}

function nestedTabRootParams(group: string | undefined, routeName: string) {
  if (group === '(customer)') {
    if (routeName === 'orders') return { screen: 'index', params: { tab: 'active' } }
    if (routeName === 'messages' || routeName === 'profile') return { screen: 'index' }
  }

  if (group === '(tailor)') {
    if (routeName === 'clients' || routeName === 'orders' || routeName === 'shop' || routeName === 'profile') {
      return { screen: 'index' }
    }
  }

  return null
}

export function DrapeCapsuleNavProvider({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(false)
  const value = useMemo(() => ({ compact, setCompact }), [compact])

  return (
    <DrapeCapsuleNavMotionContext.Provider value={value}>
      {children}
    </DrapeCapsuleNavMotionContext.Provider>
  )
}

export function useDrapeCapsuleNavMotion() {
  return useContext(DrapeCapsuleNavMotionContext)
}

export function useDrapeCapsuleNavScroll() {
  const { setCompact } = useDrapeCapsuleNavMotion()
  const lastScrollYRef = useRef(0)

  useFocusEffect(
    useCallback(() => {
      setCompact(false)
      lastScrollYRef.current = 0
      return () => setCompact(false)
    }, [setCompact]),
  )

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextY = Math.max(0, event.nativeEvent.contentOffset.y)
    const delta = nextY - lastScrollYRef.current

    if (nextY <= 16) {
      setCompact(false)
    } else if (delta >= 8) {
      setCompact(true)
    } else if (delta <= -8) {
      setCompact(false)
    }

    if (Math.abs(delta) >= 2) {
      lastScrollYRef.current = nextY
    }
  }, [setCompact])

  return { onScroll, scrollEventThrottle: 16 as const }
}

export function DrapeCapsuleNav({
  state,
  descriptors,
  navigation,
  hidden = false,
}: DrapeCapsuleNavProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const segments = useSegments()
  const { compact, setCompact } = useDrapeCapsuleNavMotion()
  const compactProgress = useSharedValue(compact ? 1 : 0)
  const darkMode = getDrapeColorScheme() === 'dark'
  const dockBackgroundColor = darkMode ? Colors.surfaceElevated : Colors.needleGreenDark
  const activeBackgroundColor = darkMode ? Colors.needleGreen : 'rgba(255,255,255,0.18)'

  useEffect(() => {
    compactProgress.value = withTiming(compact ? 1 : 0, { duration: 180 })
  }, [compact, compactProgress])

  const capsuleMotionStyle = useAnimatedStyle(() => ({
    left: interpolate(compactProgress.value, [0, 1], [Spacing.xl, Spacing.xxxl]),
    right: interpolate(compactProgress.value, [0, 1], [Spacing.xl, Spacing.xxxl]),
    height: interpolate(compactProgress.value, [0, 1], [60, 52]),
  }))

  if (hidden) return null

  // Expo Router keeps href-null routes in the navigation state, but strips the
  // href marker before this renderer sees the descriptor. Visible tabs always
  // provide an icon; child stack routes do not.
  const visibleRoutes = state.routes.filter((route) => (
    descriptors[route.key]?.options.tabBarIcon != null
  ))
  const bottomInset = Math.max(insets.bottom, Spacing.sm)

  return (
    <View style={[styles.reserve, { height: 68 + bottomInset }]} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.capsule,
          capsuleMotionStyle,
          { bottom: bottomInset, backgroundColor: dockBackgroundColor, borderColor: Colors.lightGrey },
        ]}
      >
        {visibleRoutes.map((route) => {
          const descriptor = descriptors[route.key]
          if (!descriptor) return null
          const options = descriptor.options
          const focused = state.routes[state.index]?.key === route.key
          const label = typeof options.tabBarAccessibilityLabel === 'string'
            ? options.tabBarAccessibilityLabel.replace(/ tab.*$/iu, '')
            : typeof options.title === 'string'
              ? options.title
              : route.name
          const badge = options.tabBarBadge

          function handlePress() {
            setCompact(false)
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            })
            if (event.defaultPrevented) return

            const nestedRootParams = nestedTabRootParams(segments[0], route.name)
            if (nestedRootParams) {
              const targetIndex = state.routes.findIndex((candidate) => candidate.key === route.key)
              navigation.reset({
                ...state,
                index: targetIndex,
                routes: state.routes.map((candidate) => (
                  candidate.key === route.key
                    ? {
                        ...candidate,
                        state: {
                          index: 0,
                          routes: [{
                            name: nestedRootParams.screen,
                            ...('params' in nestedRootParams ? { params: nestedRootParams.params } : {}),
                          }],
                        },
                      }
                    : candidate
                )),
              })
              return
            }

            const rootTarget = tabRootTarget(segments[0], route.name)
            if (rootTarget) {
              router.replace(rootTarget)
              return
            }

            if (!focused) navigation.navigate(route.name, route.params)
          }

          return (
            <Pressable
              key={route.key}
              testID={options.tabBarButtonTestID}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label} tab`}
              accessibilityState={{ selected: focused }}
              onPress={handlePress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={({ pressed }) => [
                styles.destination,
                focused && { backgroundColor: activeBackgroundColor },
                pressed && styles.destinationPressed,
              ]}
            >
              {options.tabBarIcon?.({
                focused,
                color: Colors.textInverse,
                size: 24,
              })}
              {badge != null ? (
                <View style={[styles.badge, { borderColor: dockBackgroundColor }]}>
                  <Text style={styles.badgeLabel}>{String(badge)}</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  reserve: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 24,
    backgroundColor: 'transparent',
  },
  capsule: {
    position: 'absolute',
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.lg,
  },
  destination: {
    flex: 1,
    minWidth: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationPressed: { opacity: 0.72 },
  badge: {
    position: 'absolute',
    top: 2,
    right: 7,
    minWidth: 18,
    height: 18,
    borderRadius: Radius.full,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.kanteRust,
    borderWidth: 2,
  },
  badgeLabel: {
    fontSize: FontSize.xs,
    lineHeight: 13,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
})
