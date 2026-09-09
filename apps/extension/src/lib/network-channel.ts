/**
 * Shared tag for messages posted from the page-world network observer.
 *
 * Kept in its own module so the content script can import the constant without
 * pulling in — and therefore executing — the `fetch`/XHR patch, which must only ever
 * run in the page's own JavaScript context.
 */
export const NETWORK_SIGNAL_SOURCE = "uplyfox-network";
