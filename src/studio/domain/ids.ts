export const STUDIO_SLUG_MAX_LENGTH = 63;
export const STUDIO_SLUG_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

const FALLBACK_SLUG = "project";

export function isStudioSlug(value: string): boolean {
  return STUDIO_SLUG_REGEX.test(value);
}

export function slugifyTitle(title: string): string {
  const remainder = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  let slug: string;
  if (!remainder) {
    slug = FALLBACK_SLUG;
  } else if (!/^[a-z]/.test(remainder)) {
    slug = `${FALLBACK_SLUG}-${remainder}`;
  } else {
    slug = remainder;
  }

  if (slug.length > STUDIO_SLUG_MAX_LENGTH) {
    slug = slug.slice(0, STUDIO_SLUG_MAX_LENGTH).replace(/-+$/g, "");
  }

  if (!isStudioSlug(slug)) {
    return FALLBACK_SLUG;
  }

  return slug;
}

export function nextNumberedId(prefix: string, existingIds: Iterable<string>): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let max = 0;

  for (const id of existingIds) {
    const match = pattern.exec(id);
    if (!match) {
      continue;
    }

    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }

  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

export function allocateUniqueSlug(base: string, isTaken: (id: string) => boolean): string {
  const start = isStudioSlug(base) ? base : FALLBACK_SLUG;
  if (!isTaken(start)) {
    return start;
  }

  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const stemBudget = STUDIO_SLUG_MAX_LENGTH - suffix.length;
    let stem = start.slice(0, stemBudget).replace(/-+$/g, "");
    if (!stem || !/^[a-z]/.test(stem)) {
      stem = FALLBACK_SLUG.slice(0, Math.max(1, stemBudget));
    }

    const candidate = `${stem}${suffix}`;
    if (isStudioSlug(candidate) && !isTaken(candidate)) {
      return candidate;
    }
  }

  return FALLBACK_SLUG;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
