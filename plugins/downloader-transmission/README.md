# Transmission download client

Add **Transmission** under Settings → Download clients. Requires Transmission 3.0 or newer with RPC enabled. The default RPC URL is `http://localhost:9091/transmission/rpc`; set the full URL when using a different host, port, or reverse proxy. Credentials are optional when RPC authentication is disabled.

The category is a Transmission label (default `magpie`). Only torrents carrying that label appear in Magpie's download queue. Use a distinct label for each configured instance pointing at the same daemon. Lower priority numbers are preferred among torrent clients.

The optional download directory is a path on the Transmission host. Leave it empty to use Transmission's default. Magpie must be able to access the reported completed files for importing.

Supports magnets, torrent files, paused submissions, progress monitoring, and removal with optional file deletion. Retries reuse torrents with the configured label. An existing torrent outside that label is rejected rather than relabeled.

Uses the legacy RPC protocol supported by Transmission 3 and 4, including session-token negotiation and renewal. A future Transmission release removing that protocol will require an adapter update.
