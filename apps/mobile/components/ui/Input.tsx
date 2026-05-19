import React, { useState } from 'react'
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
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { filterContactInfo } from '@drape/shared/contact-filter'

interface InputProps extends TextInputProps {
  label?: string
  error?: string
  hint?: string
  containerStyle?: ViewStyle
  filterContact?: boolean  // enable real-time contact leakage detection
  rightElement?: React.ReactNode
  required?: boolean
}

export function Input({
  label,
  error,
  hint,
  containerStyle,
  filterContact = false,
  rightElement,
  required,
  onChangeText,
  onFocus,
  onBlur,
  secureTextEntry,
  ...props
}: InputProps) {
  const [contactWarning, setContactWarning] = useState('')
  const [focused, setFocused] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)

  function handleChangeText(text: string) {
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

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <View style={[styles.inputWrapper, focused && styles.focused, hasError && styles.errorBorder]}>
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
            onBlur?.(event)
          }}
          onChangeText={handleChangeText}
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
      {displayError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {displayError}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.midGrey,
  },
  required: { color: Colors.kanteRust },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    minHeight: 52,
  },
  focused: { borderColor: Colors.needleGreen },
  errorBorder: { borderColor: Colors.error },
  input: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
    paddingVertical: 10,
    minHeight: 50,
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
    fontSize: FontSize.xs,
    color: Colors.error,
    lineHeight: 18,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
  },
})
