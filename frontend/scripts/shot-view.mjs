/**
 * Screenshot a view of the renderer by driving headless Chromium over CDP.
 * Dev-only helper: `node scripts/shot-view.mjs <url> <out.png> [clickSelector]`.
 */
import { writeFileSync } from "node:fs";

const [url, out, clickLabel] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/shot-view.mjs <url> <out.png> [altLabel]");
  process.exit(2);
}

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((target) => target.type === "page");
if (!page) throw new Error("no page target on :9222");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((resolve) => ws.addEventListener("open", resolve));
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(3500);

if (clickLabel) {
  const clicked = await send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector('[alt="${clickLabel}"]')?.closest('button');
      if (!el) return 'not-found';
      el.click();
      return 'clicked';
    })()`,
    returnByValue: true,
  });
  console.log("nav:", clicked.result?.result?.value);
  await sleep(2500);
}

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("wrote", out);
ws.close();
process.exit(0);
