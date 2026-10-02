// Mock react-native before importing
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

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock the JS SDK to capture configuration
const mockConfigure = jest.fn();
const mockTrack = jest.fn();
const mockSetSuperProperty = jest.fn();
const mockSetSuperProperties = jest.fn();
const mockRemoveSuperProperty = jest.fn();
const mockClearSuperProperties = jest.fn();
const mockGetSuperProperties = jest.fn().mockReturnValue({});
const mockGetVariant = jest.fn().mockReturnValue(null);
const mockReady = jest.fn().mockResolvedValue(undefined);
const mockIsConfigured = false;
const mockGenerateAnonymousId = jest.fn(() => '$anon_mockmockmock');
const mockCoreOptOut = jest.fn();
const mockCoreOptIn = jest.fn();
const mockCoreIsOptedOut = jest.fn().mockReturnValue(false);
const mockCoreResetAnonymousId = jest.fn().mockReturnValue('$anon_rotated1234');

jest.mock('@mostly-good-metrics/javascript', () => ({
  MostlyGoodMetrics: {
    configure: mockConfigure,
    track: mockTrack,
    isConfigured: mockIsConfigured,
    shared: null,
    flush: jest.fn().mockResolvedValue(undefined),
    identify: jest.fn(),
    resetIdentity: jest.fn(),
    startNewSession: jest.fn(),
    clearPendingEvents: jest.fn().mockResolvedValue(undefined),
    getPendingEventCount: jest.fn().mockResolvedValue(0),
    reset: jest.fn(),
    optOut: mockCoreOptOut,
    optIn: mockCoreOptIn,
    isOptedOut: mockCoreIsOptedOut,
    resetAnonymousId: mockCoreResetAnonymousId,
    setSuperProperty: mockSetSuperProperty,
    setSuperProperties: mockSetSuperProperties,
    removeSuperProperty: mockRemoveSuperProperty,
    clearSuperProperties: mockClearSuperProperties,
    getSuperProperties: mockGetSuperProperties,
    getVariant: mockGetVariant,
    ready: mockReady,
  },
  generateAnonymousId: mockGenerateAnonymousId,
  SystemEvents: {
    APP_INSTALLED: '$app_installed',
    APP_UPDATED: '$app_updated',
    APP_OPENED: '$app_opened',
    APP_BACKGROUNDED: '$app_backgrounded',
  },
  SystemProperties: {
    DEVICE_TYPE: '$device_type',
    DEVICE_MODEL: '$device_model',
    VERSION: '$version',
    PREVIOUS_VERSION: '$previous_version',
    SDK: '$sdk',
  },
}));

// Import after mocks are set up
import MostlyGoodMetrics from '../index';
import { MostlyGoodMetrics as CoreClient } from '@mostly-good-metrics/javascript';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';

// configure() resolves the persisted anonymous ID and stored user ID from
// AsyncStorage before constructing the JS client, so tests must let those
// microtasks settle before asserting on the JS client mocks.
const flushInit = () => new Promise((resolve) => setImmediate(resolve));

const mockAsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;

