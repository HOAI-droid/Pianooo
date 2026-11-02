import Foundation
import UIKit
import Capacitor

/// Files handed to Pianooo from other apps — Safari downloads, the Files app,
/// Mail, AirDrop ("Open in Pianooo" / share sheet). Each file is copied into
/// the app's Documents folder (the library) and announced to the web app,
/// which adds it to the library and opens it.
@objc(PianoooFilesPlugin)
public class PianoooFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PianoooFilesPlugin"
    public let jsName = "PianoooFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printFile", returnType: CAPPluginReturnPromise),
    ]

    /// Library paths (e.g. "/Documents/Song.mid") not yet picked up by the web app
    static var pending: [String] = []
    static let opened = Notification.Name("PianoooFileOpened")

    private static let supported: Set<String> = ["mid", "midi", "kar", "musicxml", "xml", "mxl", "gp", "gp3", "gp4", "gp5", "gpx", "cap"]

    override public func load() {
        NotificationCenter.default.addObserver(forName: PianoooFilesPlugin.opened, object: nil, queue: .main) { [weak self] note in
            guard let path = note.object as? String else { return }
            self?.notifyListeners("fileOpened", data: ["path": path], retainUntilConsumed: true)
        }
    }

    @objc func takePending(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let paths = PianoooFilesPlugin.pending
            PianoooFilesPlugin.pending.removeAll()
            call.resolve(["paths": paths])
        }
    }

    /// Prints a library file (sheet music PDF) with the iPad's print dialog
    /// (AirPrint). `path` is a library path such as "/Documents/Song.pdf".
    @objc func printFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), path.hasPrefix("/Documents/"),
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            call.reject("path must be inside the library")
            return
        }
        let url = documents.appendingPathComponent(String(path.dropFirst("/Documents/".count)))
        DispatchQueue.main.async {
            guard UIPrintInteractionController.canPrint(url), let view = self.bridge?.viewController?.view else {
                call.reject("This file cannot be printed")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .grayscale
            info.jobName = url.deletingPathExtension().lastPathComponent
            let printer = UIPrintInteractionController.shared
            printer.printInfo = info
            printer.printingItem = url
            let anchor = CGRect(x: view.bounds.midX, y: 80, width: 1, height: 1)
            printer.present(from: anchor, in: view, animated: true) { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["printed": completed]) }
            }
        }
    }

    /// Called by the scene delegate for every URL the app is asked to open.
    static func handle(_ url: URL) {
        guard url.isFileURL, supported.contains(url.pathExtension.lowercased()) else { return }
        guard let path = importIntoLibrary(url) else { return }
        DispatchQueue.main.async {
            pending.append(path)
            NotificationCenter.default.post(name: opened, object: path)
        }
    }

    private static func importIntoLibrary(_ url: URL) -> String? {
        let fm = FileManager.default
        guard let documents = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let docPath = documents.standardizedFileURL.path

        // Already in the library (opened from Files › Pianooo): use it where it is
        let src = url.standardizedFileURL.path
        if src.hasPrefix(docPath + "/") && !src.hasPrefix(docPath + "/Inbox/") {
            return "/Documents" + String(src.dropFirst(docPath.count))
        }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let name = url.lastPathComponent
        let ext = url.pathExtension
        let stem = url.deletingPathExtension().lastPathComponent
        var dest = documents.appendingPathComponent(name)
        var n = 2
        while fm.fileExists(atPath: dest.path) {
            // Same file opened again: reuse the copy instead of piling up "(2)", "(3)"
            if fm.contentsEqual(atPath: dest.path, andPath: url.path) {
                return "/Documents/" + dest.lastPathComponent
            }
            dest = documents.appendingPathComponent("\(stem) (\(n)).\(ext)")
            n += 1
        }
        do {
            try fm.copyItem(at: url, to: dest)
        } catch {
            CAPLog.print("[Pianooo] import failed: \(error)")
            return nil
        }
        // iOS parks some incoming files in Documents/Inbox — tidy up after copying
        if src.hasPrefix(docPath + "/Inbox/") { try? fm.removeItem(at: url) }
        return "/Documents/" + dest.lastPathComponent
    }
}
