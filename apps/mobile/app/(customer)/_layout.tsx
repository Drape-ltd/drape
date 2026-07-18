import { Tabs, useRouter, useSegments } from 'expo-router'
import { Pressable } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { resetTo } from '@/lib/navigation'
import { useCustomerProfile } from '@/lib/customerProfile'
import { useAuth } from '@/lib/auth'
import { useUnreadMessageCount } from '@/lib/unread-messages'
import { AvatarImage } from '@/components/ui/AvatarImage'

const PRIMARY_GREEN = Colors.needleGreen
const MUTED_GREY = Colors.midGrey

function pressableTabProps<T extends { ref?: unknown }>(props: T): Omit<T, 'ref'> {
  const { ref, ...buttonProps } = props
  void ref
  return buttonProps
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
  const hideTabBar = segments[0] === '(customer)' && segments.length > 2

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: Colors.bone,
        },
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
          title: 'Explore',
          popToTopOnBlur: true,
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
          popToTopOnBlur: true,
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
          popToTopOnBlur: true,
          tabBarIcon: ({ color }) => <Feather name="package" size={25} color={color} />,
          tabBarButton: (props) => (
            <Pressable
              {...pressableTabProps(props)}
              testID="tab-orders"
              accessibilityRole="button"
              accessibilityLabel="Orders tab"
              onPress={() => resetTo(router, { pathname: '/(customer)/orders', params: { tab: 'active' } })}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
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
  )
}
