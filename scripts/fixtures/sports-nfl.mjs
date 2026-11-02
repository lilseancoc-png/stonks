// Small nflverse-shaped CSV fixtures for the Sports NFL tests: a finished
// 2025 season (opener + Super Bowl) and part of 2026 around Monday
// 2026-11-02, including the sportsbook columns the adapter must drop.
export const GAMES_HEAD = 'game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location,result,total,overtime,old_game_id,gsis,nfl_detail_id,pfr,pff,espn,ftn,away_rest,home_rest,away_moneyline,home_moneyline,spread_line,away_spread_odds,home_spread_odds,total_line,under_odds,over_odds,div_game,roof,surface,temp,wind,away_qb_id,home_qb_id,away_qb_name,home_qb_name,away_coach,home_coach,referee,stadium_id,stadium';
export const gameLine = (id, season, type, week, day, time, away, as, home, hs, stadium = 'Field') =>
  [id, season, type, week, day, 'Sunday', time, away, as, home, hs, 'Home', '', '', '0', '', '', '', 'pfr' + week, '', '4018' + week, '', 7, 7, -150, 130, 3.5, -110, -110, 44.5, -110, -110, 0, 'outdoors', 'grass', '', '', '', '', '', '', '', '', '', 'X', '"' + stadium + '"'].join(',');
export const GAMES = [GAMES_HEAD,
  gameLine('2025_22_KC_PHI', 2025, 'SB', 22, '2026-02-08', '18:30', 'KC', 20, 'PHI', 27, 'Caesars, Superdome'),
  gameLine('2025_01_KC_PHI', 2025, 'REG', 1, '2025-09-07', '16:25', 'KC', 17, 'PHI', 24),
  gameLine('2026_07_CHI_SEA', 2026, 'REG', 7, '2026-10-25', '16:05', 'CHI', 10, 'SEA', 13),
  gameLine('2026_08_KC_DEN', 2026, 'REG', 8, '2026-11-01', '16:25', 'KC', 28, 'DEN', 24),
  gameLine('2026_08_CHI_SEA', 2026, 'REG', 8, '2026-11-02', '20:15', 'CHI', '', 'SEA', ''),
  gameLine('2026_09_DEN_KC', 2026, 'REG', 9, '2026-11-05', '20:15', 'DEN', '', 'KC', ''),
  gameLine('2026_10_SEA_LA', 2026, 'REG', 10, '2026-11-08', '', 'SEA', '', 'LA', ''),
].join('\n');

export const WEEK_HEAD = 'player_id,player_name,player_display_name,position,position_group,headshot_url,season,week,season_type,game_id,team,opponent_team,completions,attempts,passing_yards,passing_tds,passing_interceptions,carries,rushing_yards,rushing_tds,receptions,targets,receiving_yards,receiving_tds';
export const wk = (pid, pos, group, season, week, gid, team, opp, s) =>
  [pid, 'x', 'x', pos, group, '"https://img, x"', season, week, 'REG', gid, team, opp, s.cmp ?? 0, s.att ?? 0, s.py ?? 0, s.ptd ?? 0, s.int ?? 0, s.car ?? 0, s.ry ?? 0, s.rtd ?? 0, s.rec ?? 0, s.tgt ?? 0, s.recy ?? 0, s.rectd ?? 0].join(',');
export const WEEK_2026 = [WEEK_HEAD,
  wk('00-0001', 'QB', 'QB', 2026, 7, '2026_07_CHI_SEA', 'SEA', 'CHI', { cmp: 20, att: 30, py: 250, ptd: 2 }),
  wk('00-0001', 'QB', 'QB', 2026, 8, '', 'SEA', 'CHI', { cmp: 1, att: 1, py: 9 }), // game_id missing → but week 8 game is not final yet; still recovered
  wk('00-0002', 'WR', 'WR', 2026, 7, '2026_07_CHI_SEA', 'SEA', 'CHI', { rec: 6, tgt: 9, recy: 88, rectd: 1 }),
  wk('00-0003', 'TE', 'TE', 2026, 8, '2026_08_KC_DEN', 'KC', 'DEN', { rec: 7, tgt: 8, recy: 70 }),
  wk('00-0004', 'K', 'SPEC', 2026, 8, '2026_08_KC_DEN', 'KC', 'DEN', {}),
  wk('00-0005', 'WR', 'WR', 2026, 8, '2026_08_KC_DEN', 'DEN', 'KC', { rec: 9, tgt: 4 }), // more catches than targets: rejected
  wk('00-0006', 'QB', 'QB', 2026, 8, '2026_08_KC_DEN', 'KC', 'DEN', { cmp: 25, att: 35, py: 301, ptd: 3 }),
].join('\n');
export const WEEK_2025 = [WEEK_HEAD,
  wk('00-0006', 'QB', 'QB', 2025, 1, '2025_01_KC_PHI', 'KC', 'PHI', { cmp: 22, att: 33, py: 240 }),
  wk('00-0006', 'QB', 'QB', 2025, 22, '2025_22_KC_PHI', 'KC', 'PHI', { cmp: 19, att: 31, py: 199 }),
].join('\n');
export const PLAYERS = ['gsis_id,display_name,first_name,last_name,position_group,position,latest_team,status,last_season,espn_id,pfr_id,nfl_id',
  '00-0001,Geno Smíth,Geno,Smith,QB,QB,SEA,ACT,2026,1,a,1',
  '00-0002,Jaxon Smith-Njigba,Jaxon,Smith-Njigba,WR,WR,SEA,ACT,2026,2,b,2',
  '00-0003,Travis Kelce,Travis,Kelce,TE,TE,KC,ACT,2026,3,c,3',
  '00-0006,Patrick Mahomes,Patrick,Mahomes,QB,QB,KC,ACT,2026,6,d,6',
  '00-0007,Rookie Receiver,Rookie,Receiver,WR,WR,KC,ACT,2026,7,e,7',
  '00-0008,Old Lineman,Old,Lineman,OL,T,KC,RET,2019,8,f,8',
].join('\n');
