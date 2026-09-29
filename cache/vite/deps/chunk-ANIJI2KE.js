import {
  __commonJS
} from "./chunk-73RASFYN.js";

// node_modules/path-to-regexp/dist/index.js
var require_dist = __commonJS({
  "node_modules/path-to-regexp/dist/index.js"(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PathError = exports.TokenData = void 0;
    exports.parse = parse;
    exports.compile = compile;
    exports.match = match;
    exports.pathToRegexp = pathToRegexp;
    exports.stringify = stringify;
    var DEFAULT_DELIMITER = "/";
    var NOOP_VALUE = (value) => value;
    var ID_START = /^[$_\p{ID_Start}]$/u;
    var ID_CONTINUE = /^[$\u200c\u200d\p{ID_Continue}]$/u;
    var ID = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
    function escapeText(str) {
      return str.replace(/[{}()\[\]+?!:*\\]/g, "\\$&");
    }
    function escape(str) {
      return str.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
    }
    var TokenData = class {
      constructor(tokens, originalPath) {
        this.tokens = tokens;
        this.originalPath = originalPath;
      }
    };
    exports.TokenData = TokenData;
    var PathError = class extends TypeError {
      constructor(message, originalPath) {
        let text = message;
        if (originalPath)
          text += `: ${originalPath}`;
        text += `; visit https://git.new/pathToRegexpError for info`;
        super(text);
        this.originalPath = originalPath;
      }
    };
    exports.PathError = PathError;
    function parse(str, options = {}) {
      const { encodePath = NOOP_VALUE } = options;
      const chars = [...str];
      let index = 0;
      function consumeUntil(end) {
        const output = [];
        let path = "";
        function writePath() {
          if (!path)
            return;
          output.push({
            type: "text",
            value: encodePath(path)
          });
          path = "";
        }
        while (index < chars.length) {
          const value = chars[index++];
          if (value === end) {
            writePath();
            return output;
          }
          if (value === "\\") {
            if (index === chars.length) {
              throw new PathError(`Unexpected end after \\ at index ${index}`, str);
            }
            path += chars[index++];
            continue;
          }
          if (value === ":" || value === "*") {
            const type = value === ":" ? "param" : "wildcard";
            let name = "";
            if (ID_START.test(chars[index])) {
              do {
                name += chars[index++];
              } while (ID_CONTINUE.test(chars[index]));
            } else if (chars[index] === '"') {
              let quoteStart = index;
              while (index < chars.length) {
                if (chars[++index] === '"') {
                  index++;
                  quoteStart = 0;
                  break;
                }
                if (chars[index] === "\\")
                  index++;
                name += chars[index];
              }
              if (quoteStart) {
                throw new PathError(`Unterminated quote at index ${quoteStart}`, str);
              }
            }
            if (!name) {
              throw new PathError(`Missing parameter name at index ${index}`, str);
            }
            writePath();
            output.push({ type, name });
            continue;
          }
          if (value === "{") {
            writePath();
            output.push({
              type: "group",
              tokens: consumeUntil("}")
            });
            continue;
          }
          if (value === "}" || value === "(" || value === ")" || value === "[" || value === "]" || value === "+" || value === "?" || value === "!") {
            throw new PathError(`Unexpected ${value} at index ${index - 1}`, str);
          }
          path += value;
        }
        if (end) {
          throw new PathError(`Unexpected end at index ${index}, expected ${end}`, str);
        }
        writePath();
        return output;
      }
      return new TokenData(consumeUntil(""), str);
    }
    function compile(path, options = {}) {
      const { encode = encodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
      const data = typeof path === "object" ? path : parse(path, options);
      const fn = tokensToFunction(data.tokens, delimiter, encode);
      return function path2(params = {}) {
        const missing = [];
        const path3 = fn(params, missing);
        if (missing.length) {
          throw new TypeError(`Missing parameters: ${missing.join(", ")}`);
        }
        return path3;
      };
    }
    function tokensToFunction(tokens, delimiter, encode) {
      const encoders = tokens.map((token) => tokenToFunction(token, delimiter, encode));
      return (data, missing) => {
        let result = "";
        for (const encoder of encoders) {
          result += encoder(data, missing);
        }
        return result;
      };
    }
    function tokenToFunction(token, delimiter, encode) {
      if (token.type === "text")
        return () => token.value;
      if (token.type === "group") {
        const fn = tokensToFunction(token.tokens, delimiter, encode);
        return (data, missing) => {
          const len = missing.length;
          const value = fn(data, missing);
          if (missing.length === len)
            return value;
          missing.length = len;
          return "";
        };
      }
      const encodeValue = encode || NOOP_VALUE;
      if (token.type === "wildcard" && encode !== false) {
        return (data, missing) => {
          const value = data[token.name];
          if (value == null) {
            missing.push(token.name);
            return "";
          }
          if (!Array.isArray(value) || value.length === 0) {
            throw new TypeError(`Expected "${token.name}" to be a non-empty array`);
          }
          let result = "";
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== "string") {
              throw new TypeError(`Expected "${token.name}/${i}" to be a string`);
            }
            if (i > 0)
              result += delimiter;
            result += encodeValue(value[i]);
          }
          return result;
        };
      }
      return (data, missing) => {
        const value = data[token.name];
        if (value == null) {
          missing.push(token.name);
          return "";
        }
        if (typeof value !== "string") {
          throw new TypeError(`Expected "${token.name}" to be a string`);
        }
        return encodeValue(value);
      };
    }
    function match(path, options = {}) {
      const { decode = decodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
      const { regexp, keys } = pathToRegexp(path, options);
      const decoders = keys.map((key) => {
        if (decode === false)
          return NOOP_VALUE;
        if (key.type === "param")
          return decode;
        return (value) => value.split(delimiter).map(decode);
      });
      return function match2(input) {
        const m = regexp.exec(input);
        if (!m)
          return false;
        const path2 = m[0];
        const params = /* @__PURE__ */ Object.create(null);
        for (let i = 1; i < m.length; i++) {
          if (m[i] === void 0)
            continue;
          const key = keys[i - 1];
          const decoder = decoders[i - 1];
          params[key.name] = decoder(m[i]);
        }
        return { path: path2, params };
      };
    }
    function pathToRegexp(path, options = {}) {
      const { delimiter = DEFAULT_DELIMITER, end = true, sensitive = false, trailing = true } = options;
      const keys = [];
      let source = "";
      let combinations = 0;
      function process(path2) {
        if (Array.isArray(path2)) {
          for (const p of path2)
            process(p);
          return;
        }
        const data = typeof path2 === "object" ? path2 : parse(path2, options);
        flatten(data.tokens, 0, [], (tokens) => {
          if (combinations >= 256) {
            throw new PathError("Too many path combinations", data.originalPath);
          }
          if (combinations > 0)
            source += "|";
          source += toRegExpSource(tokens, delimiter, keys, data.originalPath);
          combinations++;
        });
      }
      process(path);
      let pattern = `^(?:${source})`;
      if (trailing)
        pattern += "(?:" + escape(delimiter) + "$)?";
      pattern += end ? "$" : "(?=" + escape(delimiter) + "|$)";
      return { regexp: new RegExp(pattern, sensitive ? "" : "i"), keys };
    }
    function flatten(tokens, index, result, callback) {
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "group") {
          const len = result.length;
          flatten(token.tokens, 0, result, (seq) => flatten(tokens, index, seq, callback));
          result.length = len;
          continue;
        }
        result.push(token);
      }
      callback(result);
    }
    function toRegExpSource(tokens, delimiter, keys, originalPath) {
      let result = "";
      let backtrack = "";
      let wildcardBacktrack = "";
      let prevCaptureType = 0;
      let hasSegmentCapture = 0;
      let index = 0;
      function hasInSegment(index2, type) {
        while (index2 < tokens.length) {
          const token = tokens[index2++];
          if (token.type === type)
            return true;
          if (token.type === "text") {
            if (token.value.includes(delimiter))
              break;
          }
        }
        return false;
      }
      function peekText(index2) {
        let result2 = "";
        while (index2 < tokens.length) {
          const token = tokens[index2++];
          if (token.type !== "text")
            break;
          result2 += token.value;
        }
        return result2;
      }
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "text") {
          result += escape(token.value);
          backtrack += token.value;
          if (prevCaptureType === 2)
            wildcardBacktrack += token.value;
          if (token.value.includes(delimiter))
            hasSegmentCapture = 0;
          continue;
        }
        if (token.type === "param" || token.type === "wildcard") {
          if (prevCaptureType && !backtrack) {
            throw new PathError(`Missing text before "${token.name}" ${token.type}`, originalPath);
          }
          if (token.type === "param") {
            result += hasSegmentCapture & 2 ? `(${negate(delimiter, backtrack)}+)` : hasInSegment(index, "wildcard") ? `(${negate(delimiter, peekText(index))}+)` : hasSegmentCapture & 1 ? `(${negate(delimiter, backtrack)}+|${escape(backtrack)})` : `(${negate(delimiter, "")}+)`;
            hasSegmentCapture |= prevCaptureType = 1;
          } else {
            result += hasSegmentCapture & 2 ? `(${negate(backtrack, "")}+)` : wildcardBacktrack ? `(${negate(wildcardBacktrack, "")}+|${negate(delimiter, "")}+)` : `([^]+)`;
            wildcardBacktrack = "";
            hasSegmentCapture |= prevCaptureType = 2;
          }
          keys.push(token);
          backtrack = "";
          continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
      }
      return result;
    }
    function negate(a, b) {
      if (b.length > a.length)
        return negate(b, a);
      if (a === b)
        b = "";
      if (b.length > 1)
        return `(?:(?!${escape(a)}|${escape(b)})[^])`;
      if (a.length > 1)
        return `(?:(?!${escape(a)})[^${escape(b)}])`;
      return `[^${escape(a + b)}]`;
    }
    function stringifyTokens(tokens, index) {
      let value = "";
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === "text") {
          value += escapeText(token.value);
          continue;
        }
        if (token.type === "group") {
          value += "{" + stringifyTokens(token.tokens, 0) + "}";
          continue;
        }
        if (token.type === "param") {
          value += ":" + stringifyName(token.name, tokens[index]);
          continue;
        }
        if (token.type === "wildcard") {
          value += "*" + stringifyName(token.name, tokens[index]);
          continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
      }
      return value;
    }
    function stringify(data) {
      return stringifyTokens(data.tokens, 0);
    }
    function stringifyName(name, next) {
      if (!ID.test(name))
        return JSON.stringify(name);
      if ((next === null || next === void 0 ? void 0 : next.type) === "text" && ID_CONTINUE.test(next.value[0])) {
        return JSON.stringify(name);
      }
      return name;
    }
  }
});

export {
  require_dist
};
//# sourceMappingURL=chunk-ANIJI2KE.js.map
