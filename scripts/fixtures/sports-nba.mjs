// Small hoopR-shaped CSV fixtures for the Sports NBA tests. hoopR files are
// named by the season's END year: 2026 = the 2025-26 season (Sports 2025),
// 2027 = 2026-27 (Sports 2026, around Monday 2026-11-02). Includes an
// All-Star exhibition, a postponed game, did-not-play rows and placeholder
// rows the adapter must skip, plus a multi-line JSON field.
const SCHEDULE_HEAD = 'id,game_id,date,start_date,time_valid,neutral_site,season_type,status_type_name,home_abbreviation,away_abbreviation,home_score,away_score,venue_full_name,game_date,game_json';
const sched = (id, iso, type, status, home, away, hs, as, day, venue = 'Arena') =>
  [id, id, iso, iso, 'true', 'false', type, status, home, away, hs, as, '"' + venue + '"', day, '"{""note"":\n""multi-line""}"'].join(',');

export const SCHEDULE_2026 = [SCHEDULE_HEAD, // Sports season 2025 (2025-26)
  sched('401800001', '2026-04-10T02:00Z', 2, 'STATUS_FINAL', 'GS', 'LAL', 118, 110, '2026-04-09', 'Chase Center'),
  sched('401800002', '2026-04-15T23:30Z', 5, 'STATUS_FINAL', 'GS', 'PHX', 121, 104, '2026-04-15'),
  sched('401800003', '2026-04-20T02:30Z', 3, 'STATUS_FINAL', 'OKC', 'GS', 112, 99, '2026-04-19'),
  sched('401800004', '2026-01-08T01:00Z', 2, 'STATUS_POSTPONED', 'CHI', 'MIA', 0, 0, '2026-01-07'),
  sched('401800005', '2026-02-16T01:00Z', 2, 'STATUS_FINAL', 'WORLD', 'STARS', 40, 38, '2026-02-15', 'All-Star'),
].join('\n');

export const SCHEDULE_2027 = [SCHEDULE_HEAD, // Sports season 2026 (2026-27)
  sched('401900001', '2026-10-31T02:00Z', 2, 'STATUS_FINAL', 'GS', 'POR', 115, 101, '2026-10-30', 'Chase Center'),
  sched('401900002', '2026-11-01T22:00Z', 2, 'STATUS_FINAL', 'LAL', 'GS', 108, 112, '2026-11-01', 'crypto.com Arena'),
  sched('401900003', '2026-11-03T03:00Z', 2, 'STATUS_SCHEDULED', 'GS', 'PHX', 0, 0, '2026-11-02', 'Chase Center'),
  sched('401900004', '2026-11-04T02:00Z', 2, 'STATUS_SCHEDULED', 'PHX', 'LAL', 0, 0, '2026-11-03'),
  sched('401900005', '2026-11-06T00:00Z', 2, 'STATUS_SCHEDULED', 'BOS', 'NY', 0, 0, '2026-11-05'),
].join('\n');

const BOX_HEAD = 'game_id,season,season_type,game_date,athlete_id,athlete_display_name,team_abbreviation,opponent_team_abbreviation,home_away,minutes,points,rebounds,offensive_rebounds,assists,steals,blocks,turnovers,field_goals_made,field_goals_attempted,three_point_field_goals_made,three_point_field_goals_attempted,free_throws_made,free_throws_attempted,starter,did_not_play,reason,athlete_position_abbreviation';
const box = (gid, aid, name, team, opp, ha, s, pos = 'G') =>
  [gid, '', 2, '', aid, '"' + name + '"', team, opp, ha, s.min ?? '', s.pts ?? '', s.reb ?? '', s.oreb ?? '', s.ast ?? '', s.stl ?? '', s.blk ?? '', s.to ?? '', s.fgm ?? '', s.fga ?? '', s.tpm ?? '', s.tpa ?? '', s.ftm ?? '', s.fta ?? '', s.starter ?? 'true', s.dnp ?? 'false', s.reason ?? '', pos].join(',');

export const BOX_2026 = [BOX_HEAD,
  box('401800001', '3975', 'Stephen Curry', 'GS', 'LAL', 'home', { min: 34, pts: 31, reb: 5, ast: 7, tpm: 6, tpa: 13 }),
  box('401800001', '1966', 'LeBron James', 'LAL', 'GS', 'away', { min: 36, pts: 25, reb: 9, ast: 8, tpm: 2, tpa: 5 }, 'F'),
  box('401800002', '3975', 'Stephen Curry', 'GS', 'PHX', 'home', { min: 30, pts: 22, reb: 4, ast: 6, tpm: 4, tpa: 10 }),
  box('401800003', '3975', 'Stephen Curry', 'GS', 'OKC', 'away', { min: 38, pts: 28, reb: 6, ast: 5, tpm: 5, tpa: 12 }),
  box('401800005', '9999', 'Exhibition Player', 'WORLD', 'STARS', 'home', { min: 20, pts: 30 }),
].join('\n');

export const BOX_2027 = [BOX_HEAD,
  box('401900001', '3975', 'Stephen Curry', 'GS', 'POR', 'home', { min: 33, pts: 27, reb: 6, ast: 5, tpm: 5, tpa: 11 }),
  box('401900001', '4433', 'Brandin Podziemski', 'GS', 'POR', 'home', { min: 28, pts: 14, reb: 7, ast: 4, tpm: 2, tpa: 5 }),
  box('401900001', '4066', 'Bench Guard', 'GS', 'POR', 'home', { min: '', pts: 0, reb: 0, ast: 0, starter: 'false' }), // no minutes, no points → did not play
  box('401900001', '', 'TEAM', 'GS', 'POR', 'home', { min: 240, pts: 115 }),
  box('401900002', '3975', 'Stephen Curry', 'GS', 'LAL', 'away', { dnp: 'true', reason: 'LEFT ANKLE SPRAIN' }),
  box('401900002', '4433', 'Brandin Podziemski', 'GS', 'LAL', 'away', { min: 35, pts: 21, reb: 9, ast: 6, tpm: 3, tpa: 7 }),
  box('401900002', '4067', 'Garbage Time', 'GS', 'LAL', 'away', { min: '', pts: 2, reb: 1, ast: 0, starter: 'false' }), // points but no minutes → played
  box('401900002', '1966', 'LeBron James', 'LAL', 'GS', 'home', { min: 37, pts: 30, reb: 8, ast: 11, tpm: 3, tpa: 6 }, 'F'),
].join('\n');
