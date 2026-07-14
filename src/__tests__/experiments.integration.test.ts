/**
 * Integration tests for A/B testing: the REAL @mostly-good-metrics/javascript
 * client wired with the React Native AsyncStorageExperimentStorage adapter
 * over a mocked (async, optionally delayed) AsyncStorage.
 *
 * Covers the experiments contract end-to-end:
 * - cache hydration from AsyncStorage completes before ready() resolves
 * - variants cache and $experiment_exposure dedup flags persist through
 *   AsyncStorage, surviving a simulated app restart (new client instance,
 *   same backing storage)
 */

// Mocked AsyncStorage backed by a Map, with configurable resolution delay to
// simulate slow device storage. (Variables must be `mock`-prefixed to be
// referenced inside the jest.mock factory.)
const mockBacking = {
  map: new Map<string, string>(),
  delayMs: 0,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string): Promise<string | null> =>
      new Promise((resolve) =>
        setTimeout(() => resolve(mockBacking.map.get(key) ?? null), mockBacking.delayMs)
      ),
    setItem: (key: string, value: string): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(() => {
          mockBacking.map.set(key, value);
          resolve();
        }, mockBacking.delayMs)
      ),
    removeItem: (key: string): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(() => {
          mockBacking.map.delete(key);
          resolve();
        }, mockBacking.delayMs)
      ),
  },
}));

import { MostlyGoodMetrics as MGMClient, SystemEvents } from '@mostly-good-metrics/javascript';
import type { IEventStorage, INetworkClient, MGMEvent } from '@mostly-good-metrics/javascript';
import { AsyncStorageExperimentStorage } from '../storage';

const ANON_ID = 'anon-rn-integration';
const CACHE_KEY = 'mgm_experiment_variants';
const EXPOSURES_KEY = 'mgm_experiment_exposures';

/** Event storage that just records stored events, no network involved. */
class RecordingEventStorage implements IEventStorage {
  public events: MGMEvent[] = [];

  async store(event: MGMEvent): Promise<void> {
    this.events.push(event);
  }
  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    return this.events.slice(0, limit);
  }
  async removeEvents(count: number): Promise<void> {
    this.events.splice(0, count);
  }
  async eventCount(): Promise<number> {
    return this.events.length;
  }
  async clear(): Promise<void> {
    this.events = [];
  }
}

const stubNetworkClient: INetworkClient = {
  sendEvents: async () => ({ success: true }),
  isRateLimited: () => false,
  getRetryAfterTime: () => null,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const exposureEvents = (storage: RecordingEventStorage): MGMEvent[] =>
  storage.events.filter((e) => e.name === SystemEvents.EXPERIMENT_EXPOSURE);

const mockFetch = (assignedVariants: Record<string, string>): jest.Mock => {
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ assigned_variants: assignedVariants }),
  });
  global.fetch = mock as unknown as typeof global.fetch;
  return mock;
};

const configureClient = (eventStorage: RecordingEventStorage) =>
  MGMClient.configure({
    apiKey: 'test-api-key',
    anonymousId: ANON_ID,
    storage: eventStorage,
    networkClient: stubNetworkClient,
    experimentStorage: new AsyncStorageExperimentStorage(),
    trackAppLifecycleEvents: false,
  });

describe('A/B testing integration (real JS SDK + AsyncStorage adapter)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockBacking.map = new Map();
    mockBacking.delayMs = 0;
    MGMClient.reset();
  });

  afterEach(async () => {
    MGMClient.reset();
    global.fetch = originalFetch;
    // Drain any in-flight delayed AsyncStorage writes so they cannot leak
    // into the next test's backing map.
    await wait(mockBacking.delayMs * 3 + 5);
  });

  it('hydrates the variants cache from AsyncStorage before ready() resolves', async () => {
    // Simulate slow AsyncStorage and a network that never responds: if
    // ready() resolves and the cached variant is served, hydration must have
    // completed first.
    mockBacking.delayMs = 25;
    mockBacking.map.set(
      CACHE_KEY,
      JSON.stringify({
        userId: ANON_ID,
        variants: { 'checkout-flow': 'b' },
        fetchedAt: Date.now(),
      })
    );
    const pendingFetch = jest.fn().mockReturnValue(new Promise(() => {}));
    global.fetch = pendingFetch as unknown as typeof global.fetch;

    configureClient(new RecordingEventStorage());
    await MGMClient.ready();

    expect(MGMClient.getVariant('checkout-flow')).toBe('b');
    // Fresh cache (fetchedAt = now): no revalidation fetch needed either
    expect(pendingFetch).not.toHaveBeenCalled();
  });

  it('returns the fallback for unknown experiments after ready()', async () => {
    mockFetch({});

    configureClient(new RecordingEventStorage());
    await MGMClient.ready();

    expect(MGMClient.getVariant('unknown-experiment')).toBeNull();
    expect(MGMClient.getVariant('unknown-experiment', 'control')).toBe('control');
  });

  it('persists fetched variants and exposure dedup flags to AsyncStorage', async () => {
    mockFetch({ 'rn-exp': 'a' });
    const eventStorage = new RecordingEventStorage();

    configureClient(eventStorage);
    await MGMClient.ready();
    await wait(10);

    // Variants cached through the adapter
    expect(mockBacking.map.get(CACHE_KEY)).toContain('rn-exp');

    // First hit tracks a single $experiment_exposure, deduped in-session
    expect(MGMClient.getVariant('rn-exp')).toBe('a');
    expect(MGMClient.getVariant('rn-exp')).toBe('a');
    await wait(10);

    expect(exposureEvents(eventStorage)).toHaveLength(1);
    expect(mockBacking.map.get(EXPOSURES_KEY)).toContain('rn-exp');
  });

  it('does not re-track exposures across a simulated app restart', async () => {
    mockFetch({ 'rn-exp': 'a' });

    // First app run: variant hit tracks the exposure
    const firstRunStorage = new RecordingEventStorage();
    configureClient(firstRunStorage);
    await MGMClient.ready();
    expect(MGMClient.getVariant('rn-exp')).toBe('a');
    await wait(10);
    expect(exposureEvents(firstRunStorage)).toHaveLength(1);

    // Simulated restart: new client instance, same AsyncStorage backing
    MGMClient.reset();
    const secondRunStorage = new RecordingEventStorage();
    configureClient(secondRunStorage);
    await MGMClient.ready();

    expect(MGMClient.getVariant('rn-exp')).toBe('a');
    await wait(10);
    expect(exposureEvents(secondRunStorage)).toHaveLength(0);
  });
});
