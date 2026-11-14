import AppKit
import CoreAudio

// Mutes only iPhone Mirroring. The private aggregate activates the mute tap.
// It contains no physical audio devices and starts no IOProc, reads or recordings.
// Other apps, device volume and all microphone settings remain outside this helper.
let audioTargetBundle = "com.apple.ScreenContinuity"
let audioStatusPort = "ai.clicktoclose.phone-farm.audio-mute.status"
var ownedTap = AudioObjectID(kAudioObjectUnknown)
var ownedAggregate = AudioObjectID(kAudioObjectUnknown)
var ownedTapUUID: String?
var muteError: String?
var localPort: CFMessagePort?
let serviceGeneration = UUID().uuidString
let tapName = "Phone Farm silent iPhone Mirroring " + serviceGeneration
var silenceConfirmed = false
var silenceConfirmedAt: String?
var systemMutePIDs = [Int32]()
var systemMuteVerifiedAt: String?

func processPID(_ id: AudioObjectID) -> Int32? {
    var a = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyPID,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var pid: Int32 = 0; var size = UInt32(MemoryLayout<Int32>.size)
    return AudioObjectGetPropertyData(id, &a, 0, nil, &size, &pid) == noErr && pid > 0 ? pid : nil
}
// Read Core Audio's own mute event. No samples, microphone or other app audio is read.
// Match the unique tap name for this service lifetime. Core Audio log numbers are
// client IDs, not Unix PIDs. The actual tap process list binds the event to Mirroring.
func checkSystemMute() {
    let targets = mirroringProcesses().compactMap(processPID).sorted()
    guard targets.count == 1, verifiedMute() else { systemMutePIDs = []; return }
    if systemMutePIDs == targets { return }
    let task = Process(); let pipe = Pipe()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/log")
    task.arguments = ["show", "--last", "2m", "--style", "compact", "--predicate",
        "process == \"coreaudiod\" AND eventMessage CONTAINS \"HALS_Client::\" AND eventMessage CONTAINS \"com.apple.ScreenContinuity\""]
    task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
    do {
        try task.run(); let data = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
        guard task.terminationStatus == 0, data.count < 1_000_000,
              let text = String(data: data, encoding: .utf8) else { return }
        let lines = text.components(separatedBy: .newlines)
        let identity = "Process \(audioTargetBundle) ("
        let owner = "by \(tapName) ("
        guard let event = lines.last(where: { $0.contains(identity) && $0.contains(owner) }),
              event.contains("HALS_Client::AddMuter:"), event.contains("muted " + owner),
              event.contains("for all devices") else { systemMutePIDs = []; return }
        systemMutePIDs = targets; systemMuteVerifiedAt = ISO8601DateFormatter().string(from: Date())
    } catch { systemMutePIDs = [] }
}

func mirroringProcesses() -> [AudioObjectID] {
    var listAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &listAddress, 0, nil, &size) == noErr,
          size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &listAddress, 0, nil, &size, &ids) == noErr else { return [] }
    return ids.filter { id in
        var address = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var bytes = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &bytes, &value) == noErr,
              let bundle = value?.takeRetainedValue() else { return false }
        return bundle as String == audioTargetBundle
    }.sorted()
}

