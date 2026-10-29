#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
/bin/bash "$ROOT/start-macos.sh" "$@"
status=$?
if [ "$status" -ne 0 ]; then
  printf '\n启动失败。请保留上面的错误信息。按回车关闭。\n'
  read -r ignored
fi
exit "$status"
