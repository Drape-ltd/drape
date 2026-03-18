/**
 * Personal Information
 *
 * Lets the customer update their display name and phone number.
 * Email is shown read-only (tied to Supabase auth identity).
 */

import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export default function PersonalInfoScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name ?? '')
  const [phone, setPhone] = useState(user?.user_metadata?.phone ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!displayName.trim()) {
      Alert.alert('Required', 'Display name cannot be empty.')
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim(), phone: phone.trim() || null },
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      Alert.alert('Saved', 'Your personal information has been updated.')
      router.back()
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal information</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>

        <View style={styles.card}>

          {/* Email — read-only */}
          <View style={styles.field}>
            <Text style={styles.label}>Email address</Text>
            <View style={styles.readOnly}>
              <Text style={styles.readOnlyText}>{user?.email}</Text>
            </View>
            <Text style={styles.hint}>Your email address cannot be changed here.</Text>
          </View>

          <View style={styles.divider} />

          {/* Display name */}
          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={Colors.midGrey}
              maxLength={50}
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={styles.divider} />

          {/* Phone */}
          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+44 7700 000000"
              placeholderTextColor={Colors.midGrey}
              keyboardType="phone-pad"
              maxLength={20}
              returnKeyType="done"
            />
          </View>

        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={styles.saveBtnText}>Save changes</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },

  body: { padding: Spacing.xl, paddingBottom: 64, gap: Spacing.lg },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },

  field: { padding: Spacing.lg, gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },

  readOnly: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey,
  },
  readOnlyText: { fontSize: FontSize.md, color: Colors.midGrey },
  hint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  input: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, fontSize: FontSize.md, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },

  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.lg,
    padding: Spacing.lg, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
})
