import type { IEventStorage, MGMEvent } from '@mostly-good-metrics/javascript';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';

// Try to import AsyncStorage, fall back to null if not available
let AsyncStorage: typeof import('@react-native-async-storage/async-storage').default | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  // AsyncStorage not installed - will use in-memory storage
}

/**
 * Returns the storage type being used.
 */
export function getStorageType(): 'persistent' | 'memory' {
  return AsyncStorage ? 'persistent' : 'memory';
}

/**
 * In-memory fallback storage when AsyncStorage is not available.
 */
const memoryStorage: Record<string, string> = {};

/**
 * Storage helpers that work with or without AsyncStorage.
 */
async function getItem(key: string): Promise<string | null> {
  if (AsyncStorage) {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return memoryStorage[key] ?? null;
    }
  }
  return memoryStorage[key] ?? null;
}

async function setItem(key: string, value: string): Promise<void> {
  memoryStorage[key] = value;
  if (AsyncStorage) {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Fall back to memory storage (already set above)
    }
  }
}

async function removeItem(key: string): Promise<void> {
  delete memoryStorage[key];
  if (AsyncStorage) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Already removed from memory
    }
  }
}

/**
 * Event storage for React Native.
 * Uses AsyncStorage if available, otherwise falls back to in-memory storage.
 */
export class AsyncStorageEventStorage implements IEventStorage {
  private maxEvents: number;
  private events: MGMEvent[] | null = null;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = Math.max(maxEvents, 100);
  }

  private async loadEvents(): Promise<MGMEvent[]> {
    if (this.events !== null) {
      return this.events;
    }

    try {
      const stored = await getItem(STORAGE_KEY);
      if (stored) {
        this.events = JSON.parse(stored) as MGMEvent[];
      } else {
        this.events = [];
      }
    } catch {
      this.events = [];
    }

    return this.events;
  }

  private async saveEvents(): Promise<void> {
    await setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
  }

  async store(event: MGMEvent): Promise<void> {
    const events = await this.loadEvents();
    events.push(event);

    // Trim oldest events if we exceed the limit
    if (events.length > this.maxEvents) {
      const excess = events.length - this.maxEvents;
      events.splice(0, excess);
    }

    await this.saveEvents();
  }

  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    const events = await this.loadEvents();
    return events.slice(0, limit);
  }

  async removeEvents(count: number): Promise<void> {
    const events = await this.loadEvents();
    events.splice(0, count);
    await this.saveEvents();
  }

  async eventCount(): Promise<number> {
    const events = await this.loadEvents();
    return events.length;
  }

  async clear(): Promise<void> {
    this.events = [];
    await removeItem(STORAGE_KEY);
  }
}

/**
 * Persistence helpers for user ID and app version.
 */
export const persistence = {
  async getUserId(): Promise<string | null> {
    return getItem(USER_ID_KEY);
  },

  async setUserId(userId: string | null): Promise<void> {
    if (userId) {
      await setItem(USER_ID_KEY, userId);
    } else {
      await removeItem(USER_ID_KEY);
    }
  },

  async getAppVersion(): Promise<string | null> {
    return getItem(APP_VERSION_KEY);
  },

  async setAppVersion(version: string | null): Promise<void> {
    if (version) {
      await setItem(APP_VERSION_KEY, version);
    } else {
      await removeItem(APP_VERSION_KEY);
    }
  },

  async isFirstLaunch(): Promise<boolean> {
    const hasLaunched = await getItem(FIRST_LAUNCH_KEY);
    if (!hasLaunched) {
      await setItem(FIRST_LAUNCH_KEY, 'true');
      return true;
    }
    return false;
  },
};
