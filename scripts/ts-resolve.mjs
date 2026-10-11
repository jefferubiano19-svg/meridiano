export async function resolve(specifier, context, nextResolve) {
  const target =
    specifier.startsWith(".") &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".tsx") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".json")
      ? `${specifier}.ts`
      : specifier;
  let resolved;
  try {
    resolved = await nextResolve(target, context);
  } catch (error) {
    if (target === specifier) throw error;
    resolved = await nextResolve(specifier, context);
  }
  if (resolved.url.endsWith(".json")) {
    return { ...resolved, importAttributes: { ...resolved.importAttributes, type: "json" } };
  }
  return resolved;
}
