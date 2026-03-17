import { Stack } from 'expo-router'
import { Colors } from '@/constants/theme'

export default function PassportLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.bone },
        headerTintColor: Colors.ink,
        headerTitleStyle: { fontWeight: '600', color: Colors.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.bone },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="claim/[passportId]" options={{ title: 'Claim Passport', headerBackTitle: 'Back' }} />
    </Stack>
  )
}
