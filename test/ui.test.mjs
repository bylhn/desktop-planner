// The real app UI, driven through the web demo (docs/demo) in headless Chrome.
// Needs Chrome (or set CHROME_PATH); skipped when none is found. Rebuild the demo first: npm run demo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromePath, openDemo, pickDay, row, sleep } from './helpers/chrome.mjs';

const opts = { skip: !chromePath && 'Chrome not found (set CHROME_PATH)', timeout: 90000 };

test('month panel: edit an event (prefill, re-render, move day, Esc)', opts, async () => {
  const p = await openDemo();
  try {
    await p.ev(`setView('month'); true`); await sleep(200);
    await p.ev(pickDay('today')); await sleep(300);
    assert.ok(await p.ev(`document.querySelectorAll('#mpList .ev .ed').length`) >= 2);
    await p.ev(`${row('팀 미팅')}.querySelector('.en').click(); true`); await sleep(100);
    assert.equal(await p.ev(`document.querySelector('.ev-edit .ed-text').value`), '16:00-17:00 팀 미팅');
    assert.ok(await p.ev(`document.activeElement.classList.contains('ed-text')`), 'text box focused');
    // a sync re-renders the panel mid-edit: typed text and focus survive
    await p.ev(`(()=>{const t=document.querySelector('.ev-edit .ed-text'); t.value='16:30-17:30 팀 미팅 (변경)'; t.dispatchEvent(new Event('input')); render(); return true})()`);
    assert.equal(await p.ev(`document.querySelector('.ev-edit .ed-text').value`), '16:30-17:30 팀 미팅 (변경)');
    assert.ok(await p.ev(`document.activeElement.classList.contains('ed-text')`));
    await p.ev(`(()=>{const d=document.querySelector('.ev-edit .ed-date'); d.value=addDays(today,1); d.dispatchEvent(new Event('input')); document.querySelector('.ev-edit .ed-text').focus(); return true})()`);
    await p.key('Enter'); await sleep(700);
    assert.ok(await p.ev(`!document.querySelector('.ev-edit')`), 'form closed after Enter');
    assert.equal(await p.ev(`document.getElementById('mpMsg').textContent`), '수정했어요. 폰에도 곧 반영돼요.');
    assert.equal(await p.ev(`JSON.stringify(eventsOn(addDays(today,1)).filter(e=>e.title.includes('변경')).map(e=>[e.time,e.endTime]))`), '[["16:30","17:30"]]');
    assert.ok(await p.ev(`!eventsOn(today).some(e=>e.title.includes('팀 미팅'))`));
    // Esc cancels, the panel stays open
    await p.ev(`document.querySelector('#mpList .ev .ed').click(); true`); await sleep(100);
    await p.key('Escape'); await sleep(100);
    assert.ok(await p.ev(`!document.querySelector('.ev-edit') && !document.getElementById('mPanel').hidden`));
  } finally { p.close(); }
});

test('month panel: a multi-day all-day event keeps its length; the bell follows an edit', opts, async () => {
  const p = await openDemo();
  try {
    await p.ev(`setView('month'); true`); await sleep(200);
    const trip = await p.ev(`(()=>{for(let i=0;i<10;i++){const k=addDays(today,i); if(eventsOn(k).some(e=>e.id==='trip')) return k;} return ''})()`);
    await p.ev(pickDay(JSON.stringify(trip))); await sleep(300);
    await p.ev(`${row('학회')}.querySelector('.ed').click(); true`); await sleep(100);
    assert.equal(await p.ev(`document.querySelector('.ev-edit .ed-text').value`), '학회 출장');
    await p.ev(`(()=>{const d=document.querySelector('.ev-edit .ed-date'); d.value=addDays(${JSON.stringify(trip)},7); d.dispatchEvent(new Event('input')); document.querySelector('.ev-edit .save').click(); return true})()`);
    await sleep(700);
    assert.equal(await p.ev(`JSON.stringify([0,1,6,7,8,9].map(i=>eventsOn(addDays(${JSON.stringify(trip)},i)).some(e=>e.title==='학회 출장')))`), '[false,false,false,true,true,false]');
    // bell on a future timed event, then change its time
    await p.ev(pickDay('addDays(today,2)')); await sleep(300);
    const key = await p.ev(`(()=>{const e=eventsOn(addDays(today,2)).find(e=>e.title.includes('중간')); if(!evRemOn(e)) toggleEvRem(e,true); persist(); renderMonthPanel(); return e.id})()`);
    await p.ev(`${row('중간')}.querySelector('.ed').click(); true`); await sleep(100);
    await p.ev(`(()=>{const t=document.querySelector('.ev-edit .ed-text'); t.value='18:00 중간 발표'; t.dispatchEvent(new Event('input')); document.querySelector('.ev-edit .save').click(); return true})()`);
    await sleep(700);
    assert.equal(await p.ev(`JSON.stringify(eventsOn(addDays(today,2)).filter(e=>e.title==='중간 발표').map(e=>[e.time,e.endTime,evRemOn(e)]))`), '[["18:00","19:00",true]]');
    assert.equal(await p.ev(`(settings.evReminders||[]).filter(k=>k.includes(${JSON.stringify(key)})).length`), 1);
  } finally { p.close(); }
});

