import { Tabs, useRouter, useSegments } from 'expo-router'
import { Pressable } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { MaterialIcons } from '@expo/vector-icons'
import { Colors, FontSize, Radius } from '@/constants/theme'
import { useTailorProfile } from '@/lib/tailorProfile'
import { useAuth } from '@/lib/auth'
import { useRefreshOnFocus, useTailorOrders } from '@/lib/queries'
import { AvatarImage } from '@/components/ui/AvatarImage'

const PRIMARY_GREEN = Colors.needleGreen
const MUTED_GREY = Colors.midGrey

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
  const pendingCount = useActiveOrderCount()
  const segments = useSegments()
  const hideTabBar = segments[0] === '(tailor)' && segments.length > 2

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => (
            <Pressable
              {...props}
              testID="tab-dashboard"
              accessibilityRole="button"
              accessibilityLabel="Dashboard tab"
              onPress={() => router.replace('/(tailor)')}
              onLongPress={props.onLongPress}
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => (
            <Pressable
              {...props}
              testID="tab-clients"
              accessibilityRole="button"
              accessibilityLabel="Clients tab"
              onPress={() => router.replace('/(tailor)/clients')}
              onLongPress={props.onLongPress}
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => (
            <Pressable
              {...props}
              testID="tab-tailor-orders"
              accessibilityRole="button"
              accessibilityLabel={pendingCount > 0 ? `Orders tab, ${pendingCount} active` : 'Orders tab'}
              onPress={() => router.replace('/(tailor)/orders')}
              onLongPress={props.onLongPress}
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => (
            <Pressable
              {...props}
              testID="tab-shop"
              accessibilityRole="button"
              accessibilityLabel="Shop tab"
              onPress={() => router.replace('/(tailor)/shop')}
              onLongPress={props.onLongPress}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          popToTopOnBlur: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarIcon: ({ color, focused }: any) => <ProfileTabIcon color={color} focused={focused} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => (
            <Pressable
              {...props}
              testID="tab-profile"
              accessibilityRole="button"
              accessibilityLabel="Profile tab"
              onPress={() => router.replace('/(tailor)/profile')}
              onLongPress={props.onLongPress}
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
