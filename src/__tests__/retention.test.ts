const mockRead = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
jest.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: (...args: unknown[]) => mockRead(...args), setItem: (...args: unknown[]) => mockSet(...args), removeItem: jest.fn().mockResolvedValue(undefined) } }));
import { AsyncStorageEventStorage, invalidateEventStorage } from '../storage';
const event = (payload = 'x'.repeat(10000)) => ({ name: 'large_valid', timestamp: '2026-10-02T00:00:00Z', client_event_id: 'id', user_id: 'test', platform: 'ios' as const, environment: 'test', properties: { nested: { value: payload } } });
describe('bounded native event retention', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it('caps payload admission and coalesces count reads while storage hydration stalls', async () => {
    let resolve!: (value: string | null) => void;
    mockRead.mockImplementationOnce(() => new Promise<string | null>((yes) => { resolve = yes; }));
    const storage = new AsyncStorageEventStorage();
    const source = event();
    const stores = Array.from({ length: 2000 }, () => storage.store(source));
    const counts = Array.from({ length: 2000 }, () => storage.eventCount());
    expect(new Set(counts).size).toBe(1);
    expect((storage as unknown as { pendingStoreBytes: number }).pendingStoreBytes).toBeLessThanOrEqual(1024 * 1024);
    source.properties.nested.value = 'mutated';
    await Promise.resolve();
    resolve(null);
    await Promise.all(stores);
    const fetched = await storage.fetchEvents(10000);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.length).toBeLessThan(100);
    expect(fetched[0]?.properties?.nested).toEqual({ value: 'x'.repeat(10000) });
    fetched[0]!.name = 'changed-by-caller';
    expect((await storage.fetchEvents(1))[0]?.name).toBe('large_valid');
  });

  it('honors a second privacy clear after a store queued behind the first clear', async () => {
    let release!: (value: string | null) => void;
    mockRead.mockImplementationOnce(() => new Promise<string | null>((resolve) => { release = resolve; }));
    const storage = new AsyncStorageEventStorage();
    const first = storage.store(event('first'));
    const clear1 = storage.clear();
    const second = storage.store(event('must-be-cleared'));
    const clear2 = storage.clear();
    await Promise.resolve();
    release(null);
    await Promise.all([first, clear1, second, clear2]);
    expect(await storage.eventCount()).toBe(0);
    expect((storage as unknown as { pendingStoreBytes: number }).pendingStoreBytes).toBe(0);
  });


  it('invalidates an old adapter before late hydration can resurrect cleared events', async () => {
    let release!: (value: string | null) => void;
    mockRead.mockImplementationOnce(() => new Promise<string | null>((resolve) => { release = resolve; }));
    mockRead.mockResolvedValue(null);
    const old = new AsyncStorageEventStorage();
    const pending = old.store(event('abandoned'));
    await Promise.resolve();
    invalidateEventStorage(old);
    const current = new AsyncStorageEventStorage();
    await current.clear();
    await current.store({ ...event('current'), name: 'current' });
    release(null);
    await pending;
    const writes = mockSet.mock.calls.map(([, entry]) => entry as string);
    expect(JSON.parse(writes[writes.length - 1]!)).toEqual([expect.objectContaining({ name: 'current' })]);
    expect(await old.eventCount()).toBe(0);
  });

  it('drops oversized durable queues before parsing and ignores cyclic or excessive payloads', async () => {
    mockRead.mockResolvedValueOnce(' '.repeat(1024 * 1024));
    const storage = new AsyncStorageEventStorage();
    expect(await storage.eventCount()).toBe(0);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await storage.store({ ...event(), properties: cycle as never });
    await storage.store(event('x'.repeat(1000000)));
    expect(await storage.eventCount()).toBe(0);
  });
});