test('delete with undo (6 s), and a second delete flushes the first', opts, async () => {
  const p = await openDemo();
  try {
    await p.ev(`window.__del=0; const _d=window.planner.googleDeleteEvent; window.planner.googleDeleteEvent=(...a)=>{__del++; return _d(...a)}; setView('month'); true`); await sleep(200);
    await p.ev(pickDay('today')); await sleep(300);
    await p.ev(`${row('자료구조')}.querySelector('.x').click(); true`); await sleep(200);
    assert.ok(await p.ev(`!${row('자료구조')} && !eventsOn(today).some(e=>e.title.includes('자료구조'))`), 'hidden at once');
    assert.ok(await p.ev(`document.getElementById('mpMsg').textContent.includes('되돌리기')`));
    await sleep(1500);
    await p.ev(`document.getElementById('mpUndo').click(); true`); await sleep(200);
    assert.ok(await p.ev(`!!${row('자료구조')} && __del === 0`), 'undo brings it back, nothing sent');
    assert.equal(await p.ev(`document.getElementById('mpMsg').textContent`), '되돌렸어요.');
    await sleep(5000);
    assert.equal(await p.ev(`__del`), 0, 'still nothing sent after the window');
    await p.ev(`${row('자료구조')}.querySelector('.x').click(); true`); await sleep(6800);
    assert.equal(await p.ev(`__del`), 1, 'sent after 6 s');
    assert.equal(await p.ev(`document.getElementById('mpMsg').textContent`), '삭제했어요.');
    await p.ev(`${row('팀 미팅')}.querySelector('.x').click(); true`); await sleep(100);
    await p.ev(`setCalendar({...lastCal, events:[...lastCal.events,{id:'n2',cal:'g:demo',date:today,time:'22:00',endTime:'23:00',title:'야간 작업',allDay:false}]}); renderMonthPanel(); true`);
    await p.ev(`${row('야간 작업')}.querySelector('.x').click(); true`); await sleep(500);
    assert.equal(await p.ev(`__del`), 2);
  } finally { p.close(); }
});

