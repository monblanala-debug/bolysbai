#!/usr/bin/env bash
# Ночная копия базы и фото. Ставится в cron из install.sh, хранит 14 последних дней.
set -euo pipefail
DATA_DIR=/var/lib/cargo151
OUT=/var/backups/cargo151
DAY=$(date +%F)
mkdir -p "$OUT/$DAY" && rm -f "$OUT/$DAY/cargo151.db"
# VACUUM INTO делает целую копию даже пока сайт работает.
node -e "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec(\"VACUUM INTO '\" + process.argv[2] + \"'\")" \
  "$DATA_DIR/cargo151.db" "$OUT/$DAY/cargo151.db" 2>/dev/null
# Фото не меняются, поэтому копируем жёсткими ссылками на вчерашние: места почти не занимает.
PREV=$(ls -1d "$OUT"/20* 2>/dev/null | grep -v "$DAY" | tail -1 || true)
rsync -a --delete ${PREV:+--link-dest="$PREV/photos"} "$DATA_DIR/photos/" "$OUT/$DAY/photos/"
ls -1d "$OUT"/20* | head -n -14 | xargs -r rm -rf
