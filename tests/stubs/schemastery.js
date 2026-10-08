/** Minimal `@deepseek-ai/schemastery` stand-in covering what Config uses. */

class Schema {
  constructor(kind, options = {}) {
    this.kind = kind;
    this.shape = options.shape;
    this.meta = {};
    this.fallback = undefined;
    this.hasFallback = false;
  }

  default(value) {
    this.fallback = value;
    this.hasFallback = true;
    return this;
  }

  volatile() {
    this.meta.volatile = true;
    return this;
  }

  parse(value) {
    if (value === undefined || value === null) {
      if (this.hasFallback) return typeof this.fallback === "function" ? this.fallback() : this.fallback;
      if (this.kind === "object") return {};
      return value;
    }
    if (this.kind === "object") {
      if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("expected an object");
      const out = {};
      for (const key of Object.keys(this.shape)) {
        const parsed = this.shape[key].parse(value[key]);
        if (parsed !== undefined) out[key] = parsed;
      }
      return out;
    }
    if (this.kind === "boolean" && typeof value !== "boolean") throw new TypeError("expected a boolean");
    if (this.kind === "string" && typeof value !== "string") throw new TypeError("expected a string");
    if (this.kind === "number" && typeof value !== "number") throw new TypeError("expected a number");
    return value;
  }
}

const z = {
  object: (shape) => new Schema("object", { shape }),
  boolean: () => new Schema("boolean"),
  string: () => new Schema("string"),
  number: () => new Schema("number"),
  any: () => new Schema("any"),
};

export default z;
export { z };
