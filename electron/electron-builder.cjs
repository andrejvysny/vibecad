const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const versionToken = process.env['RELEASE_NAME'] ?? '${version}'

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: 'com.vibecad.electron',
  productName: 'VibeCAD',
  copyright: '© VibeCAD',

  electronVersion: require(path.resolve(__dirname, '..', 'node_modules/electron/package.json'))
    .version,

  directories: {
    buildResources: '.',
    output: 'out',
  },

  // Native better-sqlite3 is rebuilt into electron/node_modules for Electron's
  // Node ABI. Keep host's hoisted root build separate.
  files: [
    'dist/**/*',
    'package.json',
    {
      from: 'node_modules/better-sqlite3',
      to: 'node_modules/better-sqlite3',
      filter: ['**/*'],
    },
    {
      from: '../node_modules/bindings',
      to: 'node_modules/bindings',
      filter: ['**/*'],
    },
    {
      from: '../node_modules/file-uri-to-path',
      to: 'node_modules/file-uri-to-path',
      filter: ['**/*'],
    },
  ],

  asar: true,
  asarUnpack: ['**/*.node'],

  extraResources: [
    {
      from: path.relative(__dirname, path.join(repoRoot, 'renderer', 'dist')),
      to: 'renderer',
    },
    {
      from: path.relative(__dirname, path.join(repoRoot, 'skills')),
      to: 'skills',
    },
    {
      from: path.relative(
        __dirname,
        path.join(repoRoot, 'electron', 'src', 'main', 'db', 'migrations'),
      ),
      to: 'migrations',
    },
  ],

  // -------- macOS --------
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    identity: null,
    gatekeeperAssess: false,
    hardenedRuntime: false,
    artifactName: `\${productName}-${versionToken}-\${arch}.\${ext}`,
  },
  dmg: {
    format: 'ULFO',
    writeUpdateInfo: false,
  },

  // -------- Windows --------
  win: {
    target: ['nsis', 'portable'],
    artifactName: `\${productName}-${versionToken}-\${arch}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'VibeCAD',
    artifactName: `\${productName}-Setup-${versionToken}.\${ext}`,
  },
  portable: {
    artifactName: `\${productName}-Portable-${versionToken}.\${ext}`,
  },

  // -------- Linux --------
  linux: {
    executableName: 'vibecad',
    category: 'Development',
    synopsis: 'AI-native parametric CAD',
    description: 'VibeCAD desktop application',
    target: ['AppImage', 'deb', 'rpm'],
    artifactName: `vibecad_${versionToken}_\${arch}.\${ext}`,
  },
}
