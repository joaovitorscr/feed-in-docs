import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./plugin.ts";

// Each invalid case is the code a past fix replaced, or the smallest form of it.
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const { rules } = plugin;

tester.run("no-unbounded-body", rules["no-unbounded-body"], {
  valid: [
    "const response = await fetch(url, { signal }); const text = await readText(response, MAX_BYTES, url);",
    // cheerio and other non-fetch values keep their own `.text()`.
    "const title = $('title').first().text();",
    "const record = await new Response(result.stream).json();",
    // A `res` in another function is a different variable.
    "async function a() { const res = await fetch(url, { signal }); return readText(res, MAX_BYTES, url); } async function b(res) { return res.json(); }",
    // Only the global fetch is a raw network response.
    "const res = await client.fetch(url); const data = await res.json();",
    // A fetch the file receives is a custom function, not the global one.
    "async function load(fetch) { const res = await fetch(url); return res.json(); }",
  ],
  invalid: [
    {
      code: "const response = await fetch(url, { signal }); const text = await response.text();",
      errors: 1,
    },
    { code: "let res; res = await fetch(url); const data = await res.json();", errors: 1 },
    { code: "const body = await (await fetch(url)).arrayBuffer();", errors: 1 },
  ],
});

tester.run("bytes-not-length", rules["bytes-not-length"], {
  valid: [
    "if (Buffer.byteLength(text) > MAX_BYTES) throw error;",
    "const length = Number(response.headers.get('content-length')); if (length > maxBytes) throw error;",
    "if (items.length > MAX_ITEMS) throw error;",
    // A Uint8Array's or Buffer's length is already bytes.
    "const chunk = new Uint8Array(5); if (chunk.length > MAX_BYTES) throw error;",
    "const buffer = Buffer.from(text); if (buffer.length > maxBytes) throw error;",
    // A value it can't see being made isn't assumed to be a string.
    "function check(value) { if (value.length > maxBytes) throw error; }",
  ],
  invalid: [
    {
      code: "const text = await response.text(); if (text.length > maxBytes) throw new Error('A documentation page is too large.');",
      errors: 1,
    },
    { code: "if (JSON.stringify(body).length > MAX_RESPONSE_BYTES) reject();", errors: 1 },
    {
      code: "const body = `${a}${b}`; if (MAX_RESPONSE_BYTES <= body.length) reject();",
      errors: 1,
    },
  ],
});

tester.run("fetch-needs-deadline", rules["fetch-needs-deadline"], {
  valid: [
    "await fetch(current, { redirect: 'manual', signal });",
    "await fetch(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]) });",
    "await fetch(url, { ...options });",
    // Options built elsewhere can't be checked here.
    "await fetch(url, init);",
    "function load(fetch) { return fetch(url); }",
  ],
  invalid: [
    { code: "await fetch(url);", errors: 1 },
    { code: "await fetch(url, { redirect: 'manual', headers });", errors: 1 },
    {
      // 3e2cf56: each request timed out, but the run as a whole had no deadline.
      code: "await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });",
      errors: 1,
    },
  ],
});

tester.run("blob-get-cache", rules["blob-get-cache"], {
  valid: [
    "import { get } from '@vercel/blob'; await get(path, { access: 'private', useCache: false });",
    "import { get } from '@vercel/blob'; await get(path, { access: 'private', useCache: true });",
    // Some other `get`.
    "import { get } from 'lodash'; get(object, 'a.b');",
    // Options passed as a variable can't be checked here.
    "import { get } from '@vercel/blob'; await get(path, options);",
  ],
  invalid: [
    {
      code: "import { get } from '@vercel/blob'; const result = await get(textPath(id), { access: 'private' });",
      errors: 1,
    },
    { code: "import { get as read } from '@vercel/blob'; await read(path);", errors: 1 },
    {
      code: "import * as blob from '@vercel/blob'; await blob.get(path, { access: 'private' });",
      errors: 1,
    },
  ],
});

