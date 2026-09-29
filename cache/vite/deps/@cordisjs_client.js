import {
  require_dist
} from "./chunk-ANIJI2KE.js";
import {
  ElLoading,
  ElMessage,
  ElMessageBox,
  installer
} from "./chunk-J3F5HKF2.js";
import {
  useLocalStorage,
  usePreferredDark
} from "./chunk-ADMT64OL.js";
import {
  computed,
  createApp,
  customRef,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  isRef,
  markRaw,
  onErrorCaptured,
  onScopeDispose,
  provide,
  reactive,
  ref,
  resolveComponent,
  shallowReactive,
  shallowRef,
  toValue,
  watch,
  watchEffect
} from "./chunk-6PKE6CL2.js";
import "./chunk-OU5ECYPM.js";
import {
  marked
} from "./chunk-OY32IMSQ.js";
import {
  require_lib
} from "./chunk-RGNWO5BO.js";
import {
  __export,
  __publicField,
  __toESM
} from "./chunk-73RASFYN.js";

// node_modules/cosmokit/lib/index.mjs
function noop() {
}
function isNullable(value) {
  return value === null || value === void 0;
}
function isNonNullable(value) {
  return !isNullable(value);
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) {
    if (forced || source[key] !== void 0) result[key] = source[key];
  }
  return result;
}
function omit(source, keys) {
  if (!keys) return { ...source };
  const result = { ...source };
  for (const key of keys) {
    Reflect.deleteProperty(result, key);
  }
  return result;
}
function defineProperty(object, key, value) {
  return Object.defineProperty(object, key, { writable: true, value, enumerable: false });
}
function contain(array1, array2) {
  return array2.every((item) => array1.includes(item));
}
function intersection(array1, array2) {
  return array1.filter((item) => array2.includes(item));
}
function difference(array1, array2) {
  return array1.filter((item) => !array2.includes(item));
}
function union(array1, array2) {
  return Array.from(/* @__PURE__ */ new Set([...array1, ...array2]));
}
function deduplicate(array) {
  return [...new Set(array)];
}
function remove(list, item) {
  const index = list?.indexOf(item);
  if (index >= 0) {
    list.splice(index, 1);
    return true;
  } else {
    return false;
  }
}
function makeArray(source) {
  return Array.isArray(source) ? source : isNullable(source) ? [] : [source];
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
((Binary2) => {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    } else {
      return source;
    }
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(source).toString("base64");
    }
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) {
      buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    }
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) {
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    }
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }) ?? Object.keys({ ...a, ...b }).every((key) => deepEqual(a[key], b[key], strict));
}
function capitalize(source) {
  return source.charAt(0).toUpperCase() + source.slice(1);
}
function uncapitalize(source) {
  return source.charAt(0).toLowerCase() + source.slice(1);
}
function camelCase(source) {
  return source.replace(/[_-][a-z]/g, (str) => str.slice(1).toUpperCase());
}
function tokenize(source, delimiters, delimiter) {
  const output = [];
  let state = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      if (state === 1) {
        const next = source.charCodeAt(i + 1);
        if (next >= 97 && next <= 122) {
          output.push(delimiter);
        }
        output.push(code + 32);
      } else {
        if (state !== 0) {
          output.push(delimiter);
        }
        output.push(code + 32);
      }
      state = 1;
    } else if (code >= 97 && code <= 122) {
      output.push(code);
      state = 2;
    } else if (delimiters.includes(code)) {
      if (state !== 0) {
        output.push(delimiter);
      }
      state = 0;
    } else {
      output.push(code);
    }
  }
  return String.fromCharCode(...output);
}
function paramCase(source) {
  return tokenize(source, [45, 95], 45);
}
function snakeCase(source) {
  return tokenize(source, [45, 95], 95);
}
var camelize = camelCase;
var hyphenate = paramCase;
function formatProperty(key) {
  if (typeof key !== "string") return `[${key.toString()}]`;
  return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
function trimSlash(source) {
  return source.replace(/\/$/, "");
}
function sanitize(source) {
  if (!source.startsWith("/")) source = "/" + source;
  return trimSlash(source);
}
var Time;
((Time2) => {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
    if (typeof date === "number") date = new Date(date);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date) {
    const parsed = parseTime(date);
    if (parsed) {
      date = Date.now() + parsed;
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
    }
    return date ? new Date(date) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) {
      return Math.round(ms / Time2.day) + "d";
    } else if (abs >= Time2.hour - Time2.minute / 2) {
      return Math.round(ms / Time2.hour) + "h";
    } else if (abs >= Time2.minute - Time2.second / 2) {
      return Math.round(ms / Time2.minute) + "m";
    } else if (abs >= Time2.second) {
      return Math.round(ms / Time2.second) + "s";
    }
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/cordis/lib/index.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var _a;
var DisposableList = (_a = class {
  sn = 0;
  map = /* @__PURE__ */ new Map();
  weak = /* @__PURE__ */ new WeakMap();
  get length() {
    return this.map.size;
  }
  push(value) {
    const sn = ++this.sn;
    this.map.set(sn, value);
    this.weak.set(value, sn);
    return () => this.map.delete(sn);
  }
  delete(value) {
    const sn = this.weak.get(value);
    if (!sn) return false;
    return this.map.delete(sn);
  }
  clear() {
    const values = [...this.map.values()];
    this.map.clear();
    return values.reverse();
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return [...this];
  }
}, __name(_a, "DisposableList"), _a);
var symbols = {
  // internal symbols
  shadow: /* @__PURE__ */ Symbol.for("cordis.shadow"),
  caller: /* @__PURE__ */ Symbol.for("cordis.caller"),
  receiver: /* @__PURE__ */ Symbol.for("cordis.receiver"),
  original: /* @__PURE__ */ Symbol.for("cordis.original"),
  metadata: /* @__PURE__ */ Symbol.for("cordis.metadata"),
  initHooks: /* @__PURE__ */ Symbol.for("cordis.initHooks"),
  checkProto: /* @__PURE__ */ Symbol.for("cordis.checkProto"),
  // context symbols
  effect: /* @__PURE__ */ Symbol.for("cordis.effect"),
  filter: /* @__PURE__ */ Symbol.for("cordis.filter"),
  isolate: /* @__PURE__ */ Symbol.for("cordis.isolate"),
  intercept: /* @__PURE__ */ Symbol.for("cordis.intercept"),
  // service symbols
  init: /* @__PURE__ */ Symbol.for("cordis.init"),
  check: /* @__PURE__ */ Symbol.for("cordis.check"),
  config: /* @__PURE__ */ Symbol.for("cordis.config"),
  invoke: /* @__PURE__ */ Symbol.for("cordis.invoke"),
  extend: /* @__PURE__ */ Symbol.for("cordis.extend"),
  tracker: /* @__PURE__ */ Symbol.for("cordis.tracker"),
  resolveConfig: /* @__PURE__ */ Symbol.for("cordis.resolveConfig")
};
var GeneratorFunction = (function* () {
}).constructor;
var AsyncGeneratorFunction = (async function* () {
}).constructor;
function isConstructor(func) {
  if (!func.prototype) return false;
  if (func instanceof GeneratorFunction) return false;
  if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
  return true;
}
__name(isConstructor, "isConstructor");
function joinPrototype(proto1, proto2) {
  if (proto1 === Object.prototype) return proto2;
  const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
  for (const key of Reflect.ownKeys(proto1)) {
    Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
  }
  return result;
}
__name(joinPrototype, "joinPrototype");
function isObject(value) {
  return value && (typeof value === "object" || typeof value === "function");
}
__name(isObject, "isObject");
function getPropertyDescriptor(target, prop) {
  let proto = target;
  while (proto) {
    const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
}
__name(getPropertyDescriptor, "getPropertyDescriptor");
function getTraceable(ctx, value) {
  if (!isObject(value)) return value;
  if (Object.hasOwn(value, symbols.shadow)) {
    return Object.getPrototypeOf(value);
  }
  const tracker = value[symbols.tracker];
  if (!tracker) return value;
  return createTraceable(ctx, value, tracker);
}
__name(getTraceable, "getTraceable");
function withProps(target, props) {
  if (!props) return target;
  return new Proxy(target, {
    get: __name((target2, prop, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
      return Reflect.get(target2, prop, receiver);
    }, "get"),
    set: __name((target2, prop, value, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
      return Reflect.set(target2, prop, value, receiver);
    }, "set")
  });
}
__name(withProps, "withProps");
function withProp(target, prop, value) {
  return withProps(target, Object.defineProperty(/* @__PURE__ */ Object.create(null), prop, {
    value,
    writable: false
  }));
}
__name(withProp, "withProp");
function createShadow(useSite, target, property, receiver) {
  if (!property) return receiver;
  const value = getPropertyDescriptor(target, property)?.value;
  if (!value) return receiver;
  const defSite = value[symbols.shadow] ?? value;
  return withProp(receiver, property, useSite.extend({ [symbols.shadow]: defSite }));
}
__name(createShadow, "createShadow");
function createShadowMethod(ctx, value, outer, shadow) {
  return new Proxy(value, {
    apply: __name((target, thisArg, args) => {
      if (thisArg === outer) thisArg = shadow;
      return getTraceable(ctx, Reflect.apply(target, thisArg, args));
    }, "apply")
  });
}
__name(createShadowMethod, "createShadowMethod");
function createTraceable(ctx, value, tracker) {
  const defSite = ctx[symbols.shadow] ?? ctx;
  const useSite = ctx[symbols.shadow] ? Object.getPrototypeOf(ctx) : ctx;
  const proxy = new Proxy(value, {
    get: __name((target, prop, receiver) => {
      if (prop === symbols.original) return target;
      if (prop === symbols.caller) return defSite;
      if (prop === tracker.property) return useSite;
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      if (tracker.associate && useSite.reflect.props[`${tracker.associate}.${prop}`]) {
        return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
      }
      let shadow, innerValue;
      const desc = getPropertyDescriptor(target, prop);
      if (desc && "value" in desc) {
        innerValue = desc.value;
      } else {
        shadow = createShadow(useSite, target, tracker.property, receiver);
        innerValue = Reflect.get(target, prop, shadow);
      }
      const innerTracker = innerValue?.[symbols.tracker];
      if (innerTracker) {
        return createTraceable(useSite, innerValue, innerTracker);
      } else if (!tracker.noShadow && typeof innerValue === "function") {
        shadow ??= createShadow(useSite, target, tracker.property, receiver);
        return createShadowMethod(useSite, innerValue, receiver, shadow);
      } else {
        return innerValue;
      }
    }, "get"),
    set: __name((target, prop, value2, receiver) => {
      if (prop === symbols.original) return false;
      if (prop === symbols.caller) return false;
      if (prop === tracker.property) return false;
      if (typeof prop === "symbol") {
        return Reflect.set(target, prop, value2, receiver);
      }
      if (tracker.associate && useSite.reflect.props[`${tracker.associate}.${prop}`]) {
        return Reflect.set(ctx, `${tracker.associate}.${prop}`, value2, withProp(ctx, symbols.receiver, receiver));
      }
      const shadow = createShadow(useSite, target, tracker.property, receiver);
      return Reflect.set(target, prop, value2, shadow);
    }, "set"),
    apply: __name((target, thisArg, args) => {
      const receiver = tracker.noShadow ? proxy : createShadow(useSite, target, tracker.property, proxy);
      return applyTraceable(receiver, target, thisArg, args);
    }, "apply")
  });
  return proxy;
}
__name(createTraceable, "createTraceable");
function applyTraceable(proxy, value, thisArg, args) {
  if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
  return value[symbols.invoke].apply(proxy, args);
}
__name(applyTraceable, "applyTraceable");
function createCallable(name, proto, tracker) {
  const self = __name(function(...args) {
    const proxy = createTraceable(self["ctx"], self, tracker);
    return Reflect.apply(proxy, this, args);
  }, "self");
  defineProperty(self, "name", name);
  return Object.setPrototypeOf(self, proto);
}
__name(createCallable, "createCallable");
function handleError(info, reason, getOuterStack) {
  const innerLines = info.error.stack.split("\n");
  if (typeof reason?.stack !== "string") {
    const outerError = new Error(reason);
    const lines2 = outerError.stack.split("\n");
    lines2.splice(1, Infinity, ...getOuterStack());
    outerError.stack = lines2.join("\n");
    throw outerError;
  }
  const lines = reason.stack.split("\n");
  let index = lines.indexOf(innerLines[2]);
  if (index === -1) throw reason;
  index -= info.offset;
  while (index > 0) {
    if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
    index -= 1;
  }
  lines.splice(index, Infinity, ...getOuterStack());
  reason.stack = lines.join("\n");
  throw reason;
}
__name(handleError, "handleError");
function composeError(callback, getOuterStack = buildOuterStack()) {
  const info = { offset: 1, error: new Error() };
  try {
    const result = callback(info);
    if (isObject(result) && "then" in result) {
      return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
    } else {
      return result;
    }
  } catch (reason) {
    handleError(info, reason, getOuterStack);
  }
}
__name(composeError, "composeError");
function buildOuterStack(offset = 0) {
  const outerError = new Error();
  return () => outerError.stack.split("\n").slice(3 + offset);
}
__name(buildOuterStack, "buildOuterStack");
function isBailed(value) {
  return value !== null && value !== false && value !== void 0;
}
__name(isBailed, "isBailed");
var _a2;
var EventsService = (_a2 = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.on("internal/listener", function(name, listener, options) {
      if (name === "internal/update" && !options.global) {
        const hooks = this.fiber._hooks["internal/update"] ??= new DisposableList();
        const method = options.prepend ? "unshift" : "push";
        return hooks[method](listener);
      }
    });
    this.on("internal/update", function(config, noSave, next) {
      const cbs = [...this._hooks["internal/update"] || []];
      const _next = __name(() => {
        const cb = cbs.shift() ?? next;
        return cb.call(this, config, noSave, _next);
      }, "_next");
      return _next();
    }, { global: true, prepend: true });
  }
  ctx;
  _hooks = /* @__PURE__ */ Object.create(null);
  _resolve(type, args) {
    const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
    const name = args.shift();
    if ((typeof name !== "string" || !name.startsWith("internal/")) && this._hooks["internal/dispatch"]?.length) {
      this.emit("internal/dispatch", type, name, args, thisArg);
    }
    const filter = thisArg?.[Context.filter];
    return [thisArg, (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback)];
  }
  /** @deprecated */
  dispatch(type, args) {
    const [thisArg, callbacks] = this._resolve(type, args);
    return callbacks.map((callback) => callback.bind(thisArg));
  }
  async parallel(...args) {
    const [thisArg, callbacks] = this._resolve("emit", args);
    const results = await Promise.allSettled(callbacks.map(async (callback) => Reflect.apply(callback, thisArg, args)));
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
  }
  emit(...args) {
    const [thisArg, callbacks] = this._resolve("emit", args);
    for (const callback of callbacks) Reflect.apply(callback, thisArg, args);
  }
  async serial(...args) {
    const [thisArg, callbacks] = this._resolve("serial", args);
    for (const callback of callbacks) {
      const result = await Reflect.apply(callback, thisArg, args);
      if (isBailed(result)) return result;
    }
  }
  bail(...args) {
    const [thisArg, callbacks] = this._resolve("bail", args);
    for (const callback of callbacks) {
      const result = Reflect.apply(callback, thisArg, args);
      if (isBailed(result)) return result;
    }
  }
  waterfall(...args) {
    const [thisArg, callbacks] = this._resolve("waterfall", args);
    const inner = args.pop();
    const dispatch = __name(() => {
      const callback = callbacks.shift();
      if (!callback) return inner();
      let called = false;
      const next = __name(() => {
        if (called) throw new Error("next() called multiple times");
        called = true;
        return dispatch();
      }, "next");
      return Reflect.apply(callback, thisArg, [...args, next]);
    }, "dispatch");
    return dispatch();
  }
  register(label, name, callback, options) {
    const method = options.prepend ? "unshift" : "push";
    return this.ctx.fiber.effect(() => {
      const hooks = this._hooks[name] ??= [];
      hooks[method]({ ctx: this.ctx, callback, ...options });
      return () => this.unregister(name, callback);
    }, label);
  }
  unregister(name, callback) {
    const hooks = this._hooks[name];
    if (!hooks) return;
    const index = hooks.findIndex((hook) => hook.callback === callback);
    if (index >= 0) {
      hooks.splice(index, 1);
      if (!hooks.length) delete this._hooks[name];
      return true;
    }
  }
  on(name, listener, options) {
    if (typeof options !== "object") {
      options = { prepend: options };
    }
    this.ctx.fiber.assertActive();
    listener = this.ctx.reflect.bind(listener);
    const result = this.bail(this.ctx, "internal/listener", name, listener, options);
    if (result) return result;
    const label = `ctx.on(${typeof name === "string" ? JSON.stringify(name) : name.toString()})`;
    return this.register(label, name, listener, options);
  }
  once(name, listener, options) {
    const dispose = this.on(name, function(...args) {
      dispose();
      return listener.apply(this, args);
    }, options);
    return dispose;
  }
}, __name(_a2, "EventsService"), _a2);
var LoggerLevel = ((LoggerLevel2) => {
  LoggerLevel2[LoggerLevel2["ERROR"] = 0] = "ERROR";
  LoggerLevel2[LoggerLevel2["WARN"] = 1] = "WARN";
  LoggerLevel2[LoggerLevel2["INFO"] = 2] = "INFO";
  LoggerLevel2[LoggerLevel2["DEBUG"] = 3] = "DEBUG";
  return LoggerLevel2;
})(LoggerLevel || {});
var defaultFormatters = {
  s: __name((value) => String(value), "s"),
  d: __name((value) => Math.trunc(Number(value)), "d"),
  i: __name((value) => Math.trunc(Number(value)), "i"),
  f: __name((value) => Number(value), "f"),
  o: __name((value) => JSON.stringify(value), "o"),
  O: __name((value) => JSON.stringify(value), "O"),
  c: __name(() => "", "c"),
  C: __name((value, exporter, message2) => {
    return Logger.color(exporter, Logger.code(message2.name, exporter.colors), value);
  }, "C")
};
function isAggregateError(error) {
  return error instanceof Error && Array.isArray(error["errors"]);
}
__name(isAggregateError, "isAggregateError");
var _a3;
var Logger = (_a3 = class {
  constructor(options, service) {
    this.service = service;
    Object.assign(this, options);
    this.error = this._method(
      "error",
      0
      /* ERROR */
    );
    this.info = this._method(
      "info",
      2
      /* INFO */
    );
    this.warn = this._method(
      "warn",
      1
      /* WARN */
    );
    this.debug = this._method(
      "debug",
      3
      /* DEBUG */
    );
  }
  service;
  static color(exporter, code, value, decoration = "") {
    if (!exporter.colors) return "" + value;
    return `\x1B[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\x1B[0m`;
  }
  static code(name, level) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 3) - hash + name.charCodeAt(i) + 13;
      hash |= 0;
    }
    const colors = !level ? [] : level >= 2 ? c256 : c16;
    return colors[Math.abs(hash) % colors.length];
  }
  static format(exporter, message2) {
    const args = message2.args.slice();
    if (args[0] instanceof Error) {
      args[0] = args[0].stack || args[0].message;
      args.unshift("%s");
    } else if (typeof args[0] !== "string") {
      args.unshift("%o");
    }
    let format = args.shift();
    format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
      if (match === "%%") return "%";
      const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
      if (typeof formatter === "function") {
        const value = args.shift();
        return formatter(value, exporter, message2);
      }
      return match;
    });
    const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
    for (let arg of args) {
      if (typeof arg === "object" && arg) {
        arg = oFormatter(arg, exporter, message2);
      }
      format += " " + arg;
    }
    const { maxLength = 10240 } = exporter;
    return format.split(/\r?\n/g).map((line) => {
      return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
    }).join("\n");
  }
  _method(type, level) {
    return (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        if (args[0].cause) {
          this[type](args[0].cause);
        } else if (isAggregateError(args[0])) {
          args[0].errors.forEach((error) => this[type](error));
          return;
        }
      }
      const sn = ++this.service._snMessage;
      const ts = Date.now();
      for (const exporter of this.service.exporters.values()) {
        const targetLevel = exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 2;
        if (targetLevel < level) continue;
        const message2 = { sn, ts, type, level, name: this.name, ...this.meta, args };
        exporter.export(message2);
      }
    };
  }
}, __name(_a3, "Logger"), _a3);
var c16 = [6, 2, 3, 4, 5, 1];
var c256 = [
  20,
  21,
  26,
  27,
  32,
  33,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  56,
  57,
  62,
  63,
  68,
  69,
  74,
  75,
  76,
  77,
  78,
  79,
  80,
  81,
  92,
  93,
  98,
  99,
  112,
  113,
  129,
  134,
  135,
  148,
  149,
  160,
  161,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  171,
  172,
  173,
  178,
  179,
  184,
  185,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  203,
  204,
  205,
  206,
  207,
  208,
  209,
  214,
  215,
  220,
  221
];
var _a4;
var LoggerService = (_a4 = class {
  bufferSize = 1e3;
  buffer = [];
  ctx;
  _snMessage = 0;
  _snExporter = 0;
  exporters = /* @__PURE__ */ new Map();
  constructor(ctx) {
    const tracker = {
      property: "ctx",
      noShadow: true
    };
    const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    Object.assign(self, this);
    self.ctx = ctx;
    defineProperty(self, symbols.tracker, tracker);
    self.exporter({
      colors: 3,
      export: __name((message2) => {
        self.buffer.push(message2);
        const overflow = self.buffer.length - self.bufferSize;
        if (overflow === 1) {
          self.buffer.shift();
        } else if (overflow > 1) {
          self.buffer.splice(0, overflow);
        }
      }, "export")
    });
    return self;
  }
  exporter(exporter) {
    return this.ctx.effect(() => {
      const id = ++this._snExporter;
      this.exporters.set(id, exporter);
      return () => this.exporters.delete(id);
    }, "ctx.logger.exporter()");
  }
  _resolveConfig() {
    let intercept = this.ctx[symbols.intercept];
    const configs = [];
    while ("logger" in intercept) {
      if (Object.hasOwn(intercept, "logger")) {
        configs.unshift(intercept["logger"]);
      }
      intercept = Object.getPrototypeOf(intercept);
    }
    return Object.assign({}, ...configs);
  }
  [symbols.invoke](name) {
    const config = this._resolveConfig();
    const caller = this[symbols.caller];
    const fiber = (caller ?? this.ctx).fiber;
    name ??= config.name;
    name ??= hyphenate(fiber.name);
    return new Logger({
      name,
      level: config.level,
      meta: { fiber: new WeakRef(fiber) }
    }, this);
  }
}, __name(_a4, "LoggerService"), (() => {
  for (const type of ["error", "info", "warn", "debug"]) {
    ;
    _a4.prototype[type] = function(...args) {
      return this()[type](...args);
    };
  }
})(), _a4);
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
var _a5;
var ValidationError = (_a5 = class extends TypeError {
  name = "ValidationError";
  constructor(issues) {
    super(`invalid config:
` + issues.map((issue) => {
      if (issue.path) {
        return `  - ${issue.message} (at ${issue.path.join(".")})`;
      } else {
        return `  - ${issue.message}`;
      }
    }).join("\n"));
  }
}, __name(_a5, "ValidationError"), _a5);
Object.defineProperty(ValidationError.prototype, kValidationError, {
  value: true
});
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config["~standard"].validate(config);
  if ("then" in result) {
    throw new TypeError("Async config validation is not supported");
  }
  if (result.issues) {
    throw new ValidationError(result.issues);
  } else {
    return result.value;
  }
}
__name(resolveConfig, "resolveConfig");
var FiberState = ((FiberState2) => {
  FiberState2[FiberState2["PENDING"] = 0] = "PENDING";
  FiberState2[FiberState2["LOADING"] = 1] = "LOADING";
  FiberState2[FiberState2["ACTIVE"] = 2] = "ACTIVE";
  FiberState2[FiberState2["FAILED"] = 3] = "FAILED";
  FiberState2[FiberState2["DISPOSED"] = 4] = "DISPOSED";
  FiberState2[FiberState2["UNLOADING"] = 5] = "UNLOADING";
  return FiberState2;
})(FiberState || {});
var _a6;
var CordisError = (_a6 = class extends Error {
  constructor(code, message2) {
    super(message2 ?? _a6.Code[code]);
    this.code = code;
  }
  code;
}, __name(_a6, "CordisError"), _a6);
((CordisError2) => {
  CordisError2.Code = {
    INACTIVE_EFFECT: "cannot create effect on inactive context"
  };
})(CordisError || (CordisError = {}));
var INACTIVE = "__INACTIVE__";
var _a7;
var Fiber = (_a7 = class {
  constructor(parent, config, inject2, runtime, getOuterStack) {
    this.parent = parent;
    this.inject = inject2;
    this.runtime = runtime;
    const collect = __name((dispose) => {
      this._disposables.push(dispose);
    }, "collect");
    if (runtime) {
      this.uid = parent.registry.counter;
      this.ctx = this.context = parent.extend({ fiber: this });
      const injectEntries = Object.entries(this.inject);
      if (injectEntries.length) {
        this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
        for (const [name, config2] of injectEntries) {
          if (isNullable(config2)) continue;
          this.ctx[Context.intercept][name] = config2;
        }
      }
      this._runner = {
        epoch: INACTIVE,
        getOuterStack,
        execute: __name(function() {
          if (isConstructor(runtime.callback)) {
            const instance = new runtime.callback(this.ctx, this.config);
            for (const hook of instance?.[symbols.initHooks] ?? []) {
              hook();
            }
            return instance?.[symbols.init]?.();
          } else {
            return runtime.callback(this.ctx, this.config);
          }
        }, "execute"),
        collect
      };
      this.context.emit("internal/plugin", this);
      for (const name of Object.keys(this.inject)) {
        this._checkImpl(name);
      }
      this.dispose = parent.fiber.effect(() => {
        const remove2 = runtime.fibers.push(this);
        try {
          this.config = resolveConfig(runtime, config);
          this._refresh();
        } catch (error) {
          this.ctx.logger.error(error);
          this._error = error;
        }
        return async () => {
          this.uid = null;
          this.context.emit("internal/plugin", this);
          if (this.ctx.registry.has(runtime.callback)) {
            remove2();
            if (!runtime.fibers.length) {
              this.ctx.registry.delete(runtime.callback);
            }
          }
          this._setEpoch(INACTIVE);
          while (this.inertia) {
            await this.inertia;
          }
        };
      }, "ctx.plugin()");
    } else {
      this.uid = 0;
      this.ctx = this.context = parent;
      this.state = 2;
      this.store = /* @__PURE__ */ Object.create(null);
      this._runner = {
        epoch: "",
        getOuterStack,
        execute: __name(() => {
        }, "execute"),
        collect
      };
      this.dispose = () => this.restart();
    }
  }
  parent;
  inject;
  runtime;
  uid;
  ctx;
  config;
  state = 0;
  dispose;
  store;
  inertia;
  _hooks = /* @__PURE__ */ Object.create(null);
  _disposables = new DisposableList();
  // Same as `this.ctx`, but with a more specific type.
  context;
  _error;
  _runner;
  _store = /* @__PURE__ */ Object.create(null);
  get name() {
    let fiber = this;
    do {
      if (fiber.runtime?.name) return fiber.runtime.name;
      fiber = fiber.parent.fiber;
    } while (fiber !== fiber.parent.fiber);
    return "root";
  }
  assertActive() {
    if (this.uid !== null) return;
    throw new CordisError("INACTIVE_EFFECT");
  }
  _execute(runner) {
    const oldEpoch = runner.epoch;
    return composeError((info) => {
      const safeCollect = __name((dispose) => {
        if (typeof dispose === "function") {
          runner.collect(dispose);
        } else if (!isNullable(dispose)) {
          throw new TypeError("Invalid effect");
        }
      }, "safeCollect");
      const effect = runner.execute.call(this);
      if (typeof effect === "function") {
        return runner.collect(effect);
      } else if (isNullable(effect)) {
      } else if (!isObject(effect)) {
        throw new TypeError("Invalid effect");
      } else if ("then" in effect) {
        return effect.then(safeCollect);
      } else if (Symbol.iterator in effect) {
        info.error = new Error();
        const iter = effect[Symbol.iterator]();
        while (true) {
          const result = iter.next();
          safeCollect(result.value);
          if (result.done) return;
        }
      } else if (Symbol.asyncIterator in effect) {
        const iter = effect[Symbol.asyncIterator]();
        return (async () => {
          await Promise.resolve();
          info.error = new Error();
          while (true) {
            if (runner.epoch !== oldEpoch) return;
            const result = await iter.next();
            safeCollect(result.value);
            if (result.done) return;
          }
        })();
      } else {
        throw new TypeError("Invalid effect");
      }
    }, runner.getOuterStack);
  }
  effect(execute, label = "anonymous") {
    this.assertActive();
    const disposables = [];
    const dispose = __name(() => {
      let task2;
      for (const dispose2 of disposables.splice(0).reverse()) {
        if (task2) {
          task2 = task2.then(dispose2);
        } else {
          const result = dispose2();
          if (isObject(result) && "then" in result) {
            task2 = result;
          }
        }
      }
      return task2;
    }, "dispose");
    const meta = { label, children: [] };
    const runner = {
      execute,
      epoch: true,
      collect: __name((dispose2) => {
        disposables.push(dispose2);
        this._disposables.delete(dispose2);
        if (dispose2[symbols.effect]) {
          meta.children.push(dispose2[symbols.effect]);
        }
      }, "collect"),
      getOuterStack: buildOuterStack()
    };
    let task;
    try {
      task = this._execute(runner);
    } catch (reason) {
      dispose();
      throw reason;
    }
    task?.catch(dispose).catch((error) => this.ctx.logger.error(error));
    const wrapper = defineProperty(() => {
      if (!runner.epoch) return;
      runner.epoch = false;
      return task ? task.then(dispose) : dispose();
    }, symbols.effect, meta);
    const disposeAsync = __name(() => {
      if (!runner.epoch) return;
      runner.epoch = false;
      return dispose();
    }, "disposeAsync");
    wrapper.then = async (onFulfilled, onRejected) => {
      return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
    };
    disposables.push(this._disposables.push(wrapper));
    return wrapper;
  }
  getEffects() {
    return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
  }
  _getState() {
    if (this.uid === null) return 4;
    if (this._error) return 3;
    if (this._runner.epoch !== INACTIVE) return 2;
    return 0;
  }
  _updateState(callback) {
    const oldState = this.state;
    this.state = callback() ?? this._getState();
    if (oldState === this.state) return;
    this.context.emit("internal/status", this, oldState);
    if (oldState !== 2 && this.state !== 2) return;
    for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
      const impl = this.ctx.reflect.store[key];
      if (impl.fiber !== this) continue;
      this.ctx.reflect.notify([impl.name]);
    }
  }
  _checkImpl(name) {
    const impl = this.ctx.reflect._getImpl(name, true);
    if (!impl) return delete this._store[name];
    try {
      if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) {
        return delete this._store[name];
      }
    } catch (error) {
      impl.fiber.ctx.logger.error(error);
      return delete this._store[name];
    }
    this._store[name] = impl;
  }
  _refresh() {
    let epoch = false;
    epoch = "";
    for (const name of Object.keys(this.inject)) {
      const impl = this._store[name];
      if (!impl) {
        epoch = INACTIVE;
        break;
      }
      epoch += ":" + impl.fiber.uid;
    }
    this._setEpoch(epoch);
  }
  _setEpoch(epoch) {
    const oldEpoch = this._runner.epoch;
    if (epoch === oldEpoch) return;
    if (this._error) return;
    this._runner.epoch = epoch;
    if (this.inertia) return;
    this._updateState(() => {
      if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
        this.inertia = this._reload();
        return 1;
      } else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  async _reload() {
    this.store = { ...this._store };
    const oldEpoch = this._runner.epoch;
    try {
      await Promise.resolve();
      await this._execute(this._runner);
    } catch (reason) {
      this.ctx.logger.error(reason);
      this._error = reason;
      this._runner.epoch = INACTIVE;
    }
    this._updateState(() => {
      if (this._runner.epoch === oldEpoch) {
        this.inertia = void 0;
      } else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  async _unload() {
    await Promise.all(this._disposables.clear().map(async (dispose) => {
      try {
        await composeError(async (info) => {
          await Promise.resolve();
          info.error = new Error();
          await dispose();
        }, this._runner.getOuterStack);
      } catch (reason) {
        this.ctx.logger.error(reason);
      }
    }));
    this.store = void 0;
    this._updateState(() => {
      if (this._runner.epoch === INACTIVE) {
        this.inertia = void 0;
      } else {
        this.inertia = this._reload();
        return 1;
      }
    });
  }
  async await() {
    while (this.inertia) {
      await this.inertia;
    }
    if (this._error) throw this._error;
    return this;
  }
  async restart() {
    const fiber = this.ctx.fiber;
    fiber.assertActive();
    fiber._setEpoch(INACTIVE);
    fiber._refresh();
    await fiber.await();
  }
  update(config, noSave = false) {
    const fiber = this.ctx.fiber;
    fiber.assertActive();
    config = resolveConfig(fiber.runtime, config);
    const result = fiber.context.waterfall(fiber, "internal/update", config, noSave, () => {
      fiber.config = config;
      fiber._error = void 0;
      return fiber.restart();
    });
    if (result === void 0) return;
    const task = Promise.resolve(result);
    task.catch(() => {
    });
    return task;
  }
}, __name(_a7, "Fiber"), _a7);
function enhanceError(error) {
  const lines = error.stack.split("\n");
  lines.splice(0, 2, `Error: ${error.message}`);
  error.stack = lines.join("\n");
  return error;
}
__name(enhanceError, "enhanceError");
var RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
  return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
__name(isSpecialProperty, "isSpecialProperty");
var _a8;
var ReflectService = (_a8 = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.mixin("reflect", ["get", "set", "provide", "accessor", "mixin"]);
    this.mixin("fiber", ["runtime", "effect"]);
    this.mixin("registry", ["inject", "plugin"]);
    this.mixin("events", ["on", "once", "parallel", "emit", "serial", "bail", "waterfall"]);
  }
  ctx;
  store = /* @__PURE__ */ Object.create(null);
  props = /* @__PURE__ */ Object.create(null);
  get(name, strict = true) {
    return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
  }
  _getImpl(name, strict = true) {
    const key = this.ctx[symbols.isolate][name];
    const impl = key && this.store[key];
    if (!impl) return;
    if (strict && impl.fiber.state !== 2) return;
    return impl;
  }
  set(name, value, error) {
    const key = this.ctx[symbols.isolate][name];
    const impl = this.store[key];
    if (!impl) {
      throw new Error(`cannot set property "${name}" without provide`);
    }
    if (impl.fiber !== this.ctx.fiber) {
      throw new Error(`cannot set property "${name}" in multiple fibers`);
    }
    impl.value = value;
    return true;
  }
  provide(name, value, check) {
    return this.ctx.fiber.effect(() => {
      if (!this.props[name]) {
        this.props[name] ??= { type: "service" };
      } else if (this.props[name].type !== "service") {
        throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
      }
      this.props[name] = { type: "service" };
      this.ctx.root[symbols.isolate][name] ??= Symbol(name);
      const key = this.ctx[symbols.isolate][name];
      const impl = { name, value, fiber: this.ctx.fiber, check };
      if (this.store[key]) {
        throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
      }
      this.store[key] = impl;
      this.ctx.fiber.store[name] = impl;
      if (this.ctx.fiber.state === 2) {
        this.notify([name]);
      }
      return async () => {
        delete this.store[key];
        const fibers = this.notify([name]);
        await Promise.allSettled(fibers.map((fiber) => fiber.await()));
        delete this.ctx.fiber.store[name];
      };
    }, `ctx.provide(${JSON.stringify(name)})`);
  }
  notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
    const fibers = [];
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        let hasUpdate = false;
        for (const name of names) {
          if (!(name in fiber.inject)) continue;
          if (!filter(fiber.ctx, name)) continue;
          hasUpdate = true;
          fiber._checkImpl(name);
        }
        if (!hasUpdate) continue;
        fiber._refresh();
        fibers.push(fiber);
      }
    }
    for (const name of names) {
      const self = Object.create(this.ctx);
      self[symbols.filter] = (target) => filter(target, name);
      this.ctx.events.emit(self, "internal/service", name, this._getImpl(name, false)?.value);
    }
    return fibers;
  }
  accessor(name, options) {
    return this.ctx.fiber.effect(() => {
      if (name in this.props) {
        throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
      }
      this.props[name] = { type: "accessor", ...options };
      return () => delete this.props[name];
    }, `ctx.accessor(${JSON.stringify(name)})`);
  }
  mixin(source, mixins) {
    const self = this;
    return this.ctx.fiber.effect(function* () {
      const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
      const getTarget = __name((ctx, error) => {
        return ctx[source];
      }, "getTarget");
      for (const [key, value] of entries) {
        yield self.accessor(value, {
          get(receiver, error) {
            const service = getTarget(this, error);
            if (isNullable(service)) return service;
            const mixin = receiver ? withProps(receiver, service) : service;
            const value2 = Reflect.get(service, key, mixin);
            if (typeof value2 !== "function") return value2;
            return value2.bind(mixin ?? service);
          },
          set(value2, receiver, error) {
            const service = getTarget(this, error);
            const mixin = receiver ? withProps(receiver, service) : service;
            return Reflect.set(service, key, value2, mixin);
          }
        });
      }
    }, `ctx.mixin(${JSON.stringify(source)})`);
  }
  trace(value) {
    return getTraceable(this.ctx, value);
  }
  bind(callback) {
    return new Proxy(callback, {
      apply: __name((target, thisArg, args) => {
        return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
      }, "apply"),
      construct: __name((target, args, newTarget) => {
        return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
      }, "construct")
    });
  }
}, __name(_a8, "ReflectService"), __publicField(_a8, "handler", {
  get: __name((target, prop, ctx) => {
    if (isSpecialProperty(prop)) {
      return Reflect.get(target, prop, ctx);
    }
    if (Reflect.has(target, prop)) {
      return getTraceable(ctx, Reflect.get(target, prop, ctx));
    }
    const error = new Error(`cannot get property "${prop}" without inject`);
    try {
      const def = target.reflect.props[prop];
      if (def?.type === "accessor") {
        return def.get.call(ctx, ctx[symbols.receiver], error);
      }
      const defSite = ctx[symbols.shadow] ?? ctx;
      if (!defSite.fiber.runtime) return ctx.reflect.get(prop, false);
      return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
        const key = target[symbols.isolate][prop];
        let fiber = defSite.fiber;
        while (true) {
          const impl = fiber.store?.[prop];
          if (impl) return getTraceable(ctx, impl.value);
          if (prop in fiber.inject) {
            error.message = `cannot get required service "${prop}" in inactive context`;
            throw error;
          }
          if (!fiber.runtime) throw error;
          if (fiber.parent[symbols.isolate][prop] !== key) throw error;
          fiber = fiber.parent.fiber;
        }
      });
    } catch (e) {
      throw e === error ? enhanceError(e) : e;
    }
  }, "get"),
  set: __name((target, prop, value, ctx) => {
    if (isSpecialProperty(prop)) {
      return Reflect.set(target, prop, value, ctx);
    }
    const error = new Error(`cannot set property "${prop}" without provide`);
    const def = target.reflect.props[prop];
    if (!def) {
      if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
      throw enhanceError(error);
    }
    try {
      if (def.type === "accessor") {
        if (!def.set) return false;
        return def.set.call(ctx, value, ctx[symbols.receiver], error);
      }
      return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
        return ctx.reflect.set(prop, value, error);
      });
    } catch (e) {
      throw e === error ? enhanceError(e) : e;
    }
  }, "set"),
  has: __name((target, prop) => {
    if (isSpecialProperty(prop)) {
      return Reflect.has(target, prop);
    }
    if (Reflect.has(target, prop)) return true;
    return !!target.reflect.props[prop];
  }, "has")
}), _a8);
function isApplicable(object) {
  return object && typeof object === "object" && typeof object.apply === "function";
}
__name(isApplicable, "isApplicable");
function Inject(name, config) {
  return function(value, decorator) {
    if (decorator.kind === "class") {
      if (!Object.hasOwn(value, "inject")) {
        defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
        defineProperty(value.inject, symbols.checkProto, true);
      }
      value.inject[name] = config;
    } else if (decorator.kind === "method") {
      const inject2 = (value[symbols.metadata] ??= {}).inject ??= /* @__PURE__ */ Object.create(null);
      inject2[name] = config;
      decorator.addInitializer(function() {
        const property = this[symbols.tracker]?.property;
        (this[symbols.initHooks] ??= []).push(() => {
          this.ctx.inject(inject2, (ctx) => {
            return value.call(property ? withProps(this, { [property]: ctx }) : this);
          });
        });
      });
    } else {
      throw new Error("@Inject() can only be used on class or class methods");
    }
  };
}
__name(Inject, "Inject");
((Inject2) => {
  function resolve2(inject2, result = /* @__PURE__ */ Object.create(null)) {
    if (!inject2) return result;
    if (Array.isArray(inject2)) {
      for (const name of inject2) {
        result[name] = null;
      }
    } else if (Reflect.has(inject2, symbols.checkProto)) {
      Object.assign(result, resolve2(Object.getPrototypeOf(inject2)));
      for (const name of Object.keys(inject2)) {
        result[name] = inject2[name] ?? null;
      }
    } else {
      for (const name of Object.keys(inject2)) {
        result[name] = inject2[name] ?? null;
      }
    }
    return result;
  }
  Inject2.resolve = resolve2;
  __name(resolve2, "resolve");
})(Inject || (Inject = {}));
var _a9;
var RegistryService = (_a9 = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
  }
  ctx;
  _counter = 0;
  _internal = /* @__PURE__ */ new Map();
  get counter() {
    return ++this._counter;
  }
  get size() {
    return this._internal.size;
  }
  resolve(plugin) {
    try {
      if (typeof plugin === "function") return plugin;
      if (isApplicable(plugin)) return plugin.apply;
    } catch {
    }
  }
  get(plugin) {
    const key = this.resolve(plugin);
    return key && this._internal.get(key);
  }
  has(plugin) {
    const key = this.resolve(plugin);
    return !!key && this._internal.has(key);
  }
  delete(plugin) {
    const key = this.resolve(plugin);
    const runtime = key && this._internal.get(key);
    if (!runtime) return;
    this._internal.delete(key);
    for (const fiber of runtime.fibers) {
      fiber.dispose();
    }
    return runtime;
  }
  keys() {
    return this._internal.keys();
  }
  values() {
    return this._internal.values();
  }
  entries() {
    return this._internal.entries();
  }
  forEach(callback) {
    return this._internal.forEach(callback);
  }
  inject(inject2, callback) {
    return this.plugin({ inject: inject2, apply: callback, name: callback.name });
  }
  plugin(plugin, config, getOuterStack = buildOuterStack()) {
    const callback = this.resolve(plugin);
    if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin);
    this.ctx.fiber.assertActive();
    let runtime = this._internal.get(callback);
    if (!runtime) {
      let name = plugin.name;
      if (name === "apply") name = void 0;
      runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config };
      this._internal.set(callback, runtime);
    }
    const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
    const wrapped = Object.create(fiber);
    wrapped.then = (onFulfilled, onRejected) => {
      return fiber.await().then(onFulfilled, onRejected);
    };
    return wrapped;
  }
}, __name(_a9, "RegistryService"), _a9);
var _a10;
var Context = (_a10 = class {
  static is(value) {
    return !!value?.[_a10.is];
  }
  constructor() {
    this[symbols.isolate] = /* @__PURE__ */ Object.create(null);
    this[symbols.intercept] = /* @__PURE__ */ Object.create(null);
    const self = new Proxy(this, ReflectService.handler);
    this.root = self;
    this.baseUrl = void 0;
    this.fiber = new Fiber(self, {}, /* @__PURE__ */ Object.create(null), null, () => []);
    this.reflect = new ReflectService(self);
    this.registry = new RegistryService(self);
    this.events = new EventsService(self);
    this.logger = new LoggerService(self);
    this.fiber._disposables.clear();
    return self;
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return `Context <${this.fiber.name}>`;
  }
  extend(meta = {}) {
    const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
    const self = Object.create(getTraceable(this, this));
    for (const prop of Reflect.ownKeys(meta)) {
      Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
    }
    if (!shadow) return self;
    return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
  }
  isolate(name, label) {
    const shadow = Object.create(this[symbols.isolate]);
    shadow[name] = label ?? Symbol(name);
    return this.extend({ [symbols.isolate]: shadow });
  }
  intercept(name, config) {
    const intercept = Object.create(this[symbols.intercept]);
    intercept[name] = config;
    return this.extend({ [symbols.intercept]: intercept });
  }
}, __name(_a10, "Context"), __publicField(_a10, "effect", symbols.effect), __publicField(_a10, "filter", symbols.filter), __publicField(_a10, "isolate", symbols.isolate), __publicField(_a10, "intercept", symbols.intercept), _a10.is[Symbol.toPrimitive] = () => /* @__PURE__ */ Symbol.for("cordis.is"), _a10.prototype[_a10.is] = true, _a10);
var _a11;
var Service = (_a11 = class {
  constructor(ctx, name) {
    this.ctx = ctx;
    name ??= this.constructor["provide"];
    let self = this;
    const tracker = {
      associate: name,
      property: "ctx"
    };
    if (self[symbols.invoke]) {
      self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    }
    self.ctx = ctx;
    self.name = name;
    defineProperty(self, symbols.tracker, tracker);
    self.ctx.reflect.provide(name, self, this[symbols.check]);
    return self;
  }
  ctx;
  name;
  [symbols.filter](ctx) {
    return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
  }
  [symbols.extend](props) {
    let self;
    if (this[_a11.invoke]) {
      self = createCallable(this.name, this, this[symbols.tracker]);
    } else {
      self = Object.create(this);
    }
    return Object.assign(self, props);
  }
  [symbols.resolveConfig](base, head) {
    let intercept = this.ctx[Context.intercept];
    const configs = [];
    while (this.name in intercept) {
      if (Object.hasOwn(intercept, this.name)) {
        configs.unshift(intercept[this.name]);
      }
      intercept = Object.getPrototypeOf(intercept);
    }
    if (base) configs.unshift(base);
    if (head) configs.push(head);
    if (this["Config"]?.merge) {
      return this["Config"].merge(...configs);
    } else {
      return Object.assign({}, ...configs);
    }
  }
  static [Symbol.hasInstance](instance) {
    if (!instance) return false;
    let constructor = instance.constructor;
    while (constructor) {
      constructor = constructor.prototype?.constructor;
      if (constructor === this) return true;
      constructor &&= Object.getPrototypeOf(constructor);
    }
    return false;
  }
}, __name(_a11, "Service"), __publicField(_a11, "init", symbols.init), __publicField(_a11, "check", symbols.check), __publicField(_a11, "config", symbols.config), __publicField(_a11, "invoke", symbols.invoke), __publicField(_a11, "extend", symbols.extend), __publicField(_a11, "tracker", symbols.tracker), __publicField(_a11, "resolveConfig", symbols.resolveConfig), _a11);

