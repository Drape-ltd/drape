import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

export type ChoiceSheetOption = {
  value: string
  title: string
  body?: string
  meta?: string
  icon?: keyof typeof Feather.glyphMap
  materialIcon?: keyof typeof MaterialCommunityIcons.glyphMap
  disabled?: boolean
}

type ChoiceSheetProps = {
  visible: boolean
  title: string
  subtitle?: string
  options: ChoiceSheetOption[]
  selectedValue?: string | null
  selectedValues?: string[]
  multiple?: boolean
  doneLabel?: string
  onSelect: (value: string) => void
  onClose: () => void
  onDone?: () => void
}

export function ChoiceSheet({
  visible,
  title,
  subtitle,
  options,
  selectedValue,
  selectedValues = [],
  multiple = false,
  doneLabel = 'Done',
  onSelect,
  onClose,
  onDone,
}: ChoiceSheetProps) {
  const insets = useSafeAreaInsets()

  function isSelected(value: string) {
    return multiple ? selectedValues.includes(value) : selectedValue === value
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, 36) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close choices"
              hitSlop={8}
            >
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.options}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {options.map((option) => {
              const selected = isSelected(option.value)
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.option,
                    selected && styles.optionSelected,
                    option.disabled && styles.optionDisabled,
                  ]}
                  onPress={() => onSelect(option.value)}
                  disabled={option.disabled}
                  activeOpacity={0.76}
                  accessibilityRole={multiple ? 'checkbox' : 'button'}
                  accessibilityState={{ selected, checked: multiple ? selected : undefined, disabled: option.disabled }}
                  accessibilityLabel={option.title}
                  accessibilityHint={option.body}
                >
                  {option.icon || option.materialIcon ? (
                    <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                      {option.materialIcon ? (
                        <MaterialCommunityIcons
                          name={option.materialIcon}
                          size={19}
                          color={selected ? Colors.needleGreen : Colors.inkLight}
                        />
                      ) : option.icon ? (
                        <Feather
                          name={option.icon}
                          size={18}
                          color={selected ? Colors.needleGreen : Colors.inkLight}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                      {option.title}
                    </Text>
                    {option.body ? <Text style={styles.optionBody}>{option.body}</Text> : null}
                    {option.meta ? <Text style={styles.optionMeta}>{option.meta}</Text> : null}
                  </View>
                  <View style={[styles.check, selected && styles.checkSelected]}>
                    {selected ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
                  </View>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          {multiple ? (
            <TouchableOpacity
              style={styles.doneButton}
              onPress={onDone ?? onClose}
              accessibilityRole="button"
              accessibilityLabel={doneLabel}
            >
              <Text style={styles.doneText}>{doneLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: Colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    gap: Spacing.lg,
    ...Shadow.lg,
  },
  handle: {
    width: 72,
    height: 5,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  headerCopy: { flex: 1, gap: 4 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    lineHeight: 30,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.inkLight,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  options: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  option: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
  },
  optionSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  optionDisabled: { opacity: 0.45 },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconSelected: { backgroundColor: Colors.white },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    lineHeight: 22,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  optionTitleSelected: { color: Colors.needleGreen },
  optionBody: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 19,
    color: Colors.inkLight,
  },
  optionMeta: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.midGrey,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  checkSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  doneButton: {
    minHeight: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  doneText: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.md,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
})