tester.run("blob-etags", rules["blob-etags"], {
  valid: [
    "if (!sameEtag(record.textEtag, servedEtag)) return 'record-mismatch';",
    "if (record.textEtag === undefined) return;",
    "if (etag === void 0) return;",
    "if (typeof etag === 'string') use(etag);",
    "await put(path, text, { ifMatch: lockEtag });",
    "await put(path, text, { ifMatch: strongEtag(result.blob.etag) });",
  ],
  invalid: [
    { code: "if (record.textEtag !== saved.blob.etag) return 'record-mismatch';", errors: 1 },
    { code: "const same = textEtag == servedEtag;", errors: 1 },
    { code: "await put(path, json, { ifMatch: result.blob.etag });", errors: 1 },
  ],
});

tester.run("effect-cleanup", rules["effect-cleanup"], {
  valid: [
    "useEffect(() => { const id = window.setInterval(tick, 1000); return () => window.clearInterval(id); }, []);",
    "useEffect(() => { api.on('select', onSelect); api.on('reInit', onSelect); return () => { api.off('select', onSelect); api.off('reInit', onSelect); }; }, [api]);",
    "useEffect(() => { window.addEventListener('resize', onResize, { signal: controller.signal }); return () => controller.abort(); }, []);",
    "useEffect(() => { button.addEventListener('click', onClick, { once: true }); }, []);",
    // A cleanup this rule can't read is trusted.
    "useEffect(() => { const unsubscribe = store.on('change', update); return unsubscribe; }, []);",
    "React.useEffect(() => { const timeout = setTimeout(reset, 2000); return () => clearTimeout(timeout); }, [copied]);",
    // `off(event)` without a handler removes every handler for it.
    "useEffect(() => { api.on('select', onSelect); return () => { api.off('select'); }; }, [api]);",
    // A timer inside a handler the effect defines runs later, outside this check.
    "useEffect(() => { const onScroll = () => { setTimeout(save, 100); }; window.addEventListener('scroll', onScroll); return () => window.removeEventListener('scroll', onScroll); }, []);",
    // A cleanup that calls a helper may undo anything.
    "useEffect(() => { api.on('select', onSelect); return () => { teardown(); }; }, [api]);",
    "useEffect(() => { timer.current = setInterval(tick, 1000); return () => clearInterval(timer.current); }, []);",
    // Inherited names like toString and valueOf aren't timers.
    "useEffect(() => { const text = value.toString(); const raw = value.valueOf(); }, [value]);",
    // Events compare by value, whatever the quotes.
    `useEffect(() => { api.on('select', onSelect); return () => { api.off("select", onSelect); }; }, [api]);`,
    // The capture phase must match, however it's spelled.
    "useEffect(() => { window.addEventListener('click', onClick, { capture: true }); return () => window.removeEventListener('click', onClick, true); }, []);",
    // A concise body's result is the cleanup, like an unsubscribe function.
    "useEffect(() => api.on('select', onSelect), [api]);",
  ],
  invalid: [
    {
      // 6d2ac7d: the carousel removed `select` but not `reInit`.
      code: "useEffect(() => { if (!api) return; onSelect(api); api.on('reInit', onSelect); api.on('select', onSelect); return () => { api?.off('select', onSelect); }; }, [api, onSelect]);",
      errors: 1,
    },
    { code: "useEffect(() => { setInterval(tick, 1000); }, []);", errors: 1 },
    {
      code: "useLayoutEffect(() => { window.addEventListener('resize', onResize); return () => window.removeEventListener('scroll', onScroll); }, []);",
      errors: 1,
    },
    {
      // Each timer is matched by the variable holding its id.
      code: "useEffect(() => { const a = setInterval(f, 1000); const b = setInterval(g, 1000); return () => clearInterval(a); }, []);",
      errors: 1,
    },
    {
      // Removing a different handler leaves the first one attached.
      code: "useEffect(() => { window.addEventListener('resize', a); return () => window.removeEventListener('resize', b); }, []);",
      errors: 1,
    },
    {
      code: "useEffect(() => { button.addEventListener('click', update, { once: false }); }, []);",
      errors: 1,
    },
    {
      // Removing the bubbling listener leaves the capturing one attached.
      code: "useEffect(() => { window.addEventListener('click', onClick, true); return () => window.removeEventListener('click', onClick); }, []);",
      errors: 1,
    },
    {
      // A helper call next to other statements doesn't hide the missing off('reInit').
      code: "useEffect(() => { api.on('reInit', onSelect); api.on('select', onSelect); return () => { setReady(false); api.off('select', onSelect); }; }, [api]);",
      errors: 1,
    },
  ],
});
