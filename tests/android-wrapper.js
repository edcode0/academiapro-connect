'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
const landing = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

assert.equal(manifest.name, 'AcademiaPro');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.id, '/');
assert.ok(manifest.icons.some(icon => icon.src === '/favicon-192.png' && icon.sizes === '192x192'));
assert.ok(landing.includes('rel="manifest"'));
assert.ok(landing.includes('/manifest.webmanifest'));
assert.match(serverSource, /app\.get\('\/\.well-known\/assetlinks\.json'/);
assert.match(serverSource, /public\/assetlinks\.json/);

const twaPath = path.join(root, 'android/twa-manifest.json');
assert.ok(fs.existsSync(twaPath));
const twa = JSON.parse(fs.readFileSync(twaPath, 'utf8'));
assert.equal(twa.packageId, 'academy.academiapro.app');
assert.equal(twa.host, 'academiapro.academy');
assert.equal(twa.startUrl, '/');
assert.equal(twa.iconUrl, 'https://academiapro.academy/icon-512.png');
assert.equal(twa.webManifestUrl, 'https://academiapro.academy/manifest.webmanifest');
assert.ok(twa.fingerprints.includes(
  'EC:6F:FB:30:3B:51:FF:C0:15:F8:BF:49:C0:97:D9:26:36:A7:95:29:F3:51:F8:8F:1C:D7:38:1D:A4:CA:3B:28'
));

const assetLinksPath = path.join(root, 'public/assetlinks.json');
assert.ok(fs.existsSync(assetLinksPath));
const assetLinks = JSON.parse(fs.readFileSync(assetLinksPath, 'utf8'));
assert.ok(assetLinks.some(entry =>
  entry.target?.namespace === 'android_app' &&
  entry.target.package_name === 'academy.academiapro.app' &&
  entry.target.sha256_cert_fingerprints?.includes(
    'EC:6F:FB:30:3B:51:FF:C0:15:F8:BF:49:C0:97:D9:26:36:A7:95:29:F3:51:F8:8F:1C:D7:38:1D:A4:CA:3B:28'
  )
));

const buildGradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const androidManifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
assert.match(buildGradle, /applicationId ['"]academy\.academiapro\.app['"]/);
assert.match(buildGradle, /targetSdkVersion 36/);
assert.match(buildGradle, /fallbackType: ['"]customtabs['"]/);
assert.match(buildGradle, /signingConfigs\s*\{/);
assert.match(buildGradle, /ACADEMIAPRO_UPLOAD_KEYSTORE/);
assert.match(buildGradle, /signingConfig signingConfigs\.release/);
assert.doesNotMatch(buildGradle, /android\.webkit\.WebView/);
assert.doesNotMatch(androidManifest, /WebViewFallbackActivity/);

const androidFiles = fs.readdirSync(path.join(root, 'android'), { withFileTypes: true })
  .filter(entry => entry.isFile() && !entry.name.endsWith('.keystore'))
  .map(entry => fs.readFileSync(path.join(root, 'android', entry.name), 'utf8'))
  .join('\n');
assert.doesNotMatch(androidFiles, /GOOGLE_CLIENT_SECRET|RAILWAY_TOKEN|access_token/);

const deploymentDocs = fs.readFileSync(path.join(root, 'README_DEPLOYMENT.md'), 'utf8');
assert.match(deploymentDocs, /GOOGLE_TOKEN_ENCRYPTION_KEY/);

console.log('Android wrapper contract: PASS');
