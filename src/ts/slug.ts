// mirrors pf2e's sluggify(): lowercase, non-alphanumerics become dashes
export function sluggify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// 16 char id matching foundry.utils.randomID()
export function randomID(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