// node_modules/schemastery/lib/index.mjs
var __defProp2 = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name2 = (target, value) => __defProp2(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_index = __commonJS({
  "src/index.ts"(exports, module) {
    var _a12;
    var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
    var kValidationError2 = /* @__PURE__ */ Symbol.for("ValidationError");
    globalThis.__schemastery_index__ ??= 0;
    globalThis.__schemastery_refs__ = void 0;
    var ValidationError2 = (_a12 = class extends TypeError {
      constructor(message2, options) {
        let prefix = "$";
        for (const segment of options.path || []) {
          if (typeof segment === "string") {
            prefix += "." + segment;
          } else if (typeof segment === "number") {
            prefix += "[" + segment + "]";
          } else if (typeof segment === "symbol") {
            prefix += `[Symbol(${segment.toString()})]`;
          }
        }
        if (prefix.startsWith(".")) prefix = prefix.slice(1);
        super((prefix === "$" ? "" : `${prefix} `) + message2);
        this.options = options;
      }
      name = "ValidationError";
      static is(error) {
        return !!error?.[kValidationError2];
      }
    }, __name2(_a12, "ValidationError"), _a12);
    Object.defineProperty(ValidationError2.prototype, kValidationError2, {
      value: true
    });
    var Schema2 = __name2(function(options) {
      const schema = __name2(function(data, options2 = {}) {
        return Schema2.resolve(data, schema, options2)[0];
      }, "schema");
      if (options.refs) {
        const refs = mapValues(options.refs, (options2) => new Schema2(options2));
        const getRef = __name2((uid) => refs[uid], "getRef");
        for (const key in refs) {
          const options2 = refs[key];
          options2.sKey = getRef(options2.sKey);
          options2.inner = getRef(options2.inner);
          options2.list = options2.list && options2.list.map(getRef);
          options2.dict = options2.dict && mapValues(options2.dict, getRef);
        }
        return refs[options.uid];
      }
      Object.assign(schema, options);
      if (typeof schema.callback === "string") {
        try {
          schema.callback = new Function("return " + schema.callback)();
        } catch {
        }
      }
      Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
      Object.setPrototypeOf(schema, Schema2.prototype);
      schema.meta ||= {};
      schema.toString = schema.toString.bind(schema);
      return schema;
    }, "Schema");
    Schema2.prototype = Object.create(Function.prototype);
    Schema2.prototype[kSchema] = true;
    Object.defineProperty(Schema2.prototype, "~standard", {
      get() {
        return {
          version: 1,
          vendor: "schemastery",
          validate: __name2((value) => {
            try {
              return { value: Schema2.resolve(value, this, {})[0] };
            } catch (error) {
              if (ValidationError2.is(error)) {
                return { issues: [{ message: error.message, path: error.options.path }] };
              }
              throw error;
            }
          }, "validate")
        };
      }
    });
    Schema2.ValidationError = ValidationError2;
    Schema2.prototype.toJSON = __name2(function toJSON() {
      if (globalThis.__schemastery_refs__) {
        globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
        return this.uid;
      }
      globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
      globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
      const result = { uid: this.uid, refs: globalThis.__schemastery_refs__ };
      globalThis.__schemastery_refs__ = void 0;
      return result;
    }, "toJSON");
    Schema2.prototype.set = __name2(function set(key, value) {
      this.dict[key] = value;
      return this;
    }, "set");
    Schema2.prototype.push = __name2(function push(value) {
      this.list.push(value);
      return this;
    }, "push");
    function mergeDesc(original, messages) {
      const result = typeof original === "string" ? { "": original } : { ...original };
      for (const locale2 in messages) {
        const value = messages[locale2];
        if (value?.$description || value?.$desc) {
          result[locale2] = value.$description || value.$desc;
        } else if (typeof value === "string") {
          result[locale2] = value;
        }
      }
      return result;
    }
    __name2(mergeDesc, "mergeDesc");
    function getInner(value) {
      return value?.$value ?? value?.$inner;
    }
    __name2(getInner, "getInner");
    function extractKeys(data) {
      return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
    }
    __name2(extractKeys, "extractKeys");
    Schema2.prototype.i18n = __name2(function i18n(messages) {
      const schema = Schema2(this);
      const desc = mergeDesc(schema.meta.description, messages);
      if (Object.keys(desc).length) schema.meta.description = desc;
      if (schema.dict) {
        schema.dict = mapValues(schema.dict, (inner, key) => {
          return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
        });
      }
      if (schema.list) {
        schema.list = schema.list.map((inner, index) => {
          return inner.i18n(mapValues(messages, (data = {}) => {
            if (Array.isArray(getInner(data))) return getInner(data)[index];
            if (Array.isArray(data)) return data[index];
            return extractKeys(data);
          }));
        });
      }
      if (schema.inner) {
        schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
          if (getInner(data)) return getInner(data);
          return extractKeys(data);
        }));
      }
      if (schema.sKey) {
        schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
      }
      return schema;
    }, "i18n");
    Schema2.prototype.extra = __name2(function extra(key, value) {
      const schema = Schema2(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }, "extra");
    for (const key of ["required", "disabled", "collapse", "hidden", "loose"]) {
      Object.assign(Schema2.prototype, {
        [key](value = true) {
          const schema = Schema2(this);
          schema.meta = { ...schema.meta, [key]: value };
          return schema;
        }
      });
    }
    Schema2.prototype.deprecated = __name2(function deprecated() {
      const schema = Schema2(this);
      schema.meta.badges ||= [];
      schema.meta.badges.push({ text: "deprecated", type: "danger" });
      return schema;
    }, "deprecated");
    Schema2.prototype.experimental = __name2(function experimental() {
      const schema = Schema2(this);
      schema.meta.badges ||= [];
      schema.meta.badges.push({ text: "experimental", type: "warning" });
      return schema;
    }, "experimental");
    Schema2.prototype.pattern = __name2(function pattern(regexp) {
      const schema = Schema2(this);
      const pattern2 = pick(regexp, ["source", "flags"]);
      schema.meta = { ...schema.meta, pattern: pattern2 };
      return schema;
    }, "pattern");
    Schema2.prototype.simplify = __name2(function simplify(value) {
      if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
      if (isNullable(value)) return value;
      if (this.type === "object" || this.type === "dict") {
        const result = {};
        for (const key in value) {
          const schema = this.type === "object" ? this.dict[key] : this.inner;
          const item = schema?.simplify(value[key]);
          if (this.type === "dict" || !isNullable(item)) result[key] = item;
        }
        if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
        return result;
      } else if (this.type === "array" || this.type === "tuple") {
        const result = [];
        value.forEach((value2, index) => {
          const schema = this.type === "array" ? this.inner : this.list[index];
          const item = schema ? schema.simplify(value2) : value2;
          result.push(item);
        });
        return result;
      } else if (this.type === "intersect") {
        const result = {};
        for (const item of this.list) {
          Object.assign(result, item.simplify(value));
        }
        return result;
      } else if (this.type === "union") {
        for (const schema of this.list) {
          try {
            Schema2.resolve(value, schema, {});
            return schema.simplify(value);
          } catch {
          }
        }
      }
      return value;
    }, "simplify");
    Schema2.prototype.toString = __name2(function toString(inline) {
      return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
    }, "toString");
    Schema2.prototype.role = __name2(function role(role, extra) {
      const schema = Schema2(this);
      schema.meta = { ...schema.meta, role, extra };
      return schema;
    }, "role");
    for (const key of ["default", "link", "comment", "description", "max", "min", "step"]) {
      Object.assign(Schema2.prototype, {
        [key](value) {
          const schema = Schema2(this);
          schema.meta = { ...schema.meta, [key]: value };
          return schema;
        }
      });
    }
    var resolvers = {};
    Schema2.extend = __name2(function extend(type, resolve2) {
      resolvers[type] = resolve2;
    }, "extend");
    Schema2.resolve = __name2(function resolve2(data, schema, options = {}, strict = false) {
      if (!schema) return [data];
      if (options.ignore?.(data, schema)) return [data];
      if (isNullable(data) && schema.type !== "lazy") {
        if (schema.meta.required) throw new ValidationError2(`missing required value`, options);
        let current = schema;
        let fallback2 = schema.meta.default;
        while (current?.type === "intersect" && isNullable(fallback2)) {
          current = current.list[0];
          fallback2 = current?.meta.default;
        }
        if (isNullable(fallback2)) return [data];
        data = clone(fallback2);
      }
      const callback = resolvers[schema.type];
      if (!callback) throw new ValidationError2(`unsupported type "${schema.type}"`, options);
      try {
        return callback(data, schema, options, strict);
      } catch (error) {
        if (!schema.meta.loose) throw error;
        return [schema.meta.default];
      }
    }, "resolve");
    Schema2.from = __name2(function from(source) {
      if (isNullable(source)) {
        return Schema2.any();
      } else if (["string", "number", "boolean"].includes(typeof source)) {
        return Schema2.const(source).required();
      } else if (source[kSchema]) {
        return source;
      } else if (typeof source === "function") {
        switch (source) {
          case String:
            return Schema2.string().required();
          case Number:
            return Schema2.number().required();
          case Boolean:
            return Schema2.boolean().required();
          case Function:
            return Schema2.function().required();
          default:
            return Schema2.is(source).required();
        }
      } else {
        throw new TypeError(`cannot infer schema from ${source}`);
      }
    }, "from");
    Schema2.lazy = __name2(function lazy(builder) {
      const toJSON = __name2(() => {
        if (!schema.inner[kSchema]) {
          schema.inner = schema.builder();
          schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
        }
        return schema.inner.toJSON();
      }, "toJSON");
      const schema = new Schema2({ type: "lazy", builder, inner: { toJSON } });
      return schema;
    }, "lazy");
    Schema2.natural = __name2(function natural() {
      return Schema2.number().step(1).min(0);
    }, "natural");
    Schema2.percent = __name2(function percent() {
      return Schema2.number().step(0.01).min(0).max(1).role("slider");
    }, "percent");
    Schema2.date = __name2(function date() {
      return Schema2.union([
        Schema2.is(Date),
        Schema2.transform(Schema2.string().role("datetime"), (value, options) => {
          const date2 = new Date(value);
          if (isNaN(+date2)) throw new ValidationError2(`invalid date "${value}"`, options);
          return date2;
        }, true)
      ]);
    }, "date");
    Schema2.regExp = __name2(function regExp(flag = "") {
      return Schema2.union([
        Schema2.is(RegExp),
        Schema2.transform(Schema2.string().role("regexp", { flag }), (value, options) => {
          try {
            return new RegExp(value, flag);
          } catch (e) {
            throw new ValidationError2(e.message, options);
          }
        }, true)
      ]);
    }, "regExp");
    Schema2.arrayBuffer = __name2(function arrayBuffer(encoding) {
      return Schema2.union([
        Schema2.is(ArrayBuffer),
        Schema2.is(SharedArrayBuffer),
        Schema2.transform(Schema2.any(), (value, options) => {
          if (Binary.isSource(value)) return Binary.fromSource(value);
          throw new ValidationError2(`expected ArrayBufferSource but got ${value}`, options);
        }, true),
        ...encoding ? [Schema2.transform(Schema2.string(), (value, options) => {
          try {
            return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
          } catch (e) {
            throw new ValidationError2(e.message, options);
          }
        }, true)] : []
      ]);
    }, "arrayBuffer");
    Schema2.extend("lazy", (data, schema, options, strict) => {
      if (!schema.inner[kSchema]) {
        schema.inner = schema.builder();
        schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
      }
      return Schema2.resolve(data, schema.inner, options, strict);
    });
    Schema2.extend("any", (data) => {
      return [data];
    });
    Schema2.extend("never", (data, _, options) => {
      throw new ValidationError2(`expected nullable but got ${data}`, options);
    });
    Schema2.extend("const", (data, { value }, options) => {
      if (deepEqual(data, value)) return [value];
      throw new ValidationError2(`expected ${value} but got ${data}`, options);
    });
    function checkWithinRange(data, meta, description, options, skipMin = false) {
      const { max = Infinity, min = -Infinity } = meta;
      if (data > max) throw new ValidationError2(`expected ${description} <= ${max} but got ${data}`, options);
      if (data < min && !skipMin) throw new ValidationError2(`expected ${description} >= ${min} but got ${data}`, options);
    }
    __name2(checkWithinRange, "checkWithinRange");
    Schema2.extend("string", (data, { meta }, options) => {
      if (typeof data !== "string") throw new ValidationError2(`expected string but got ${data}`, options);
      if (meta.pattern) {
        const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
        if (!regexp.test(data)) throw new ValidationError2(`expect string to match regexp ${regexp}`, options);
      }
      checkWithinRange(data.length, meta, "string length", options);
      return [data];
    });
    function decimalShift(data, digits) {
      const str = data.toString();
      if (str.includes("e")) return data * Math.pow(10, digits);
      const index = str.indexOf(".");
      if (index === -1) return data * Math.pow(10, digits);
      const frac = str.slice(index + 1);
      const integer = str.slice(0, index);
      if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
      return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
    }
    __name2(decimalShift, "decimalShift");
    function isMultipleOf(data, min, step) {
      step = Math.abs(step);
      if (!/^\d+\.\d+$/.test(step.toString())) {
        return (data - min) % step === 0;
      }
      const index = step.toString().indexOf(".");
      const digits = step.toString().slice(index + 1).length;
      return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
    }
    __name2(isMultipleOf, "isMultipleOf");
    Schema2.extend("number", (data, { meta }, options) => {
      if (typeof data !== "number") throw new ValidationError2(`expected number but got ${data}`, options);
      checkWithinRange(data, meta, "number", options);
      const { step } = meta;
      if (step && !isMultipleOf(data, meta.min ?? 0, step)) {
        throw new ValidationError2(`expected number multiple of ${step} but got ${data}`, options);
      }
      return [data];
    });
    Schema2.extend("boolean", (data, _, options) => {
      if (typeof data === "boolean") return [data];
      throw new ValidationError2(`expected boolean but got ${data}`, options);
    });
    Schema2.extend("bitset", (data, { bits, meta }, options) => {
      let value = 0, keys = [];
      if (typeof data === "number") {
        value = data;
        for (const key in bits) {
          if (data & bits[key]) {
            keys.push(key);
          }
        }
      } else if (Array.isArray(data)) {
        keys = data;
        for (const key of keys) {
          if (typeof key !== "string") throw new ValidationError2(`expected string but got ${key}`, options);
          if (key in bits) value |= bits[key];
        }
      } else {
        throw new ValidationError2(`expected number or array but got ${data}`, options);
      }
      if (value === meta.default) return [value];
      return [value, keys];
    });
    Schema2.extend("function", (data, _, options) => {
      if (typeof data === "function") return [data];
      throw new ValidationError2(`expected function but got ${data}`, options);
    });
    Schema2.extend("is", (data, { constructor }, options) => {
      if (typeof constructor === "function") {
        if (data instanceof constructor) return [data];
        throw new ValidationError2(`expected ${constructor.name} but got ${data}`, options);
      } else {
        if (isNullable(data)) {
          throw new ValidationError2(`expected ${constructor} but got ${data}`, options);
        }
        let prototype = Object.getPrototypeOf(data);
        while (prototype) {
          if (prototype.constructor?.name === constructor) return [data];
          prototype = Object.getPrototypeOf(prototype);
        }
        throw new ValidationError2(`expected ${constructor} but got ${data}`, options);
      }
    });
    function property(data, key, schema, options) {
      try {
        const [value, adapted] = Schema2.resolve(data[key], schema, {
          ...options,
          path: [...options.path || [], key]
        });
        if (adapted !== void 0) data[key] = adapted;
        return value;
      } catch (e) {
        if (!options?.autofix) throw e;
        delete data[key];
        return schema.meta.default;
      }
    }
    __name2(property, "property");
    Schema2.extend("array", (data, { inner, meta }, options) => {
      if (!Array.isArray(data)) throw new ValidationError2(`expected array but got ${data}`, options);
      checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
      return [data.map((_, index) => property(data, index, inner, options))];
    });
    Schema2.extend("dict", (data, { inner, sKey }, options, strict) => {
      if (!isPlainObject(data)) throw new ValidationError2(`expected object but got ${data}`, options);
      const result = {};
      for (const key in data) {
        let rKey;
        try {
          rKey = Schema2.resolve(key, sKey, options)[0];
        } catch (error) {
          if (strict) continue;
          throw error;
        }
        result[rKey] = property(data, key, inner, options);
        data[rKey] = data[key];
        if (key !== rKey) delete data[key];
      }
      return [result];
    });
    Schema2.extend("tuple", (data, { list }, options, strict) => {
      if (!Array.isArray(data)) throw new ValidationError2(`expected array but got ${data}`, options);
      const result = list.map((inner, index) => property(data, index, inner, options));
      if (strict) return [result];
      result.push(...data.slice(list.length));
      return [result];
    });
    function merge(result, data) {
      for (const key in data) {
        if (key in result) continue;
        result[key] = data[key];
      }
    }
    __name2(merge, "merge");
    Schema2.extend("object", (data, { dict }, options, strict) => {
      if (!isPlainObject(data)) throw new ValidationError2(`expected object but got ${data}`, options);
      const result = {};
      for (const key in dict) {
        const value = property(data, key, dict[key], options);
        if (!isNullable(value) || key in data) {
          result[key] = value;
        }
      }
      if (!strict) merge(result, data);
      return [result];
    });
    Schema2.extend("union", (data, { list, toString }, options, strict) => {
      const messages = [];
      for (const inner of list) {
        try {
          return Schema2.resolve(data, inner, options, strict);
        } catch (error) {
          messages.push(error);
        }
      }
      throw new ValidationError2(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
    });
    Schema2.extend("intersect", (data, { list, toString }, options, strict) => {
      if (!list.length) return [data];
      let result;
      for (const inner of list) {
        const value = Schema2.resolve(data, inner, options, true)[0];
        if (isNullable(value)) continue;
        if (isNullable(result)) {
          result = value;
        } else if (typeof result !== typeof value) {
          throw new ValidationError2(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
        } else if (typeof value === "object") {
          merge(result ??= {}, value);
        } else if (result !== value) {
          throw new ValidationError2(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
        }
      }
      if (!strict && isPlainObject(data)) merge(result, data);
      return [result];
    });
    Schema2.extend("transform", (data, { inner, callback, preserve }, options) => {
      const [result, adapted = data] = Schema2.resolve(data, inner, options, true);
      if (preserve) {
        return [callback(result)];
      } else {
        return [callback(result), callback(adapted)];
      }
    });
    var formatters = {};
    function defineMethod(name, keys, format) {
      formatters[name] = format;
      Object.assign(Schema2, {
        [name](...args) {
          const schema = new Schema2({ type: name });
          keys.forEach((key, index) => {
            switch (key) {
              case "sKey":
                schema.sKey = args[index] ?? Schema2.string();
                break;
              case "inner":
                schema.inner = Schema2.from(args[index]);
                break;
              case "list":
                schema.list = args[index].map(Schema2.from);
                break;
              case "dict":
                schema.dict = mapValues(args[index], Schema2.from);
                break;
              case "bits": {
                schema.bits = {};
                for (const key2 in args[index]) {
                  if (typeof args[index][key2] !== "number") continue;
                  schema.bits[key2] = args[index][key2];
                }
                break;
              }
              case "callback": {
                const callback = schema.callback = args[index];
                callback["toJSON"] ||= () => callback.toString();
                break;
              }
              case "constructor": {
                const constructor = schema.constructor = args[index];
                if (typeof constructor === "function") {
                  ;
                  constructor["toJSON"] ||= () => constructor["name"];
                }
                break;
              }
              default:
                schema[key] = args[index];
            }
          });
          if (name === "object" || name === "dict") {
            schema.meta.default = {};
          } else if (name === "array" || name === "tuple") {
            schema.meta.default = [];
          } else if (name === "bitset") {
            schema.meta.default = 0;
          }
          return schema;
        }
      });
    }
    __name2(defineMethod, "defineMethod");
    defineMethod("is", ["constructor"], ({ constructor }) => {
      if (typeof constructor === "function") {
        return constructor.name;
      } else {
        return constructor;
      }
    });
    defineMethod("any", [], () => "any");
    defineMethod("never", [], () => "never");
    defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
    defineMethod("string", [], () => "string");
    defineMethod("number", [], () => "number");
    defineMethod("boolean", [], () => "boolean");
    defineMethod("bitset", ["bits"], () => "bitset");
    defineMethod("function", [], () => "function");
    defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
    defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
    defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
    defineMethod("object", ["dict"], ({ dict }) => {
      if (Object.keys(dict).length === 0) return "{}";
      return `{ ${Object.entries(dict).map(([key, inner]) => {
        return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
      }).join(", ")} }`;
    });
    defineMethod("union", ["list"], ({ list }, inline) => {
      const result = list.map(({ toString: format }) => format()).join(" | ");
      return inline ? `(${result})` : result;
    });
    defineMethod("intersect", ["list"], ({ list }) => {
      return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
    });
    defineMethod("transform", ["inner", "callback", "preserve"], ({ inner }, isInner) => inner.toString(isInner));
    module.exports = Schema2;
  }
});
var lib_default = require_index();

// node_modules/schemastery-vue/src/locales/zh-CN.yml
var zh_CN_default = {
  title: "基础设置",
  initial: "撤销更改",
  "default": "恢复默认值",
  collapse: "折叠子项",
  expand: "展开以编辑",
  edit: {
    json: "编辑 JSON",
    invalid: "无效的配置。",
    save: "保存更改",
    copy: "复制到剪贴板",
    copied: "已复制"
  },
  badge: {
    deprecated: "已废弃",
    experimental: "实验性"
  },
  entry: {
    key: "键",
    value: "值",
    "add-item": "添加项目",
    "del-item": "删除项目",
    "add-row": "添加行",
    "del-row": "删除行",
    "move-up": "上移项目",
    "move-down": "下移项目",
    "insert-before": "在上方插入",
    "insert-after": "在下方插入"
  },
  select: {
    all: "全部选中",
    none: "清空选择"
  },
  errors: {
    "duplicate-key": "键名重复",
    "regexp-not-matched": "未能匹配正则表达式 {0}"
  }
};

// node_modules/schemastery-vue/src/locales/en-US.yml
var en_US_default = {
  title: "Basic Settings",
  initial: "Undo",
  "default": "Restore to Default",
  collapse: "Collapse",
  expand: "Expand to Edit",
  edit: {
    json: "Edit JSON",
    invalid: "Invalid configuration.",
    save: "Save Changes",
    copy: "Copy to Clipboard",
    copied: "Copied"
  },
  badge: {
    deprecated: "deprecated",
    experimental: "experimental"
  },
  entry: {
    key: "Key",
    value: "Value",
    "add-item": "Add Item",
    "del-item": "Delete Item",
    "add-row": "Add Row",
    "del-row": "Delete Row",
    "move-up": "Move Up",
    "move-down": "Move Down",
    "insert-before": "Insert Before",
    "insert-after": "Insert After"
  },
  select: {
    all: "Select All",
    none: "Clear Selection"
  },
  errors: {
    "duplicate-key": "Duplicate key",
    "regexp-not-matched": "Not matched with regexp {0}"
  }
};

// node_modules/schemastery-vue/src/i18n.ts
var locale = ref("en-US");
var LocaleTree;
((LocaleTree2) => {
  function from(locales) {
    const tree = {};
    for (const locale2 of locales.filter(Boolean)) {
      const tokens = locale2.split("-");
      let current = tree;
      for (let i = 0; i < tokens.length; i++) {
        const key = tokens.slice(0, i + 1).join("-");
        current = current[key] = current[key] || {};
      }
    }
    return tree;
  }
  LocaleTree2.from = from;
})(LocaleTree || (LocaleTree = {}));
function toLocaleEntry(key, tree) {
  return [key, [[key, []], ...Object.entries(tree).map(([key2, value]) => toLocaleEntry(key2, value))]];
}
function* traverse([key, children], ignored) {
  if (!children.length) {
    return yield key;
  }
  for (const child of children) {
    if (ignored.includes(child)) continue;
    yield* traverse(child, ignored);
  }
}
function fallback(tree, locales) {
  const root = toLocaleEntry("", tree);
  const ignored = [];
  for (const locale2 of deduplicate(locales).filter(Boolean).reverse()) {
    let prefix = "", children = root[1];
    const tokens = locale2 ? locale2.split("-") : [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const current = prefix + token;
      const index = children.findIndex(([key]) => key === current);
      if (index < 0) break;
      const entry = children[index];
      if (index > 0) {
        children.splice(index, 1);
        children.unshift(entry);
      }
      children = entry[1];
      prefix = current + "-";
      if (current === locale2) {
        ignored.unshift(entry);
      }
    }
  }
  ignored.push(root);
  const results = [];
  for (const entry of ignored) {
    results.push(...traverse(entry, ignored));
  }
  return results;
}
function translate(messages, locales, paths) {
  const keys = Object.keys(messages).map((k) => k.startsWith("$") ? k.slice(1) : k);
  locales = fallback(LocaleTree.from(keys), locales);
  for (const path of paths) {
    for (const locale2 of locales) {
      for (const key of ["$" + locale2, locale2]) {
        const value = messages[key]?.[path];
        if (value === void 0 || !value && !locale2 && path !== "") continue;
        return value;
      }
    }
  }
}
function resolve(tree, key) {
  let node = tree;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object") return;
    node = node[part];
  }
  return typeof node === "string" ? node : void 0;
}
function interpolate(template, args) {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[+i] ?? ""));
}
function useI18nText() {
  return (message2) => {
    if (!message2 || typeof message2 === "string") return message2;
    const locales = fallback(LocaleTree.from(Object.keys(message2)), [locale.value]);
    for (const loc of locales) {
      if (loc in message2) return message2[loc];
    }
    return message2[""];
  };
}
var defaultMessages = reactive({
  "zh-CN": markRaw(zh_CN_default),
  "en-US": markRaw(en_US_default)
});
if (import.meta.hot) {
  import.meta.hot.accept("./locales/zh-CN.yml", (m) => {
    if (m) defaultMessages["zh-CN"] = markRaw(m.default);
  });
  import.meta.hot.accept("./locales/en-US.yml", (m) => {
    if (m) defaultMessages["en-US"] = markRaw(m.default);
  });
}
function useI18n(messages = defaultMessages) {
  const tt = useI18nText();
  return (key, args = []) => {
    const dict = {};
    for (const loc in messages) {
      const text2 = resolve(messages[loc], key);
      if (text2 !== void 0) dict[loc] = text2;
    }
    const text = tt(dict) ?? key;
    return args.length ? interpolate(text, args) : text;
  };
}

