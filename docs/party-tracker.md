# Party tracker

Owner page for one question: how did the market, and each sector, do while Democrats or Republicans held the presidency, the House, or the Senate?

The window starts at George W. Bush’s inauguration on January 20, 2001 and runs through the latest S&P 500 session. The current term stays open.

## What is compared

The market is SPY. Nasdaq-100 (QQQ), Dow 30 (DIA), and Russell 2000 (IWM) are shown the same way. Sectors are the SPDR ETFs: technology, financials, health care, energy, industrials, consumer discretionary, consumer staples, materials, utilities, real estate, and communication services.

The headline number is the annualized return. Total return and years are beside it. A party that held an office longer is not treated as better just for serving more time.

Health care and energy are written out in sentences for the office on screen. The table can be sorted by the Democratic edge, which is the Democratic annualized return minus the Republican one. Clicking the same column again reverses the order.

Choose a president to rebase the S&P 500 line on that term, then choose a House-and-Senate stretch inside it. Move along the line to read the date and who held each office. Drag across the line to compare two dates.

Unified government means one party held the presidency and both chambers. A separate line shows both chambers Democratic, both chambers Republican, and a split Congress.

## Control dates

Ranges are half-open. The close on a handover day belongs to the new president or the new Congress.

- Presidents change on Inauguration Day.
- The House changes on January 3 of each new Congress. No Congress in this window changed which party organized the House.
- The Senate follows the Senate Historical Office party-division dates. A 50–50 Senate counts for the vice president’s party. Independents who caucused with a party count with that party.
- Jim Jeffords’s switch counts from June 6, 2001. A Republican seat majority counts from November 12, 2002, with a note that the Senate did not reorganize before the next Congress.
- Republicans kept the Senate from January 3 to January 20, 2021. Democrats took it the day Jon Ossoff, Raphael Warnock, and Vice President Harris were sworn in.

Sources are linked on the page: the Senate Historical Office party division, the House party-division history, and Yahoo Finance.

## Returns

Figures use Yahoo adjusted closes, so splits and cash dividends are included. Fund expenses are already in the price. Returns are not adjusted for inflation.

Real estate starts in October 2015 and communication services in June 2018. Their S&P comparison uses only the days that ETF existed.

Each line on the chart compounds S&P 500 days for one party and earns nothing on the other party’s days. The annualized figures are the comparison. The line that was invested longer can finish higher even with a lower annual rate.

A missed price download keeps the previous snapshot and says so. It does not fill the gap with zero.

## What this is not

Five presidential terms and thirteen Congresses is a small sample. The 2008, 2020, and 2022 declines move the averages. The page records what prices did. It does not show that a party caused the result.

The payload is `data/party-tracker.json`. It is Owner-only. The bake refreshes it. There is no AI call.
