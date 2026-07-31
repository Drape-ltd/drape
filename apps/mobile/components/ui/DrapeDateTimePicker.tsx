import { useState } from 'react'
import { Platform } from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'

type DrapeDateTimePickerProps = {
  value: Date
  mode?: 'date' | 'time' | 'datetime'
  minimumDate?: Date
  maximumDate?: Date
  onChange: (event: DateTimePickerEvent, value?: Date) => void
}

/**
 * Android only exposes separate native date and time dialogs. Passing
 * `mode="datetime"` reaches an undefined native picker and crashes while the
 * community component cleans it up. Keep the combined iOS control, and
 * sequence the two supported Android dialogs into one Date result.
 */
export function DrapeDateTimePicker({
  value,
  mode = 'datetime',
  minimumDate,
  maximumDate,
  onChange,
}: DrapeDateTimePickerProps) {
  const [androidPhase, setAndroidPhase] = useState<'date' | 'time'>('date')
  const [androidDate, setAndroidDate] = useState(value)

  if (Platform.OS === 'android' && mode === 'datetime') {
    return (
      <DateTimePicker
        value={androidDate}
        mode={androidPhase}
        minimumDate={androidPhase === 'date' ? minimumDate : undefined}
        maximumDate={androidPhase === 'date' ? maximumDate : undefined}
        onChange={(dateEvent, selectedDate) => {
          if (androidPhase === 'date') {
            if (dateEvent.type !== 'set' || !selectedDate) {
              onChange(dateEvent, undefined)
              return
            }

            const dateWithCurrentTime = new Date(selectedDate)
            dateWithCurrentTime.setHours(
              value.getHours(),
              value.getMinutes(),
              value.getSeconds(),
              value.getMilliseconds(),
            )
            setAndroidDate(dateWithCurrentTime)
            setAndroidPhase('time')
            return
          }

          if (dateEvent.type !== 'set' || !selectedDate) {
            onChange(dateEvent, undefined)
            return
          }

          const combined = new Date(androidDate)
          combined.setHours(
            selectedDate.getHours(),
            selectedDate.getMinutes(),
            selectedDate.getSeconds(),
            selectedDate.getMilliseconds(),
          )
          onChange(dateEvent, combined)
        }}
      />
    )
  }

  return (
    <DateTimePicker
      value={value}
      mode={mode}
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      onChange={onChange}
    />
  )
}