test('invited events, overnight and multi-day timed events, deleted-elsewhere message', opts, async () => {
  const p = await openDemo();
  try {
    await p.ev(`setCalendar({...lastCal, events:[...lastCal.events, {id:'ws',cal:'g:demo',date:addDays(today,3),time:'09:00',endTime:'',dur:57*60,title:'워크숍',allDay:false}]}); setView('month'); true`);
    await sleep(200);
    // samples: tomorrow has an invited event and 23:00–01:30
    await p.ev(pickDay('addDays(today,1)')); await sleep(300);
    assert.ok(await p.ev(`!${row('면담')}.querySelector('.ed') && !!${row('면담')}.querySelector('.x')`), 'invited: no ✎, ✕ stays');
    assert.equal(await p.ev(`${row('면담')}.querySelector('.en').title`), '초대받은 일정 — 만든 사람만 고칠 수 있어요');
    assert.equal(await p.ev(`${row('서버 점검')}.querySelector('.et').textContent`), '23:00–01:30');
    await p.ev(`${row('서버 점검')}.querySelector('.ed').click(); true`); await sleep(100);
    assert.equal(await p.ev(`document.querySelector('.ev-edit .ed-text').value`), '23:00-01:30 야간 서버 점검');
    await p.ev(`document.querySelector('.ev-edit .cancel').click(); true`);
    // carried over onto the following days
    assert.equal(await p.ev(`JSON.stringify(eventsOn(addDays(today,2)).filter(e=>e.title.includes('서버 점검')).map(e=>evTime(e)+'|'+evLabel(e)))`), '["00:00–01:30|~01:30 "]');
    assert.equal(await p.ev(`JSON.stringify([3,4,5,6].map(i=>eventsOn(addDays(today,i)).filter(e=>e.title==='워크숍').map(e=>evTime(e))))`), '[["09:00"],["종일"],["00:00–18:00"],[]]');
    assert.ok((await p.ev(`[...document.querySelectorAll('#grid .cell')].find(c=>c.dataset.k===addDays(today,5)).textContent`)).includes('~18:00 워크숍'));
    // editing from a carried-over day opens the real event; no bell there
    await p.ev(pickDay('addDays(today,4)')); await sleep(300);
    assert.ok(await p.ev(`!${row('워크숍')}.querySelector('.bell')`));
    await p.ev(`${row('워크숍')}.querySelector('.ed').click(); true`); await sleep(100);
    assert.ok(await p.ev(`document.querySelector('.ev-edit .ed-date').value === addDays(today,3) && document.querySelector('.ev-edit .ed-text').value === '09:00 워크숍'`));
    // a long event keeps its length when re-timed without an end
    await p.ev(`window.__upd=null; window.planner.googleUpdateEvent=(c,i,e)=>{__upd=e; return Promise.resolve({ok:true,payload:lastCal,updated:[]})}; true`);
    await p.ev(`(()=>{const t=document.querySelector('.ev-edit .ed-text'); t.value='10:00 워크숍'; t.dispatchEvent(new Event('input')); document.querySelector('.ev-edit .save').click(); return true})()`); await sleep(300);
    assert.equal(await p.ev(`__upd && __upd.dur`), 57 * 60);
    // deleted on the phone meanwhile
    await p.ev(`window.planner.googleUpdateEvent=()=>Promise.resolve({ok:false,error:'gone',payload:lastCal}); ${row('워크숍')}.querySelector('.ed').click(); true`); await sleep(100);
    await p.ev(`document.querySelector('.ev-edit .save').click(); true`); await sleep(300);
    assert.equal(await p.ev(`document.getElementById('mpMsg').textContent`), '이미 폰이나 다른 곳에서 지워진 일정이에요. 목록을 새로 받아왔어요.');
    assert.equal(await p.ev(`evErr('not-organizer')`), '다른 사람이 만든 일정이라 여기서는 고칠 수 없어요. 만든 사람만 바꿀 수 있어요.');
    // deleting from a later day hides every day
    await p.ev(`${row('워크숍')}.querySelector('.x').click(); true`); await sleep(200);
    assert.ok(await p.ev(`[3,4,5].every(i=>!eventsOn(addDays(today,i)).some(e=>e.title==='워크숍'))`));
  } finally { p.close(); }
});

test('demo: bell shows a look-alike notification; old saved demo data is ignored', opts, async () => {
  const p = await openDemo();
  try {
    await p.ev(`localStorage.setItem('dp-demo-v1','{"settings":{},"todos":{},"events":[]}'); location.reload(); true`); await sleep(2500);
    assert.ok(await p.ev(`eventsOn(addDays(today,1)).length`) >= 2);
    await p.ev(`setView('month'); true`); await sleep(200);
    await p.ev(pickDay('addDays(today,1)')); await sleep(300);
    await p.ev(`${row('서버 점검')}.querySelector('.bell').click(); true`); await sleep(200);
    assert.ok(await p.ev(`!!document.getElementById('demoToast') && document.getElementById('demoToast').textContent.includes('서버 점검') && document.getElementById('demoToast').style.opacity==='1'`));
    assert.ok(await p.ev(`eventsOn(addDays(today,2)).filter(e=>e.title.includes('중간')).every(evRemOn)`), 'sample reminder is on');
  } finally { p.close(); }
});
