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
  ],
  invalid: [
    {
      code: "const text = await response.text(); if (text.length > maxBytes) throw new Error('A documentation page is too large.');",
      errors: 1,
    },
    { code: "if (MAX_RESPONSE_BYTES <= body.length) reject();", errors: 1 },
  ],
});

tester.run("fetch-needs-deadline", rules["fetch-needs-deadline"], {
  valid: [
    "await fetch(current, { redirect: 'manual', signal });",
    "await fetch(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]) });",
    "await fetch(url, { ...options });",
    // Options built elsewhere can't be checked here.
    "await fetch(url, init);",
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
  ],
});
