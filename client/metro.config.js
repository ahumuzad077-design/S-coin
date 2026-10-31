const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const emptyModule = path.resolve(__dirname, "src/empty-module.js");

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  stream: require.resolve("readable-stream"),
  crypto: emptyModule,
  http: emptyModule,
  https: emptyModule,
  net: emptyModule,
  tls: emptyModule,
  zlib: emptyModule,
  os: emptyModule,
  dns: emptyModule,
  assert: emptyModule,
  url: emptyModule,
  path: emptyModule,
  fs: emptyModule,
};

module.exports = config;
