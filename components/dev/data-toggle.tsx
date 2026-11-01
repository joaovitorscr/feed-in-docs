"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SCENARIOS } from "@/components/dev/worst-case-data";

const emptySubscribe = () => () => {};
const readParam = () => new URLSearchParams(window.location.search).get("data") ?? "off";

function isHydrated(element: Element) {
  return Object.keys(element).some((key) => key.startsWith("__reactProps"));
}

/** Dev-only. Stubs /api/generate with a fixture, so the page itself is unchanged. */
export function DataToggle() {
  const active = useSyncExternalStore(emptySubscribe, readParam, () => "off");

  useEffect(() => {
    const scenario = SCENARIOS[active];
    if (!scenario) return;

    const realFetch = window.fetch;
    window.fetch = (input, init) =>
      String(input).endsWith("/api/generate")
        ? Promise.resolve(scenario.respond())
        : realFetch(input, init);

    let frame = 0;
    const submit = () => {
      const form = document.querySelector("form");
      const input = form?.querySelector("input");
      if (!form || !input || !isHydrated(form)) {
        frame = requestAnimationFrame(submit);
        return;
      }
      input.value = scenario.url;
      form.requestSubmit();
    };
    submit();

    return () => {
      cancelAnimationFrame(frame);
      window.fetch = realFetch;
    };
  }, [active]);

  function pick(id: string) {
    const url = new URL(window.location.href);
    if (id === "off") url.searchParams.delete("data");
    else url.searchParams.set("data", id);
    window.location.assign(url);
  }

  const options = [
    ["off", "Off"],
    ...Object.entries(SCENARIOS).map(([id, { label }]) => [id, label]),
  ];

  return (
    <div
      data-dev-toggle
      style={{ fontFamily: "system-ui" }}
      className="fixed bottom-3 left-1/2 z-50 flex w-max max-w-full -translate-x-1/2 flex-wrap justify-center gap-0.5 rounded-lg bg-neutral-200 p-0.5 text-xs text-neutral-700 shadow"
    >
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          onClick={() => pick(id)}
          className="rounded-md px-2 py-1 aria-pressed:bg-white aria-pressed:text-neutral-900"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
