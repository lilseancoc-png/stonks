// Shared interpretation of producer envelopes at saved-data read boundaries.
// Return only a boolean; raw error text must not reach diagnostic reports.
export function producerReportsFailure(payload) {
  const present = value => Array.isArray(value) ? value.length > 0
    : typeof value === 'number' ? value > 0 : Boolean(value);
  const errors = payload?.errors;
  return present(payload?.error)
    || (Array.isArray(errors) ? errors.length > 0 : errors && typeof errors === 'object' ? Object.values(errors).some(present) : present(errors))
    || payload?.coverage?.complete === false
    || ['error','failed','down','degraded','unavailable','insufficient-data'].includes(payload?.status);
}
