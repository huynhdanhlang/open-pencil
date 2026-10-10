# OpenPencil Linux context patch

Owner: desktop runtime. Upstream Wry 0.57.0 crate SHA256:
`a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0`.
Original Apache/MIT licenses and source remain included.

Only `src/webkitgtk/web_context.rs` changes. Opt-in
`OPENPENCIL_WEBKIT_MEMORY_LIMIT_MB` configures a finite 1024–20480 MiB web-process
budget before creating either persistent or ephemeral WebContext. The embedding
app chooses its budget. Absence preserves upstream defaults; invalid input fails
startup. The explicit nonzero kill fraction is required because WebKitGTK 2.52.6
otherwise applies a separate 4 GiB inactive-process limit, regardless of the base
memory limit. Conservative/strict thresholds and polling retain WebKit defaults.
This does not change network-process policy, filesystem permissions or GPU choice.

Verify native constructor output and repeated document close/open, page, viewport,
export and save operations, including background MCP recovery. Remove this Cargo
patch and regenerate the lockfile to return to registry Wry; unset the opt-in in
the app launcher at the same time. Recheck this patch before upgrading Wry/WebKit.
