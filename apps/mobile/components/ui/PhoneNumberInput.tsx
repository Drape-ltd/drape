import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { FlashList } from '@shopify/flash-list'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  composeInternationalPhoneNumber,
  DEFAULT_PHONE_COUNTRY_CODE,
  FEATURED_PHONE_COUNTRY_CODES,
  getNationalPhoneInput,
  getPhoneCountryOption,
  inferPhoneCountryCode,
  searchPhoneCountries,
  type PhoneCountryCode,
  type PhoneCountryOption,
} from '@drape/shared/phone-countries'
import {
  Fonts,
  FontWeight,
  Radius,
  Spacing,
  useDrapeTheme,
} from '@/constants/theme'

type PhoneNumberInputProps = Omit<
  TextInputProps,
  'keyboardType' | 'onChangeText' | 'value'
> & {
  label?: string
  value: string
  onChangeText: (value: string) => void
  error?: string
  hint?: string
  required?: boolean
  containerStyle?: ViewStyle
  defaultCountryCode?: PhoneCountryCode
  rightElement?: ReactNode
}

function prioritizedCountries(
  query: string,
): readonly PhoneCountryOption[] {
  const matches = searchPhoneCountries(query)
  if (query.trim()) return matches

  const featured = FEATURED_PHONE_COUNTRY_CODES.map(getPhoneCountryOption)
  const featuredCodes = new Set(FEATURED_PHONE_COUNTRY_CODES)
  return [...featured, ...matches.filter((item) => !featuredCodes.has(item.code))]
}

