# MostlyGoodMetrics React Native SDK

A lightweight React Native SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Requirements

- React Native 0.71+
- Expo SDK 49+ (if using Expo)

## Installation

```bash
npm install react-native-mostly-good-metrics @react-native-async-storage/async-storage
# or
yarn add react-native-mostly-good-metrics @react-native-async-storage/async-storage
```

For iOS with bare React Native (not Expo):

```bash
cd ios && pod install
```

That's it! No native code configuration needed.

## Quick Start

### 1. Initialize the SDK

Initialize once at app startup:

```typescript
import MostlyGoodMetrics from 'react-native-mostly-good-metrics';

MostlyGoodMetrics.configure('mgm_proj_your_api_key');
```

### 2. Track Events

```typescript
// Simple event
MostlyGoodMetrics.track('button_clicked');

// Event with properties
MostlyGoodMetrics.track('purchase_completed', {
  product_id: 'SKU123',
  price: 29.99,
  currency: 'USD',
});
```

### 3. Identify Users

```typescript
// Set user identity
MostlyGoodMetrics.identify('user_123');

// Reset identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

That's it! Events are automatically batched and sent.

## Configuration Options

For more control, pass a configuration object:

```typescript
import { version } from './package.json'; // Or use expo-constants

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  baseURL: 'https://mostlygoodmetrics.com',
  environment: 'production',
  appVersion: version, // Required for install/update tracking
  maxBatchSize: 100,
  flushInterval: 30,
  maxStoredEvents: 10000,
  enableDebugLogging: __DEV__,
  trackAppLifecycleEvents: true,
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `baseURL` | `https://mostlygoodmetrics.com` | API endpoint |
| `environment` | `"production"` | Environment name |
| `appVersion` | - | App version string (required for install/update tracking) |
| `maxBatchSize` | `100` | Events per batch (1-1000) |
| `flushInterval` | `30` | Auto-flush interval in seconds |
| `maxStoredEvents` | `10000` | Max cached events |
| `enableDebugLogging` | `false` | Enable console output |
| `trackAppLifecycleEvents` | `true` | Auto-track lifecycle events |

**Note:** The SDK automatically detects and includes the OS version (e.g., "15.0" for iOS, SDK version for Android) with every event.

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App became active (foreground) | - |
| `$app_backgrounded` | App resigned active (background) | - |

## Event Naming

Event names must:
- Start with a letter (or `$` for system events)
- Contain only alphanumeric characters and underscores
- Be 255 characters or less

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');
MostlyGoodMetrics.track('PurchaseCompleted');
MostlyGoodMetrics.track('step_1_completed');

// Invalid (will be ignored)
MostlyGoodMetrics.track('123_event');      // starts with number
MostlyGoodMetrics.track('event-name');     // contains hyphen
MostlyGoodMetrics.track('event name');     // contains space
```

## Properties

Events support various property types:

```typescript
MostlyGoodMetrics.track('checkout', {
  string_prop: 'value',
  int_prop: 42,
  double_prop: 3.14,
  bool_prop: true,
  null_prop: null,
  list_prop: ['a', 'b', 'c'],
  nested: {
    key: 'value',
  },
});
```

**Limits:**
- String values: truncated to 1000 characters
- Nesting depth: max 3 levels
- Total properties size: max 10KB

## Manual Flush

Events are automatically flushed periodically and when the app backgrounds. You can also trigger a manual flush:

```typescript
MostlyGoodMetrics.flush();
```

To check pending events:

```typescript
const count = await MostlyGoodMetrics.getPendingEventCount();
console.log(`${count} events pending`);
```

## Automatic Behavior

The SDK automatically:

- **Persists events** to AsyncStorage, surviving app restarts
- **Batches events** for efficient network usage
- **Flushes on interval** (default: every 30 seconds)
- **Flushes on background** when the app goes to background
- **Retries on failure** for network errors (events are preserved)
- **Persists user ID** across app launches
- **Generates session IDs** per app launch

## Debug Logging

Enable debug logging to see SDK activity:

```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  enableDebugLogging: true,
});
```

Output example:
```
[MostlyGoodMetrics] Configuring with options: {...}
[MostlyGoodMetrics] Setting up lifecycle tracking
[MostlyGoodMetrics] App opened (foreground)
[MostlyGoodMetrics] Flushing events
```

## Running the Example

```bash
cd example
npm install
```

For iOS:

```bash
cd ios && pod install && cd ..
npm run ios
```

For Android:

```bash
npm run android
```

## License

MIT
