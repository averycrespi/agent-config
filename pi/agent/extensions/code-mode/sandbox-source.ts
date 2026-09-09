// This bootstrap is trusted; guest code is compiled separately inside its context.
export function buildSandboxSource(
  source: string,
  concurrency: number,
): string {
  const setup = `(() => {
    const post = globalThis.__post;
    delete globalThis.__post;
    const stringify = JSON.stringify.bind(JSON);
    const parse = JSON.parse.bind(JSON);
    // Guest mutations must not change validation or invoke hooks during final serialization.
    const isArray = Array.isArray;
    const isFinite = Number.isFinite;
    const getPrototype = Object.getPrototypeOf;
    const objectPrototype = Object.prototype;
    const ownKeys = Reflect.ownKeys;
    const descriptor = Object.getOwnPropertyDescriptor;
    const hasOwn = Object.hasOwn;
    const create = Object.create;
    const define = Object.defineProperty;
    const setPrototype = Object.setPrototypeOf;
    const promiseThen = Function.prototype.call.bind(Promise.prototype.then);
    const seen = new Set();
    const seenHas = seen.has.bind(seen);
    const seenAdd = seen.add.bind(seen);
    const seenDelete = seen.delete.bind(seen);
    const pending = new Map();
    let next = 0;
    const mcp = Object.freeze({ call(name, args) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { post('{"type":"call","id":' + id + ',"name":' + stringify(name) + ',"args":' + stringify(args) + '}'); }
        catch { pending.delete(id); reject(new Error("Call must use JSON arguments")); }
      });
    }});
    async function parallel(thunks) {
      if (!Array.isArray(thunks) || thunks.some(t => typeof t !== "function")) throw new Error("parallel requires thunks");
      const values = new Array(thunks.length);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(${concurrency}, thunks.length) }, async () => {
        while (index < thunks.length) { const i = index++; values[i] = await thunks[i](); }
      }));
      return values;
    }
    function result(value) {
      try {
        function snapshot(v, depth) {
          if (depth > 100) throw 0;
          if (v === null || typeof v === "string" || typeof v === "boolean") return v;
          if (typeof v === "number" && isFinite(v)) return v;
          if (typeof v !== "object" || seenHas(v)) throw 0;
          const array = isArray(v);
          if (!array && getPrototype(v) !== objectPrototype && getPrototype(v) !== null) throw 0;
          seenAdd(v);
          // Null prototypes exclude inherited toJSON; descriptors avoid evaluating getters twice.
          const out = array ? setPrototype([], null) : create(null);
          const keys = ownKeys(v);
          let entries = 0;
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (array && key === "length") continue;
            if (typeof key !== "string") throw 0;
            const d = descriptor(v, key);
            if (!d || !hasOwn(d, "value") || !d.enumerable) throw 0;
            if (array && (!isFinite(+key) || +key < 0 || +key % 1 !== 0 || '' + (+key) !== key)) throw 0;
            define(out, key, { value: snapshot(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
            entries++;
          }
          if (array && entries !== descriptor(v, "length").value) throw 0;
          seenDelete(v);
          return out;
        }
        const json = stringify(snapshot(value, 0));
        post('{"type":"result","json":' + stringify(json) + '}');
      } catch { post('{"type":"failure","code":"invalid_result"}'); }
    }
    Object.defineProperties(globalThis, {
      mcp: { value: mcp }, parallel: { value: parallel },
    });
    return {
      complete: (promise) => promiseThen(promise, result, () => post('{"type":"failure","code":"script_error"}')),
      receive: (json) => {
      const message = parse(json);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.value);
      else {
        const error = new Error(message.error.code);
        Object.assign(error, message.error);
        entry.reject(error);
      }
    }};
  })()`;
  const program = `"use strict"; (async () => {\n${source}\n})();`;
  return `
import process from "node:process";
import { createContext, Script } from "node:vm";
const post = (json) => { if (typeof json === "string" && process.connected) process.send(json, () => {}); };
Object.setPrototypeOf(post, null);
const context = createContext(Object.assign(Object.create(null), { __post: post }), {
  codeGeneration: { strings: false, wasm: false },
});
const { receive, complete } = new Script(${JSON.stringify(setup)}).runInContext(context);
process.on("message", (json) => {
  if (typeof json === "string") { try { receive(json); } catch { post('{"type":"failure","code":"script_error"}'); } }
});
process.on("unhandledRejection", () => post('{"type":"failure","code":"script_error"}'));
try { complete(new Script(${JSON.stringify(program)}).runInContext(context)); }
catch { post('{"type":"failure","code":"script_error"}'); }
`;
}
