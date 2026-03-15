import { Tabs } from 'expo-router'
import { Pressable } from 'react-native'
import { Colors, FontSize } from '@/constants/theme'

export default function CustomerTabLayout() {
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
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon emoji="🏠" color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-home" />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color }) => <TabIcon emoji="🔍" color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-search" />,
        }}
      />
      <Tabs.Screen
        name="orders/index"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => <TabIcon emoji="📦" color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-orders" />,
        }}
      />
      <Tabs.Screen
        name="profile/index"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon emoji="👤" color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-profile" />,
        }}
      />
      {/* Hidden stack routes — not shown in tab bar */}
      <Tabs.Screen name="tailor/[id]" options={{ href: null }} />
      <Tabs.Screen name="orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="brief/[tailorId]" options={{ href: null }} />
      <Tabs.Screen name="messages/[orderId]" options={{ href: null }} />
      <Tabs.Screen name="profile/measurements" options={{ href: null }} />
      <Tabs.Screen name="review/[orderId]" options={{ href: null }} />
    </Tabs>
  )
}

function TabIcon({ emoji, color }: { emoji: string; color: string }) {
  const { Text } = require('react-native')
  return <Text style={{ fontSize: 20, opacity: color === Colors.needleGreen ? 1 : 0.5 }}>{emoji}</Text>
}
