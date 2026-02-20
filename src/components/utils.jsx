/**
 * Create a URL slug for a page name.
 * Base44 routes are kebab-case (e.g. CampaignDetail.jsx => /campaign-detail) and case-sensitive in deployed builds.
 * This helper converts PascalCase/camelCase + spaces into kebab-case lowercase.
 */
export function createPageUrl(pageName) {
  if (!pageName) return "/";
  const kebab = pageName
    .replace(/ /g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return "/" + kebab.replace(/^-/, "");
}