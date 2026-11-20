import type { RuleTester } from "oxlint/plugins-dev";

// Rules for mistakes this codebase has already made once. Each rule names the fix it came from.
// .oxlintrc.json loads this file as a JS plugin; lint/plugin.test.ts covers every rule.
// The rules are syntactic: they see names and literals, not types, so each one says what it misses.

type Rule = Parameters<RuleTester["run"]>[1];
type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Call = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Node = Call["parent"];
type Expression = Call["callee"];

const READ_BODY = new Set(["text", "json", "arrayBuffer", "blob", "bytes", "formData"]);

/** The name an expression ends in: `x` for `x` and `a.b.x`, otherwise `null`. */
function nameOf(node: Node | Expression) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

/** Strips `await` and parentheses. */
function unwrap(node: Expression): Expression {
  if (node.type === "AwaitExpression") return unwrap(node.argument);
  if (node.type === "ParenthesizedExpression") return unwrap(node.expression);
  return node;
}

/** Whether the identifier `node` is declared in this file: a variable, parameter or import. */
function isLocal(context: Context, node: Expression) {
  if (node.type !== "Identifier") return false;
  let scope: ReturnType<Context["sourceCode"]["getScope"]> | null =
    context.sourceCode.getScope(node);
  for (; scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable) return variable.defs.length > 0;
  }
  return false;
}

/**
 * Whether `node` calls the global `fetch`: not a method such as `client.fetch`, and not a `fetch`
 * the file declares or receives as a parameter.
 */
function isGlobalFetch(context: Context, node: Expression) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "fetch" &&
    !isLocal(context, node.callee)
  );
}

/**
 * The value of a non-computed `key` in an object literal argument, written plain or quoted
 * (`capture` or `'capture'`), or `undefined`.
 */
function property(arg: Call["arguments"][number] | undefined, key: string) {
  if (arg?.type !== "ObjectExpression") return undefined;
  for (const prop of arg.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const name = prop.key.type === "Literal" ? prop.key.value : nameOf(prop.key);
    if (name === key) return prop.value;
  }
  return undefined;
}

/** Whether an object literal argument has a spread, so its keys can't be known. */
function hasSpread(arg: Call["arguments"][number] | undefined) {
  return arg?.type === "ObjectExpression" && arg.properties.some((p) => p.type === "SpreadElement");
}

/**
 * Every value the variable `node` names is given in this file: its initializer and each later
 * assignment, found through the scope it resolves in. Empty for parameters and globals.
 */
function valuesOf(context: Context, node: Expression) {
  if (node.type !== "Identifier") return [];
  let scope: ReturnType<Context["sourceCode"]["getScope"]> | null =
    context.sourceCode.getScope(node);
  for (; scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (!variable) continue;
    return variable.references.flatMap((ref) => (ref.writeExpr ? [unwrap(ref.writeExpr)] : []));
  }
  return [];
}

// b334621: fetchText buffered whole pages with response.text() before checking their size.
// Misses a response passed in as a parameter or stored on an object.
const noUnboundedBody = {
  meta: {
    type: "problem",
    docs: { description: "Read fetched bodies through readText, which stops at a byte limit." },
  },
  create(context) {
    const isFetch = (node: Expression) => isGlobalFetch(context, node);
    return {
      CallExpression(node) {
        const method = nameOf(node.callee);
        if (node.callee.type !== "MemberExpression" || !method || !READ_BODY.has(method)) return;
        const target = unwrap(node.callee.object);
        if (isFetch(target) || valuesOf(context, target).some(isFetch)) {
          context.report({
            node,
            message: `response.${method}() buffers the whole body before anything can check its size. Read it with readText, which cancels the download at a byte limit.`,
          });
        }
      },
    };
  },
} satisfies Rule;

const STRING_METHODS = new Set(["text", "stringify", "String", "join", "toString", "trim"]);

/** Whether `node` is known to make a string: a string literal, a template, or a string method. */
function isString(node: Expression) {
  if (node.type === "Literal") return typeof node.value === "string";
  if (node.type === "TemplateLiteral") return true;
  return node.type === "CallExpression" && STRING_METHODS.has(nameOf(node.callee) ?? "");
}

