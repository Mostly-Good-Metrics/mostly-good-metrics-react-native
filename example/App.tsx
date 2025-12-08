import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable, Alert } from 'react-native';
import MostlyGoodMetrics from '@mostly-good-metrics/react-native';

export default function App() {
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    // Initialize the SDK
    MostlyGoodMetrics.configure('mgm_proj_NF1tdRCO6C5MjyGdBd40fboZ3jm9KJiO', {
      appVersion: '1.0.0',
      enableDebugLogging: true,
    });

    // Identify a test user
    MostlyGoodMetrics.identify('test-user-123');
  }, []);

  const trackEvent = () => {
    const count = eventCount + 1;
    setEventCount(count);
    MostlyGoodMetrics.track('button_pressed', {
      button_name: 'track_event',
      press_count: count,
    });
    Alert.alert('Tracked', `button_pressed (count: ${count})`);
  };

  const trackPurchase = () => {
    MostlyGoodMetrics.track('purchase_completed', {
      product_id: 'sku_123',
      price: 29.99,
      currency: 'USD',
    });
    Alert.alert('Tracked', 'purchase_completed');
  };

  const trackSignUp = () => {
    MostlyGoodMetrics.track('sign_up_completed', {
      method: 'email',
      referral_source: 'organic',
    });
    Alert.alert('Tracked', 'sign_up_completed');
  };

  const trackAddToCart = () => {
    MostlyGoodMetrics.track('add_to_cart', {
      product_id: 'prod_456',
      product_name: 'Premium Widget',
      quantity: 1,
      price: 49.99,
    });
    Alert.alert('Tracked', 'add_to_cart');
  };

  const trackSearch = () => {
    MostlyGoodMetrics.track('search_performed', {
      query: 'react native analytics',
      results_count: 42,
      filters_applied: ['category', 'price'],
    });
    Alert.alert('Tracked', 'search_performed');
  };

  const trackFeatureUsed = () => {
    MostlyGoodMetrics.track('feature_used', {
      feature_name: 'dark_mode',
      enabled: true,
      source: 'settings',
    });
    Alert.alert('Tracked', 'feature_used');
  };

  const flushEvents = async () => {
    MostlyGoodMetrics.flush();
    const count = await MostlyGoodMetrics.getPendingEventCount();
    Alert.alert('Flushed', `Pending events: ${count}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MostlyGoodMetrics</Text>
      <Text style={styles.subtitle}>React Native Example</Text>

      <View style={styles.buttonContainer}>
        <Pressable style={styles.button} onPress={trackEvent}>
          <Text style={styles.buttonText}>Track Event ({eventCount})</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={trackPurchase}>
          <Text style={styles.buttonText}>Purchase</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={trackSignUp}>
          <Text style={styles.buttonText}>Sign Up</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={trackAddToCart}>
          <Text style={styles.buttonText}>Add to Cart</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={trackSearch}>
          <Text style={styles.buttonText}>Search</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={trackFeatureUsed}>
          <Text style={styles.buttonText}>Feature Used</Text>
        </Pressable>

        <Pressable style={[styles.button, styles.flushButton]} onPress={flushEvents}>
          <Text style={styles.buttonText}>Flush Events</Text>
        </Pressable>
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  flushButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
