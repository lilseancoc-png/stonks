export function researchLabEnabled(session, env = process.env) {
  const ids = String(env.RESEARCH_LAB_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return env.PRIVATE_DATA_ENABLED === '1' && env.RESEARCH_LAB_ENABLED === '1' &&
    session?.tr === true && session?.tp === true && typeof session.sub === 'string' && ids.includes(session.sub);
}
