import { Tabs, useRouter, useSegments } from 'expo-router'
import { Pressable } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { resetTo } from '@/lib/navigation'
import { useTailorProfile } from '@/lib/tailorProfile'
import { useAuth } from '@/lib/auth'
import { useRefreshOnFocus, useTailorOrders } from '@/lib/queries'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { DrapeCapsuleNav, DrapeCapsuleNavProvider } from '@/components/ui/DrapeCapsuleNav'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'

const PRIMARY_GREEN = Colors.needleGreen
const MUTED_GREY = Colors.midGrey

function pressableTabProps<T extends { ref?: unknown }>(props: T): Omit<T, 'ref'> {
  const { ref, ...buttonProps } = props
  void ref
  return buttonProps
}

function useActiveOrderCount() {
  const { user } = useAuth()
  const { data: activeOrders = [], refetch } = useTailorOrders(user?.id, 'active')

  useRefreshOnFocus(() => {
    void refetch()
  }, 0)

  return activeOrders.length
}

function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { avatarUrl } = useTailorProfile()

  if (avatarUrl) {
    return (
      <AvatarImage
        uri={avatarUrl}
        size={26}
        borderWidth={focused ? 2 : 1.5}
        borderColor={focused ? PRIMARY_GREEN : color}
      />
    )
  }

  return <Feather name="user" size={25} color={color} />
}

export default function TailorTabLayout() {
  const router = useRouter()
  const pendingCount = useActiveOrderCount()
  const segments = useSegments()
  const hideTabBar = segments[0] === '(tailor)' && segments.length > 2

  return (
    <DrapeCapsuleNavProvider>
      <Tabs
      tabBar={MOBILE_FEATURE_FLAGS.interactionSystemV1
        ? (props) => <DrapeCapsuleNav {...props} hidden={hideTabBar} />
        : undefined}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_GREEN,
        tabBarInactiveTintColor: MUTED_GREY,
        tabBarShowLabel: !MOBILE_FEATURE_FLAGS.interactionSystemV1,
        tabBarStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1
          ? undefined
          : {
              backgroundColor: Colors.white,
              borderTopColor: Colors.lightGrey,
              borderTopWidth: 1,
              display: hideTabBar ? 'none' : 'flex',
            },
        tabBarItemStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1
          ? undefined
          : { minHeight: 49, paddingHorizontal: 0, paddingVertical: 0 },
        tabBarIconStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1 ? undefined : { marginTop: 0 },
        tabBarLabelStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1
          ? undefined
          : { fontSize: 11, marginTop: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarButtonTestID: 'tab-dashboard',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="home" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-dashboard"
              accessibilityRole="button"
              accessibilityLabel="Dashboard tab"
              onPress={() => resetTo(router, '/(tailor)')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          tabBarButtonTestID: 'tab-clients',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="users" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-clients"
              accessibilityRole="button"
              accessibilityLabel="Clients tab"
              onPress={() => resetTo(router, '/(tailor)/clients')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarButtonTestID: 'tab-tailor-orders',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="package" size={25} color={color} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.kanteRust, fontSize: 10, minWidth: 16, height: 16 },
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-tailor-orders"
              accessibilityRole="button"
              accessibilityLabel={pendingCount > 0 ? `Orders tab, ${pendingCount} active` : 'Orders tab'}
              onPress={() => resetTo(router, '/(tailor)/orders')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: 'Shop',
          tabBarButtonTestID: 'tab-shop',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="shopping-bag" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-shop"
              accessibilityRole="button"
              accessibilityLabel="Shop tab"
              onPress={() => resetTo(router, '/(tailor)/shop')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButtonTestID: 'tab-profile',
          popToTopOnBlur: true,
          tabBarIcon: ({ color, focused }) => <ProfileTabIcon color={color} focused={focused} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-profile"
              accessibilityRole="button"
              accessibilityLabel="Profile tab"
              onPress={() => resetTo(router, '/(tailor)/profile')}
            />
          ),
        }}
      />

      {/* Hidden routes */}
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
      </Tabs>
    </DrapeCapsuleNavProvider>
  )
}
