/**
 * Test-only ESM resolve hook: the plugin's framework peers are provided by the
 * DSH runtime at load time, so the offline test suite maps them to local stubs.
 * Nothing here ships with the plugin.
 */
const MAP = new Map([
  ["@deepseek-ai/schemastery", new URL("./stubs/schemastery.js", import.meta.url).href],
  ["@deepseek-ai/dsh-typert-protocol", new URL("./stubs/typert-protocol.js", import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const mapped = MAP.get(specifier);
  if (mapped !== undefined) return { url: mapped, shortCircuit: true };
  return nextResolve(specifier, context);
}
