import type { ComponentProps, ReactNode } from 'react'
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import type { DrapeVisionConfidence } from '@drape/drape-vision/types'
import {
  Fonts,
  FontSize,
  Radius,
  Shadow,
  Spacing,
  useDrapeTheme,
} from '@/constants/theme'
import {
  VISION_CAMERA_PALETTE,
  VisionHeader,
  VisionDockIconButton,
  VisionInstructionPanel,
  VisionMetricCard,
  VisionPrimaryButton,
  VisionPrivacyNotice,
  VisionProgressRail,
  VisionSectionTitle,
  VisionShell,
  VisionStatusChip,
  VisionStepCard,
} from './DrapeVisionPrimitives'
import type { VisionSurfaceTone } from './presentation'
import type { VisionMetricGroup } from './presentation'

type FeatherName = ComponentProps<typeof Feather>['name']
type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name']

export type VisionHubOption = {
  id: string
  title: string
  body: string
  hint?: string
  status: string
  tone: VisionSurfaceTone
  icon: MaterialName
  recommended?: boolean
  disabled?: boolean
  onPress: () => void
}

export type VisionFormOption = {
  id: string
  label: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
}

export type VisionFormField = {
  id: string
  label: string
  accessibilityLabel?: string
  value: string
  placeholder: string
  keyboardType?: KeyboardTypeOptions
  onChange: (value: string) => void
}

export type VisionChecklistItem = {
  id: string
  label: string
  hint: string
  checked: boolean
  onPress: () => void
}

export type VisionSpecialistMetricItem = {
  id: string
  label: string
  value: string
  confidence: DrapeVisionConfidence | null
  note: string
}

export type VisionTapeComparisonItem = {
  id: string
  label: string
  estimate: string
  value: string
  placeholder: string
  keyboardType?: KeyboardTypeOptions
  comparison?: string | null
  tone?: VisionSurfaceTone
  onChange: (value: string) => void
}

function VisionHubOptionCard({ option }: { option: VisionHubOption }) {
  return (
    <View style={styles.optionWrap}>
      <VisionStepCard
        materialIcon={option.icon}
        eyebrow={option.recommended ? 'Start here' : undefined}
        title={option.title}
        body={option.body}
        status={option.status}
        statusTone={option.tone}
        disabled={option.disabled}
        selected={option.recommended}
        onPress={option.onPress}
      />
      {option.hint ? <OptionHint>{option.hint}</OptionHint> : null}
    </View>
  )
}

export function VisionHubView({
  status,
  statusTone,
  onClose,
  closeDisabled,
  savedHeight,
  hasSavedHeight,
  onChangeHeight,
  options,
  privacyPoints,
  manualLabel,
  onManual,
}: {
  status: string
  statusTone: VisionSurfaceTone
  onClose: () => void
  closeDisabled: boolean
  savedHeight: string
  hasSavedHeight: boolean
  onChangeHeight: () => void
  options: VisionHubOption[]
  privacyPoints: readonly string[]
  manualLabel: string
  onManual: () => void
}) {
  const { colors } = useDrapeTheme()
  const fit360Option = options.find((option) => option.id === 'fit_360')
  const fitProfileOptions = options.filter((option) => (
    option.id === 'bodice_corset' || option.id === 'lower_body_detail'
  ))
  const accessoryOptions = options.filter((option) => (
    option.id === 'hand_wrist' || option.id === 'headwear'
  ))
  const remainingOptions = options.filter((option) => (
    option.id !== 'fit_360'
    && option.id !== 'bodice_corset'
    && option.id !== 'lower_body_detail'
    && option.id !== 'hand_wrist'
    && option.id !== 'headwear'
  ))

  return (
    <VisionShell
      testID="vision-hub"
      header={(
        <VisionHeader
          status={status}
          tone={statusTone}
          onClose={onClose}
          disabled={closeDisabled}
        />
      )}
      footer={<VisionPrimaryButton label={manualLabel} icon="edit-3" onPress={onManual} />}
    >
      <VisionSectionTitle
        eyebrow="Drapeon Vision"
        title="Choose what to measure"
        body="Start with Fit 360 for your core profile, then add torso and lower-body detail when a garment needs a more complete fit."
      />

      <VisionStepCard
        icon="maximize-2"
        eyebrow="Saved setup"
        title={hasSavedHeight ? savedHeight : 'Add your height'}
        body="Height anchors Fit 360, bodice, and lower-body estimates."
        status={hasSavedHeight ? 'Ready to reuse' : 'Needed for full scan'}
        statusTone={hasSavedHeight ? 'success' : 'warning'}
        onPress={onChangeHeight}
      />

      <VisionInstructionPanel
        icon="check-circle"
        title="Before Fit 360"
        body={'1. Stay fully clothed in one fitted, lightweight layer. Avoid loose or bulky clothing.\n2. Use bright, even front light and a plain background.\n3. Stand your phone upright on a stable table or stand around waist-to-chest height, never on the floor.\n4. Step back until your full body, including your head and ankles, stays inside the guide.'}
        tone="active"
      />

      {fit360Option ? <VisionHubOptionCard option={fit360Option} /> : null}

      {fitProfileOptions.length > 0 ? (
        <View style={styles.optionGroup}>
          <View style={styles.optionGroupHeader}>
            <Text style={[styles.optionGroupEyebrow, { color: colors.needleGreenDark }]}>
              Complete your fit profile
            </Text>
            <Text style={[styles.optionGroupBody, { color: colors.inkLight }]}>
              Add fitted torso and lower-body detail after Fit 360. These scans extend the same saved profile.
            </Text>
          </View>
          {fitProfileOptions.map((option) => (
            <VisionHubOptionCard key={option.id} option={option} />
          ))}
        </View>
      ) : null}

      {accessoryOptions.length > 0 ? (
        <View style={styles.optionGroup}>
          <View style={styles.optionGroupHeader}>
            <Text style={[styles.optionGroupEyebrow, { color: colors.needleGreenDark }]}>
              Specialist accessories
            </Text>
            <Text style={[styles.optionGroupBody, { color: colors.inkLight }]}>
              Use these when an order needs cuff, bangle, sleeve-opening, or headwear measurements.
            </Text>
          </View>
          {accessoryOptions.map((option) => (
            <VisionHubOptionCard key={option.id} option={option} />
          ))}
        </View>
      ) : null}

      {remainingOptions.length > 0 ? (
        <View style={styles.optionList}>
          {remainingOptions.map((option) => (
            <VisionHubOptionCard key={option.id} option={option} />
          ))}
        </View>
      ) : null}

      <VisionPrivacyNotice points={privacyPoints} />
    </VisionShell>
  )
}

