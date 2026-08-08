#!/bin/sh
# Double-click this to put an Architecture Design icon on your desktop.
# It installs what is needed, builds the application, and creates the icon.
#
# Named .command because that is what macOS will run from a double-click.
# Linux desktops run it too, though most will ask whether to run or open it.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed, or is not on the PATH."
  echo
  echo "  Install it from https://nodejs.org (the LTS version), then"
  echo "  double-click this file again."
  echo
  printf "  Press Return to close. "
  read -r _
  exit 1
fi

node "tools/setup-desktop.mjs"
status=$?

echo
printf "  Press Return to close. "
read -r _
exit $status
