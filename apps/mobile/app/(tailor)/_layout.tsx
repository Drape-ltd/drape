import { Tabs, useRouter, useSegments } from 'expo-router'
import { Image, Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { MaterialIcons } from '@expo/vector-icons'
import { Colors, FontSize, Radius } from '@/constants/theme'
import { useTailorProfile } from '@/lib/tailorProfile'
import { useAuth } from '@/lib/auth'
import { useRefreshOnFocus, useTailorOrders } from '@/lib/queries'

const PRIMARY_GREEN = '#1D9E75'
const MUTED_GREY = '#8F8D88'

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
      <View
        style={{
          width: 26, height: 26, borderRadius: Radius.full,
          borderWidth: focused ? 2 : 1.5,
          borderColor: focused ? PRIMARY_GREEN : color,
          overflow: 'hidden',
        }}
      >
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      </View>
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
          paddingHorizontal: 10,
          paddingTop: 4,
          display: hideTabBar ? 'none' : 'flex',
        },
        tabBarItemStyle: {
          minHeight: 49,
          paddingHorizontal: 2,
          paddingVertical: 2,
        },
        tabBarIconStyle: {
          marginTop: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: -2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={25} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-dashboard" />,
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
          tabBarIcon: ({ color }) => <MaterialIcons name="shopping-cart" size={25} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-shop" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarIcon: ({ color, focused }: any) => <ProfileTabIcon color={color} focused={focused} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-profile" />,
        }}
      />

      {/* Hidden routes */}
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
    </Tabs>
  )
}
