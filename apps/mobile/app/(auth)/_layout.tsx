import { Stack } from 'expo-router'
import { Colors } from '@/constants/theme'
import { DrapeCapsuleNavProvider } from '@/components/ui/DrapeCapsuleNav'

export default function AuthLayout() {
  return (
    <DrapeCapsuleNavProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
          contentStyle: { backgroundColor: Colors.bone },
          animation: 'slide_from_right',
        }}
      />
    </DrapeCapsuleNavProvider>
  )
}