// node_modules/schemastery-vue/src/utils.ts
var dynamic = ["function", "transform", "is"];
function getChoices(schema) {
  const inner = [];
  const choices = schema.list.filter((item) => {
    if (item.meta.hidden) return;
    if (item.type === "transform") inner.push(item.inner);
    return !dynamic.includes(item.type);
  });
  return choices.length ? choices : inner;
}
function getFallback(schema, required = false) {
  if (!schema || schema.type === "union" && getChoices(schema).length === 1) return;
  return clone(schema.meta.default) ?? (required ? inferFallback(schema) : void 0);
}
function inferFallback(schema) {
  if (schema.type === "string") return "";
  if (schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (["dict", "object", "intersect"].includes(schema.type)) return {};
}
function optional(schema) {
  if (schema.type === "const") return schema;
  if (schema.type === "transform") return optional(schema.inner);
  schema = new lib_default(schema).required(false);
  if (schema.type === "object") {
    schema.dict = mapValues(schema.dict, optional);
  } else if (schema.type === "tuple") {
    schema.list = schema.list.map(optional);
  } else if (schema.type === "intersect") {
    schema.list = schema.list.map(optional);
  } else if (schema.type === "union") {
    schema.list = schema.list.map(optional);
  } else if (schema.type === "dict") {
    schema.inner = optional(schema.inner);
  } else if (schema.type === "array") {
    schema.inner = optional(schema.inner);
  }
  return schema;
}
function useDisabled() {
  const { props } = getCurrentInstance();
  return computed(() => props.disabled || props.schema?.meta?.disabled);
}
function useModel(options) {
  let stop;
  const config = ref();
  const { props, emit } = getCurrentInstance();
  const doWatch = () => watch(config, (value) => {
    try {
      if (options?.output) value = options.output(value);
      const schema = optional(lib_default(props.schema));
      if (deepEqual(schema(value), props.schema.meta.default, options?.strict)) value = null;
    } catch {
      return;
    }
    emit("update:modelValue", value);
  }, { deep: true });
  watch(() => [props.modelValue, props.schema], ([value, schema]) => {
    stop?.();
    value ??= getFallback(schema);
    if (options?.input) value = options.input(value);
    config.value = value;
    stop = doWatch();
  }, { deep: true, immediate: true });
  return config;
}
function useEntries() {
  const { props } = getCurrentInstance();
  const entries = useModel({
    strict: true,
    input: (config) => {
      const result = Object.entries(config);
      if (props.schema.type === "array") {
        const padding = (props.schema.meta.min ?? 0) - result.length;
        for (let i = 0; i < padding; i++) {
          result.push(["" + result.length, null]);
        }
      }
      return result;
    },
    output: (config) => {
      if (props.schema.type === "array") {
        return config.map(([, value]) => value);
      }
      const result = {};
      for (const [key, value] of config) {
        if (key in result) throw new Error("duplicate entries");
        result[key] = value;
      }
      return result;
    }
  });
  const isFixedLength = computed(() => {
    return props.schema.meta.min && props.schema.meta.min === props.schema.meta.max;
  });
  const isMax = computed(() => entries.value.length >= props.schema.meta.max);
  const isMin = computed(() => entries.value.length >= props.schema.meta.max);
  const reindex = () => {
    if (props.schema.type !== "array") return;
    for (let i = 0; i < entries.value.length; i++) {
      entries.value[i][0] = "" + i;
    }
  };
  return {
    entries,
    isMax,
    isMin,
    isFixedLength,
    up(index) {
      if (props.schema.type === "dict") {
        entries.value.splice(index - 1, 0, ...entries.value.splice(index, 1));
      } else {
        const temp = entries.value[index][1];
        entries.value[index][1] = entries.value[index - 1][1];
        entries.value[index - 1][1] = temp;
      }
      reindex();
    },
    down(index) {
      if (props.schema.type === "dict") {
        entries.value.splice(index + 1, 0, ...entries.value.splice(index, 1));
      } else {
        const temp = entries.value[index][1];
        entries.value[index][1] = entries.value[index + 1][1];
        entries.value[index + 1][1] = temp;
      }
      reindex();
    },
    del(index) {
      entries.value.splice(index, 1);
      reindex();
    },
    insert(index) {
      entries.value.splice(index, 0, ["", null]);
      reindex();
    }
  };
}
function isConstUnion(schema) {
  return schema.type === "union" && schema.list.every((item) => item.type === "const");
}
function isMultiSelect(schema) {
  if (schema.type === "bitset") return true;
  if (schema.type === "array") return isConstUnion(schema.inner);
}
function isValidColumn(schema) {
  return ["string", "number", "boolean"].includes(schema.type) || isConstUnion(schema) || isMultiSelect(schema);
}
function ensureColumns(entries) {
  entries = entries.filter(([, schema]) => !schema.meta.hidden);
  if (entries.every(([, schema]) => isValidColumn(schema))) return entries;
}
function toColumns(schema) {
  if (isValidColumn(schema)) {
    return [[null, schema]];
  } else if (schema.type === "tuple") {
    return ensureColumns(Object.entries(schema.list));
  } else if (schema.type === "object") {
    return ensureColumns(Object.entries(schema.dict));
  }
}

// node_modules/schemastery-vue/src/index.ts
import SchemaBase from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/base.vue";
import Primitive from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/primitive.vue";
import SchemaCheckbox from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/checkbox.vue";
import SchemaGroup from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/group.vue";
import SchemaIntersect from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/intersect.vue";
import SchemaObject from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/object.vue";
import SchemaRadio from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/radio.vue";
import SchemaMultiSelect from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/multiselect.vue";
import SchemaTable from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/table.vue";
import SchemaTextarea from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/textarea.vue";
import SchemaTuple from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/tuple.vue";
import SchemaUnion from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/extensions/union.vue";
import KBadge from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/badge.vue";
import KSchema from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/schema.vue";
import KForm from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/form.vue";
import "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/styles/index.scss";

// node_modules/schemastery-vue/src/icons/index.ts
import IconAdd from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/add.vue";
import IconArrowDown from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/arrow-down.vue";
import IconArrowUp from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/arrow-up.vue";
import IconBranch from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/branch.vue";
import IconClose from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/close.vue";
import IconCode from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/code.vue";
import IconCollapse from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/collapse.vue";
import IconDelete from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/delete.vue";
import IconEllipsis from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/ellipsis.vue";
import IconExpand from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/expand.vue";
import IconExternal from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/external.vue";
import IconEyeSlash from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/eye-slash.vue";
import IconEye from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/eye.vue";
import IconInsertAfter from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/insert-after.vue";
import IconInsertBefore from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/insert-before.vue";
import IconInvalid from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/invalid.vue";
import IconRedo from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/redo.vue";
import IconReset from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/reset.vue";
import IconSquareCheck from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/square-check.vue";
import IconSquareEmpty from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/square-empty.vue";
import IconUndo from "C:/Users/mark/Documents/antigravity/stack/node_modules/schemastery-vue/src/icons/undo.vue";

// node_modules/schemastery-vue/src/index.ts
var extensions = /* @__PURE__ */ new Set();
var form = Object.assign(SchemaBase, {
  Form: KForm,
  Badge: KBadge,
  Schema: KSchema,
  useModel,
  useEntries,
  useDisabled,
  getFallback,
  extensions,
  install(app) {
    app.provide("__SCHEMASTERY_EXTENSIONS__", extensions);
    app.component("k-form", KForm);
    app.component("k-badge", KBadge);
    app.component("k-schema", KSchema);
  }
});
form.extensions.add({
  type: "bitset",
  role: "select",
  component: SchemaMultiSelect,
  validate: (value) => typeof value === "number" || Array.isArray(value) && value.every((v) => typeof v === "string")
});
form.extensions.add({
  type: "array",
  role: "select",
  component: SchemaMultiSelect,
  validate: (value) => Array.isArray(value) && value.every((v) => typeof v === "string")
});
form.extensions.add({
  type: "bitset",
  component: SchemaCheckbox,
  validate: (value) => typeof value === "number" || Array.isArray(value) && value.every((v) => typeof v === "string")
});
form.extensions.add({
  type: "array",
  role: "checkbox",
  component: SchemaCheckbox,
  validate: (value) => Array.isArray(value) && value.every((v) => typeof v === "string")
});
form.extensions.add({
  type: "array",
  component: SchemaGroup,
  validate: (value) => Array.isArray(value)
});
form.extensions.add({
  type: "dict",
  component: SchemaGroup,
  validate: (value) => typeof value === "object"
});
form.extensions.add({
  type: "object",
  component: SchemaObject,
  validate: (value) => typeof value === "object"
});
form.extensions.add({
  type: "intersect",
  component: SchemaIntersect,
  validate: (value) => typeof value === "object"
});
form.extensions.add({
  type: "union",
  role: "radio",
  component: SchemaRadio
});
form.extensions.add({
  type: "array",
  role: "table",
  component: SchemaTable,
  validate: (value, schema) => Array.isArray(value) && !!toColumns(schema.inner)
});
form.extensions.add({
  type: "dict",
  role: "table",
  component: SchemaTable,
  validate: (value, schema) => typeof value === "object" && !!toColumns(schema.inner)
});
form.extensions.add({
  type: "string",
  role: "textarea",
  component: SchemaTextarea,
  validate: (value) => typeof value === "string"
});
form.extensions.add({
  type: "tuple",
  component: SchemaTuple,
  validate: (value) => Array.isArray(value)
});
form.extensions.add({
  type: "union",
  component: SchemaUnion
});
var src_default = form;

// node_modules/@cordisjs/components/client/form/index.ts
function form_default(app) {
  app.use(src_default);
}

// node_modules/@cordisjs/components/client/virtual/index.ts
import VirtualList from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/components/client/virtual/list.vue";
function virtual_default(app) {
  app.component("virtual-list", VirtualList);
}

// node_modules/@cordisjs/components/client/index.ts
import Comment from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/components/client/k-comment.vue";
import "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/components/client/index.scss";
function client_default(app) {
  app.use(form_default);
  app.use(virtual_default);
  app.component("k-comment", Comment);
}

// node_modules/@cordisjs/client/client/context.ts
var kContext = /* @__PURE__ */ Symbol("context");
function useContext() {
  const parent = inject(kContext);
  const fiber = parent.plugin(() => {
  });
  onScopeDispose(fiber.dispose);
  return fiber.ctx;
}
function useInject(name) {
  const parent = inject(kContext);
  const initial = parent.get(name);
  const service = ref(typeof initial == "object" && initial ? markRaw(initial) : initial);
  onScopeDispose(parent.on("internal/service", () => {
    const value = parent.get(name);
    service.value = typeof value == "object" && value ? markRaw(value) : value;
  }));
  return service;
}
function useRpc() {
  const parent = inject(kContext);
  return parent.$entry.data;
}
markRaw(Context.prototype);
markRaw(Fiber.prototype);
markRaw(Service.prototype);

// node_modules/@cordisjs/client/client/utils.ts
function insert(list, item) {
  markRaw(item);
  const index = list.findIndex((a) => a.order < item.order);
  if (index >= 0) {
    list.splice(index, 0, item);
  } else {
    list.push(item);
  }
}

// node_modules/@cordisjs/client/client/plugins/action.ts
function useMenu(id) {
  const ctx = useContext();
  return (event, value) => {
    ctx.client.action.define(id, value);
    event.preventDefault();
    const { clientX, clientY } = event;
    ctx.client.action.activeMenus.splice(0, Infinity, {
      id,
      relative: {
        left: clientX,
        top: clientY,
        right: clientX,
        bottom: clientY
      }
    });
  };
}
var ActionService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    ctx.client.addEventListener("keydown", (event) => {
      const scope = this.createScope();
      for (const action of Object.values(this.actions)) {
        if (!action.shortcut) continue;
        const keys = action.shortcut.split("+").map((key) => key.toLowerCase().trim());
        let ctrlKey = false, shiftKey = false, metaKey = false, code;
        for (const key of keys) {
          switch (key) {
            case "shift":
              shiftKey = true;
              continue;
            case "ctrl":
              if (navigator.platform.toLowerCase().includes("mac")) {
                metaKey = true;
              } else {
                ctrlKey = true;
              }
              continue;
            default:
              code = key;
          }
        }
        if (ctrlKey !== event.ctrlKey) continue;
        if (shiftKey !== event.shiftKey) continue;
        if (metaKey !== event.metaKey) continue;
        if (code !== event.key.toLowerCase()) continue;
        if (action.hidden?.(scope)) continue;
        if (action.disabled?.(scope)) continue;
        event.preventDefault();
        action.action(scope);
      }
    });
  }
  ctx;
  scope = shallowReactive({});
  menus = reactive({});
  actions = reactive({});
  activeMenus = reactive([]);
  action(id, options) {
    if (typeof options === "function") options = { action: options };
    markRaw(options);
    return this.ctx.effect(() => {
      this.actions[id] = options;
      return () => delete this.actions[id];
    });
  }
  menu(id, items) {
    for (const item of items) {
      if (item.icon && typeof item.icon === "object") markRaw(item.icon);
    }
    return this.ctx.effect(() => {
      const list = this.menus[id] ||= [];
      items.forEach((item) => insert(list, item));
      return () => {
        items.forEach((item) => remove(list, item));
        if (!list.length) delete this.menus[id];
      };
    });
  }
  define(key, value) {
    return this.ctx.effect(() => {
      this.scope[key] = value;
      return () => delete this.scope[key];
    });
  }
  createScope(override = {}) {
    const scope = { ...this.scope, ...override };
    return createScope(scope);
  }
};
function createScope(scope, prefix = "") {
  return new Proxy({}, {
    get: (target, key) => {
      if (typeof key === "symbol") return target[key];
      key = prefix + key;
      if (key in scope) return toValue(scope[key]);
      const _prefix = key + ".";
      if (Object.keys(scope).some((k) => k.startsWith(_prefix))) {
        return createScope(scope, key + ".");
      }
    }
  });
}