// b334621: a page's UTF-16 length was compared to MAX_BYTES, so multibyte pages passed.
// Only strings it can see being made count: a Uint8Array's or Buffer's `.length` is already bytes.
const bytesNotLength = {
  meta: {
    type: "problem",
    docs: { description: "Compare byte limits with byte counts, not string lengths." },
  },
  create(context) {
    const knownString = (node: Expression) =>
      isString(node) || valuesOf(context, node).some(isString);
    return {
      BinaryExpression(node) {
        if (![">", ">=", "<", "<="].includes(node.operator)) return;
        const sides = [node.left, node.right];
        const length = sides.find(
          (side) =>
            side.type === "MemberExpression" &&
            nameOf(side) === "length" &&
            side.object.type !== "Super" &&
            knownString(unwrap(side.object)),
        );
        const limit = sides.find((side) => /bytes/i.test(nameOf(side) ?? ""));
        if (length && limit) {
          context.report({
            node,
            message:
              "`.length` counts UTF-16 code units, not bytes, so multibyte text slips past a byte limit. Use Buffer.byteLength, or count bytes as they arrive.",
          });
        }
      },
    };
  },
} satisfies Rule;

// 3e2cf56: each fetch had its own AbortSignal.timeout but nothing bounded the whole run, so a large
// site ran until the platform killed the function and the user got a bare 504.
// Options passed as a variable or with a spread aren't checked.
const fetchNeedsDeadline = {
  meta: {
    type: "problem",
    docs: { description: "Server fetches pass a signal that includes the run's deadline." },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isGlobalFetch(context, node)) return;
        const options = node.arguments[1];
        if (options && options.type !== "ObjectExpression") return;
        if (hasSpread(options)) return;
        const signal = property(options, "signal");
        if (!signal) {
          context.report({
            node,
            message:
              "This fetch has no `signal`, so nothing stops it before the platform kills the function. Pass the run's deadline signal.",
          });
        } else if (
          signal.type === "CallExpression" &&
          signal.callee.type === "MemberExpression" &&
          nameOf(signal.callee.object) === "AbortSignal" &&
          nameOf(signal.callee) === "timeout"
        ) {
          context.report({
            node: signal,
            message:
              "A per-request timeout alone doesn't bound the run: many slow requests still outlast maxDuration. Combine it with the run's deadline through AbortSignal.any.",
          });
        }
      },
    };
  },
} satisfies Rule;

// 725b4b6: a cached get()'s last-modified is when the Blob CDN cached the file, so every link looked fresh.
const blobGetCache = {
  meta: {
    type: "problem",
    docs: { description: "Vercel Blob get() calls say whether the CDN cache may answer." },
  },
  create(context) {
    const getters = new Set<string>();
    const namespaces = new Set<string>();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@vercel/blob") return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name);
          if (spec.type === "ImportSpecifier" && nameOf(spec.imported) === "get") {
            getters.add(spec.local.name);
          }
        }
      },
      CallExpression(node) {
        const { callee } = node;
        const isGet =
          (callee.type === "Identifier" && getters.has(callee.name)) ||
          (callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            namespaces.has(callee.object.name) &&
            nameOf(callee) === "get");
        const options = node.arguments[1];
        // Options passed as a variable or with a spread can't be checked here.
        if (!isGet || (options && options.type !== "ObjectExpression") || hasSpread(options))
          return;
        if (property(options, "useCache")) return;
        context.report({
          node,
          message:
            "Pass `useCache`. Through the CDN, `last-modified` is when the CDN cached the file; `useCache: false` reads from origin.",
        });
      },
    };
  },
} satisfies Rule;

const ETAG = /etag$/i;

// 725b4b6: get() can return put()'s ETag marked weak (W/"…"), so `===` missed equal blobs.
// PR #23's preview: Blob rejects a W/ ETag in ifMatch, so the refresh lock never took.
// The ifMatch check only sees a `….blob.etag` written in place.
const blobEtags = {
  meta: {
    type: "problem",
    docs: { description: "Compare Blob ETags with sameEtag and pass ifMatch a strong ETag." },
  },
  create(context) {
    const isEtag = (node: Node | Expression) => ETAG.test(nameOf(node) ?? "");
    // A presence check, like `etag === undefined`, isn't a comparison of two ETags.
    const isNothing = (node: Node | Expression) =>
      (node.type === "Literal" && node.value === null) ||
      (node.type === "Identifier" && node.name === "undefined") ||
      (node.type === "UnaryExpression" && node.operator === "void");
    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return;
        const { left, right } = node;
        if (!(isEtag(left) || isEtag(right)) || isNothing(left) || isNothing(right)) return;
        context.report({
          node,
          message:
            'get() can return an ETag marked weak (W/"…") where put() returns it strong, so `===` can miss equal blobs. Compare with sameEtag.',
        });
      },
      Property(node) {
        if (node.computed || nameOf(node.key) !== "ifMatch") return;
        const { value } = node;
        if (
          value.type === "MemberExpression" &&
          isEtag(value) &&
          value.object.type !== "Super" &&
          nameOf(value.object) === "blob"
        ) {
          context.report({
            node,
            message:
              "A get()'s `blob.etag` can be weak, and Blob rejects a weak ETag in ifMatch. Strip the W/ first, as readRecord does.",
          });
        }
      },
    };
  },
} satisfies Rule;

