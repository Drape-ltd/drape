import { Tabs, useRouter, useSegments } from 'expo-router'
import { Pressable } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { resetTo } from '@/lib/navigation'
import { useCustomerProfile } from '@/lib/customerProfile'
import { useAuth } from '@/lib/auth'
import { useUnreadMessageCount } from '@/lib/unread-messages'
import { useCustomerOrders, useRefreshOnFocus } from '@/lib/queries'
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
  const { data: activeOrders = [], refetch } = useCustomerOrders(user?.id, 'active')

  useRefreshOnFocus(() => {
    void refetch()
  }, 0)

  return activeOrders.length
}

function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { avatarUrl } = useCustomerProfile()

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

export default function CustomerTabLayout() {
  const router = useRouter()
  const segments = useSegments()
  const { user } = useAuth()
  const unreadMessages = useUnreadMessageCount(user?.id, 'CUSTOMER')
  const activeOrderCount = useActiveOrderCount()
  const hideTabBar = segments[0] === '(customer)' && segments.length > 2

  return (
    <DrapeCapsuleNavProvider>
      <Tabs
      tabBar={MOBILE_FEATURE_FLAGS.interactionSystemV1
        ? (props) => <DrapeCapsuleNav {...props} hidden={hideTabBar} />
        : undefined}
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: Colors.bone,
        },
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
          : { minHeight: 49, paddingVertical: 0 },
        tabBarIconStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1 ? undefined : { marginTop: 0 },
        tabBarLabelStyle: MOBILE_FEATURE_FLAGS.interactionSystemV1
          ? undefined
          : { fontSize: 11, marginTop: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ color }) => <Feather name="search" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-home"
              accessibilityRole="button"
              accessibilityLabel="Explore tab"
              onPress={() => resetTo(router, '/(customer)')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Wishlists',
          tabBarButtonTestID: 'tab-saved',
          tabBarIcon: ({ color }) => <Feather name="heart" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-saved"
              accessibilityRole="button"
              accessibilityLabel="Wishlists tab"
              onPress={() => resetTo(router, '/(customer)/saved')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarButtonTestID: 'tab-orders',
          popToTopOnBlur: true,
          tabBarBadge: activeOrderCount > 0 ? (activeOrderCount > 99 ? '99+' : activeOrderCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.kanteRust, fontSize: 10, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <Feather name="package" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-orders"
              accessibilityRole="button"
              accessibilityLabel={activeOrderCount > 0 ? `Orders tab, ${activeOrderCount} active` : 'Orders tab'}
              onPress={() => resetTo(router, { pathname: '/(customer)/orders', params: { tab: 'active' } })}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarButtonTestID: 'tab-messages',
          popToTopOnBlur: true,
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? '99+' : unreadMessages) : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.kanteRust, fontSize: 10, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <Feather name="message-circle" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-messages"
              accessibilityRole="button"
              accessibilityLabel={unreadMessages > 0 ? `Messages tab, ${unreadMessages} unread` : 'Messages tab'}
              onPress={() => resetTo(router, '/(customer)/messages')}
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
              onPress={() => resetTo(router, '/(customer)/profile')}
            />
          ),
        }}
      />
      {/* Hidden stack groups — not shown in tab bar */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="tailor" options={{ href: null }} />
      <Tabs.Screen name="brief" options={{ href: null }} />
      <Tabs.Screen name="review" options={{ href: null }} />
      </Tabs>
    </DrapeCapsuleNavProvider>
  )
}
