#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MostlyGoodMetricsModule, NSObject)

RCT_EXTERN_METHOD(configure:(NSString *)apiKey options:(NSDictionary *)options)

RCT_EXTERN_METHOD(track:(NSString *)name properties:(NSDictionary *)properties)

RCT_EXTERN_METHOD(identify:(NSString *)userId)

RCT_EXTERN_METHOD(resetIdentity)

RCT_EXTERN_METHOD(flush)

RCT_EXTERN_METHOD(startNewSession)

RCT_EXTERN_METHOD(clearPendingEvents)

RCT_EXTERN_METHOD(getPendingEventCount:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

@end
