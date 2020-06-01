'use strict';

module.exports = {
  diff: true,
  extension: ['ts'],
  package: './package.json',
  reporter: 'spec',
  require: 'ts-node/register',
  slow: 75,
  timeout: 2000,
  ui: 'bdd',
  'watch-files': ['test/**/*.ts'],
}