// node_modules/@cordisjs/client/client/plugins/loader.ts
import { apply, DeltaState } from "@cordisjs/muon";
function defineExtension(callback) {
  return callback;
}
function unwrapExports(module) {
  return module?.default || module;
}
function jsLoader(ctx, exports) {
  return ctx.plugin(unwrapExports(exports), ctx.$entry.data);
}
function cssLoader(ctx, link) {
  ctx.effect(() => {
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, "Node.appendChild");
  return new Promise((resolve2, reject) => {
    link.onload = resolve2;
    link.onerror = reject;
  });
}
var loaders = {
  async [`.css`](ctx, url) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    return ctx.plugin(cssLoader, link);
  },
  async [``](ctx, url) {
    const exports = await import(
      /* @vite-ignore */
      url
    );
    return ctx.plugin(jsLoader, exports);
  }
};
function injectMethods(ctx, entryRandomId, target, methods) {
  if (!target || typeof target !== "object" || !methods?.length) return;
  for (const name of methods) {
    Object.defineProperty(target, name, {
      value: (...args) => ctx.client.rpc.call(entryRandomId, name, args),
      enumerable: false,
      configurable: true,
      writable: false
    });
  }
}
var LoaderService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
      const nav = performance.getEntriesByType("navigation")[0];
      this.initialStatus = nav?.responseStatus;
    }
    ctx.on("entry:delta", ({ id, ...delta }) => {
      const entry = this.entries[id];
      if (!entry) return;
      const mutation = entry.state.load(delta);
      const next = apply(entry.data.value, mutation);
      if (mutation.path.length === 0 && mutation.kind.type === "replace") {
        entry.data.value = next;
        injectMethods(this.ctx, id, entry.data.value, this._methods[id]);
      }
    });
    this.initTask = new Promise((resolve2) => {
      this.ctx.on("entry:init", async (value) => {
        const { version, entries } = value;
        if (this.version && version && this.version !== version) {
          return window.location.reload();
        }
        this.version = version;
        await Promise.all(Object.entries(entries).map(async ([key, body]) => {
          if (!body) {
            const $entry2 = this.entries[key];
            if ($entry2) {
              delete this.entries[key];
              delete this._methods[key];
              for (const fiber of Object.values($entry2.fibers)) {
                fiber.dispose();
              }
            }
            return;
          }
          const { files, entryId, data, cursor, methods } = body;
          const state = new DeltaState();
          if (cursor) state.restore(cursor);
          let $entry = this.entries[key];
          if ($entry) {
            for (const url of Object.keys($entry.fibers)) {
              if (files.includes(url)) continue;
              $entry.fibers[url].dispose();
              delete $entry.fibers[url];
            }
            $entry.entryId = entryId;
            $entry.data.value = data;
            $entry.state = state;
            $entry.done.value = false;
          } else {
            $entry = this.entries[key] = {
              done: ref(false),
              entryId,
              data: ref(data),
              fibers: {},
              state
            };
          }
          this._methods[key] = methods ?? [];
          injectMethods(this.ctx, key, $entry.data.value, methods);
          const ctx2 = this.ctx.extend({ $entry });
          const pending = files.filter((url) => !$entry.fibers[url]);
          const task = Promise.all(pending.map(async (url) => {
            for (const ext in loaders) {
              if (!url.endsWith(ext)) continue;
              try {
                ctx2.$entry.fibers[url] = await loaders[ext](ctx2, url);
              } catch (e) {
                console.error(`[loader] failed to load ${url}:`, e);
              }
              return;
            }
            console.error(`No loader found for ${url}`);
          }));
          this._bumpPending(1);
          task.finally(() => {
            this._bumpPending(-1);
            $entry.done.value = true;
          });
        }));
        if (version) {
          resolve2();
          this._initFired = true;
          this._bumpPending(0);
        }
      });
    });
  }
  ctx;
  version;
  entries = shallowReactive({});
  /**
   * Resolves after the first `entry:init` registers all entry data + methods.
   * Gates `ctx.client.mount()` (i.e. first paint).
   */
  initTask;
  /**
   * Reactive flag: are all known entries' modules imported and applied?
   *
   * Driven by:
   * - `_initFired` (one-shot, flips on first `entry:init`)
   * - `_pending` (counter of in-flight module-import tasks)
   *
   * `ready = _initFired && _pending === 0`. Used by the route view as the
   * sole signal between "loading" (still importing modules — could be
   * initial boot or a runtime-added entry) and "404" (everything we know
   * about is loaded but the URL still doesn't match anything).
   *
   * Intentionally separate from `initTask`: `initTask` resolves after the
   * first batch of entry data lands so first paint isn't gated on module
   * latency, while `ready` keeps tracking module loads even after first
   * paint and after first paint and across runtime entry changes.
   */
  ready = ref(false);
  /**
   * HTTP status code of the document navigation request (read once at
   * construct time). The server returns 404 for SPA paths that no entry's
   * `routes` covers — when we see that here, we can render NotFound
   * immediately even if `ready` is still false because some sibling entry's
   * module is in-flight or stuck. Pure optimisation; subsequent SPA-internal
   * navigation doesn't refresh this value.
   */
  initialStatus;
  // Map of webui Entry.id → method names (kept so we can re-inject after a
  // root replace mutation rebuilds entry.data.value).
  _methods = /* @__PURE__ */ Object.create(null);
  _pending = 0;
  _initFired = false;
  _bumpPending(delta) {
    this._pending += delta;
    this.ready.value = this._initFired && this._pending === 0;
  }
};

