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
    setSuperProperty: mockSetSuperProperty,
    setSuperProperties: mockSetSuperProperties,
    removeSuperProperty: mockRemoveSuperProperty,
    clearSuperProperties: mockClearSuperProperties,
    getSuperProperties: mockGetSuperProperties,
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

  describe('super properties', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure('test-api-key');
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

    beforeEach(() => {
      MostlyGoodMetrics.configure('test-api-key');
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
});
