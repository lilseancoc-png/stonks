// Single source of truth for the public Discord invite link surfaced across the
// site — the premium-upsell lock card, the header chip, the footer, and the
// "What's included" page all import it from here.
//
// Dependency-free leaf module (no imports) so the render modules can import it
// without any circular-import / temporal-dead-zone risk against build.mjs.
//
// NOTE: welcome.html is a standalone static file that can't import this module,
// so it hardcodes the same URL — keep the two in sync. To rotate the invite,
// change it here (+ in welcome.html) and the next bake's regen-static ships it.
export const DISCORD_INVITE_URL = "https://discord.gg/GVYx7qSWxS";