describe('MostlyGoodMetrics React Native SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    // Reset the SDK state
    MostlyGoodMetrics.destroy();
  });


  describe('configuration cancellation', () => {
    it('does not construct the core after destroy while storage is still loading', async () => {
      let finish!: (value: string | null) => void;
      ((AsyncStorage as unknown as { default: typeof AsyncStorage }).default.getItem as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      MostlyGoodMetrics.configure('cancelled-key');
      MostlyGoodMetrics.destroy();
      finish(null);
      await flushInit();
      expect(mockConfigure).not.toHaveBeenCalled();
      expect(mockTrack).not.toHaveBeenCalled();
    });

    it('keeps a new configuration when an older destroyed initialization completes', async () => {
      let finish!: (value: string | null) => void;
      ((AsyncStorage as unknown as { default: typeof AsyncStorage }).default.getItem as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      MostlyGoodMetrics.configure('old-key');
      MostlyGoodMetrics.destroy();
      MostlyGoodMetrics.configure('new-key', { trackAppLifecycleEvents: false });
      await flushInit();
      finish(null);
      await flushInit();
      expect(mockConfigure).toHaveBeenCalledTimes(1);
      expect(mockConfigure.mock.calls[0][0].apiKey).toBe('new-key');
    });
  });



  describe('native lifecycle state refresh', () => {
    it('refreshes stale cached background state before subscribing to an active host', async () => {
      const state = (globalThis as unknown as { __MGM_RN_STATE__: { currentAppState: string | null } }).__MGM_RN_STATE__;
      state.currentAppState = 'background';
      MostlyGoodMetrics.configure('test-key');
      await flushInit();
      expect(state.currentAppState).toBe('active');
      const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1];
      (CoreClient as unknown as { shared: unknown }).shared = {};
      try {
        mockTrack.mockClear();
        callback('background');
        expect(mockTrack).toHaveBeenCalledWith('$app_backgrounded', undefined);
        const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
        try {
          callback('active');
          expect(mockTrack).toHaveBeenCalledWith('$app_opened', undefined);
        } finally { later.mockRestore(); }
      } finally { (CoreClient as unknown as { shared: unknown }).shared = null; }
    });

    it.each([null, 'throw'])('supports an unavailable native app state: %p', async (nativeState) => {
      const descriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
      Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => {
        if (nativeState === 'throw') throw new Error('native state bridge unavailable');
        return nativeState;
      } });
      try {
        const state = (globalThis as unknown as { __MGM_RN_STATE__: { currentAppState: string | null } }).__MGM_RN_STATE__;
        state.currentAppState = 'background';
        expect(() => MostlyGoodMetrics.configure('test-key')).not.toThrow();
        await flushInit();
        expect(state.currentAppState).toBeNull();
        const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1];
        (CoreClient as unknown as { shared: unknown }).shared = {};
        mockTrack.mockClear();
        expect(() => callback('active')).not.toThrow();
        expect(mockTrack).not.toHaveBeenCalled();
        callback('background');
        expect(mockTrack).toHaveBeenCalledWith('$app_backgrounded', undefined);
      } finally {
        (CoreClient as unknown as { shared: unknown }).shared = null;
        Object.defineProperty(AppState, 'currentState', descriptor);
      }
    });


    it('does not subscribe if the native state getter destroys the configuration', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
      Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => {
        MostlyGoodMetrics.destroy();
        return 'active';
      } });
      try {
        MostlyGoodMetrics.configure('test-key');
        await flushInit();
        expect(AppState.addEventListener).not.toHaveBeenCalled();
      } finally { Object.defineProperty(AppState, 'currentState', descriptor); }
    });

    it('keeps explicit tracking available after native listener registration throws', async () => {
      (AppState.addEventListener as jest.Mock).mockImplementationOnce(() => { throw new Error('listener bridge unavailable'); });
      MostlyGoodMetrics.configure('test-key');
      await flushInit();
      MostlyGoodMetrics.track('manual_after_listener_failure');
      expect(mockTrack).toHaveBeenCalledWith('manual_after_listener_failure', expect.any(Object));
    });

    it('removes a synchronously returned listener if registration destroys the configuration', async () => {
      const remove = jest.fn();
      (AppState.addEventListener as jest.Mock).mockImplementationOnce(() => {
        MostlyGoodMetrics.destroy();
        return { remove };
      });
      MostlyGoodMetrics.configure('test-key');
      await flushInit();
      expect(remove).toHaveBeenCalledTimes(1);
      const state = (globalThis as unknown as { __MGM_RN_STATE__: { appStateSubscription: unknown } }).__MGM_RN_STATE__;
      expect(state.appStateSubscription).toBeNull();
    });
  });

  describe('failure containment', () => {
    it('handles a null initial native app state', async () => {
      MostlyGoodMetrics.configure('test-key');
      await flushInit();
      const nativeState = (globalThis as unknown as { __MGM_RN_STATE__: { currentAppState: string | null } }).__MGM_RN_STATE__;
      nativeState.currentAppState = null;
      const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1];
      (CoreClient as unknown as { shared: unknown }).shared = {};
      try {
        expect(() => callback('active')).not.toThrow();
      } finally {
        (CoreClient as unknown as { shared: unknown }).shared = null;
      }
    });

    it('settles a synchronously throwing core flush', async () => {
      MostlyGoodMetrics.configure('test-key', { trackAppLifecycleEvents: false });
      await flushInit();
      (CoreClient.flush as jest.Mock).mockImplementationOnce(() => { throw new Error('offline'); });
      await expect(MostlyGoodMetrics.flush()).resolves.toBeUndefined();
    });

    it('omits throwing property getters while retaining readable event fields', async () => {
      MostlyGoodMetrics.configure('test-key', { trackAppLifecycleEvents: false });
      await flushInit();
      const properties = { readable: 'retained' };
      Object.defineProperty(properties, 'broken', { enumerable: true, get: () => { throw new Error('bad getter'); } });
      expect(() => MostlyGoodMetrics.track('probe', properties)).not.toThrow();
      expect(mockTrack.mock.calls[0][1]).toMatchObject({ readable: 'retained' });
      expect(mockTrack.mock.calls[0][1]).not.toHaveProperty('broken');
    });

    it('contains unreadable property enumeration in event and super-property APIs', async () => {
      MostlyGoodMetrics.configure('test-key', { trackAppLifecycleEvents: false });
      await flushInit();
      const properties = new Proxy({}, { ownKeys: () => { throw new Error('bad proxy'); } });
      expect(() => MostlyGoodMetrics.track('probe', properties)).not.toThrow();
      expect(() => MostlyGoodMetrics.setSuperProperties(properties)).not.toThrow();
    });

    it('does not throw when the host warning logger throws', () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => { throw new Error('logger unavailable'); });
      try {
        expect(() => MostlyGoodMetrics.track('unconfigured')).not.toThrow();
      } finally {
        warning.mockRestore();
      }
    });

    it('keeps tracking when one queued core call throws', async () => {
      mockTrack.mockImplementationOnce(() => { throw new Error('bad event'); });
      MostlyGoodMetrics.configure('test-key', { trackAppLifecycleEvents: false });
      MostlyGoodMetrics.track('first');
      MostlyGoodMetrics.track('second');
      await flushInit();
      expect(mockTrack.mock.calls.map(([name]) => name)).toEqual(['first', 'second']);
      expect(() => MostlyGoodMetrics.track('third')).not.toThrow();
      expect(mockTrack).toHaveBeenCalledTimes(3);
    });

    it('settles flush errors even when the host debug logger throws', async () => {
      const debug = jest.spyOn(console, 'log').mockImplementation(() => { throw new Error('logger unavailable'); });
      try {
        expect(() => MostlyGoodMetrics.configure('test-key', { enableDebugLogging: true, trackAppLifecycleEvents: false })).not.toThrow();
        await flushInit();
        (CoreClient.flush as jest.Mock).mockRejectedValueOnce(new Error('offline'));
        await expect(MostlyGoodMetrics.flush()).resolves.toBeUndefined();
      } finally {
        debug.mockRestore();
      }
    });
  });

  it('contains native subscription removal failures', async () => {
    (AppState.addEventListener as jest.Mock).mockReturnValueOnce({ remove: () => { throw new Error('bridge unavailable'); } });
    MostlyGoodMetrics.configure('test-key');
    await flushInit();
    expect(() => MostlyGoodMetrics.destroy()).not.toThrow();
  });

  describe('configure', () => {
    it('should restore user ID from storage', async () => {
      const mockIdentify = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics.identify;
      mockAsyncStorage.getItem.mockImplementation((key: string) =>
        Promise.resolve(key === USER_ID_KEY ? 'user-123' : null)
      );

      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user-123');
    });

    it('should generate, persist and pass a stable anonymous ID when none is stored', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockGenerateAnonymousId).toHaveBeenCalledTimes(1);
      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('$anon_mockmockmock');
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(ANONYMOUS_ID_KEY, '$anon_mockmockmock');
    });

    it('should reuse the persisted anonymous ID on subsequent launches', async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) =>
        Promise.resolve(key === ANONYMOUS_ID_KEY ? '$anon_persisted12' : null)
      );

      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockGenerateAnonymousId).not.toHaveBeenCalled();
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('$anon_persisted12');
    });

    it('should honor and persist an explicit anonymousId override', async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) =>
        Promise.resolve(key === ANONYMOUS_ID_KEY ? '$anon_persisted12' : null)
      );

      MostlyGoodMetrics.configure('test-api-key', { anonymousId: 'device-abc' });

      await flushInit();

      expect(mockGenerateAnonymousId).not.toHaveBeenCalled();
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('device-abc');
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(ANONYMOUS_ID_KEY, 'device-abc');
    });

    it('should queue calls made before the JS client is constructed', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      MostlyGoodMetrics.track('early_event');

      expect(mockTrack).not.toHaveBeenCalled();

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      expect(mockTrack).toHaveBeenCalledTimes(2); // early_event + $app_opened
      expect(mockTrack.mock.calls[0][0]).toBe('early_event');
    });

    it('should pass platform as ios when Platform.OS is ios', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('ios');
    });

    it('should pass sdk as react-native', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.sdk).toBe('react-native');
    });

    it('should pass osVersion from Platform.Version', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.osVersion).toBe('17.0');
    });

    it('should wire AsyncStorage-backed experiment storage', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.experimentStorage).toBeDefined();
      expect(typeof configArg.experimentStorage.getItem).toBe('function');
      expect(typeof configArg.experimentStorage.setItem).toBe('function');
    });

    it('should disable JS SDK lifecycle tracking', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.trackAppLifecycleEvents).toBe(false);
    });

    it('should forward a dynamic context provider to the JavaScript core', async () => {
      const contextProvider = () => ({ organization_id: 'org_123' });
      MostlyGoodMetrics.configure('test-api-key', { contextProvider });

      await flushInit();

      expect(mockConfigure.mock.calls[0][0].contextProvider).toBe(contextProvider);
    });

    it('should seed an existing installation without tracking app_installed', async () => {
      MostlyGoodMetrics.configure('test-api-key', {
        appVersion: '2.0.0',
        existingInstallation: true,
      });

      await flushInit();
      await flushInit();

      expect(mockTrack.mock.calls.some(([name]) => name === '$app_installed')).toBe(false);
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'mostlygoodmetrics_app_version',
        '2.0.0'
      );
    });
  });

  describe('super properties', () => {
    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('should call setSuperProperty on the JS SDK', () => {
      MostlyGoodMetrics.setSuperProperty('plan', 'premium');

      expect(mockSetSuperProperty).toHaveBeenCalledTimes(1);
      expect(mockSetSuperProperty).toHaveBeenCalledWith('plan', 'premium');
    });

    it('should call setSuperProperties on the JS SDK', () => {
      const props = { plan: 'premium', tier: 'gold' };
      MostlyGoodMetrics.setSuperProperties(props);

      expect(mockSetSuperProperties).toHaveBeenCalledTimes(1);
      expect(mockSetSuperProperties).toHaveBeenCalledWith(props);
    });

    it('should call removeSuperProperty on the JS SDK', () => {
      MostlyGoodMetrics.removeSuperProperty('plan');

      expect(mockRemoveSuperProperty).toHaveBeenCalledTimes(1);
      expect(mockRemoveSuperProperty).toHaveBeenCalledWith('plan');
    });

    it('should call clearSuperProperties on the JS SDK', () => {
      MostlyGoodMetrics.clearSuperProperties();

      expect(mockClearSuperProperties).toHaveBeenCalledTimes(1);
    });

    it('should call getSuperProperties on the JS SDK', () => {
      mockGetSuperProperties.mockReturnValue({ plan: 'premium' });

      const result = MostlyGoodMetrics.getSuperProperties();

      expect(mockGetSuperProperties).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ plan: 'premium' });
    });

    it('should not call setSuperProperty when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      MostlyGoodMetrics.setSuperProperty('plan', 'premium');

      expect(mockSetSuperProperty).not.toHaveBeenCalled();
    });
  });

  describe('identify', () => {
    // Get reference to the mock identify function
    const mockIdentify = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics.identify;

    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('should call identify with just userId', () => {
      MostlyGoodMetrics.identify('user-123');

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user-123', undefined);
    });

    it('should call identify with email', () => {
      MostlyGoodMetrics.identify('user-123', { email: 'test@example.com' });

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user-123', { email: 'test@example.com' });
    });

    it('should call identify with name', () => {
      MostlyGoodMetrics.identify('user-123', { name: 'Test User' });

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user-123', { name: 'Test User' });
    });

    it('should call identify with both email and name', () => {
      MostlyGoodMetrics.identify('user-123', { email: 'test@example.com', name: 'Test User' });

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user-123', { email: 'test@example.com', name: 'Test User' });
    });

    it('should not call identify when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      MostlyGoodMetrics.identify('user-123', { email: 'test@example.com' });

      expect(mockIdentify).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    const mockCore = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics;

    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('resolves only after the core flush (network POST) completes', async () => {
      // Gate the core flush so we can observe that the wrapper's flush()
      // promise stays pending until the underlying POST finishes.
      let posted = false;
      let releasePost!: () => void;
      const postGate = new Promise<void>((resolve) => {
        releasePost = resolve;
      });
      mockCore.flush.mockImplementationOnce(async () => {
        await postGate;
        posted = true;
      });

      const flushPromise = MostlyGoodMetrics.flush();

      // Let flush() reach the awaited core flush; it should now be in flight
      // but not resolved, because the POST has not completed yet.
      await flushInit();
      expect(mockCore.flush).toHaveBeenCalledTimes(1);
      expect(posted).toBe(false);

      // The wrapper's flush() promise MUST stay pending while the POST gate is
      // closed. Racing it against a short timer is what actually distinguishes
      // an awaitable Promise<void> from the old fire-and-forget flush(): void:
      // that version returned `undefined`, and Promise.resolve(undefined)
      // settles immediately, so 'flush-settled' would win the race here. With
      // the awaitable flush(), the timer must win because delivery is gated.
      const TIMED_OUT = Symbol('timed-out');
      const raced = await Promise.race([
        Promise.resolve(flushPromise).then(() => 'flush-settled' as const),
        new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), 50)),
      ]);
      expect(raced).toBe(TIMED_OUT);
      expect(posted).toBe(false);

      // Complete the network POST; only now should flush() resolve.
      releasePost();
      await flushPromise;

      expect(posted).toBe(true);
      // No events remain pending once the flush has been delivered.
      mockCore.getPendingEventCount.mockResolvedValueOnce(0);
      expect(await MostlyGoodMetrics.getPendingEventCount()).toBe(0);
    });

    it('is awaitable and a no-op (never touches the core) when opted out', async () => {
      MostlyGoodMetrics.optOut();

      await expect(MostlyGoodMetrics.flush()).resolves.toBeUndefined();
      expect(mockCore.flush).not.toHaveBeenCalled();
    });

    it('resolves without touching the core when not configured', async () => {
      MostlyGoodMetrics.destroy();

      await expect(MostlyGoodMetrics.flush()).resolves.toBeUndefined();
      expect(mockCore.flush).not.toHaveBeenCalled();
    });
  });

  describe('A/B testing', () => {
    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    describe('getVariant', () => {
      it('should call getVariant on the JS SDK with a null default fallback', () => {
        mockGetVariant.mockReturnValue('variant-a');

        const result = MostlyGoodMetrics.getVariant('my-experiment');

        expect(mockGetVariant).toHaveBeenCalledTimes(1);
        expect(mockGetVariant).toHaveBeenCalledWith('my-experiment', null);
        expect(result).toBe('variant-a');
      });

      it('should pass the fallback through to the JS SDK', () => {
        mockGetVariant.mockReturnValue('control');

        const result = MostlyGoodMetrics.getVariant('my-experiment', 'control');

        expect(mockGetVariant).toHaveBeenCalledTimes(1);
        expect(mockGetVariant).toHaveBeenCalledWith('my-experiment', 'control');
        expect(result).toBe('control');
      });

      it('should return null when experiment does not exist', () => {
        mockGetVariant.mockReturnValue(null);

        const result = MostlyGoodMetrics.getVariant('nonexistent-experiment');

        expect(mockGetVariant).toHaveBeenCalledWith('nonexistent-experiment', null);
        expect(result).toBeNull();
      });

      it('should return null when SDK is not configured', () => {
        MostlyGoodMetrics.destroy();

        const result = MostlyGoodMetrics.getVariant('my-experiment');

        expect(mockGetVariant).not.toHaveBeenCalled();
        expect(result).toBeNull();
      });

      it('should return the fallback when SDK is not configured', () => {
        MostlyGoodMetrics.destroy();

        const result = MostlyGoodMetrics.getVariant('my-experiment', 'control');

        expect(mockGetVariant).not.toHaveBeenCalled();
        expect(result).toBe('control');
      });
    });

    describe('ready', () => {
      it('should call ready on the JS SDK', async () => {
        mockReady.mockResolvedValue(undefined);

        await MostlyGoodMetrics.ready();

        expect(mockReady).toHaveBeenCalledTimes(1);
      });

      it('should default to a 5000ms timeout when called with no argument', async () => {
        mockReady.mockResolvedValue(undefined);

        await MostlyGoodMetrics.ready();

        expect(mockReady).toHaveBeenCalledWith(5000);
      });

      it('should forward an explicit timeout to the JS SDK', async () => {
        mockReady.mockResolvedValue(undefined);

        await MostlyGoodMetrics.ready(1234);

        expect(mockReady).toHaveBeenCalledWith(1234);
      });

      it('should resolve when SDK is ready', async () => {
        mockReady.mockResolvedValue(undefined);

        await expect(MostlyGoodMetrics.ready()).resolves.toBeUndefined();
      });

      it('should not call ready when SDK is not configured', async () => {
        MostlyGoodMetrics.destroy();

        await MostlyGoodMetrics.ready();

        expect(mockReady).not.toHaveBeenCalled();
      });
    });
  });

  describe('privacy controls', () => {
    const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';
    const mockCore = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics;

    afterEach(() => {
      mockCore.shared = null;
    });

    describe('optOut / optIn', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushInit();
        jest.clearAllMocks();
      });

      it('should not be opted out by default', () => {
        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
      });

      it('should persist the opt-out and forward it to the JS SDK', async () => {
        MostlyGoodMetrics.optOut();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        await flushInit();
        expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(OPT_OUT_KEY, 'true');
        expect(mockCoreOptOut).toHaveBeenCalledTimes(1);
      });

      it('should stop track/identify/flush after optOut', () => {
        MostlyGoodMetrics.optOut();

        MostlyGoodMetrics.track('ignored_event');
        MostlyGoodMetrics.identify('user-123');
        MostlyGoodMetrics.flush();

        expect(mockTrack).not.toHaveBeenCalled();
        expect(mockCore.identify).not.toHaveBeenCalled();
        expect(mockCore.flush).not.toHaveBeenCalled();
      });

      it('should resume tracking after optIn', async () => {
        MostlyGoodMetrics.optOut();
        MostlyGoodMetrics.optIn();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
        await flushInit();
        expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(OPT_OUT_KEY, 'false');
        expect(mockCoreOptIn).toHaveBeenCalledTimes(1);

        MostlyGoodMetrics.track('tracked_event');
        expect(mockTrack).toHaveBeenCalledTimes(1);
        expect(mockTrack.mock.calls[0][0]).toBe('tracked_event');
      });

      it('should return false from isOptedOut when SDK is not configured', () => {
        MostlyGoodMetrics.destroy();
        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
      });
    });

    describe('opt-out persistence across launches', () => {
      it('should restore a persisted opt-out on configure', async () => {
        mockAsyncStorage.getItem.mockImplementation((key: string) =>
          Promise.resolve(key === OPT_OUT_KEY ? 'true' : null)
        );

        MostlyGoodMetrics.configure('test-api-key');
        await flushInit();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        // JS client is constructed already opted out
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(true);
        // Lifecycle $app_opened is suppressed too
        expect(mockTrack).not.toHaveBeenCalled();
      });

      it('should start opted out with optedOutByDefault', async () => {
        MostlyGoodMetrics.configure('test-api-key', { optedOutByDefault: true });
        await flushInit();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(true);
        expect(mockTrack).not.toHaveBeenCalled();
      });

      it('should let a persisted opt-in override optedOutByDefault', async () => {
        mockAsyncStorage.getItem.mockImplementation((key: string) =>
          Promise.resolve(key === OPT_OUT_KEY ? 'false' : null)
        );

        MostlyGoodMetrics.configure('test-api-key', { optedOutByDefault: true });
        await flushInit();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(false);
      });
    });

    describe('resetAnonymousId', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushInit();
        jest.clearAllMocks();
      });

      it('should rotate the anonymous ID and persist it to AsyncStorage', async () => {
        const newId = await MostlyGoodMetrics.resetAnonymousId();

        expect(mockCoreResetAnonymousId).toHaveBeenCalledTimes(1);
        expect(newId).toBe('$anon_rotated1234');
        expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(ANONYMOUS_ID_KEY, '$anon_rotated1234');
      });

      it('should clear sticky local experiment assignments on rotation', async () => {
        await MostlyGoodMetrics.resetAnonymousId();

        expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
          'mgm_local_experiment_assignments'
        );
      });

      it('should resolve null when SDK is not configured', async () => {
        MostlyGoodMetrics.destroy();

        const newId = await MostlyGoodMetrics.resetAnonymousId();

        expect(newId).toBeNull();
        expect(mockCoreResetAnonymousId).not.toHaveBeenCalled();
      });
    });

    describe('resetIdentity', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushInit();
        jest.clearAllMocks();
      });

      it('should not touch the anonymous ID on a plain resetIdentity', () => {
        MostlyGoodMetrics.resetIdentity();

        expect(mockCore.resetIdentity).toHaveBeenCalledWith(undefined);
        expect(mockAsyncStorage.setItem).not.toHaveBeenCalledWith(
          ANONYMOUS_ID_KEY,
          expect.anything()
        );
      });

      it('should pass forget-me options through and persist the rotated anonymous ID', async () => {
        mockCore.shared = { anonymousId: '$anon_fresh5678' };

        MostlyGoodMetrics.resetIdentity({ clearAnonymousId: true });

        expect(mockCore.resetIdentity).toHaveBeenCalledWith({ clearAnonymousId: true });
        await flushInit();
        expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(ANONYMOUS_ID_KEY, '$anon_fresh5678');
        expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(USER_ID_KEY);
      });

      it('should clear sticky local experiment assignments on forget-me', async () => {
        MostlyGoodMetrics.resetIdentity({ clearAnonymousId: true });
        await flushInit();

        expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
          'mgm_local_experiment_assignments'
        );
      });

      it('should keep sticky local experiment assignments on a plain resetIdentity', async () => {
        MostlyGoodMetrics.resetIdentity();
        await flushInit();

        expect(mockAsyncStorage.removeItem).not.toHaveBeenCalledWith(
          'mgm_local_experiment_assignments'
        );
      });
    });

    describe('collectDeviceProperties', () => {
      it('should include $device_type by default', async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushInit();
        jest.clearAllMocks();

        MostlyGoodMetrics.track('with_device');

        const props = mockTrack.mock.calls[0][1];
        expect(props.$device_type).toBeDefined();
      });

      it('should omit $device_type and pass the flag to the JS SDK when disabled', async () => {
        MostlyGoodMetrics.configure('test-api-key', { collectDeviceProperties: false });
        await flushInit();

        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.collectDeviceProperties).toBe(false);

        jest.clearAllMocks();
        MostlyGoodMetrics.track('without_device');

        const props = mockTrack.mock.calls[0][1];
        expect(props.$device_type).toBeUndefined();
        expect(props.$storage_type).toBeDefined();
      });
    });
  });

  describe('local experiment enrollment', () => {
    it('should pass experimentMode and localExperiments through to the JS SDK', async () => {
      const localExperiments = [
        {
          id: '7b1e8a90-4c2d-4f6a-9e3b-2a1d5c8f0e71',
          name: 'button-color',
          variants: ['control', 'treatment'],
        },
      ];

      MostlyGoodMetrics.configure('test-api-key', {
        experimentMode: 'local',
        localExperiments,
      });

      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.experimentMode).toBe('local');
      expect(configArg.localExperiments).toEqual(localExperiments);
    });

    it('should not set an experiment mode by default (JS SDK defaults to server)', async () => {
      MostlyGoodMetrics.configure('test-api-key');

      await flushInit();

      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.experimentMode).toBeUndefined();
    });

    it('should keep the AsyncStorage experiment storage wired for sticky local assignments', async () => {
      MostlyGoodMetrics.configure('test-api-key', { experimentMode: 'local' });

      await flushInit();

      const configArg = mockConfigure.mock.calls[0][0];
      // Local mode persists sticky assignments and cached configs through
      // this adapter, so they survive app restarts
      expect(configArg.experimentStorage).toBeDefined();
      expect(typeof configArg.experimentStorage.getItem).toBe('function');
      expect(typeof configArg.experimentStorage.setItem).toBe('function');
    });
  });
});
