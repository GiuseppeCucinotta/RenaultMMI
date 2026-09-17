import assert from "node:assert/strict";
import { test } from "node:test";
import { watchDevArtifacts, type WatchFn } from "../electron/dev-watch.js";
import { sleep } from "./support.js";

interface FakeWatcher {
  path: string;
  listener: (filename: string) => void;
  closed: boolean;
}

/** Records the watched paths and lets a test raise build events on demand. */
function createFakeWatch(): { watchers: FakeWatcher[]; watch: WatchFn } {
  const watchers: FakeWatcher[] = [];
  const watch: WatchFn = (path, listener) => {
    const watcher: FakeWatcher = { path, listener, closed: false };
    watchers.push(watcher);
    return {
      close: () => {
        watcher.closed = true;
      },
    };
  };
  return { watchers, watch };
}

test("coalesces a burst of writes into a single restart", async () => {
  const { watchers, watch } = createFakeWatch();
  let restarts = 0;

  watchDevArtifacts([{ name: "jukebox", path: "/dist/jukebox", onChange: () => (restarts += 1) }], {
    debounceMs: 20,
    watch,
  });

  assert.equal(watchers.length, 1);
  const watcher = watchers[0];
  // A rollup build rewrites its outputs several times in a row.
  watcher.listener("index.js");
  watcher.listener("index.js");
  watcher.listener("index.js");
  assert.equal(restarts, 0, "nothing happens until the burst settles");

  await sleep(60);
  assert.equal(restarts, 1);
});

test("only matching files trigger a restart", async () => {
  const { watchers, watch } = createFakeWatch();
  let restarts = 0;

  watchDevArtifacts(
    [
      {
        name: "main",
        path: "/dist",
        match: (file) => file === "main.js",
        onChange: () => (restarts += 1),
      },
    ],
    { debounceMs: 10, watch },
  );

  const watcher = watchers[0];
  watcher.listener("preload.mjs");
  watcher.listener("index.html");
  watcher.listener("");
  await sleep(40);
  assert.equal(restarts, 0, "unrelated artifacts are ignored");

  watcher.listener("main.js");
  await sleep(40);
  assert.equal(restarts, 1);
});

test("dispose cancels pending restarts and closes every watcher", async () => {
  const { watchers, watch } = createFakeWatch();
  let restarts = 0;

  const dispose = watchDevArtifacts(
    [
      { name: "jukebox", path: "/jukebox", onChange: () => (restarts += 1) },
      { name: "cd", path: "/cd", onChange: () => (restarts += 1) },
    ],
    { debounceMs: 20, watch },
  );

  watchers[0].listener("index.js");
  watchers[1].listener("index.js");
  dispose();

  await sleep(60);
  assert.equal(restarts, 0, "a restart queued before dispose must not fire");
  assert.ok(
    watchers.every((watcher) => watcher.closed),
    "every handle was closed",
  );
});

test("a watch that cannot start is reported without losing the others", () => {
  const { watchers, watch } = createFakeWatch();
  const failing: WatchFn = (path, listener) => {
    if (path === "/missing") throw new Error("ENOENT: no such file or directory");
    return watch(path, listener);
  };

  const failed: string[] = [];
  watchDevArtifacts(
    [
      { name: "missing", path: "/missing", onChange: () => undefined },
      { name: "cd", path: "/cd", onChange: () => undefined },
    ],
    {
      watch: failing,
      onError: (name) => failed.push(name),
    },
  );

  assert.deepEqual(failed, ["missing"]);
  assert.equal(watchers.length, 1, "the healthy target is still watched");
  assert.equal(watchers[0].path, "/cd");
});