export function VisionIntroView({
  status,
  statusTone,
  onClose,
  eyebrow,
  title,
  body,
  destinationTitle,
  destinationBody,
  notices,
  privacyPoints,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  status: string
  statusTone: VisionSurfaceTone
  onClose: () => void
  eyebrow: string
  title: string
  body: string
  destinationTitle: string
  destinationBody: string
  notices: Array<{ id: string; title: string; body: string; tone: VisionSurfaceTone; icon: FeatherName }>
  privacyPoints: readonly string[]
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-intro"
      header={<VisionHeader status={status} tone={statusTone} onClose={onClose} />}
      footer={(
        <View style={styles.resultActions}>
          <VisionPrimaryButton label={primaryLabel} onPress={onPrimary} />
          {secondaryLabel && onSecondary ? (
            <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} onPress={onSecondary} style={styles.secondaryResultAction}>
              <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    >
      <VisionSectionTitle eyebrow={eyebrow} title={title} body={body} />
      {notices.map((notice) => (
        <VisionInstructionPanel
          key={notice.id}
          icon={notice.icon}
          title={notice.title}
          body={notice.body}
          tone={notice.tone}
        />
      ))}
      <VisionStepCard
        icon="corner-down-right"
        eyebrow="Saves to"
        title={destinationTitle}
        body={destinationBody}
      />
      <VisionPrivacyNotice points={privacyPoints} />
    </VisionShell>
  )
}

export function VisionSpecialistReadyView({
  status,
  statusTone,
  onClose,
  title,
  body,
  materialIcon,
  active,
  platformCopy,
  fields,
  debugRequirements,
  readinessNotice,
  primaryLabel,
  onPrimary,
  onBack,
}: {
  status: string
  statusTone: VisionSurfaceTone
  onClose: () => void
  title: string
  body: string
  materialIcon: MaterialName
  active: boolean
  platformCopy: string
  fields: string[]
  debugRequirements: string[]
  readinessNotice?: { title: string; body: string; tone: VisionSurfaceTone } | null
  primaryLabel: string
  onPrimary: () => void
  onBack: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-specialist-ready"
      header={<VisionHeader status={status} tone={statusTone} onClose={onClose} />}
      footer={(
        <View style={styles.resultActions}>
          <VisionPrimaryButton label={primaryLabel} icon="camera" disabled={!active} onPress={onPrimary} />
          <Pressable accessibilityRole="button" accessibilityLabel="Back to scan picker" onPress={onBack} style={styles.secondaryResultAction}>
            <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>Back to scan picker</Text>
          </Pressable>
        </View>
      )}
    >
      <VisionSectionTitle eyebrow="Specialist scan" title={title} body={body} />
      <VisionStepCard
        materialIcon={materialIcon}
        title="What this scan measures"
        body={platformCopy}
        status={active ? 'Available now' : 'Coming soon'}
        statusTone={active ? 'success' : 'neutral'}
      />
      {active ? (
        <View style={styles.fieldChipRow}>
          {fields.map((field) => (
            <View key={field} style={[styles.fieldChip, { backgroundColor: colors.needleGreenLight }]}>
              <Text style={[styles.fieldChipText, { color: colors.needleGreenDark }]}>{field}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <VisionInstructionPanel
        icon="info"
        title="Tape confirms the result"
        body="Vision produces an estimate. Compare it with tape before a tailor cuts fabric."
        tone="active"
      />
      {readinessNotice ? (
        <VisionInstructionPanel
          icon={readinessNotice.tone === 'blocked' ? 'alert-circle' : 'check-circle'}
          title={readinessNotice.title}
          body={readinessNotice.body}
          tone={readinessNotice.tone}
        />
      ) : null}
      {debugRequirements.length ? (
        <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
          <VisionSectionTitle title="Debug readiness" body="Native requirements for this focused scan." />
          {debugRequirements.map((requirement) => (
            <View key={requirement} style={styles.checkRow}>
              <Feather name={active ? 'check-circle' : 'circle'} size={17} color={colors.needleGreenDark} />
              <Text style={[styles.checkTitle, { color: colors.ink }]}>{requirement}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </VisionShell>
  )
}

function OptionHint({ children }: { children: ReactNode }) {
  const { colors } = useDrapeTheme()
  return <Text style={[styles.optionHint, { color: colors.inkLight }]}>{children}</Text>
}

export type VisionHeightConfidence = 'exact' | 'approximate'
export type VisionHeightUnit = 'cm' | 'ft'

export function VisionHeightView({
  status,
  onClose,
  confidence,
  onConfidenceChange,
  unit,
  onUnitChange,
  formattedHeight,
  onIncrease,
  onDecrease,
  notice,
  primaryLabel,
  primaryLoading,
  onPrimary,
  onBack,
}: {
  status: string
  onClose: () => void
  confidence: VisionHeightConfidence
  onConfidenceChange: (value: VisionHeightConfidence) => void
  unit: VisionHeightUnit
  onUnitChange: (value: VisionHeightUnit) => void
  formattedHeight: string
  onIncrease: () => void
  onDecrease: () => void
  notice?: { title: string; body: string; tone: VisionSurfaceTone; icon: FeatherName } | null
  primaryLabel: string
  primaryLoading: boolean
  onPrimary: () => void
  onBack: () => void
}) {
  const { colors } = useDrapeTheme()
  const confidenceOptions: Array<{
    value: VisionHeightConfidence
    icon: FeatherName
    title: string
    body: string
  }> = [
    { value: 'exact', icon: 'check-circle', title: 'Current height', body: 'Use a recent measured value.' },
    { value: 'approximate', icon: 'help-circle', title: 'Best estimate', body: 'Results will carry a tape-check reminder.' },
  ]

  return (
    <VisionShell
      testID="vision-height"
      header={<VisionHeader status={status} tone="active" onClose={onClose} />}
      footer={<VisionPrimaryButton label={primaryLabel} onPress={onPrimary} loading={primaryLoading} />}
    >
      <VisionSectionTitle
        eyebrow="Scan setup"
        title="Set your height"
        body="Vision uses height to translate proportions into measurement estimates. This value stays available for future scans."
      />

      <View style={styles.segmentedControl}>
        {(['ft', 'cm'] as VisionHeightUnit[]).map((value) => {
          const selected = unit === value
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={value === 'ft' ? 'Feet and inches' : 'Centimetres'}
              accessibilityState={{ selected }}
              onPress={() => onUnitChange(value)}
              style={[
                styles.segment,
                selected && { backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.segmentText, { color: selected ? colors.ink : colors.inkLight }]}>
                {value === 'ft' ? 'ft + in' : 'cm'}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <View style={[styles.heightPicker, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease height"
          accessibilityHint="Decreases height by one step"
          onPress={onDecrease}
          style={styles.heightAdjust}
        >
          <Feather name="minus" size={24} color={colors.needleGreenDark} />
        </Pressable>
        <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.heightValue, { color: colors.ink }]}>
          {formattedHeight}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase height"
          accessibilityHint="Increases height by one step"
          onPress={onIncrease}
          style={styles.heightAdjust}
        >
          <Feather name="plus" size={24} color={colors.needleGreenDark} />
        </Pressable>
      </View>

      <View style={styles.confidenceList}>
        {confidenceOptions.map((option) => (
          <VisionStepCard
            key={option.value}
            icon={option.icon}
            title={option.title}
            body={option.body}
            selected={confidence === option.value}
            status={confidence === option.value ? 'Selected' : undefined}
            statusTone="active"
            onPress={() => onConfidenceChange(option.value)}
          />
        ))}
      </View>

      {notice ? (
        <VisionInstructionPanel
          icon={notice.icon}
          title={notice.title}
          body={notice.body}
          tone={notice.tone}
        />
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Back to scan picker" onPress={onBack} style={styles.textAction}>
        <Feather name="grid" size={17} color={colors.needleGreenDark} />
        <Text style={[styles.textActionLabel, { color: colors.needleGreenDark }]}>Back to scan picker</Text>
      </Pressable>
    </VisionShell>
  )
}

export function VisionCalculatingView({
  status,
  messages,
  activeStep,
  canCancel,
  onCancel,
  onClose,
}: {
  status: string
  messages: readonly string[]
  activeStep: number
  canCancel: boolean
  onCancel: () => void
  onClose: () => void
}) {
  const { colors } = useDrapeTheme()
  const completed = Math.max(1, Math.min(messages.length, activeStep))

  return (
    <VisionShell
      testID="vision-calculating"
      header={<VisionHeader status={status} tone="active" onClose={onClose} />}
      footer={canCancel ? <VisionPrimaryButton label="Cancel and choose another path" icon="x" onPress={onCancel} /> : undefined}
    >
      <VisionSectionTitle
        eyebrow="On-device processing"
        title="Building your fit profile"
        body="Drapeon is reviewing the captured poses locally. No incomplete scan is saved."
      />
      <View style={[styles.processingCard, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
        <View style={styles.processingMark}>
          <MaterialCommunityIcons name="human-male-height-variant" size={72} color={colors.needleGreenDark} />
        </View>
        <VisionProgressRail progress={completed / messages.length} segments={messages.length} />
        <View style={styles.processingList}>
          {messages.map((message, index) => {
            const current = index === completed - 1
            const done = index < completed - 1
            return (
              <View key={message} style={styles.processingRow}>
                <View style={[
                  styles.processingDot,
                  { backgroundColor: done || current ? colors.needleGreen : colors.lightGrey },
                ]}>
                  {done ? <Feather name="check" size={12} color={VISION_CAMERA_PALETTE.text} /> : null}
                </View>
                <Text style={[
                  styles.processingText,
                  { color: current ? colors.ink : colors.inkLight },
                  current && styles.processingTextActive,
                ]}>
                  {message}
                </Text>
              </View>
            )
          })}
        </View>
      </View>
      <VisionInstructionPanel
        icon="shield"
        title="Private while processing"
        body="Camera frames stay in memory and are cleared after Drapeon builds this result."
        tone="success"
      />
    </VisionShell>
  )
}

export type VisionResultMetricItem = {
  id: string
  label: string
  value: string
  confidence: DrapeVisionConfidence | null
  group: VisionMetricGroup
  emphasized?: boolean
}

export type VisionResultFollowUp = {
  id: string
  title: string
  body: string
  status: string
  icon: MaterialName
  fields: string[]
  onPress: () => void
}

export function VisionResultsView({
  onClose,
  status,
  statusTone,
  title,
  body,
  unit,
  onUnitChange,
  metrics,
  reviewTitle,
  reviewBody,
  reviewNotice,
  reviewed,
  reviewDisabled,
  reviewLabel,
  onReviewChange,
  onManual,
  followUps,
  warning,
  diagnostics,
  confirmation,
  primaryLabel,
  primaryIcon,
  primaryLoading,
  primaryDisabled,
  onPrimary,
  secondaryLabel,
  secondaryTone = 'neutral',
  onSecondary,
}: {
  onClose: () => void
  status: string
  statusTone: VisionSurfaceTone
  title: string
  body: string
  unit: 'cm' | 'in'
  onUnitChange: (unit: 'cm' | 'in') => void
  metrics: VisionResultMetricItem[]
  reviewTitle: string
  reviewBody: string
  reviewNotice?: { title: string; body: string; tone: VisionSurfaceTone; icon: FeatherName } | null
  reviewed: boolean
  reviewDisabled: boolean
  reviewLabel: string
  onReviewChange: () => void
  onManual: () => void
  followUps: VisionResultFollowUp[]
  warning?: string | null
  diagnostics?: ReactNode
  confirmation?: string | null
  primaryLabel: string
  primaryIcon: FeatherName
  primaryLoading: boolean
  primaryDisabled: boolean
  onPrimary: () => void
  secondaryLabel: string
  secondaryTone?: 'neutral' | 'destructive'
  onSecondary: () => void
}) {
  const { colors } = useDrapeTheme()
  const groups: Array<{ id: VisionMetricGroup; title: string; body: string }> = [
    { id: 'core', title: 'Core measurements', body: 'The values most custom orders use first.' },
    { id: 'lengths', title: 'Lengths', body: 'Sleeve, torso, trouser, and garment-length context.' },
    { id: 'specialist', title: 'Specialist detail', body: 'Focused measurements for detailed fit work.' },
  ]

  return (
    <VisionShell
      testID="vision-results"
      header={<VisionHeader status="Scan complete" tone={statusTone} onClose={onClose} />}
      footer={confirmation ? (
        <View style={styles.confirmationRow}>
          <Feather name="check-circle" size={20} color={colors.success} />
          <Text style={[styles.confirmationText, { color: colors.ink }]}>{confirmation}</Text>
        </View>
      ) : (compact) => (
        <View style={[styles.visionDockActions, compact && styles.visionDockActionsCompact]}>
          <VisionPrimaryButton
            label={primaryLabel}
            icon={primaryIcon}
            loading={primaryLoading}
            disabled={primaryDisabled}
            onPress={onPrimary}
            compact={compact}
            style={compact ? undefined : styles.visionDockPrimary}
          />
          <VisionDockIconButton
            icon={secondaryTone === 'destructive' ? 'refresh-cw' : 'edit-3'}
            label={secondaryLabel}
            destructive={secondaryTone === 'destructive'}
            onPress={onSecondary}
          />
        </View>
      )}
    >
      <VisionSectionTitle eyebrow="Drapeon Vision" title={title} body={body} />
      <View style={styles.resultToolbar}>
        <VisionStatusChip label={status} tone={statusTone} />
        <View style={[styles.compactSegmentedControl, { backgroundColor: colors.boneDeep }]}>
          {(['in', 'cm'] as const).map((value) => {
            const selected = unit === value
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Show measurements in ${value === 'in' ? 'inches' : 'centimetres'}`}
                accessibilityState={{ selected }}
                onPress={() => onUnitChange(value)}
                style={[styles.compactSegment, selected && { backgroundColor: colors.surface }]}
              >
                <Text style={[styles.compactSegmentText, { color: selected ? colors.ink : colors.inkLight }]}>{value}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {groups.map((group) => {
        const groupMetrics = metrics.filter((metric) => metric.group === group.id)
        if (!groupMetrics.length) return null
        return (
          <View key={group.id} style={styles.resultSection}>
            <VisionSectionTitle title={group.title} body={group.body} />
            <View style={styles.metricGrid}>
              {groupMetrics.map((metric) => (
                <VisionMetricCard
                  key={metric.id}
                  label={metric.label}
                  value={metric.value}
                  confidence={metric.confidence}
                  emphasized={metric.emphasized}
                  onEdit={onManual}
                />
              ))}
            </View>
          </View>
        )
      })}

      <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
        <VisionSectionTitle title={reviewTitle} body={reviewBody} />
        {reviewNotice ? (
          <VisionInstructionPanel
            icon={reviewNotice.icon}
            title={reviewNotice.title}
            body={reviewNotice.body}
            tone={reviewNotice.tone}
          />
        ) : null}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: reviewed, disabled: reviewDisabled }}
          disabled={reviewDisabled}
          onPress={onReviewChange}
          style={[styles.reviewCheck, reviewDisabled && styles.reviewCheckDisabled]}
        >
          <View style={[
            styles.reviewCheckbox,
            { borderColor: colors.lightGrey },
            reviewed && { backgroundColor: colors.needleGreen, borderColor: colors.needleGreen },
          ]}>
            {reviewed ? <Feather name="check" size={15} color={VISION_CAMERA_PALETTE.text} /> : null}
          </View>
          <View style={styles.reviewCheckCopy}>
            <Text style={[styles.reviewCheckTitle, { color: colors.ink }]}>{reviewLabel}</Text>
            <Text style={[styles.reviewCheckBody, { color: colors.inkLight }]}>Vision estimates need a human check before entering a brief or order.</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Use manual measurements instead" onPress={onManual} style={styles.manualAction}>
          <Feather name="edit-2" size={17} color={colors.needleGreenDark} />
          <Text style={[styles.manualActionLabel, { color: colors.needleGreenDark }]}>Use manual measurements instead</Text>
        </Pressable>
      </View>

      {followUps.length ? (
        <View style={styles.resultSection}>
          <VisionSectionTitle
            title="Complete your fit profile"
            body="Fit 360 captures the core. Focused scans fill in the details it should not guess."
          />
          <View style={styles.followUpList}>
            {followUps.map((item) => (
              <View key={item.id} style={styles.followUpWrap}>
                <VisionStepCard
                  materialIcon={item.icon}
                  title={item.title}
                  body={item.body}
                  status={item.status}
                  statusTone="active"
                  onPress={item.onPress}
                />
                <View style={styles.fieldChipRow}>
                  {item.fields.map((field) => (
                    <View key={`${item.id}-${field}`} style={[styles.fieldChip, { backgroundColor: colors.boneDeep }]}>
                      <Text style={[styles.fieldChipText, { color: colors.inkLight }]}>{field}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {warning ? <VisionInstructionPanel icon="alert-circle" title="Review recommended" body={warning} tone="warning" /> : null}
      {diagnostics}
    </VisionShell>
  )
}

function VisionUnitSegment({
  value,
  onChange,
}: {
  value: 'cm' | 'in'
  onChange: (value: 'cm' | 'in') => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <View style={[styles.compactSegmentedControl, { backgroundColor: colors.boneDeep }]}>
      {(['in', 'cm'] as const).map((unit) => {
        const selected = unit === value
        return (
          <Pressable
            key={unit}
            accessibilityRole="button"
            accessibilityLabel={`Use ${unit === 'in' ? 'inches' : 'centimetres'}`}
            accessibilityState={{ selected }}
            onPress={() => onChange(unit)}
            style={[styles.compactSegment, selected && { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.compactSegmentText, { color: selected ? colors.ink : colors.inkLight }]}>{unit}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function VisionFormCard({ children }: { children: ReactNode }) {
  const { colors } = useDrapeTheme()
  return (
    <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
      {children}
    </View>
  )
}

function VisionField({
  field,
  multiline = false,
}: {
  field: VisionFormField
  multiline?: boolean
}) {
  const { colors } = useDrapeTheme()
  return (
    <View style={[styles.formField, multiline && styles.formFieldWide]}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{field.label}</Text>
      <TextInput
        accessibilityLabel={field.accessibilityLabel ?? field.label}
        value={field.value}
        onChangeText={field.onChange}
        keyboardType={field.keyboardType}
        multiline={multiline}
        placeholder={field.placeholder}
        placeholderTextColor={colors.midGrey}
        style={[
          styles.fieldInput,
          multiline && styles.fieldTextArea,
          { color: colors.ink, backgroundColor: colors.bone, borderColor: colors.lightGrey },
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

function VisionOptionStrip({ options }: { options: VisionFormOption[] }) {
  const { colors } = useDrapeTheme()
  return (
    <View style={styles.optionStrip}>
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityState={{ selected: option.selected, disabled: option.disabled }}
          disabled={option.disabled}
          onPress={option.onPress}
          style={[
            styles.optionChip,
            {
              backgroundColor: option.selected ? colors.needleGreen : colors.boneDeep,
              borderColor: option.selected ? colors.needleGreen : colors.lightGrey,
            },
            option.disabled && styles.disabledOption,
          ]}
        >
          <Text style={[styles.optionChipText, { color: option.selected ? VISION_CAMERA_PALETTE.text : colors.ink }]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function VisionChecklist({ items }: { items: VisionChecklistItem[] }) {
  const { colors } = useDrapeTheme()
  return (
    <View style={styles.checkList}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.checked }}
          onPress={item.onPress}
          style={styles.checkRow}
        >
          <View style={[
            styles.checkbox,
            { borderColor: item.checked ? colors.needleGreen : colors.lightGrey },
            item.checked && { backgroundColor: colors.needleGreen },
          ]}>
            {item.checked ? <Feather name="check" size={15} color={VISION_CAMERA_PALETTE.text} /> : null}
          </View>
          <View style={styles.checkCopy}>
            <Text style={[styles.checkTitle, { color: colors.ink }]}>{item.label}</Text>
            <Text style={[styles.checkHint, { color: colors.inkLight }]}>{item.hint}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

export function VisionSpecialistResultView({
  status,
  onClose,
  title,
  body,
  unit,
  onUnitChange,
  metrics,
  tapeItems,
  tapeSummary,
  privacyBody,
  followUps,
  diagnostics,
  confirmation,
  primaryLabel,
  primaryLoading,
  onPrimary,
  onRunAgain,
  returnLabel,
  onReturn,
}: {
  status: string
  onClose: () => void
  title: string
  body: string
  unit: 'cm' | 'in'
  onUnitChange: (value: 'cm' | 'in') => void
  metrics: VisionSpecialistMetricItem[]
  tapeItems: VisionTapeComparisonItem[]
  tapeSummary?: { title: string; body: string; tone: VisionSurfaceTone } | null
  privacyBody: string
  followUps: VisionResultFollowUp[]
  diagnostics?: ReactNode
  confirmation?: string | null
  primaryLabel: string
  primaryLoading: boolean
  onPrimary: () => void
  onRunAgain: () => void
  returnLabel: string
  onReturn: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-specialist-result"
      header={<VisionHeader status={status} tone="success" onClose={onClose} />}
      footer={confirmation ? (
        <View style={styles.confirmationRow}>
          <Feather name="check-circle" size={20} color={colors.success} />
          <Text style={[styles.confirmationText, { color: colors.ink }]}>{confirmation}</Text>
        </View>
      ) : (compact) => (
        <View style={[styles.visionDockActions, compact && styles.visionDockActionsCompact]}>
          <VisionPrimaryButton
            label={primaryLabel}
            icon="check"
            loading={primaryLoading}
            onPress={onPrimary}
            compact={compact}
            style={compact ? undefined : styles.visionDockPrimary}
          />
          <VisionDockIconButton icon="refresh-cw" label="Run scan again" destructive onPress={onRunAgain} />
          <VisionDockIconButton icon="grid" label={returnLabel} onPress={onReturn} />
        </View>
      )}
    >
      <VisionSectionTitle eyebrow="Specialist result" title={title} body={body} />
      <View style={styles.resultToolbar}>
        <VisionStatusChip label={status} tone="success" />
        <VisionUnitSegment value={unit} onChange={onUnitChange} />
      </View>
      <View style={styles.metricGrid}>
        {metrics.map((metric) => (
          <VisionMetricCard
            key={metric.id}
            label={metric.label}
            value={metric.value}
            confidence={metric.confidence}
            note={metric.note}
          />
        ))}
      </View>
      <VisionFormCard>
        <VisionSectionTitle
          title="Tape check"
          body={`Enter each tape value in ${unit === 'cm' ? 'centimetres' : 'inches'} to compare it with Vision.`}
        />
        <View style={styles.tapeList}>
          {tapeItems.map((item) => (
            <View key={item.id} style={[styles.tapeRow, { borderBottomColor: colors.lightGrey }]}>
              <View style={styles.tapeCopy}>
                <Text style={[styles.checkTitle, { color: colors.ink }]}>{item.label}</Text>
                <Text style={[styles.checkHint, { color: colors.inkLight }]}>Vision estimate: {item.estimate}</Text>
                {item.comparison ? (
                  <VisionStatusChip label={item.comparison} tone={item.tone ?? 'neutral'} />
                ) : null}
              </View>
              <TextInput
                accessibilityLabel={`${item.label} tape value`}
                value={item.value}
                onChangeText={item.onChange}
                keyboardType={item.keyboardType}
                placeholder={item.placeholder}
                placeholderTextColor={colors.midGrey}
                style={[styles.tapeInput, { color: colors.ink, backgroundColor: colors.bone, borderColor: colors.lightGrey }]}
              />
            </View>
          ))}
        </View>
        {tapeSummary ? (
          <VisionInstructionPanel
            icon={tapeSummary.tone === 'warning' || tapeSummary.tone === 'blocked' ? 'alert-circle' : 'check-circle'}
            title={tapeSummary.title}
            body={tapeSummary.body}
            tone={tapeSummary.tone}
          />
        ) : null}
      </VisionFormCard>
      {diagnostics}
      <VisionInstructionPanel icon="shield" title="Estimate until tape-checked" body={privacyBody} tone="active" />
      {followUps.length ? (
        <View style={styles.resultSection}>
          <VisionSectionTitle title="Keep measuring" body="Add another focused area or return to the full Vision hub." />
          {followUps.map((item) => (
            <VisionStepCard
              key={item.id}
              materialIcon={item.icon}
              title={item.title}
              body={item.body}
              status={item.status}
              statusTone="active"
              onPress={item.onPress}
            />
          ))}
        </View>
      ) : null}
    </VisionShell>
  )
}

export function VisionGarmentQcView({
  onClose,
  photoUrl,
  onTakePhoto,
  onChoosePhoto,
  unit,
  onUnitChange,
  presets,
  fields,
  checklist,
  note,
  onNoteChange,
  message,
  saving,
  onSave,
  onReturn,
}: {
  onClose: () => void
  photoUrl?: string | null
  onTakePhoto: () => void
  onChoosePhoto: () => void
  unit: 'cm' | 'in'
  onUnitChange: (value: 'cm' | 'in') => void
  presets: VisionFormOption[]
  fields: VisionFormField[]
  checklist: VisionChecklistItem[]
  note: VisionFormField
  onNoteChange: (value: string) => void
  message?: string | null
  saving: boolean
  onSave: () => void
  onReturn: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-garment-qc"
      header={<VisionHeader status="Garment QC" tone="active" onClose={onClose} />}
      footer={(
        <View style={styles.resultActions}>
          <VisionPrimaryButton label="Save QC to order" icon="check" loading={saving} onPress={onSave} />
          <Pressable accessibilityRole="button" accessibilityLabel="Return to order" disabled={saving} onPress={onReturn} style={styles.secondaryResultAction}>
            <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>Return to order</Text>
          </Pressable>
        </View>
      )}
    >
      <VisionSectionTitle
        eyebrow="Garment QC"
        title="Verify before handoff"
        body="Save final measurements, a proof photo, and a clean checklist to the order timeline."
      />
      <VisionFormCard>
        <VisionSectionTitle title="Proof photo" body="Attach a clear finished-garment image for the customer and ops." />
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Take proof photo" disabled={saving} onPress={onTakePhoto} style={[styles.outlineAction, { borderColor: colors.lightGrey }]}>
            <Feather name="camera" size={18} color={colors.needleGreenDark} />
            <Text style={[styles.outlineActionText, { color: colors.needleGreenDark }]}>Take photo</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose proof photo" disabled={saving} onPress={onChoosePhoto} style={[styles.outlineAction, { borderColor: colors.lightGrey }]}>
            <Feather name="image" size={18} color={colors.needleGreenDark} />
            <Text style={[styles.outlineActionText, { color: colors.needleGreenDark }]}>Choose photo</Text>
          </Pressable>
        </View>
        {photoUrl ? (
          <View style={styles.photoPreview}>
            <Image source={{ uri: photoUrl }} style={styles.photo} />
            <VisionStatusChip label="Photo attached" tone="success" />
          </View>
        ) : null}
      </VisionFormCard>
      <VisionFormCard>
        <View style={styles.formCardHeader}>
          <VisionSectionTitle title="Final measurements" body="Enter only the fields that matter for this garment." style={styles.formCardHeaderCopy} />
          <VisionUnitSegment value={unit} onChange={onUnitChange} />
        </View>
        <VisionOptionStrip options={presets} />
        <View style={styles.formGrid}>{fields.map((field) => <VisionField key={field.id} field={field} />)}</View>
      </VisionFormCard>
      <VisionFormCard>
        <VisionSectionTitle title="QC checklist" body="Confirm the garment is safe to hand off." />
        <VisionChecklist items={checklist} />
      </VisionFormCard>
      <VisionFormCard>
        <VisionSectionTitle title="Tailor note" body="Record any tolerance, adjustment, or handoff context." />
        <VisionField field={{ ...note, onChange: onNoteChange }} multiline />
      </VisionFormCard>
      {message ? <VisionInstructionPanel icon="info" title="QC update" body={message} tone="active" /> : null}
    </VisionShell>
  )
}

export type VisionSizeRangeField = {
  id: string
  label: string
  min: VisionFormField
  max: VisionFormField
}

export function VisionSizeGuideView({
  onClose,
  itemTitle,
  loading,
  sizes,
  success,
  unit,
  onUnitChange,
  ranges,
  note,
  message,
  saving,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  onClose: () => void
  itemTitle: string
  loading: boolean
  sizes: VisionFormOption[]
  success?: { title: string; body: string } | null
  unit: 'cm' | 'in'
  onUnitChange: (value: 'cm' | 'in') => void
  ranges: VisionSizeRangeField[]
  note: VisionFormField
  message?: string | null
  saving: boolean
  primaryLabel: string
  primaryDisabled: boolean
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-size-guide"
      header={<VisionHeader status="Size guide" tone="active" onClose={onClose} />}
      footer={(
        <View style={styles.resultActions}>
          <VisionPrimaryButton label={primaryLabel} icon="check" loading={saving} disabled={primaryDisabled} onPress={onPrimary} />
          <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} disabled={saving} onPress={onSecondary} style={styles.secondaryResultAction}>
            <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>{secondaryLabel}</Text>
          </Pressable>
        </View>
      )}
    >
      <VisionSectionTitle
        eyebrow="Ready-made sizing"
        title="Build a real fit guide"
        body="Add body-fit ranges for each listing size so shoppers can compare before paying."
      />
      {success ? <VisionInstructionPanel icon="check-circle" title={success.title} body={success.body} tone="success" /> : null}
      <VisionFormCard>
        <VisionSectionTitle title={itemTitle} body={loading ? 'Loading listing sizes...' : sizes.length ? 'Choose the size these ranges describe.' : 'Add sizes to this listing first, then return here.'} />
        {!loading && sizes.length ? <VisionOptionStrip options={sizes} /> : null}
      </VisionFormCard>
      {!loading && sizes.length ? (
        <>
          <VisionFormCard>
            <View style={styles.formCardHeader}>
              <VisionSectionTitle title="Fit ranges" body="Use body measurements, not flat garment width." style={styles.formCardHeaderCopy} />
              <VisionUnitSegment value={unit} onChange={onUnitChange} />
            </View>
            <View style={styles.rangeList}>
              {ranges.map((range) => (
                <View key={range.id} style={[styles.rangeRow, { borderBottomColor: colors.lightGrey }]}>
                  <Text style={[styles.fieldLabel, { color: colors.ink }]}>{range.label}</Text>
                  <View style={styles.rangeInputs}>
                    <VisionField field={range.min} />
                    <VisionField field={range.max} />
                  </View>
                </View>
              ))}
            </View>
          </VisionFormCard>
          <VisionFormCard>
            <VisionSectionTitle title="Fit note" body="Explain ease, silhouette, or when a shopper should size up." />
            <VisionField field={note} multiline />
          </VisionFormCard>
        </>
      ) : null}
      {message ? <VisionInstructionPanel icon="info" title="Size guide update" body={message} tone="active" /> : null}
    </VisionShell>
  )
}

export function VisionFallbackView({
  onClose,
  title,
  body,
  primaryLabel,
  onPrimary,
  retryLabel,
  onRetry,
  onReport,
  onBack,
}: {
  onClose: () => void
  title: string
  body: string
  primaryLabel: string
  onPrimary: () => void
  retryLabel?: string
  onRetry?: () => void
  onReport: () => void
  onBack: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <VisionShell
      testID="vision-fallback"
      scrollable={false}
      header={<VisionHeader status="Needs attention" tone="blocked" onClose={onClose} />}
      footer={(
        <View style={styles.resultActions}>
          <VisionPrimaryButton label={primaryLabel} onPress={onPrimary} />
          {retryLabel && onRetry ? (
            <Pressable accessibilityRole="button" accessibilityLabel={retryLabel} onPress={onRetry} style={styles.secondaryResultAction}>
              <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>{retryLabel}</Text>
            </Pressable>
          ) : null}
          <View style={styles.secondaryActionRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Report scan issue" onPress={onReport} style={styles.secondaryHalf}>
              <Feather name="message-circle" size={16} color={colors.inkLight} />
              <Text style={[styles.secondaryResultLabel, { color: colors.inkLight }]}>Report issue</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to scan picker" onPress={onBack} style={styles.secondaryHalf}>
              <Feather name="grid" size={16} color={colors.needleGreenDark} />
              <Text style={[styles.secondaryResultLabel, { color: colors.needleGreenDark }]}>Scan picker</Text>
            </Pressable>
          </View>
        </View>
      )}
      contentContainerStyle={styles.fallbackContent}
    >
      <VisionInstructionPanel icon="alert-triangle" title={title} body={body} tone="blocked" />
      <VisionInstructionPanel
        icon="shield"
        title="No incomplete scan is saved"
        body="Camera frames stay in memory. You can continue manually or return to the workflow that opened Vision."
        tone="active"
      />
    </VisionShell>
  )
}

const styles = StyleSheet.create({
  optionList: { gap: Spacing.md },
  optionGroup: { gap: Spacing.md },
  optionGroupHeader: { gap: Spacing.xs, paddingTop: Spacing.sm, paddingHorizontal: Spacing.xs },
  optionGroupEyebrow: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  optionGroupBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  optionWrap: { gap: Spacing.sm },
  optionHint: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 17, paddingHorizontal: Spacing.md },
  segmentedControl: { minHeight: 48, borderRadius: Radius.full, backgroundColor: 'rgba(128,128,128,0.14)', padding: 4, flexDirection: 'row' },
  segment: { flex: 1, minHeight: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 18 },
  heightPicker: { minHeight: 148, borderRadius: Radius.lg, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, ...Shadow.sm },
  heightAdjust: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,128,128,0.12)' },
  heightValue: { flex: 1, paddingHorizontal: Spacing.md, textAlign: 'center', fontFamily: Fonts.bodySemiBold, fontSize: 38, lineHeight: 46 },
  confidenceList: { gap: Spacing.md },
  textAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  textActionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  processingCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.xl, gap: Spacing.xl, ...Shadow.sm },
  processingMark: { alignItems: 'center', justifyContent: 'center', minHeight: 104 },
  processingList: { gap: Spacing.md },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  processingDot: { width: 24, height: 24, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  processingText: { flex: 1, fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  processingTextActive: { fontFamily: Fonts.bodySemiBold },
  resultActions: { gap: Spacing.xs },
  visionDockActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  visionDockActionsCompact: { justifyContent: 'center' },
  visionDockPrimary: { flex: 1, minWidth: 0 },
  secondaryResultAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryResultLabel: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  confirmationRow: { minHeight: 54, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  confirmationText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 20 },
  resultToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  compactSegmentedControl: { minHeight: 40, minWidth: 116, borderRadius: Radius.full, padding: 3, flexDirection: 'row' },
  compactSegment: { flex: 1, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  compactSegmentText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, lineHeight: 16 },
  resultSection: { gap: Spacing.lg },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  reviewCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: Spacing.lg, ...Shadow.sm },
  reviewCheck: { minHeight: 64, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  reviewCheckDisabled: { opacity: 0.48 },
  reviewCheckbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  reviewCheckCopy: { flex: 1, gap: 3 },
  reviewCheckTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 20 },
  reviewCheckBody: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 18 },
  manualAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  manualActionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  followUpList: { gap: Spacing.md },
  followUpWrap: { gap: Spacing.sm },
  fieldChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, paddingHorizontal: Spacing.sm },
  fieldChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  fieldChipText: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.xs, lineHeight: 16 },
  formCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: Spacing.lg, ...Shadow.sm },
  formCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  formCardHeaderCopy: { flex: 1 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  formField: { flexGrow: 1, flexBasis: '46%', minWidth: 132, gap: Spacing.xs },
  formFieldWide: { flexBasis: '100%', minWidth: '100%' },
  fieldLabel: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  fieldInput: { minHeight: 48, borderRadius: Radius.sm, borderWidth: 1, paddingHorizontal: Spacing.md, fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 21 },
  fieldTextArea: { minHeight: 112, paddingTop: Spacing.md },
  optionStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  optionChip: { minHeight: 44, borderRadius: Radius.full, borderWidth: 1, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
  optionChipText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  disabledOption: { opacity: 0.48 },
  checkList: { gap: Spacing.md },
  checkRow: { minHeight: 52, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkCopy: { flex: 1, gap: 3 },
  checkTitle: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 20 },
  checkHint: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 18 },
  tapeList: { gap: 0 },
  tapeRow: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.md },
  tapeCopy: { flex: 1, gap: 4 },
  tapeInput: { width: 92, minHeight: 48, borderRadius: Radius.sm, borderWidth: 1, paddingHorizontal: Spacing.md, textAlign: 'center', fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md },
  secondaryActionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xs },
  secondaryHalf: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  photoActions: { flexDirection: 'row', gap: Spacing.md },
  outlineAction: { flex: 1, minHeight: 48, borderRadius: Radius.full, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  outlineActionText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  photoPreview: { gap: Spacing.md },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.md, backgroundColor: 'rgba(128,128,128,0.12)' },
  rangeList: { gap: 0 },
  rangeRow: { gap: Spacing.sm, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rangeInputs: { flexDirection: 'row', gap: Spacing.md },
  fallbackContent: { flex: 1, justifyContent: 'center' },
})
