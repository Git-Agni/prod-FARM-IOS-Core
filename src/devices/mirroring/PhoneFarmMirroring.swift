import AppKit
import ApplicationServices
import ScreenCaptureKit
import Vision
import ImageIO
import UniformTypeIdentifiers

// Local controller for one allowlisted app. No permission prompts or automatic authentication.
// Phone Farm must own the device lock and submission claim before sending any publishing input.
let targetBundle = "com.apple.ScreenContinuity"
let controllerPort = "ai.clicktoclose.phone-farm.mirroring.control"
var permissionWindow: NSWindow?
var statusPort: CFMessagePort?
struct ControllerError: Error { let message: String }
func fail(_ message: String) throws -> Never { throw ControllerError(message: message) }
func emit(_ value: [String: Any]) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10]))
}
func targetApp() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(withBundleIdentifier: targetBundle).first
}
func sessionLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
    return session["CGSSessionScreenIsLocked"] as? Bool == true || session["kCGSSessionOnConsoleKey"] as? Bool != true
}
func targetWindowPresent() -> Bool {
    guard let app = targetApp(), let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else { return false }
    return windows.contains { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }
}
func status() -> [String: Any] {
    let ax = AXIsProcessTrusted(), screen = CGPreflightScreenCaptureAccess(), window = targetWindowPresent(), locked = sessionLocked()
    return ["protocolVersion": 4, "accessibility": ax, "screenCapture": screen, "windowPresent": window,
            "macLocked": locked, "controlReady": ax && screen && window && !locked]
}
// The permission owner is the standalone app. Node only reads its local status port.
// This port accepts only status and the allowlisted controls below. The scheduler remains disabled until native calibration.
func runControllerApp() throws {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    var context = CFMessagePortContext(version: 0, info: nil, retain: nil, release: nil, copyDescription: nil)
    let callback: CFMessagePortCallBack = { _, message, data, _ in
        let result: [String: Any]
        if message == 1 { result = status() }
        else if message == 2, let data, CFDataGetLength(data) <= 32_000,
                let input = try? JSONSerialization.jsonObject(with: data as Data) as? [String: Any],
                let command = input["command"] as? String,
                ["snapshot", "home", "tap", "double-tap", "tap-text", "tap-text-prefix", "key", "text", "scroll", "drag"].contains(command) {
            // Input runs as a child of this permission-owning app, never as Node or Terminal.
            let child = Process(); let output = Pipe(); let payload = Pipe()
            child.executableURL = Bundle.main.executableURL; child.arguments = [command]
            child.standardInput = payload; child.standardOutput = output; child.standardError = FileHandle.nullDevice
            do {
                try child.run()
                payload.fileHandleForWriting.write(try JSONSerialization.data(withJSONObject: input))
                try payload.fileHandleForWriting.close()
                let answer = output.fileHandleForReading.readDataToEndOfFile(); child.waitUntilExit()
                result = (try? JSONSerialization.jsonObject(with: answer) as? [String: Any]) ?? ["error": "Mac controller returned invalid output"]
            } catch { result = ["error": "Mac controller could not run the requested input"] }
        } else { result = ["error": "Unsupported Mac controller request"] }
        let bytes = try? JSONSerialization.data(withJSONObject: result)
        return bytes.map { Unmanaged.passRetained($0 as CFData) }
    }
    guard let port = CFMessagePortCreateLocal(nil, controllerPort as CFString, callback, &context, nil),
          let source = CFMessagePortCreateRunLoopSource(nil, port, 0) else { try fail("A Mac controller is already running") }
    statusPort = port; CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    if CommandLine.arguments.contains("--background") { application.run(); return }
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 530, height: 220),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    window.title = "Phone Farm Mirroring"
    let label = NSTextField(wrappingLabelWithString:
        "Phone Farm Mirroring\n\nThis controller will read and control the iPhone Mirroring window. It does not use XCTest.\n\nmacOS Accessibility and screen-capture permission are required. No permission prompt or phone action runs on launch.\n\nScheduled publishing remains paused until the posting flows pass native checks.")
    label.frame = NSRect(x: 22, y: 16, width: 486, height: 180)
    window.contentView?.addSubview(label); permissionWindow = window
    window.center(); window.makeKeyAndOrderFront(nil); application.activate(ignoringOtherApps: true)
    application.run()
}
func readAppReply(message: Int32 = 1, data: Data? = nil) throws -> [String: Any] {
    guard let port = CFMessagePortCreateRemote(nil, controllerPort as CFString) else { try fail("The standalone Mac controller is not running") }
    var answer: Unmanaged<CFData>?
    guard CFMessagePortSendRequest(port, message, data.map { $0 as CFData }, 2, message == 1 ? 2 : 30, CFRunLoopMode.defaultMode.rawValue, &answer) == kCFMessagePortSuccess,
          let bytes = answer?.takeRetainedValue() else { try fail("The standalone Mac controller did not answer") }
    guard var value = try JSONSerialization.jsonObject(with: bytes as Data) as? [String: Any] else { try fail("Invalid Mac controller response") }
    if message == 1 { value["appController"] = true }
    return value
}
// Status comes from the dedicated mute service. Never changes Mac master volume.
func requirePhoneAudioMute() throws {
    let helper = Bundle.main.bundleURL.deletingLastPathComponent()
        .appendingPathComponent("Phone Farm Audio Mute.app/Contents/MacOS/PhoneFarmAudioMute")
    let child = Process(); let output = Pipe()
    child.executableURL = helper; child.arguments = ["status"]
    child.standardOutput = output; child.standardError = FileHandle.nullDevice
    try child.run()
    let bytes = output.fileHandleForReading.readDataToEndOfFile(); child.waitUntilExit()
    guard child.terminationStatus == 0,
          let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          value["ready"] as? Bool == true,
          value["scope"] as? String == "iphone_mirroring_only",
          value["targetBundle"] as? String == targetBundle,
          value["audioRecorded"] as? Bool == false,
          value["masterVolumeChanged"] as? Bool == false else {
        try fail("Phone audio mute is not verified; no input was sent")
    }
}
struct TextLine {
    let text: String; let confidence: Float; let rect: CGRect
    var json: [String: Any] { ["text": text, "confidence": confidence,
        "x": rect.minX, "y": 1 - rect.maxY, "width": rect.width, "height": rect.height] }
}
struct Observation { let image: CGImage; let window: SCWindow; let lines: [TextLine]
    var text: [String] { lines.map { $0.text } }
}
func observe() async throws -> Observation {
    guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { try fail("Accessibility and screen capture permission are required") }
    guard !sessionLocked() else { try fail("The Mac is locked; no input will be sent") }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let windows = content.windows.filter { $0.owningApplication?.bundleIdentifier == targetBundle && $0.windowLayer == 0 && $0.frame.width > 150 && $0.frame.height > 300 }
    guard windows.count == 1, let window = windows.first else { try fail("Exactly one visible iPhone Mirroring window is required") }
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width * 2); config.height = Int(window.frame.height * 2)
    config.showsCursor = false
    let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
    let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate
    try VNImageRequestHandler(cgImage: image).perform([request])
    let lines = (request.results ?? []).compactMap { result -> TextLine? in
        guard let candidate = result.topCandidates(1).first else { return nil }
        return TextLine(text: candidate.string, confidence: candidate.confidence, rect: result.boundingBox)
    }
    return Observation(image: image, window: window, lines: lines)
}
func normalize(_ text: String) -> String {
    text.precomposedStringWithCompatibilityMapping
        .replacingOccurrences(of: "’", with: "'").replacingOccurrences(of: "‘", with: "'")
        .replacingOccurrences(of: "“", with: "\"").replacingOccurrences(of: "”", with: "\"")
        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}
