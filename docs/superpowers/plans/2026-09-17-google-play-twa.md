# Google Play TWA Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build and validate a minimal Android Trusted Web Activity wrapper for AcademiaPro with applicationId academy.academiapro.app, using the system browser/Custom Tabs for all Google OAuth flows.

**Architecture:** Keep AcademiaPro as the single web application. Add the minimum PWA metadata and Digital Asset Links required by a Trusted Web Activity, then generate the Android shell with Bubblewrap. The wrapper will not contain a WebView, Google credentials, API tokens, or a token bridge.

**Tech Stack:** Existing Node/Express web app, web manifest, Digital Asset Links, Bubblewrap, Android Gradle project, AndroidX browser/TWA, Node built-in assert tests, Android API 36 target.

**Spec:** docs/superpowers/specs/2026-09-17-google-play-twa-design.md

## Global Constraints

- Android package is exactly academy.academiapro.app.
- Google OAuth opens in the trusted browser/Custom Tabs; no embedded WebView.
- No Google secrets, Google tokens, Railway variables, or private signing keys enter Git.
- Production artifact is an Android App Bundle (.aab).
- Existing Google login, Calendar/Meet, and Gmail/transcription callbacks remain HTTPS web callbacks.
- Never run npm test; its smoke test defaults to live Railway.
- The build targets Android API 36 for the current Play submission requirement.

---

### Task 1: Sync Play-readiness work with production fixes

**Files:**
- Git history only; preserve codex/google-play-readiness unchanged.
- Tests: tests/oauth-scopes.js, tests/oauth-token-lifecycle.js, tests/meet-owner-resolution.js

**Interfaces:**
- Consumes origin/main and the verified commits on codex/google-play-readiness.
- Produces this branch with both the five production fixes and Play-readiness changes.

- [ ] Record branch tips:

~~~bash
git rev-parse origin/main
git rev-parse codex/google-play-readiness
git log --oneline origin/main..codex/google-play-readiness
~~~

- [ ] Cherry-pick the verified launch commits in chronological order:

~~~bash
git cherry-pick a8f2ebc 07f9bf5 fc3d7ec 61ec646 c871f70 be945fb fd585c7 0a7cb62 b10dc77 55c9d32 f1e10df
~~~

Keep the current production fixes from origin/main and the final Calendar scope decision calendar.events if conflicts appear.

- [ ] Run safe local checks:

~~~bash
node tests/oauth-scopes.js
node tests/oauth-token-lifecycle.js
node tests/meet-owner-resolution.js
~~~

Expected: all pass without calls to Railway or Google.

- [ ] Commit:

~~~bash
git commit -m "chore: sync Play readiness with production fixes"
~~~

---

### Task 2: Add the web manifest and its contract test

**Files:**
- Create public/manifest.webmanifest
- Modify public/landing.html
- Create tests/android-wrapper.js

**Interfaces:**
- Consumes existing public icon assets and the public root route.
- Produces a manifest at /manifest.webmanifest and a deterministic Node contract test.

- [ ] Write the failing test:

~~~js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
const landing = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');

assert.equal(manifest.name, 'AcademiaPro');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.id, '/');
assert.ok(manifest.icons.some(icon => icon.src === '/favicon-192.png' && icon.sizes === '192x192'));
assert.ok(landing.includes('rel="manifest"'));
assert.ok(landing.includes('/manifest.webmanifest'));
console.log('Android wrapper contract: PASS');
~~~

- [ ] Run and observe the expected failure:

~~~bash
node tests/android-wrapper.js
~~~

Expected: failure because public/manifest.webmanifest does not exist.

- [ ] Add the manifest with name AcademiaPro, short_name AcademiaPro, id /, start_url /, scope /, display standalone, theme color #6d5dfc, background #f8fafc, and the existing 192x192 and 180x180 PNG icons. Add a manifest link in the head of public/landing.html.

- [ ] Run the contract test and commit:

~~~bash
node tests/android-wrapper.js
git add public/manifest.webmanifest public/landing.html tests/android-wrapper.js
git commit -m "feat: add AcademiaPro web app manifest"
~~~

---

### Task 3: Generate the TWA project with the fixed package ID

**Files:**
- Create android/ using Bubblewrap
- Modify tests/android-wrapper.js
- Create android/.gitignore

**Interfaces:**
- Consumes the deployed web manifest.
- Produces a generated TWA project and twa-manifest.json with package academy.academiapro.app.

- [ ] Extend tests/android-wrapper.js to assert that android/twa-manifest.json exists and contains packageId academy.academiapro.app, host academiapro.academy, and startUrl https://academiapro.academy/.

- [ ] Run the test and observe failure because android/twa-manifest.json does not exist:

~~~bash
node tests/android-wrapper.js
~~~

- [ ] Generate the project:

~~~bash
npx @bubblewrap/cli init --manifest https://academiapro.academy/manifest.webmanifest --directory android
~~~

Set application ID academy.academiapro.app, host academiapro.academy, start URL /, and standalone display mode.

- [ ] Create android/.gitignore:

~~~gitignore
*.keystore
*.jks
local.properties
build/
app/build/
.gradle/
~~~

- [ ] Run the contract test and commit:

