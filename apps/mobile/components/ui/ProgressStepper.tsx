/**
 * ProgressStepper — labeled multi-step progress indicator.
 *
 * Shows a row of segment bars (filled for completed/active steps)
 * with step labels underneath. Active step label is bold + green.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors, FontWeight, Radius, Spacing } from '@/constants/theme'

interface ProgressStepperProps {
  steps: string[]
  /** 0-based index of the currently active step */
  current: number
}

export function ProgressStepper({ steps, current }: ProgressStepperProps) {
  return (
    <View style={styles.container}>
      {/* Segment bars */}
      <View style={styles.segmentRow}>
        {steps.map((_, i) => (
          <View key={i} style={styles.segmentWrap}>
            <View
              style={[
                styles.segment,
                i < current && styles.segmentDone,
                i === current && styles.segmentActive,
              ]}
            />
          </View>
        ))}
      </View>

      {/* Step labels */}
      <View style={styles.labelRow}>
        {steps.map((label, i) => (
          <Text
            key={i}
            style={[
              styles.stepLabel,
              i < current && styles.stepLabelDone,
              i === current && styles.stepLabelActive,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  segmentWrap: { flex: 1 },
  segment: {
    height: 3,
    borderRadius: Radius.sm,
    backgroundColor: Colors.lightGrey,
  },
  segmentDone: {
    backgroundColor: Colors.needleGreen,
    opacity: 0.5,
  },
  segmentActive: {
    backgroundColor: Colors.needleGreen,
    height: 4,
    opacity: 1,
  },
  labelRow: {
    flexDirection: 'row',
  },
  stepLabel: {
    flex: 1,
    fontSize: 10,
    color: Colors.lightGrey,
    textAlign: 'center',
  },
  stepLabelDone: {
    color: Colors.needleGreen,
    opacity: 0.6,
  },
  stepLabelActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.bold,
    opacity: 1,
  },
})
