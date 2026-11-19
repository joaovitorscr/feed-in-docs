import type { RuleTester } from "oxlint/plugins-dev";

// Rules for mistakes this codebase has already made once. Each rule names the fix it came from.
// .oxlintrc.json loads this file as a JS plugin; lint/plugin.test.ts covers every rule.

type Rule = Parameters<RuleTester["run"]>[1];
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

function isCallTo(node: Expression | null | undefined, name: string) {
  return node?.type === "CallExpression" && nameOf(node.callee) === name;
}

/** The value of a non-computed `key` in an object literal argument, or `undefined`. */
function property(arg: Call["arguments"][number] | undefined, key: string) {
  if (arg?.type !== "ObjectExpression") return undefined;
  for (const prop of arg.properties) {
    if (prop.type === "Property" && !prop.computed && nameOf(prop.key) === key) return prop.value;
  }
  return undefined;
}

/** Whether an object literal argument has a spread, so its keys can't be known. */
function hasSpread(arg: Call["arguments"][number] | undefined) {
  return arg?.type === "ObjectExpression" && arg.properties.some((p) => p.type === "SpreadElement");
}

// b334621: fetchText buffered whole pages with response.text() before checking their size.
const noUnboundedBody = {
  meta: {
    type: "problem",
    docs: { description: "Read fetched bodies through readText, which stops at a byte limit." },
  },
  create(context) {
    const responses = new Set<string>();
    const remember = (name: string, init: Expression | null | undefined) => {
      if (init && isCallTo(unwrap(init), "fetch")) responses.add(name);
    };
    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier") remember(node.id.name, node.init);
      },
      AssignmentExpression(node) {
        if (node.left.type === "Identifier") remember(node.left.name, node.right);
      },
      CallExpression(node) {
        const method = nameOf(node.callee);
        if (node.callee.type !== "MemberExpression" || !method || !READ_BODY.has(method)) return;
        const target = unwrap(node.callee.object);
        const name = nameOf(target);
        if (
          isCallTo(target, "fetch") ||
          (target.type === "Identifier" && name && responses.has(name))
        ) {
          context.report({
            node,
            message: `response.${method}() buffers the whole body before anything can check its size. Read it with readText, which cancels the download at a byte limit.`,
          });
        }
      },
    };
  },
} satisfies Rule;

// b334621: a page's UTF-16 length was compared to MAX_BYTES, so multibyte pages passed.
const bytesNotLength = {
  meta: {
    type: "problem",
    docs: { description: "Compare byte limits with byte counts, not string lengths." },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (![">", ">=", "<", "<="].includes(node.operator)) return;
        const sides = [node.left, node.right];
        // `x.length` only: a variable named `length` may already hold bytes, like content-length.
        const length = sides.find(
          (side) => side.type === "MemberExpression" && nameOf(side) === "length",
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
const fetchNeedsDeadline = {
  meta: {
    type: "problem",
    docs: { description: "Server fetches pass a signal that includes the run's deadline." },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "fetch") return;
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
        if (!isGet || hasSpread(node.arguments[1]) || property(node.arguments[1], "useCache"))
          return;
        context.report({
          node,
          message:
            "Pass `useCache`. Through the CDN, `last-modified` is when the CDN cached the file and the ETag is marked weak; `useCache: false` reads from origin.",
        });
      },
    };
  },
} satisfies Rule;

const ETAG = /etag$/i;

