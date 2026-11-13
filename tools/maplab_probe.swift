import Cocoa
import WebKit

// 在真实 WKWebView 里载入跑图页，读取画布像素与相机状态（离屏渲染不跑 rAF，用 ML API 手动驱动）
let args = CommandLine.arguments
let urlStr = args.count > 1 ? args[1] : "file://\(FileManager.default.currentDirectoryPath)/web/index.html#maplab"

final class Probe: NSObject, WKNavigationDelegate {
    var web: WKWebView!
    var lines: [String] = []
    func start() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 1000), configuration: cfg)
        web.navigationDelegate = self
        let w = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1440, height: 1000),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.contentView = web
        w.orderBack(nil)
        web.load(URLRequest(url: URL(string: urlStr)!))
    }
    func js(_ code: String, _ tag: String, done: @escaping (Any?) -> Void) {
        web.evaluateJavaScript(code) { r, e in
            self.lines.append("\(tag): " + (e == nil ? String(describing: r ?? "nil") : "ERR \(e!)"))
            done(r)
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.probe() }
    }
    var steps: [(String, String)] = []
    var i = 0
    func probe() {
        let px = "(function(){var v=document.getElementById('mlView');if(!v)return 'noview';var g=v.getContext('2d');var d=g.getImageData(0,0,v.width,v.height).data;var n=0;for(var k=3;k<d.length;k+=4){if(d[k]>10)n++;}return n;})()"
        steps = [
            ("typeof ML", "ML"),
            ("JSON.stringify(ML.state())", "state"),
            (px, "nonEmptyBefore"),
            ("ML.press('w',true)", "pressW"),
            ("for(var k=0;k<20;k++){ML.advance(16);}", "walk20"),
            ("ML.press('w',false)", "releaseW"),
            ("JSON.stringify(ML.state())", "stateAfterWalk"),
            ("(function(){var s=ML.state(),m=ML.map();return ML.blocked(m.x0+(s.px-m.dx)*m.s,m.y0-(s.py-m.dy)*m.s);})()", "inSolid"),
            (px, "nonEmptyAfter"),
            ("document.getElementById('mlZone').textContent", "zone")
        ]
        i = 0
        runNext()
    }
    func runNext() {
        if i >= steps.count {
            print(lines.joined(separator: "\n"))
            NSApp.terminate(nil)
            return
        }
        let (code, tag) = steps[i]
        i += 1
        web.evaluateJavaScript(code) { r, e in
            self.lines.append(tag + ": " + (e == nil ? String(describing: r ?? "nil") : "ERR \(e!)"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.runNext() }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let p = Probe()
p.start()
app.run()
