import { StyleSheet, Text, View } from 'react-native'
import { Colors, Fonts, FontWeight, Spacing } from '@/constants/theme'

export type TimelineStepState = 'complete' | 'current' | 'upcoming'

export type TimelineStep = {
  key: string
  label: string
  state: TimelineStepState
  detail?: string
}

type OrderTimelineCardProps = {
  title?: string
  steps: TimelineStep[]
}

export function OrderTimelineCard({ title = 'Order timeline', steps }: OrderTimelineCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.steps}>
        {steps.map((step, index) => {
          const active = step.state === 'complete' || step.state === 'current'
          return (
            <View key={step.key} style={styles.step}>
              <View style={styles.rail}>
                <View style={[styles.dot, active ? styles.dotActive : styles.dotUpcoming]} />
                {index < steps.length - 1 ? (
                  <View style={[styles.line, active ? styles.lineActive : styles.lineUpcoming]} />
                ) : null}
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepLabel}>{step.label}</Text>
                {step.detail ? <Text style={styles.stepDetail}>{step.detail}</Text> : null}
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 18,
    padding: Spacing.xxxl,
    gap: Spacing.xl,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    letterSpacing: 0,
  },
  steps: {
    gap: 0,
  },
  step: {
    minHeight: 72,
    flexDirection: 'row',
  },
  rail: {
    width: 32,
    alignItems: 'center',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  dotActive: {
    backgroundColor: Colors.needleGreen,
  },
  dotUpcoming: {
    backgroundColor: Colors.lightGrey,
  },
  line: {
    flex: 1,
    width: 2,
    marginVertical: 4,
  },
  lineActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  lineUpcoming: {
    backgroundColor: Colors.boneDeep,
  },
  stepCopy: {
    flex: 1,
    paddingLeft: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  stepLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  stepDetail: {
    marginTop: 2,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.inkLight,
  },
})
