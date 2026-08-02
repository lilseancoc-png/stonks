// Single source of truth for public outbound links surfaced across the site.
//
// Dependency-free leaf module (no imports) so the render modules can import it
// without any circular-import / temporal-dead-zone risk against build.mjs.
//
// NOTE: welcome.html is a standalone static file that can't import this module.
export const DISCORD_INVITE_URL = "https://discord.gg/drTq2gkf6j";
export const KO_FI_URL = "https://ko-fi.com/mingstreetapp";
