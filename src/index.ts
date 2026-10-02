import { MAX_RETAINED_BYTES, ownedSnapshot } from './retention';
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
  generateAnonymousId,
} from '@mostly-good-metrics/javascript';
import {
  AsyncStorageEventStorage,
  AsyncStorageExperimentStorage,
  persistence,
  invalidateEventStorage,
  getStorageType,
} from './storage';

/** SDK version for metrics headers */
const SDK_VERSION = '0.9.1';

export type { MGMConfiguration, EventProperties, UserProfile };

/**
 * Options for resetIdentity().
 */
export interface ResetIdentityOptions {
  /**
   * Full "forget me": in addition to clearing the user ID, also rotate the
   * anonymous ID, purge queued (unsent) events, super properties, identify
   * debounce state, the cached experiment variants and the sticky local
   * experiment assignments (so the new anonymous ID is re-bucketed).
   * @default false
   */
  clearAnonymousId?: boolean;
}

/**
 * How experiment variants are assigned.
 * Mirrors the JS core's ExperimentMode (declared locally until the wrapper's
 * @mostly-good-metrics/javascript dependency is bumped to a release that
 * exports it).
 */
export type ExperimentMode = 'server' | 'local';

/**
 * An experiment configuration used for local (on-device) enrollment.
 * Mirrors the JS core's MGMExperimentConfig.
 */
export interface MGMExperimentConfig {
  /**
   * The experiment UUID (stable bucketing key, matching the dashboard).
   */
  id: string;

  /**
   * The human-readable experiment name passed to getVariant().
   */
  name: string;

  /**
   * The ordered list of variants. Order matters for bucketing.
   */
  variants: string[];
}

/**
 * Note: `respectDoNotTrack` and `persistence` from the JS SDK are web-only
 * (browser Do Not Track signal and cookie/localStorage persistence modes) and
 * are intentionally not part of the React Native configuration. Opt-out state
 * is persisted in AsyncStorage instead.
 */
export interface ReactNativeConfig
  extends Omit<
    MGMConfiguration,
    'storage' | 'experimentStorage' | 'respectDoNotTrack' | 'persistence'
  > {
  /**
   * The app version string. Required for install/update tracking.
   */
  appVersion?: string;

  /**
   * Treat the first MGM launch as an existing installation during a provider
   * migration. Establishes lifecycle state without emitting `$app_installed`.
   * @default false
   */
  existingInstallation?: boolean;

  /**
   * Dynamic properties evaluated for every event by the JavaScript core.
   * Merge precedence is: super properties < context < event < system.
   */
  contextProvider?: () => EventProperties;

  /**
   * Start opted out of tracking until optIn() is called.
   * Useful for consent-first apps. A previously persisted opt-in/opt-out
   * choice (from optIn()/optOut()) takes precedence over this default.
   * @default false
   */
  optedOutByDefault?: boolean;

  /**
   * Collect device properties ($device_type/$device_model) and locale/timezone
   * context. Platform, OS version and app version are still sent when false.
   * @default true
   */
  collectDeviceProperties?: boolean;

  /**
   * How experiment variants are assigned:
   * - 'server' (default): the server assigns variants per user.
   * - 'local': experiment configs are loaded without sending any user
   *   identifier and variants are assigned on-device via deterministic
   *   hashing. Sticky assignments are persisted in AsyncStorage (via the
   *   wrapper's experiment storage adapter) and survive app restarts.
   * Requires @mostly-good-metrics/javascript >= 0.9 at runtime.
   * @default 'server'
   */
  experimentMode?: ExperimentMode;

  /**
   * Inline experiment configurations for experimentMode: 'local'.
   * When provided, the SDK performs no experiments network request at all.
   */
  localExperiments?: MGMExperimentConfig[];
}

/**
 * Privacy APIs introduced in @mostly-good-metrics/javascript 0.9.
 * Accessed through this structural type (with runtime guards) so the wrapper
 * compiles and degrades gracefully against older core versions until the
 * dependency is bumped.
 */
interface PrivacyCapableStatics {
  optOut?: () => void;
  optIn?: () => void;
  isOptedOut?: () => boolean;
  resetAnonymousId?: () => string | null;
  resetIdentity: (options?: ResetIdentityOptions) => void;
}

