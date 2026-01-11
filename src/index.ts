import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import {
  MostlyGoodMetrics as MGMClient,
  type MGMConfiguration,
  type EventProperties,
  type Platform as MGMPlatform,
  type UserProfile,
  SystemEvents,
  SystemProperties,
} from '@mostly-good-metrics/javascript';
import { AsyncStorageEventStorage, persistence, getStorageType } from './storage';

/** SDK version for metrics headers */
const SDK_VERSION = '0.3.5';

export type { MGMConfiguration, EventProperties, UserProfile };

export interface ReactNativeConfig extends Omit<MGMConfiguration, 'storage'> {
  /**
   * The app version string. Required for install/update tracking.
   */
  appVersion?: string;
}

// Use global to persist state across hot reloads
const g = globalThis as typeof globalThis & {
  __MGM_RN_STATE__?: {
    appStateSubscription: { remove: () => void } | null;
    isConfigured: boolean;
    currentAppState: AppStateStatus;
    debugLogging: boolean;
    lastLifecycleEvent: { name: string; time: number } | null;
  };
};

// Initialize or restore state
if (!g.__MGM_RN_STATE__) {
  g.__MGM_RN_STATE__ = {
    appStateSubscription: null,
    isConfigured: false,
    currentAppState: AppState.currentState,
    debugLogging: false,
    lastLifecycleEvent: null,
  };
}

const state = g.__MGM_RN_STATE__;

const DEDUPE_INTERVAL_MS = 1000; // Ignore duplicate events within 1 second

function log(...args: unknown[]) {
  if (state.debugLogging) {
    console.log('[MostlyGoodMetrics]', ...args);
  }
}

/**
 * Track a lifecycle event with deduplication.
 */
function trackLifecycleEvent(eventName: string, properties?: EventProperties) {
  const now = Date.now();

  // Deduplicate events that fire multiple times in quick succession
  if (state.lastLifecycleEvent &&
      state.lastLifecycleEvent.name === eventName &&
      now - state.lastLifecycleEvent.time < DEDUPE_INTERVAL_MS) {
    log(`Skipping duplicate ${eventName} (${now - state.lastLifecycleEvent.time}ms ago)`);
    return;
  }

  state.lastLifecycleEvent = { name: eventName, time: now };
  log(`Tracking lifecycle event: ${eventName}`);
  MGMClient.track(eventName, properties);
}

/**
 * Handle app state changes for lifecycle tracking.
 */
function handleAppStateChange(nextAppState: AppStateStatus) {
  if (!MGMClient.shared) return;

  log(`AppState change: ${state.currentAppState} -> ${nextAppState}`);

  // App came to foreground
  if (state.currentAppState.match(/inactive|background/) && nextAppState === 'active') {
    trackLifecycleEvent(SystemEvents.APP_OPENED);
  }

  // App went to background
  if (state.currentAppState === 'active' && nextAppState.match(/inactive|background/)) {
    trackLifecycleEvent(SystemEvents.APP_BACKGROUNDED);
    // Flush events when going to background
    MGMClient.flush().catch((e) => log('Flush error:', e));
  }

  state.currentAppState = nextAppState;
}

/**
 * Track app install or update events.
 */
async function trackInstallOrUpdate(appVersion?: string) {
  if (!appVersion) return;

  const previousVersion = await persistence.getAppVersion();
  const isFirst = await persistence.isFirstLaunch();

  if (isFirst) {
    trackLifecycleEvent(SystemEvents.APP_INSTALLED, {
      [SystemProperties.VERSION]: appVersion,
    });
    await persistence.setAppVersion(appVersion);
  } else if (previousVersion && previousVersion !== appVersion) {
    trackLifecycleEvent(SystemEvents.APP_UPDATED, {
      [SystemProperties.VERSION]: appVersion,
      [SystemProperties.PREVIOUS_VERSION]: previousVersion,
    });
    await persistence.setAppVersion(appVersion);
  } else if (!previousVersion) {
    await persistence.setAppVersion(appVersion);
  }
}

/**
 * MostlyGoodMetrics React Native SDK
 */
