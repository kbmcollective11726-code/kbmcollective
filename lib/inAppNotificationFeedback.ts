import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

let loadedSound: Audio.Sound | null = null;
let loadPromise: Promise<Audio.Sound | null> | null = null;
let lastFeedbackAt = 0;
const THROTTLE_MS = 450;

async function getSound(): Promise<Audio.Sound | null> {
  if (loadedSound) return loadedSound;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      await Audio.setAudioModeAsync({
        // Respect the iOS silent switch: no in-app chime when the ringer is muted.
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/in-app-notification.wav'),
        { shouldPlay: false, volume: 0.5, isLooping: false }
      );
      loadedSound = sound;
      return sound;
    } catch {
      return null;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/**
 * Haptic + short sound when a new in-app notification row arrives (Realtime INSERT).
 * Skips web. Throttled to avoid bursts. Safe to call from any screen.
 */
export async function playInAppNotificationFeedback(): Promise<void> {
  if (Platform.OS === 'web') return;

  const now = Date.now();
  if (now - lastFeedbackAt < THROTTLE_MS) return;
  lastFeedbackAt = now;

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      /* ignore */
    }
  }

  try {
    const sound = await getSound();
    if (!sound) return;
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    /* ignore */
  }
}
