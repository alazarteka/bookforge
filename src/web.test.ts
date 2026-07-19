import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readerJs } from "./web.js";

test("reader restores a saved position before it records the initial scroll position", () => {
  const values = new Map<string, string>([
    ["bookforge-reader", "{}"],
    ["bookforge-position:/chapters/one.html", "480"],
  ]);
  const events: string[] = [];
  const root = {
    dataset: {} as Record<string, string>,
    scrollHeight: 2000,
    style: { fontSize: "16px", setProperty: () => undefined },
  };
  const context = {
    document: {
      documentElement: root,
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { events.push(`set:${key}:${value}`); values.set(key, value); },
    },
    getComputedStyle: () => ({ fontSize: "16px", getPropertyValue: () => "42rem" }),
    addEventListener: () => undefined,
    scrollTo: (_x: number, y: number) => { events.push(`scroll:${y}`); },
    innerHeight: 900,
    scrollY: 0,
    location: { pathname: "/chapters/one.html" },
  };
  vm.runInNewContext(readerJs, context);
  assert.ok(events.indexOf("scroll:480") !== -1, "the saved position should be restored");
  assert.ok(events.indexOf("scroll:480") < events.indexOf("set:bookforge-position:/chapters/one.html:0"), "restore must precede initial persistence");
});
