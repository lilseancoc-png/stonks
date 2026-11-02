// Sports is an Owner destination. The same signed Owner session that opens
// every other private desk (both compatibility claims plus a subject) opens
// it; nothing else does. SPORTS_ENABLED=0 is the kill switch and
// PRIVATE_DATA_ENABLED=1 is required because every Sports record lives in the
// private store.
export function sportsEnabled(session, env = process.env) {
  return env.PRIVATE_DATA_ENABLED === '1' && env.SPORTS_ENABLED !== '0' &&
    session?.tr === true && session?.tp === true &&
    typeof session.sub === 'string' && session.sub.trim().length > 0;
}

// 404 when the feature is switched off (it does not exist for anyone), 403
// when it is on but this visitor is not a signed Owner.
export function sportsDeniedStatus(env = process.env) {
  return env.PRIVATE_DATA_ENABLED === '1' && env.SPORTS_ENABLED !== '0' ? 403 : 404;
}
