import { MAX_RETAINED_BYTES, ownedSnapshot } from './retention';
import { NativeTimeoutError, withNativeDeadline } from './native';
import type { IEventStorage, IExperimentStorage, MGMEvent } from '@mostly-good-metrics/javascript';

// Internal wrapper lifecycle hook; not exported from the package entrypoint.
const invalidatedStores = new WeakSet<IEventStorage>();
const invalidateCallbacks = new WeakMap<IEventStorage, () => void>();
export function invalidateEventStorage(storage: IEventStorage): void {
  invalidatedStores.add(storage);
  invalidateCallbacks.get(storage)?.();
}

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';
const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';
// Sticky on-device experiment assignments written by the JS core (local
// enrollment mode) through the AsyncStorage experiment storage adapter
const LOCAL_ASSIGNMENTS_KEY = 'mgm_local_experiment_assignments';

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
// A failed native write must not resurrect stale durable identity or consent.
const failedWrites = new Set<string>();
type NativeMutation = { value: string | null };
type PendingWrite = { latest: NativeMutation | null; promise: Promise<void> };
const writeQueues = new Map<string, PendingWrite>();
const writeRevisions = new Map<string, number>();
const quarantinedKeys = new Set<string>();
const nativeReads = new Map<string, Promise<string | null>>();
const quarantinedReads = new Set<string>();

function memoryValue(key: string): string | null {
  // If native consent cannot be read, stay opted out until an explicit choice.
  return memoryStorage[key] ?? (key === OPT_OUT_KEY ? 'true' : null);
}

function enqueueWrite(key: string, mutation: NativeMutation): Promise<void> {
  if (quarantinedKeys.has(key)) return Promise.resolve();
  const existing = writeQueues.get(key);
  if (existing) {
    existing.latest = mutation;
    return existing.promise;
  }
  const pending: PendingWrite = { latest: mutation, promise: Promise.resolve() };
  writeQueues.set(key, pending);
  pending.promise = Promise.resolve().then(async () => {
    try {
      while (pending.latest && !quarantinedKeys.has(key)) {
        const mutation = pending.latest;
        pending.latest = null;
        try {
          await withNativeDeadline(() => mutation.value === null ? AsyncStorage!.removeItem(key) : AsyncStorage!.setItem(key, mutation.value!));
          failedWrites.delete(key);
        } catch (error) {
          failedWrites.add(key);
          if (error instanceof NativeTimeoutError) {
            // The native call may still finish later. Never issue a newer call
            // that it could overwrite; use process-memory state from now on.
            quarantinedKeys.add(key);
            pending.latest = null;
          }
        }
      }
    } finally {
      writeQueues.delete(key);
    }
  });
  return pending.promise;
}

async function getItem(key: string): Promise<string | null> {
  if (failedWrites.has(key) || writeQueues.has(key) || quarantinedKeys.has(key) || quarantinedReads.has(key)) return memoryValue(key);
  if (AsyncStorage) {
    const revision = writeRevisions.get(key) ?? 0;
    try {
      let reading = nativeReads.get(key);
      if (!reading) {
        reading = withNativeDeadline(() => AsyncStorage!.getItem(key)).catch((error) => {
          if (error instanceof NativeTimeoutError) quarantinedReads.add(key);
          throw error;
        }).finally(() => nativeReads.delete(key));
        nativeReads.set(key, reading);
      }
      const value = await reading;
      return revision === (writeRevisions.get(key) ?? 0) ? value : memoryValue(key);
    } catch {
      return memoryValue(key);
    }
  }
  return memoryStorage[key] ?? null;
}

async function setItem(key: string, value: string): Promise<void> {
  memoryStorage[key] = value;
  writeRevisions.set(key, (writeRevisions.get(key) ?? 0) + 1);
  if (AsyncStorage) await enqueueWrite(key, { value });
}

async function removeItem(key: string): Promise<void> {
  delete memoryStorage[key];
  writeRevisions.set(key, (writeRevisions.get(key) ?? 0) + 1);
  if (AsyncStorage) await enqueueWrite(key, { value: null });
}

/**
 * Event storage for React Native.
 * Uses AsyncStorage if available, otherwise falls back to in-memory storage.
 */
export class AsyncStorageEventStorage implements IEventStorage {
  private maxEvents: number;
  private events: MGMEvent[] | null = null;
  // Serializes every read-modify-write so a synchronous burst of store()
  // calls fired before the in-memory cache is warm cannot each independently
  // load an empty array from AsyncStorage and clobber one another (dropping
  // all but the last event). Operations run one at a time, in order.
  private queue: Promise<unknown> = Promise.resolve();
  private storeGeneration = 0;
  private retainedBytes = 0;
  private pendingStoreBytes = 0;
  private countRead: Promise<number> | null = null;
  private clearOperation: Promise<void> | null = null;
  private fetchReads = new Map<number, Promise<MGMEvent[]>>();
  private pendingSave: Promise<void> | null = null;
  private resolvePendingSave: (() => void) | null = null;
  private rejectPendingSave: ((error: unknown) => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxEvents: number = 10000) {
    invalidateCallbacks.set(this, () => {
      this.storeGeneration += 1;
      this.cancelPendingSave();
      this.events = [];
      this.retainedBytes = 0;
    });
    this.maxEvents = Math.min(Math.max(Number.isFinite(maxEvents) ? Math.floor(maxEvents) : 10000, 100), Number.MAX_SAFE_INTEGER);
  }

