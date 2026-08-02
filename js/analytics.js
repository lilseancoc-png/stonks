// Vercel Web Analytics initialization
// See: https://vercel.com/docs/analytics/quickstart
import { inject } from '@vercel/analytics';

// Initialize Vercel Web Analytics
inject({
  mode: 'auto', // auto-detect production vs development
  debug: false  // set to true for development debugging
});
