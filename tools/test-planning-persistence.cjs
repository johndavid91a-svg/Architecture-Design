/**
 * Do the planning limits survive, and do they drive the report?
 *
 * The regulatory feature was inert for a reason that had nothing to do with the
 * checker: the limits lived in the Regulation screen's own state, so anything
 * entered was lost on the next tab change. Nobody types a bye-law schedule
 * twice. This drives the real application through entering them, saving them,
 * leaving, and coming back.
 *
 *   npx electron tools/test-planning-persistence.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('path'); const fs = require('fs');
require(path.join(__dirname, '..', 'packages', 'desktop', 'out', 'main', 'index.js'));
app.disableHardwareAcceleration();
const out = path.join(require('os').tmpdir(), 'adp-planning-check');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

app.whenReady().then(async () => {
  await sleep(2000);
  const w = BrowserWindow.getAllWindows()[0]; w.setSize(1500, 950); await sleep(1200);
  const js = (c) => w.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG());
  const step = async (l, r) => { const ok = r === 'ok'; if (!ok) problems.push(`${l} -> ${r}`); console.log(`  ${ok?'PASS':'FAIL'}  ${l}${ok?'':` (${r})`}`); };
  const click = (sel, text) => js(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)return 'NOT FOUND: ${text}';b.click();return 'ok';})()`);
  const fill = (id, value) => js(`(()=>{const el=document.querySelector('#${id}');if(!el)return 'no #${id}';
    const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);

  console.log('PLANNING LIMITS PERSIST');
  await click('button.primary', 'Create this building'); await sleep(2200);
  await step('opening Regulation', await click('button.tab', 'Regulation')); await sleep(900);
  await shot('01-empty');

  await step('every check starts not-checkable',
    await js(`document.body.innerText.includes('Cannot be checked') || document.body.innerText.match(/not[- ]checkable/i) ? 'ok' : 'no not-checkable notice'`));

  await step('entering a FAR limit', await fill('rv-far', '1.0'));
  await step('entering a coverage limit', await fill('rv-cov', '30'));
  await sleep(300);

  await step('saving is refused without a source',
    await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Save \\d+ limit/.test(x.textContent.trim()));
      return b && b.disabled ? 'ok' : 'save was allowed with no source';})()`));

  await step('naming the bye-law', await fill('rv-src', 'CDA Building Regulations 2020, Schedule II'));
  await sleep(300);
  await step('saving is now allowed',
    await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Save \\d+ limit/.test(x.textContent.trim()));
      return b && !b.disabled ? 'ok' : 'save still refused';})()`));

  await step('saving', await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Save \\d+ limit/.test(x.textContent.trim()));
    if(!b) return 'no save button'; b.click(); return 'ok';})()`));
  await sleep(800);
  await shot('02-saved');

  // The wording matters: the checker never says "exceeds" or "fails", only
  // "potential regulation issue ... needs architect / engineer verification".
  await step('the report now raises an issue against the saved limits',
    await js(`(()=>{const t=document.body.innerText;
      if(!/Potential regulation issue/i.test(t)) return 'no potential-issue raised';
      if(!/1\.20 against a limit of 1\.00/.test(t)) return 'FAR not measured against the saved limit';
      if(/\bpass(es|ed)?\b/i.test(t.replace(/passes through/gi,''))) return 'the report claimed a pass';
      return 'ok';})()`));

  // The whole point: leave and come back.
  await step('leaving for another tab', await click('button.tab', '2D Plan')); await sleep(900);
  await step('coming back', await click('button.tab', 'Regulation')); await sleep(900);
  await shot('03-returned');

  await step('the limits are still there',
    await js(`(()=>{const far=document.querySelector('#rv-far'), src=document.querySelector('#rv-src');
      if(!far||!src) return 'fields missing';
      if(Number(far.value)!==1) return 'FAR came back as '+JSON.stringify(far.value);
      if(!src.value.includes('Schedule II')) return 'source came back as '+JSON.stringify(src.value);
      return 'ok';})()`));

  await step('and the report still uses them',
    await js(`document.body.innerText.includes('Recorded') ? 'ok' : 'no record of when they were entered'`));

  console.log(problems.length===0 ? '\nCLEAN' : `\n${problems.length} PROBLEM(S):\n`+problems.join('\n'));
  app.exit(problems.length === 0 ? 0 : 1);
});
