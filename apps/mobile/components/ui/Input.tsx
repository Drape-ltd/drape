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
  ...props
}: InputProps) {
  const [contactWarning, setContactWarning] = useState('')
  const [focused, setFocused] = useState(false)

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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={handleChangeText}
          {...props}
        />
        {rightElement && <View style={styles.right}>{rightElement}</View>}
      </View>
      {displayError ? (
        <Text style={styles.errorText}>{displayError}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.ink,
  },
  required: { color: Colors.kanteRust },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
  },
  focused: { borderColor: Colors.needleGreen },
  errorBorder: { borderColor: Colors.error },
  input: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
    paddingVertical: Spacing.md,
    minHeight: 50,
  },
  right: { marginLeft: Spacing.sm },
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
