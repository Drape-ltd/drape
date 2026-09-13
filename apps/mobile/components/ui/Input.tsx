import React, { useRef, useState } from 'react'
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontWeight, Radius, Spacing } from '@/constants/theme'
import { filterContactInfo } from '@drape/shared/contact-filter'

interface InputProps extends TextInputProps {
  label?: string
  error?: string
  hint?: string
  containerStyle?: ViewStyle
  filterContact?: boolean // enable real-time contact leakage detection
  rightElement?: React.ReactNode
  required?: boolean
  showCharacterCount?: boolean
  characterCountMax?: number
  onClearError?: () => void
}

export function Input({
  label,
  error,
  hint,
  containerStyle,
  filterContact = false,
  rightElement,
  required,
  showCharacterCount,
  characterCountMax,
  onChangeText,
  onClearError,
  onFocus,
  onBlur,
  onKeyPress,
  secureTextEntry,
  ...props
}: InputProps) {
  const [contactWarning, setContactWarning] = useState('')
  const [focused, setFocused] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [capsLockSuspected, setCapsLockSuspected] = useState(false)
  const uppercaseRunRef = useRef(0)

  function handleChangeText(text: string) {
    if (displayError) onClearError?.()
    if (filterContact && text.length > 3) {
      const result = filterContactInfo(text)
      setContactWarning(result.blocked ? result.userMessage : '')
    } else {
      setContactWarning('')
    }
    onChangeText?.(text)
  }

  const displayError = error || contactWarning
  const hasError = !!displayError
  const isPasswordField = secureTextEntry === true
  const resolvedSecureTextEntry = isPasswordField ? !passwordVisible : secureTextEntry
  const valueLength = typeof props.value === 'string' ? props.value.length : 0
  const resolvedCharacterMax = characterCountMax ?? props.maxLength
  const shouldShowCharacterCount = !!showCharacterCount && typeof resolvedCharacterMax === 'number'

  function handlePasswordKeyPress(event: Parameters<NonNullable<TextInputProps['onKeyPress']>>[0]) {
    if (isPasswordField) {
      const key = event.nativeEvent.key
      if (key === 'CapsLock') {
        setCapsLockSuspected((current) => !current)
      } else if (/^[A-Z]$/.test(key)) {
        uppercaseRunRef.current += 1
        if (uppercaseRunRef.current >= 2) setCapsLockSuspected(true)
      } else if (/^[a-z]$/.test(key)) {
        uppercaseRunRef.current = 0
        setCapsLockSuspected(false)
      }
    }
    onKeyPress?.(event)
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[styles.label, hasError && styles.labelError]}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <View
        style={[styles.inputWrapper, focused && styles.focused, hasError && styles.errorBorder]}
      >
        <TextInput
          style={styles.input}
          placeholderTextColor={Colors.midGrey}
          accessibilityLabel={props.accessibilityLabel ?? label ?? props.placeholder}
          accessibilityHint={props.accessibilityHint ?? hint}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            uppercaseRunRef.current = 0
            setCapsLockSuspected(false)
            onBlur?.(event)
          }}
          onKeyPress={handlePasswordKeyPress}
          onChangeText={handleChangeText}
          returnKeyType={props.returnKeyType ?? (props.multiline ? 'default' : 'next')}
          blurOnSubmit={props.blurOnSubmit ?? false}
          secureTextEntry={resolvedSecureTextEntry}
          autoCapitalize={isPasswordField ? 'none' : props.autoCapitalize}
          autoCorrect={isPasswordField ? false : props.autoCorrect}
          spellCheck={isPasswordField ? false : props.spellCheck}
          textContentType={props.textContentType ?? (isPasswordField ? 'password' : undefined)}
          autoComplete={props.autoComplete ?? (isPasswordField ? 'password' : undefined)}
          {...props}
        />
        {rightElement && <View style={styles.right}>{rightElement}</View>}
        {isPasswordField ? (
          <TouchableOpacity
            style={styles.passwordToggle}
            onPress={() => setPasswordVisible((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            hitSlop={8}
          >
            <Feather
              name={passwordVisible ? 'eye-off' : 'eye'}
              size={20}
              color={focused ? Colors.needleGreen : Colors.midGrey}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {displayError || capsLockSuspected || hint || shouldShowCharacterCount ? (
        <View style={styles.supportRow}>
          {displayError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {displayError}
            </Text>
          ) : capsLockSuspected ? (
            <View style={styles.capsLockNotice} accessibilityRole="alert">
              <Feather name="arrow-up-circle" size={15} color={Colors.warning} />
              <Text style={styles.capsLockText}>
                Caps Lock may be on — passwords are case-sensitive.
              </Text>
            </View>
          ) : hint ? (
            <Text style={styles.hint}>{hint}</Text>
          ) : (
            <View />
          )}
          {shouldShowCharacterCount ? (
            <Text style={[styles.counter, hasError && styles.counterError]}>
              {valueLength}/{resolvedCharacterMax}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  labelError: { color: Colors.error },
  required: { color: Colors.kanteRust },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    minHeight: 58,
  },
  focused: { borderColor: Colors.needleGreen },
  errorBorder: { borderColor: Colors.error },
  input: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
    paddingVertical: 10,
    minHeight: 56,
  },
  right: { marginLeft: Spacing.sm },
  passwordToggle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing.sm,
  },
  errorText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.error,
    lineHeight: 18,
  },
  hint: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.midGrey,
    lineHeight: 18,
  },
  capsLockNotice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  capsLockText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.warning,
    lineHeight: 18,
  },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  counter: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.midGrey,
    lineHeight: 18,
  },
  counterError: { color: Colors.error },
})
