import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type ViewStyle } from 'react-native'
import { Colors, Radius } from '@/constants/theme'

type SkeletonBlockProps = {
  style?: ViewStyle | ViewStyle[]
}

export function SkeletonBlock({ style }: SkeletonBlockProps) {
  const opacity = useRef(new Animated.Value(0.52)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.52,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    )

    loop.start()
    return () => loop.stop()
  }, [opacity])

  return <Animated.View style={[styles.block, { opacity }, style]} />
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.md,
  },
})
