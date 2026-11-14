import AppKit
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow?
    private weak var webView: WKWebView?
    private var exportFileHandle: FileHandle?
    private var exportFileURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Mixroom"
        window.minSize = NSSize(width: 720, height: 600)
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "mixroomExport")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView
        self.webView = webView

        guard let appURL = Bundle.main.resourceURL?.appendingPathComponent("Web/index.html"),
              FileManager.default.fileExists(atPath: appURL.path) else {
            showMissingResourcesAlert()
            return
        }

        webView.loadFileURL(
            appURL,
            allowingReadAccessTo: appURL.deletingLastPathComponent()
        )
        window.makeKeyAndOrderFront(nil)
        self.window = window
    }

    func applicationWillTerminate(_ notification: Notification) {
        removePartialExport()
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.prompt = parameters.allowsDirectories ? "Import Audio" : "Add Tracks"
        panel.message = parameters.allowsDirectories
            ? "Choose a folder containing audio tracks."
            : "Choose audio tracks to add to your mix."

        guard panel.runModal() == .OK else {
            completionHandler(nil)
            return
        }

        guard parameters.allowsDirectories else {
            completionHandler(panel.urls)
            return
        }

        let audioExtensions: Set<String> = [
            "aac", "aif", "aiff", "alac", "caf", "flac", "m4a",
            "mp3", "oga", "ogg", "opus", "wav", "wave",
        ]
        let files = panel.urls.flatMap { directory in
            FileManager.default.enumerator(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            )?.compactMap { entry -> URL? in
                guard let url = entry as? URL,
                      audioExtensions.contains(url.pathExtension.lowercased()),
                      (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
                    return nil
                }
                return url
            } ?? []
        }.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        completionHandler(files)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        removePartialExport()
        let alert = NSAlert()
        alert.messageText = "Mixroom's audio page stopped."
        alert.informativeText = "It may have run out of memory. The page restarted, so imported tracks were cleared. Try importing fewer or shorter tracks."
        alert.alertStyle = .warning
        alert.runModal()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else {
            replyHandler(nil, "Invalid WAV export request.")
            return
        }

        do {
            switch type {
            case "start":
                guard exportFileHandle == nil,
                      let headerString = payload["header"] as? String,
                      let header = Data(base64Encoded: headerString),
                      header.count == 44,
                      let requestedName = payload["fileName"] as? String else {
                    throw NSError(domain: "MixroomExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not start WAV export."])
                }
                let fileManager = FileManager.default
                guard let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
                    throw NSError(domain: "MixroomExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not locate your Documents folder."])
                }
                try fileManager.createDirectory(at: documents, withIntermediateDirectories: true)
                let baseName = URL(fileURLWithPath: requestedName).deletingPathExtension().lastPathComponent
                var destination = documents.appendingPathComponent("\(baseName).wav")
                var suffix = 2
                while fileManager.fileExists(atPath: destination.path) {
                    destination = documents.appendingPathComponent("\(baseName) (\(suffix)).wav")
                    suffix += 1
                }
                guard fileManager.createFile(atPath: destination.path, contents: nil) else {
                    throw NSError(domain: "MixroomExport", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not create the WAV file in Documents."])
                }
                exportFileURL = destination
                let handle = try FileHandle(forWritingTo: destination)
                do {
                    try handle.write(contentsOf: header)
                } catch {
                    try? handle.close()
                    try? fileManager.removeItem(at: destination)
                    throw error
                }
                exportFileHandle = handle
                replyHandler(["ok": true], nil)
            case "chunk":
                guard let handle = exportFileHandle,
                      let encodedData = payload["data"] as? String,
                      let data = Data(base64Encoded: encodedData) else {
                    throw NSError(domain: "MixroomExport", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not write a WAV audio segment."])
                }
                try handle.write(contentsOf: data)
                replyHandler(["ok": true], nil)
            case "finish":
                guard let handle = exportFileHandle else {
                    throw NSError(domain: "MixroomExport", code: 5, userInfo: [NSLocalizedDescriptionKey: "There is no WAV export in progress."])
                }
                try handle.synchronize()
                try handle.close()
                exportFileHandle = nil
                exportFileURL = nil
                replyHandler(["ok": true], nil)
            case "abort":
                removePartialExport()
                replyHandler(["ok": true], nil)
            default:
                throw NSError(domain: "MixroomExport", code: 6, userInfo: [NSLocalizedDescriptionKey: "Unknown WAV export operation."])
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let fileManager = FileManager.default
        guard let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            completionHandler(nil)
            notifyWebViewDownloadFailed("Could not locate your Documents folder.")
            return
        }

        do {
            try fileManager.createDirectory(at: documents, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            notifyWebViewDownloadFailed("Could not create your Documents folder: \(error.localizedDescription)")
            return
        }

        let suggestedName = URL(fileURLWithPath: suggestedFilename).deletingPathExtension().lastPathComponent
        let baseName = suggestedName.isEmpty ? "Mixroom mix" : suggestedName
        var destination = documents.appendingPathComponent("\(baseName).wav")
        var suffix = 2
        while fileManager.fileExists(atPath: destination.path) {
            destination = documents.appendingPathComponent("\(baseName) (\(suffix)).wav")
            suffix += 1
        }
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        webView?.evaluateJavaScript("window.mixroomNativeDownloadFinished?.()")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        notifyWebViewDownloadFailed("Could not save the WAV file: \(error.localizedDescription)")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func notifyWebViewDownloadFailed(_ message: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: message, options: [.fragmentsAllowed]),
              let encodedMessage = String(data: data, encoding: .utf8) else {
            return
        }
        webView?.evaluateJavaScript("window.mixroomNativeDownloadFailed?.(\(encodedMessage))")
    }

    private func removePartialExport() {
        try? exportFileHandle?.close()
        exportFileHandle = nil
        if let exportFileURL {
            try? FileManager.default.removeItem(at: exportFileURL)
        }
        exportFileURL = nil
    }

    private func showMissingResourcesAlert() {
        let alert = NSAlert()
        alert.messageText = "Mixroom could not load its app files."
        alert.informativeText = "Reinstall Mixroom and try again."
        alert.alertStyle = .critical
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
