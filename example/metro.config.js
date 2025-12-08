const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the RN SDK source files for development
config.watchFolders = [sdkRoot];

// Block duplicate react/react-native from SDK node_modules
config.resolver.blockList = [
  new RegExp(path.resolve(sdkRoot, 'node_modules', 'react-native') + '/.*'),
  new RegExp(path.resolve(sdkRoot, 'node_modules', 'react') + '/.*'),
];

// Redirect modules to use example's node_modules
config.resolver.extraNodeModules = {
  '@mostly-good-metrics/react-native': sdkRoot,
  '@mostly-good-metrics/javascript': path.resolve(projectRoot, 'node_modules', '@mostly-good-metrics/javascript'),
  'react': path.resolve(projectRoot, 'node_modules', 'react'),
  'react-native': path.resolve(projectRoot, 'node_modules', 'react-native'),
  '@react-native-async-storage/async-storage': path.resolve(projectRoot, 'node_modules', '@react-native-async-storage/async-storage'),
};

module.exports = config;
