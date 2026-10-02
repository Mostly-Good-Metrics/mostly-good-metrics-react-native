const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(
  path.join(root, "tests/native-host/run.mjs"),
  "utf8",
);
const start = source.indexOf("  const launchHost = ");
const end = source.indexOf("\n} catch (error) {", start);
assert.ok(start > 0 && end > start);
const workload = "(async () => {\n" + source.slice(start, end) + "\n})()";
const result = {
  pass: true,
  checks: 122,
  sends: 26,
  hermes: true,
  nativeStorage: true,
  lifecycle: ["background", "active"],
  lifecycleEvents: ["$app_backgrounded", "$app_opened"],
};
async function check(fault) {
  let currentPid = "",
    mode = "none",
    phase = 0,
    background = false,
    resumed = false;
  let calls = [],
    launches = [],
    sleeps = [],
    sqlite = 0,
    statReads = 0;
  const files = new Map();
  const sandbox = {
    appId: "com.mgm.rnhermeshost",
    adb: "/fake/adb",
    serial: "emulator-5554",
    output: "/own-fixture",
    corePackage: { version: "0.13.1" },
    abi: "x86_64",
    failPattern:
      /MGM_RN_FAIL|MGM_RN_HOST_ERROR|Possible Unhandled Promise Rejection|Unhandled promise rejection|FATAL EXCEPTION|Fatal signal/i,
    join: path.join,
    console: { log() {} },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    writeFileSync: (name, data) => files.set(path.basename(name), data),
    command(binary, args, options) {
      assert.equal(binary, "python3");
      sqlite++;
      assert.equal(
        path.basename(args[2]),
        `launch-${sqlite}-native-storage.sqlite`,
      );
      assert.equal(options.log, `launch-${sqlite}-sqlite-result.log`);
      if (fault === "sqlite" && sqlite === 2)
        throw new Error("synthetic sqlite failure");
    },
    spawnSync(binary, args) {
      assert.equal(binary, "/fake/adb");
      assert.equal(
        args.join(" "),
        "-s emulator-5554 exec-out run-as com.mgm.rnhermeshost cat databases/RKStorage",
      );
      return { status: 0, stdout: Buffer.from("isolated fake SQLite bytes") };
    },
    rawDevice(args) {
      calls.push(args.join(" "));
      if (args.includes("force-stop")) {
        currentPid = "";
        return "";
      }
      if (args.includes("date")) return "10-02 16:00:00.000";
      if (args.includes("KEYCODE_HOME")) {
        background = true;
        return "";
      }
      if (args.includes("start")) {
        if (args.includes("--ez")) {
          mode = args.at(-1) === "true" ? "negative" : "positive";
          if (mode === "negative") phase++;
          currentPid = String(4000 + launches.length);
          launches.push({ phase, mode, pid: currentPid });
          background = false;
          resumed = false;
          statReads = 0;
        } else {
          assert.equal(mode, "positive");
          assert.ok(background);
          resumed = true;
        }
        return "";
      }
      if (args.includes("pidof")) return currentPid;
      if (args.some((arg) => arg.endsWith("/stat"))) {
        statReads++;
        const dead =
          fault === "initial-death" ||
          (fault === "death" &&
            phase === 3 &&
            mode === "positive" &&
            statReads > 2);
        return `${currentPid} (gm.rnhermeshost) ${dead ? "Z" : "R"} ${Array(18).fill("0").join(" ")} 100 0`;
      }
      if (args.some((arg) => arg.endsWith("/cmdline")))
        return "com.mgm.rnhermeshost\0";
      if (args[0] === "logcat") {
        if (args.includes("ActivityManager:I")) return "";
        assert.ok(args.includes("--pid=" + currentPid));
        if (mode === "negative") {
          if (fault === "sentinel" && phase === 2)
            return "MGM_RN_HOST_ERROR unrelated fatal";
          return "MGM_RN_HOST_ERROR unhandled rejection: Error: MGM_RN_REJECTION_DETECTOR_PROBE";
        }
        if (fault === "fatal" && phase === 4)
          return "FATAL EXCEPTION: synthetic native failure";
        return (
          "MGM_RN_READY_LIFECYCLE\n" +
          (background ? "MGM_RN_APPSTATE background\n" : "") +
          (resumed ? "MGM_RN_PASS " + JSON.stringify(result) : "")
        );
      }
      if (args.includes("exit-info")) {
        assert.equal(args.at(-1), "com.mgm.rnhermeshost");
        return "own fixture exit information";
      }
      return "";
    },
  };
  sandbox.device = (args, options = {}) => {
    const value = sandbox.rawDevice(args);
    if (options.log) files.set(options.log, value);
    return value;
  };
  if (!fault) {
    await vm.runInNewContext(workload, sandbox);
    const summary = JSON.parse(files.get("result.json"));
    assert.equal(summary.launchPairs, 5);
    assert.equal(summary.launches.length, 5);
    assert.equal(summary.javascriptCore, "0.13.1");
    assert.equal(launches.length, 10);
    assert.equal(sqlite, 5);
    assert.equal(sleeps.filter((delay) => delay === 2500).length, 5);
    for (let i = 1; i <= 5; i++) {
      assert.ok(files.has(`launch-${i}-positive.log`));
      assert.ok(files.has(`launch-${i}-rejection-probe.log`));
      assert.ok(files.has(`launch-${i}-native-storage.sqlite`));
      assert.equal(summary.launches[i - 1].startTime, "100");
      assert.equal(summary.launches[i - 1].negativeStartTime, "100");
      for (const mode of ["negative", "positive"]) {
        const binding = JSON.parse(
          files.get(`launch-${i}-${mode}-bound-process.log`),
        );
        assert.equal(binding.startTime, "100");
        assert.equal(
          binding.pid,
          mode === "negative"
            ? summary.launches[i - 1].negativePid
            : summary.launches[i - 1].pid,
        );
      }
      assert.notEqual(
        summary.launches[i - 1].negativePid,
        summary.launches[i - 1].pid,
      );
    }
  } else {
    const expected = {
      death: /Host process is dead/,
      "initial-death": /Host process is dead/,
      fatal: /Native host error/,
      sentinel: /Native host error/,
      sqlite: /synthetic sqlite failure/,
    }[fault];
    await assert.rejects(vm.runInNewContext(workload, sandbox), expected);
    assert.ok(
      !files.has("result.json"),
      "failed runs must not write an all-pairs success result",
    );
    const stoppedPhase = {
      death: 3,
      "initial-death": 1,
      fatal: 4,
      sentinel: 2,
      sqlite: 2,
    }[fault];
    assert.equal(phase, stoppedPhase, "a failed phase was retried or skipped");
    if (fault === "death")
      assert.ok(files.has("launch-3-positive-delayed-exit-info.log"));
    if (fault === "initial-death") {
      assert.ok(files.has("launch-1-negative-delayed-exit-info.log"));
      assert.ok(!files.has("launch-1-negative-bound-process.log"));
      assert.equal(launches.length, 1);
    }
  }
}
async function checkCalibrationIsolation() {
  const input = fs.readFileSync(
    path.join(root, "tests/native-host/index.js"),
    "utf8",
  );
  const program = input
    .replace(/^import React, \{ useEffect, useState \} from "react";\n/m, "")
    .replace(
      /^import \{ AppRegistry, Text, View, AppState, NativeModules \} from "react-native";\n/m,
      "",
    )
    .replace(
      /^import AsyncStorage from "@react-native-async-storage\/async-storage";\n/m,
      "",
    );
  assert.ok(
    !/^import /m.test(program),
    "unexpected eager import must be reviewed",
  );
  for (const negative of [true, false]) {
    const modules = [],
      backing = new Map(),
      rejected = [];
    const sdk = {
      configure() {
        throw new Error("POSITIVE_CONFIGURE_REACHED");
      },
      destroy() {},
    };
    class ControlledPromise extends Promise {
      static reject(error) {
        rejected.push(error.message);
        return ControlledPromise.resolve();
      }
    }
    const context = {
      React: {},
      useEffect() {},
      useState: () => ["status", () => {}],
      Text: {},
      View: {},
      AppState: {},
      AppRegistry: { registerComponent() {} },
      NativeModules: {
        RNCAsyncStorage: {},
        AppState: { getCurrentAppState() {} },
      },
      AsyncStorage: {
        clear: async () => backing.clear(),
        setItem: async (key, value) => backing.set(key, value),
        getItem: async (key) => backing.get(key) ?? null,
      },
      global: {
        ErrorUtils: { getGlobalHandler: () => () => {}, setGlobalHandler() {} },
        HermesInternal: { enablePromiseRejectionTracker() {} },
      },
      Promise: ControlledPromise,
      setTimeout: (callback) => callback(),
      console: { error() {}, log() {} },
      require(name) {
        modules.push(name);
        if (name === "./candidate/index") return { default: sdk };
        if (name === "./candidate/storage")
          return { getStorageType: () => "persistent" };
        throw new Error("Unexpected dependency " + name);
      },
    };
    const run = vm.runInNewContext(program + "\nrun;", context);
    await assert.rejects(
      run(() => {}, negative),
      negative ? /rejection detector failed/ : /POSITIVE_CONFIGURE_REACHED/,
    );
    if (negative) {
      assert.deepEqual(modules, []);
      assert.deepEqual(rejected, ["MGM_RN_REJECTION_DETECTOR_PROBE"]);
    } else
      assert.deepEqual(modules, ["./candidate/index", "./candidate/storage"]);
  }
  console.log(
    "PASS calibration evaluates no MGM module; positive loads both actual SDK modules",
  );
}

