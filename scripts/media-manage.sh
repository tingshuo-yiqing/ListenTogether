#!/usr/bin/env bash
# 一起听歌 · 云端曲库管理脚本（在服务器上以 root 执行）
# 部署位置：/opt/listen-together/bin/media-manage.sh（releases 之外的持久层，升级不覆盖）
#
# 用法：
#   media-manage.sh has <id>                            检查 id 是否已在 catalog（exit 0=存在 / 1=不存在）
#   media-manage.sh install <id> </tmp/x.mp3> [manifest] 安装上传的临时文件：
#                                                        旧 id → 按 catalog 映射的文件名原位替换（先把当前文件备份到 media-originals/<时间戳>/）
#                                                        新 id → 需要 manifest（内容一行：id<TAB>中文标题），按"<标题>.mp3"落盘并追加 catalog 条目
#   media-manage.sh verify                              用与后端相同的 music-metadata 解析 catalog，输出时长/大小/码率
#   media-manage.sh list                                输出 catalog.json 内容
#
# 设计约束：中文（标题/文件名）只允许在脚本文件与 manifest 文件内容里流转，
# 绝不出现在任何命令行参数里（Windows 侧 ssh/scp 传中文参数会因代码页转换乱码）。
# 上传方（scripts/add-media.ps1）统一用 ASCII 临时名 /tmp/lt-up-<id>.mp3。
set -euo pipefail

MEDIA_DIR="${MEDIA_DIR:-/opt/listen-together/media}"
CATALOG="$MEDIA_DIR/catalog.json"
BACKUP_ROOT="/opt/listen-together/media-originals"
SERVER_DIR="/opt/listen-together/server"

die() { echo "ERROR: $*" >&2; exit 1; }

require_catalog() { [ -f "$CATALOG" ] || die "catalog.json 不存在：$CATALOG"; }

# 用 node 从 catalog.json 取指定 id 的 file 字段（JSON 转义交给解析器，不做 bash 字符串拼接）
catalog_file_of() {
  node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const e=a.find(x=>x.id===process.argv[1]);process.stdout.write(e?e.file:"")' "$1" "$CATALOG"
}

cmd="${1:-}"
[ -n "$cmd" ] || die "缺少子命令：has | install | verify | list"

case "$cmd" in
  has)
    id="${2:-}"
    require_catalog
    [ -n "$id" ] || die "缺少 id"
    f="$(catalog_file_of "$id")"
    if [ -n "$f" ]; then exit 0; else exit 1; fi
    ;;
  list)
    require_catalog
    cat "$CATALOG"
    ;;
  verify)
    # 在 server 目录下执行以便 require 到后端同款 music-metadata
    cd "$SERVER_DIR"
    node -e '
      const path = require("path");
      const fs = require("fs");
      const { parseFile } = require("music-metadata");
      (async () => {
        const dir = process.argv[1];
        const entries = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8"));
        for (const e of entries) {
          const p = path.join(dir, e.file);
          const st = fs.statSync(p);
          const md = await parseFile(p, { duration: true });
          const dur = md.format.duration || 0;
          const kbps = dur > 0 ? Math.round(st.size * 8 / dur / 1000) : 0;
          console.log(`${e.id} | ${e.title} | ${e.file} | ${dur.toFixed(1)}s | ${(st.size / 1048576).toFixed(2)}MiB | ${kbps}kbps`);
        }
      })().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
    ' "$MEDIA_DIR"
    ;;
  install)
    id="${2:-}"; tmp="${3:-}"; manifest="${4:-}"
    require_catalog
    echo "$id" | grep -Eq '^[a-zA-Z0-9_-]{1,64}$' || die "非法 id：$id"
    case "$tmp" in /tmp/*) ;; *) die "临时文件必须在 /tmp 下：$tmp" ;; esac
    [ -f "$tmp" ] || die "临时文件不存在：$tmp"
    f="$(catalog_file_of "$id")"
    if [ -n "$f" ]; then
      # 已有歌曲：按 catalog 映射的文件名原位替换，先备份当前文件
      src="$MEDIA_DIR/$f"
      [ -f "$src" ] || die "catalog 指向的文件不存在：$src"
      stamp="$(date +%Y%m%d-%H%M%S)"
      bdir="$BACKUP_ROOT/$stamp"
      mkdir -p "$bdir"
      cp -a "$src" "$bdir/"
      mv -f "$tmp" "$src"
      chown root:listen "$src" 2>/dev/null || true
      chmod 644 "$src"
      echo "REPLACED id=$id file=$f backup=$bdir"
    else
      # 新歌：需要 manifest，标题/文件名只在文件内容里流转
      [ -n "$manifest" ] || die "catalog 中无 id=$id，新增歌曲需要 manifest 参数"
      [ -f "$manifest" ] || die "manifest 不存在：$manifest"
      mid="$(cut -f1 "$manifest")"
      mtitle="$(cut -f2 "$manifest")"
      [ "$mid" = "$id" ] || die "manifest 的 id(${mid}) 与参数(${id}) 不一致"
      [ -n "$mtitle" ] || die "manifest 缺少标题列"
      case "$mtitle" in *[/\\]*) die "标题包含路径分隔符，拒绝安装" ;; esac
      file="${mtitle}.mp3"
      [ -e "$MEDIA_DIR/$file" ] && die "目标文件已存在：$file"
      mv -f "$tmp" "$MEDIA_DIR/$file"
      chown root:listen "$MEDIA_DIR/$file" 2>/dev/null || true
      chmod 644 "$MEDIA_DIR/$file"
      node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(a.some(e=>e.id===process.argv[2])){console.error("ERROR: id 已存在");process.exit(1)}a.push({id:process.argv[2],title:process.argv[3],file:process.argv[4]});fs.writeFileSync(process.argv[1],JSON.stringify(a,null,2)+"\n")' "$CATALOG" "$id" "$mtitle" "$file"
      echo "ADDED id=$id file=$file title=$mtitle"
    fi
    rm -f "${tmp}.manifest" 2>/dev/null || true
    ;;
  *)
    die "未知子命令：$cmd（支持 has | install | verify | list）"
    ;;
esac
