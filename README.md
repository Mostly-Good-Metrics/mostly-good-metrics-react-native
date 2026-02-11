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
- [Debug Logging](#debug-logging)
- [Framework Integration](#framework-integration)
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

The SDK uses a **dual-ID system** to track both anonymous and identified users seamlessly.

### Anonymous Tracking (`distinctId`)

Every user automatically gets a persistent anonymous ID called `distinctId`:
- **Auto-generated**: Created as a UUID on first app launch
- **Persists forever**: Stored in AsyncStorage, survives app restarts
- **Always present**: Included in every event, even before `identify()` is called
- **Never changes**: Remains the same even after `identify()` or `resetIdentity()`

### Identified Users (`userId`)

When a user logs in or creates an account, call `identify()` to associate events with a known user:

```typescript
MostlyGoodMetrics.identify('user_123');
```

This sets the `userId` field which:
- **Persists across sessions**: Stored in AsyncStorage, restored on app restart
- **Complements distinctId**: Both IDs are sent with every event
- **Survives logout**: Cleared only when you call `resetIdentity()`

### How It Works

```typescript
// Initial state (anonymous user)
// userId: null
// distinctId: "550e8400-e29b-41d4-a716-446655440000" (auto-generated)

// User logs in
MostlyGoodMetrics.identify('user_123');
// userId: "user_123"
// distinctId: "550e8400-e29b-41d4-a716-446655440000" (unchanged)

// User logs out
MostlyGoodMetrics.resetIdentity();
// userId: null (cleared)
// distinctId: "550e8400-e29b-41d4-a716-446655440000" (unchanged)
```

### Why Two IDs?

This dual-ID approach enables powerful analytics:

1. **Track anonymous users**: Use `distinctId` to follow user behavior before they sign up
2. **Track identified users**: Use `userId` to associate events with known accounts
3. **Link pre/post-login behavior**: Since `distinctId` never changes, you can connect a user's anonymous activity to their identified account
4. **Handle multiple devices**: Same user on different devices gets different `distinctId` but same `userId`

### Best Practices

- **Call `identify()` on login**: As soon as a user authenticates, call `identify()` with their user ID
- **Call `resetIdentity()` on logout**: Clear the `userId` to stop associating events with the logged-out user
- **Use stable user IDs**: Pass your internal user ID (database primary key, UUID, etc.) to `identify()` - not email addresses which can change

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

| Property | Description | Example | Source |
|----------|-------------|---------|--------|
| `$device_type` | Device form factor | `phone`, `tablet` | iOS: Detected from `Platform.isPad`<br>Android: Always `phone` (can be enhanced with device dimensions) |
| `$device_model` | Device model identifier | `iPhone15,2` (iOS)<br>`Pixel 8` (Android) | iOS: Hardware identifier via native modules<br>Android: `Build.MODEL` |
| `$storage_type` | Event persistence method | `persistent`, `memory` | `persistent` when AsyncStorage is available,<br>`memory` otherwise |

> **Note:** Properties with the `$` prefix are reserved for system use. Do not use the `$` prefix for your own custom properties.

## Automatic Context

Every event automatically includes the following context fields to provide rich analytics capabilities:

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
| `deviceManufacturer` | Device manufacturer | `Apple` (iOS)<br>`Google` (Android) | iOS: Always "Apple"<br>Android: `Build.MANUFACTURER` |
| `locale` | User's locale | `en-US`, `fr-FR` | `Intl.DateTimeFormat().resolvedOptions().locale` |
| `timezone` | User's timezone | `America/New_York`, `Europe/Paris` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |

### App & Environment

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `appVersion` | App version (if configured) | `1.2.0` | Configuration option (recommended: from `package.json` or `expo-constants`) |
| `appBuildNumber` | App build number (if available) | `42` | Optional: Can be set via configuration |
| `environment` | Environment name | `production`, `staging`, `development` | Configuration option (default: `production`) |
| `sdk` | SDK identifier | `react-native` | Hardcoded |
| `sdkVersion` | SDK version | `0.3.6` | Package version |

### Event Metadata

| Field | Description | Example | Purpose |
|-------|-------------|---------|---------|
| `client_event_id` | Unique UUID for each event | `550e8400-e29b-41d4-a716-446655440000` | Deduplication (prevents processing the same event twice) |
| `timestamp` | ISO 8601 timestamp when event was tracked | `2024-01-15T10:30:00.000Z` | Event ordering and time-based analysis |

> **Note:** Fields are automatically included with every event. You don't need to manually add any of these fields.

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
MostlyGoodMetrics.track('$custom_event');  // $ prefix is reserved
```

> **Note:** Event names starting with `$` are reserved for SDK system events (e.g., `$app_opened`, `$app_installed`). Do not use the `$` prefix for your own events.

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

The SDK handles many tasks automatically to provide a seamless analytics experience. You don't need to manually manage any of these features - they work out of the box.

### Identity Management

- **Generates anonymous user ID**: Creates a persistent UUID (`distinctId`) on first app launch, stored in AsyncStorage (or memory if AsyncStorage unavailable)
- **Persists identified user ID**: Stores `userId` (from `identify()`) in AsyncStorage, automatically restored on app restart
- **Generates session IDs**: Creates a new UUID on each app launch to track user sessions
- **Handles identity reset**: Clears `userId` but preserves `distinctId` when `resetIdentity()` is called (useful for logout flows)

### Event Storage & Delivery

- **Persists events**: Stores events in AsyncStorage for durability across app restarts (with in-memory fallback if AsyncStorage unavailable)
- **Batches events**: Groups events together for efficient network usage (default: 100 events per batch, configurable via `maxBatchSize`)
- **Flushes on interval**: Automatically sends events every 30 seconds (configurable via `flushInterval`)
- **Flushes on background**: Sends pending events when app enters background to ensure data is captured even if app is killed
- **Retries on failure**: Preserves events on network errors and retries with exponential backoff (2s, 4s, 8s, etc.)
- **Handles rate limiting**: Automatically backs off when server rate limits are hit (HTTP 429 responses)
- **Adds deduplication IDs**: Includes unique `client_event_id` with each event to prevent duplicate processing on the server
- **Enforces event limits**: Caps stored events at `maxStoredEvents` (default: 10,000) to prevent unbounded storage growth

### Lifecycle Tracking

When `trackAppLifecycleEvents` is enabled (default: `true`), the SDK automatically tracks app lifecycle events using React Native's `AppState` API:

#### Install Detection
- **Event**: `$app_installed`
- **When**: First launch after install (determined by absence of stored version)
- **Properties**: `$version` (current app version)
- **Requires**: `appVersion` configuration option

#### Update Detection
- **Event**: `$app_updated`
- **When**: First launch after version change (compares stored version with current)
- **Properties**: `$version` (new version), `$previous_version` (old version)
- **Requires**: `appVersion` configuration option

#### App Foreground
- **Event**: `$app_opened`
- **When**: App state changes to "active" (user returns to app or launches it)
- **Frequency**: Can fire multiple times per session (e.g., after backgrounding and returning)
- **Deduplication**: Ignores duplicate events within 1 second

#### App Background
- **Event**: `$app_backgrounded`
- **When**: App state changes from "active" to "background" or "inactive"
- **Behavior**: Automatically triggers a flush to ensure events are sent before app suspension
- **Deduplication**: Ignores duplicate events within 1 second

> **Note:** Install and update detection require `appVersion` to be configured. Without it, these events will not fire.

### Platform Integration

- **Detects device type**: Automatically identifies phone vs tablet based on device form factor
  - iOS: Uses `Platform.isPad` to detect iPads
  - Android: Always reports `phone` (tablet detection can be added via screen dimensions if needed)
- **Captures OS version**: Includes device operating system version with every event via `Platform.Version`
  - iOS: Returns semantic version (e.g., "17.2")
  - Android: Returns SDK version number (e.g., "31" for Android 12)
- **Captures locale**: Includes user's language/region setting via JavaScript `Intl` API (e.g., "en-US", "fr-FR")
- **Captures timezone**: Includes user's timezone for accurate time-based analysis via JavaScript `Intl` API (e.g., "America/New_York")
- **Captures device manufacturer**: Includes device manufacturer for device analytics
  - iOS: Always "Apple"
  - Android: From `Build.MANUFACTURER` (e.g., "Google", "Samsung")

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

## Framework Integration

The SDK supports both Expo and Bare React Native projects. Choose the setup that matches your project type.

### Expo (Recommended)

Expo projects provide the **easiest setup** with zero additional dependencies. Expo includes AsyncStorage by default in the managed workflow, so events automatically persist across app restarts.

#### Why Expo?

- ✅ **No additional dependencies** - AsyncStorage is built-in
- ✅ **Easy version management** - Access app version via `expo-constants`
- ✅ **Simple configuration** - Use `app.json` for environment-specific settings
- ✅ **Works with all Expo workflows** - Managed, bare, and custom dev clients

#### Basic Setup

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure('mgm_proj_your_api_key');
```

That's it! Events will be tracked and persisted automatically.

#### App Version Tracking (Recommended)

To enable automatic install/update detection (`$app_installed` and `$app_updated` events), add `expo-constants`:

```bash
npx expo install expo-constants
```

Then configure with your app version:

```typescript
import Constants from 'expo-constants';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: Constants.expoConfig?.version, // e.g., "1.2.0" from app.json
  environment: __DEV__ ? 'development' : 'production',
});
```

The version is read from your `app.json`:

```json
{
  "expo": {
    "name": "MyApp",
    "version": "1.2.0"
  }
}
```

#### Build-Time Configuration (Expo)

For cleaner code and environment-specific configuration, store your API key in `app.json`:

```json
{
  "expo": {
    "name": "MyApp",
    "version": "1.2.0",
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

**Security Note:** The `extra` field is bundled into your app JavaScript and is **not secure** - anyone can decompile your app and read it. For production apps, consider:
- Using environment-specific `app.json` files (e.g., `app.production.json`)
- Using [EAS Secrets](https://docs.expo.dev/build-reference/variables/) for API keys
- Implementing server-side event validation

#### Expo Bare Workflow

If you're using Expo's bare workflow, follow the [Bare React Native](#bare-react-native) instructions below since you need to install AsyncStorage manually.

### Bare React Native

Bare React Native projects (created with `react-native init` or Expo bare workflow) require manual installation of AsyncStorage for event persistence.

#### Installation

Install the SDK and AsyncStorage dependency:

```bash
npm install @mostly-good-metrics/react-native @react-native-async-storage/async-storage
```

For iOS, install CocoaPods dependencies:

```bash
cd ios && pod install && cd ..
```

For Android, no additional steps are needed (Gradle handles dependencies automatically).

#### Setup

Initialize the SDK with your app version from `package.json`:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';
import { version } from './package.json';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: version, // e.g., "1.2.0" from package.json
  environment: __DEV__ ? 'development' : 'production',
});
```

#### TypeScript Configuration

If you get TypeScript errors when importing from `package.json`, enable `resolveJsonModule` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "resolveJsonModule": true
  }
}
```

#### Without AsyncStorage (Not Recommended)

The SDK will work without AsyncStorage installed, but with **significant limitations**:

| Feature | With AsyncStorage | Without AsyncStorage |
|---------|------------------|---------------------|
| Event persistence | ✅ Persisted to disk (survives app restarts) | ❌ Memory only (lost on restart) |
| User identity | ✅ Persisted across sessions | ❌ New anonymous ID each launch |
| Install/update detection | ✅ Works correctly | ❌ Broken (can't detect) |
| Session tracking | ✅ Continuous across restarts | ❌ Resets on every restart |
| Production readiness | ✅ Recommended | ❌ **Do not use in production** |

**For production apps, always install AsyncStorage.** Without it, you'll lose critical analytics data and user identity tracking.

### Comparison: Expo vs Bare React Native

| Aspect | Expo | Bare React Native |
|--------|------|-------------------|
| **Setup complexity** | ⭐ Simple (zero dependencies) | ⭐⭐ Moderate (install AsyncStorage) |
| **AsyncStorage** | ✅ Built-in | ❌ Manual install required |
| **App version** | Via `expo-constants` | Via `package.json` import |
| **Configuration** | `app.json` or code | Code only |
| **Pod install (iOS)** | ✅ Handled by Expo | ⚠️ Required manually |
| **Recommended for** | New projects, rapid development | Projects needing native modules |

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
