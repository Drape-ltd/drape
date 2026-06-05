import { useMemo, useState } from 'react'
import {
  Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { Button } from './Button'
import { Input } from './Input'
import {
  handoffOptionsFor,
  reportHandoffIssue,
  type HandoffActorRole,
  type HandoffIssueType,
} from '@/lib/handoff-support'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type Props = {
  visible: boolean
  orderId: string
  role: HandoffActorRole
  deliveryMethod: string | null | undefined
  onClose: () => void
  onSubmitted: () => void
}

export function HandoffSupportModal({
  visible,
  orderId,
  role,
  deliveryMethod,
  onClose,
  onSubmitted,
}: Props) {
  const options = useMemo(() => handoffOptionsFor(role, deliveryMethod), [deliveryMethod, role])
  const [selectedIssue, setSelectedIssue] = useState<HandoffIssueType | null>(options[0]?.type ?? null)
  const [description, setDescription] = useState('')
  const [errorText, setErrorText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setSelectedIssue(options[0]?.type ?? null)
    setDescription('')
    setErrorText('')
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (submitting || !selectedIssue) return
    if (description.trim().length < 10) {
      setErrorText('Add a short note so the other side and Drapeon know what is actually happening.')
      return
    }

    setSubmitting(true)
    const result = await reportHandoffIssue({
      orderId,
      issueType: selectedIssue,
      description,
    })
    setSubmitting(false)

    if (result.error) {
      setErrorText(result.error)
      return
    }

    reset()
    onSubmitted()
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Log handoff help</Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <Text style={styles.helperText}>
              Keep the live pickup or delivery problem inside Drapeon so the order timeline stays clear if support needs to step in.
            </Text>

            <View style={styles.optionGroup}>
              {options.map((option) => {
                const active = selectedIssue === option.type
                return (
                  <TouchableOpacity
                    key={option.type}
                    style={[styles.optionCard, active && styles.optionCardActive]}
                    onPress={() => {
                      setSelectedIssue(option.type)
                      setErrorText('')
                    }}
                  >
                    <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{option.label}</Text>
                    <Text style={[styles.optionHint, active && styles.optionHintActive]}>{option.hint}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Input
              label="What is happening?"
              multiline
              numberOfLines={5}
              value={description}
              onChangeText={(text) => {
                setDescription(text)
                if (errorText) setErrorText('')
              }}
              placeholder="Example: I am at the pickup point, but the gate is locked and I cannot reach the seller yet."
            />
            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <View style={styles.actionRow}>
              <Button label="Cancel" variant="secondary" onPress={handleClose} />
              <Button
                label={submitting ? 'Logging help...' : 'Log help'}
                onPress={() => { void handleSubmit() }}
                disabled={submitting}
                loading={submitting}
              />
            </View>

            {submitting ? (
              <View style={styles.sendingRow}>
                <ActivityIndicator color={Colors.needleGreen} />
                <Text style={styles.sendingText}>Sending this help request into Drapeon now.</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 22, 19, 0.32)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bone,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '88%',
    ...Shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  closeText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  body: {
    gap: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  helperText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  optionGroup: {
    gap: Spacing.md,
  },
  optionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  optionCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  optionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  optionTitleActive: {
    color: Colors.needleGreen,
  },
  optionHint: {
    marginTop: 4,
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  optionHintActive: {
    color: Colors.needleGreen,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.kanteRust,
    marginTop: -Spacing.sm,
  },
  actionRow: {
    gap: Spacing.md,
  },
  sendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sendingText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
  },
})
