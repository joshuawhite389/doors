// Native caret-follow for the text boxes (iOS only; see ios/CaretFollowModule.swift). A no-op where the native module
// isn't in the binary (Expo Go, web), so the app still runs there with the old behaviour.
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type CaretFollowNative = { start(): void; follows(): number };
const native = Platform.OS === "ios" ? requireOptionalNativeModule<CaretFollowNative>("CaretFollow") : null;

export function startCaretFollow(): boolean {
  native?.start();
  return !!native;
}

export function caretFollows(): number {
  return native?.follows() ?? -1;
}