const PrivacyClient = MGMClient as unknown as PrivacyCapableStatics;

function nativeAppState(): AppStateStatus | null {
  try {
    const current = AppState.currentState;
    return typeof current === 'string' ? current : null;
  } catch {
    // Native state can be unavailable during startup. Unknown state should not
    // fabricate a foreground/background transition or interrupt initialization.
    return null;
  }
}

// Use global to persist state across hot reloads
const g = globalThis as typeof globalThis & {
  __MGM_RN_STATE__?: {
    appStateSubscription: { remove: () => void } | null;
    isConfigured: boolean;
    currentAppState: AppStateStatus | null;
    debugLogging: boolean;
    lastLifecycleEvent: { name: string; time: number } | null;
    clientReady: boolean;
    pendingClientCalls: Array<(() => void) & { retainedBytes?: number }>;
    pendingClientBytes: number;
    eventStorage: AsyncStorageEventStorage | null;
    initPromise: Promise<void> | null;
    initGeneration: number;
    explicitConsent: boolean | null;
    cancelledWaits: Set<() => void>;
    optedOut: boolean;
    collectDeviceProperties: boolean;
  };
};

// Initialize or restore state
if (!g.__MGM_RN_STATE__) {
  g.__MGM_RN_STATE__ = {
    appStateSubscription: null,
    isConfigured: false,
    currentAppState: nativeAppState(),
    debugLogging: false,
    lastLifecycleEvent: null,
    clientReady: false,
    pendingClientCalls: [],
    pendingClientBytes: 0,
    eventStorage: null,
    initPromise: null,
    initGeneration: 0,
    explicitConsent: null,
    cancelledWaits: new Set(),
    optedOut: false,
    collectDeviceProperties: true,
  };
}

const state = g.__MGM_RN_STATE__;

// Backfill fields that may be missing when hot-reloading over an older SDK version
state.clientReady = state.clientReady ?? false;
state.pendingClientCalls = state.pendingClientCalls ?? [];
state.pendingClientBytes = state.pendingClientBytes ?? 0;
state.eventStorage = state.eventStorage ?? null;
state.initPromise = state.initPromise ?? null;
state.initGeneration = state.initGeneration ?? 0;
state.explicitConsent = state.explicitConsent ?? null;
state.cancelledWaits = state.cancelledWaits ?? new Set();
state.optedOut = state.optedOut ?? false;
state.collectDeviceProperties = state.collectDeviceProperties ?? true;

const DEDUPE_INTERVAL_MS = 1000; // Ignore duplicate events within 1 second

const MAX_PENDING_CLIENT_CALLS = 10000;

function normalizedTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) ? Math.min(2147483647, Math.max(0, timeoutMs)) : 5000;
}

async function waitForClient(timeoutMs = 5000): Promise<boolean> {
  const generation = state.initGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    await Promise.race([
      Promise.resolve(state.initPromise),
      new Promise<void>((resolve) => { cancel = resolve; state.cancelledWaits.add(resolve); }),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, normalizedTimeout(timeoutMs)); }),
    ]);
  } catch (error) {
    log('Initialization wait error:', error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) state.cancelledWaits.delete(cancel);
  }
  return generation === state.initGeneration && state.isConfigured && state.clientReady;
}

async function waitUntilReady(timeoutMs: number): Promise<void> {
  const timeout = normalizedTimeout(timeoutMs);
  const generation = state.initGeneration;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => { cancel = resolve; state.cancelledWaits.add(resolve); }),
      (async () => {
        await state.initPromise;
        if (generation !== state.initGeneration || !state.isConfigured || !state.clientReady) return;
        await MGMClient.ready(Math.max(0, timeout - (Date.now() - started)));
      })(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeout); }),
    ]);
  } catch (error) {
    log('Readiness error:', error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) state.cancelledWaits.delete(cancel);
  }
}

function warn(...args: unknown[]): void {
  try {
    console.warn(...args);
  } catch {
    // Logging is best-effort, including unconfigured SDK warnings.
  }
}

