import Foundation
import Capacitor
import CoreMIDI
import CoreAudioKit
import AVFoundation
import Accelerate

/// MIDI for the iPad app. iPadOS web views have no Web MIDI, so this plugin
/// talks to CoreMIDI directly: every MIDI source (USB keyboards, Bluetooth LE
/// MIDI keyboards such as the Kawai ES120, network sessions) is listened to,
/// and every destination can be played into. src/platform/ipad/webMidi.ts turns
/// this into the standard Web MIDI API for the web app.
///
/// Bluetooth MIDI keyboards are paired with Apple's Bluetooth MIDI dialog
/// (showBluetoothPairing). Once paired there, the keyboard is a normal CoreMIDI
/// source and destination.
@objc(PianoooMidiPlugin)
public class PianoooMidiPlugin: CAPPlugin, CAPBridgedPlugin, UIAdaptivePresentationControllerDelegate {
    public let identifier = "PianoooMidiPlugin"
    public let jsName = "PianoooMidi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBluetoothPairing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMic", returnType: CAPPluginReturnPromise),
    ]

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var connectedSources = Set<MIDIUniqueID>()
    private let lock = NSLock()
    private var pairingCall: CAPPluginCall?

    override public func load() {
        let status = MIDIClientCreateWithBlock("Pianooo" as CFString, &client) { [weak self] notification in
            guard let self = self else { return }
            if notification.pointee.messageID == .msgSetupChanged {
                self.connectAllSources()
                self.notifyListeners("devicesChanged", data: [:])
            }
        }
        guard status == noErr else {
            CAPLog.print("[PianoooMidi] MIDIClientCreate failed: \(status)")
            return
        }
        MIDIInputPortCreateWithProtocol(client, "Pianooo In" as CFString, ._1_0, &inPort) { [weak self] eventList, srcRefCon in
            guard let self = self, let refCon = srcRefCon else { return }
            let sourceId = String(Int32(truncatingIfNeeded: Int(bitPattern: refCon)))
            self.receive(eventList, from: sourceId)
        }
        MIDIOutputPortCreate(client, "Pianooo Out" as CFString, &outPort)
        connectAllSources()
    }

    // MARK: - Devices

    private func uniqueId(_ obj: MIDIObjectRef) -> MIDIUniqueID {
        var id: MIDIUniqueID = 0
        MIDIObjectGetIntegerProperty(obj, kMIDIPropertyUniqueID, &id)
        return id
    }

    private func stringProperty(_ obj: MIDIObjectRef, _ key: CFString) -> String {
        var value: Unmanaged<CFString>?
        if MIDIObjectGetStringProperty(obj, key, &value) == noErr, let v = value {
            return v.takeRetainedValue() as String
        }
        return ""
    }

    private func describe(_ endpoint: MIDIEndpointRef) -> [String: Any] {
        var name = stringProperty(endpoint, kMIDIPropertyDisplayName)
        if name.isEmpty { name = stringProperty(endpoint, kMIDIPropertyName) }
        return [
            "id": String(uniqueId(endpoint)),
            "name": name.isEmpty ? "MIDI device" : name,
            "manufacturer": stringProperty(endpoint, kMIDIPropertyManufacturer),
        ]
    }

    private func connectAllSources() {
        lock.lock(); defer { lock.unlock() }
        var present = Set<MIDIUniqueID>()
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            let id = uniqueId(src)
            present.insert(id)
            if connectedSources.contains(id) { continue }
            // The unique ID travels with every message as the "refCon"
            if MIDIPortConnectSource(inPort, src, UnsafeMutableRawPointer(bitPattern: Int(id))) == noErr {
                connectedSources.insert(id)
            }
        }
        // Sources that went away get reconnected when they come back
        connectedSources.formIntersection(present)
    }

    @objc func listDevices(_ call: CAPPluginCall) {
        connectAllSources()
        var inputs: [[String: Any]] = []
        var outputs: [[String: Any]] = []
        for i in 0..<MIDIGetNumberOfSources() { inputs.append(describe(MIDIGetSource(i))) }
        for i in 0..<MIDIGetNumberOfDestinations() { outputs.append(describe(MIDIGetDestination(i))) }
        call.resolve(["inputs": inputs, "outputs": outputs])
    }

    // MARK: - Input

    /// Number of 32-bit words in a Universal MIDI Packet, by message type
    private func umpSize(_ type: UInt32) -> Int {
        switch type {
        case 0x0, 0x1, 0x2, 0x6, 0x7: return 1
        case 0x3, 0x4, 0x8, 0x9, 0xA: return 2
        case 0xB, 0xC: return 3
        default: return 4
        }
    }

    private func receive(_ list: UnsafePointer<MIDIEventList>, from sourceId: String) {
        var messages: [[Int]] = []
        for packet in list.unsafeSequence() {
            let count = Int(packet.pointee.wordCount)
            withUnsafeBytes(of: packet.pointee.words) { raw in
                let words = raw.bindMemory(to: UInt32.self)
                var i = 0
                while i < min(count, words.count) {
                    let w = words[i]
                    let type = w >> 28
                    if type == 0x2 {
                        // MIDI 1.0 channel voice message: status, data1, data2
                        let status = Int((w >> 16) & 0xFF)
                        let d1 = Int((w >> 8) & 0x7F)
                        let d2 = Int(w & 0x7F)
                        let kind = status & 0xF0
                        messages.append(kind == 0xC0 || kind == 0xD0 ? [status, d1] : [status, d1, d2])
                    }
                    i += umpSize(type)
                }
            }
        }
        for m in messages {
            notifyListeners("midiMessage", data: ["id": sourceId, "data": m])
        }
    }

    // MARK: - Output

    @objc func send(_ call: CAPPluginCall) {
        guard let idString = call.getString("id"), let id = Int32(idString),
              let data = call.getArray("data", Int.self) else {
            call.reject("id and data are required")
            return
        }
        var obj = MIDIObjectRef()
        var objType = MIDIObjectType.other
        guard MIDIObjectFindByUniqueID(id, &obj, &objType) == noErr, objType == .destination else {
            call.reject("MIDI output not found")
            return
        }

        var words: [UInt32] = []
        var i = 0
        while i < data.count {
            let status = data[i] & 0xFF
            if status < 0x80 { i += 1; continue }
            if status >= 0xF8 {
                words.append(0x1000_0000 | UInt32(status) << 16)
                i += 1
                continue
            }
            if status >= 0xF0 { break } // SysEx and other system messages are not sent
            let kind = status & 0xF0
            let length = (kind == 0xC0 || kind == 0xD0) ? 2 : 3
            guard i + length <= data.count else { break }
            let d1 = UInt32(data[i + 1] & 0x7F)
            let d2 = length == 3 ? UInt32(data[i + 2] & 0x7F) : 0
            words.append(0x2000_0000 | UInt32(status) << 16 | d1 << 8 | d2)
            i += length
        }

        if !words.isEmpty {
            var list = MIDIEventList()
            var packet = MIDIEventListInit(&list, ._1_0)
            for var w in words {
                packet = MIDIEventListAdd(&list, MemoryLayout<MIDIEventList>.size, packet, 0, 1, &w)
            }
            MIDISendEventList(outPort, obj, &list)
        }
        call.resolve()
    }

    // MARK: - Bluetooth pairing

    @objc func showBluetoothPairing(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view to present from")
                return
            }
            let central = CABTMIDICentralViewController()
            central.title = "Bluetooth MIDI"
            central.navigationItem.rightBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .done, target: self, action: #selector(self.closePairing))
            let nav = UINavigationController(rootViewController: central)
            nav.modalPresentationStyle = .formSheet
            nav.presentationController?.delegate = self
            self.pairingCall = call
            presenter.present(nav, animated: true)
        }
    }

    @objc private func closePairing() {
        bridge?.viewController?.presentedViewController?.dismiss(animated: true) { [weak self] in
            self?.finishPairing()
        }
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finishPairing()
    }

    private func finishPairing() {
        connectAllSources()
        notifyListeners("devicesChanged", data: [:])
        pairingCall?.resolve()
        pairingCall = nil
    }

    // MARK: - Microphone (practice with an acoustic piano)
    //
    // The web view's own microphone access doesn't work everywhere (the Mac
    // version), so the microphone is read here. Every 25 ms the last 8192
    // samples get a Blackman window and an FFT; the magnitudes up to 5 kHz go
    // to the web app as 0.5 dB steps (src/practice/micInput.ts does the note
    // checks). Nothing is recorded or kept.

    private static let fftN = 8192
    private let micQueue = DispatchQueue(label: "pianooo.mic")
    private var micEngine: AVAudioEngine?
    private var micTimer: DispatchSourceTimer?
    private var micRing = [Float](repeating: 0, count: PianoooMidiPlugin.fftN)
    private var micPos = 0
    private var micRate: Double = 48000
    private var micWindow = [Float](repeating: 0, count: PianoooMidiPlugin.fftN)
    private var micDFT: vDSP_DFT_Setup?

    @objc func startMic(_ call: CAPPluginCall) {
        let begin = {
            self.micQueue.async {
                do {
                    try self.startMicEngine()
                    call.resolve(["sampleRate": self.micRate, "fftSize": PianoooMidiPlugin.fftN])
                } catch {
                    call.reject(error.localizedDescription, "error")
                }
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: begin()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                if ok { begin() } else { call.reject("Microphone access denied", "denied") }
            }
        default: call.reject("Microphone access denied", "denied")
        }
    }

    @objc func stopMic(_ call: CAPPluginCall) {
        micQueue.async {
            self.stopMicEngine()
            call.resolve()
        }
    }

    private func startMicEngine() throws {
        stopMicEngine()
        #if !targetEnvironment(macCatalyst)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
        try session.setActive(true)
        #endif
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "Pianooo", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone found"])
        }
        micRate = format.sampleRate
        micRing = [Float](repeating: 0, count: PianoooMidiPlugin.fftN)
        micPos = 0
        vDSP_blkman_window(&micWindow, vDSP_Length(PianoooMidiPlugin.fftN), 0)
        if micDFT == nil { micDFT = vDSP_DFT_zrop_CreateSetup(nil, vDSP_Length(PianoooMidiPlugin.fftN), .FORWARD) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self, let data = buffer.floatChannelData?[0] else { return }
            let samples = Array(UnsafeBufferPointer(start: data, count: Int(buffer.frameLength)))
            self.micQueue.async { self.appendSamples(samples) }
        }
        engine.prepare()
        try engine.start()
        micEngine = engine
        let timer = DispatchSource.makeTimerSource(queue: micQueue)
        timer.schedule(deadline: .now() + .milliseconds(25), repeating: .milliseconds(25))
        timer.setEventHandler { [weak self] in self?.analyseMic() }
        timer.resume()
        micTimer = timer
    }

    private func stopMicEngine() {
        micTimer?.cancel()
        micTimer = nil
        if let engine = micEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        micEngine = nil
        #if !targetEnvironment(macCatalyst)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        #endif
    }

    private func appendSamples(_ samples: [Float]) {
        let n = PianoooMidiPlugin.fftN
        for v in samples {
            micRing[micPos] = v
            micPos = (micPos + 1) % n
        }
    }

    private func analyseMic() {
        guard let dft = micDFT else { return }
        let n = PianoooMidiPlugin.fftN, half = n / 2
        // Oldest sample first
        var frame = [Float](repeating: 0, count: n)
        for i in 0..<n { frame[i] = micRing[(micPos + i) % n] }
        var rms: Float = 0
        vDSP_rmsqv(frame, 1, &rms, vDSP_Length(n))
        var windowed = [Float](repeating: 0, count: n)
        vDSP_vmul(frame, 1, micWindow, 1, &windowed, 1, vDSP_Length(n))
        // Real FFT: even samples as real, odd as imaginary part
        var inRe = [Float](repeating: 0, count: half), inIm = [Float](repeating: 0, count: half)
        for i in 0..<half { inRe[i] = windowed[2 * i]; inIm[i] = windowed[2 * i + 1] }
        var outRe = [Float](repeating: 0, count: half), outIm = [Float](repeating: 0, count: half)
        vDSP_DFT_Execute(dft, inRe, inIm, &outRe, &outIm)
        let binHz = micRate / Double(n)
        let bins = min(half - 1, Int((5000.0 / binHz).rounded(.up)))
        var bytes = [UInt8](repeating: 0, count: bins + 1)
        // Same scale as Web Audio's AnalyserNode: |X| / N in dB (zrop output is 2×)
        let scale = 1 / (2 * Float(n))
        for k in 1...bins {
            let mag = sqrtf(outRe[k] * outRe[k] + outIm[k] * outIm[k]) * scale
            let db = 20 * log10f(max(mag, 1e-12))
            bytes[k] = UInt8(max(0, min(255, Int(((db + 130) * 2).rounded()))))
        }
        let payload: [String: Any] = ["db": Data(bytes).base64EncodedString(), "rms": rms, "sr": micRate, "n": n]
        DispatchQueue.main.async { self.notifyListeners("micFrame", data: payload) }
    }
}
