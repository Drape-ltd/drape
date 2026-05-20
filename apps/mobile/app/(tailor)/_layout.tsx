import { Tabs, useRouter, useSegments } from 'expo-router'
import { Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { MaterialIcons } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { useTailorProfile } from '@/lib/tailorProfile'
import { useAuth } from '@/lib/auth'
import { useRefreshOnFocus, useTailorOrders } from '@/lib/queries'
import { AvatarImage } from '@/components/ui/AvatarImage'

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
  }, 15_000)

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
  const insets = useSafeAreaInsets()
  const pendingCount = useActiveOrderCount()
  const segments = useSegments()
  const hideTabBar = segments[0] === '(tailor)' && segments.length > 2
  const bottomInset = Math.max(insets.bottom, 8)

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_GREEN,
        tabBarInactiveTintColor: MUTED_GREY,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.lightGrey,
          borderTopWidth: 1,
          height: 62 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
          display: hideTabBar ? 'none' : 'flex',
        },
        tabBarItemStyle: {
          minHeight: 49,
          paddingHorizontal: 0,
          paddingVertical: 0,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-dashboard"
              accessibilityRole="button"
              accessibilityLabel="Dashboard tab"
              onPress={() => router.replace('/(tailor)')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="users" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-clients"
              accessibilityRole="button"
              accessibilityLabel="Clients tab"
              onPress={() => router.replace('/(tailor)/clients')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => <Feather name="package" size={25} color={color} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.kanteRust, fontSize: 10, minWidth: 16, height: 16 },
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-tailor-orders"
              accessibilityRole="button"
              accessibilityLabel={pendingCount > 0 ? `Orders tab, ${pendingCount} active` : 'Orders tab'}
              onPress={() => router.replace('/(tailor)/orders')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: 'Shop',
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <MaterialIcons name="shopping-cart" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-shop"
              accessibilityRole="button"
              accessibilityLabel="Shop tab"
              onPress={() => router.replace('/(tailor)/shop')}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          popToTopOnBlur: true,
          tabBarIcon: ({ color, focused }) => <ProfileTabIcon color={color} focused={focused} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-profile"
              accessibilityRole="button"
              accessibilityLabel="Profile tab"
              onPress={() => router.replace('/(tailor)/profile')}
            />
          ),
        }}
      />

      {/* Hidden routes */}
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
    </Tabs>
  )
}
