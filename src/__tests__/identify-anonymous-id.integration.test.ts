/**
 * Integration test for MGM-195: the $identify event must carry an
 * `$anonymous_id` property equal to the anonymous id that was stored *before*
 * identify() was called, so the backend can link anonymous -> identified
 * events.
 *
 * How this SDK satisfies the contract:
 *   The React Native wrapper WRAPS the JS core (@mostly-good-metrics/javascript).
 *   The core is what actually builds the $identify event and stamps
 *   `$anonymous_id` onto it, sourced from its *configured* anonymous id. The
 *   wrapper's only job is to feed the correct stored anonymous id into the core
 *   (via the `anonymousId` configuration override in configure()) and to
 *   forward identify() to the core without bypassing it. This test proves that
 *   wiring end to end: the id RN persists in AsyncStorage is the id the core
 *   emits on the $identify event it sends to the transport.
 *
 * DEPENDENCY NOTE:
 *   Stamping `$anonymous_id` onto the $identify event is being added inside the
 *   JS core (a separate MGM-195 change). The installed core (0.8.0) does not
 *   emit it yet, so this test drives a MOCK core that implements the agreed
 *   contract (identify -> $identify event with $anonymous_id = configured
 *   anonymous id, POSTed to the transport). Once the wrapper's
 *   @mostly-good-metrics/javascript dependency is bumped to a core release that
 *   includes the change, the real-core anonymous-id integration test
 *   (anonymous-id.integration.test.ts) can be extended to assert this against
 *   the live transport and this mock-backed test can be retired.
 */

// Make this file a module so its top-level declarations don't collide in the
// global script scope with the other integration test that reuses the same
// helper names (mockBacking, WrapperSDK, ANONYMOUS_ID_KEY, ...).
export {};

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

// Mocked AsyncStorage backed by a Map (same pattern as the real-core
// anonymous-id integration test).
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

const EVENTS_URL = 'https://api.mostlygoodmetrics.test/v1/events';

/**
 * A minimal mock of the JS core implementing the MGM-195 contract. The wrapper
 * passes the resolved (stored) anonymous id into configure() as `anonymousId`;
 * on identify() with profile data the core builds the $identify event, stamps
 * `$anonymous_id` from that configured id, and sends it to the transport.
 */
const mockCore = {
  _anonymousId: undefined as string | undefined,
  isConfigured: false,
  shared: null as { anonymousId: string | undefined } | null,

  configure(config: { apiKey: string; anonymousId?: string }) {
    mockCore._anonymousId = config.anonymousId;
    mockCore.isConfigured = true;
    mockCore.shared = { anonymousId: config.anonymousId };
  },

  identify(userId: string, profile?: { email?: string; name?: string }) {
    // Mirror the core: only emit $identify when there is profile data to send.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (profile && (profile.email || profile.name)) {
      const properties: Record<string, unknown> = {
        // The MGM-195 contract: sourced from the CONFIGURED anonymous id.
        $anonymous_id: mockCore._anonymousId,
      };
      if (profile.email) properties.email = profile.email;
      if (profile.name) properties.name = profile.name;

      const event = { name: '$identify', user_id: userId, properties };
      void (global.fetch as unknown as (...args: unknown[]) => unknown)(
        EVENTS_URL,
        { method: 'POST', body: JSON.stringify({ events: [event] }) }
      );
    }
  },

  reset() {
    mockCore.isConfigured = false;
    mockCore.shared = null;
    mockCore._anonymousId = undefined;
  },

  track: jest.fn(),
  flush: jest.fn().mockResolvedValue(undefined),
  ready: jest.fn().mockResolvedValue(undefined),
  startNewSession: jest.fn(),
  resetIdentity: jest.fn(),
  clearPendingEvents: jest.fn().mockResolvedValue(undefined),
  getPendingEventCount: jest.fn().mockResolvedValue(0),
  optOut: jest.fn(),
  optIn: jest.fn(),
  isOptedOut: jest.fn().mockReturnValue(false),
  resetAnonymousId: jest.fn().mockReturnValue(null),
  setSuperProperty: jest.fn(),
  setSuperProperties: jest.fn(),
  removeSuperProperty: jest.fn(),
  clearSuperProperties: jest.fn(),
  getSuperProperties: jest.fn().mockReturnValue({}),
  getVariant: jest.fn().mockReturnValue(null),
};

let mockAnonCounter = 0;