function snapshotProperties(properties?: EventProperties): EventProperties {
  const snapshot: EventProperties = {};
  let bytes = 0;
  let keys = 0;
  try {
    for (const key in properties ?? {}) {
      if (++keys > 1024) break;
      if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
      if (key.length > 255) continue;
      try {
        const owned = ownedSnapshot(properties![key]);
        if (!owned || bytes + owned.bytes + key.length * 2 > 32 * 1024) continue;
        bytes += owned.bytes + key.length * 2;
        Object.defineProperty(snapshot, key, { value: owned.value, enumerable: true, configurable: true, writable: true });
      } catch (e) { log('Unreadable event property:', e); }
    }
  } catch (e) { log('Unreadable event properties:', e); }
  return snapshot;
}

function invokeClient(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    log('Client call error:', e);
  }
}

function log(...args: unknown[]) {
  if (state.debugLogging) {
    try {
      console.log('[MostlyGoodMetrics]', ...args);
    } catch {
      // Host logging hooks must never interrupt analytics or error handling.
    }
  }
}

/**
 * Run a JS-client call now if the client has been constructed, otherwise
 * queue it to run (in order) as soon as configuration finishes.
 *
 * configure() resolves the persisted anonymous ID and stored user ID from
 * AsyncStorage before constructing the JS client, so there is a short async
 * window where the wrapper is "configured" but the JS client does not exist
 * yet. Calls made in that window would otherwise be dropped silently.
 */
function removeAppStateSubscription(): void {
  const subscription = state.appStateSubscription;
  state.appStateSubscription = null;
  if (!subscription) return;
  try {
    subscription.remove();
  } catch (e) {
    log('Listener cleanup error:', e);
  }
}

function whenClientReady(fn: () => void, retainedBytes = 128): void {
  if (state.clientReady) {
    invokeClient(fn);
    return;
  }
  if (retainedBytes > MAX_RETAINED_BYTES) return;
  while (state.pendingClientCalls.length && (state.pendingClientCalls.length >= MAX_PENDING_CLIENT_CALLS || state.pendingClientBytes + retainedBytes > MAX_RETAINED_BYTES)) {
    state.pendingClientBytes -= state.pendingClientCalls.shift()?.retainedBytes ?? 128;
  }
  const pending: (() => void) & { retainedBytes?: number } = () => invokeClient(fn);
  pending.retainedBytes = retainedBytes;
  state.pendingClientBytes += retainedBytes;
  state.pendingClientCalls.push(pending);
}

/**
 * Track a lifecycle event with deduplication.
 */
function trackLifecycleEvent(eventName: string, properties?: EventProperties) {
  if (state.optedOut) {
    log(`Tracking is opted out, skipping lifecycle event: ${eventName}`);
    return;
  }

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
  invokeClient(() => MGMClient.track(eventName, properties));
}

/**
 * Handle app state changes for lifecycle tracking.
 */
function handleAppStateChange(nextAppState: AppStateStatus) {
  if (!MGMClient.shared) return;

  log(`AppState change: ${state.currentAppState} -> ${nextAppState}`);

  // App came to foreground
  if ((state.currentAppState === 'inactive' || state.currentAppState === 'background') && nextAppState === 'active') {
    trackLifecycleEvent(SystemEvents.APP_OPENED);
  }

  // App went to background
  if (state.currentAppState === 'active' && (nextAppState === 'inactive' || nextAppState === 'background')) {
    trackLifecycleEvent(SystemEvents.APP_BACKGROUNDED);
    // Flush events when going to background
    void Promise.resolve().then(() => MGMClient.flush()).catch((e) => log('Flush error:', e));
  }

  state.currentAppState = nextAppState;
}

/**
 * Track app install or update events.
 */
