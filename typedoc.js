module.exports = {
  out: './docs/',
  readme: 'README.md',
  name: 'Sentry JavaScript SDKs',
  includes: './',
  exclude: [
    '**/test/**/*',
    '**/*.js',
    '**/dist/**/*',
    '**/esm/**/*',
    '**/build/**/*',
    '**/packages/typescript/**/*',
    // TODO: Don't exclude React
    '**/packages/react/**/*',
  ],
  mode: 'modules',
  excludeExternals: true,
  excludeNotExported: true,
  excludePrivate: true,
  'external-modulemap': '.*/packages/([^/]+)/.*',
};
