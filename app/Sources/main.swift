// 以下犯上 · VALORANT 情报终端 · macOS 原生外壳
// 一个内置本地静态服务的 WKWebView 容器：把网页装进真正的 .app，
// 双击即用、无浏览器边框、支持全屏、菜单栏与快捷键。

import Cocoa
import WebKit
import Network

// MARK: - 极简本地静态服务（仅监听 127.0.0.1）
// 为什么不用 file:// ：某些 WebGL / 凭据 / localStorage 场景在 file:// 下行为不一致，
// 用本地 http 源更接近真实浏览器环境，也便于地图 Key 做来源授权。
final class LocalServer {
    private var listener: NWListener?
    private var conns: [ObjectIdentifier: NWConnection] = [:]
    private var pending: [UInt16] = []
    private let root: URL
    private(set) var port: UInt16 = 0
    var onReady: ((UInt16) -> Void)?
    var onFail: (() -> Void)?

    init(root: URL) { self.root = root }

    func start(ports: [UInt16] = [8796, 8797, 8798, 8799, 8800]) {
        pending = ports
        tryNext()
    }

    private func tryNext() {
        guard !pending.isEmpty else { DispatchQueue.main.async { self.onFail?() }; return }
        let p = pending.removeFirst()
        guard let nwPort = NWEndpoint.Port(rawValue: p) else { tryNext(); return }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        // 只绑定回环地址，绝不监听 0.0.0.0
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: nwPort)
        guard let l = try? NWListener(using: params) else { tryNext(); return }
        listener = l
        l.stateUpdateHandler = { [weak self] st in
            guard let self = self else { return }
            switch st {
            case .ready:
                self.port = l.port?.rawValue ?? p
                DispatchQueue.main.async { self.onReady?(self.port) }
            case .failed, .cancelled:
                self.listener = nil
                if self.port == 0 { self.tryNext() }
            default:
                break
            }
        }
        l.newConnectionHandler = { [weak self] c in self?.handle(c) }
        l.start(queue: .global(qos: .userInitiated))
    }

    func stop() {
        listener?.cancel()
        listener = nil
        for (_, c) in conns { c.cancel() }
        conns.removeAll()
    }

    private func handle(_ c: NWConnection) {
        conns[ObjectIdentifier(c)] = c
        c.stateUpdateHandler = { [weak self] st in
            switch st {
            case .failed, .cancelled: self?.conns.removeValue(forKey: ObjectIdentifier(c))
            default: break
            }
        }
        c.start(queue: .global(qos: .userInitiated))
        c.receive(minimumIncompleteLength: 1, maximumLength: 32768) { [weak self] data, _, _, _ in
            guard let self = self else { return }
            guard let data = data, let head = String(data: data, encoding: .utf8) else {
                self.send(c, status: 400, type: "text/plain", body: Data()); return
            }
            let firstLine = head.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let parts = firstLine.split(separator: " ")
            var rawPath = parts.count > 1 ? String(parts[1]) : "/index.html"
            // 先拦截代理路由（必须在剥离 query 之前，否则参数会被吃掉）
            if rawPath.hasPrefix("/proxy?u=") {
                let target = String(rawPath.dropFirst("/proxy?u=".count)).removingPercentEncoding ?? ""
                self.proxy(c, target)
                return
            }
            var path = rawPath
            if let q = path.firstIndex(of: "?") { path = String(path[path.startIndex..<q]) }
            if path == "/" { path = "/index.html" }
            path = path.removingPercentEncoding ?? path
            if path.contains("..") { self.send(c, status: 403, type: "text/plain", body: Data()); return }
            let file = self.root.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
            guard let body = try? Data(contentsOf: file) else {
                self.send(c, status: 404, type: "text/plain", body: Data("404".utf8)); return
            }
            self.send(c, status: 200, type: Self.mime(file.pathExtension), body: body)
        }
    }

    private func send(_ c: NWConnection, status: Int, type: String, body: Data) {
        var h = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "ERR")\r\n"
        h += "Content-Type: \(type)\r\n"
        h += "Content-Length: \(body.count)\r\n"
        h += "Cache-Control: no-store\r\n"
        h += "Connection: close\r\n\r\n"
        var out = Data(h.utf8)
        out.append(body)
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }

    private func proxy(_ c: NWConnection, _ target: String) {
        // 只允许 https，或本机回环的 http（地图图就在 App 自己的资源里）
        guard let u = URL(string: target),
              u.scheme == "https" || (u.scheme == "http" && (u.host == "127.0.0.1" || u.host == "localhost")) else {
            self.send(c, status: 400, type: "text/plain", body: Data("bad url".utf8)); return
        }
        var req = URLRequest(url: u)
        req.timeoutInterval = 40
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        req.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            guard let data = data, err == nil else {
                self.send(c, status: 502, type: "text/plain; charset=utf-8",
                          body: Data("上游错误：\(err?.localizedDescription ?? "empty")".utf8)); return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 200
            let ct = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "text/html; charset=utf-8"
            self.send(c, status: code, type: ct, body: data)
        }.resume()
    }

    private static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "application/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "svg":         return "image/svg+xml"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "md", "txt":   return "text/plain; charset=utf-8"
        default:            return "application/octet-stream"
        }
    }
}