const MostlyGoodMetrics = {
  /**
   * Configure the SDK with an API key and optional settings.
   */
  configure(apiKey: string, config: Omit<ReactNativeConfig, 'apiKey'> = {}): void {
    // Check both our state and the underlying JS SDK
    if (state.isConfigured || MGMClient.isConfigured) {
      log('Already configured, skipping');
      return;
    }

    state.debugLogging = config.enableDebugLogging ?? false;
    log('Configuring with options:', config);

    // Create AsyncStorage-based storage
    const storage = new AsyncStorageEventStorage(config.maxStoredEvents);

    // Restore user ID from storage
    persistence.getUserId().then((userId) => {
      if (userId) {
        log('Restored user ID:', userId);
      }
    });

    // Configure the JS SDK
    // Disable its built-in lifecycle tracking since we handle it ourselves
    MGMClient.configure({
      apiKey,
      ...config,
      storage,
      platform: Platform.OS as MGMPlatform, // 'ios' or 'android'
      sdk: 'react-native',
      sdkVersion: SDK_VERSION,
      osVersion: getOSVersion(),
      trackAppLifecycleEvents: false, // We handle this with AppState
    });

    state.isConfigured = true;

    // Set up React Native lifecycle tracking
    if (config.trackAppLifecycleEvents !== false) {
      log('Setting up lifecycle tracking, currentAppState:', state.currentAppState);

      // Remove any existing listener (in case of hot reload)
      if (state.appStateSubscription) {
        state.appStateSubscription.remove();
        state.appStateSubscription = null;
      }

      // Track initial app open
      trackLifecycleEvent(SystemEvents.APP_OPENED);

      // Track install/update
      trackInstallOrUpdate(config.appVersion).catch((e) => log('Install/update tracking error:', e));

      // Subscribe to app state changes
      state.appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    }
  },

  /**
   * Track an event with optional properties.
   */
  track(name: string, properties?: EventProperties): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    // Add React Native specific properties
    const enrichedProperties: EventProperties = {
      [SystemProperties.DEVICE_TYPE]: getDeviceType(),
      $storage_type: getStorageType(),
      ...properties,
    };

    MGMClient.track(name, enrichedProperties);
  },

  /**
   * Identify a user with optional profile data.
   * Profile data (email, name) is sent to the backend via the $identify event.
   * Debouncing: only sends $identify if payload changed or >24h since last send.
   *
   * @param userId The user's unique identifier
   * @param profile Optional profile data (email, name)
   */
  identify(userId: string, profile?: UserProfile): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Identifying user:', userId, profile ? 'with profile' : '');
    MGMClient.identify(userId, profile);
    // Also persist to AsyncStorage for restoration
    persistence.setUserId(userId).catch((e) => log('Failed to persist user ID:', e));
  },

  /**
   * Clear the current user identity.
   */
  resetIdentity(): void {
    if (!state.isConfigured) return;

    log('Resetting identity');
    MGMClient.resetIdentity();
    persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
  },

  /**
   * Manually flush pending events to the server.
   */
  flush(): void {
    if (!state.isConfigured) return;

    log('Flushing events');
    MGMClient.flush().catch((e) => log('Flush error:', e));
  },

  /**
   * Start a new session with a fresh session ID.
   */
  startNewSession(): void {
    if (!state.isConfigured) return;

    log('Starting new session');
    MGMClient.startNewSession();
  },

  /**
   * Clear all pending events without sending them.
   */
  clearPendingEvents(): void {
    if (!state.isConfigured) return;

    log('Clearing pending events');
    MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e));
  },

  /**
   * Get the number of pending events.
   */
  async getPendingEventCount(): Promise<number> {
    if (!state.isConfigured) return 0;
    return MGMClient.getPendingEventCount();
  },

  /**
   * Get a deterministic variant for an experiment.
   */
  getVariant(experimentName: string): string | null {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return null;
    }
    return MGMClient.getVariant(experimentName);
  },

  // Super Properties

  /**
   * Set a single super property that will be included with every event.
   */
  setSuperProperty(key: string, value: EventProperties[string]): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super property:', key);
    MGMClient.setSuperProperty(key, value);
  },

  /**
   * Set multiple super properties at once.
   */
  setSuperProperties(properties: EventProperties): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super properties:', Object.keys(properties).join(', '));
    MGMClient.setSuperProperties(properties);
  },

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    if (!state.isConfigured) return;
    log('Removing super property:', key);
    MGMClient.removeSuperProperty(key);
  },

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    if (!state.isConfigured) return;
    log('Clearing all super properties');
    MGMClient.clearSuperProperties();
  },

  /**
   * Get all current super properties.
   */
  getSuperProperties(): EventProperties {
    if (!state.isConfigured) return {};
    return MGMClient.getSuperProperties();
  },

  /**
   * Clean up resources. Call when unmounting the app.
   */
  destroy(): void {
    if (state.appStateSubscription) {
      state.appStateSubscription.remove();
      state.appStateSubscription = null;
    }
    MGMClient.reset();
    state.isConfigured = false;
    state.lastLifecycleEvent = null;
    log('Destroyed');
  },
};

/**
 * Get device type based on platform.
 */
function getDeviceType(): string {
  if (Platform.OS === 'ios') {
    // Could use react-native-device-info for more accuracy
    return Platform.isPad ? 'tablet' : 'phone';
  }
  if (Platform.OS === 'android') {
    return 'phone'; // Could detect tablet with dimensions
  }
  return 'unknown';
}

/**
 * Get OS version based on platform.
 */
function getOSVersion(): string {
  const version = Platform.Version;
  if (Platform.OS === 'ios') {
    // iOS returns a string like "15.0"
    return String(version);
  }
  if (Platform.OS === 'android') {
    // Android returns SDK version number (e.g., 31 for Android 12)
    return String(version);
  }
  return 'unknown';
}

export default MostlyGoodMetrics;
