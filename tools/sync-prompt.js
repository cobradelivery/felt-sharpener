// Copies server/coach_prompt.md into js/game/coach-prompt.js so the browser can use the same
// prompt when calling an endpoint directly (without the harness). Run after editing the prompt.
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, '..', 'server', 'coach_prompt.md'), 'utf8');
const js = `/* GENERATED from server/coach_prompt.md by tools/sync-prompt.js — edit the .md, then re-run. */
(function (root) { root.FS.COACH_PROMPT = ${JSON.stringify(md)}; })(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'game', 'coach-prompt.js'), js);
console.log('coach-prompt.js updated');
