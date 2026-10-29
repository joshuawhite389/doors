// The Doors icons on the phone (Jard 10-24 #1): the web's set (public/lib/icons.js), rendered to PNGs by
// scripts/make-icons.mjs and tinted here, so no SVG module rides the native build. Decoration only: the button or row
// around an icon carries the words and the accessibility label.
import { Image } from "react-native";
import { ICON_FILES, type IconName } from "./icon-files";

export type { IconName };
export function Ic({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return <Image source={ICON_FILES[name]} style={{ width: size, height: size, tintColor: color }} accessibilityElementsHidden importantForAccessibility="no" />;
}