async function checkScopedDiagnostics() {
  const commandCode = source.slice(
    source.indexOf("function command("),
    source.indexOf("const failPattern ="),
  );
  const monitorStart = source.indexOf("  const readPid = ");
  const monitorEnd = source.indexOf(
    "  // Repeat the full workload",
    monitorStart,
  );
  const monitorCode =
    source.slice(monitorStart, monitorEnd) +
    "\n({ readHostLog, readPid, assertNoHostError, fixtureSystemRecords, collectHostDiagnostics });";
  const host = {
    pid: "4102",
    startTime: "900719925474099312345",
    since: "10-02 16:00:00.000",
    evidencePrefix: "phase",
  };
  const own = "ActivityManager: Start proc 4102:com.mgm.rnhermeshost/u0a209";
  const ownPid = "ActivityManager: Killing 4102: native startup";
  const foreign = [
    "ActivityManager: process com.other memory 4102 UID 4102",
    "ActivityManager: Killing 41020: other app",
    "ActivityManager: Start proc evilcom.mgm.rnhermeshostsuffix",
    "ActivityManager: Start proc com.mgm.rnhermeshost.other",
  ];
  for (const fault of [
    null,
    "empty",
    "pid255",
    "pid1stderr",
    "log255",
    "timeout",
    "fatal",
    "diagfail",
    "reuse",
    "status-reuse",
    "system-error",
    "dead-X",
    "dead-x",
    "malformed",
    "missing",
    "stat255",
    "identity-missing",
    "identity255",
    "clock-reuse",
    "mid-identity-reuse",
    "post-log-reuse",
  ]) {
    const files = new Map(),
      calls = [],
      sleeps = [];
    let statReads = 0;
    const context = {
      appId: "com.mgm.rnhermeshost",
      adb: "/fake/adb",
      serial: "emulator-5554",
      output: "/own-fixture",
      join: path.join,
      process: { env: {} },
      failPattern:
        /MGM_RN_FAIL|MGM_RN_HOST_ERROR|Possible Unhandled Promise Rejection|Unhandled promise rejection|FATAL EXCEPTION|Fatal signal/i,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      writeFileSync(name, value) {
        files.set(path.basename(name), value);
      },
      spawnSync(binary, args, options) {
        calls.push(args);
        assert.equal(binary, "/fake/adb");
        assert.ok(options.maxBuffer <= 20 * 1024 * 1024);
        const result = { status: 0, signal: null, stdout: "", stderr: "" };
        if (args.includes("pidof")) {
          result.stdout = "4102\n";
          if (
            [
              "empty",
              "diagfail",
              "reuse",
              "status-reuse",
              "system-error",
            ].includes(fault)
          )
            Object.assign(result, { status: 1, stdout: "" });
          if (fault === "pid255")
            Object.assign(result, {
              status: 255,
              stdout: "",
              stderr: "adb: device offline",
            });
          if (fault === "pid1stderr")
            Object.assign(result, {
              status: 1,
              stdout: "",
              stderr: "error: query failed",
            });
        } else if (args.some((arg) => arg.endsWith("/stat"))) {
          assert.equal(options.maxBuffer, 16 * 1024);
          statReads++;
          const state = ["diagfail", "status-reuse", "system-error"].includes(
            fault,
          )
            ? "Z"
            : fault === "dead-X"
              ? "X"
              : fault === "dead-x"
                ? "x"
                : "R";
          const reused =
            fault === "clock-reuse" ||
            (fault === "mid-identity-reuse" && statReads >= 2) ||
            (fault === "post-log-reuse" && statReads >= 3);
          result.stdout = `4102 (gm.rnhermeshost) ${state} ${Array(18).fill("0").join(" ")} ${reused ? "900719925474099312346" : host.startTime} 0`;
          if (fault === "malformed") result.stdout = "4102 (other) ? 0";
          if (fault === "missing")
            Object.assign(result, {
              status: 1,
              stdout: "",
              stderr: "cat: /proc/4102/stat: No such file or directory",
            });
          if (fault === "stat255")
            Object.assign(result, {
              status: 255,
              stdout: "partial stat",
              stderr: "adb: device offline",
            });
        } else if (args.some((arg) => arg.endsWith("/cmdline"))) {
          assert.equal(options.maxBuffer, 16 * 1024);
          result.stdout =
            (fault === "reuse" ? "com.other" : "com.mgm.rnhermeshost") + "\0";
          if (fault === "identity-missing")
            Object.assign(result, {
              status: 1,
              stdout: "",
              stderr: "cat: /proc/4102/cmdline: No such file or directory",
            });
          if (fault === "identity255")
            Object.assign(result, {
              status: 255,
              stdout: "",
              stderr: "adb: device offline",
            });
        } else if (args.some((arg) => arg.endsWith("/status"))) {
          assert.equal(options.maxBuffer, 16 * 1024);
          result.stdout = `Name:\t${fault === "status-reuse" ? "other" : "gm.rnhermeshost"}\nState:\tZ (zombie)\nPid:\t4102\nThreads:\t2\nUid:\tsecret-other-uid\nVmRSS:\tsecret-other-memory`;
        } else if (args.includes("exit-info")) {
          assert.equal(args.at(-1), "com.mgm.rnhermeshost");
          result.stdout =
            calls.filter((call) => call.includes("exit-info")).length === 1
              ? "no record yet"
              : "own delayed exit reason";
          if (fault === "diagfail")
            Object.assign(result, {
              status: 255,
              error: Object.assign(new Error("diagnostic failed"), {
                code: "ETIMEDOUT",
              }),
              stderr: "adb: unavailable",
            });
        } else if (args.includes("ActivityManager:I")) {
          assert.equal(options.maxBuffer, 1024 * 1024);
          result.stdout = [own, ownPid, ...foreign].join("\n");
          result.stderr = ["adb: device offline", ...foreign].join("\n");
          if (fault === "system-error") result.status = 255;
        } else if (args.includes("crash")) {
          assert.ok(args.includes("--pid=4102"));
          result.stdout = "";
        } else if (args.includes("logcat")) {
          result.stdout =
            fault === "fatal"
              ? "FATAL EXCEPTION: real host failure"
              : "partial scoped native startup";
          if (fault === "log255")
            Object.assign(result, {
              status: 255,
              stderr: "logcat: Unexpected EOF!",
            });
          if (fault === "timeout")
            Object.assign(result, {
              status: null,
              signal: "SIGTERM",
              error: Object.assign(new Error("read timed out"), {
                code: "ETIMEDOUT",
              }),
            });
        } else throw new Error("Unexpected command " + args.join(" "));
        return result;
      },
    };
    const api = vm.runInNewContext(commandCode + monitorCode, context);
    assert.equal(
      api.fixtureSystemRecords(host, [own, ownPid, ...foreign].join("\n")),
      [own, ownPid].join("\n"),
    );
    assert.equal(
      api.fixtureSystemRecords(
        host,
        ["adb: device offline", "logcat: Unexpected EOF!", ...foreign].join(
          "\n",
        ),
        "stderr",
      ),
      "adb: device offline\nlogcat: Unexpected EOF!",
    );
    const read = async () => {
      const text = await api.readHostLog(host, "positive.log");
      api.assertNoHostError(text);
      return text;
    };
    if (fault === "pid255" || fault === "pid1stderr") {
      assert.throws(
        () => api.readPid("query.log"),
        fault === "pid255" ? /failed \(255\)/ : /failed \(1\)/,
      );
      assert.equal(calls.length, 1);
      continue;
    }
    if (!fault || fault === "empty") {
      if (fault === "empty")
        assert.equal(api.readPid("empty-name-query.log"), "");
      const discoveryCalls = calls.length;
      assert.match(await read(), /partial scoped/);
      assert.equal(calls.length - discoveryCalls, 7);
      assert.ok(
        calls.slice(discoveryCalls).every((call) => !call.includes("pidof")),
        "bound PID monitoring must not depend on a name lookup",
      );
      continue;
    }
    const expected = {
      log255: /failed \(255\)/,
      timeout: /read timed out/,
      fatal: /Native host error/,
      diagfail: /Host process is dead/,
      reuse: /Host PID identity changed/,
      "status-reuse": /Host process is dead/,
      "system-error": /Host process is dead/,
      "dead-X": /Host process is dead/,
      "dead-x": /Host process is dead/,
      malformed: /Invalid expected PID stat/,
      missing: /failed \(1\)/,
      stat255: /failed \(255\)/,
      "identity-missing": /failed \(1\)/,
      identity255: /failed \(255\)/,
      "clock-reuse": /Host PID was reused/,
      "mid-identity-reuse": /Host PID was reused/,
      "post-log-reuse": /Host PID was reused/,
    }[fault];
    await assert.rejects(read(), expected);
    if (fault === "fatal") continue;
    if (!["post-log-reuse", "log255", "timeout"].includes(fault))
      assert.ok(
        !files.has("positive.log"),
        "invalid or dead expected process must not advance workload monitoring",
      );
    assert.deepEqual(sleeps, [1000]);
    assert.equal(calls.filter((call) => call.includes("exit-info")).length, 2);
    assert.ok(files.has("phase-delayed-exit-info.log"));
    const system = files.get("phase-system-records.log");
    assert.ok(
      system.includes(own) &&
        system.includes(ownPid) &&
        system.includes("adb: device offline"),
    );
    for (const record of foreign) assert.ok(!system.includes(record));
    const systemMetadata = JSON.parse(
      files.get("phase-system-records.log.command.log"),
    );
    for (const record of foreign)
      assert.ok(!JSON.stringify(systemMetadata).includes(record));
    assert.match(systemMetadata.stderr, /adb: device offline/);
    if (fault === "system-error") assert.equal(systemMetadata.status, 255);
    assert.ok(!JSON.stringify([...files.values()]).includes("secret-other"));
    if (fault === "reuse") {
      assert.ok(!files.has("phase-pid-status.log"));
      assert.ok(
        !JSON.stringify([...files.values()]).includes("com.other\u0000"),
      );
    }
    if (fault === "status-reuse")
      assert.match(
        files.get("phase-pid-status.log"),
        /no longer identifies own fixture/,
      );
    if (fault === "log255") {
      const details = JSON.parse(files.get("positive.log.command.log"));
      assert.equal(details.status, 255);
      assert.equal(details.stdout, "partial scoped native startup");
      assert.match(details.stderr, /Unexpected EOF/);
    }
  }
  console.log(
    "PASS bound live PID monitoring despite empty name query; dead/reused/invalid/transport controls, scoped async diagnostics and adversarial record filtering",
  );
}

(async () => {
  await checkCalibrationIsolation();
  await checkScopedDiagnostics();
  for (const fault of [
    null,
    "initial-death",
    "death",
    "fatal",
    "sentinel",
    "sqlite",
  ])
    await check(fault);
  console.log(
    "PASS extracted five-pair runner mocks: ten fresh launches, per-pair lifecycle/SQLite/tail evidence, immediate stop on death/fatal/wrong sentinel/SQLite failure",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
