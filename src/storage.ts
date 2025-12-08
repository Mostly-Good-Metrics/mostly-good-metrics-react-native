import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IEventStorage, MGMEvent } from 'mostly-good-metrics';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';

/**
 * AsyncStorage-based event storage for React Native.
 * Persists events across app restarts.
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
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.events = JSON.parse(stored) as MGMEvent[];
      } else {
        this.events = [];
      }
    } catch (e) {
      console.warn('[MostlyGoodMetrics] Failed to load events from AsyncStorage', e);
      this.events = [];
    }

    return this.events;
  }

  private async saveEvents(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
    } catch (e) {
      console.error('[MostlyGoodMetrics] Failed to save events to AsyncStorage', e);
    }
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
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[MostlyGoodMetrics] Failed to clear events from AsyncStorage', e);
    }
  }
}

/**
 * Persistence helpers for user ID and app version.
 */
export const persistence = {
  async getUserId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(USER_ID_KEY);
    } catch {
      return null;
    }
  },

  async setUserId(userId: string | null): Promise<void> {
    try {
      if (userId) {
        await AsyncStorage.setItem(USER_ID_KEY, userId);
      } else {
        await AsyncStorage.removeItem(USER_ID_KEY);
      }
    } catch (e) {
      console.warn('[MostlyGoodMetrics] Failed to persist user ID', e);
    }
  },

  async getAppVersion(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(APP_VERSION_KEY);
    } catch {
      return null;
    }
  },

  async setAppVersion(version: string | null): Promise<void> {
    try {
      if (version) {
        await AsyncStorage.setItem(APP_VERSION_KEY, version);
      } else {
        await AsyncStorage.removeItem(APP_VERSION_KEY);
      }
    } catch (e) {
      console.warn('[MostlyGoodMetrics] Failed to persist app version', e);
    }
  },

  async isFirstLaunch(): Promise<boolean> {
    try {
      const hasLaunched = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
      if (!hasLaunched) {
        await AsyncStorage.setItem(FIRST_LAUNCH_KEY, 'true');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
};
