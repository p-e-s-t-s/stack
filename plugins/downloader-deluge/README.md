# Deluge download client

Add **Deluge** under Settings → Download clients. Use the Deluge Web UI URL (default `http://localhost:8112`) and its Web UI password. Reverse-proxy paths and URLs ending in `/json` are supported.

Enable Deluge's built-in **Label** plugin in Preferences → Plugins. Magpie creates its configured category label when testing or adding downloads. Labels must use lowercase letters, numbers, underscores or hyphens. Only torrents with that label are monitored or removed.

Connect the Web UI to the desired daemon. If disconnected, Magpie reconnects to the only configured daemon, or the daemon selected by the optional host ID. With multiple configured daemons, set the host ID or connect through the Web UI first. The Web UI connection is shared: Magpie refuses to switch an existing connection to a different configured daemon.

Supports magnet links, torrent files, paused submissions, progress monitoring, and removal with optional file deletion. Lower priority numbers are preferred among torrent clients. An optional download directory is interpreted on the Deluge host. Magpie needs access to the reported completed files for importing.

New torrents are added paused, labeled, and then resumed unless paused was requested. Existing torrents outside the configured label are rejected. Label or resume failures can be retried while Magpie is running; if Magpie restarts after adding but before labeling, assign the category label in Deluge before retrying. Existing label settings, including moving completed files, still apply.

Targets Deluge 2.x using its Web JSON-RPC API. Authentication sessions renew on expiration. Daemon credentials remain in the Web UI's host configuration.
