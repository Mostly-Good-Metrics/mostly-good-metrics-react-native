import React, { useEffect, useState } from "react";
import { AppRegistry, Text, View, AppState, NativeModules } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
let MGM;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0,
  sends = 0,
  fetchCalls = 0,
  rateLimited = true,
  deliveryFails = false,
  providerMode = "safe";
const captured = [],
  hostErrors = [],
  lifecycle = [];
const previous = global.ErrorUtils.getGlobalHandler();
global.ErrorUtils.setGlobalHandler((error, fatal) => {
  hostErrors.push(String(error));
  console.error("MGM_RN_HOST_ERROR " + String(error));
  previous(error, fatal);
});
global.fetch = async () => {
  fetchCalls++;
  throw new Error("Offline fixture forbids fetch");
};
const networkClient = {
  isRateLimited: () => rateLimited,
  getRetryAfterTime: () => null,
  sendEvents: async (payload) => {
    sends++;
    if (deliveryFails) throw new Error("offline delivery rejection");
    captured.push(...payload.events);
    return { success: true };
  },
};
function check(condition, message) {
  checks++;
  if (!condition) throw new Error("assertion: " + message);
}
function configure(extra = {}) {
  MGM.configure("offline-rn-host", {
    networkClient,
    maxBatchSize: 1000,
    maxStoredEvents: 200,
    flushInterval: 3600,
    experimentMode: "local",
    localExperiments: [],
    collectDeviceProperties: false,
    appVersion: "offline-test",
    contextProvider: () => {
      if (providerMode === "throw") throw new Error("provider failure");
      if (providerMode === "reject")
        return Promise.reject(new Error("provider async failure"));
      return { safe_context: true };
    },
    ...extra,
  });
}
function App({ rejectionProbe }) {
  const [status, setStatus] = useState("MGM native Hermes smoke running");
  useEffect(() => {
    run(setStatus, rejectionProbe).catch(async (error) => {
      console.error("MGM_RN_FAIL " + String(error));
      setStatus("FAIL " + String(error));
      await AsyncStorage.setItem(
        "mgm_native_host_result",
        JSON.stringify({ pass: false, error: String(error) }),
      );
    });
    return () => MGM?.destroy();
  }, []);
  return React.createElement(
    View,
    { style: { padding: 32 } },
    React.createElement(Text, null, status),
  );
}
async function run(setStatus, rejectionProbe) {
  check(!!global.HermesInternal, "real Hermes runtime");
  check(
    typeof global.HermesInternal.enablePromiseRejectionTracker === "function",
    "production Hermes rejection tracker available",
  );
  // RN enables this automatically only in development. Strict native proof must
  // observe production Hermes rejections too, without replacing fatal handlers.
  global.HermesInternal.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (_id, error) => {
      hostErrors.push(String(error));
      console.error("MGM_RN_HOST_ERROR unhandled rejection: " + String(error));
    },
    onHandled: () => {},
  });
  if (rejectionProbe) {
    Promise.reject(new Error("MGM_RN_REJECTION_DETECTOR_PROBE"));
    await sleep(3000);
    throw new Error(
      "rejection detector failed to observe controlled rejection",
    );
  }
  // Calibration above executes without evaluating any MGM module. Only the
  // positive workload loads the actual candidate wrapper and its storage.
  MGM = require("./candidate/index").default;
  const { getStorageType } = require("./candidate/storage");
  check(!!NativeModules.RNCAsyncStorage, "real native AsyncStorage");
  check(getStorageType() === "persistent", "candidate uses native persistence");
  check(
    typeof NativeModules.AppState.getCurrentAppState === "function",
    "real native AppState",
  );
  await AsyncStorage.clear();
  await AsyncStorage.setItem("mgm_native_probe", "native roundtrip");
  check(
    (await AsyncStorage.getItem("mgm_native_probe")) === "native roundtrip",
    "native SQLite roundtrip",
  );
  const originalSet = AsyncStorage.setItem;
  for (let cycle = 0; cycle < 12; cycle++) {
    rateLimited = true;
    providerMode = "safe";
    configure();
    const mutable = { nested: { value: "before_" + cycle } };
    MGM.track("pre_init_snapshot", mutable);
    mutable.nested.value = "after_" + cycle;
    await MGM.ready();
    await sleep(50);
    MGM.optIn();
    MGM.identify("offline_user_" + cycle, { name: "Offline fixture" });
    MGM.resetIdentity();
    MGM.startNewSession();
    const cyclic = {};
    cyclic.self = cyclic;
    const getter = {};
    Object.defineProperty(getter, "unavailable", {
      enumerable: true,
      get() {
        throw new Error("fixture getter failure");
      },
    });
    getter.readable = true;
    await Promise.all(
      Array.from({ length: 4 }, (_, worker) =>
        Promise.resolve().then(() => {
          for (let i = 0; i < 25; i++)
            MGM.track("parallel_capture", {
              worker,
              i,
              cyclic,
              getter,
              value: ["yes", i],
            });
        }),
      ),
    );
    providerMode = "throw";
    MGM.track("provider_throw");
    providerMode = "reject";
    MGM.track("provider_reject");
    providerMode = "safe";
    if (cycle === 0) {
      AsyncStorage.setItem = async () => {
        throw new Error("native storage decorator rejects");
      };
      MGM.track("storage_failure");
      await sleep(100);
      AsyncStorage.setItem = originalSet;
      MGM.track("storage_recovery");
    }
    await sleep(150);
    const count = await MGM.getPendingEventCount();
    check(count > 0 && count <= 200, "bounded native adapter queue");
    const persisted = await AsyncStorage.getItem("mostlygoodmetrics_events");
    check(
      persisted !== null && Array.isArray(JSON.parse(persisted)),
      "native persisted queue",
    );
    check(persisted.length <= 1024 * 1024, "persisted byte bound");
    rateLimited = false;
    deliveryFails = true;
    await MGM.flush();
    deliveryFails = false;
    MGM.track("recovery_" + cycle);
    await MGM.flush();
    check(
      (await MGM.getPendingEventCount()) === 0,
      "delivery recovers and drains",
    );
    check(
      captured.some(
        (event) =>
          event.name === "pre_init_snapshot" &&
          event.properties?.nested?.value === "before_" + cycle,
      ),
      "snapshot before native initialization",
    );
    MGM.optOut();
    MGM.track("must_drop");
    await sleep(50);
    check(MGM.isOptedOut(), "explicit consent disables capture");
    check(
      (await MGM.getPendingEventCount()) === 0,
      "opted-out native queue clear",
    );
    MGM.destroy();
    configure();
    await MGM.ready();
    check(MGM.isOptedOut(), "consent survives destroy/native reload");
    MGM.optIn();
    await sleep(50);
    check(!MGM.isOptedOut(), "explicit optIn recovers");
    MGM.destroy();
  }
  check(fetchCalls === 0, "no fetch calls or MGM traffic");
  check(hostErrors.length === 0, "no host uncaught errors");
  const listener = AppState.addEventListener("change", (next) => {
    lifecycle.push(next);
    console.log("MGM_RN_APPSTATE " + next);
  });
  configure();
  await MGM.ready();
  MGM.optIn();
  rateLimited = false;
  MGM.clearPendingEvents();
  await sleep(100);
  check(
    (await MGM.getPendingEventCount()) === 0,
    "native lifecycle begins with empty queue",
  );
  const lifecycleStart = captured.length;
  setStatus("READY for actual Android background/resume");
  console.log(
    "MGM_RN_READY_LIFECYCLE " + JSON.stringify({ checks, sends, hermes: true }),
  );
  const deadline = Date.now() + 60000;
  while (
    Date.now() < deadline &&
    !(
      lifecycle.includes("background") &&
      lifecycle[lifecycle.length - 1] === "active"
    )
  )
    await sleep(100);
  check(
    lifecycle.includes("background") &&
      lifecycle[lifecycle.length - 1] === "active",
    "real Android background and resume",
  );
  await sleep(250);
  await MGM.flush();
  check(
    captured
      .slice(lifecycleStart)
      .some((event) => event.name === "$app_backgrounded"),
    "SDK receives native background event",
  );
  check(
    captured
      .slice(lifecycleStart)
      .some((event) => event.name === "$app_opened"),
    "SDK receives native foreground event",
  );
  listener.remove();
  MGM.destroy();
  check(hostErrors.length === 0, "no host errors after lifecycle");
  check(fetchCalls === 0, "lifecycle emits no real network traffic");
  const result = {
    pass: true,
    checks,
    sends,
    hermes: true,
    nativeStorage: true,
    lifecycle,
    lifecycleEvents: captured.slice(lifecycleStart).map((event) => event.name),
  };
  await AsyncStorage.setItem("mgm_native_host_result", JSON.stringify(result));
  setStatus("PASS " + JSON.stringify(result));
  console.log("MGM_RN_PASS " + JSON.stringify(result));
}
AppRegistry.registerComponent("MgmRnHermesHost", () => App);
