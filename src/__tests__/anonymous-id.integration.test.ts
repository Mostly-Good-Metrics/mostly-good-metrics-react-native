/**
 * Integration tests for anonymous ID persistence: the REAL
 * @mostly-good-metrics/javascript client driven through the React Native
 * wrapper, over a mocked AsyncStorage backed by a Map.
 *
 * The JS SDK persists its anonymous ID via cookies/localStorage, neither of
 * which exists on React Native, so the wrapper must persist one in
 * AsyncStorage and inject it before the client's first experiments fetch.
 *
 * Covers:
 * - a $anon_* ID is generated once, persisted, and used in the very first
 *   experiments request
 * - the ID stays stable across a simulated app restart (fresh module
 *   registry + fresh global state, same AsyncStorage backing)
 * - the variants cache hits on the second anonymous launch (no refetch)
 * - restoring an identified user does not clobber the identified cache:
 *   every experiments request on the next launch runs as that user
 */

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: {
    OS: 'ios',
    Version: '17.0',
    isPad: false,
  },
}));

// Mocked AsyncStorage backed by a Map that survives simulated app restarts.
// (Variables must be `mock`-prefixed to be referenced inside the jest.mock
// factory.)
const mockBacking = {
  map: new Map<string, string>(),
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string): Promise<string | null> =>
      Promise.resolve(mockBacking.map.get(key) ?? null),
    setItem: (key: string, value: string): Promise<void> => {
      mockBacking.map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string): Promise<void> => {
      mockBacking.map.delete(key);
      return Promise.resolve();
    },
  },
}));

type WrapperSDK = typeof import('../index').default;

const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const CACHE_KEY = 'mgm_experiment_variants';
const API_KEY = 'test-api-key';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Load a fresh copy of the wrapper SDK, as if the app process just started:
 * new module registry (fresh JS SDK singleton and in-memory persistence) and
 * fresh wrapper global state. Only the mocked AsyncStorage Map survives.
 */
function launchApp(): WrapperSDK {
  delete (globalThis as Record<string, unknown>).__MGM_RN_STATE__;
  let sdk: WrapperSDK | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sdk = (require('../index') as { default: WrapperSDK }).default;
  });
  return sdk as WrapperSDK;
}

/** Tear down the current instance and boot a fresh one (simulated restart). */
function restartApp(sdk: WrapperSDK): WrapperSDK {
  sdk.destroy();
  return launchApp();
}

const mockFetch = (assignedVariants: Record<string, string>): jest.Mock => {
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ assigned_variants: assignedVariants }),
  });
  global.fetch = mock as unknown as typeof global.fetch;
  return mock;
};

const experimentsRequests = (mock: jest.Mock): string[] =>
  mock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/v1/experiments'));

describe('Anonymous ID persistence (real JS SDK through the wrapper)', () => {
  const originalFetch = global.fetch;
  let sdk: WrapperSDK;

  beforeEach(() => {
    mockBacking.map = new Map();
    sdk = launchApp();
  });

  afterEach(() => {
    sdk.destroy();
    delete (globalThis as Record<string, unknown>).__MGM_RN_STATE__;
    global.fetch = originalFetch;
  });

  it('generates a persisted $anon_* ID and sends it in the first experiments request', async () => {
    const fetchMock = mockFetch({ 'rn-exp': 'a' });

    sdk.configure(API_KEY);
    await sdk.ready();

    const storedAnonId = mockBacking.map.get(ANONYMOUS_ID_KEY) ?? '';
    expect(storedAnonId).toMatch(/^\$anon_[0-9a-z]{12}$/);

    const requests = experimentsRequests(fetchMock);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]).toContain(`user_id=${encodeURIComponent(storedAnonId)}`);
  });

  it('keeps the anonymous ID stable across a simulated app restart', async () => {
    mockFetch({ 'rn-exp': 'a' });

    sdk.configure(API_KEY);
    await sdk.ready();
    const firstLaunchAnonId = mockBacking.map.get(ANONYMOUS_ID_KEY) ?? '';
    expect(firstLaunchAnonId).toMatch(/^\$anon_[0-9a-z]{12}$/);
    await wait(10);

    sdk = restartApp(sdk);
    sdk.configure(API_KEY);
    await sdk.ready();

    expect(mockBacking.map.get(ANONYMOUS_ID_KEY)).toBe(firstLaunchAnonId);
  });

  it('hits the variants cache on the second anonymous launch without refetching', async () => {
    mockFetch({ 'checkout-flow': 'b' });

    // First launch fetches and caches the variants under the anonymous ID
    sdk.configure(API_KEY);
    await sdk.ready();
    expect(sdk.getVariant('checkout-flow')).toBe('b');
    await wait(10);

    // Second launch: the network never responds. ready() can only resolve
    // (and the variant only be served) if the fresh cache matches the
    // stable anonymous ID.
    sdk = restartApp(sdk);
    const pendingFetch = jest.fn().mockReturnValue(new Promise(() => {}));
    global.fetch = pendingFetch as unknown as typeof global.fetch;

    sdk.configure(API_KEY);
    await sdk.ready();

    expect(sdk.getVariant('checkout-flow')).toBe('b');
    expect(experimentsRequests(pendingFetch)).toHaveLength(0);
  });

  it('restores an identified user without clobbering the identified cache', async () => {
    mockFetch({ 'rn-exp': 'a' });

    // First launch: anonymous, then identified
    sdk.configure(API_KEY);
    await sdk.ready();
    sdk.identify('user-123');
    await wait(10);

    const anonId = mockBacking.map.get(ANONYMOUS_ID_KEY) ?? '';
    const cacheAfterIdentify = JSON.parse(mockBacking.map.get(CACHE_KEY) ?? '{}');
    expect(cacheAfterIdentify.userId).toBe('user-123');

    // Second launch: the stored user ID is restored before the first
    // experiments fetch, so no request ever runs as anonymous.
    sdk = restartApp(sdk);
    const secondLaunchFetch = mockFetch({ 'rn-exp': 'a' });

    sdk.configure(API_KEY);
    await sdk.ready();
    await wait(10);

    const requests = experimentsRequests(secondLaunchFetch);
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      expect(url).toContain('user_id=user-123');
      expect(url).toContain(`anonymous_id=${encodeURIComponent(anonId)}`);
    }

    // Cache is still keyed to the identified user, and the variant serves
    const cacheAfterRestart = JSON.parse(mockBacking.map.get(CACHE_KEY) ?? '{}');
    expect(cacheAfterRestart.userId).toBe('user-123');
    expect(sdk.getVariant('rn-exp')).toBe('a');
  });
});
