import Cocoa
import WebKit

let args = CommandLine.arguments
let urlStr = args.count > 1 ? args[1] : "file://\(FileManager.default.currentDirectoryPath)/web/index.html"
let out = args.count > 2 ? args[2] : "/tmp/snap.png"
let w = args.count > 3 ? Int(args[3]) ?? 1440 : 1440
let h = args.count > 4 ? Int(args[4]) ?? 1000 : 1000

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

final class D: NSObject, WKNavigationDelegate {
    var web: WKWebView!
    var win: NSWindow!
    func start() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let uc = WKUserContentController()
        uc.addUserScript(WKUserScript(source: "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push((e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||0));});window.addEventListener('unhandledrejection',function(e){window.__errs.push('REJ '+e.reason);});", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = uc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: cfg)
        web.navigationDelegate = self
        win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: w, height: h),
                       styleMask: [.borderless], backing: .buffered, defer: false)
        win.contentView = web
        win.orderBack(nil)
        web.load(URLRequest(url: URL(string: urlStr)!))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("(function(){window.__im=new Image();window.__im.onload=function(){window.__imok='ok '+window.__im.naturalWidth};window.__im.onerror=function(){window.__imok='ERR'};window.__im.src='assets/img/maps/ascent-display.png';})()") { _,_ in }
        DispatchQueue.main.asyncAfter(deadline: .now() + 11.0) {
            webView.evaluateJavaScript("JSON.stringify({errs:window.__errs||[],bootErr:window.__bootErr||'-',len:document.getElementById('view').innerHTML.length,vi:(function(){var e=document.querySelector('.view-inner');if(!e)return null;var c=getComputedStyle(e);var r=e.getBoundingClientRect();return {op:c.opacity,tr:c.transform,disp:c.display,r:[r.x,r.y,r.width,r.height],sh:document.getElementById('view').scrollHeight}})(),body:getComputedStyle(document.body).backgroundColor,ml:(window.__ML_LOADED?'loaded':'NOT'), cv:(function(){var v=document.getElementById('mlView');return v? v.width+'x'+v.height : 'none';})(),phase:(window.__dbg2||'-'), frames:window.__frames||0, drawn:window.__drawn||0, dc:window.__drawCalls||0, raf:typeof requestAnimationFrame, visible:document.visibilityState, mlv:(window.ML&&ML.state?ML.state().slug:'-'), lastView:window.__lastView||'-', lastCtx:window.__lastCtx||'-',q:location.search,dc:document.getElementById('drawer').className,ds:(function(){var d=document.getElementById('drawer'),c=getComputedStyle(d),r=d.getBoundingClientRect();return{op:c.opacity,vis:c.visibility,z:c.zIndex,r:[r.x,r.y,r.width,r.height]}})()})") { r, e in
                print("STATE \(String(describing: r)) \(String(describing: e))")
            }
            let c = WKSnapshotConfiguration()
            c.rect = NSRect(x: 0, y: 0, width: w, height: h)
            webView.takeSnapshot(with: c) { img, err in
                if let img = img, let tiff = img.tiffRepresentation,
                   let rep = NSBitmapImageRep(data: tiff),
                   let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: out))
                    // 检查主画布是否真的画了东西（抽样中心像素）
                    DispatchQueue.main.async {
                        webView.evaluateJavaScript("(function(){var v=document.getElementById('mlView');if(!v)return 'noview';var g=v.getContext('2d');var d=g.getImageData(Math.floor(v.width/2)-20,Math.floor(v.height/2)-20,40,40).data;var nz=0,sum=0;for(var i=0;i<d.length;i+=4){if(d[i+3]>0&&(d[i]+d[i+1]+d[i+2])>30)nz++;sum+=d[i];}return 'nonEmpty='+nz+'/1600 avgR='+Math.round(sum/1600)})()") { r2, e2 in
                            print("CANVAS", String(describing: r2), String(describing: e2))
                            print("OK \(out) \(png.count)")
                            NSApp.terminate(nil)
                        }
                    }
                } else {
                    print("FAIL \(String(describing: err))")
                }
                NSApp.terminate(nil)
            }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("NAVFAIL \(error)"); NSApp.terminate(nil)
    }
}
let d = D()
d.start()
app.run()
