# react-native-mostly-good-metrics

React Native SDK for MostlyGoodMetrics analytics.

## Installation

```bash
npm install react-native-mostly-good-metrics
# or
yarn add react-native-mostly-good-metrics
```

### iOS

```bash
cd ios && pod install
```

### Android

Add JitPack to your project's `android/build.gradle`:

```gradle
allprojects {
    repositories {
        // ... other repos
        maven { url 'https://jitpack.io' }
    }
}
```

## Usage

### Initialize

```typescript
import MostlyGoodMetrics from 'react-native-mostly-good-metrics';

// Simple initialization
MostlyGoodMetrics.configure('your-api-key');

// With options
MostlyGoodMetrics.configure('your-api-key', {
  environment: 'staging',
  enableDebugLogging: true,
  trackAppLifecycleEvents: true,
});
```

### Track Events

```typescript
// Simple event
MostlyGoodMetrics.track('button_clicked');

// Event with properties
MostlyGoodMetrics.track('purchase_completed', {
  product_id: 'sku_123',
  price: 29.99,
  currency: 'USD',
});
```

### Identify Users

```typescript
// Set user identity
MostlyGoodMetrics.identify('user-123');

// Clear user identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

### Session Management

```typescript
// Start a new session manually
MostlyGoodMetrics.startNewSession();
```

### Manual Flush

```typescript
// Force send pending events
MostlyGoodMetrics.flush();

// Check pending event count
const count = await MostlyGoodMetrics.getPendingEventCount();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | string | `https://mostlygoodmetrics.com` | API endpoint |
| `environment` | string | `production` | Environment name |
| `bundleId` | string | auto-detected | Bundle/package ID override |
| `maxBatchSize` | number | `100` | Max events per batch (max 1000) |
| `flushInterval` | number | `30` | Seconds between auto-flush |
| `maxStoredEvents` | number | `10000` | Max cached events |
| `enableDebugLogging` | boolean | `false` | Enable debug logs |
| `trackAppLifecycleEvents` | boolean | `true` | Auto-track lifecycle events |

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), these events are tracked automatically:

- `$app_installed` - First app launch
- `$app_updated` - App version changed
- `$app_opened` - App came to foreground
- `$app_backgrounded` - App went to background

## License

MIT
