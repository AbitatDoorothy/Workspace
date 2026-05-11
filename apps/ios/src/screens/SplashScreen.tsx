import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";

const STAR_POINTS = [
  { left: "5%", opacity: 0.34, size: 1, top: "8%" },
  { left: "18%", opacity: 0.5, size: 1, top: "12%" },
  { left: "41%", opacity: 0.44, size: 1, top: "5%" },
  { left: "68%", opacity: 0.42, size: 1, top: "9%" },
  { left: "91%", opacity: 0.54, size: 1.5, top: "4%" },
  { left: "12%", opacity: 0.36, size: 1, top: "22%" },
  { left: "31%", opacity: 0.56, size: 1.5, top: "19%" },
  { left: "58%", opacity: 0.4, size: 1, top: "21%" },
  { left: "82%", opacity: 0.58, size: 2, top: "25%" },
  { left: "3%", opacity: 0.4, size: 1, top: "31%" },
  { left: "24%", opacity: 0.45, size: 1, top: "34%" },
  { left: "49%", opacity: 0.36, size: 1, top: "29%" },
  { left: "73%", opacity: 0.52, size: 1.5, top: "36%" },
  { left: "94%", opacity: 0.34, size: 1, top: "41%" },
  { left: "8%", opacity: 0.58, size: 1.5, top: "49%" },
  { left: "36%", opacity: 0.4, size: 1, top: "46%" },
  { left: "61%", opacity: 0.56, size: 2, top: "51%" },
  { left: "86%", opacity: 0.44, size: 1, top: "47%" },
  { left: "16%", opacity: 0.5, size: 1, top: "59%" },
  { left: "44%", opacity: 0.34, size: 1.5, top: "63%" },
  { left: "66%", opacity: 0.52, size: 1, top: "61%" },
  { left: "97%", opacity: 0.38, size: 1, top: "58%" },
  { left: "4%", opacity: 0.42, size: 1, top: "70%" },
  { left: "27%", opacity: 0.56, size: 2, top: "74%" },
  { left: "52%", opacity: 0.4, size: 1, top: "71%" },
  { left: "78%", opacity: 0.5, size: 1.5, top: "76%" },
  { left: "13%", opacity: 0.36, size: 1, top: "84%" },
  { left: "38%", opacity: 0.54, size: 1, top: "88%" },
  { left: "63%", opacity: 0.44, size: 1, top: "82%" },
  { left: "90%", opacity: 0.58, size: 1.5, top: "87%" },
  { left: "21%", opacity: 0.5, size: 1, top: "95%" },
  { left: "50%", opacity: 0.36, size: 1.5, top: "97%" },
  { left: "72%", opacity: 0.42, size: 1, top: "93%" },
  { left: "34%", opacity: 0.48, size: 1, top: "39%" },
  { left: "57%", opacity: 0.46, size: 1, top: "14%" },
  { left: "75%", opacity: 0.34, size: 1, top: "67%" },
  { left: "7%", opacity: 0.46, size: 1, top: "91%" },
  { left: "29%", opacity: 0.52, size: 1.5, top: "7%" },
  { left: "47%", opacity: 0.48, size: 1, top: "79%" },
  { left: "69%", opacity: 0.5, size: 1.5, top: "44%" },
  { left: "84%", opacity: 0.42, size: 1, top: "15%" },
  { left: "92%", opacity: 0.46, size: 1, top: "72%" }
] as const;

const LARGE_STAR_POINTS = [
  { left: "15%", opacity: 0.72, size: 3, top: "17%" },
  { left: "53%", opacity: 0.78, size: 3.5, top: "11%" },
  { left: "88%", opacity: 0.68, size: 3, top: "33%" },
  { left: "22%", opacity: 0.64, size: 2.5, top: "55%" },
  { left: "57%", opacity: 0.7, size: 3, top: "68%" },
  { left: "82%", opacity: 0.74, size: 3.5, top: "83%" }
] as const;

const SHOOTING_STARS = [
  { delay: 900, left: "2%", top: "14%", travelX: 410, travelY: 290 },
  { delay: 4100, left: "38%", top: "3%", travelX: 330, travelY: 260 },
  { delay: 7200, left: "-8%", top: "43%", travelX: 430, travelY: 300 }
] as const;

const HEARTBEAT_SECOND_BEAT_DELAY_MS = 320;
const HEARTBEAT_CYCLE_MS = 2000;
const SHOOTING_STAR_REST_MS = 3400;

interface SplashScreenProps {
  onStart(): void;
}

