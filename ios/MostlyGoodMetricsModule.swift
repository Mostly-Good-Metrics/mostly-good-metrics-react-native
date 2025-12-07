import Foundation
import MostlyGoodMetrics

@objc(MostlyGoodMetricsModule)
class MostlyGoodMetricsModule: NSObject {

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func configure(_ apiKey: String, options: NSDictionary) {
        var config = MGMConfiguration(apiKey: apiKey)

        if let baseURL = options["baseURL"] as? String, let url = URL(string: baseURL) {
            config = MGMConfiguration(
                apiKey: apiKey,
                baseURL: url,
                environment: options["environment"] as? String ?? "production",
                bundleId: options["bundleId"] as? String,
                maxBatchSize: options["maxBatchSize"] as? Int ?? 100,
                flushInterval: options["flushInterval"] as? TimeInterval ?? 30,
                maxStoredEvents: options["maxStoredEvents"] as? Int ?? 10000,
                enableDebugLogging: options["enableDebugLogging"] as? Bool ?? false,
                trackAppLifecycleEvents: options["trackAppLifecycleEvents"] as? Bool ?? true
            )
        } else {
            config = MGMConfiguration(
                apiKey: apiKey,
                environment: options["environment"] as? String ?? "production",
                bundleId: options["bundleId"] as? String,
                maxBatchSize: options["maxBatchSize"] as? Int ?? 100,
                flushInterval: options["flushInterval"] as? TimeInterval ?? 30,
                maxStoredEvents: options["maxStoredEvents"] as? Int ?? 10000,
                enableDebugLogging: options["enableDebugLogging"] as? Bool ?? false,
                trackAppLifecycleEvents: options["trackAppLifecycleEvents"] as? Bool ?? true
            )
        }

        MostlyGoodMetrics.configure(with: config)
    }

    @objc
    func track(_ name: String, properties: NSDictionary?) {
        let props = properties as? [String: Any]
        MostlyGoodMetrics.track(name, properties: props)
    }

    @objc
    func identify(_ userId: String) {
        MostlyGoodMetrics.identify(userId: userId)
    }

    @objc
    func resetIdentity() {
        MostlyGoodMetrics.shared?.resetIdentity()
    }

    @objc
    func flush() {
        MostlyGoodMetrics.flush()
    }

    @objc
    func startNewSession() {
        MostlyGoodMetrics.shared?.startNewSession()
    }

    @objc
    func clearPendingEvents() {
        MostlyGoodMetrics.shared?.clearPendingEvents()
    }

    @objc
    func getPendingEventCount(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let count = MostlyGoodMetrics.shared?.pendingEventCount ?? 0
        resolve(count)
    }
}
