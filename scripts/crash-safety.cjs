/* Built-package regression: real JS core, fake native plugins, no network. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const turn = () => new Promise((resolve) => setImmediate(resolve));

async function exercise(flavor, scenario) {
  const backing = new Map([['mostlygoodmetrics_events', '{}']]);
  if (scenario === 'identity') backing.set('mostlygoodmetrics_user_id', 'native-restored-user');
  let gateReads = false;
  const abandonedReads = [];
  const originalTimeout = global.setTimeout;
  if (scenario === 'stalled-read' || scenario === 'retention') global.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 5000 ? (scenario === 'stalled-read' ? 500 : 40) : delay, ...args);
  const watchdog = originalTimeout(() => { throw new Error('built consumer did not complete'); }, 10000);
  let finishRead;
  let finishListener;
  let removals = 0;
  let firstRead = true;
  const read = (key) => {
    if (scenario === 'retention' && key === 'mostlygoodmetrics_events') return new Promise(() => {});
    if (scenario === 'stalled-read' && key === 'mostlygoodmetrics_opt_out') return new Promise(() => {});
    if (gateReads && key === 'mostlygoodmetrics_anonymous_id') return new Promise((resolve, reject) => { abandonedReads.push({ resolve, reject }); });
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
    const options = { experimentMode: 'local', localExperiments: [] };
    if (scenario === 'stress') {
      gateReads = true;
      for (let i = 0; i < 60; i++) {
        sdk.configure(`abandoned_${i}`, options);
        sdk.track('abandoned');
        sdk.destroy();
      }
      gateReads = false;
    }
    sdk.configure('mgm_test_offline', { ...options, ...(scenario === 'stress' ? { anonymousId: 'current-anon' } : {}) });
    if (scenario === 'retention') {
      for (let i = 0; i < 12000; i++) sdk.track('startup_payload', { payload: Array.from({ length: 10 }, () => 'x'.repeat(1000)) });
      const state = globalThis[flavor === 'rn' ? '__MGM_RN_STATE__' : '__MGM_CAPACITOR_STATE__'];
      assert.ok(state.pendingClientBytes <= 1024 * 1024);
      await sdk.ready();
      for (let i = 0; i < 12000; i++) sdk.track('stalled_store', { payload: Array.from({ length: 10 }, () => 'x'.repeat(1000)) });
      await new Promise((resolve) => originalTimeout(resolve, 80));
      assert.ok(await sdk.getPendingEventCount() < 100, 'adapter queue was not byte bounded');
      sdk.destroy();
    } else if (scenario === 'stalled-read') {
      for (let i = 0; i < 25000; i++) sdk.track('startup_burst');
      await sdk.ready(10);
      assert.equal(core.isConfigured, false, 'ready deadline waited for the native stall');
      const state = globalThis[flavor === 'rn' ? '__MGM_RN_STATE__' : '__MGM_CAPACITOR_STATE__'];
      assert.ok(state.pendingClientCalls.length <= 10000, 'startup queue exceeded bound');
      await sdk.ready(1000);
      assert.equal(sdk.isOptedOut(), true, 'unknown stored consent did not fail closed');
      sdk.destroy();
    } else if (scenario === 'stress') {
      await sdk.ready();
      for (let i = abandonedReads.length - 1; i >= 0; i--) {
        if (i % 3 === 0) abandonedReads[i].reject(new Error('abandoned read failed'));
        else abandonedReads[i].resolve(null);
      }
      // Capacitor converts raw storage read results to { value } itself.
      await turn();
      assert.equal(core.shared.anonymousId, 'current-anon');
      assert.equal(backing.get('mostlygoodmetrics_anonymous_id'), 'current-anon');
      sdk.destroy();
    } else if (scenario === 'identity') {
      await sdk.ready();
      assert.equal(core.shared.userId, 'native-restored-user', 'cold native identity was not applied');
      sdk.destroy();
    } else if (scenario === 'cancel') {
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
    global.setTimeout = originalTimeout;
    clearTimeout(watchdog);
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
  const scenarios = flavor === 'rn' ? ['cleanup', 'cancel', 'identity', 'stress', 'stalled-read', 'retention'] : ['cleanup', 'cancel', 'late-listener', 'identity', 'stress', 'stalled-read', 'retention'];
  let failures = 0;
  for (const scenario of scenarios) {
    const result = spawnSync(process.execPath,
      ['--unhandled-rejections=strict', '--max-old-space-size=64', __filename, '--scenario', flavor, scenario],
      { encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0 || result.error) {
      failures++;
      console.error(`FAIL ${scenario}: ${result.error || result.stderr || result.stdout}`);
    } else console.log(`PASS ${scenario}`);
  }
  process.exitCode = failures ? 1 : 0;
}
