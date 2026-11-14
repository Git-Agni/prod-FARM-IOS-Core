"""Build the local Mac controller. No XCTest, phone action, permission prompt or service install."""
import pathlib
import plistlib
import subprocess
import os

root = pathlib.Path(__file__).resolve().parents[1]
bundle = root / '.mirroring/Phone Farm Mirroring.app'
binary = bundle / 'Contents/MacOS/PhoneFarmMirroring'
binary.parent.mkdir(parents=True, exist_ok=True)
(bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({
    'CFBundleIdentifier': 'ai.clicktoclose.phone-farm.mirroring',
    'CFBundleName': 'Phone Farm Mirroring',
    'CFBundleExecutable': 'PhoneFarmMirroring',
    'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1',
    'LSUIElement': True,
    'NSHighResolutionCapable': True,
}))
subprocess.run(['swiftc', '-parse-as-library', str(root / 'src/devices/mirroring/PhoneFarmMirroring.swift'),
                '-o', str(binary)], check=True)
identity = os.environ.get('PHONE_FARM_SIGN_IDENTITY', '08888E50A84D8FD119153F7B56DE6A9F0B6CD2F3')
subprocess.run(['codesign', '--force', '--sign', identity, '--identifier',
                'ai.clicktoclose.phone-farm.mirroring', str(bundle)], check=True)
print('Built local controller. No permissions were granted and no phone actions ran.')
