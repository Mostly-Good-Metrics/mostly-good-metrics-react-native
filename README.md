# MostlyGoodMetrics React Native SDK

A lightweight React Native SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Requirements

- React Native 0.71+
- Expo SDK 49+ (if using Expo)

## Installation

### Expo (Recommended)

```bash
npm install @mostly-good-metrics/react-native
```

That's it! Expo includes AsyncStorage by default, so events persist across app restarts.

### Bare React Native

```bash
npm install @mostly-good-metrics/react-native @react-native-async-storage/async-storage
cd ios && pod install
```

**Note:** AsyncStorage is optional. Without it, events are stored in memory only (lost on app restart).

## Quick Start

### 1. Initialize the SDK

Initialize once at app startup:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

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
| `baseURL` | `https://mostlygoodmetrics.com` | API endpoint for sending events |
| `environment` | `"production"` | Environment name included with all events |
| `appVersion` | - | App version string (required for install/update tracking) |
| `maxBatchSize` | `100` | Maximum events per batch (range: 1-1000) |
| `flushInterval` | `30` | Auto-flush interval in seconds |
| `maxStoredEvents` | `10000` | Maximum events to cache locally before dropping oldest |
| `enableDebugLogging` | `false` | Enable console output for debugging |
| `trackAppLifecycleEvents` | `true` | Automatically track app lifecycle events |

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App became active (foreground) | - |
| `$app_backgrounded` | App resigned active (background) | - |

## Automatic Context/Properties

Every event automatically includes:

| Field | Example | Description |
|-------|---------|-------------|
| `platform` | `"ios"` | Platform (ios, android) |
| `os_version` | `"17.1"` | Operating system version (iOS version string or Android SDK level) |
| `app_version` | `"1.0.0"` | App version (if configured via `appVersion` option) |
| `environment` | `"production"` | Environment from configuration |
| `session_id` | `"uuid..."` | Unique session ID (generated per app launch) |
| `user_id` | `"user_123"` | User ID (if set via `identify()`) |
| `anonymous_id` | `"uuid..."` | Anonymous ID (generated if no user identified) |
| `$device_type` | `"phone"` | Device type (phone, tablet) |
| `$storage_type` | `"persistent"` | Storage type (persistent with AsyncStorage, or memory without) |
| `sdk` | `"react-native"` | SDK identifier |
| `sdk_version` | `"0.3.6"` | SDK version |

> **Note:** The `$` prefix indicates reserved system properties. Avoid using `$` prefix for your own custom properties.

## Event Naming

Event names must follow these rules:
1. Start with a letter (a-z, A-Z)
2. Contain only alphanumeric characters (a-z, A-Z, 0-9) and underscores (_)
3. Be 255 characters or less

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');      // lowercase with underscores
MostlyGoodMetrics.track('PurchaseCompleted');   // camelCase
MostlyGoodMetrics.track('step_1_completed');    // numbers allowed after first char

// Invalid (will be rejected)
MostlyGoodMetrics.track('123_event');           // starts with number
MostlyGoodMetrics.track('event-name');          // contains hyphen
MostlyGoodMetrics.track('event name');          // contains space
```

> **Note:** The `$` prefix is reserved for system events (e.g., `$app_opened`). Do not use `$` prefix for your own event names.

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

## User Identification

The SDK provides methods for identifying users and managing their identity:

```typescript
// Set user identity
MostlyGoodMetrics.identify('user_123');

// Reset identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

### Anonymous ID

When no user is identified, the SDK generates an anonymous ID to track events consistently across sessions. This anonymous ID is persisted to AsyncStorage (if available) and survives app restarts.

When you call `identify()`:
- The user ID is stored and persisted to AsyncStorage
- All subsequent events include this user ID
- The user ID is restored automatically on app restart

When you call `resetIdentity()`:
- The stored user ID is cleared
- A new anonymous ID is generated
- Use this when users log out to ensure clean session separation

**Note:** Without AsyncStorage, anonymous IDs and user IDs are stored in memory only and will not persist across app restarts.

## Super Properties

Super properties are automatically included with every event you track. Use them for data that should be attached to all events, like subscription tier or A/B test variants:

```typescript
// Set a single super property
MostlyGoodMetrics.setSuperProperty('subscription_tier', 'premium');

// Set multiple super properties at once
MostlyGoodMetrics.setSuperProperties({
  subscription_tier: 'premium',
  ab_variant: 'control',
});

// Remove a super property
MostlyGoodMetrics.removeSuperProperty('ab_variant');

// Clear all super properties
MostlyGoodMetrics.clearSuperProperties();

// Get current super properties
const props = MostlyGoodMetrics.getSuperProperties();
```

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

To clear all pending events without sending them:

```typescript
MostlyGoodMetrics.clearPendingEvents();
```

## Automatic Behavior

The SDK automatically:

- **Persists events** to AsyncStorage, surviving app restarts
- **Batches events** for efficient network usage
- **Flushes on interval** (default: every 30 seconds)
- **Flushes on background** when the app goes to background
- **Compresses payloads** using gzip for requests > 1KB
- **Retries on failure** for network errors (events are preserved)
- **Handles rate limiting** with exponential backoff
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

The example app demonstrates all SDK features and is built with Expo.

### Expo (Recommended)

```bash
cd example
npm install
npm start
```

Then press `i` for iOS simulator or `a` for Android emulator.

To run directly on a specific platform:

```bash
npm run ios      # iOS simulator
npm run android  # Android emulator
```

### Bare React Native

If you've ejected from Expo or are using a bare React Native project, you'll need to install CocoaPods for iOS:

```bash
cd example
npm install
cd ios && pod install && cd ..
npm run ios
```

For Android, just run:

```bash
npm run android
```

The example app includes buttons to test tracking events, identifying users, and resetting identity.

## License

MIT
