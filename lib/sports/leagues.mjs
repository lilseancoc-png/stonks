// The ingest adapter for each league (lib/sports/ingest.mjs).
import { NFL_SOURCE } from './nflverse.mjs';
import { NBA_SOURCE } from './hoopr.mjs';

export const LEAGUE_SOURCES = Object.freeze({ nfl: NFL_SOURCE, nba: NBA_SOURCE });
