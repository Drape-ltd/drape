import { MediaLightboxModal, type MediaLightboxItem } from './MediaLightboxModal'

export function DrapeMediaViewer({
  items,
  activeIndex,
  onDismiss,
  onOpenItemActions,
  testID,
}: {
  items: MediaLightboxItem[]
  activeIndex: number | null
  onDismiss: () => void
  onOpenItemActions?: (item: MediaLightboxItem, index: number) => void
  testID?: string
}) {
  return (
    <MediaLightboxModal
      items={items}
      activeIndex={activeIndex}
      onDismiss={onDismiss}
      onOpenItemActions={onOpenItemActions}
      testID={testID}
    />
  )
}

export type { MediaLightboxItem as DrapeMediaViewerItem }
