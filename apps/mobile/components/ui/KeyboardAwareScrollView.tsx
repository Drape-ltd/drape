import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import {
  findNodeHandle,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native'

type KeyboardScrollResponder = {
  scrollResponderScrollNativeHandleToKeyboard?: (
    nodeHandle: number,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean,
  ) => void
}

type KeyboardAwareScrollHandle = ScrollView & {
  getScrollResponder?: () => KeyboardScrollResponder
}

type MeasurableInput = {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void
}

export type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keyboardClearance?: number
}

/**
 * Reveals the focused native input when the keyboard opens, focus moves while
 * it is already open, or multiline content grows. KeyboardAvoidingView alone
 * only resizes the viewport and cannot guarantee caret/error visibility.
 */
export const KeyboardAwareScrollView = forwardRef<
  ScrollView,
  KeyboardAwareScrollViewProps
>(function KeyboardAwareScrollView(
  {
    keyboardClearance = Platform.OS === 'android' ? 132 : 104,
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    automaticallyAdjustKeyboardInsets = Platform.OS === 'ios',
    onFocus,
    onScroll,
    onContentSizeChange,
    scrollEventThrottle = 16,
    ...props
  },
  forwardedRef,
) {
  const scrollRef = useRef<KeyboardAwareScrollHandle | null>(null)
  const keyboardEventRef = useRef<KeyboardEvent | null>(null)
  const scrollOffsetRef = useRef(0)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView)

  const revealFocusedInput = useCallback((event = keyboardEventRef.current) => {
    if (!event) return
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    revealTimerRef.current = setTimeout(() => {
      const focused = TextInput.State.currentlyFocusedInput?.() as MeasurableInput | null
      if (!focused) return

      const nodeHandle = findNodeHandle(focused as never)
      const responder = scrollRef.current?.getScrollResponder?.()
      if (nodeHandle && responder?.scrollResponderScrollNativeHandleToKeyboard) {
        responder.scrollResponderScrollNativeHandleToKeyboard(
          nodeHandle,
          keyboardClearance,
          true,
        )
        return
      }

      focused.measureInWindow?.((_x, y, _width, height) => {
        const overlap = y + height + keyboardClearance - event.endCoordinates.screenY
        if (overlap <= 0) return
        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollOffsetRef.current + overlap),
          animated: true,
        })
      })
    }, Platform.OS === 'android' ? 120 : 40)
  }, [keyboardClearance])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const changeEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = (event: KeyboardEvent) => {
      keyboardEventRef.current = event
      revealFocusedInput(event)
    }
    const show = Keyboard.addListener(showEvent, onShow)
    const change = changeEvent === showEvent
      ? null
      : Keyboard.addListener(changeEvent, onShow)
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardEventRef.current = null
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    })
    return () => {
      show.remove()
      change?.remove()
      hide.remove()
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    }
  }, [revealFocusedInput])

  return (
    <ScrollView
      {...props}
      ref={(node) => {
        scrollRef.current = node as KeyboardAwareScrollHandle | null
      }}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      scrollEventThrottle={scrollEventThrottle}
      onFocus={(event) => {
        onFocus?.(event)
        revealFocusedInput()
      }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y
        onScroll?.(event)
      }}
      onContentSizeChange={(width, height) => {
        onContentSizeChange?.(width, height)
        revealFocusedInput()
      }}
    />
  )
})