~~~bash
node tests/android-wrapper.js
git add android tests/android-wrapper.js
git commit -m "feat: generate AcademiaPro Trusted Web Activity"
~~~

---

### Task 4: Add Digital Asset Links safely

**Files:**
- Create public/.well-known/assetlinks.json
- Modify tests/android-wrapper.js
- Modify README_DEPLOYMENT.md

**Interfaces:**
- Consumes the local upload certificate SHA-256 fingerprint.
- Produces the public domain-to-app association without committing a private key.

- [ ] Extend tests/android-wrapper.js to assert the association file exists, has one android_app target, package academy.academiapro.app, the handle-all-URLs relation, and a valid 32-byte colon-separated uppercase SHA-256 fingerprint.

- [ ] Run the test and observe failure because the association file does not exist.

- [ ] Read the real upload certificate fingerprint:

~~~bash
keytool -list -v -keystore android/academiapro-upload.keystore
~~~

Keep the keystore ignored and back it up outside Git.

- [ ] Create public/.well-known/assetlinks.json with the exact fingerprint printed in the previous step. Its JSON must contain one object whose relation is delegate_permission/common.handle_all_urls, whose target namespace is android_app, whose package_name is academy.academiapro.app, and whose sha256_cert_fingerprints array contains that 32-byte uppercase colon-separated fingerprint. The contract test rejects any other value.

- [ ] Add this deployment note to README_DEPLOYMENT.md:

~~~text
TWA: después de crear la app en Play Console, añade también la huella SHA-256 de Play App Signing a public/.well-known/assetlinks.json y vuelve a desplegarla. La clave privada nunca se guarda en Git.
~~~

- [ ] Run the test and commit:

~~~bash
node tests/android-wrapper.js
git add public/.well-known/assetlinks.json README_DEPLOYMENT.md tests/android-wrapper.js
git commit -m "feat: verify AcademiaPro domain for TWA"
~~~

---

### Task 5: Build the Android App Bundle and verify the artifact

**Files:**
- Modify android/twa-manifest.json if generated config needs alignment
- Modify tests/android-wrapper.js
- Create docs/android-build.md

**Interfaces:**
- Consumes the generated TWA, manifest, and Digital Asset Links.
- Produces a local release .aab and a repeatable API 36 build procedure.

- [ ] Extend the contract test to assert applicationId academy.academiapro.app and targetSdk 36 in android/app/build.gradle, and reject android source containing android.webkit.WebView or Google secrets.

- [ ] Run the contract test, fix only generated configuration mismatches, and rerun it:

~~~bash
node tests/android-wrapper.js
~~~

- [ ] Build:

~~~bash
cd android
./gradlew bundleRelease
cd ..
~~~

Expected artifact: android/app/build/outputs/bundle/release/app-release.aab.

- [ ] Verify the artifact and forbidden implementation:

~~~bash
test -s android/app/build/outputs/bundle/release/app-release.aab
! rg -n "android\\.webkit\\.WebView|GOOGLE_CLIENT_SECRET|gmail_refresh_token|calendar_refresh_token" android
~~~

- [ ] Document API 36, keystore backup, AAB output, and Play App Signing fingerprint update in docs/android-build.md, then commit:

~~~bash
git add android/twa-manifest.json tests/android-wrapper.js docs/android-build.md
git commit -m "build: validate AcademiaPro Android bundle"
~~~

---

### Task 6: Run physical-device OAuth acceptance checks

**Files:**
- Create docs/android-device-test.md
- Modify tests/android-wrapper.js only for missing deterministic assertions

**Interfaces:**
- Consumes the release bundle, a physical Android device, production AcademiaPro, and Google test accounts.
- Produces a recorded pass/fail checklist.

- [ ] Install the generated APK on a physical Android device after Android SDK/ADB is installed, or use Play internal testing for the AAB when only the bundle is available.

- [ ] Record these checks:

~~~text
[ ] Password login reaches the correct role dashboard.
[ ] Google login opens a browser/Custom Tab, not an embedded WebView.
[ ] Cancelling consent returns to AcademiaPro with a useful error state.
[ ] Calendar connection creates and removes a test Meet event.
[ ] Gmail connection reaches connected state and disconnect removes local grants.
[ ] Closing and reopening the TWA preserves the intended HttpOnly session.
[ ] Back navigation, file upload, download, and external links work.
[ ] Missing Digital Asset Links falls back to a visible Custom Tab.
~~~

- [ ] Run all safe automated checks:

~~~bash
node tests/android-wrapper.js
node tests/oauth-scopes.js
node tests/oauth-token-lifecycle.js
node tests/meet-owner-resolution.js
~~~

- [ ] Commit the test record:

~~~bash
git add docs/android-device-test.md tests/android-wrapper.js
git commit -m "test: record Android OAuth acceptance checks"
~~~

---

### Task 7: Push the review branch

**Files:** no source changes.

**Interfaces:**
- Consumes all passing commits.
- Produces remote branch codex/google-play-twa; main stays untouched.

- [ ] Verify:

~~~bash
git status --short
git log --oneline origin/main..HEAD
git diff --check
~~~

- [ ] Push only after the user requests the external push:

~~~bash
git push -u origin codex/google-play-twa
~~~

- [ ] Report branch, commits, tests, device limitations, and whether Play internal testing is ready.
