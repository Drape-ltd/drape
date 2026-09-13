'use client'

import { ArrowUpFromLine } from 'lucide-react'
import { useEffect, useState } from 'react'

function isPasswordInput(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false
  const autoComplete = target.autocomplete.toLowerCase()
  return (
    target.type === 'password' ||
    autoComplete === 'current-password' ||
    autoComplete === 'new-password'
  )
}

export function WebCapsLockSignal() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let passwordFocused = false

    const update = (event: KeyboardEvent | MouseEvent) => {
      if (!passwordFocused) return
      setVisible(event.getModifierState('CapsLock'))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!passwordFocused) return
      if (event.key === 'CapsLock') {
        const reportedState = event.getModifierState('CapsLock')
        setVisible((current) => (reportedState ? true : !current))
        return
      }
      update(event)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'CapsLock') update(event)
    }
    const onFocusIn = (event: FocusEvent) => {
      passwordFocused = isPasswordInput(event.target)
      if (!passwordFocused) setVisible(false)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (isPasswordInput(event.target)) {
        passwordFocused = false
        setVisible(false)
      }
    }

    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('mousedown', update, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('mousedown', update, true)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300/70 bg-[#fff8df] px-4 py-2.5 text-sm font-semibold text-[#5f4510] shadow-xl"
    >
      <ArrowUpFromLine aria-hidden="true" className="size-4" />
      Caps Lock is on
    </div>
  )
}
