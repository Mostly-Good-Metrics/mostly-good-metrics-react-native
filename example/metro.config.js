const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');
const jsSDKRoot = path.resolve(projectRoot, '..', '..', 'javascript-sdk');

const config = getDefaultConfig(projectRoot);

// Watch both the RN SDK and JS SDK source files
config.watchFolders = [sdkRoot, jsSDKRoot];

// Block duplicate react/react-native from SDK node_modules
config.resolver.blockList = [
  new RegExp(path.resolve(sdkRoot, 'node_modules', 'react-native') + '/.*'),
  new RegExp(path.resolve(sdkRoot, 'node_modules', 'react') + '/.*'),
  new RegExp(path.resolve(jsSDKRoot, 'node_modules') + '/.*'),
];

// Redirect all modules to use example's node_modules
config.resolver.extraNodeModules = {
  '@mostly-good-metrics/react-native': sdkRoot,
  'mostly-good-metrics': jsSDKRoot,
  'react': path.resolve(projectRoot, 'node_modules', 'react'),
  'react-native': path.resolve(projectRoot, 'node_modules', 'react-native'),
  '@react-native-async-storage/async-storage': path.resolve(projectRoot, 'node_modules', '@react-native-async-storage/async-storage'),
};

module.exports = config;
