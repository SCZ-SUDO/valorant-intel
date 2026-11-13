import Cocoa
import WebKit

// 真实 WKWebView 里验证跑图：进入地图 → 出生点 → 模拟按键 → 断言碰撞
final class H: NSObject, WKNavigationDelegate {
    var web: WKWebView!
    var log: [String] = []

    func start() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let uc = WKUserContentController()
        uc.addUserScript(WKUserScript(source:
            "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push((e.message||'')+' @'+(e.lineno||0));});",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = uc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 1000), configuration: cfg)
        web.navigationDelegate = self
        let w = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1440, height: 1000),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.contentView = web
        w.orderBack(nil)
        let p = FileManager.default.currentDirectoryPath + "/web/index.html#maplab"
        web.load(URLRequest(url: URL(fileURLWithPath: p)))
    }

    func step(_ code: String, _ label: String, _ next: @escaping () -> Void) {
        web.evaluateJavaScript(code) { r, e in
            self.log.append(label + " " + (e == nil ? String(describing: r ?? "") : "ERR \(e!)"))
            next()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.run() }
    }

    // 用「执行计划」数组顺序推进，避免深层嵌套闭包
    var plan: [(String, String, Double)] = []
    var idx = 0

    func run() {
        plan = [
            ("typeof ML", "ML:", 0),
            ("JSON.stringify(ML.state())", "state:", 0),
            ("ML.map().zh+' calib='+ML.map().calib+' ok='+ML.map().calibrated", "map:", 0),
            ("JSON.stringify(ML.spawn('atk'))", "spawnAtk:", 0),
            ("JSON.stringify(ML.spawn('def'))", "spawnDef:", 0),
            ("document.getElementById('mlView').width+'x'+document.getElementById('mlView').height", "canvas:", 0),
            ("JSON.stringify([ML.state().px,ML.state().py])", "pos0:", 0),
            ("document.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}))", "pressW", 0.8),
            ("document.dispatchEvent(new KeyboardEvent('keyup',{key:'w'}))", "releaseW", 0),
            ("JSON.stringify([ML.state().px,ML.state().py])", "pos1:", 0),
            ("document.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}))", "pressW2", 2.5),
            ("document.dispatchEvent(new KeyboardEvent('keyup',{key:'w'}))", "releaseW2", 0),
            ("JSON.stringify([ML.state().px,ML.state().py])", "pos2:", 0),
            ("(function(){var s=ML.state(),m=ML.map();return ML.blocked(m.x0+(s.px-m.dx)*m.s,m.y0-(s.py-m.dy)*m.s);})()", "inSolid:", 0),
            ("JSON.stringify(window.__errs||[])", "errors:", 0)
        ]
        idx = 0
        nextStep()
    }

    func nextStep() {
        if idx >= plan.count {
            print(log.joined(separator: "\n"))
            NSApp.terminate(nil)
            return
        }
        let (code, label, wait) = plan[idx]
        idx += 1
        web.evaluateJavaScript(code) { r, e in
            if label != "pressW" && label != "pressW2" && label != "releaseW" && label != "releaseW2" {
                self.log.append(label + " " + (e == nil ? String(describing: r ?? "") : "ERR \(e!)"))
            }
            if wait > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { self.nextStep() }
            } else {
                self.nextStep()
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let h = H()
h.start()
app.run()