// node_modules/@cordisjs/client/client/plugins/router.ts
var import_path_to_regexp = __toESM(require_dist(), 1);

// node_modules/@cordisjs/client/client/data.ts
var global = CLIENT_CONFIG;
function connect(ctx, callback) {
  const value = callback();
  let sendTimer;
  let closeTimer;
  const refresh = () => {
    if (!global.heartbeat) return;
    clearTimeout(sendTimer);
    sendTimer = +setTimeout(() => {
      value?.send(JSON.stringify({ type: "ping" }));
    }, global.heartbeat.interval);
    clearTimeout(closeTimer);
    closeTimer = +setTimeout(() => {
      value?.close();
    }, global.heartbeat.timeout);
  };
  const reconnect = () => {
    ctx.client.socket.value = void 0;
    console.log("[cordis] websocket disconnected, will retry in 1s...");
    setTimeout(() => {
      connect(ctx, callback).then(location.reload, () => {
        console.log("[cordis] websocket disconnected, will retry in 1s...");
      });
    }, 1e3);
  };
  value.addEventListener("message", (ev) => {
    refresh();
    const data = JSON.parse(ev.data);
    if (data.type !== "pong") {
      console.debug("↓%c", "color:purple", data.type, data.body);
    }
    ctx.emit(data.type, data.body);
  });
  value.addEventListener("close", reconnect);
  return new Promise((resolve2, reject) => {
    value.addEventListener("open", (event) => {
      ctx.client.socket.value = markRaw(value);
      resolve2(event);
    });
    value.addEventListener("error", reject);
  });
}

