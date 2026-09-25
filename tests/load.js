// Loads the browser scripts into Node's global scope for testing.
const path = require('path');
const files = ['util', 'cards', 'preflop', 'engine', 'strategy', 'roster', 'ai', 'tournament'];
module.exports = function load(upTo) {
  for (const f of files) {
    try { require(path.join(__dirname, '..', 'js', 'core', f + '.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    if (f === upTo) break;
  }
  return globalThis.FS;
};
