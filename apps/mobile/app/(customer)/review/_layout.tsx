import { Stack } from 'expo-router'

export default function ReviewLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[orderId]" />
    </Stack>
  )
}
