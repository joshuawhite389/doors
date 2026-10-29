import './src/devclock'; // dev only: a pinned clock when EXPO_PUBLIC_DOORS_NOW is set (does nothing otherwise)
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
