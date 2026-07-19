import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type DimensionValue,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { bottomSheetRuntime, nativeBottomSheetAvailable } from '@/lib/native-sheet-runtime'

type BottomSheetActionTone = 'primary' | 'secondary' | 'destructive'

export type BottomSheetScaffoldAction = {
  label: string
  onPress: () => void
  testID?: string
  disabled?: boolean
  loading?: boolean
  accessibilityLabel?: string
  tone?: BottomSheetActionTone
}

type BottomSheetScaffoldProps = {
  visible: boolean
  title: string
  subtitle?: string | null
  onDismiss: () => void
  children: ReactNode
  scrollable?: boolean
  snapPoints?: Array<number | string>
  enableDynamicSizing?: boolean
  primaryAction?: BottomSheetScaffoldAction
  secondaryAction?: BottomSheetScaffoldAction
  destructiveAction?: BottomSheetScaffoldAction
  testID?: string
}

type SheetFrameProps = {
  title: string
  subtitle?: string | null
  children: ReactNode
  scrollable: boolean
  actions: BottomSheetScaffoldAction[]
  onClose: () => void
  useNativeSheetBody?: boolean
  standaloneNativeFrame?: boolean
  bottomInset: number
  testID?: string
}

function SheetActionButton({ action }: { action: BottomSheetScaffoldAction }) {
  return (
    <TouchableOpacity
      key={action.label}
      onPress={action.onPress}
      disabled={action.disabled || action.loading}
      style={[
        styles.footerAction,
        action.tone === 'primary' && styles.footerActionPrimary,
        action.tone === 'secondary' && styles.footerActionSecondary,
        action.tone === 'destructive' && styles.footerActionDestructive,
        (action.disabled || action.loading) && styles.footerActionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      testID={action.testID}
    >
      {action.loading ? (
        <ActivityIndicator
          size="small"
          color={action.tone === 'secondary' ? Colors.ink : Colors.textInverse}
        />
      ) : (
        <Text
          style={[
            styles.footerActionLabel,
            action.tone === 'secondary' && styles.footerActionLabelSecondary,
            action.tone === 'destructive' && styles.footerActionLabelDestructive,
          ]}
        >
          {action.label}
        </Text>
      )}
    </TouchableOpacity>
  )
}

function SheetFrame({
  title,
  subtitle,
  children,
  scrollable,
  actions,
  onClose,
  useNativeSheetBody = false,
  standaloneNativeFrame = false,
  bottomInset,
  testID,
}: SheetFrameProps) {
  const RuntimeBottomSheetScrollView = bottomSheetRuntime?.BottomSheetScrollView
  const RuntimeBottomSheetView = bottomSheetRuntime?.BottomSheetView

  const body = scrollable
    ? useNativeSheetBody && RuntimeBottomSheetScrollView
      ? (
        <RuntimeBottomSheetScrollView
          style={styles.scrollBody}
          contentContainerStyle={[
            styles.scrollContent,
            standaloneNativeFrame && styles.standaloneScrollContent,
            { paddingBottom: Spacing.xl + bottomInset },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {children}
        </RuntimeBottomSheetScrollView>
      )
      : (
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xl + bottomInset }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {children}
        </ScrollView>
      )
    : useNativeSheetBody && RuntimeBottomSheetView
      ? <RuntimeBottomSheetView style={styles.body}>{children}</RuntimeBottomSheetView>
      : <View style={styles.body}>{children}</View>

  return (
    <>
      <View
        style={[styles.header, standaloneNativeFrame && styles.standaloneHeader]}
        testID={testID}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={'Close ' + title}
        >
          <Feather name="x" size={20} color={Colors.ink} />
        </TouchableOpacity>
      </View>

      {body}

      {actions.length > 0 ? (
        <View
          style={[
            styles.footer,
            standaloneNativeFrame && styles.standaloneFooter,
            { paddingBottom: bottomInset },
          ]}
        >
          {actions.map((action) => <SheetActionButton key={action.label} action={action} />)}
        </View>
      ) : null}
    </>
  )
}

export function BottomSheetScaffold({
  visible,
  title,
  subtitle,
  onDismiss,
  children,
  scrollable = false,
  snapPoints,
  enableDynamicSizing,
  primaryAction,
  secondaryAction,
  destructiveAction,
  testID,
}: BottomSheetScaffoldProps) {
  const insets = useSafeAreaInsets()
  const contentBottomInset = Math.max(insets.bottom, Spacing.sm)
  const modalRef = useRef<{ present?: () => void; dismiss?: () => void } | null>(null)
  const presentedRef = useRef(false)
  const shouldEnableDynamicSizing = enableDynamicSizing ?? !scrollable
  const resolvedSnapPoints = useMemo(
    () => snapPoints ?? (scrollable ? ['88%'] : ['68%']),
    [scrollable, snapPoints],
  )
  const fallbackSheetHeight = shouldEnableDynamicSizing
    ? undefined
    : resolvedSnapPoints[0] as DimensionValue | undefined
  const actions = [primaryAction, secondaryAction, destructiveAction].filter(Boolean) as BottomSheetScaffoldAction[]

  const RuntimeBottomSheetBackdrop = bottomSheetRuntime?.BottomSheetBackdrop
  const RuntimeBottomSheetModal = bottomSheetRuntime?.BottomSheetModal
  const RuntimeBottomSheetView = bottomSheetRuntime?.BottomSheetView
  const canUseNativeSheet =
    nativeBottomSheetAvailable &&
    !!RuntimeBottomSheetBackdrop &&
    !!RuntimeBottomSheetModal &&
    !!RuntimeBottomSheetView

  useEffect(() => {
    if (!canUseNativeSheet) return
    const modal = modalRef.current
    if (!modal) return

    if (visible && !presentedRef.current) {
      presentedRef.current = true
      modal.present?.()
      return
    }

    if (!visible && presentedRef.current) {
      presentedRef.current = false
      modal.dismiss?.()
    }
  }, [canUseNativeSheet, visible])

  function handleDismiss() {
    const wasPresented = presentedRef.current
    presentedRef.current = false
    if (wasPresented || visible) onDismiss()
  }

  if (!canUseNativeSheet || !RuntimeBottomSheetModal || !RuntimeBottomSheetView) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={onDismiss}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={'Dismiss ' + title}
          />
          <View
            style={[
              styles.sheetBackground,
              styles.fallbackSheetBackground,
              scrollable && styles.fallbackSheetBackgroundScrollable,
              fallbackSheetHeight !== undefined && { height: fallbackSheetHeight },
            ]}
          >
            <View style={styles.handleIndicator} />
            <View style={[styles.frame, scrollable && styles.frameScrollable]}>
              <SheetFrame
                title={title}
                subtitle={subtitle}
                scrollable={scrollable}
                actions={actions}
                onClose={onDismiss}
                bottomInset={contentBottomInset}
                testID={testID}
              >
                {children}
              </SheetFrame>
            </View>
          </View>
        </View>
      </Modal>
    )
  }

  return (
    <RuntimeBottomSheetModal
      ref={modalRef}
      onDismiss={handleDismiss}
      enableDynamicSizing={shouldEnableDynamicSizing}
      snapPoints={shouldEnableDynamicSizing ? undefined : resolvedSnapPoints}
      backdropComponent={(props: unknown) => (
        <RuntimeBottomSheetBackdrop
          {...(props as object)}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.46}
          pressBehavior="close"
        />
      )}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      enablePanDownToClose={!scrollable}
    >
      {scrollable ? (
        <SheetFrame
          title={title}
          subtitle={subtitle}
          scrollable
          actions={actions}
          onClose={() => modalRef.current?.dismiss?.()}
          useNativeSheetBody
          standaloneNativeFrame
          bottomInset={contentBottomInset}
          testID={testID}
        >
          {children}
        </SheetFrame>
      ) : (
        <RuntimeBottomSheetView style={styles.frame}>
          <SheetFrame
            title={title}
            subtitle={subtitle}
            scrollable={false}
            actions={actions}
            onClose={() => modalRef.current?.dismiss?.()}
            useNativeSheetBody
            bottomInset={contentBottomInset}
            testID={testID}
          >
            {children}
          </SheetFrame>
        </RuntimeBottomSheetView>
      )}
    </RuntimeBottomSheetModal>
  )
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 17, 17, 0.46)',
  },
  sheetBackground: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    ...Shadow.lg,
  },
  fallbackSheetBackground: {
    maxHeight: '82%',
    paddingTop: Spacing.sm,
  },
  fallbackSheetBackgroundScrollable: {
    height: '82%',
  },
  handleIndicator: {
    alignSelf: 'center',
    backgroundColor: Colors.lightGrey,
    width: 44,
    height: 5,
    borderRadius: Radius.full,
  },
  frame: {
    flexShrink: 1,
    minHeight: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  frameScrollable: {
    flex: 1,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  standaloneHeader: {
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  subtitle: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.inkLight,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  body: {
    minHeight: 0,
    gap: Spacing.md,
  },
  scrollBody: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  standaloneScrollContent: {
    paddingHorizontal: Spacing.lg,
  },
  footer: {
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  standaloneFooter: {
    paddingHorizontal: Spacing.lg,
  },
  footerAction: {
    minHeight: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  footerActionPrimary: {
    backgroundColor: Colors.needleGreen,
  },
  footerActionSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  footerActionDestructive: {
    backgroundColor: Colors.error,
  },
  footerActionDisabled: {
    opacity: 0.56,
  },
  footerActionLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
  footerActionLabelSecondary: {
    color: Colors.ink,
  },
  footerActionLabelDestructive: {
    color: Colors.textInverse,
  },
})
