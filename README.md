# MostlyGoodMetrics React Native SDK

A lightweight React Native SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [User Identification](#user-identification)
- [Tracking Events](#tracking-events)
- [Event Naming](#event-naming)
- [Properties](#properties)
- [Automatic Events](#automatic-events)
- [Automatic Properties](#automatic-properties)
- [Automatic Context](#automatic-context)
- [Automatic Behavior](#automatic-behavior)
- [Framework Integration](#framework-integration)
- [Manual Flush](#manual-flush)
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

## Tracking Events

Track events with the `track()` method:

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

| Property | Description | Example | Source |
|----------|-------------|---------|--------|
| `$device_type` | Device form factor | `phone`, `tablet` | iOS: Detected from `Platform.isPad`<br>Android: Always `phone` (can be enhanced with device dimensions) |
| `$storage_type` | Event persistence method | `persistent`, `memory` | `persistent` when AsyncStorage is available,<br>`memory` otherwise |

### Additional Event-Level Fields

These fields are included at the event level (not in properties):

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `osVersion` | Device OS version | `17.2` (iOS)<br>`31` (Android SDK) | `Platform.Version` |
| `appVersion` | App version (if configured) | `1.2.0` | Configuration option |
| `platform` | Platform identifier | `ios`, `android` | `Platform.OS` |
| `sdk` | SDK identifier | `react-native` | Hardcoded |
| `sdkVersion` | SDK version | `0.3.6` | Package version |

## Automatic Context

The SDK automatically includes these fields with every event to provide rich context:

### Identity & Session

| Field | Description | Example | Persistence |
|-------|-------------|---------|-------------|
| `userId` | Identified user ID (set via `identify()`) | `user_123` | Persisted in AsyncStorage (survives app restarts) |
| `distinctId` | Anonymous UUID (auto-generated) | `550e8400-e29b-41d4-a716-446655440000` | Persisted in AsyncStorage (survives app restarts) |
| `sessionId` | UUID generated per app launch | `abc123-def456` | Regenerated on each app launch |

### Device & Platform

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `platform` | Platform identifier | `ios`, `android` | `Platform.OS` |
| `osVersion` | Device OS version | `17.2` (iOS)<br>`31` (Android SDK version) | `Platform.Version` |
| `locale` | User's locale | `en-US` | JavaScript SDK (from `Intl.DateTimeFormat`) |
| `timezone` | User's timezone | `America/New_York` | JavaScript SDK (from `Intl.DateTimeFormat`) |

### App & Environment

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `appVersion` | App version (if configured) | `1.2.0` | Configuration option |
| `environment` | Environment name | `production`, `staging`, `development` | Configuration option (default: `production`) |
| `sdk` | SDK identifier | `react-native` | Hardcoded |
| `sdkVersion` | SDK version | `0.3.6` | Package version |

### Event Metadata

| Field | Description | Example | Purpose |
|-------|-------------|---------|---------|
| `client_event_id` | Unique UUID for each event | `550e8400-e29b-41d4-a716-446655440000` | Deduplication (prevents processing the same event twice) |
| `timestamp` | ISO 8601 timestamp when event was tracked | `2024-01-15T10:30:00.000Z` | Event ordering and time-based analysis |

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

The SDK handles many tasks automatically to provide a seamless analytics experience:

### Identity Management
- **Generates anonymous user ID**: Creates a persistent UUID (`distinctId`) on first app launch, stored in AsyncStorage
- **Persists identified user ID**: Stores `userId` (from `identify()`) in AsyncStorage, automatically restored on app restart
- **Generates session IDs**: Creates a new UUID on each app launch to track user sessions

### Event Storage & Delivery
- **Persists events**: Stores events in AsyncStorage (with in-memory fallback if AsyncStorage unavailable)
- **Batches events**: Groups events together for efficient network usage (default: 100 events per batch)
- **Flushes on interval**: Automatically sends events every 30 seconds (configurable)
- **Flushes on background**: Sends pending events when app enters background
- **Retries on failure**: Preserves events on network errors and retries with exponential backoff
- **Handles rate limiting**: Automatically backs off when server rate limits are hit
- **Adds deduplication IDs**: Includes unique `client_event_id` with each event to prevent duplicate processing

### Lifecycle Tracking
When `trackAppLifecycleEvents` is enabled (default), the SDK automatically:
- **Detects install**: Tracks `$app_installed` event on first launch (requires `appVersion` config)
- **Detects updates**: Tracks `$app_updated` event when app version changes (requires `appVersion` config)
- **Tracks app foreground**: Fires `$app_opened` when app becomes active
- **Tracks app background**: Fires `$app_backgrounded` when app goes to background
- **Deduplicates lifecycle events**: Ignores duplicate events that fire within 1 second

### Platform Integration
- **Detects device type**: Automatically identifies phone vs tablet (iOS only, Android always reports phone)
- **Captures OS version**: Includes device operating system version with every event
- **Captures locale**: Includes user's language/region setting
- **Captures timezone**: Includes user's timezone for accurate time-based analysis

## Framework Integration

The SDK supports both Expo and Bare React Native projects with slightly different setup requirements.

### Expo (Recommended)

Expo projects work out of the box with **zero additional dependencies**. Expo includes AsyncStorage by default, so events automatically persist across app restarts.

#### Basic Setup

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure('mgm_proj_your_api_key');
```

#### App Version Tracking (Recommended)

To enable install/update detection, use `expo-constants` to access your app version:

```bash
npx expo install expo-constants
```

```typescript
import Constants from 'expo-constants';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: Constants.expoConfig?.version, // Enables $app_installed and $app_updated events
});
```

#### Build-Time Configuration

For better security, configure the API key at build time using `app.json`:

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

Then access it via `expo-constants`:

```typescript
import Constants from 'expo-constants';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure(Constants.expoConfig?.extra?.mgmApiKey, {
  appVersion: Constants.expoConfig?.version,
});
```

**Note:** The API key in `extra` is not secure - it's bundled into your app. For production apps, consider using environment-specific builds or Expo's EAS Secrets.

### Bare React Native

Bare React Native projects require AsyncStorage to be installed separately for event persistence.

#### Installation

```bash
npm install @mostly-good-metrics/react-native @react-native-async-storage/async-storage
cd ios && pod install
```

#### Setup

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';
import { version } from './package.json';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: version, // Use your package.json version
});
```

#### Without AsyncStorage (Not Recommended)

The SDK will work without AsyncStorage, but with significant limitations:
- Events are stored **in memory only** (lost on app restart)
- User identity (`userId`, `distinctId`) is **not persisted** (new anonymous ID on each launch)
- Install/update detection **will not work**

For production apps, **always install AsyncStorage** to ensure reliable analytics.

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

The SDK includes an example Expo app demonstrating all features.

### Prerequisites

- Node.js 16+ and npm
- For iOS: macOS with Xcode installed
- For Android: Android Studio with an emulator configured

### Setup

1. Navigate to the example directory:

```bash
cd example
```

2. Install dependencies:

```bash
npm install
```

### Running on iOS

```bash
npm run ios
```

This will:
- Start the Metro bundler
- Launch the iOS Simulator
- Install and run the example app

**Troubleshooting:** If you get a CocoaPods error, try:
```bash
cd ios && pod install && cd ..
npm run ios
```

### Running on Android

```bash
npm run android
```

This will:
- Start the Metro bundler
- Launch your Android emulator (if not already running)
- Install and run the example app

**Troubleshooting:** If you get a "No connected devices" error, start an emulator first:
```bash
# List available emulators
emulator -list-avds

# Start an emulator (replace with your emulator name)
emulator -avd Pixel_5_API_31
```

### What the Example Demonstrates

The example app includes:
- SDK initialization with configuration
- User identification and reset
- Tracking custom events with properties
- Automatic lifecycle event tracking
- Manual flush trigger
- Pending event count display
- Debug logging output

Check the Metro bundler console to see the SDK's debug output as you interact with the app.

## License

MIT
