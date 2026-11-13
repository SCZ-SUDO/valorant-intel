import Cocoa
import WebKit

final class H: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    func start() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let uc = WKUserContentController()
        uc.add(self, name: "app")
        cfg.userContentController = uc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 1000), configuration: cfg)
        web.navigationDelegate = self
        let w = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1440, height: 1000),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.contentView = web
        w.orderBack(nil)
        let p = FileManager.default.currentDirectoryPath + "/web/index.html"
        web.load(URLRequest(url: URL(fileURLWithPath: p)))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            print("news before:", self.jsSync("__VINTEL__.news().length"))
            self.js("document.getElementById('refreshBtn').click();")
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                print("news after:", self.jsSync("JSON.stringify({n:__VINTEL__.news().length,first:__VINTEL__.news()[0].title,date:__VINTEL__.news()[0].date})"))
                print("toast:", self.jsSync("document.getElementById('toast').textContent"))
                NSApp.terminate(nil)
            }
        }
    }
    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }
    func jsSync(_ code: String) -> String {
        var out = "", done = false
        web.evaluateJavaScript(code) { r, e in
            out = e == nil ? String(describing: r ?? "") : "ERR \(e!)"
            done = true
        }
        while !done { RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05)) }
        return out
    }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "app", let b = message.body as? [String: Any],
              b["type"] as? String == "fetch", let urlS = b["url"] as? String,
              let rid = b["reqId"] as? String, let u = URL(string: urlS) else { return }
        var req = URLRequest(url: u); req.timeoutInterval = 25
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, _, err in
            let ok = err == nil && data != nil
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? (err?.localizedDescription ?? "ERR")
            let arr = (try? JSONSerialization.data(withJSONObject: [body])) ?? Data("[\"\"]".utf8)
            let s = String(data: arr, encoding: .utf8) ?? "[\"\"]"
            let inner = String(s.dropFirst().dropLast())
            let js = "window.__valorFetchDone && window.__valorFetchDone(\"\(rid)\", \(ok ? "true" : "false"), \(inner));"
            DispatchQueue.main.async { self.web.evaluateJavaScript(js, completionHandler: nil) }
        }.resume()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let h = H()
h.start()
app.run()