// node_modules/@cordisjs/client/client/plugins/router.ts
var INITIAL = {
  path: "",
  fullPath: "",
  query: {},
  params: {},
  meta: {},
  matched: []
};
var kRoute = /* @__PURE__ */ Symbol("cordis.client.route");
var kRouter = /* @__PURE__ */ Symbol("cordis.client.router");
function parseUrl(input) {
  const i = input.indexOf("?");
  if (i < 0) return { path: input, query: {} };
  const query = {};
  for (const [k, v] of new URLSearchParams(input.slice(i + 1))) query[k] = v;
  return { path: input.slice(0, i), query };
}
function stringifyQuery(query) {
  const parts = [];
  for (const k in query) {
    if (query[k] === void 0) continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(query[k]));
  }
  return parts.length ? "?" + parts.join("&") : "";
}
var Router = class {
  constructor(base) {
    this.base = base;
    window.addEventListener("popstate", () => {
      const url = location.pathname.slice(this.base.length) + location.search;
      this._navigate(url, true).catch(console.error);
    });
  }
  base;
  records = [];
  // shallowRef so `currentRoute.value === INITIAL` works as a sentinel; ref()
  // wraps the value in a reactive proxy and breaks identity. We always replace
  // .value with a fresh RouteLocation so deep reactivity is unneeded anyway.
  currentRoute = shallowRef(INITIAL);
  _before = [];
  _after = [];
  resolve(target) {
    let path, query;
    if (typeof target === "string") {
      ({ path, query } = parseUrl(target));
    } else {
      path = target.path ?? this.currentRoute.value.path;
      query = {};
      for (const k in target.query ?? {}) {
        if (target.query[k] !== void 0) query[k] = target.query[k];
      }
    }
    for (const record of this.records) {
      const m = record.regex.exec(path);
      if (!m) continue;
      const params = {};
      record.keys.forEach((key, i) => params[key] = m[i + 1] ?? "");
      const fullPath2 = path + stringifyQuery(query);
      return { path, fullPath: fullPath2, query, params, name: record.name, meta: record.meta, matched: [record] };
    }
    const fullPath = path + stringifyQuery(query);
    return { path, fullPath, query, params: {}, meta: {}, matched: [] };
  }
  addRoute(record) {
    const { regexp: regex, keys } = (0, import_path_to_regexp.pathToRegexp)(record.path);
    const full = { ...record, regex, keys: keys.map((k) => k.name) };
    this.records.push(full);
    const cur = this.currentRoute.value;
    if (cur !== INITIAL && !cur.matched.length) {
      const resolved = this.resolve(cur.fullPath);
      if (resolved.matched.length) {
        this.currentRoute.value = resolved;
      }
    }
    return () => {
      remove(this.records, full);
      if (this.currentRoute.value.matched[0] === full) {
        this.currentRoute.value = this.resolve(this.currentRoute.value.fullPath);
      }
    };
  }
  beforeEach(guard) {
    this._before.push(guard);
    return () => remove(this._before, guard);
  }
  afterEach(guard) {
    this._after.push(guard);
    return () => remove(this._after, guard);
  }
  push(target) {
    const resolved = this.resolve(target);
    if (!resolved.matched.length) {
      throw new Error(`router.push: no route matches "${resolved.fullPath}"`);
    }
    return this._navigate(resolved.fullPath, false);
  }
  replace(target) {
    const resolved = this.resolve(target);
    if (!resolved.matched.length) {
      throw new Error(`router.replace: no route matches "${resolved.fullPath}"`);
    }
    return this._navigate(resolved.fullPath, true);
  }
  async _navigate(fullPath, replace) {
    const from = this.currentRoute.value;
    let to = this.resolve(fullPath);
    for (const guard of this._before) {
      const r = await guard(to, from);
      if (r === false) return;
      if (typeof r === "string" || r && typeof r === "object") {
        to = this.resolve(r);
      }
    }
    const url = this.base + to.fullPath;
    if (replace || from === INITIAL) {
      history.replaceState(null, "", url);
    } else {
      history.pushState(null, "", url);
    }
    this.currentRoute.value = to;
    for (const guard of this._after) guard(to, from);
  }
  async ready() {
    if (this.currentRoute.value !== INITIAL) return;
    const url = location.pathname.slice(this.base.length) + location.search;
    await this._navigate(url || "/", true);
  }
  install(app) {
    app.provide(kRouter, this);
    app.provide(kRoute, this.currentRoute);
  }
};
function useRoute() {
  const route = inject(kRoute);
  return new Proxy({}, {
    get: (_, key) => route.value[key],
    has: (_, key) => key in route.value,
    ownKeys: () => Reflect.ownKeys(route.value),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(route.value, key)
  });
}
function useRouter() {
  return inject(kRouter);
}
function getActivityId(path) {
  return path.replace(/^\//, "") || "";
}
var Activity = class {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
    options.order ??= 0;
    options.position ??= "top";
    Object.assign(this, omit(options, ["icon", "name", "desc", "disabled"]));
  }
  ctx;
  options;
  id;
  *setup() {
    const { path, id = getActivityId(path), component } = this.options;
    yield this.ctx.client.router.router.addRoute({ path, name: id, component, meta: { activity: this } });
    this.id ??= id;
    this.authority ??= 0;
    this.ctx.client.router.pages[this.id] = this;
    yield () => delete this.ctx.client.router.pages[this.id];
  }
  get icon() {
    return toValue(this.options.icon) ?? "activity:default";
  }
  get name() {
    return toValue(this.options.name ?? this.id);
  }
  get desc() {
    return toValue(this.options.desc);
  }
  disabled() {
    if (this.ctx.bail("activity", this)) return true;
    if (this.options.disabled?.()) return true;
  }
};
var RouterService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    ctx.effect(() => {
      const initialTitle = document.title;
      const stop = watch(this.router.currentRoute, (route) => {
        const { name, fullPath } = route;
        if (name) this.cache[name] = fullPath;
        if (route.meta.activity) {
          document.title = `${route.meta.activity.name}`;
          if (initialTitle) document.title += ` | ${initialTitle}`;
        }
      }, { immediate: true });
      return () => {
        document.title = initialTitle;
        stop();
      };
    });
  }
  ctx;
  views = reactive({});
  cache = reactive({});
  pages = reactive({});
  router = new Router(global.uiPath);
  slot(options) {
    options.order ??= 0;
    options.component = this.ctx.client.wrapComponent(options.component);
    return this.ctx.effect(() => {
      const list = this.views[options.type] ||= [];
      insert(list, options);
      return () => {
        remove(list, options);
        if (!list.length) delete this.views[options.type];
      };
    });
  }
  page(options) {
    options.component = this.ctx.client.wrapComponent(options.component);
    if (options.icon && typeof options.icon === "object" && !isRef(options.icon)) {
      markRaw(options.icon);
    }
    return this.ctx.effect(() => {
      const activity = new Activity(this.ctx, options);
      return activity.setup();
    });
  }
};

