export function researchLabEnabled(session, env = process.env) {
  return env.PRIVATE_DATA_ENABLED === '1' && env.RESEARCH_LAB_ENABLED !== '0' &&
    session?.tr === true && session?.tp === true && typeof session.sub === 'string' && session.sub.trim().length > 0;
}
