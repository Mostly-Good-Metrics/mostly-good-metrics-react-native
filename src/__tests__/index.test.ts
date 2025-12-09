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
const mockIsConfigured = false;

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
  },
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

describe('MostlyGoodMetrics React Native SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the SDK state
    MostlyGoodMetrics.destroy();
  });

  describe('configure', () => {
    it('should pass platform as ios when Platform.OS is ios', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('ios');
    });

    it('should pass sdk as react-native', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.sdk).toBe('react-native');
    });

    it('should pass osVersion from Platform.Version', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.osVersion).toBe('17.0');
    });

    it('should disable JS SDK lifecycle tracking', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.trackAppLifecycleEvents).toBe(false);
    });
  });
});
