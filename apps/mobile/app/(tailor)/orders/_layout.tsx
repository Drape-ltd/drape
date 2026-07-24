import { Stack } from 'expo-router'

export default function TailorOrdersLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="fulfillment-payment/[id]" />
    </Stack>
  )
}
