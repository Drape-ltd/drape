'use client'

import * as React from 'react'
import { TooltipProvider } from './tooltip'

export function UiProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <TooltipProvider delayDuration={320}>{children}</TooltipProvider>
}
