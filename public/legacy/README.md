# Legacy Frontend Layer

These files are kept only for backward compatibility with the old all-in-one homepage era.

- `app-legacy.js`: previous monolithic homepage controller
- `styles-legacy.css`: previous monolithic shared stylesheet

Current active pages should use:

- `/js/core/*` and page-specific scripts under `/js/`
- `/styles/base.css`
- `/styles/workspaces.css`

Compatibility shims remain at:

- `/app.js`
- `/styles.css`

That lets old bookmarks, cached HTML, or manual references keep working while the new page tree stays isolated from the legacy frontend layer.