func output(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
func stringArray(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [String]? {
    var address = AudioObjectPropertyAddress(mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFArray>?
    var size = UInt32(MemoryLayout<Unmanaged<CFArray>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr,
          let array = value?.takeRetainedValue() else { return nil }
    return array as? [String]
}
func aggregateBound() -> Bool {
    guard ownedAggregate != kAudioObjectUnknown, let uuid = ownedTapUUID else { return false }
    return stringArray(ownedAggregate, kAudioAggregateDevicePropertyFullSubDeviceList) == []
        && stringArray(ownedAggregate, kAudioAggregateDevicePropertyTapList) == [uuid]
}
func verifiedMute() -> Bool {
    guard #available(macOS 26.0, *), ownedTap != kAudioObjectUnknown else { return false }
    var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyDescription,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CATapDescription>?
    var size = UInt32(MemoryLayout<Unmanaged<CATapDescription>?>.size)
    guard AudioObjectGetPropertyData(ownedTap, &address, 0, nil, &size, &value) == noErr,
          let description = value?.takeRetainedValue() else { return false }
    // Core Audio fills the process list as matching bundle processes appear.
    // The bundle filter remains the stable ownership boundary across reconnects.
    return aggregateBound()
        && description.muteBehavior == .muted && description.isPrivate && !description.isExclusive
        && description.bundleIDs == [audioTargetBundle] && description.isProcessRestoreEnabled
        && description.__processes.map { $0.uint32Value }.sorted() == mirroringProcesses()
}
func muteStatus() -> [String: Any] {
    let bound = verifiedMute()
    let targets = mirroringProcesses()
    let pids = targets.compactMap(processPID).sorted()
    let systemVerified = !pids.isEmpty && pids == systemMutePIDs
    let qualified = bound && (silenceConfirmed || systemVerified)
    // A stored tap description did not prove silence in the real Mirroring playback test.
    // Keep phone input blocked until an effective mute has been verified without recording audio.
    return ["ready": qualified && !targets.isEmpty, "bindingVerified": bound, "audibilityVerified": qualified,
            "serviceGeneration": serviceGeneration, "silenceConfirmedAt": silenceConfirmedAt ?? NSNull(),
            "verificationMethod": systemVerified ? "coreaudio_process_muter" : silenceConfirmed ? "owner_playback_report" : "none",
            "systemMuteVerifiedAt": systemMuteVerifiedAt ?? NSNull(), "targetPIDs": pids,
            "helperPID": ProcessInfo.processInfo.processIdentifier,
            "muteArmed": bound, "aggregateId": ownedAggregate, "physicalOutputDevices": 0,
            "audioIOStarted": false,
            "targetProcessIds": targets, "scope": "iphone_mirroring_only", "targetBundle": audioTargetBundle,
            "tapId": ownedTap, "audioRecorded": false, "masterVolumeChanged": false,
            "reason": qualified ? systemVerified ? "Core Audio confirms this helper muted the current Mirroring process for all devices." : "The Mirroring mute passed the owner's playback check."
                : bound ? "The private Mirroring mute sink is armed. A live silence check is still required. Keep playback stopped."
                : muteError ?? "The iPhone Mirroring mute is not verified. Keep playback stopped."]
}
func ensureMute() {
    guard #available(macOS 26.0, *) else { muteError = "This mute helper requires macOS 26 or later."; return }
    if ownedTap != kAudioObjectUnknown {
        if verifiedMute() { return }
        silenceConfirmed = false; silenceConfirmedAt = nil; systemMutePIDs = []; systemMuteVerifiedAt = nil
        // Close only Mirroring before repairing a missing mute. Meeting apps are untouched.
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: audioTargetBundle) { app.terminate() }
        if ownedAggregate != kAudioObjectUnknown {
            guard AudioHardwareDestroyAggregateDevice(ownedAggregate) == noErr else {
                muteError = "Could not reset the owned mute aggregate."; return
            }
            ownedAggregate = AudioObjectID(kAudioObjectUnknown)
        }
        // A missing or altered tap is not reported as muted. Destroy only our own tap.
        guard AudioHardwareDestroyProcessTap(ownedTap) == noErr else {
            muteError = "Could not reset the owned mute tap."; return
        }
        ownedTap = AudioObjectID(kAudioObjectUnknown)
    }
    // Bundle routing is installed before Mirroring opens and restored on process restart.
    // Do not mix bundle-ID targeting with an explicit process list.
    let description = CATapDescription(__stereoMixdownOfProcesses: [])
    description.name = tapName
    description.bundleIDs = [audioTargetBundle]
    description.isExclusive = false
    description.isPrivate = true
    description.isMixdown = true
    description.isMono = false
    description.isProcessRestoreEnabled = true
    description.muteBehavior = .muted
    var tap = AudioObjectID(kAudioObjectUnknown)
    let result = AudioHardwareCreateProcessTap(description, &tap)
    guard result == noErr, tap != kAudioObjectUnknown else {
        muteError = "Could not mute iPhone Mirroring (Core Audio status \(result))."; return
    }
    ownedTap = tap
    ownedTapUUID = description.uuid.uuidString
    let composition: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Phone Farm silent Mirroring sink",
        kAudioAggregateDeviceUIDKey: "ai.clicktoclose.phone-farm.silent-sink.\(UUID().uuidString)",
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceSubDeviceListKey: [],
        kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString]],
    ]
    var aggregate = AudioObjectID(kAudioObjectUnknown)
    let aggregateResult = AudioHardwareCreateAggregateDevice(composition as CFDictionary, &aggregate)
    guard aggregateResult == noErr, aggregate != kAudioObjectUnknown else {
        muteError = "Could not activate the private mute sink (Core Audio status \(aggregateResult))."; return
    }
    ownedAggregate = aggregate
    muteError = verifiedMute() ? nil : "Core Audio mute readback failed. Keep playback stopped."
}
func requestStatus(_ message: Int32 = 1, _ payload: Data? = nil) -> [String: Any] {
    guard let remote = CFMessagePortCreateRemote(nil, audioStatusPort as CFString) else {
        return ["ready": false, "scope": "iphone_mirroring_only", "reason": "The mute helper is not running."]
    }
    var reply: Unmanaged<CFData>?
    guard CFMessagePortSendRequest(remote, message, payload.map { $0 as CFData }, 1, 2, CFRunLoopMode.defaultMode.rawValue, &reply) == kCFMessagePortSuccess,
          let data = reply?.takeRetainedValue(),
          let result = try? JSONSerialization.jsonObject(with: data as Data) as? [String: Any] else {
        return ["ready": false, "scope": "iphone_mirroring_only", "reason": "The mute helper did not answer."]
    }
    return result
}
// Only an explicit owner's report after real playback can qualify the current service.
// A helper restart or mute repair discards this report. No automated test may manufacture it.
func confirmSilence(_ data: CFData?) -> [String: Any] {
    guard let data = data, CFDataGetLength(data) < 8000,
          let value = try? JSONSerialization.jsonObject(with: data as Data) as? [String: Any],
          value["confirmation"] as? String == "owner_confirmed_silent_playback",
          value["serviceGeneration"] as? String == serviceGeneration,
          value["tapId"] as? UInt32 == ownedTap,
          value["aggregateId"] as? UInt32 == ownedAggregate,
          let targets = value["targetProcessIds"] as? [UInt32],
          !targets.isEmpty, targets.sorted() == mirroringProcesses(), verifiedMute() else {
        return ["error": "The silence report does not match the current protected Mirroring session.", "ready": false]
    }
    silenceConfirmed = true; silenceConfirmedAt = ISO8601DateFormatter().string(from: Date())
    return muteStatus()
}
@main struct PhoneFarmAudioMute {
    static func main() {
        let command = CommandLine.arguments.dropFirst().first ?? "status"
        if command == "status" { output(requestStatus()); return }
        if command == "confirm-silence" {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard data.count < 8000 else { output(["error": "Silence report too large"]); exit(1) }
            let result = requestStatus(2, data); output(result)
            if result["ready"] as? Bool != true { exit(1) }
            return
        }
        guard command == "serve" else { output(["error": "Unsupported audio helper command"]); exit(1) }
        _ = NSApplication.shared
        var context = CFMessagePortContext(version: 0, info: nil, retain: nil, release: nil, copyDescription: nil)
        let callback: CFMessagePortCallBack = { _, message, payload, _ in
            let result = message == 1 ? muteStatus() : message == 2 ? confirmSilence(payload) : ["error": "Unsupported mute request"]
            let data = try? JSONSerialization.data(withJSONObject: result)
            return data.map { Unmanaged.passRetained($0 as CFData) }
        }
        guard let port = CFMessagePortCreateLocal(nil, audioStatusPort as CFString, callback, &context, nil),
              let source = CFMessagePortCreateRunLoopSource(nil, port, 0) else {
            output(["error": "The mute helper is already running"]); exit(1)
        }
        localPort = port; CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        ensureMute(); checkSystemMute(); output(muteStatus())
        let timer = Timer(timeInterval: 2, repeats: true) { _ in ensureMute(); checkSystemMute() }
        RunLoop.main.add(timer, forMode: .common)
        CFRunLoopRun()
    }
}
