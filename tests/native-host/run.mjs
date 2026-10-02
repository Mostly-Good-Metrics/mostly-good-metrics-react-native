import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = dirname(fileURLToPath(import.meta.url));
const repository = resolve(fixture, "../..");
const output = join(fixture, ".build-native");
// CI verifies the package graph installed by the wrapper's lockfile. A local
// candidate override remains useful before publishing a core change.
const core = process.env.MGM_JS_DIR
  ? resolve(process.env.MGM_JS_DIR)
  : join(repository, "node_modules/@mostly-good-metrics/javascript");
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(homedir(), "Library/Android/sdk");
const adb = join(sdk, "platform-tools/adb");
const serial = process.env.ANDROID_SERIAL || "emulator-5554";
const appId = "com.mgm.rnhermeshost";
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
mkdirSync(output, { recursive: true });
// A failed rerun must never retain a previous all-pairs success summary.
rmSync(join(output, "result.json"), { force: true });
function command(
  binary,
  args,
  {
    cwd = output,
    log,
    timeout = 180000,
    allowFailure = false,
    acceptEmptyExitCodeOne = false,
  } = {},
) {
  const result = spawnSync(binary, args, {
    cwd,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
    env: process.env,
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const text = stdout + stderr;
  if (log) {
    // Preserve partial output and the actual transport/exit result before any
    // assertion throws. Every caller-supplied log path is inside our fixture.
    writeFileSync(join(output, log), text);
    writeFileSync(
      join(output, `${log}.command.log`),
      JSON.stringify(
        {
          command: [binary, ...args],
          status: result.status,
          signal: result.signal,
          error: result.error
            ? { message: result.error.message, code: result.error.code }
            : null,
          stdout,
          stderr,
        },
        null,
        2,
      ),
    );
  }
  const acceptedExit =
    result.status === 0 ||
    (acceptEmptyExitCodeOne &&
      result.status === 1 &&
      !stdout.trim() &&
      !stderr.trim());
  if (!allowFailure && (result.error || !acceptedExit))
    throw new Error(
      `${binary} failed (${result.status}): ${result.error || text.slice(-6000)}`,
    );
  return text.trim();
}
const device = (args, options) =>
  command(adb, ["-s", serial, ...args], { ...options, timeout: 15000 });
const failPattern =
  /MGM_RN_FAIL|MGM_RN_HOST_ERROR|Possible Unhandled Promise Rejection|Unhandled promise rejection|FATAL EXCEPTION|Fatal signal/i;

try {
  if (!existsSync(join(core, "dist/cjs/index.js")))
    throw new Error(
      "Install wrapper dependencies with npm ci, or point MGM_JS_DIR to a built candidate core checkout",
    );
  if (!existsSync(join(repository, "lib/commonjs/index.js")))
    throw new Error("Build candidate RN first with npm run prepare");
  const corePackage = JSON.parse(readFileSync(join(core, "package.json")));
  console.log(
    `JavaScript core ${corePackage.version}: ${process.env.MGM_JS_DIR ? "local candidate override" : "SDK-installed dependency"}`,
  );
  const fixturePackage = JSON.parse(
    readFileSync(join(fixture, "node_modules/react-native/package.json")),
  );
  if (fixturePackage.version !== "0.73.11")
    throw new Error("Fixture requires locked React Native 0.73.11");
  for (const name of ["index.js", "babel.config.js"])
    cpSync(join(fixture, name), join(output, name));
  cpSync(join(repository, "lib/commonjs"), join(output, "candidate"), {
    recursive: true,
  });
  const modules = join(output, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const name of readdirSync(join(fixture, "node_modules"))) {
    if (name === "@mostly-good-metrics") continue;
    const target = join(modules, name);
    if (!existsSync(target))
      symlinkSync(join(fixture, "node_modules", name), target, "dir");
  }
  const alias = join(modules, "@mostly-good-metrics/javascript");
  mkdirSync(alias, { recursive: true });
  cpSync(join(core, "dist"), join(alias, "dist"), { recursive: true });
  cpSync(join(core, "package.json"), join(alias, "package.json"));
  writeFileSync(
    join(output, "package.json"),
    JSON.stringify({
      name: "mgm-native-host-generated",
      private: true,
      dependencies: JSON.parse(readFileSync(join(fixture, "package.json")))
        .dependencies,
    }),
  );
  writeFileSync(
    join(output, "metro.config.js"),
    `const {getDefaultConfig,mergeConfig}=require('@react-native/metro-config');module.exports=mergeConfig(getDefaultConfig(__dirname),{watchFolders:[${JSON.stringify(join(fixture, "node_modules"))}],resolver:{unstable_enableSymlinks:true,nodeModulesPaths:[__dirname+'/node_modules'],disableHierarchicalLookup:true},maxWorkers:2});`,
  );
  const android = join(output, "android");
  mkdirSync(android, { recursive: true });
  for (const name of [
    "settings.gradle",
    "build.gradle",
    "gradle.properties",
    "gradlew",
    "gradle",
    "app",
    "asyncstorage",
  ])
    cpSync(join(fixture, name), join(android, name), { recursive: true });
  chmodSync(join(android, "gradlew"), 0o755);
  writeFileSync(join(android, "local.properties"), `sdk.dir=${sdk}\n`);
  const assets = join(android, "app/src/main/assets");
  mkdirSync(assets, { recursive: true });
  console.log("Bundling candidate package with Metro");
  command(
    process.execPath,
    [
      join(modules, "react-native/cli.js"),
      "bundle",
      "--platform",
      "android",
      "--dev",
      "false",
      "--entry-file",
      "index.js",
      "--bundle-output",
      join(assets, "index.android.js"),
      "--assets-dest",
      join(android, "app/src/main/res"),
      "--config",
      join(output, "metro.config.js"),
    ],
    { log: "bundle.log" },
  );
  const compiler = join(
    modules,
    "react-native/sdks/hermesc",
    platform() === "darwin" ? "osx-bin" : "linux64-bin",
    "hermesc",
  );
  command(
    compiler,
    [
      "-w",
      "-O",
      "-emit-binary",
      "-out",
      join(assets, "index.android.bundle"),
      join(assets, "index.android.js"),
    ],
    { log: "hermes.log" },
  );
  rmSync(join(assets, "index.android.js"));
  const abi = device(["shell", "getprop", "ro.product.cpu.abi"]);
  if (!["arm64-v8a", "x86_64"].includes(abi))
    throw new Error(`Unsupported fixture emulator ABI: ${abi}`);
  console.log(`Building Android/Hermes host for ${abi}`);
  command(
    join(android, "gradlew"),
    ["--no-daemon", ":app:assembleDebug", `-PmgmAbi=${abi}`],
    { cwd: android, log: "build.log", timeout: 300000 },
  );
  device([
    "install",
    "-r",
    join(android, "app/build/outputs/apk/debug/app-debug.apk"),
  ]);
  // Stop only our fixture so each launch starts a fresh JS/Hermes runtime.
  const launchHost = async (rejectionProbe, evidencePrefix) => {
    device(["shell", "am", "force-stop", appId], {
      log: `${evidencePrefix}-force-stop.log`,
    });
    const since = device(["shell", "date", "'+%m-%d %H:%M:%S.000'"]);
    if (!/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000$/.test(since))
      throw new Error(`Cannot establish fresh device log timestamp: ${since}`);
    device(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    device(["shell", "wm", "dismiss-keyguard"]);
    device(
      [
        "shell",
        "am",
        "start",
        "-n",
        `${appId}/.MainActivity`,
        "--ez",
        "mgmRejectionProbe",
        String(rejectionProbe),
      ],
      { log: `${evidencePrefix}-start.log` },
    );
    let pid = "";
    for (let attempt = 0; attempt < 20 && !pid; attempt++) {
      pid = readPid(evidencePrefix);
      if (!pid) await sleep(250);
    }
    if (!/^\d+$/.test(pid))
      throw new Error(`Fixture did not start with one host process: ${pid}`);
    return { pid, since, evidencePrefix };
  };
  const readPid = (evidencePrefix) => {
    const pid = device(["shell", "pidof", appId], {
      acceptEmptyExitCodeOne: true,
      log: `${evidencePrefix}-pidof.log`,
    });
    if (pid && !/^\d+$/.test(pid))
      throw new Error(`Invalid fixture PID query output: ${pid}`);
    return pid;
  };
  const collectHostDiagnostics = (host) => {
    for (const [name, args] of [
      [
        `${host.evidencePrefix}-exit-info.log`,
        ["shell", "dumpsys", "activity", "exit-info", appId],
      ],
      [
        `${host.evidencePrefix}-crash.log`,
        ["logcat", "-d", "-b", "crash", `--pid=${host.pid}`, "-T", host.since],
      ],
    ]) {
      try {
        device(args, { allowFailure: true, log: name });
      } catch (error) {
        try {
          writeFileSync(
            join(output, name),
            `Diagnostic collection failed: ${String(error)}`,
          );
        } catch {
          // A best-effort diagnostic must never replace the original failure.
        }
      }
    }
  };
  const readHostLog = (host, filename) => {
    try {
      const current = readPid(host.evidencePrefix);
      const text = device(
        ["logcat", "-d", `--pid=${host.pid}`, "-T", host.since],
        { log: filename },
      );
      if (current !== host.pid)
        throw new Error(
          `Host died or restarted: expected PID ${host.pid}, got ${current}`,
        );
      return text;
    } catch (error) {
      collectHostDiagnostics(host);
      throw error;
    }
  };
  const assertNoHostError = (text) => {
    if (failPattern.test(text))
      throw new Error(
        `Native host error: ${text.match(/^.*(?:MGM_RN_FAIL|MGM_RN_HOST_ERROR|Unhandled|FATAL EXCEPTION|Fatal signal).*$/im)?.[0]}`,
      );
  };
  // Repeat the full workload with the same built APK. These are independent
  // launch pairs, never retries: any failure terminates the run immediately.
  const launchResults = [];
  for (let pair = 1; pair <= 5; pair++) {
    const phase = `launch-${pair}`;
    // Prove that the same strict detector rejects an intentionally unhandled
    // promise in this production Hermes bundle before accepting the SDK run.
    const probe = await launchHost(true, `${phase}-negative`);
    let rejectionDetectorVerified = false;
    const probeDeadline = Date.now() + 15000;
    while (Date.now() < probeDeadline) {
      const text = readHostLog(probe, `${phase}-rejection-probe.log`);
      try {
        assertNoHostError(text);
      } catch (error) {
        if (
          !String(error).includes(
            "MGM_RN_HOST_ERROR unhandled rejection: Error: MGM_RN_REJECTION_DETECTOR_PROBE",
          )
        )
          throw error;
        rejectionDetectorVerified = true;
        break;
      }
      await sleep(100);
    }
    if (!rejectionDetectorVerified)
      throw new Error(
        "Strict detector did not reject the controlled Hermes promise rejection",
      );
    console.log(
      `PID ${probe.pid}: controlled unhandled rejection rejected by native runner`,
    );
    const host = await launchHost(false, `${phase}-positive`);
    if (host.pid === probe.pid)
      throw new Error(`Launch pair reused the negative process: ${host.pid}`);
    const { pid } = host;
    const readLog = () => {
      const text = readHostLog(host, `${phase}-positive.log`);
      assertNoHostError(text);
      return text;
    };
    const waitFor = async (marker) => {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const text = readLog();
        if (text.includes(marker)) return text;
        await sleep(250);
      }
      throw new Error(
        `No ${marker} within 60s; see ${join(output, `${phase}-positive.log`)}`,
      );
    };
    await waitFor("MGM_RN_READY_LIFECYCLE");
    console.log(
      `PID ${pid}: native capture/recovery passed; sending HOME and resuming fixture`,
    );
    device(["shell", "input", "keyevent", "KEYCODE_HOME"]);
    await waitFor("MGM_RN_APPSTATE background");
    device(["shell", "am", "start", "-n", `${appId}/.MainActivity`]);
    const text = await waitFor("MGM_RN_PASS");
    const result = JSON.parse(text.match(/MGM_RN_PASS (\{[^\n]+\})/)[1]);
    if (
      !result.pass ||
      !result.hermes ||
      !result.nativeStorage ||
      result.checks < 122 ||
      result.lifecycle.join(",") !== "background,active" ||
      !result.lifecycleEvents.includes("$app_backgrounded") ||
      !result.lifecycleEvents.includes("$app_opened")
    )
      throw new Error(
        `Incomplete native smoke result: ${JSON.stringify(result)}`,
      );
    await sleep(2500);
    readLog(); // Cover the rejection tracker's two-second grace after success.
    const database = spawnSync(
      adb,
      ["-s", serial, "exec-out", "run-as", appId, "cat", "databases/RKStorage"],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (database.status !== 0)
      throw new Error("Cannot read fixture native SQLite evidence");
    writeFileSync(
      join(output, `${phase}-native-storage.sqlite`),
      database.stdout,
    );
    command(
      "python3",
      [
        "-c",
        "import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);r=json.loads(c.execute('SELECT value FROM catalystLocalStorage WHERE key=?',('mgm_native_host_result',)).fetchone()[0]);assert r['pass'] and r['hermes'] and r['nativeStorage'];print(r)",
        join(output, `${phase}-native-storage.sqlite`),
      ],
      { log: `${phase}-sqlite-result.log` },
    );
    launchResults.push({
      ...result,
      phase,
      rejectionDetectorVerified,
      negativePid: probe.pid,
      pid,
      abi,
      reactNative: "0.73.11",
      asyncStorage: "1.24.0",
    });
    console.log(
      `PASS ${phase}: actual Android/Hermes host ${JSON.stringify(result)}`,
    );
  }
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        pass: true,
        launchPairs: launchResults.length,
        javascriptCore: corePackage.version,
        launches: launchResults,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS all ${launchResults.length} independent Android/Hermes launch pairs`,
  );
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  // Never leave the test host running after a pass or failure. Other apps are untouched.
  if (existsSync(adb)) {
    try {
      device(["shell", "am", "force-stop", appId], { allowFailure: true });
    } catch (error) {
      console.error("Could not stop isolated fixture: " + String(error));
    }
  }
}
