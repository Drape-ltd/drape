import type { ComponentType, ReactNode } from 'react'
import { TurboModuleRegistry, type ViewProps } from 'react-native'

type BottomSheetRuntime = {
  BottomSheetBackdrop: any
  BottomSheetModal: any
  BottomSheetScrollView: any
  BottomSheetView: any
}

function hasGestureHandlerNativeModule() {
  try {
    const registry = TurboModuleRegistry as { get?: (name: string) => unknown }
    return typeof registry.get === 'function' && !!registry.get('RNGestureHandlerModule')
  } catch {
    return false
  }
}

let warnedMissingNativeModules = false

function warnMissingNativeModules(error?: unknown) {
  if (!__DEV__ || warnedMissingNativeModules) return
  warnedMissingNativeModules = true
  const suffix = error instanceof Error ? ` ${error.message}` : ''
  console.warn(
    '[drape] Native gesture/bottom-sheet modules are unavailable in this binary. Falling back to modal sheets until the app is rebuilt.' + suffix,
  )
}

export const gestureHandlerNativeAvailable = hasGestureHandlerNativeModule()
export let GestureHandlerRootViewRuntime: ComponentType<ViewProps> | null = null
export let BottomSheetModalProviderRuntime: ComponentType<{ children?: ReactNode }> | null = null
export let bottomSheetRuntime: BottomSheetRuntime | null = null

if (gestureHandlerNativeAvailable) {
  try {
    require('react-native-gesture-handler')
    const gestureHandler = require('react-native-gesture-handler')
    const bottomSheet = require('@gorhom/bottom-sheet')

    GestureHandlerRootViewRuntime = gestureHandler.GestureHandlerRootView ?? null
    BottomSheetModalProviderRuntime = bottomSheet.BottomSheetModalProvider ?? null
    bottomSheetRuntime = {
      BottomSheetBackdrop: bottomSheet.BottomSheetBackdrop,
      BottomSheetModal: bottomSheet.BottomSheetModal,
      BottomSheetScrollView: bottomSheet.BottomSheetScrollView,
      BottomSheetView: bottomSheet.BottomSheetView,
    }
  } catch (error) {
    warnMissingNativeModules(error)
  }
} else {
  warnMissingNativeModules()
}

export const nativeBottomSheetAvailable = !!bottomSheetRuntime
