import { Tabs } from 'expo-router'
import { Image, Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, Radius } from '@/constants/theme'
import { useCustomerProfile } from '@/lib/customerProfile'

function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { avatarUrl } = useCustomerProfile()

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
          title: 'Explore',
          tabBarIcon: ({ color }) => <Feather name="search" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-home" />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Wishlists',
          tabBarIcon: ({ color }) => <Feather name="heart" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-saved" />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => <Feather name="package" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-orders" />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <Feather name="message-circle" size={22} color={color} />,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tabBarButton: (props: any) => <Pressable {...props} testID="tab-messages" />,
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
      {/* Hidden stack groups — not shown in tab bar */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="tailor" options={{ href: null }} />
      <Tabs.Screen name="brief" options={{ href: null }} />
      <Tabs.Screen name="review" options={{ href: null }} />
    </Tabs>
  )
}
