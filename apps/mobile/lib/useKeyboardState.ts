import { useEffect, useState } from 'react'
import { Keyboard, type KeyboardEvent } from 'react-native'

type KeyboardState = {
  visible: boolean
  height: number
}

export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ visible: false, height: 0 })

  useEffect(() => {
    const handleShow = (event: KeyboardEvent) => {
      setState({
        visible: true,
        height: event.endCoordinates.height,
      })
    }
    const handleHide = () => {
      setState({ visible: false, height: 0 })
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', handleShow)
    const hideSubscription = Keyboard.addListener('keyboardDidHide', handleHide)

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  return state
}
