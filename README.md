# MostlyGoodMetrics React Native SDK

A lightweight React Native SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [User Identification](#user-identification)
- [Configuration Options](#configuration-options)
- [Automatic Events](#automatic-events)
- [Automatic Properties](#automatic-properties)
- [Automatic Context](#automatic-context)
- [Event Naming](#event-naming)
- [Properties](#properties)
- [Manual Flush](#manual-flush)
- [Automatic Behavior](#automatic-behavior)
- [Framework Integration](#framework-integration)
- [Debug Logging](#debug-logging)
- [Running the Example](#running-the-example)
- [License](#license)

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
// Set user identity (optional - anonymous ID is auto-generated)
MostlyGoodMetrics.identify('user_123');

// Reset identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

That's it! Events are automatically batched and sent.

## User Identification

The SDK automatically generates and persists an anonymous `distinctId` (UUID) for each user. This ID:
- Is auto-generated on first app launch
- Persists across app sessions (stored in AsyncStorage)
- Is included in every event as `distinctId`

When you call `identify()`, the identified user ID is stored as `userId` and also persists across sessions.

```typescript
// Before identify(): userId = null, distinctId = "550e8400-e29b-41d4-a716-446655440000" (auto-generated)
MostlyGoodMetrics.identify('user_123');
// After identify(): userId = "user_123", distinctId = "550e8400-e29b-41d4-a716-446655440000"

MostlyGoodMetrics.resetIdentity();
// After reset: userId = null, distinctId = "550e8400-e29b-41d4-a716-446655440000" (unchanged)
```

This dual-ID approach lets you:
- Track anonymous users before login via `distinctId`
- Associate events with known users via `userId`
- Link pre-login and post-login behavior for the same user

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

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App became active (foreground) | - |
| `$app_backgrounded` | App resigned active (background) | - |

> **Note:** Install and update detection require `appVersion` to be configured.

## Automatic Properties

The SDK automatically includes these properties with every event:

| Property | Description | Example |
|----------|-------------|---------|
| `$device_type` | Device form factor | `phone`, `tablet` |
| `$storage_type` | Event persistence method | `persistent`, `memory` |

Additionally, `osVersion` and `appVersion` (if configured) are included at the event level.

## Automatic Context

The SDK automatically includes these fields with every event:

| Field | Description | Example |
|-------|-------------|---------|
| `client_event_id` | Unique UUID for each event (for deduplication) | `550e8400-e29b-41d4-a716-446655440000` |
| `timestamp` | ISO 8601 timestamp when event was tracked | `2024-01-15T10:30:00.000Z` |
| `userId` | Identified user ID (set via `identify()`) | `user_123` |
| `distinctId` | Anonymous UUID (auto-generated, persisted) | `550e8400-e29b-41d4-a716-446655440000` |
| `sessionId` | UUID generated per app launch | `abc123-def456` |
| `platform` | Platform identifier | `ios`, `android` |
| `environment` | Environment name (default: `production`) | `production`, `staging` |
| `osVersion` | Device OS version | `17.2` |
| `appVersion` | App version (if configured) | `1.2.0` |
| `locale` | User's locale | `en-US` |
| `timezone` | User's timezone | `America/New_York` |

## Event Naming

Event names must:
- Start with a letter (or `$` for system events)
- Contain only alphanumeric characters and underscores
- Be 255 characters or less

> **Reserved `$` prefix:** Event names starting with `$` are reserved for SDK system events (e.g., `$app_opened`, `$app_installed`). Do not use the `$` prefix for your own events.

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');
MostlyGoodMetrics.track('PurchaseCompleted');
MostlyGoodMetrics.track('step_1_completed');

// Invalid (will be ignored)
MostlyGoodMetrics.track('123_event');      // starts with number
MostlyGoodMetrics.track('event-name');     // contains hyphen
MostlyGoodMetrics.track('event name');     // contains space
MostlyGoodMetrics.track('$custom_event');  // $ prefix is reserved
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

- **Generates anonymous user ID** (UUID, persisted in AsyncStorage)
- **Persists events** to AsyncStorage (with in-memory fallback)
- **Batches events** for efficient network usage
- **Flushes on interval** (default: every 30 seconds)
- **Flushes on background** when the app enters the background
- **Retries on failure** for network errors (events are preserved)
- **Handles rate limiting** with exponential backoff
- **Persists identified user ID** across app launches
- **Generates session IDs** per app launch
- **Adds deduplication IDs** to prevent duplicate event processing
- **Detects install/update** when `appVersion` is configured
- **Tracks lifecycle events** (`$app_opened`, `$app_backgrounded`) when enabled

## Framework Integration

### Expo

Expo projects require no additional configuration. The SDK works out of the box.

For automatic app version tracking, use `expo-constants`:

```typescript
import Constants from 'expo-constants';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: Constants.expoConfig?.version,
});
```

To configure the SDK at build time, add to your `app.json`:

```json
{
  "expo": {
    "name": "MyApp",
    "version": "1.0.0",
    "extra": {
      "mgmApiKey": "mgm_proj_your_api_key"
    }
  }
}
```

Then access via `expo-constants`:

```typescript
import Constants from 'expo-constants';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure(Constants.expoConfig?.extra?.mgmApiKey, {
  appVersion: Constants.expoConfig?.version,
});
```

### Bare React Native

Ensure AsyncStorage is installed for event persistence:

```bash
npm install @react-native-async-storage/async-storage
cd ios && pod install
```

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
