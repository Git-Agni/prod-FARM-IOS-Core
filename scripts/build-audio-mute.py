"""Build the mute helper. This does not launch it or alter audio."""
import pathlib
import plistlib
import subprocess
root = pathlib.Path(__file__).resolve().parents[1]
bundle = root / '.mirroring/Phone Farm Audio Mute.app'
binary = bundle / 'Contents/MacOS/PhoneFarmAudioMute'
binary.parent.mkdir(parents=True, exist_ok=True)
(bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({
    'CFBundleIdentifier': 'ai.clicktoclose.phone-farm.audio-mute',
    'CFBundleName': 'Phone Farm Audio Mute', 'CFBundleExecutable': 'PhoneFarmAudioMute',
    'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'LSUIElement': True,
}))
subprocess.run(['swiftc', '-parse-as-library', str(root / 'src/devices/mirroring/PhoneFarmAudioMute.swift'), '-o', str(binary)], check=True)
subprocess.run(['codesign', '--force', '--sign', '-', '--identifier', 'ai.clicktoclose.phone-farm.audio-mute', str(bundle)], check=True)
print('Built mute helper. No audio settings changed.')
