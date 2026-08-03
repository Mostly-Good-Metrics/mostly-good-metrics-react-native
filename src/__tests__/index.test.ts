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