export function PhoneNumberInput({
  label,
  value,
  onChangeText,
  error,
  hint,
  required,
  containerStyle,
  defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
  rightElement,
  onFocus,
  onBlur,
  placeholder = 'Phone number',
  accessibilityLabel,
  accessibilityHint,
  ...inputProps
}: PhoneNumberInputProps) {
  const { colors } = useDrapeTheme()
  const initialCountry = inferPhoneCountryCode(value, defaultCountryCode)
  const [countryCode, setCountryCode] =
    useState<PhoneCountryCode>(initialCountry)
  const [nationalValue, setNationalValue] = useState(() =>
    getNationalPhoneInput(value, initialCountry),
  )
  const [focused, setFocused] = useState(false)
  const [selectorVisible, setSelectorVisible] = useState(false)
  const [query, setQuery] = useState('')
  const lastEmittedValue = useRef<string | null>(null)

  useEffect(() => {
    if (value === lastEmittedValue.current) return

    const nextCountry = inferPhoneCountryCode(value, countryCode)
    setCountryCode(nextCountry)
    setNationalValue(getNationalPhoneInput(value, nextCountry))
  }, [countryCode, value])

  const selectedCountry = getPhoneCountryOption(countryCode)
  const countries = useMemo(() => prioritizedCountries(query), [query])
  const hasError = Boolean(error)

  function emitNationalValue(nextNationalValue: string, code = countryCode) {
    const normalizedValue = nextNationalValue.trim().replace(/^00/, '+')
    const nextCountryCode = normalizedValue.startsWith('+')
      ? inferPhoneCountryCode(normalizedValue, code)
      : code
    const nextDisplayValue = normalizedValue.startsWith('+')
      ? getNationalPhoneInput(normalizedValue, nextCountryCode)
      : nextNationalValue

    if (nextCountryCode !== countryCode) setCountryCode(nextCountryCode)
    setNationalValue(nextDisplayValue)
    const nextValue = composeInternationalPhoneNumber(nextNationalValue, code)
    lastEmittedValue.current = nextValue
    onChangeText(nextValue)
  }

  function openCountrySelector() {
    Keyboard.dismiss()
    setSelectorVisible(true)
  }

  function selectCountry(country: PhoneCountryOption) {
    setCountryCode(country.code)
    setSelectorVisible(false)
    setQuery('')
    emitNationalValue(nationalValue, country.code)
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text
          style={[
            styles.label,
            { color: hasError ? colors.error : colors.ink },
          ]}
        >
          {label}
          {required ? (
            <Text style={{ color: colors.kanteRust }}> *</Text>
          ) : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: colors.white,
            borderColor: hasError
              ? colors.error
              : focused
                ? colors.needleGreen
                : colors.lightGrey,
          },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.countryButton,
            pressed && styles.pressed,
          ]}
          onPress={openCountrySelector}
          accessibilityRole="button"
          accessibilityLabel={`Country code, ${selectedCountry.name} ${selectedCountry.callingCode}`}
          accessibilityHint="Opens the country calling code list"
        >
          <View
            style={[
              styles.isoBadge,
              { backgroundColor: colors.boneDeep },
            ]}
          >
            <Text style={[styles.isoText, { color: colors.ink }]}>
              {selectedCountry.code}
            </Text>
          </View>
          <Text style={[styles.callingCode, { color: colors.ink }]}>
            {selectedCountry.callingCode}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.midGrey} />
        </Pressable>

        <View
          style={[styles.separator, { backgroundColor: colors.lightGrey }]}
        />

        <TextInput
          {...inputProps}
          style={[styles.input, { color: colors.ink }, inputProps.style]}
          value={nationalValue}
          onChangeText={(text) => emitNationalValue(text)}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          placeholder={placeholder}
          placeholderTextColor={colors.midGrey}
          accessibilityLabel={accessibilityLabel ?? label ?? 'Phone number'}
          accessibilityHint={accessibilityHint ?? hint}
        />

        {rightElement ? <View style={styles.right}>{rightElement}</View> : null}
      </View>

      {error || hint ? (
        <Text
          style={[
            styles.supportText,
            { color: error ? colors.error : colors.midGrey },
          ]}
          accessibilityRole={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </Text>
      ) : null}

      <Modal
        visible={selectorVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectorVisible(false)}
      >
        <SafeAreaView
          style={[styles.modal, { backgroundColor: colors.bone }]}
          edges={['top', 'bottom']}
        >
          <KeyboardAvoidingView
            style={styles.modal}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.ink }]}>
                  Country code
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.midGrey }]}>
                  Choose where this phone number is registered.
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.closeButton,
                  { backgroundColor: colors.white },
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectorVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close country code list"
              >
                <Feather name="x" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <View
              style={[
                styles.searchWrapper,
                {
                  backgroundColor: colors.white,
                  borderColor: colors.lightGrey,
                },
              ]}
            >
              <Feather name="search" size={20} color={colors.midGrey} />
              <TextInput
                style={[styles.searchInput, { color: colors.ink }]}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Search country or code"
                placeholderTextColor={colors.midGrey}
                accessibilityLabel="Search countries"
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  style={styles.clearButton}
                  accessibilityRole="button"
                  accessibilityLabel="Clear country search"
                >
                  <Feather name="x-circle" size={20} color={colors.midGrey} />
                </Pressable>
              ) : null}
            </View>

            <FlashList
              data={countries}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const selected = item.code === countryCode
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.countryRow,
                      {
                        backgroundColor: selected
                          ? colors.needleGreenLight
                          : colors.white,
                        borderColor: selected
                          ? colors.needleGreen
                          : colors.lightGrey,
                      },
                      pressed && styles.pressed,
                    ]}
                    onPress={() => selectCountry(item)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${item.name}, ${item.callingCode}`}
                  >
                    <View
                      style={[
                        styles.listIsoBadge,
                        { backgroundColor: colors.boneDeep },
                      ]}
                    >
                      <Text style={[styles.isoText, { color: colors.ink }]}>
                        {item.code}
                      </Text>
                    </View>
                    <View style={styles.countryCopy}>
                      <Text
                        style={[styles.countryName, { color: colors.ink }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {item.nativeName !== item.name ? (
                        <Text
                          style={[
                            styles.countryNativeName,
                            { color: colors.midGrey },
                          ]}
                          numberOfLines={1}
                        >
                          {item.nativeName}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={[styles.listCallingCode, { color: colors.midGrey }]}
                    >
                      {item.callingCode}
                    </Text>
                    {selected ? (
                      <Feather
                        name="check"
                        size={20}
                        color={colors.needleGreen}
                      />
                    ) : null}
                  </Pressable>
                )
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={[styles.emptyTitle, { color: colors.ink }]}>
                    No country found
                  </Text>
                  <Text style={[styles.emptyBody, { color: colors.midGrey }]}>
                    Try a country name, ISO code, or calling code.
                  </Text>
                </View>
              }
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  inputWrapper: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  countryButton: {
    minWidth: 108,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  isoBadge: {
    minWidth: 30,
    height: 26,
    paddingHorizontal: 5,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  isoText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    fontWeight: FontWeight.bold,
  },
  callingCode: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    fontWeight: FontWeight.semibold,
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: 32,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontFamily: Fonts.body,
    fontSize: 16,
  },
  right: { marginRight: Spacing.md },
  supportText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: { opacity: 0.72 },
  modal: { flex: 1 },
  modalHeader: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  modalTitle: {
    fontFamily: Fonts.display,
    fontSize: 26,
    lineHeight: 32,
  },
  modalSubtitle: {
    marginTop: Spacing.xs,
    maxWidth: 280,
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrapper: {
    minHeight: 52,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 50,
    fontFamily: Fonts.body,
    fontSize: 16,
  },
  clearButton: {
    width: 44,
    height: 44,
    marginRight: -Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  countryRow: {
    minHeight: 62,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  listIsoBadge: {
    width: 38,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryCopy: { flex: 1, minWidth: 0 },
  countryName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
  countryNativeName: {
    marginTop: 2,
    fontFamily: Fonts.body,
    fontSize: 12,
  },
  listCallingCode: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
  },
  emptyState: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: 64,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
  },
  emptyBody: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.body,
    fontSize: 14,
    textAlign: 'center',
  },
})