// node_modules/@cordisjs/client/client/plugins/setting.ts
var useStorage = (key, version, fallback2) => {
  const initial = fallback2 ? fallback2() : {};
  initial["__version__"] = version;
  const storage = useLocalStorage("cordis.webui." + key, initial);
  if (storage.value["__version__"] !== version) {
    storage.value = initial;
  }
  return storage;
};
function provideStorage(factory) {
  useStorage = factory;
}
var useConfig = (useOriginal = false) => {
  const ctx = inject(kContext);
  if (!ctx) throw new Error("useConfig() requires a Vue setup context with kContext provided (use ctx.client.setting.{original,resolved} outside setup)");
  return useOriginal ? ctx.client.setting.original : ctx.client.setting.resolved;
};
var SettingService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    this.original = useStorage("config", void 0, () => ({
      theme: {
        mode: "auto",
        dark: "default-dark",
        light: "default-light"
      },
      locale: "zh-CN"
    }));
    this.settings({
      id: "",
      title: "通用设置",
      order: 1e3,
      schema: lib_default.object({
        locale: lib_default.union(["zh-CN", "en-US"]).description("语言设置。")
      }).description("通用设置")
    });
    const schema = computed(() => {
      const list = [];
      for (const settings of Object.values(this._settings)) {
        for (const options of settings) {
          if (options.schema) {
            list.push(options.schema);
          }
        }
      }
      return lib_default.intersect(list);
    });
    const doWatch = () => watch(this.resolved, (value) => {
      console.debug("config", value);
      this.original.value = schema.value.simplify(value);
    }, { deep: true });
    let stop = doWatch();
    const update = () => {
      stop?.();
      try {
        this.resolved.value = schema.value(this.original.value);
      } catch (error) {
        console.error(error);
      }
      stop = doWatch();
    };
    ctx.effect(() => () => stop?.());
    ctx.effect(() => watch(this.original, update, { deep: true }));
    ctx.effect(() => watch(schema, update));
  }
  ctx;
  _settings = reactive({});
  original;
  resolved = ref({});
  schema(extension) {
    extension.component = this.ctx.client.wrapComponent(extension.component);
    return this.ctx.effect(() => {
      src_default.extensions.add(extension);
      return () => src_default.extensions.delete(extension);
    });
  }
  settings(options) {
    markRaw(options);
    options.order ??= 0;
    options.component = this.ctx.client.wrapComponent(options.component);
    return this.ctx.effect(() => {
      const list = this._settings[options.id] ||= [];
      insert(list, options);
      return () => {
        remove(list, options);
        if (!list.length) delete this._settings[options.id];
      };
    });
  }
};

// node_modules/@cordisjs/client/client/plugins/theme.ts
var useColorMode = () => {
  const ctx = inject(kContext);
  if (!ctx) throw new Error("useColorMode() requires a Vue setup context with kContext provided (use ctx.client.theme.colorMode outside setup)");
  return ctx.client.theme.colorMode;
};
var ThemeService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    const config = ctx.client.setting.resolved;
    const preferDark = usePreferredDark();
    this.colorMode = computed(() => {
      const mode = config.value.theme.mode;
      if (mode !== "auto") return mode;
      return preferDark.value ? "dark" : "light";
    });
    ctx.client.setting.settings({
      id: "appearance",
      title: "外观设置",
      order: 900,
      schema: lib_default.object({
        theme: lib_default.object({
          mode: lib_default.union([
            lib_default.const("auto").description("跟随系统"),
            lib_default.const("dark").description("深色"),
            lib_default.const("light").description("浅色")
          ]).default("auto").description("主题偏好。"),
          dark: lib_default.string().role("theme", { mode: "dark" }).default("default-dark").description("深色主题。"),
          light: lib_default.string().role("theme", { mode: "light" }).default("default-light").description("浅色主题。")
        }).description("主题设置")
      })
    });
    ctx.effect(() => watchEffect(() => {
      if (!config.value.theme) return;
      const root = window.document.querySelector("html");
      root.setAttribute("theme", config.value.theme[this.colorMode.value]);
      if (this.colorMode.value === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }, { flush: "post" }));
  }
  ctx;
  _themes = reactive({});
  colorMode;
  theme(options) {
    markRaw(options);
    const config = this.ctx.client.setting.resolved;
    for (const [type, component] of Object.entries(options.components || {})) {
      this.ctx.client.router.slot({
        type,
        disabled: () => config.value.theme[this.colorMode.value] !== options.id,
        component
      });
    }
    return this.ctx.effect(() => {
      this._themes[options.id] = options;
      return () => delete this._themes[options.id];
    });
  }
};

// node_modules/@cordisjs/client/client/plugins/rpc.ts
var RpcService = class {
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, Service.tracker, {
      property: "ctx"
    });
    ctx.on("rpc:response", (body) => {
      const pending = this._pending.get(body.sn);
      if (!pending) return;
      this._pending.delete(body.sn);
      if (body.ok) pending.resolve(body.value);
      else pending.reject(new Error(body.message));
    });
    ctx.effect(() => watch(ctx.client.socket, (value) => {
      if (value) return;
      const error = new Error("socket disconnected");
      for (const [, pending] of this._pending) pending.reject(error);
      this._pending.clear();
    }));
  }
  ctx;
  _sn = 0;
  _pending = /* @__PURE__ */ new Map();
  call(entryId, method, args) {
    const socket = this.ctx.client.socket.value;
    if (!socket) return Promise.reject(new Error("socket not connected"));
    const sn = ++this._sn;
    return new Promise((resolve2, reject) => {
      this._pending.set(sn, { resolve: resolve2, reject });
      socket.send(JSON.stringify({
        type: "rpc:request",
        body: { sn, entryId, method, args }
      }));
    });
  }
};