func validateContext(_ input: [String: Any], _ observation: Observation) throws {
    guard let expected = input["requiredText"] as? [String], !expected.isEmpty,
          expected.count <= 8, expected.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 300 }) else {
        try fail("Every input requires reviewed visible text from the current screen")
    }
    let actual = normalize(observation.text.joined(separator: " "))
    guard expected.allSatisfy({ actual.contains(normalize($0)) }) else { try fail("The screen does not match the expected text; no input was sent") }
    guard let app = targetApp() else { try fail("iPhone Mirroring is not running") }
    app.activate(options: [.activateAllWindows])
    let deadline = Date().addingTimeInterval(2)
    while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier, !sessionLocked() else {
        try fail("iPhone Mirroring is not the active app; no input was sent")
    }
    Thread.sleep(forTimeInterval: 0.15)
    // Mirroring does not support AXRaise. Confirm the actual window order
    // instead of trusting the app activation request alone.
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let front = windows.first { ($0[kCGWindowLayer as String] as? Int) == 0 }
    guard (front?[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier else {
        try fail("The Mirroring window is not in front; no input was sent")
    }
}
func key(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { try fail("Could not create keyboard input") }
    down.flags = flags; up.flags = []; down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.06)
    up.timestamp = DispatchTime.now().uptimeNanoseconds
    up.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.1)
}
func tap(_ point: CGPoint, count: Int = 1) throws {
    // Mirroring needs pointer entry before it forwards a click to the phone.
    // A down/up pair at a new position alone can be ignored by its remote view.
    guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { try fail("Could not position the native pointer") }
    move.flags = []; move.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.12)
    for index in 1...count {
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
          let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else { try fail("Could not create pointer input") }
    down.flags = []; up.flags = []
    down.setIntegerValueField(.mouseEventClickState, value: Int64(index))
    up.setIntegerValueField(.mouseEventClickState, value: Int64(index))
    down.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.06)
    up.timestamp = DispatchTime.now().uptimeNanoseconds
    up.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.1)
    }
}
func allowedKey(_ name: String) throws {
    switch name {
    case "spotlight": try key(20, flags: .maskCommand)
    case "app-switcher": try key(19, flags: .maskCommand)
    case "return": try key(36)
    case "escape": try key(53)
    case "backspace": try key(51)
    case "clear-line": try key(51, flags: .maskCommand)
    case "select-all": try key(0, flags: .maskCommand)
    default: try fail("Unsupported keyboard command")
    }
}
@main struct Main {
    static func main() async {
        do {
            let command = CommandLine.arguments.dropFirst().first ?? "serve"
            if command == "serve" { try runControllerApp(); return }
            if command == "client-status" { try emit(readAppReply()); return }
            if command == "client-command" {
                let bytes = FileHandle.standardInput.readDataToEndOfFile()
                guard bytes.count <= 32_000 else { try fail("Mac controller request is too large") }
                try emit(readAppReply(message: 2, data: bytes)); return
            }
            if command == "status" { try emit(status()); return }
            guard ["snapshot", "home", "tap", "double-tap", "tap-text", "tap-text-prefix", "key", "text", "scroll", "drag"].contains(command) else { try fail("Unsupported controller command") }
            // Child commands must initialize AppKit's WindowServer connection before ScreenCaptureKit.
            // Without this, CGS_REQUIRE_INIT aborts before a structured error can be returned.
            NSApplication.shared.setActivationPolicy(.accessory)
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let input = data.isEmpty ? [:] : try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let observation = try await observe()
            if command == "snapshot" {
                let bytes = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(bytes, UTType.png.identifier as CFString, 1, nil) else { try fail("Could not create window screenshot") }
                CGImageDestinationAddImage(destination, observation.image, nil)
                guard CGImageDestinationFinalize(destination) else { try fail("Window screenshot failed") }
                try emit(["windowId": observation.window.windowID, "width": observation.image.width, "height": observation.image.height,
                          "text": observation.text, "lines": observation.lines.map { $0.json }, "png": (bytes as Data).base64EncodedString()]); return
            }
            // Home remains available to stop playback; all other input requires verified process mute.
            if command != "home" { try requirePhoneAudioMute() }
            // Validate all input before activating the window or sending events.
            if command == "tap" || command == "double-tap" {
                guard let x = input["x"] as? Double, let y = input["y"] as? Double, x.isFinite, y.isFinite,
                      x >= 0, x <= 1, y >= 0, y <= 1 else { try fail("Tap coordinates must be within the Mirroring window") }
            }
            if command == "text" {
                guard let text = input["text"] as? String, !text.isEmpty, text.count <= 40 else { try fail("Text must contain 1 to 40 characters per request") }
            }
            if command == "scroll" {
                guard let amount = input["pixels"] as? Int, amount != 0, abs(amount) <= 800 else { try fail("Scroll must be between -800 and 800 pixels, excluding zero") }
                for name in ["x", "y"] {
                    if let coordinate = input[name] as? Double {
                        guard coordinate.isFinite, coordinate >= 0, coordinate <= 1 else { try fail("Scroll point must stay inside Mirroring") }
                    }
                }
            }
            if command == "key" {
                guard let name = input["key"] as? String, ["spotlight", "app-switcher", "return", "escape", "backspace", "clear-line", "select-all"].contains(name) else { try fail("Unsupported keyboard command") }
            }
            if command == "drag" {
                for name in ["fromX", "fromY", "toX", "toY"] {
                    guard let coordinate = input[name] as? Double, coordinate.isFinite, coordinate >= 0, coordinate <= 1 else { try fail("Drag coordinates must stay within Mirroring") }
                }
            }
            var textPoint: CGPoint?
            if command == "tap-text" || command == "tap-text-prefix" {
                guard let label = input["matchText"] as? String, !label.isEmpty, label.count <= 300,
                      let minY = input["minY"] as? Double, let maxY = input["maxY"] as? Double,
                      minY >= 0, maxY <= 1, minY < maxY else { try fail("Text selection requires a bounded label") }
                let fraction = input["anchorX"] as? Double ?? 0.5
                guard fraction.isFinite, fraction >= 0, fraction <= 1 else { try fail("Text anchor must stay inside its native control") }
                let suffix = input["suffix"] as? String
                if let suffix { guard !suffix.isEmpty, suffix.count <= 100 else { try fail("Invalid native control suffix") } }
                let matches = observation.lines.filter { (command == "tap-text" ? normalize($0.text) == normalize(label) : normalize($0.text).hasPrefix(normalize(label) + " "))
                    && (suffix == nil || normalize($0.text).hasSuffix(normalize(suffix!)))
                    && 1 - $0.rect.midY >= minY && 1 - $0.rect.midY <= maxY && $0.confidence >= 0.5 }
                guard matches.count == 1, let match = matches.first else { try fail("Exactly one matching visible control is required; no input was sent") }
                textPoint = CGPoint(x: observation.window.frame.minX + (match.rect.minX + match.rect.width * fraction) * observation.window.frame.width,
                    y: observation.window.frame.minY + (1 - match.rect.midY) * observation.window.frame.height)
            }
            try validateContext(input, observation)
            let screen = normalize(observation.text.joined(separator: " "))
            guard !["iphone in use", "lock your iphone to connect", "unlock your iphone", "iphone mirroring ended"].contains(where: { screen.contains($0) }) else { try fail("The physical phone is not connected for Mirroring; no input was sent") }
            if command == "home" { try key(18, flags: .maskCommand) }
            if command == "key" { try allowedKey(input["key"] as! String) }
            if (command == "tap-text" || command == "tap-text-prefix"), let point = textPoint { try tap(point) }
            if command == "tap" || command == "double-tap" {
                let point = CGPoint(x: observation.window.frame.minX + (input["x"] as! Double) * observation.window.frame.width,
                                    y: observation.window.frame.minY + (input["y"] as! Double) * observation.window.frame.height)
                try tap(point, count: command == "double-tap" ? 2 : 1)
            }
            if command == "drag" {
                let frame = observation.window.frame
                let from = CGPoint(x: frame.minX + (input["fromX"] as! Double) * frame.width, y: frame.minY + (input["fromY"] as! Double) * frame.height)
                let to = CGPoint(x: frame.minX + (input["toX"] as! Double) * frame.width, y: frame.minY + (input["toY"] as! Double) * frame.height)
                guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left),
                      let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left) else { try fail("Could not create drag input") }
                down.post(tap: .cghidEventTap)
                for step in 1...30 {
                    let fraction = Double(step) / 30
                    let point = CGPoint(x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction)
                    guard let event = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) else { up.post(tap: .cghidEventTap); try fail("Could not complete drag") }
                    event.post(tap: .cghidEventTap)
                    try await Task.sleep(nanoseconds: 10_000_000)
                }
                up.post(tap: .cghidEventTap)
            }
            if command == "text" {
                // Unicode keyboard events do not overwrite the user's clipboard.
                // Mirroring drops rapid Unicode batches. Pace each character, and send real
                // Return/Space keys for separators. The caller must read the completed caption.
                for character in input["text"] as! String {
                    guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == targetBundle, !sessionLocked() else { try fail("Mirroring lost focus during text input") }
                    if character == "\n" { try key(36) }
                    else if character == " " { try key(49) }
                    else {
                        let chunk = Array(String(character).utf16)
                        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { try fail("Could not create text input") }
                        down.flags = []; up.flags = []
                        down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                        up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                    }
                    try await Task.sleep(nanoseconds: 80_000_000)
                }
            }
            if command == "scroll" {
                let frame = observation.window.frame
                let center = CGPoint(x: frame.minX + (input["x"] as? Double ?? 0.5) * frame.width,
                    y: frame.minY + (input["y"] as? Double ?? 0.5) * frame.height)
                guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: center, mouseButton: .left) else { try fail("Could not place the native scroll pointer") }
                move.post(tap: .cghidEventTap); try await Task.sleep(nanoseconds: 100_000_000)
                guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(input["pixels"] as! Int), wheel2: 0, wheel3: 0) else { try fail("Could not create scroll input") }
                event.location = center; event.post(tap: .cghidEventTap)
            }
            try emit(["inputSent": true, "command": command, "publicationVerified": false])
        } catch {
            try? emit(["error": (error as? ControllerError)?.message ?? "Mac controller operation failed"])
            exit(1)
        }
    }
}
