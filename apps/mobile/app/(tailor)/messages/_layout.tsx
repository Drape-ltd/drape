import { Stack } from 'expo-router'

export default function TailorMessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[orderId]" />
    </Stack>
  )
}
