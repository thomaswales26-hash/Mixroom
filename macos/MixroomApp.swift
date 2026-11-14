import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
    private var window: NSWindow?

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
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView

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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
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
