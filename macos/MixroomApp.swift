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
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.prompt = "Add Tracks"

        guard panel.runModal() == .OK else {
            completionHandler(nil)
            return
        }
        completionHandler(panel.urls)
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
