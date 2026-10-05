#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  printf 'Usage: run-intel.sh /path/to/OpenPencil [document.fig]\n' >&2
  exit 64
fi

# Intel UHD 770 at 0000:00:02.0 on the local development host.
unset __NV_PRIME_RENDER_OFFLOAD __GLX_VENDOR_LIBRARY_NAME __VK_LAYER_NV_optimus
export DRI_PRIME=pci-0000_00_02_0
exec "$@"
