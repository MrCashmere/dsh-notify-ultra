/**
 * Minimal `@deepseek-ai/dsh-typert-protocol` stand-in. The real base class is a
 * Cordis `Service`, which registers itself on the owning context under its
 * service key; that registration is all this plugin depends on.
 */
export class TypertRemoteService {
  constructor(ctx, serviceKey) {
    this.ctx = ctx;
    this.name = serviceKey;
    if (ctx !== undefined && ctx !== null) ctx[serviceKey] = this;
  }
}

export const TYPERT_OWNED_VALUE = Symbol.for("dsh-typert-owned-value");
