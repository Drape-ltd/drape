import { StyleSheet, Text, View } from 'react-native'
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native'
import {
  formatMinorCurrencyAmount,
  formatMoneyInputValue,
  moneyAmountReadback,
  parseMoneyInputToMinorUnits,
  type AccountCurrencyCode,
} from '@drape/shared'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'
import { Input } from './Input'

type MoneyInputProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  label: string
  value: string
  onChangeText: (value: string) => void
  currency: AccountCurrencyCode
  hint?: string
  error?: string
  required?: boolean
  allowZero?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

export function MoneyInput({
  label,
  value,
  onChangeText,
  currency,
  hint,
  error,
  required,
  allowZero = false,
  containerStyle,
  ...props
}: MoneyInputProps) {
  const amountMinor = parseMoneyInputToMinorUnits(value, { allowZero })
  const exactAmount = amountMinor == null ? '' : formatMinorCurrencyAmount(amountMinor, currency)
  const readback = amountMinor == null ? '' : moneyAmountReadback(amountMinor, currency)

  return (
    <View style={[styles.container, containerStyle]}>
      <Input
        {...props}
        label={`${label} (${currency})`}
        value={value}
        onChangeText={(next) => onChangeText(formatMoneyInputValue(next))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        hint={hint}
        error={error}
        required={required}
      />
      {exactAmount ? (
        <View
          style={styles.readback}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${exactAmount}. ${readback}`}
        >
          <Text style={styles.exact}>{exactAmount}</Text>
          <Text style={styles.words}>{readback}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  readback: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.needleGreen,
    paddingLeft: Spacing.sm,
    gap: 2,
  },
  exact: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  words: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
    textTransform: 'capitalize',
  },
})
