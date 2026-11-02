import Foundation
import Capacitor
import CoreMIDI
import CoreAudioKit

/// MIDI for the iPad app. iPadOS web views have no Web MIDI, so this plugin
/// talks to CoreMIDI directly: every MIDI source (USB keyboards, Bluetooth LE
/// MIDI keyboards such as the Kawai ES120, network sessions) is listened to,
/// and every destination can be played into. src/platform/ipad/webMidi.ts turns
/// this into the standard Web MIDI API for the web app.
///
/// Bluetooth MIDI keyboards are paired with Apple's Bluetooth MIDI dialog
/// (showBluetoothPairing). Once paired there, the keyboard is a normal CoreMIDI
/// source and destination.
@objc(OrfeoMidiPlugin)
public class OrfeoMidiPlugin: CAPPlugin, CAPBridgedPlugin, UIAdaptivePresentationControllerDelegate {
    public let identifier = "OrfeoMidiPlugin"
    public let jsName = "OrfeoMidi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBluetoothPairing", returnType: CAPPluginReturnPromise),
    ]

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var connectedSources = Set<MIDIUniqueID>()
    private let lock = NSLock()
    private var pairingCall: CAPPluginCall?

    override public func load() {
        let status = MIDIClientCreateWithBlock("Orfeo" as CFString, &client) { [weak self] notification in
            guard let self = self else { return }
            if notification.pointee.messageID == .msgSetupChanged {
                self.connectAllSources()
                self.notifyListeners("devicesChanged", data: [:])
            }
        }
        guard status == noErr else {
            CAPLog.print("[OrfeoMidi] MIDIClientCreate failed: \(status)")
            return
        }
        MIDIInputPortCreateWithProtocol(client, "Orfeo In" as CFString, ._1_0, &inPort) { [weak self] eventList, srcRefCon in
            guard let self = self, let refCon = srcRefCon else { return }
            let sourceId = String(Int32(truncatingIfNeeded: Int(bitPattern: refCon)))
            self.receive(eventList, from: sourceId)
        }
        MIDIOutputPortCreate(client, "Orfeo Out" as CFString, &outPort)
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
}