// MARK: - 应用
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    let server: LocalServer
    let webRoot: URL
    /// 彩蛋菜单项（默认隐藏，网页解锁彩蛋后才显示）
    var eggMenuItems: [NSMenuItem] = []

    override init() {
        let res = Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")
        webRoot = res.appendingPathComponent("web")
        server = LocalServer(root: webRoot)
        super.init()
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()

        if FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path) {
            server.onReady = { [weak self] port in
                guard let self = self else { return }
                self.load("http://127.0.0.1:\(port)/index.html")
            }
            server.onFail = { [weak self] in
                // 起不来就退回 file://，功能不受影响
                guard let self = self else { return }
                let f = self.webRoot.appendingPathComponent("index.html")
                self.webView.loadFileURL(f, allowingReadAccessTo: self.webRoot)
            }
            server.start()
        } else {
            webView.loadHTMLString("<h2 style='font:16px -apple-system'>缺少网页资源 index.html</h2>", baseURL: nil)
        }
        NSApp.activate(ignoringOtherApps: false)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ note: Notification) { server.stop() }

    // ---------------- 窗口 ----------------
    private func buildWindow() {
        let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 940),
                          styleMask: style, backing: .buffered, defer: false)
        window.title = "以下犯上 · VALORANT 情报终端"
        window.minSize = NSSize(width: 1120, height: 720)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.setFrameAutosaveName("ValorantIntelMainWindow")
        if window.frame.origin == .zero { window.center() }

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                     // 持久化 localStorage（记住地图 Key）
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let ucc = WKUserContentController()
        ucc.add(self, name: "log")
        ucc.add(self, name: "app")   // 网页 → 外壳（彩蛋解锁等）
        ucc.addUserScript(WKUserScript(source: Self.errorHook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: "window.__NATIVE_HOST__ = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc

        webView = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 13.3, *) { webView.isInspectable = true }   // 右键「检查元素」（公开 API）

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    private func load(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        webView.load(URLRequest(url: url))
    }

    // 网页里的 JS 错误回传到 stderr，便于排查
    static let errorHook = """
    window.addEventListener('error', function(e){
      try{ window.webkit.messageHandlers.log.postMessage('JS错误: '+(e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||0)); }catch(_){}
    });
    window.addEventListener('unhandledrejection', function(e){
      try{ window.webkit.messageHandlers.log.postMessage('未处理Promise: '+e.reason); }catch(_){}
    });
    """
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "log" {
            FileHandle.standardError.write(Data((String(describing: message.body) + "\n").utf8))
            return
        }
        if message.name == "app" {
            let body = message.body as? [String: Any]
            let type = body?["type"] as? String
            if type == "fetch" {
                let url = body?["url"] as? String ?? ""
                let reqId = body?["reqId"] as? String ?? ""
                proxyFetch(url: url, reqId: reqId)
            }
        }
    }

    // ---------------- 联网代理 ----------------
    // 网页是从 127.0.0.1 加载的，直接 fetch 外部站点会被 CORS 拦掉。
    // 所以由外壳用 URLSession 去取，再把文本回灌给页面。
    private func proxyFetch(url: String, reqId: String) {
        guard let u = URL(string: url), u.scheme == "https" else {
            replyFetch(reqId, ok: false, body: "无效地址")
            return
        }
        var req = URLRequest(url: u)
        req.timeoutInterval = 25
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
                     forHTTPHeaderField: "User-Agent")
        req.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            if let err = err {
                self.replyFetch(reqId, ok: false, body: "网络错误：" + err.localizedDescription)
                return
            }
            guard let data = data else {
                self.replyFetch(reqId, ok: false, body: "空响应")
                return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                self.replyFetch(reqId, ok: false, body: "HTTP \(code)")
                return
            }
            let text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
                ?? ""
            self.replyFetch(reqId, ok: true, body: text)
        }.resume()
    }

    private func replyFetch(_ reqId: String, ok: Bool, body: String) {
        // 用 JSON 数组包一层做安全转义，再取内层（含引号）直接嵌进 JS 字面量
        let safeId = reqId.filter { $0.isLetter || $0.isNumber }
        let data = (try? JSONSerialization.data(withJSONObject: [body])) ?? Data("[\"\"]".utf8)
        let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
        let inner = String(arr.dropFirst().dropLast())
        let jsCode = "window.__valorFetchDone && window.__valorFetchDone(\"\(safeId)\", \(ok ? "true" : "false"), \(inner));"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(jsCode, completionHandler: nil)
        }
    }

    // ---------------- 与网页通信 ----------------
    @discardableResult
    private func js(_ code: String) -> Bool {
        guard webView != nil else { return false }
        webView.evaluateJavaScript(code, completionHandler: nil)
        return true
    }

    // ---------------- 菜单 ----------------
    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 以下犯上", action: #selector(showAbout), keyEquivalent: "")
            .target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 以下犯上", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 以下犯上", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // 导航
        let navItem = NSMenuItem()
        let navMenu = NSMenu(title: "导航")
        let navs: [(String, String)] = [
            ("总览", "home"), ("赛程", "matches"), ("预测", "predict"),
            ("情报", "intel"), ("数据库", "db"),
        ]
        for (title, key) in navs {
            let mi = NSMenuItem(title: title, action: #selector(actNav(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = key
            navMenu.addItem(mi)
        }
        navMenu.addItem(.separator())
        let searchItem = NSMenuItem(title: "全局检索…", action: #selector(actSearch), keyEquivalent: "k")
        searchItem.target = self
        navMenu.addItem(searchItem)
        navItem.submenu = navMenu
        main.addItem(navItem)

        // 视图
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        let z = [
            ("放大", #selector(actZoomIn), "+"),
            ("缩小", #selector(actZoomOut), "-"),
            ("实际大小", #selector(actZoomReset), "0"),
        ]
        for (title, sel, key) in z {
            let mi = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            mi.target = self; viewMenu.addItem(mi)
        }
        viewMenu.addItem(.separator())
        let fs = NSMenuItem(title: "全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.control, .command]
        fs.target = nil
        viewMenu.addItem(fs)
        let rl = NSMenuItem(title: "重新载入页面", action: #selector(actReload), keyEquivalent: "r")
        rl.keyEquivalentModifierMask = [.command, .shift]
        rl.target = self
        viewMenu.addItem(rl)
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        // 窗口
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        main.addItem(winItem)

        // 帮助
        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: "帮助")
        let h1 = NSMenuItem(title: "使用说明", action: #selector(actHelp), keyEquivalent: "?")
        h1.target = self
        helpMenu.addItem(h1)
        helpItem.submenu = helpMenu
        main.addItem(helpItem)

        NSApp.mainMenu = main
    }

    @objc private func showAbout() {
        let a = NSAlert()
        a.messageText = "以下犯上 · VALORANT 情报终端"
        a.informativeText = """
        版本 2.0 · macOS 原生版

        一块无畏契约赛事情报终端：赛后档案、赛前推演、转会与赛事新闻，
        都在同一个数据库里。界面语言承自《源能行动》。

        · 赛程 —— 待赛与 2020 年以来的 3.2 万场赛果
        · 预测 —— ELO + 状态 + 交手的逻辑回归，带 2026 留出集回测
        · 情报 —— vlr.gg 新闻流，人工中文编译
        · 数据库 —— 3,900 名选手 / 5,300 支战队 / 逐图选手数据

        赛果与选手数据来自公开资料，预测为统计推断，仅供分析参考。
        """
        a.addButton(withTitle: "好")
        a.runModal()
    }
    @objc private func actNav(_ sender: NSMenuItem) {
        let key = (sender.representedObject as? String) ?? "home"
        js("location.hash = '#\(key)';")
    }
    @objc private func actSearch() { js("document.getElementById('searchTrigger').click();") }
    @objc private func actReload()   { webView.reload() }
    @objc private func actZoomIn()   { webView.pageZoom = min(2.4, webView.pageZoom + 0.1) }
    @objc private func actZoomOut()  { webView.pageZoom = max(0.6, webView.pageZoom - 0.1) }
    @objc private func actZoomReset() { webView.pageZoom = 1.0 }
    @objc private func actHelp() {
        let md = Bundle.main.resourceURL?.appendingPathComponent("使用说明.md")
        if let md = md, FileManager.default.fileExists(atPath: md.path) {
            NSWorkspace.shared.open(md)
        } else {
            NSWorkspace.shared.open(URL(string: "https://www.apple.com")!)
        }
    }

    // ---------------- 彩蛋菜单项的显隐 ----------------
    /// 网页解锁彩蛋后才调用：把隐藏的菜单项放出来
    private func revealEggMenuItem() {
        DispatchQueue.main.async { [weak self] in
            self?.eggMenuItems.forEach { $0.isHidden = false }
        }
    }
    /// 重新载入页面后彩蛋状态会重置，菜单项也要跟着藏回去
    private func hideEggMenuItem() {
        eggMenuItems.forEach { $0.isHidden = true }
    }
    /// 每次页面（重新）载入后彩蛋状态都会从零开始，菜单项也要跟着藏回去
    func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
        hideEggMenuItem()
    }
}

// MARK: - 入口
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