jest.mock('@mostly-good-metrics/javascript', () => ({
  MostlyGoodMetrics: mockCore,
  generateAnonymousId: jest.fn(
    () => `$anon_generated${(mockAnonCounter++).toString().padStart(3, '0')}`
  ),
  SystemEvents: {
    APP_INSTALLED: '$app_installed',
    APP_UPDATED: '$app_updated',
    APP_OPENED: '$app_opened',
    APP_BACKGROUNDED: '$app_backgrounded',
    IDENTIFY: '$identify',
  },
  SystemProperties: {
    DEVICE_TYPE: '$device_type',
    DEVICE_MODEL: '$device_model',
    VERSION: '$version',
    PREVIOUS_VERSION: '$previous_version',
    SDK: '$sdk',
  },
}));

type WrapperSDK = typeof import('../index').default;

const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const API_KEY = 'test-api-key';

const flushInit = () => new Promise((resolve) => setImmediate(resolve));

function launchApp(): WrapperSDK {
  delete (globalThis as Record<string, unknown>).__MGM_RN_STATE__;
  let sdk: WrapperSDK | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sdk = (require('../index') as { default: WrapperSDK }).default;
  });
  return sdk as WrapperSDK;
}

/** Extract the $identify event POSTed to the transport, if any. */
function capturedIdentifyEvent(
  fetchMock: jest.Mock
): { name: string; user_id: string; properties: Record<string, unknown> } | undefined {
  for (const call of fetchMock.mock.calls) {
    const [url, init] = call as [string, { body?: string } | undefined];
    if (String(url).includes('/v1/events') && init?.body) {
      const payload = JSON.parse(init.body) as {
        events: Array<{
          name: string;
          user_id: string;
          properties: Record<string, unknown>;
        }>;
      };
      const identify = payload.events.find((e) => e.name === '$identify');
      if (identify) return identify;
    }
  }
  return undefined;
}

describe('MGM-195: $identify carries $anonymous_id (wrapper feeds stored anon id to core)', () => {
  const originalFetch = global.fetch;
  let sdk: WrapperSDK;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockBacking.map = new Map();
    mockCore.reset();
    mockAnonCounter = 0;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    sdk = launchApp();
  });

  afterEach(() => {
    sdk.destroy();
    delete (globalThis as Record<string, unknown>).__MGM_RN_STATE__;
    global.fetch = originalFetch;
  });

  it('stamps the freshly generated + persisted anon id onto $identify', async () => {
    sdk.configure(API_KEY);
    await sdk.ready();

    // The anon id RN generated and persisted before identify() ran.
    const storedAnonId = mockBacking.map.get(ANONYMOUS_ID_KEY) ?? '';
    expect(storedAnonId).toMatch(/^\$anon_/);

    sdk.identify('user-123', { email: 'jane@example.com' });
    await flushInit();

    const identify = capturedIdentifyEvent(fetchMock);
    expect(identify).toBeDefined();
    expect(identify?.user_id).toBe('user-123');
    expect(identify?.properties.$anonymous_id).toBe(storedAnonId);
    expect(identify?.properties.email).toBe('jane@example.com');
  });

  it('uses the pre-existing stored anon id (from a prior launch), not a fresh one', async () => {
    // Simulate an anon id persisted by earlier launches.
    const preExistingAnonId = '$anon_preexisting01';
    mockBacking.map.set(ANONYMOUS_ID_KEY, preExistingAnonId);

    sdk.configure(API_KEY);
    await sdk.ready();

    sdk.identify('user-777', { name: 'Jane Doe' });
    await flushInit();

    const identify = capturedIdentifyEvent(fetchMock);
    expect(identify).toBeDefined();
    // The pre-identify stored anon id is what links anonymous -> identified.
    expect(identify?.properties.$anonymous_id).toBe(preExistingAnonId);
    // And RN must not have rotated it while identifying.
    expect(mockBacking.map.get(ANONYMOUS_ID_KEY)).toBe(preExistingAnonId);
  });

  it('feeds the same stored anon id into the core configuration override', async () => {
    const preExistingAnonId = '$anon_preexisting02';
    mockBacking.map.set(ANONYMOUS_ID_KEY, preExistingAnonId);

    sdk.configure(API_KEY);
    await sdk.ready();

    // The wrapper's contribution: the core is configured with the stored id,
    // which is exactly the id it later stamps onto $identify.
    expect(mockCore._anonymousId).toBe(preExistingAnonId);
  });
});
