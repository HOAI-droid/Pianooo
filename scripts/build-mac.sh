#!/usr/bin/env bash
# Builds the Mac version of Pianooo (Mac Catalyst) — the same app as on the
# iPad, in a Mac window. Runs on macOS (GitHub Actions or your own Mac).
#
# Capacitor's Swift-package build ships iOS-only binaries, so the Mac version
# is built through CocoaPods, which compiles Capacitor from source. This
# script generates that project in ios-mac/ from Capacitor's CocoaPods
# template plus Pianooo's own files from ios/App/App — the iPad project in ios/
# is not touched.
#
#   npm run ipad:sync && bash scripts/build-mac.sh
#   → build-mac/Build/Products/Release-maccatalyst/Pianooo.app
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=ios-mac
rm -rf "$OUT"
mkdir -p "$OUT"
tar -xzf node_modules/@capacitor/cli/assets/ios-pods-template.tar.gz -C "$OUT"

# Pianooo's native files, settings, icon and the built web app (from ipad:sync)
rsync -a --exclude '*.xcodeproj' ios/App/App/ "$OUT/App/App/"
test -f "$OUT/App/App/capacitor.config.json" || { echo "run npm run ipad:sync first"; exit 1; }

# The Filesystem plugin's helper library ships as an iOS-only binary on
# CocoaPods; for the Mac it is compiled from its open-source code instead
git clone --depth 1 --branch 2.0.1 https://github.com/ionic-team/ion-ios-filesystem.git "$OUT/IONFilesystemLib" 2>/dev/null \
  || git clone --depth 1 https://github.com/ionic-team/ion-ios-filesystem.git "$OUT/IONFilesystemLib"
cat > "$OUT/IONFilesystemLib/IONFilesystemLib.podspec" <<'EOF'
Pod::Spec.new do |s|
  s.name          = 'IONFilesystemLib'
  s.version       = '2.0.1'
  s.summary       = 'Library for accessing the file system (built from source for Mac Catalyst).'
  s.homepage      = 'https://github.com/ionic-team/ion-ios-filesystem'
  s.license       = { :type => 'MIT', :file => 'LICENSE' }
  s.author        = 'OutSystems Mobile Ecosystem'
  s.source        = { :git => 'https://github.com/ionic-team/ion-ios-filesystem.git' }
  s.source_files  = 'IONFilesystemLib/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.swift_versions = ['5.9']
end
EOF

cat > "$OUT/App/Podfile" <<'EOF'
require_relative '../../node_modules/@capacitor/ios/scripts/pods_helpers'

platform :ios, '15.0'
use_frameworks!
install! 'cocoapods', :disable_input_output_paths => true

target 'App' do
  pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
  pod 'CapacitorCordova', :path => '../../node_modules/@capacitor/ios'
  pod 'CapacitorBrowser', :path => '../../node_modules/@capacitor/browser'
  pod 'CapacitorFilesystem', :path => '../../node_modules/@capacitor/filesystem'
  pod 'IONFilesystemLib', :path => '../IONFilesystemLib'
  pod 'CapacitorShare', :path => '../../node_modules/@capacitor/share'
end

post_install do |installer|
  assertDeploymentTarget(installer)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['SUPPORTS_MACCATALYST'] = 'YES'
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
    end
  end
end
EOF

# Same Xcode settings as the iPad project: our Swift files, product name,
# Mac Catalyst with its sandbox entitlements
python3 - "$OUT/App/App.xcodeproj/project.pbxproj" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
bf = '9582B6852FE996820072D4E8 /* SceneDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 9582B6842FE996800072D4E8 /* SceneDelegate.swift */; };\n'
fr = '9582B6842FE996800072D4E8 /* SceneDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SceneDelegate.swift; sourceTree = "<group>"; };\n'
grp = '9582B6842FE996800072D4E8 /* SceneDelegate.swift */,\n'
src = '9582B6852FE996820072D4E8 /* SceneDelegate.swift in Sources */,\n'
for a in (bf, fr, grp, src):
    assert a in s, a
files = [('PianoooMidiPlugin.swift', 'B1B2C3D40000000000000001', 'B1B2C3D40000000000000002'),
         ('PianoooBridgeViewController.swift', 'B1B2C3D40000000000000003', 'B1B2C3D40000000000000004'),
         ('PianoooFilesPlugin.swift', 'B1B2C3D40000000000000005', 'B1B2C3D40000000000000006')]
for name, f, b in files:
    s = s.replace(bf, bf + f'\t\t{b} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {f} /* {name} */; }};\n')
    s = s.replace(fr, fr + f'\t\t{f} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = "<group>"; }};\n')
    s = s.replace(grp, grp + f'\t\t\t\t{f} /* {name} */,\n')
    s = s.replace(src, src + f'\t\t\t\t{b} /* {name} in Sources */,\n')
s = s.replace('PRODUCT_NAME = "$(TARGET_NAME)";',
              'PRODUCT_NAME = Pianooo;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.hoaidroid.pianooo;\n\t\t\t\tSUPPORTS_MACCATALYST = YES;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = "App/Pianooo-Mac.entitlements";')
s = s.replace('TARGETED_DEVICE_FAMILY = "1,2";', 'TARGETED_DEVICE_FAMILY = "2,6";')
open(p, 'w').write(s)
EOF

(cd "$OUT/App" && pod install)

set -o pipefail
xcodebuild -workspace "$OUT/App/App.xcworkspace" -scheme App -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' -derivedDataPath build-mac \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER:-1}" \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="" \
  build 2>&1 | tee xcodebuild-mac.log | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true
# A failed build can leave a half-made .app behind — insist on a real one
grep -q "BUILD SUCCEEDED" xcodebuild-mac.log
test -f build-mac/Build/Products/Release-maccatalyst/Pianooo.app/Contents/MacOS/Pianooo
echo "Built build-mac/Build/Products/Release-maccatalyst/Pianooo.app"
