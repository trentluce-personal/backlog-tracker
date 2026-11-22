# UI copy preference

Avoid unrequested descriptive or helper UI prose, especially in panels. Concise
labels and actions suffice. Preserve user-authored data descriptions, validation
errors, required status announcements, and accessibility messages.

## Browser and UI verification

Attach only to the user's already-running app at its actual URL. If the app is
not running or the URL is unknown, ask the owner to start it or provide the URL,
as needed, or report browser verification as blocked. Never start, restart, or
stop an app for browser work, use PowerShell or another app launcher, provision
databases or model files, or select alternate ports to make a review target.

Treat the user's app data as read-only. Nonpersisting UI interactions are fine;
do not seed, create, edit, save, delete, change status, or otherwise mutate app
data through the UI, API, or storage. Mark scenarios that require a write as
blocked. Use your own named session with the pinned browser CLI, close only
that session, and keep private data out of artifacts. See
[Browser verification](README.md#browser-verification). Owner startup and
maintenance and automated native test fixtures are separate workflows.