  /**
   * Run `task` after all previously enqueued operations have settled, so the
   * load/modify/save sequence inside it is atomic with respect to other
   * operations on this store.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    // Keep the chain alive even when a task rejects (without surfacing an
    // unhandled rejection from the internal chaining promise).
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async loadEvents(): Promise<MGMEvent[]> {
    if (invalidatedStores.has(this)) return [];
    if (this.events !== null) {
      return this.events;
    }

    try {
      const stored = await getItem(STORAGE_KEY);
      if (invalidatedStores.has(this)) return [];
      this.events = [];
      if (stored && stored.length * 2 <= MAX_RETAINED_BYTES) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          for (const event of parsed) {
            if (!event || typeof event !== 'object' || typeof event.name !== 'string' || typeof event.timestamp !== 'string') continue;
            const snapshot = ownedSnapshot(event as MGMEvent);
            if (!snapshot) continue;
            this.events.push(snapshot.value);
            this.retainedBytes += snapshot.bytes;
            this.trimEvents();
          }
        }
      }
    } catch {
      this.events = [];
    }

    return this.events;
  }

  private trimEvents(): void {
    while (this.events && (this.events.length > this.maxEvents || this.retainedBytes + this.pendingStoreBytes > MAX_RETAINED_BYTES)) {
      const removed = this.events.shift();
      if (removed) this.retainedBytes -= ownedSnapshot(removed)?.bytes ?? 0;
    }
  }

  private async saveEvents(): Promise<void> {
    if (invalidatedStores.has(this)) return;
    await setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
  }

  private scheduleSave(): Promise<void> {
    if (this.pendingSave) {
      return this.pendingSave;
    }

    this.pendingSave = new Promise<void>((resolve, reject) => {
      this.resolvePendingSave = resolve;
      this.rejectPendingSave = reject;
    });
    this.saveTimer = setTimeout(() => this.startPendingSave(), 0);
    return this.pendingSave;
  }

  private startPendingSave(): void {
    if (!this.pendingSave) return;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    void this.enqueue(async () => {
      const resolve = this.resolvePendingSave;
      const reject = this.rejectPendingSave;
      try {
        await this.saveEvents();
        resolve?.();
      } catch (error) {
        reject?.(error);
      } finally {
        this.pendingSave = null;
        this.resolvePendingSave = null;
        this.rejectPendingSave = null;
      }
    });
  }

  private cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.resolvePendingSave?.();
    this.pendingSave = null;
    this.resolvePendingSave = null;
    this.rejectPendingSave = null;
  }

  store(event: MGMEvent): Promise<void> {
    if (invalidatedStores.has(this)) return Promise.resolve();
    const snapshot = ownedSnapshot(event);
    if (!snapshot || this.retainedBytes + this.pendingStoreBytes + snapshot.bytes > MAX_RETAINED_BYTES) return Promise.resolve();
    this.pendingStoreBytes += snapshot.bytes;
    const generation = this.storeGeneration;
    let released = false;
    let save = Promise.resolve();
    const mutation = this.enqueue(async () => {
      try {
        const events = await this.loadEvents();
        if (generation !== this.storeGeneration) return;
        this.pendingStoreBytes -= snapshot.bytes;
        released = true;
        events.push(snapshot.value);
        this.retainedBytes += snapshot.bytes;
        this.trimEvents();
        save = this.scheduleSave();
      } finally {
        if (!released) this.pendingStoreBytes -= snapshot.bytes;
      }
    });
    return mutation.then(() => save);
  }

  fetchEvents(limit: number): Promise<MGMEvent[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(Math.floor(limit), this.maxEvents)) : this.maxEvents;
    const pending = this.fetchReads.get(boundedLimit);
    if (pending) return pending;
    // Bound simultaneous distinct fetch requests while native hydration stalls.
    if (this.fetchReads.size >= 16) return Promise.resolve([]);
    const reading = this.enqueue(async () => {
      const events = await this.loadEvents();
      return events.slice(0, boundedLimit).map((event) => ownedSnapshot(event)!.value);
    });
    this.fetchReads.set(boundedLimit, reading);
    void reading.then(() => this.fetchReads.delete(boundedLimit), () => this.fetchReads.delete(boundedLimit));
    return reading;
  }

  removeEvents(count: number, clientEventIds?: string[]): Promise<void> {
    if (invalidatedStores.has(this)) return Promise.resolve();
    let save = Promise.resolve();
    const mutation = this.enqueue(async () => {
      const events = await this.loadEvents();
      if (invalidatedStores.has(this)) return;
      if (clientEventIds?.length) {
        const sentIds = new Set(clientEventIds.filter(Boolean));
        let idlessEventsToRemove = Math.max(0, count - sentIds.size);
        this.events = events.filter((event) => {
          if (event.client_event_id) {
            return !sentIds.has(event.client_event_id);
          }
          if (idlessEventsToRemove > 0) {
            idlessEventsToRemove -= 1;
            return false;
          }
          return true;
        });
      } else {
        events.splice(0, count);
      }
      this.retainedBytes = (this.events ?? []).reduce((bytes, event) => bytes + (ownedSnapshot(event)?.bytes ?? 0), 0);
      save = this.scheduleSave();
    });
    return mutation.then(() => save);
  }

  eventCount(): Promise<number> {
    if (this.countRead) return this.countRead;
    const reading = this.enqueue(async () => (await this.loadEvents()).length);
    this.countRead = reading;
    void reading.then(() => { this.countRead = null; }, () => { this.countRead = null; });
    return reading;
  }

  clear(): Promise<void> {
    if (invalidatedStores.has(this)) return Promise.resolve();
    // Every privacy clear invalidates earlier admitted stores, including calls
    // queued between two coalesced clears while native hydration is pending.
    this.storeGeneration += 1;
    if (this.clearOperation) return this.clearOperation;
    const clearing = this.enqueue(async () => {
      if (invalidatedStores.has(this)) return;
      this.cancelPendingSave();
      this.events = [];
      this.retainedBytes = 0;
      await removeItem(STORAGE_KEY);
    });
    this.clearOperation = clearing;
    void clearing.then(() => { this.clearOperation = null; }, () => { this.clearOperation = null; });
    return clearing;
  }

}

/**
 * Experiment storage for React Native.
 *
 * Implements the JS SDK's `IExperimentStorage` key-value interface over
 * AsyncStorage (with the same in-memory fallback as event storage), so the
 * experiments variant cache and $experiment_exposure dedup flags survive app
 * restarts. Pass an instance via the `experimentStorage` configuration option;
 * the JS SDK awaits hydration from this adapter before `ready()` resolves.
 */
export class AsyncStorageExperimentStorage implements IExperimentStorage {
  async getItem(key: string): Promise<string | null> {
    return getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    return setItem(key, value);
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

  /**
   * Resolve the anonymous ID used for all pre-identify tracking and
   * server-side experiment bucketing.
   *
   * The JS SDK persists its anonymous ID via cookies/localStorage, neither of
   * which exists on React Native, so the wrapper persists one in AsyncStorage
   * and passes it to the JS SDK via the `anonymousId` configuration override.
   *
   * Mirrors the JS SDK's own resolution semantics: an explicit override
   * always wins (and is persisted), otherwise the stored ID is reused,
   * otherwise a new one is generated and persisted - keeping the ID stable
   * across app launches.
   */
  async getOrCreateAnonymousId(
    override: string | undefined,
    generate: () => string
  ): Promise<string> {
    if (override) {
      await setItem(ANONYMOUS_ID_KEY, override);
      return override;
    }

    const existing = await getItem(ANONYMOUS_ID_KEY);
    if (existing) {
      return existing;
    }

    const newId = generate();
    await setItem(ANONYMOUS_ID_KEY, newId);
    return newId;
  },

  /**
   * Persist the anonymous ID (used after resetAnonymousId / forget-me so the
   * rotated ID survives app restarts).
   */
  async setAnonymousId(anonymousId: string): Promise<void> {
    await setItem(ANONYMOUS_ID_KEY, anonymousId);
  },

  /**
   * Clear the sticky local experiment assignments (local enrollment mode)
   * so a rotated anonymous ID is re-bucketed. The JS core clears these too
   * (via the experiment storage adapter); this direct clear also covers
   * older cores that predate the wiring.
   */
  async clearLocalExperimentAssignments(): Promise<void> {
    await removeItem(LOCAL_ASSIGNMENTS_KEY);
  },

  /**
   * Get the persisted opt-out choice.
   * Returns true (opted out), false (explicitly opted in), or null when the
   * user has never made an explicit choice.
   *
   * The JS SDK persists its opt-out flag via cookies/localStorage, neither of
   * which exists on React Native, so the wrapper persists it in AsyncStorage.
   */
  async getOptOut(): Promise<boolean | null> {
    const stored = await getItem(OPT_OUT_KEY);
    if (stored === 'true') {
      return true;
    }
    if (stored === 'false') {
      return false;
    }
    // A missing value is a new installation; malformed persisted consent is
    // not permission to collect analytics. Explicit optIn can replace it.
    return stored === null ? null : true;
  },

  /**
   * Persist the user's explicit opt-out choice.
   * Both states are stored so an explicit optIn() overrides
   * `optedOutByDefault` on later launches.
   */
  async setOptOut(optedOut: boolean): Promise<void> {
    await setItem(OPT_OUT_KEY, optedOut ? 'true' : 'false');
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
