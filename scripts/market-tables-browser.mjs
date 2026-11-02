// Replays the generated site against deterministic data; no providers or writes.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPartyPreview } from './party-tracker-preview.mjs';
import { earningsWeek1DueDate } from '../lib/earnings-data.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.QA_OUTPUT || '/tmp/stonks-market-tables';
await mkdir(out,{recursive:true});
const now='2026-11-02T20:00:00.000Z';
const rows=Array.from({length:14},(_,i)=>({sym:'QA'+i,name:'Example company with a long name '+i,date:i<7?'2026-10-29':'2026-10-28',session:i%2?'AM':'PM',epsActual:1+i/10,epsEstimate:1,surprisePct:i===0?272:i===12?null:(i-5)*3,eps:i<5?'miss':'beat',guidance:i%3?'up':null,revenueActual:i%2?1e10+i*1e9:null,revenueCurrency:'USD',movePct:i===13?null:(i-7)/40,gapPct:(i-6)/50,week1Pct:null,week1Status:'pending',week1DueDate:earningsWeek1DueDate(i<7?'2026-10-29':'2026-10-28',i%2?'AM':'PM'),pre15Pct:i/50,impliedMovePct:.1,exceededImplied:false}));
rows[2].week1Status='unavailable';
rows[1].revenueSource={sourceUrl:'https://www.sec.gov/Archives/edgar/data/1/000000000126000040/',periodEnd:'2026-09-30',filed:'2026-10-30'};
const fixture={builtAtIso:now,updatedOn:'2026-11-02',universe:14,seasons:[{key:'2026Q4',fiscal:'Q3 2026',window:'Oct–Dec 2026',rows,counts:{reported:14,beat:9,miss:5,inline:0,epsKnown:14,guidKnown:9,guidUp:9,guidDown:0,guidInline:0},stats:{},leaders:{}}],upcoming:[],recentlyReported:rows.map(r=>({...r,daysSince:4}))};
const earnings=process.env.EARNINGS_UI_PAYLOAD?JSON.parse(await readFile(process.env.EARNINGS_UI_PAYLOAD,'utf8')):fixture;
const heat={builtAtIso:now,tickers:['AAPL','MSFT','NVDA','AMD','TSLA','JPM'].map((t,i)=>({t,n:['Apple','Microsoft','Nvidia','Advanced Micro Devices','Tesla','JPMorgan'][i],s:i%2?'Software':'Semis',i:'Test industry',sp:100+i,mc:(6-i)*1e9,ch:[2,0,-3,null,1,-1][i],rv:i===3?null:i/2,perf:{'1w':i===3?null:i,'1m':i-2,'3m':i,ytd:i,'1y':i}}))};
const p=await createPartyPreview();
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
let checks=0;
function check(value,label){assert(value,label);checks++;}
try {
  for(const width of [1440,1024,700,390])for(const theme of width===1440 || width===390?['dark','light']:['dark']){
    const ctx=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date(now)});
    await page.addInitScript(t=>localStorage.setItem('stonks-theme',t),theme);
    await page.route('**/*',r=>new URL(r.request().url()).origin===p.base?r.continue():r.fulfill({body:''}));
    await page.route('**/_vercel/**',r=>r.fulfill({body:'',contentType:'text/javascript'}));
    await page.route(/(?:data\/|data=)earnings-tracker\.json/,r=>r.fulfill({json:earnings}));
    await page.route(/(?:data\/|data=)heatmap\.json/,r=>r.fulfill({json:heat}));
    await page.route('**/api/quotes?*',r=>r.fulfill({json:{quotes:[{symbol:'AAPL',spot:110,changePct:10,marketState:'REGULAR',regularAsOf:now}]}}));
    const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.goto(p.base+'/?tab=heatmap');
    await page.locator('.heatmap-tile').first().waitFor();
    await page.locator('#heatmap-live-toggle').uncheck();
    await page.locator('#heatmap-layout-select').selectOption('list');
    const table=page.locator('.hm-list table');
    await table.waitFor();await settle();
    check(await table.locator('tbody tr').count()===6,'Every stock has a list row');
    check(/Rel\. volume/i.test(await table.locator('thead').innerText()),'List includes other sortable metrics');
    check((await table.locator('tbody tr').filter({has:page.locator('td:first-child a',{hasText:'AAPL'})}).locator('td').nth(10).innerText()).includes('0.0'),'Zero relative volume remains a real reading');
    const symbols=()=>table.locator('tbody td:first-child').allTextContents();
    const header=name=>table.locator('th').filter({hasText:new RegExp('^'+name+'(?: |$)','i')});
    await header('1D').click();await settle();
    check((await symbols()).at(-1)==='AMD','Missing return last ascending');
    const first=await symbols();await header('1D').click();await settle();
    check((await symbols()).at(-1)==='AMD','Missing return last descending');
    check((await symbols())[0]!==first[0],'Return sort reverses');
    await header('Market cap').click();await settle();
    check((await symbols()).length===6,'Market cap sort retains all rows');
    await page.locator('#heatmap-search').fill('MS');await settle();
    assert.deepEqual(await symbols(),['MSFT']);checks++;
    await page.locator('#heatmap-search').fill('');await settle();
    await page.locator('#heatmap-period-select').selectOption('1w');await settle();
    check(await table.locator('tbody tr').count()===6,'Period changes retain list');
    await page.locator('#heatmap-period-select').selectOption('1d');
    await page.locator('#heatmap-live-toggle').check();
    await page.locator('#heatmap-live-state.is-live').waitFor();await settle();
    const apple=table.locator('tbody tr').filter({has:page.locator('td:first-child a',{hasText:'AAPL'})});
    check((await apple.locator('td').nth(3).innerText()).includes('110'),'List uses live price');
    check((await apple.locator('td').nth(4).innerText()).includes('10.0'),'List uses live performance');
    await page.locator('#heatmap-live-toggle').uncheck();await settle();
    check((await apple.locator('td').nth(3).innerText()).includes('100'),'Turning live off restores saved price');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'List scrolls inside phone viewport');
    await page.locator('.hm-list').screenshot({path:resolve(out,'list-'+width+'-'+theme+'.png')});
    await page.reload();await table.waitFor();
    check(await page.locator('#heatmap-layout-select').inputValue()==='list','Layout survives reload');
    await page.goto(p.base+'/?tab=earnings');
    await page.locator('.ers-recent-row').first().waitFor();
    await page.locator('.ers-table-details > summary').click();
    check((await page.locator('.ers-data-coverage').innerText()).includes('missing does not mean no guidance'),'Coverage explains missing fields');
    if(!process.env.EARNINGS_UI_PAYLOAD){
      check((await page.locator('#ers-season-table-body').innerText()).includes('Pending'),'Immature returns identified');
      check((await page.locator('#ers-season-table-body').innerText()).includes('Unavailable'),'Unavailable data identified');
      check(await page.locator('.ers-source').count()===1,'Official revenue links to filing');
    }
    const cardValues=await page.locator('.ers-recent-row').evaluateAll(elements=>elements.map(e=>({sym:e.querySelector('.ers-sym')?.textContent,eps:e.querySelector('.ers-recent-eps')?.textContent,move:e.querySelector('.ers-ldr-val')?.textContent})));
    for(const card of cardValues){
      const source=earnings.seasons.flatMap(s=>s.rows).find(r=>r.sym===card.sym);
      check(!!source,'Recent card has a matching saved report');
      if(source?.movePct!=null)check(card.move.includes((Math.abs(source.movePct)*100).toFixed(1)+'%'),'Ticker and return stay together');
    }
    await settle();
    const overlaps=await page.locator('.ers-recent-row').evaluateAll(elements=>elements.flatMap(row=>{
      const box=row.getBoundingClientRect();
      return [...row.children].flatMap(child=>{
        const r=child.getBoundingClientRect();
        if(r.right>box.right+1 || r.left<box.left-1)return [child.className+' outside card'];
        if(child.classList.contains('ers-ldr-val')){
          const text=child.querySelector('.ers-ldr-day')?.getBoundingClientRect();
          if(text && (text.right>r.right+1 || text.left<r.left-1))return ['Move label overflows'];
        }
        return [];
      });
    }));
    assert.deepEqual(overlaps,[],'Recent cards contain every label at '+width);checks++;
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Earnings page fits viewport');
    await page.locator('.ers-recent').screenshot({path:resolve(out,'recent-'+width+'-'+theme+'.png')});
    const chart=page.locator('#book-earnings');
    await chart.locator('summary').waitFor();
    if(!await chart.locator('details').getAttribute('open').then(v=>v!==null))await chart.locator('summary').click();
    await chart.locator('.book-svg').waitFor();
    check(await chart.locator('.book-axis-y-title').innerText()==='Share-price reaction (%)','Vertical axis labeled');
    check((await chart.locator('.book-axis-x-title').innerText()).includes('EPS surprise (%)'),'Horizontal axis labeled');
    const valid=earnings.seasons[0].rows.filter(r=>r.surprisePct!=null && r.movePct!=null);
    check(await chart.locator('.book-dot').count()===valid.filter(r=>Math.abs(r.surprisePct)<=50).length,'Focus excludes outliers and missing values');
    await chart.locator('[data-book-control="earn-range"]').selectOption('all');await settle();
    check(await chart.locator('.book-dot').count()===valid.length,'All reports includes outliers but never null-as-zero');
    const ticks=await chart.locator('.book-x span').evaluateAll(els=>els.map(e=>({value:Number(e.dataset.axisValue),left:parseFloat(e.style.left)})));
    const min=Number(await chart.locator('.book-svg').getAttribute('data-x-min')),max=Number(await chart.locator('.book-svg').getAttribute('data-x-max'));
    check(ticks.every(t=>Math.abs(t.left-(t.value-min)/(max-min)*100)<.01),'Axis ticks align with actual coordinates: '+JSON.stringify(ticks));
    const titlesFit=await chart.locator('.book-axis-y-title,.book-axis-x-title').evaluateAll(els=>els.every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&e.scrollHeight<=e.clientHeight+1;}));
    check(titlesFit,'Axis names fit at '+width);
    await chart.locator('[data-book-control="earn-range"]').selectOption('focus');await settle();
    await chart.screenshot({path:resolve(out,'scatter-'+width+'-'+theme+'.png')});
    assert.deepEqual(errors,[]);await ctx.close();
  }
  console.log('Market tables browser passed '+checks+' checks: sorting, missing values, live/saved parity, persistence, report identity, card bounds, axis coordinates, outlier controls, desktop/mobile and light/dark. Screenshots: '+out);
}finally{await browser.close();await new Promise(r=>p.server.close(r));}
