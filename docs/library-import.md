# Library import and file repair

The Import page (`/import`) supports movies and TV. Paths refer to the filesystem
visible to the Magpie server, including inside a container.

## Adopt an existing collection

1. Open **Import existing library** from Movies or Series.
2. Select the media kind and scan the collection's root folder. Each title must have
   its own direct child folder; season subfolders are supported.
3. Choose metadata matches, quality profiles and the files to register. Correct
   quality, languages and release names where filenames are incomplete.
4. For TV, click **Review changes** to load suggested episode mappings. Correct
   unresolved mappings using the episode selector, then review again.
5. Click **Import selected files**.

Adoption registers files at their existing paths. It does not move or rename them.
The root is registered automatically when committing. Repeated adoption reuses
matching items and file records. Movies support one main file per title; deselect
alternate copies. A title already registered at another location requires review
rather than silently changing its folder.

New titles default to unmonitored. If monitoring is selected, it is enabled after
all selected files for that title are registered. Adding a title during adoption
does not immediately search for downloads.

## Rescan and repair registered files

Use **Rescan files** on a movie or series detail page. A daily background job also
scans registered movie and TV folders. Recognized files are registered or updated;
conflicts and unresolved files remain in the saved scan for review.

Missing records are preserved by default. In a manual rescan, select **Remove
missing file records** to remove records only after checking their paths again.
An unavailable folder or incomplete directory traversal fails the scan and does
not remove records. Rescanning never deletes media files.

Use **Repair files** to edit quality, language, release information or TV episode
assignments in place. Choose the episodes actually contained in each file. Repair
updates records without transferring or deleting files.

## Manual import and failed downloads

Choose **Manual import**, enter a source folder, and assign each selected file to
a library item. TV files may cover multiple episodes. Review the generated paths
and conflicts before importing.

Transfer options:

- **Hardlink:** preserve the source for seeding; copy if linking is unsupported.
- **Copy:** preserve the source.
- **Move:** copy to the destination first, commit the file records, then remove
  the unchanged source.

Existing destinations and conflicting library files require the replacement
checkbox. Incoming files are staged first. A previous destination is retained
until the new file and records are in place, then handled by the configured
recycle bin. A multi-episode file still serving other episodes is preserved.

Open **Repair import** from Activity, or **Review files** under Failed imports on
the Import page. Unmatched files remain visible. A download is marked imported
only when every discovered media file in its repair session has been completed.

## Resume failures

Saved scan sessions and per-file outcomes persist in SQLite. Select a saved scan
from **Resume scan**, review pending changes, and import again. Completed files
are not transferred twice. A staged or placed file resumes at that step after a
recording or cleanup failure. Changed source files require a fresh scan; a move
source changed after staging is preserved for repair.

Scanning skips samples, extras and symbolic-link entries, and refuses traversal
beyond 32 directory levels. Unsupported metadata/scene numbering remains a manual
assignment rather than a guessed match. This feature does not migrate Radarr or
Sonarr databases, profiles or application settings.