const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);

// A Map, not an object, so inherited names like `toString` never count as timers.
const TIMERS = new Map([
  ["setInterval", "clearInterval"],
  ["setTimeout", "clearTimeout"],
  ["requestAnimationFrame", "cancelAnimationFrame"],
]);
const CLEARS = new Map([...TIMERS].map(([set, clear]) => [clear, set]));

/**
 * The phase a DOM listener's third argument picks: "capture" for `true` or `{ capture: true }`,
 * "bubble" when it's omitted or anything else literal, `null` when it can't be known.
 */
function phase(options: Call["arguments"][number] | undefined) {
  if (!options) return "bubble";
  if (options.type === "Literal") return options.value === true ? "capture" : "bubble";
  if (options.type !== "ObjectExpression" || hasSpread(options)) return null;
  const capture = property(options, "capture");
  if (!capture) return "bubble";
  return capture.type === "Literal" ? (capture.value === true ? "capture" : "bubble") : null;
}

function isFunction(node: Node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

// 6d2ac7d: the carousel's effect subscribed to reInit and select but only removed select.
// Starts are matched to stops by receiver, event, handler and capture phase, and timers by the
// variable that holds their id. Only starts in the effect's own body count, not ones inside
// handlers it defines. An effect is trusted when its cleanup is opaque: `return unsubscribe`, a
// cleanup whose only statement calls a helper, like `() => teardown()`, or a concise body like
// `() => api.on(…)`, whose result is the cleanup.
const effectCleanup = {
  meta: {
    type: "problem",
    docs: { description: "An effect's cleanup undoes every listener, timer and frame it starts." },
  },
  create(context) {
    const { sourceCode } = context;
    const text = (node: Node | Expression) => sourceCode.getText(node);
    type Effect = {
      starts: { node: Call; key: string; any?: string; fix: string }[];
      stops: Set<string>;
      opaque: boolean;
    };
    const effects = new Map<Node, Effect>();

    /** What `node` starts or stops, as a key the matching call shares, or `null`. */
    const action = (node: Call) => {
      const name = nameOf(node.callee) ?? "";
      const receiver = node.callee.type === "MemberExpression" ? text(node.callee.object) : "";
      // A string event compares by value, so 'select', "select" and `select` match.
      const [first, second] = node.arguments.map((arg) => {
        if (arg.type === "Literal" && typeof arg.value === "string")
          return JSON.stringify(arg.value);
        if (arg.type === "TemplateLiteral" && arg.expressions.length === 0) {
          return JSON.stringify(arg.quasis[0].value.cooked);
        }
        return text(arg);
      });
      const isDom = name === "addEventListener" || name === "removeEventListener";
      const listenerPhase = isDom ? phase(node.arguments[2]) : "";
      // `off(event)` with no handler removes them all, so it stops `any`.
      const base = (kind: string) => `${receiver} ${kind} ${listenerPhase} ${first}`;
      const listener = (kind: string) => `${base(kind)} ${second ?? "*"}`;
      if (isDom && listenerPhase === null) return null;
      if (name === "addEventListener") {
        const options = node.arguments[2];
        const once = property(options, "once");
        if (property(options, "signal") || hasSpread(options)) return null;
        if (once?.type === "Literal" && once.value === true) return null;
        const capture = listenerPhase === "capture" ? ", true" : "";
        const fix = `${receiver ? `${receiver}.` : ""}removeEventListener(${first}, ${second}${capture})`;
        return {
          kind: "start",
          key: listener("listener"),
          any: `${base("listener")} *`,
          fix,
        } as const;
      }
      if (name === "removeEventListener")
        return { kind: "stop", key: listener("listener") } as const;
      if (name === "on") {
        const fix = `${receiver}.off(${first}, ${second})`;
        return { kind: "start", key: listener("on"), any: `${base("on")} *`, fix } as const;
      }
      if (name === "off") return { kind: "stop", key: listener("on") } as const;
      const clear = TIMERS.get(name);
      if (clear) {
        const { parent } = node;
        const holder =
          parent.type === "VariableDeclarator" && parent.init === node
            ? text(parent.id)
            : parent.type === "AssignmentExpression" && parent.right === node
              ? text(parent.left)
              : null;
        if (!holder) {
          return {
            kind: "start",
            key: `${name} <unkept>`,
            fix: `${clear} on the id it returns`,
          } as const;
        }
        return { kind: "start", key: `${name} ${holder}`, fix: `${clear}(${holder})` } as const;
      }
      const set = CLEARS.get(name);
      if (set) return { kind: "stop", key: `${set} ${first}` } as const;
      return null;
    };

    /** The effect callback around `node`, and the path from it down to `node`. */
    const enclosingEffect = (node: Node) => {
      const ancestors = [node];
      for (let parent = node.parent; parent; parent = parent.parent) ancestors.unshift(parent);
      for (let i = ancestors.length - 2; i >= 0; i--) {
        const candidate = ancestors[i];
        const parent = candidate.parent;
        if (
          isFunction(candidate) &&
          parent?.type === "CallExpression" &&
          parent.arguments[0] === candidate &&
          EFFECTS.has(nameOf(parent.callee) ?? "")
        ) {
          return { callback: candidate, path: ancestors.slice(i + 1) };
        }
      }
      return null;
    };

    /** The cleanup function the effect returns, when `path` (below the callback) runs in it. */
    const cleanupOf = (callback: Node, path: Node[]) => {
      const first = path[0];
      // `useEffect(() => () => …)`: the concise body is the cleanup.
      if (callback.type === "ArrowFunctionExpression" && callback.expression) {
        return isFunction(first) ? first : null;
      }
      for (let i = 0; i < path.length - 1; i++) {
        if (isFunction(path[i])) return null;
        if (path[i].type === "ReturnStatement") return isFunction(path[i + 1]) ? path[i + 1] : null;
      }
      return null;
    };

    /** Whether `call` is the whole of the cleanup `fn`: its concise body, or its only statement. */
    const isWholeCleanup = (fn: Node, call: Call) => {
      if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
      const { body } = fn;
      if (body === call) return true;
      if (body?.type !== "BlockStatement" || body.body.length !== 1) return false;
      const [only] = body.body;
      return only.type === "ExpressionStatement" && only.expression === call;
    };

    const effectFor = (callback: Node) => {
      let effect = effects.get(callback);
      if (!effect) {
        effect = { starts: [], stops: new Set(), opaque: false };
        effects.set(callback, effect);
      }
      return effect;
    };

    return {
      ReturnStatement(node) {
        const found = enclosingEffect(node);
        if (!found || found.path.slice(0, -1).some(isFunction)) return;
        const { argument } = node;
        // A cleanup this rule can't see into, like `return unsubscribe`.
        if (argument && !isFunction(argument)) effectFor(found.callback).opaque = true;
      },
      CallExpression(node) {
        const found = enclosingEffect(node);
        if (!found) return;
        const { callback } = found;
        // `useEffect(() => api.on(…))`: the call's result is the cleanup. A timer returns an id
        // and addEventListener returns nothing, so neither counts.
        if (callback.type === "ArrowFunctionExpression" && callback.expression) {
          const { body } = callback;
          const callee = body.type === "CallExpression" ? (nameOf(body.callee) ?? "") : "";
          const noCleanup = TIMERS.has(callee) || callee === "addEventListener";
          if (
            body.type !== "ArrowFunctionExpression" &&
            body.type !== "FunctionExpression" &&
            !noCleanup
          ) {
            effectFor(callback).opaque = true;
          }
        }
        const cleanupFn = cleanupOf(callback, found.path);
        const cleanup = cleanupFn !== null;
        const step = action(node);
        // A cleanup that only calls a helper, like `() => teardown()`, may undo anything.
        if (
          !step &&
          cleanupFn &&
          node.callee.type === "Identifier" &&
          isWholeCleanup(cleanupFn, node)
        ) {
          effectFor(callback).opaque = true;
        }
        if (!step) return;
        const effect = effectFor(found.callback);
        if (step.kind === "stop" && cleanup) {
          effect.stops.add(step.key);
        } else if (step.kind === "start" && !cleanup) {
          // Inside a handler the effect defines, a start runs later, outside this check.
          if (found.path.slice(0, -1).some(isFunction)) return;
          effect.starts.push({
            node,
            key: step.key,
            any: "any" in step ? step.any : undefined,
            fix: step.fix,
          });
        }
      },
      "Program:exit"() {
        for (const effect of effects.values()) {
          if (effect.opaque) continue;
          for (const start of effect.starts) {
            if (effect.stops.has(start.key) || (start.any && effect.stops.has(start.any))) continue;
            context.report({
              node: start.node,
              message: `The effect's cleanup never undoes this, so it outlives the component. Call ${start.fix} in the function the effect returns.`,
            });
          }
        }
      },
    };
  },
} satisfies Rule;

export default {
  meta: { name: "feed-in-docs" },
  rules: {
    "no-unbounded-body": noUnboundedBody,
    "bytes-not-length": bytesNotLength,
    "fetch-needs-deadline": fetchNeedsDeadline,
    "blob-get-cache": blobGetCache,
    "blob-etags": blobEtags,
    "effect-cleanup": effectCleanup,
  },
};
