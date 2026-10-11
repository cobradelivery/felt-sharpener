// Loads the browser core scripts into Node's global scope for testing.
const path = require('path');
const files = ['util', 'terrain', 'weapons', 'game', 'ai'];
module.exports = function load() {
  for (const f of files) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
  return globalThis.SE;
};
