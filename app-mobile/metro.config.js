// Metro for the Doors phone app: the app shares the web page's plain-JS planner (../public/lib), so Metro watches
// and resolves that folder too. Only this app's own node_modules are used (the repo root has no npm deps).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../public/lib")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
