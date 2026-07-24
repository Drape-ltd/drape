import { useEffect, useRef, useState } from 'react'
import { Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const SEEN_KEY_BASE = 'drape_onboarding_seen_v1'
const { width: SCREEN_WIDTH } = Dimensions.get('window')

type Slide = {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  body: string
}

const CUSTOMER_SLIDES: Slide[] = [
  {
    icon: 'scissors',
    title: 'Welcome to Drapeon',
    body: 'Connect with skilled tailors who bring your fashion vision to life. Every order is built around you.',
  },
  {
    icon: 'list',
    title: 'How it works',
    body: 'Browse tailor profiles, send a brief, confirm your measurements, and track your order through to delivery.',
  },
  {
    icon: 'check-circle',
    title: "You're all set",
    body: 'Your measurements, wishlists, and orders live right here. Start by exploring tailor profiles on the home tab.',
  },
]

const TAILOR_SLIDES: Slide[] = [
  {
    icon: 'briefcase',
    title: 'Welcome to Drapeon',
    body: 'Your complete workspace for managing bespoke orders, customer conversations, and your public profile.',
  },
  {
    icon: 'layers',
    title: 'Your workspace',
    body: 'Track every order through each stage, stay in touch with customers, and keep your availability current.',
  },
  {
    icon: 'shield',
    title: 'Private trust review',
    body: 'Record the short challenge video in setup. Drapeon reviews it privately, then notifies you when your storefront can go live.',
  },
]

function SlideItem({ item }: { item: Slide }) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.iconWrap}>
        <Feather name={item.icon} size={40} color={Colors.needleGreen} />
      </View>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideBody}>{item.body}</Text>
    </View>
  )
}

export default function OnboardingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { role, userId } = useLocalSearchParams<{ role?: string; userId?: string }>()
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const listRef = useRef<FlatList<Slide>>(null)

  const slides = role === 'TAILOR' ? TAILOR_SLIDES : CUSTOMER_SLIDES
  const destination = role === 'TAILOR' ? '/(tailor)/profile' : '/(customer)'
  const seenKey = userId ? `${SEEN_KEY_BASE}_${userId}` : SEEN_KEY_BASE

  useEffect(() => {
    let active = true

    void AsyncStorage.getItem(seenKey)
      .then((seen) => {
        if (!active) return
        if (seen === '1') {
          router.replace(destination)
          return
        }
        setReady(true)
      })
      .catch(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
    }
  }, [destination, router, seenKey])

  async function markSeenAndNavigate() {
    try {
      await AsyncStorage.setItem(seenKey, '1')
    } finally {
      router.replace(destination)
    }
  }

  function goNext() {
    if (index < slides.length - 1) {
      const next = index + 1
      listRef.current?.scrollToIndex({ index: next, animated: true })
      setIndex(next)
    } else {
      void markSeenAndNavigate()
    }
  }

  function goBack() {
    if (index > 0) {
      const prev = index - 1
      listRef.current?.scrollToIndex({ index: prev, animated: true })
      setIndex(prev)
    }
  }

  const isLast = index === slides.length - 1

  if (!ready) return null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Skip button */}
      <View style={styles.topBar}>
        <View style={styles.topSpacer} />
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => { void markSeenAndNavigate() }}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
          activeOpacity={0.72}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <SlideItem item={item} />}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={styles.list}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      {/* Bottom nav */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + Spacing.sm, Spacing.xl) }]}>
        <TouchableOpacity
          style={[styles.backBtn, index === 0 && styles.backBtnHidden]}
          onPress={goBack}
          disabled={index === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous slide"
          activeOpacity={0.72}
        >
          <Feather name="arrow-left" size={20} color={Colors.inkLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.nextBtn}
          onPress={goNext}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next slide'}
          activeOpacity={0.82}
        >
          <Text style={styles.nextBtnText}>{isLast ? "Let's go" : 'Next'}</Text>
          {!isLast && <Feather name="arrow-right" size={18} color={Colors.textInverse} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bone,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  topSpacer: { flex: 1 },
  skipBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  skipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  list: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.xl,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  slideTitle: {
    fontFamily: Fonts.display,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    letterSpacing: 0,
  },
  slideBody: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    lineHeight: 26,
    color: Colors.inkLight,
    textAlign: 'center',
    maxWidth: 300,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  dotActive: {
    width: 24,
    backgroundColor: Colors.needleGreen,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnHidden: {
    opacity: 0,
  },
  nextBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  nextBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
})
