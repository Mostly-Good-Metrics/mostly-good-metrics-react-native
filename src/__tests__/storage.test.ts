// Mock AsyncStorage before importing storage module
const mockAsyncStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: mockAsyncStorage,
}));

import { AsyncStorageEventStorage, persistence, getStorageType } from '../storage';

describe('getStorageType', () => {
  it('returns persistent when AsyncStorage is available', () => {
    expect(getStorageType()).toBe('persistent');
  });
});

describe('AsyncStorageEventStorage', () => {
  let storage: AsyncStorageEventStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
    storage = new AsyncStorageEventStorage();
  });

  describe('store', () => {
    it('stores an event', async () => {
      const event = {
        name: 'test_event',
        timestamp: '2024-01-01T00:00:00Z',
        platform: 'react-native' as const,
        environment: 'test',
      };

      await storage.store(event);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'mostlygoodmetrics_events',
        JSON.stringify([event])
      );
    });

    it('respects maxEvents limit', async () => {
      // Note: minimum maxEvents is 100, so we test with 100
      const smallStorage = new AsyncStorageEventStorage(100);

      // Simulate 100 existing events
      const existingEvents = Array.from({ length: 100 }, (_, i) => ({
        name: `event${i}`,
        timestamp: '2024-01-01T00:00:00Z',
        platform: 'react-native',
        environment: 'test',
      }));
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(existingEvents));

      const newEvent = {
        name: 'event_new',
        timestamp: '2024-01-01T00:00:02Z',
        platform: 'react-native' as const,
        environment: 'test',
      };

      await smallStorage.store(newEvent);

      // Should have trimmed oldest event
      const savedData = JSON.parse(mockAsyncStorage.setItem.mock.calls[0][1]);
      expect(savedData).toHaveLength(100);
      expect(savedData[0].name).toBe('event1'); // event0 was trimmed
      expect(savedData[99].name).toBe('event_new');
    });
  });

  describe('fetchEvents', () => {
    it('returns events up to limit', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'react-native', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'react-native', environment: 'test' },
        { name: 'event3', timestamp: '2024-01-01T00:00:02Z', platform: 'react-native', environment: 'test' },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(events));

      const result = await storage.fetchEvents(2);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('event1');
      expect(result[1]!.name).toBe('event2');
    });

    it('returns empty array when no events', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const result = await storage.fetchEvents(10);

      expect(result).toEqual([]);
    });
  });

  describe('removeEvents', () => {
    it('removes events from the beginning', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'react-native', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'react-native', environment: 'test' },
        { name: 'event3', timestamp: '2024-01-01T00:00:02Z', platform: 'react-native', environment: 'test' },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(events));

      await storage.removeEvents(2);

      const savedData = JSON.parse(mockAsyncStorage.setItem.mock.calls[0][1]);
      expect(savedData).toHaveLength(1);
      expect(savedData[0].name).toBe('event3');
    });
  });

  describe('eventCount', () => {
    it('returns count of stored events', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'react-native', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'react-native', environment: 'test' },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(events));

      const count = await storage.eventCount();

      expect(count).toBe(2);
    });
  });

  describe('clear', () => {
    it('clears all events', async () => {
      await storage.clear();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('mostlygoodmetrics_events');
    });
  });
});

describe('persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  describe('getUserId', () => {
    it('returns stored user ID', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('user-123');

      const userId = await persistence.getUserId();

      expect(userId).toBe('user-123');
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('mostlygoodmetrics_user_id');
    });

    it('returns null when no user ID stored', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const userId = await persistence.getUserId();

      expect(userId).toBeNull();
    });
  });

  describe('setUserId', () => {
    it('stores user ID', async () => {
      await persistence.setUserId('user-456');

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('mostlygoodmetrics_user_id', 'user-456');
    });

    it('removes user ID when null', async () => {
      await persistence.setUserId(null);

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('mostlygoodmetrics_user_id');
    });
  });

  describe('getAppVersion', () => {
    it('returns stored app version', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('1.0.0');

      const version = await persistence.getAppVersion();

      expect(version).toBe('1.0.0');
    });
  });

  describe('setAppVersion', () => {
    it('stores app version', async () => {
      await persistence.setAppVersion('2.0.0');

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('mostlygoodmetrics_app_version', '2.0.0');
    });
  });

  describe('isFirstLaunch', () => {
    it('returns true on first launch and sets flag', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const isFirst = await persistence.isFirstLaunch();

      expect(isFirst).toBe(true);
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('mostlygoodmetrics_installed', 'true');
    });

    it('returns false on subsequent launches', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('true');

      const isFirst = await persistence.isFirstLaunch();

      expect(isFirst).toBe(false);
    });
  });
});
