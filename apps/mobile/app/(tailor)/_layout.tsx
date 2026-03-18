import { useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { Image, Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, Radius } from '@/constants/theme'
import { useTailorProfile } from '@/lib/tailorProfile'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

function usePendingQuoteCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!user?.id) return

    function fetch() {
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('tailor_id', user!.id)
        .eq('stage', 'PENDING_QUOTE')
        .then(({ count: c }) => setCount(c ?? 0))
    }

    fetch()

    const channel = supabase
      .channel(`pending-quotes-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: `tailor_id=eq.${user.id}`,
      }, fetch)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  return count
}

function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { avatarUrl } = useTailorProfile()

  if (avatarUrl) {
    return (
      <View
        style={{
          width: 28, height: 28, borderRadius: Radius.full,
          borderWidth: focused ? 2 : 1.5,
          borderColor: focused ? Colors.needleGreen : color,
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

  return <Feather name="user" size={22} color={color} />
}

export default function TailorTabLayout() {
  const pendingCount = usePendingQuoteCount()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.needleGreen,
        tabBarInactiveTintColor: Colors.midGrey,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.lightGrey,
          borderTopWidth: 1,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          marginTop: -2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-dashboard" />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-clients" />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => <Feather name="package" size={22} color={color} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.kanteRust, fontSize: 10, minWidth: 16, height: 16 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-tailor-orders" />,
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
