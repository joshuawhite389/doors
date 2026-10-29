// The app's spoken-audio session back after the mic recorded (iOS only; see ios/SpokenSessionModule.swift). Null where
// the native module isn't in the binary (Expo Go, web, an older build): the caller then falls back to expo-audio's.
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type SpokenSessionNative = { restore(): boolean; category(): string };
const native = Platform.OS === "ios" ? requireOptionalNativeModule<SpokenSessionNative>("SpokenSession") : null;

export const hasSpokenSession = () => !!native;
// true when the session is playback / spokenAudio again; false when the module is missing or iOS refused
export const restoreSpokenSession = (): boolean => native?.restore() ?? false;
// "<category>|<mode>" for a check (AVAudioSessionCategoryPlayback|AVAudioSessionModeSpokenAudio), "" without the module
export const sessionCategory = (): string => native?.category() ?? "";
