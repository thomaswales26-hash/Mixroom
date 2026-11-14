import AppKit
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var window: NSWindow?
    private weak var webView: WKWebView?

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

        let webView = WKWebView(frame: .zero)
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
        let alert = NSAlert()
        alert.messageText = "Mixroom's audio page stopped."
        alert.informativeText = "It may have run out of memory. The page restarted, so imported tracks were cleared. Import fewer or shorter tracks, and keep WAV exports under 20 minutes."
        alert.alertStyle = .warning
        alert.runModal()
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
