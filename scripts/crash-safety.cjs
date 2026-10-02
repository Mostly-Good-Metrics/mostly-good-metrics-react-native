/* Built-package regression: real JS core, fake native plugins, no network. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const turn = () => new Promise((resolve) => setImmediate(resolve));

async function exercise(flavor, scenario) {
  const backing = new Map([['mostlygoodmetrics_events', '{}']]);
  let finishRead;
  let finishListener;
  let removals = 0;
  let firstRead = true;
  const read = (key) => {
    if (scenario === 'cancel' && firstRead) {
      firstRead = false;
      return new Promise((resolve) => { finishRead = resolve; });
    }
    return Promise.resolve(backing.get(key) ?? null);
  };
  const remove = () => {
    removals++;
    if (flavor === 'capacitor') return Promise.reject(new Error('synthetic native cleanup failure'));
    throw new Error('synthetic native cleanup failure');
  };
  const plugins = {
    'react-native': {
      AppState: { currentState: 'active', addEventListener: () => ({ remove }) },
      Platform: { OS: 'ios', Version: '27.0', isPad: false },
    },
    '@react-native-async-storage/async-storage': { default: {
      getItem: read,
      setItem: async (key, value) => { backing.set(key, value); },
      removeItem: async (key) => { backing.delete(key); },
    } },
    '@capacitor/core': { Capacitor: { getPlatform: () => 'ios' } },
    '@capacitor/app': { App: { addListener: () => scenario === 'late-listener'
      ? new Promise((resolve) => { finishListener = resolve; })
      : Promise.resolve({ remove }) } },
    '@capacitor/device': { Device: { getInfo: async () => ({ model: 'test', osVersion: '27.0' }) } },
    '@capacitor/preferences': { Preferences: {
      get: async ({ key }) => ({ value: await read(key) }),
      set: async ({ key, value }) => { backing.set(key, value); },
      remove: async ({ key }) => { backing.delete(key); },
    } },
  };
  const originalLoad = Module._load;
  Module._load = function(request, ...args) {
    return Object.hasOwn(plugins, request) ? plugins[request] : originalLoad.call(this, request, ...args);
  };
  global.fetch = () => { throw new Error('network must not be used'); };
  const sdkPath = flavor === 'rn' ? '../lib/commonjs/index.js' : '../dist/cjs/src/index.js';
  const sdk = require(path.resolve(__dirname, sdkPath)).default;
  const core = require('@mostly-good-metrics/javascript').MostlyGoodMetrics;
  try {
    sdk.configure('mgm_test_offline', { experimentMode: 'local', localExperiments: [] });
    if (scenario === 'cancel') {
      sdk.destroy();
      finishRead(null);
      await turn();
      assert.equal(core.isConfigured, false, 'destroyed initialization recreated the client');
    } else if (scenario === 'late-listener') {
      await sdk.ready();
      await turn();
      sdk.destroy();
      finishListener({ remove });
      await turn();
      assert.equal(removals, 1, 'late native listener was retained');
    } else {
      await sdk.ready();
      await turn();
      sdk.track('corruption_recovery');
      await turn();
      assert.ok(await sdk.getPendingEventCount() > 0, 'damaged queue prevented tracking');
      sdk.destroy();
      await turn();
      assert.equal(removals, 1, 'native listener was not disposed');
    }
  } finally {
    sdk.destroy();
    Module._load = originalLoad;
  }
  await turn();
}

if (process.argv[2] === '--scenario') {
  exercise(process.argv[3], process.argv[4]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const flavor = process.argv[2];
  const scenarios = flavor === 'rn' ? ['cleanup', 'cancel'] : ['cleanup', 'cancel', 'late-listener'];
  let failures = 0;
  for (const scenario of scenarios) {
    const result = spawnSync(process.execPath,
      ['--unhandled-rejections=strict', __filename, '--scenario', flavor, scenario],
      { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || result.error) {
      failures++;
      console.error(`FAIL ${scenario}: ${result.error || result.stderr || result.stdout}`);
    } else console.log(`PASS ${scenario}`);
  }
  process.exitCode = failures ? 1 : 0;
}
