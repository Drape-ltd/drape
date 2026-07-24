import { useCallback, useEffect, useRef } from 'react'
import { BackHandler } from 'react-native'
import { useFocusEffect } from 'expo-router'

export function useContextualBackHandler(onBack: () => void, enabled = true) {
  const onBackRef = useRef(onBack)

  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBackRef.current()
        return true
      })

      return () => subscription.remove()
    }, [enabled]),
  )
}
