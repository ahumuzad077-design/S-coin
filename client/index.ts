import "react-native-get-random-values";
import "./polyfills";

import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent registers the same app entry for Expo Go and native builds.
registerRootComponent(App);
