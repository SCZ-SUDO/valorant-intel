#!/bin/zsh
# 以下犯上 · VALORANT 情报终端 · macOS 一键构建
# 用法：./build.sh [--run] [--install] [--dmg]
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$SRC/.." && pwd)"
DIST="$SRC/dist"
APP="$DIST/以下犯上.app"
BIN="$APP/Contents/MacOS/valorarchive"
ICNS="$SRC/AppIcon.icns"
SWIFTC="swiftc"
command -v swiftc >/dev/null 2>&1 || { echo "找不到 swiftc，请先安装 Xcode / Command Line Tools"; exit 1; }

echo "▸ 清理旧产物"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "▸ 编译原生外壳"
OUT=$("$SWIFTC" -O -swift-version 5 -disable-sandbox \
  -framework AppKit -framework WebKit -framework Network \
  "$SRC"/Sources/*.swift -o "$BIN" 2>&1); RC=$?
if [ $RC -ne 0 ]; then echo "$OUT"; echo "编译失败"; exit $RC; fi

echo "▸ 塞入网页资源"
rm -rf "$APP/Contents/Resources/web"
cp -R "$PROJ/web" "$APP/Contents/Resources/web"
[ -f "$PROJ/使用说明.md" ] && cp "$PROJ/使用说明.md" "$APP/Contents/Resources/使用说明.md"
[ -d "$PROJ/docs" ] && cp -R "$PROJ/docs" "$APP/Contents/Resources/docs"
echo "  资源 $(find "$APP/Contents/Resources/web" -type f | wc -l | tr -d ' ') 个文件"

echo "▸ 图标"
cp "$ICNS" "$APP/Contents/Resources/AppIcon.icns"

echo "▸ Info.plist"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"

echo "▸ 签名（ad-hoc）"
codesign --force --deep --sign - "$APP" 2>/dev/null
codesign --verify --deep --strict "$APP" && echo "  签名有效"
xattr -cr "$APP" 2>/dev/null || true

if [[ "$*" == *"--install"* ]]; then
  echo "▸ 安装到 /Applications"
  rm -rf "/Applications/以下犯上.app"
  cp -R "$APP" "/Applications/以下犯上.app"
  xattr -cr "/Applications/以下犯上.app" 2>/dev/null || true
fi

if [[ "$*" == *"--dmg"* ]]; then
  echo "▸ 打包 DMG"
  STAGE="/tmp/vintel_dmg_stage"
  OUTDIR="${VINTEL_DMG_OUT:-$DIST}"
  PKG="以下犯上——VALORANT情报终端"
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/以下犯上.app"
  ln -sfn /Applications "$STAGE/Applications"
  [ -f "$PROJ/使用说明.md" ] && cp "$PROJ/使用说明.md" "$STAGE/使用说明.md"
  [ -d "$PROJ/docs" ] && cp -R "$PROJ/docs" "$STAGE/docs"
  mkdir -p "$OUTDIR"
  rm -f "$OUTDIR/$PKG.dmg"
  hdiutil create -volname "以下犯上" -srcfolder "$STAGE" -ov -format UDZO "$OUTDIR/$PKG.dmg" >/dev/null
  hdiutil verify "$OUTDIR/$PKG.dmg" | tail -1
  rm -rf "$STAGE"
  echo "  已生成：$OUTDIR/$PKG.dmg"
fi

if [[ "$*" == *"--run"* ]]; then open "$APP"; fi
echo "✅ 完成：$APP"
