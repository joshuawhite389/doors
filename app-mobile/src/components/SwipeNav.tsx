// Swipe back and forward (Jard 10-23 #1: "swipe back and forward instead of tapping back, standard iOS"): a drag that
// starts at the screen's left edge pulls the screen right and goes Back (the screen's own Back: drive mode pauses the
// day); one from the right edge, after a Back, brings that screen again (Safari's forward). Only a drag that starts in
// the edge strip and moves sideways counts, so a map, a list or a row of chips keeps its own gestures.
// The screen under the top isn't mounted (App.tsx mounts the top screen only), so the page slides over the background
// and the screen it lands on eases in from the side, as iOS's pop does.
import { useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Easing, PanResponder, useWindowDimensions, View } from "react-native";
import { swipeGuard, useNav } from "../nav";
import { C } from "../ui";

const EDGE = 24;
export default function SwipeNav({ children, routeKey, disabled }: { children: React.ReactNode; routeKey: number; disabled?: boolean }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const live = useRef({ nav, width, disabled });
  live.current = { nav, width, disabled };
  // how the next screen arrives: from the left after a Back, from the right after a forward
  const arrive = useRef<0 | -1 | 1>(0);
  // before paint, so the new screen never shows a frame where the old one was swiped off to
  useLayoutEffect(() => {
    if (!arrive.current) return;
    x.setValue(arrive.current * width * 0.3);
    arrive.current = 0;
    Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [routeKey]);
  const pan = useMemo(() => {
    let dir: 0 | 1 | -1 = 0;
    const can = (d: 1 | -1) => !live.current.disabled && (d === 1 ? live.current.nav.stack.length > 1 : live.current.nav.ahead.length > 0);
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (ev, g) => {
        const w = live.current.width;
        const x0 = ev.nativeEvent.pageX - g.dx;
        const sideways = Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
        if (!sideways) return false;
        if (x0 <= EDGE && g.dx > 0 && can(1)) { dir = 1; return true; }
        if (x0 >= w - EDGE && g.dx < 0 && can(-1) && !swipeGuard.hscroll) { dir = -1; return true; }
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(dir === 1 ? Math.max(0, g.dx) : Math.min(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        const w = live.current.width;
        const go = dir === 1 ? g.dx > w * 0.33 || g.vx > 0.5 : -g.dx > w * 0.33 || g.vx < -0.5;
        const d = dir;
        if (!go) { Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); return; }
        Animated.timing(x, { toValue: d * w, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
          const before = live.current.nav.stack.at(-1)?.key;
          arrive.current = d === 1 ? -1 : 1;
          if (d === 1) live.current.nav.goBack(); else live.current.nav.forward();
          // a Back the screen declined (an unsaved sheet asks first): slide it back in place
          setTimeout(() => { if (live.current.nav.stack.at(-1)?.key === before) { arrive.current = 0; Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); } }, 0);
        });
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    });
  }, []);
  const shade = x.interpolate({ inputRange: [-width, 0, width], outputRange: [0.25, 0, 0.25], extrapolate: "clamp" });
  return (
    <View style={{ flex: 1, backgroundColor: "#E9E6DF" }} {...pan.panHandlers}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#000", opacity: shade }} />
      <Animated.View style={{ flex: 1, backgroundColor: C.bg, transform: [{ translateX: x }], shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }}>
        {children}
      </Animated.View>
    </View>
  );
}
