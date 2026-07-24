import { Stack } from 'expo-router'

export default function TailorMessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="[orderId]" />
    </Stack>
  )
}
