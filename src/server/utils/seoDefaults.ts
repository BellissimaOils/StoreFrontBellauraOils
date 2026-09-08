// Shared "SEO is mandatory" logic for products and sections.
//
// The admin's per-product/per-section SEO form (AdminSEO.tsx) always let an
// admin type a custom seo_title/seo_description, but until now those fields
// could also be saved as empty strings, and — separately — the backend was
// silently discarding them anyway (see the ALTER TABLE fix in d1Client.ts and
// the write-path fix in productRoutes.ts/sectionRoutes.ts). The combination
// of both bugs is why every product and section ended up showing the exact
// same generic fallback description: nothing admin-specific ever reached the
// database, and even the fallback text used no per-entity data.
//
// This module makes SEO fields mandatory at the point of save: if an admin
// leaves seo_title/seo_description blank, a real per-entity default is
// generated and stored (not left blank, and not a shared generic string).
// The admin can always override it later — this only fills the gap when
// they don't.

// Same slug algorithm as src/types.ts's getProductSlug on the frontend and
// the inline getSlug() in seoRoutes.ts's sitemap generator — kept in sync
// deliberately so a product's default slug always matches the URL its own
// sitemap entry and canonical tag will use.
export function slugify(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[()'".,/#!$%^&*?;:{}=\[\]_]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// Appends -2, -3, ... until the slug no longer collides with an existing
// one. Two products with the same name (e.g. different sizes of the same
// oil) would otherwise generate identical slugs, and the second one to save
// would silently take over the first one's canonical URL.
export function ensureUniqueSlug(
  candidate: string,
  existingSlugs: Iterable<string>,
): string {
  const taken = new Set(existingSlugs);
  if (!candidate) candidate = "product";
  if (!taken.has(candidate)) return candidate;
  let n = 2;
  while (taken.has(`${candidate}-${n}`)) n++;
  return `${candidate}-${n}`;
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 3).trim()}...` : clean;
}

export interface ProductSeoInput {
  name?: string;
  name_en?: string;
  description?: string;
  category?: string;
  requestedSlug?: string;
  requestedSeoTitle?: string;
  requestedSeoDescription?: string;
  requestedSeoPriority?: string;
  requestedSeoChangefreq?: string;
}

export interface ProductSeoResult {
  slug: string;
  seo_title: string;
  seo_description: string;
  seo_priority: string;
  seo_changefreq: string;
}

// Builds the final, guaranteed-non-empty SEO fields for one product. Any
// field the admin actually filled in is kept as-is (only trimmed); any field
// left blank gets a per-product generated default — never a fixed generic
// string shared across every product.
export function buildMandatoryProductSeo(
  input: ProductSeoInput,
  existingSlugs: Iterable<string>,
): ProductSeoResult {
  const displayName = (input.name_en || input.name || "").trim() || "Product";

  const requestedSlug = (input.requestedSlug || "").trim();
  const slugBase = slugify(requestedSlug || displayName) || "product";
  const slug = ensureUniqueSlug(slugBase, existingSlugs);

  const requestedTitle = (input.requestedSeoTitle || "").trim();
  const seo_title = requestedTitle || `${displayName} | Bellaura Oils`;

  const requestedDescription = (input.requestedSeoDescription || "").trim();
  let seo_description = requestedDescription;
  if (!seo_description) {
    const desc = (input.description || "").trim();
    seo_description = desc
      ? truncate(desc, 157)
      : `Shop ${displayName} at Bellaura Oils — 100% pure, natural ${
          input.category ? String(input.category).toLowerCase() : "oil"
        } with fast delivery across Morocco.`;
  }
  seo_description = truncate(seo_description, 160);

  const requestedPriority = (input.requestedSeoPriority || "").trim();
  const seo_priority = requestedPriority || "0.9";

  const requestedChangefreq = (input.requestedSeoChangefreq || "").trim();
  const seo_changefreq = requestedChangefreq || "weekly";

  return { slug, seo_title, seo_description, seo_priority, seo_changefreq };
}

export interface SectionSeoInput {
  title_en?: string;
  title_ar?: string;
  title_fr?: string;
  link_url?: string;
  requestedSeoTitle?: string;
  requestedSeoDescription?: string;
  requestedSeoPriority?: string;
  requestedSeoChangefreq?: string;
}

export interface SectionSeoResult {
  seo_title: string;
  seo_description: string;
  seo_priority: string;
  seo_changefreq: string;
}

// Same idea as buildMandatoryProductSeo, for a section/category page. A
// section has no long-form "description" field to fall back to (unlike a
// product), so the generated default is built from its own title/link
// instead of a fixed string, so two different sections never end up with
// the same generated description either.
export function buildMandatorySectionSeo(input: SectionSeoInput): SectionSeoResult {
  const displayName =
    (input.title_en || input.title_ar || input.title_fr || "").trim() ||
    "Bellaura Oils";

  const requestedTitle = (input.requestedSeoTitle || "").trim();
  const seo_title = requestedTitle || `${displayName} | Bellaura Oils`;

  const requestedDescription = (input.requestedSeoDescription || "").trim();
  const seo_description = truncate(
    requestedDescription ||
      `Explore ${displayName} at Bellaura Oils — 100% natural cold-pressed oils for skin and hair care, with fast delivery across Morocco.`,
    160,
  );

  const requestedPriority = (input.requestedSeoPriority || "").trim();
  const seo_priority = requestedPriority || "0.8";

  const requestedChangefreq = (input.requestedSeoChangefreq || "").trim();
  const seo_changefreq = requestedChangefreq || "weekly";

  return { seo_title, seo_description, seo_priority, seo_changefreq };
}
