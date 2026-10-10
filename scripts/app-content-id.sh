#!/bin/sh
# A short fingerprint of everything that goes into the Android app (the same paths that trigger its
# build -- see .github/workflows/android-test-apk.yml): the test app stamps it in, and the website's
# version.json carries the latest one, so a test app can tell when a newer build of it is out.
git ls-tree -r HEAD -- www resources scripts/native-config.js scripts/test-signing capacitor.config.json package.json package-lock.json | sha1sum | cut -c1-12