// node_modules/marked-vue/lib/index.mjs
var xss = __toESM(require_lib(), 1);
var __defProp3 = Object.defineProperty;
var __name3 = (target, value) => __defProp3(target, "name", { value, configurable: true });
var allowedTags = [
  // Content sectioning
  "address",
  "article",
  "aside",
  "footer",
  "header",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hgroup",
  "main",
  "nav",
  "section",
  // Text content
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "ul",
  // Inline text semantics
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "rb",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
  // Table content
  "caption",
  "col",
  "colgroup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr"
];
var voidTags = ["img", "br", "hr", "area", "base", "basefont", "input", "link", "meta"];
var allowedProtocols = ["http:", "https:", "mailto:", "tel:"];
function checkUrl(value) {
  try {
    const url = new URL(value, location.toString());
    return allowedProtocols.includes(url.protocol);
  } catch (e) {
    return false;
  }
}
__name3(checkUrl, "checkUrl");
function sanitize2(html) {
  const whiteList = {
    ...Object.fromEntries(allowedTags.map((tag) => [tag, []]))
  };
  const stack = [];
  html = xss.filterXSS(html, {
    whiteList,
    stripIgnoreTag: true,
    onTag(tag, raw, options) {
      let html2;
      if (tag === "a" && !options.isClosing) {
        const attrs = {};
        xss.parseAttr(raw.slice(3), (name, value) => {
          if (name === "href") {
            attrs[name] = checkUrl(value) ? value : "#";
          } else if (name === "title") {
            attrs[name] = xss.escapeAttrValue(value);
          }
          return "";
        });
        attrs.rel = "noopener noreferrer";
        attrs.target = "_blank";
        html2 = `<a ${Object.entries(attrs).map(([name, value]) => `${name}="${value}"`).join(" ")}>`;
      }
      if (raw.endsWith("/>") || voidTags.includes(tag))
        return;
      if (!options.isClosing) {
        stack.push(tag);
        return html2;
      }
      let result = "";
      while (stack.length) {
        const last = stack.pop();
        if (last === tag) {
          return result + raw;
        }
        result += `</${last}>`;
      }
      return raw.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  });
  while (stack.length) {
    const last = stack.pop();
    html += `</${last}>`;
  }
  return html;
}
__name3(sanitize2, "sanitize");
var src_default2 = defineComponent({
  props: {
    source: String,
    inline: Boolean,
    tag: String,
    unsafe: Boolean
  },
  setup(props) {
    return () => {
      let html = props.inline ? marked.parseInline(props.source || "") : marked.parse(props.source || "");
      if (!props.unsafe)
        html = sanitize2(html);
      const tag = props.tag || (props.inline ? "span" : "div");
      return h(tag, {
        class: "markdown",
        innerHTML: html
      });
    };
  }
});

// node_modules/@cordisjs/client/client/components/common/index.ts
import Button from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/common/k-button.vue";
import Hint from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/common/k-hint.vue";
import Tab from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/common/k-tab.vue";
function common_default(app) {
  app.component("k-button", Button);
  app.component("k-hint", Hint);
  app.component("k-tab", Tab);
}

// node_modules/@cordisjs/client/client/components/icons/index.ts
var icons_exports = {};
__export(icons_exports, {
  install: () => install,
  register: () => register
});
import Default from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/default.vue";
import Ellipsis from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/ellipsis.vue";
import Home from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/home.vue";
import Moon from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/moon.vue";
import Settings from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/settings.vue";
import Sun from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/activity/sun.vue";
import ArrowLeft from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/arrow-left.vue";
import ArrowRight from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/arrow-right.vue";
import BoxOpen from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/box-open.vue";
import CheckFull from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/check-full.vue";
import ChevronDown from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/chevron-down.vue";
import ChevronLeft from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/chevron-left.vue";
import ChevronRight from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/chevron-right.vue";
import ChevronUp from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/chevron-up.vue";
import ClipboardList from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/clipboard-list.vue";
import Download from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/download.vue";
import Edit from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/edit.vue";
import ExclamationFull from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/exclamation-full.vue";
import Expand from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/expand.vue";
import FileArchive from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/file-archive.vue";
import Filter from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/filter.vue";
import GitHub from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/github.vue";
import GitLab from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/gitlab.vue";
import InfoFull from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/info-full.vue";
import Koishi from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/koishi.vue";
import Link from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/link.vue";
import PaperPlane from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/paper-plane.vue";
import Pause from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/pause.vue";
import Play from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/play.vue";
import QuestionEmpty from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/question-empty.vue";
import Redo from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/redo.vue";
import Refresh from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/refresh.vue";
import Search from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/search.vue";
import SearchMinus from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/search-minus.vue";
import SearchPlus from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/search-plus.vue";
import StarEmpty from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/star-empty.vue";
import StarFull from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/star-full.vue";
import Start from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/start.vue";
import Tag from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/tag.vue";
import TimesFull from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/times-full.vue";
import Tools from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/tools.vue";
import Trash from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/trash.vue";
import Undo from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/undo.vue";
import User from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/svg/user.vue";
import "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/icons/style.scss";
var registry = reactive({});
register("activity:default", Default);
register("activity:ellipsis", Ellipsis);
register("activity:home", Home);
register("activity:moon", Moon);
register("activity:settings", Settings);
register("activity:sun", Sun);
register("arrow-up", IconArrowUp);
register("arrow-down", IconArrowDown);
register("arrow-left", ArrowLeft);
register("arrow-right", ArrowRight);
register("box-open", BoxOpen);
register("check-full", CheckFull);
register("chevron-down", ChevronDown);
register("chevron-left", ChevronLeft);
register("chevron-right", ChevronRight);
register("chevron-up", ChevronUp);
register("clipboard-list", ClipboardList);
register("close", IconClose);
register("delete", IconDelete);
register("download", Download);
register("edit", Edit);
register("ellipsis", IconEllipsis);
register("exclamation-full", ExclamationFull);
register("expand", Expand);
register("external", IconExternal);
register("eye-slash", IconEyeSlash);
register("eye", IconEye);
register("file-archive", FileArchive);
register("filter", Filter);
register("github", GitHub);
register("gitlab", GitLab);
register("info-full", InfoFull);
register("koishi", Koishi);
register("link", Link);
register("paper-plane", PaperPlane);
register("pause", Pause);
register("play", Play);
register("add", IconAdd);
register("question-empty", QuestionEmpty);
register("redo", Redo);
register("refresh", Refresh);
register("search", Search);
register("search-minus", SearchMinus);
register("search-plus", SearchPlus);
register("star-empty", StarEmpty);
register("star-full", StarFull);
register("start", Start);
register("tag", Tag);
register("times-full", TimesFull);
register("tools", Tools);
register("trash", Trash);
register("undo", Undo);
register("user", User);
function register(name, component) {
  registry[name] = markRaw(component);
}
function install(app) {
  app.component("k-icon", defineComponent({
    props: {
      name: String
    },
    render(props) {
      const component = registry[props.name];
      return component && h(component);
    }
  }));
}

// node_modules/@cordisjs/client/client/components/layout/index.ts
import Card from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/layout/card.vue";
import Content from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/layout/content.vue";
import Empty from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/layout/empty.vue";
import TabGroup from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/layout/tab-group.vue";
import TabItem from "C:/Users/mark/Documents/antigravity/stack/node_modules/@cordisjs/client/client/components/layout/tab-item.vue";
function layout_default(app) {
  app.component("k-card", Card);
  app.component("k-content", Content);
  app.component("k-empty", Empty);
  app.component("k-tab-group", TabGroup);
  app.component("k-tab-item", TabItem);
}

// node_modules/@cordisjs/client/client/components/link.ts
var KActivityLink = defineComponent({
  props: {
    id: {
      type: String,
      required: true
    }
  },
  setup(props, { slots }) {
    const ctx = useContext();
    return () => {
      const activity = ctx.client.router.pages[props.id];
      const target = ctx.client.router.cache[activity?.id] || activity?.path.replace(/\{[^}]*\}/g, "");
      return h("a", {
        href: target,
        onClick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          if (target) ctx.client.router.router.push(target);
        }
      }, slots.default?.() ?? activity?.name);
    };
  }
});
function link_default(app) {
  app.component("k-activity-link", KActivityLink);
}

// node_modules/@cordisjs/client/client/components/slot.ts
var KSlot = defineComponent({
  props: {
    name: {
      type: String,
      required: true
    },
    data: Object,
    single: Boolean
  },
  setup(props, { slots }) {
    const ctx = useContext();
    return () => {
      const internal = props.single ? [] : [...slots.default?.() || []].filter((node) => node.type === KSlotItem).map((node) => ({ node, order: node.props?.order || 0 }));
      const external = [...ctx.client.router.views[props.name] || []].filter((item) => !item.disabled?.()).map((item) => ({
        node: h(item.component, { ...props.data }, slots),
        order: item.order,
        layer: 1
      }));
      const children = [...internal, ...external].sort((a, b) => b.order - a.order);
      if (props.single) {
        return children[0]?.node || slots.default?.();
      }
      return children.map((item) => item.node);
    };
  }
});
var KSlotItem = defineComponent({
  props: {
    order: Number
  },
  setup(props, { slots }) {
    return () => slots.default?.();
  }
});
function defineSlotComponent(name) {
  return defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h(KSlot, { name, data: attrs, single: true }, slots);
    }
  });
}
var slot_default = (app) => {
  app.component("k-slot", KSlot);
  app.component("k-slot-item", KSlotItem);
  app.component("k-layout", defineSlotComponent("layout"));
  app.component("k-status", defineSlotComponent("status"));
};

// node_modules/@cordisjs/client/client/components/index.ts
import "C:/Users/mark/Documents/antigravity/stack/node_modules/element-plus/dist/index.css";
var loading = ElLoading.service;
var message = ElMessage;
var messageBox = ElMessageBox;
function components_default(app) {
  app.use(installer);
  app.component("k-markdown", src_default2);
  app.use(common_default);
  app.use(client_default);
  app.use(icons_exports);
  app.use(layout_default);
  app.use(link_default);
  app.use(slot_default);
}

// node_modules/@cordisjs/client/client/index.ts
var ClientService = class extends Service {
  app;
  action;
  loader;
  router;
  setting;
  theme;
  rpc;
  socket = ref();
  _store = /* @__PURE__ */ Object.create(null);
  constructor(ctx) {
    super(ctx, "client");
    ctx.root["$entry"] = void 0;
    this.app = createApp(defineComponent({
      setup: () => () => [
        h(resolveComponent("k-slot"), { name: "root", single: true }),
        h(resolveComponent("k-slot"), { name: "global" })
      ]
    }));
    this.app.provide(kContext, ctx);
    this.app.use(components_default);
    this.action = new ActionService(ctx);
    this.loader = new LoaderService(ctx);
    this.router = new RouterService(ctx);
    this.setting = new SettingService(ctx);
    this.theme = new ThemeService(ctx);
    this.rpc = new RpcService(ctx);
    const store = this._store;
    ctx.on("internal/service", function(name) {
      const ref1 = store[this[Context.isolate][name]];
      if (ref1) ref1.value = Symbol(name);
      const ref22 = store[name];
      if (ref22) ref22.value = Symbol(name);
    }, { global: true });
    ctx.on("internal/get", (ctx2, name, error, next) => {
      const ref3 = store[ctx2.reflect.store[name] ?? name] ??= customRef((get, set) => ({ get, set }));
      return ref3.value, next();
    }, { prepend: true });
    ctx.effect(() => watchEffect(() => {
      locale.value = this.setting.resolved.value.locale ?? "en-US";
    }, { flush: "post" }));
    this.router.router.install(this.app);
    this.router.router.ready().catch((e) => {
      console.warn("[client] initial navigation failed:", e);
    });
  }
  mount(selector = "#app") {
    this.app.mount(selector);
  }
  addEventListener(type, listener, options) {
    return this.ctx.effect(() => {
      window.addEventListener(type, listener, options);
      return () => window.removeEventListener(type, listener, options);
    });
  }
  wrapComponent(component) {
    if (!component) return void 0;
    if (!this.ctx.$entry) return component;
    let ctx = this.ctx;
    if (ctx[symbols.shadow]) {
      ctx = Object.getPrototypeOf(ctx);
    }
    return markRaw(defineComponent((props, { slots }) => {
      provide(kContext, ctx);
      onErrorCaptured(() => {
        return ctx.fiber.uid !== null;
      });
      return () => h(component, props, slots);
    }));
  }
};
var client_default2 = components_default;
function createClient() {
  const root = new Context();
  root.client = new ClientService(root);
  root.on("activity", (data) => !data);
  return root;
}
export {
  Activity,
  Binary,
  ClientService,
  Context,
  CordisError,
  DisposableList,
  EventsService,
  Fiber,
  FiberState,
  INITIAL,
  IconAdd,
  IconArrowDown,
  IconArrowUp,
  IconBranch,
  IconClose,
  IconCode,
  IconCollapse,
  IconDelete,
  IconEllipsis,
  IconExpand,
  IconExternal,
  IconEye,
  IconEyeSlash,
  IconInsertAfter,
  IconInsertBefore,
  IconInvalid,
  IconRedo,
  IconReset,
  IconSquareCheck,
  IconSquareEmpty,
  IconUndo,
  Inject,
  KSlot,
  LocaleTree,
  Logger,
  LoggerLevel,
  LoggerService,
  Primitive,
  RegistryService,
  Router,
  lib_default as Schema,
  src_default as SchemaBase,
  Service,
  Time,
  ValidationError,
  VirtualList,
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  buildOuterStack,
  c16,
  c256,
  camelCase,
  camelize,
  capitalize,
  clone,
  composeError,
  connect,
  contain,
  createCallable,
  createClient,
  deduplicate,
  deepEqual,
  client_default2 as default,
  defaultFormatters,
  defineExtension,
  defineProperty,
  difference,
  fallback,
  filterKeys,
  form,
  formatProperty,
  getPropertyDescriptor,
  getTraceable,
  global,
  hexToArrayBuffer,
  hyphenate,
  icons_exports as icons,
  intersection,
  is,
  isBailed,
  isConstructor,
  isNonNullable,
  isNullable,
  isObject,
  isPlainObject,
  joinPrototype,
  kContext,
  kRoute,
  kRouter,
  loading,
  locale,
  makeArray,
  mapValues,
  message,
  messageBox,
  noop,
  omit,
  paramCase,
  pick,
  provideStorage,
  remove,
  resolveConfig,
  sanitize,
  snakeCase,
  symbols,
  translate,
  trimSlash,
  uncapitalize,
  union,
  unwrapExports,
  useColorMode,
  useConfig,
  useContext,
  useI18n,
  useI18nText,
  useInject,
  useMenu,
  useRoute,
  useRouter,
  useRpc,
  useStorage,
  mapValues as valueMap,
  withProps
};
//# sourceMappingURL=@cordisjs_client.js.map
