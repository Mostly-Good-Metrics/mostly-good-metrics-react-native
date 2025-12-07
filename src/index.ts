import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'react-native-mostly-good-metrics' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const MostlyGoodMetricsModule = NativeModules.MostlyGoodMetricsModule
  ? NativeModules.MostlyGoodMetricsModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export interface MostlyGoodMetricsConfig {
  /**
   * The base URL for the API endpoint.
   * @default "https://mostlygoodmetrics.com"
   */
  baseURL?: string;

  /**
   * The environment name (e.g., "production", "staging", "development").
   * @default "production"
   */
  environment?: string;

  /**
   * Optional bundle ID override.
   */
  bundleId?: string;

  /**
   * Maximum number of events to batch before sending.
   * @default 100
   * @max 1000
   */
  maxBatchSize?: number;

  /**
   * Interval in seconds between automatic flush attempts.
   * @default 30
   */
  flushInterval?: number;

  /**
   * Maximum number of events to store locally before dropping oldest.
   * @default 10000
   */
  maxStoredEvents?: number;

  /**
   * Whether to enable debug logging.
   * @default false
   */
  enableDebugLogging?: boolean;

  /**
   * Whether to automatically track app lifecycle events.
   * Tracks: app_installed, app_updated, app_opened, app_backgrounded
   * @default true
   */
  trackAppLifecycleEvents?: boolean;
}

export type EventProperties = Record<string, unknown>;

/**
 * MostlyGoodMetrics React Native SDK
 *
 * @example
 * ```typescript
 * import MostlyGoodMetrics from 'react-native-mostly-good-metrics';
 *
 * // Initialize
 * MostlyGoodMetrics.configure('your-api-key');
 *
 * // Track events
 * MostlyGoodMetrics.track('button_clicked', { button_name: 'submit' });
 *
 * // Identify users
 * MostlyGoodMetrics.identify('user-123');
 * ```
 */
const MostlyGoodMetrics = {
  /**
   * Configure the SDK with an API key and optional settings.
   *
   * @param apiKey - Your MostlyGoodMetrics API key
   * @param config - Optional configuration settings
   */
  configure(apiKey: string, config: MostlyGoodMetricsConfig = {}): void {
    MostlyGoodMetricsModule.configure(apiKey, config);
  },

  /**
   * Track an event with optional properties.
   *
   * @param name - Event name (alphanumeric + underscore, must start with letter)
   * @param properties - Optional custom properties for the event
   */
  track(name: string, properties?: EventProperties): void {
    MostlyGoodMetricsModule.track(name, properties ?? null);
  },

  /**
   * Identify a user for all subsequent events.
   *
   * @param userId - Unique identifier for the user
   */
  identify(userId: string): void {
    MostlyGoodMetricsModule.identify(userId);
  },

  /**
   * Clear the current user identity.
   */
  resetIdentity(): void {
    MostlyGoodMetricsModule.resetIdentity();
  },

  /**
   * Manually flush pending events to the server.
   */
  flush(): void {
    MostlyGoodMetricsModule.flush();
  },

  /**
   * Start a new session with a fresh session ID.
   */
  startNewSession(): void {
    MostlyGoodMetricsModule.startNewSession();
  },

  /**
   * Clear all pending events without sending them.
   */
  clearPendingEvents(): void {
    MostlyGoodMetricsModule.clearPendingEvents();
  },

  /**
   * Get the number of pending events waiting to be sent.
   *
   * @returns Promise resolving to the number of pending events
   */
  getPendingEventCount(): Promise<number> {
    return MostlyGoodMetricsModule.getPendingEventCount();
  },
};

export default MostlyGoodMetrics;