async function trackInstallOrUpdate(appVersion?: string, existingInstallation = false) {
  if (!appVersion) return;
  const generation = state.initGeneration;

  const previousVersion = await persistence.getAppVersion();
  const isFirst = await persistence.isFirstLaunch();
  if (generation !== state.initGeneration || !state.isConfigured) return;

  if (isFirst) {
    if (!existingInstallation) {
      trackLifecycleEvent(SystemEvents.APP_INSTALLED, {
        [SystemProperties.VERSION]: appVersion,
      });
    } else {
      log(`Seeded lifecycle state for existing installation at ${appVersion}`);
    }
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
   *
   * Identity is resolved before the JS client is constructed: the persisted
   * anonymous ID (generated once and stored in AsyncStorage) and any stored
   * user ID are loaded first, so the client's very first experiments fetch
   * runs with a stable identity. Calls made while that async resolution is
   * in flight are queued and replayed in order.
   */
  configure(apiKey: string, config: Omit<ReactNativeConfig, 'apiKey'> = {}): void {
    // Check both our state and the underlying JS SDK
    if (state.isConfigured || MGMClient.isConfigured) {
      log('Already configured, skipping');
      return;
    }
    if (state.eventStorage) invalidateEventStorage(state.eventStorage);
    state.eventStorage = null;

    state.debugLogging = config.enableDebugLogging ?? false;
    log('Configuring with options:', config);

    state.isConfigured = true;
    state.clientReady = false;
    const generation = ++state.initGeneration;
    state.explicitConsent = null;
    state.collectDeviceProperties = config.collectDeviceProperties ?? true;
    // Until the persisted choice is loaded, honor the configured default
    state.optedOut = config.optedOutByDefault ?? false;

    // Create AsyncStorage-based storage
    const storage = new AsyncStorageEventStorage(config.maxStoredEvents);
    state.eventStorage = storage;

    // AsyncStorage-backed experiment storage: persists the experiments
    // variant cache and exposure dedup flags across app restarts. Wired at
    // construction so the JS SDK hydrates it before ready() resolves.
    const experimentStorage = new AsyncStorageExperimentStorage();

    state.initPromise = (async () => {
      // Resolve identity BEFORE constructing the JS client. The JS SDK
      // persists its anonymous ID via cookies/localStorage, which do not
      // exist on React Native - without an override it would generate a
      // fresh $anon_* ID every launch (re-bucketing users, re-firing
      // exposures and invalidating the variants cache). Loading both the
      // persisted anonymous ID and the stored user ID first guarantees the
      // client's initial experiments fetch uses a stable identity.
      const [anonymousId, storedUserId, storedOptOut] = await Promise.all([
        persistence.getOrCreateAnonymousId(config.anonymousId, () => {
          if (generation !== state.initGeneration || !state.isConfigured) throw new Error('Configuration invalidated');
          return generateAnonymousId();
        }),
        persistence.getUserId(),
        persistence.getOptOut(),
      ]);
      // destroy() invalidates work still waiting on native storage/plugins.
      if (generation !== state.initGeneration || !state.isConfigured) return;
      log('Resolved anonymous ID:', anonymousId);

      // A persisted explicit optIn()/optOut() choice (stored in AsyncStorage,
      // since the JS SDK's cookie/localStorage persistence does not exist on
      // React Native) takes precedence over the configured default.
      state.optedOut = state.explicitConsent ?? storedOptOut ?? config.optedOutByDefault ?? false;
      if (state.optedOut) {
        log('Tracking is disabled (opted out)');
      }

      // Configure the JS SDK
      // Disable its built-in lifecycle tracking since we handle it ourselves.
      // `optedOutByDefault` starts the JS client in the resolved opt-out
      // state; its own persistence is a no-op on React Native, so the wrapper
      // owns it. The cast keeps this compiling against core typings that
      // predate the privacy controls (@mostly-good-metrics/javascript < 0.9).
      MGMClient.configure({
        apiKey,
        ...config,
        anonymousId,
        storage,
        experimentStorage,
        optedOutByDefault: state.optedOut,
        platform: Platform.OS as MGMPlatform, // 'ios' or 'android'
        sdk: 'react-native',
        sdkVersion: SDK_VERSION,
        osVersion: getOSVersion(),
        trackAppLifecycleEvents: false, // We handle this with AppState
      } as MGMConfiguration);

      // Restore the stored user ID synchronously after construction, before
      // the client's async experiments initialization reaches its first
      // fetch, so identified users never fetch experiments as anonymous.
      if (storedUserId) {
        log('Restored user ID:', storedUserId);
        MGMClient.identify(storedUserId);
      }

      // Replay any calls queued while identity was being resolved
      state.clientReady = true;
      const pendingCalls = state.pendingClientCalls.splice(0);
      state.pendingClientBytes = 0;
      pendingCalls.forEach((fn) => {
        if (generation === state.initGeneration && state.isConfigured) fn();
      });
      if (generation !== state.initGeneration || !state.isConfigured) return;

      // Set up React Native lifecycle tracking
      if (config.trackAppLifecycleEvents !== false) {
        log('Setting up lifecycle tracking, currentAppState:', state.currentAppState);

        // Remove any existing listener (in case of hot reload)
        if (state.appStateSubscription) {
          removeAppStateSubscription();
          state.appStateSubscription = null;
        }

        // Track initial app open
        trackLifecycleEvent(SystemEvents.APP_OPENED);
        if (generation !== state.initGeneration || !state.isConfigured) return;

        // Track install/update
        trackInstallOrUpdate(config.appVersion, config.existingInstallation).catch((e) =>
          log('Install/update tracking error:', e)
        );

        // Module import may happen while the Activity is backgrounded. Refresh
        // from native state at subscription time so the first real background
        // transition is recognized after async configuration finishes.
        state.currentAppState = nativeAppState();
        if (generation !== state.initGeneration || !state.isConfigured) return;
        try {
          const subscription = AppState.addEventListener('change', (nextAppState) => {
            if (generation === state.initGeneration && state.isConfigured) handleAppStateChange(nextAppState);
          });
          if (generation !== state.initGeneration || !state.isConfigured) {
            try { subscription.remove(); } catch (error) { log('Listener cleanup error:', error); }
          } else {
            state.appStateSubscription = subscription;
          }
        } catch (error) { log('Listener registration error:', error); }
      }
    })().catch((e) => {
      log('Configuration error:', e);
      if (generation === state.initGeneration && !state.clientReady) {
        state.isConfigured = false;
        state.pendingClientCalls = [];
        state.pendingClientBytes = 0;
        for (const cancel of state.cancelledWaits) cancel();
        state.cancelledWaits.clear();
      }
    });
  },

  /**
   * Track an event with optional properties.
   */
  track(name: string, properties?: EventProperties): void {
    if (typeof name !== 'string' || name.length > 255) return;
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    if (state.optedOut) {
      log(`Tracking is opted out, ignoring event: ${name}`);
      return;
    }

    // Add React Native specific properties
    const enrichedProperties: EventProperties = {
      ...(state.collectDeviceProperties
        ? { [SystemProperties.DEVICE_TYPE]: getDeviceType() }
        : {}),
      $storage_type: getStorageType(),
      ...snapshotProperties(properties),
    };

    const snapshot = ownedSnapshot({ name, properties: enrichedProperties });
    if (!snapshot) return;
    whenClientReady(() => MGMClient.track(snapshot.value.name, snapshot.value.properties), snapshot.bytes + 128);
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
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    if (state.optedOut) {
      log('Tracking is opted out, ignoring identify');
      return;
    }

    log('Identifying user:', userId, profile ? 'with profile' : '');
    const snapshot = ownedSnapshot({ userId, profile });
    if (!snapshot || typeof userId !== 'string') return;
    whenClientReady(() => MGMClient.identify(snapshot.value.userId, snapshot.value.profile), snapshot.bytes + 128);
    // Also persist to AsyncStorage for restoration
    persistence.setUserId(snapshot.value.userId).catch((e) => log('Failed to persist user ID:', e));
  },

  /**
   * Clear the current user identity.
   *
   * Pass `{ clearAnonymousId: true }` for a full "forget me": additionally
   * rotates the anonymous ID (persisted to AsyncStorage), purges queued
   * (unsent) events, super properties, identify debounce state, the cached
   * experiment variants and the sticky local experiment assignments (so the
   * new anonymous ID is re-bucketed).
   * Requires @mostly-good-metrics/javascript >= 0.9.
   */
  resetIdentity(options?: ResetIdentityOptions): void {
    if (!state.isConfigured) return;

    const snapshot = ownedSnapshot(options ?? {});
    if (!snapshot) return;
    options = options === undefined ? undefined : snapshot.value;
    log('Resetting identity', options);
    whenClientReady(() => {
      PrivacyClient.resetIdentity(options);

      if (options?.clearAnonymousId) {
        // Persist the rotated anonymous ID so it survives app restarts
        // (the JS SDK's own persistence is a no-op on React Native)
        const newAnonymousId = MGMClient.shared?.anonymousId;
        if (newAnonymousId) {
          persistence
            .setAnonymousId(newAnonymousId)
            .catch((e) => log('Failed to persist anonymous ID:', e));
        }

        // Clear sticky local experiment assignments so the new identity is
        // re-bucketed (also covers cores that predate this wiring)
        persistence
          .clearLocalExperimentAssignments()
          .catch((e) => log('Failed to clear local experiment assignments:', e));
      }
    }, snapshot.bytes + 128);
    persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
  },

  /**
   * Reset the anonymous ID to a newly generated one, persisted to
   * AsyncStorage. Resolves with the new anonymous ID (or null when the SDK is
   * not configured or the installed core does not support it yet).
   * Requires @mostly-good-metrics/javascript >= 0.9.
   */
  async resetAnonymousId(): Promise<string | null> {
    if (!state.isConfigured) return null;
    const generation = state.initGeneration;
    if (!await waitForClient() || generation !== state.initGeneration) return null;

    if (typeof PrivacyClient.resetAnonymousId !== 'function') {
      warn(
        '[MostlyGoodMetrics] resetAnonymousId requires a newer @mostly-good-metrics/javascript core.'
      );
      return null;
    }

    let newAnonymousId: string | null;
    try { newAnonymousId = PrivacyClient.resetAnonymousId(); } catch (error) { log('Anonymous ID error:', error); return null; }
    if (newAnonymousId) {
      log('Anonymous ID reset');
      await persistence
        .setAnonymousId(newAnonymousId)
        .catch((e) => log('Failed to persist anonymous ID:', e));

      if (generation !== state.initGeneration || !state.isConfigured) return null;

      // A rotated anonymous ID must be re-bucketed - clear sticky local
      // experiment assignments (the core clears them too; this also covers
      // cores that predate the wiring)
      await persistence
        .clearLocalExperimentAssignments()
        .catch((e) => log('Failed to clear local experiment assignments:', e));
    }
    return newAnonymousId;
  },

  /**
   * Opt out of all tracking.
   *
   * Immediately stops tracking (track/identify/flush become no-ops) and
   * purges queued (unsent) events. The choice is persisted in AsyncStorage so
   * it survives app restarts.
   */
  optOut(): void {
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Opting out of tracking');
    state.optedOut = true;
    state.explicitConsent = true;
    state.pendingClientCalls = [];
    state.pendingClientBytes = 0;
    persistence.setOptOut(true).catch((e) => log('Failed to persist opt-out:', e));

    whenClientReady(() => {
      if (typeof PrivacyClient.optOut === 'function') {
        PrivacyClient.optOut();
      } else {
        // Older core: at least purge the queued events
        MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e));
      }
    });
  },

  /**
   * Opt back in to tracking. Persisted in AsyncStorage, overriding
   * `optedOutByDefault` on later launches.
   */
  optIn(): void {
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Opting in to tracking');
    state.optedOut = false;
    state.explicitConsent = false;
    persistence.setOptOut(false).catch((e) => log('Failed to persist opt-in:', e));

    whenClientReady(() => {
      if (typeof PrivacyClient.optIn === 'function') {
        PrivacyClient.optIn();
      }
    });
  },

  /**
   * Check whether tracking is currently opted out.
   */
  isOptedOut(): boolean {
    if (!state.isConfigured) return false;
    return state.optedOut;
  },

  /**
   * Manually flush pending events to the server.
   *
   * Returns a promise that resolves once the underlying network POST
   * completes, so callers can `await flush()` before backgrounding or exiting
   * and be sure the batch was delivered. Resolves immediately (no-op) when the
   * SDK is not configured or tracking is opted out.
   */
  async flush(): Promise<void> {
    if (!state.isConfigured || state.optedOut) return;
    const generation = state.initGeneration;
    if (!await waitForClient() || state.optedOut || generation !== state.initGeneration) return;
    await Promise.resolve().then(() => {
      if (generation === state.initGeneration && state.isConfigured && !state.optedOut) return MGMClient.flush();
      return undefined;
    }).catch((e) => log('Flush error:', e));
  },

  /**
   * Start a new session with a fresh session ID.
   */
  startNewSession(): void {
    if (!state.isConfigured) return;

    log('Starting new session');
    whenClientReady(() => MGMClient.startNewSession());
  },

  /**
   * Clear all pending events without sending them.
   */
  clearPendingEvents(): void {
    if (!state.isConfigured) return;

    log('Clearing pending events');
    whenClientReady(() => MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e)));
  },

  /**
   * Get the number of pending events.
   */
  async getPendingEventCount(): Promise<number> {
    if (!state.isConfigured) return 0;
    const generation = state.initGeneration;
    if (!await waitForClient() || generation !== state.initGeneration) return 0;
    return MGMClient.getPendingEventCount();
  },

  // Super Properties

  /**
   * Set a single super property that will be included with every event.
   */
  setSuperProperty(key: string, value: EventProperties[string]): void {
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super property:', key);
    const snapshot = ownedSnapshot({ key, value });
    if (!snapshot) return;
    whenClientReady(() => MGMClient.setSuperProperty(snapshot.value.key, snapshot.value.value), snapshot.bytes + 128);
  },

  /**
   * Set multiple super properties at once.
   */
  setSuperProperties(properties: EventProperties): void {
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super properties');
    const snapshot = ownedSnapshot(properties);
    if (!snapshot) return;
    whenClientReady(() => MGMClient.setSuperProperties(snapshot.value), snapshot.bytes + 128);
  },

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    if (!state.isConfigured) return;
    log('Removing super property:', key);
    const snapshot = ownedSnapshot(key);
    if (!snapshot) return;
    whenClientReady(() => MGMClient.removeSuperProperty(snapshot.value), snapshot.bytes + 128);
  },

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    if (!state.isConfigured) return;
    log('Clearing all super properties');
    whenClientReady(() => MGMClient.clearSuperProperties());
  },

  /**
   * Get all current super properties.
   */
  getSuperProperties(): EventProperties {
    if (!state.isConfigured || !state.clientReady) return {};
    try { return MGMClient.getSuperProperties(); } catch (error) { log('Super properties error:', error); return {}; }
  },

  // A/B Testing

  /**
   * Get the variant for an experiment.
   *
   * Variants are assigned server-side and cached locally via AsyncStorage
   * (forever, per user, with stale-while-revalidate background refreshes).
   * On a hit, the variant is set as a super property and a
   * $experiment_exposure event is tracked once per (user, experiment,
   * variant), with dedup persisted across app restarts.
   *
   * Returns `fallback` (default null) if the experiment is unknown or
   * experiments have not loaded yet. Await ready() first to ensure
   * experiments are loaded.
   *
   * @param experimentName The name of the experiment
   * @param fallback Value returned when no variant is assigned (default null)
   * @returns The assigned variant, or `fallback` if not available
   */
  getVariant(experimentName: string, fallback: string | null = null): string | null {
    if (!state.isConfigured) {
      warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return fallback;
    }
    log('Getting variant for experiment:', experimentName);
    if (!state.clientReady) return fallback;
    try { return MGMClient.getVariant(experimentName, fallback); } catch (error) { log('Variant error:', error); return fallback; }
  },

  /**
   * Wait for experiments to be loaded (resolves immediately if the
   * AsyncStorage cache is already hydrated; hydration always completes
   * before this resolves).
   * Call this before getVariant() to ensure experiments are loaded.
   *
   * Resolves as soon as experiments are ready, or after `timeoutMs`
   * (default 5000ms) elapses - whichever comes first - so it always
   * resolves. This mirrors the native SDKs' bounded ready() (Swift
   * `ready(timeout: 5.0)`, Android `ready(5000L)`).
   *
   * @param timeoutMs Maximum time to wait in milliseconds (default 5000)
   * @returns A promise that resolves when the SDK is ready or the timeout elapses
   */
  async ready(timeoutMs: number = 5000): Promise<void> {
    if (!state.isConfigured) return;
    await waitUntilReady(timeoutMs);
  },

  /**
   * Clean up resources. Call when unmounting the app.
   */
  destroy(): void {
    if (state.eventStorage) invalidateEventStorage(state.eventStorage);
    state.eventStorage = null;
    ++state.initGeneration;
    for (const cancel of state.cancelledWaits) cancel();
    state.cancelledWaits.clear();
    if (state.appStateSubscription) {
      removeAppStateSubscription();
      state.appStateSubscription = null;
    }
    invokeClient(() => MGMClient.reset());
    state.isConfigured = false;
    state.lastLifecycleEvent = null;
    state.clientReady = false;
    state.pendingClientCalls = [];
    state.pendingClientBytes = 0;
    state.initPromise = null;
    state.explicitConsent = null;
    state.optedOut = false;
    state.collectDeviceProperties = true;
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