export function SplashScreen({ onStart }: SplashScreenProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const buttonFloat = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const shootingProgress = useMemo(() => SHOOTING_STARS.map(() => new Animated.Value(0)), []);

  useEffect(() => {
    const heartbeatTimers: Array<ReturnType<typeof setTimeout>> = [];
    let isMounted = true;

    function pulseLogoWithHaptic(
      toValue: number,
      riseDuration: number,
      fallDuration: number,
      hapticStyle: Haptics.ImpactFeedbackStyle
    ) {
      void triggerPulseHaptic(hapticStyle);
      Animated.sequence([
        Animated.timing(logoScale, {
          duration: riseDuration,
          easing: Easing.out(Easing.quad),
          toValue,
          useNativeDriver: true
        }),
        Animated.timing(logoScale, {
          duration: fallDuration,
          easing: Easing.in(Easing.quad),
          toValue: 1,
          useNativeDriver: true
        })
      ]).start();
    }

    function runHeartbeatPulse() {
      if (!isMounted) {
        return;
      }

      pulseLogoWithHaptic(1.08, 150, 170, Haptics.ImpactFeedbackStyle.Heavy);
      heartbeatTimers.push(
        setTimeout(() => {
          if (isMounted) {
            pulseLogoWithHaptic(1.04, 120, 180, Haptics.ImpactFeedbackStyle.Medium);
          }
        }, HEARTBEAT_SECOND_BEAT_DELAY_MS)
      );
      heartbeatTimers.push(
        setTimeout(() => {
          runHeartbeatPulse();
        }, HEARTBEAT_CYCLE_MS)
      );
    }

    runHeartbeatPulse();

    return () => {
      isMounted = false;
      logoScale.stopAnimation();
      heartbeatTimers.forEach(clearTimeout);
    };
  }, [logoScale]);

  useEffect(() => {
    const buttonFloatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(buttonFloat, {
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true
        }),
        Animated.timing(buttonFloat, {
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true
        })
      ])
    );

    buttonFloatLoop.start();
    return () => {
      buttonFloatLoop.stop();
    };
  }, [buttonFloat]);

  useEffect(() => {
    const animations = SHOOTING_STARS.map((star, index) => {
      const progress = shootingProgress[index];
      return Animated.loop(
        Animated.sequence([
          Animated.delay(star.delay),
          Animated.timing(progress, {
            duration: 1750,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: true
          }),
          Animated.timing(progress, {
            duration: 0,
            toValue: 0,
            useNativeDriver: true
          }),
          Animated.delay(SHOOTING_STAR_REST_MS)
        ])
      );
    });

    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [shootingProgress]);

  function startApp() {
    if (isLeaving) {
      return;
    }

    setIsLeaving(true);
    Animated.timing(screenOpacity, {
      duration: 420,
      easing: Easing.inOut(Easing.quad),
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) {
        onStart();
      }
    });
  }

  const buttonTranslateY = buttonFloat.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -7, 1]
  });
  const buttonTranslateX = buttonFloat.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 3, -2]
  });

  return (
    <Animated.View style={[styles.screen, { opacity: screenOpacity }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {STAR_POINTS.map((star, index) => (
          <View
            key={`${star.left}-${star.top}-${index}`}
            style={[
              styles.star,
              {
                height: star.size,
                left: star.left,
                opacity: star.opacity,
                top: star.top,
                width: star.size
              }
            ]}
          />
        ))}
        {LARGE_STAR_POINTS.map((star, index) => (
          <View
            key={`large-${star.left}-${star.top}-${index}`}
            style={[
              styles.largeStar,
              {
                height: star.size,
                left: star.left,
                opacity: star.opacity,
                top: star.top,
                width: star.size
              }
            ]}
          />
        ))}
        {SHOOTING_STARS.map((star, index) => {
          const progress = shootingProgress[index];
          const opacity = progress.interpolate({
            inputRange: [0, 0.08, 0.55, 1],
            outputRange: [0, 0.9, 0.7, 0]
          });
          const scaleX = progress.interpolate({
            inputRange: [0, 0.2, 0.72, 1],
            outputRange: [0.2, 1, 0.72, 0.2]
          });
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, star.travelX]
          });
          const translateY = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, star.travelY]
          });

          return (
            <Animated.View
              key={`${star.left}-${star.top}`}
              style={[
                styles.shootingStar,
                {
                  left: star.left,
                  opacity,
                  top: star.top,
                  transform: [{ translateX }, { translateY }, { rotate: "36deg" }, { scaleX }]
                }
              ]}
            >
              <View style={styles.shootingStarTail} />
              <View style={styles.shootingStarHead} />
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.centerPanel}>
        <Animated.Text style={[styles.logo, { transform: [{ scale: logoScale }] }]}>
          ABITAT
        </Animated.Text>
        <Animated.View
          style={[
            styles.startButtonFloat,
            { transform: [{ translateX: buttonTranslateX }, { translateY: buttonTranslateY }] }
          ]}
        >
          <Pressable
            accessibilityLabel="Start Abitat"
            accessibilityRole="button"
            disabled={isLeaving}
            onPress={startApp}
            style={({ pressed }) => [
              styles.startButton,
              pressed ? styles.startButtonPressed : null,
              isLeaving ? styles.startButtonDisabled : null
            ]}
          >
            <Text style={styles.startButtonText}>START</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

async function triggerPulseHaptic(hapticStyle: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== "ios") {
    return;
  }

  try {
    await Haptics.impactAsync(hapticStyle);
  } catch {
    // Haptics may be unavailable in simulators or on devices with feedback disabled.
  }
}

const styles = StyleSheet.create({
  centerPanel: {
    alignItems: "center",
    gap: 52
  },
  largeStar: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    position: "absolute"
  },
  logo: {
    color: "#e8e8ec",
    fontSize: 50,
    fontWeight: "300"
  },
  screen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  },
  shootingStar: {
    alignItems: "center",
    flexDirection: "row",
    height: 8,
    position: "absolute",
    width: 132
  },
  shootingStarHead: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 5,
    width: 5
  },
  shootingStarTail: {
    backgroundColor: "#f4f4ff",
    borderRadius: 999,
    height: 1,
    opacity: 0.86,
    width: 127
  },
  star: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    position: "absolute"
  },
  startButtonFloat: {},
  startButton: {
    alignItems: "center",
    backgroundColor: "#e8e8ec",
    borderRadius: 4,
    justifyContent: "center",
    minHeight: 44,
    width: 248
  },
  startButtonDisabled: {
    opacity: 0.6
  },
  startButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }]
  },
  startButtonText: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500"
  }
});
