package com.mostlygoodmetrics.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.mostlygoodmetrics.sdk.MGMConfiguration
import com.mostlygoodmetrics.sdk.MostlyGoodMetrics

class MostlyGoodMetricsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MostlyGoodMetricsModule"

    @ReactMethod
    fun configure(apiKey: String, options: ReadableMap) {
        val builder = MGMConfiguration.Builder(apiKey)

        if (options.hasKey("baseURL")) {
            builder.baseUrl(options.getString("baseURL")!!)
        }
        if (options.hasKey("environment")) {
            builder.environment(options.getString("environment")!!)
        }
        if (options.hasKey("bundleId")) {
            builder.packageName(options.getString("bundleId")!!)
        }
        if (options.hasKey("maxBatchSize")) {
            builder.maxBatchSize(options.getInt("maxBatchSize"))
        }
        if (options.hasKey("flushInterval")) {
            builder.flushIntervalSeconds(options.getInt("flushInterval").toLong())
        }
        if (options.hasKey("maxStoredEvents")) {
            builder.maxStoredEvents(options.getInt("maxStoredEvents"))
        }
        if (options.hasKey("enableDebugLogging")) {
            builder.enableDebugLogging(options.getBoolean("enableDebugLogging"))
        }
        if (options.hasKey("trackAppLifecycleEvents")) {
            builder.trackAppLifecycleEvents(options.getBoolean("trackAppLifecycleEvents"))
        }

        MostlyGoodMetrics.configure(reactApplicationContext, builder.build())
    }

    @ReactMethod
    fun track(name: String, properties: ReadableMap?) {
        val props = properties?.toHashMap()?.mapValues { it.value }
        MostlyGoodMetrics.track(name, props)
    }

    @ReactMethod
    fun identify(userId: String) {
        MostlyGoodMetrics.identify(userId)
    }

    @ReactMethod
    fun resetIdentity() {
        MostlyGoodMetrics.resetIdentity()
    }

    @ReactMethod
    fun flush() {
        MostlyGoodMetrics.flush()
    }

    @ReactMethod
    fun startNewSession() {
        MostlyGoodMetrics.shared?.startNewSession()
    }

    @ReactMethod
    fun clearPendingEvents() {
        MostlyGoodMetrics.shared?.clearPendingEvents()
    }

    @ReactMethod
    fun getPendingEventCount(promise: Promise) {
        val count = MostlyGoodMetrics.shared?.pendingEventCount ?: 0
        promise.resolve(count)
    }
}