// 725b4b6: get() returns put()'s ETag marked weak (W/"…"), so `===` never matched.
// PR #23's preview: Blob rejects a W/ ETag in ifMatch, so the refresh lock never took.
const blobEtags = {
  meta: {
    type: "problem",
    docs: { description: "Compare Blob ETags with sameEtag and pass ifMatch a strong ETag." },
  },
  create(context) {
    const isEtag = (node: Node | Expression) => ETAG.test(nameOf(node) ?? "");
    const isNothing = (node: Node | Expression) =>
      (node.type === "Literal" && node.value === null) ||
      (node.type === "Identifier" && node.name === "undefined") ||
      node.type === "UnaryExpression";
    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return;
        const { left, right } = node;
        if (!(isEtag(left) || isEtag(right)) || isNothing(left) || isNothing(right)) return;
        context.report({
          node,
          message:
            'get() returns ETags marked weak (W/"…") and put() returns them strong, so `===` misses equal blobs. Compare with sameEtag.',
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

/** What a call starts or stops inside an effect, as a key the matching call shares. */
function effectAction(node: Call, text: (node: Node | Expression) => string) {
  const name = nameOf(node.callee);
  const first = node.arguments[0];
  const event = first && first.type !== "SpreadElement" ? text(first) : "";
  switch (name) {
    case "addEventListener": {
      const options = node.arguments[2];
      if (property(options, "signal") || property(options, "once") || hasSpread(options))
        return null;
      return {
        kind: "start",
        key: `listener ${event}`,
        stop: `removeEventListener(${event})`,
      } as const;
    }
    case "removeEventListener":
      return { kind: "stop", key: `listener ${event}` } as const;
    case "on":
      return { kind: "start", key: `on ${event}`, stop: `off(${event})` } as const;
    case "off":
      return { kind: "stop", key: `on ${event}` } as const;
    case "setInterval":
      return { kind: "start", key: "interval", stop: "clearInterval" } as const;
    case "clearInterval":
      return { kind: "stop", key: "interval" } as const;
    case "setTimeout":
      return { kind: "start", key: "timeout", stop: "clearTimeout" } as const;
    case "clearTimeout":
      return { kind: "stop", key: "timeout" } as const;
    case "requestAnimationFrame":
      return { kind: "start", key: "frame", stop: "cancelAnimationFrame" } as const;
    case "cancelAnimationFrame":
      return { kind: "stop", key: "frame" } as const;
    default:
      return null;
  }
}

function isFunction(node: Node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

// 6d2ac7d: the carousel's effect subscribed to reInit and select but only removed select.
const effectCleanup = {
  meta: {
    type: "problem",
    docs: { description: "An effect's cleanup undoes every listener, timer and frame it starts." },
  },
  create(context) {
    const { sourceCode } = context;
    const text = (node: Node | Expression) => sourceCode.getText(node);
    type Effect = {
      starts: { node: Call; key: string; stop: string }[];
      stops: Set<string>;
      opaque: boolean;
    };
    const effects = new Map<Node, Effect>();

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

    /** Whether `path` (below the effect callback) runs inside the cleanup function it returns. */
    const inCleanup = (callback: Node, path: Node[]) => {
      const first = path[0];
      // `useEffect(() => () => …)`: the concise body is the cleanup.
      if (callback.type === "ArrowFunctionExpression" && callback.expression)
        return isFunction(first);
      for (let i = 0; i < path.length - 1; i++) {
        if (isFunction(path[i])) return false;
        if (path[i].type === "ReturnStatement") return isFunction(path[i + 1]);
      }
      return false;
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
        if (
          argument &&
          argument.type !== "ArrowFunctionExpression" &&
          argument.type !== "FunctionExpression"
        ) {
          effectFor(found.callback).opaque = true;
        }
      },
      CallExpression(node) {
        const action = effectAction(node, text);
        if (!action) return;
        const found = enclosingEffect(node);
        if (!found) return;
        const effect = effectFor(found.callback);
        const cleanup = inCleanup(found.callback, found.path);
        if (action.kind === "stop" && cleanup) effect.stops.add(action.key);
        if (action.kind === "start" && !cleanup)
          effect.starts.push({ node, key: action.key, stop: action.stop });
      },
      "Program:exit"() {
        for (const effect of effects.values()) {
          if (effect.opaque) continue;
          for (const start of effect.starts) {
            if (effect.stops.has(start.key)) continue;
            context.report({
              node: start.node,
              message: `The effect's cleanup never calls ${start.stop}, so this outlives the component. Undo it in the function the effect returns.`,
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
