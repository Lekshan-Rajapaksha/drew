# LexN Browser

LexN is a Chromium desktop browser with a vertical tab sidebar, isolated local profiles, and a customizable new tab page. It targets macOS 13 or newer on Apple Silicon and supported Intel Macs, and Windows 10/11 on x64. See the [Electron platform requirements](https://www.electronjs.org/docs/latest/breaking-changes/).

## Get started

Use Node.js 24.15 or newer with npm, a desktop session, and enough disk space for Electron and the package outputs. The first Electron launch downloads the runtime for the current platform.

```sh
npm ci
npm run dev
```

| Command | Result |
| --- | --- |
| `npm run dev` | Build the Electron and Vite bundles and launch the app |
| `npm run start` | Launch an existing build |
| `npm run typecheck` | Check both Electron and renderer TypeScript |
| `npm run lint` | Run ESLint |
| `npm test` | Build and run the navigation and SQLite tests |
| `npm run test:desktop` | Run the Playwright desktop tests against an existing build |
| `npm run build` | Write the main/preload bundle to `out/` and the React bundle to `dist/` |

Rebuild after editing. Dev and packaged launches both load the same compiled, local React interface.

## Browsing

- **Cmd/Ctrl+T** opens the Command Bar to navigate in a new tab, switch to open tabs, or run browser actions such as Clear Cache and Split View. **Cmd/Ctrl+L** opens the same bar for the current address. Use the arrows and Enter to choose a result.
- Move the pointer to the left edge to reveal the sidebar and service rail. They slide away when the pointer leaves. **Cmd/Ctrl+S** holds the sidebar open or returns it to auto-hide. Set **Appearance → Keep tab sidebar expanded** to lock it open across launches. With the macOS top toolbar and sidebar hidden, the page fills the window without a border. The optional navigation toolbar stays hidden by default and can be toggled in Appearance or with **Cmd/Ctrl+Shift+Y**.
- Swipe horizontally with two fingers over the sidebar or click the bottom dots to switch Spaces. The page and tab list slide in the direction of travel. Momentum stays within one gesture until the scroll stream goes quiet, so one swipe advances one Space. **+ → New Space** lets you choose an existing Profile. **+ → New profile** creates an isolated Profile and its first Space. Click the Space name to edit its icon, color, or name.
- Favorites are stored per Profile and available in Spaces linked to that Profile. Click + to add a URL, label, or optional emoji icon. Drop an open tab or a link into the grid to add it. Drag tiles to reorder them, use the size selector to change their size, or right-click a tile to edit or remove it. Pin a tab to keep it in its Space or move it into a nested folder. Today tabs auto-archive after 24 hours of inactivity by default. **Clear** archives them immediately, and **Archived tabs** lets you restore them. Set the timeout or turn it off in General.
- Drag a tab onto the viewport, choose **Add to Split View**, or press **Cmd/Ctrl+Shift+D** to add a pane. Split View supports up to four pages with separate addresses and draggable dividers.
- Links away from a pinned site can open a preview window. Use **Esc** to close it or **Cmd/Ctrl+Enter** to promote it to a tab. Web links the operating system hands off to LexN open in the same preview. On macOS, choose LexN in System Settings to route default-browser links to it.
- Media tabs show play/pause and mute controls in the sidebar when the page exposes suitable media. Native site-driven picture-in-picture can still be used where supported.

Profiles own site storage, history, bookmarks, downloads, permissions, saved passwords, installed extensions, Favorites, and browser preferences. Appearance offers True Black, Soft Dark, Slate, Light, and system modes, plus an arbitrary hex accent, three intensity levels, and separate new tab backgrounds. The 0.4.0 upgrade keeps previously global Favorites and preferences in the original Personal Profile. Other Profiles start with their own defaults. The Passwords page saves manually entered credentials using system encryption on macOS and Windows. The Extensions page loads unpacked extensions into the current Profile. Compatible extension popups can be found by name in the Command Bar. Electron provides a subset of Chrome extension APIs. See the [Electron extension support documentation](https://www.electronjs.org/docs/latest/api/extensions).

## Architecture

| Location | Responsibility |
| --- | --- |
| `electron/main/index.ts` | Application lifecycle, native window, keyboard shortcuts and profile initialization |
| `electron/main/tabs.ts` | Chromium `WebContentsView` lifecycle, navigation, routing new-window requests into tabs, and native viewport layout |
| `electron/main/profile.ts` | Session permission handlers and Chromium download events |
| `electron/main/database.ts` | Versioned SQLite migrations, settings, history queries, and transactions |
| `electron/main/ipc.ts` | Typed commands, runtime payload validation, origin checks, and renderer snapshots |
| `electron/preload/index.cts` | Restricted IPC bridge for the local interface |
| `shared/` | Shared browser types, constants, and address parsing |
| `src/` | React UI, Zustand state, Vite build, Tailwind/CSS design system, and deferred assistant surface |

The main process hosts both the shell and the website views. The active website or up to four split panes are attached to the native window. Link previews run in a separate sandboxed child window. Restored tabs instantiate their Chromium view when first selected, and loaded background views retain their state until closed or the window shuts down. The React shell owns the toolbar, sidebar, internal pages, and overlays. Main-process state drives tab selection, load state, history buttons, titles, and favicons.

### SQLite and profile data

The database lives at `lexn.sqlite` under Electron’s `app.getPath('userData')`. SQLite uses `node:sqlite` from Electron, WAL mode, foreign keys and transactional migrations keyed on `PRAGMA user_version`.

| Tables | Stored data |
| --- | --- |
| `workspaces`, `tab_groups`, `tabs` | Profile names, accents, selection, group membership, pinned state, tab positions and current URLs |
| `bookmarks`, `bookmark_folders` | Saved title, URL, and optional folder |
| `history` | Committed URLs, titles and visit timestamps |
| `downloads` | Destination, progress, timestamps and transfer state from Chromium |
| `settings`, `profile_permissions` | Browser preferences and per-origin permission decisions |

The startup policy restores the active Space and tab URLs by default. Spaces can share a Profile’s persistent Chromium session or use a dedicated Profile. Each profile uses its own persistent Chromium session. The 0.2.0 migration assigns previously shared history, bookmarks, downloads and permissions to the original Personal profile, even if renamed. Personal also keeps the original Chromium partition and its existing site logins. Existing tab collections stay in their respective profiles. Interrupted downloads keep their records.

### Security model

Website views use Chromium sandboxing, context isolation, and web security with Node integration disabled. Website processes receive no LexN preload or privileged API. The shell serves bundled assets from a dedicated `lexn://shell` origin under a restrictive content security policy. Main-process IPC checks the sender, top-level frame, and exact shell URL, then validates command arguments before acting. Website navigation and popup routing accept HTTP and HTTPS, with a dedicated blank page for new tabs. Chromium retains default TLS validation. Site permissions default to deny, and permission requests from embedded third-party frames are denied. Restored site content can still use the network through Chromium.

The optional assistant sidebar defines an extension point for a future provider. It ships without an external provider, credentials, or automatic page-content collection.

## Packaging

Build on the target operating system. The installer and app icon use original LexN branding. Build outputs go to a versioned directory under `release/`.

### macOS

```sh
npm ci
npm run dist:mac:arm64
npm run dist:mac:x64
```

Use `npm run dist:mac` to build both architectures on one compatible Mac. Each architecture targets a `.app`, DMG, and ZIP. For a local ad-hoc Apple Silicon build, run `npm run dist:mac:arm64 -- --config.mac.identity=- --config.mac.hardenedRuntime=false --publish never`. For external distribution, supply a Developer ID Application identity and Apple notarization credentials through the signing environment. Keep the credentials out of the repository. Validate the installed app and stapled notarization ticket on both architectures. See the [Electron Builder macOS documentation](https://www.electron.build/v26/docs/mac/).

### Windows

```powershell
npm ci
npm run dist:win
```

This targets Windows x64 and produces an NSIS installer and a portable executable. For external distribution, configure Authenticode signing through the build environment. Test installation, launching, generated shortcuts, downloading, and uninstall on both Windows 10 and Windows 11. See the [Electron Builder NSIS documentation](https://www.electron.build/v26/docs/nsis/).

## Testing

Build first, then run the desktop test suite. It launches real Electron windows, serves fixture pages over loopback, and deletes its temporary profile when finished. It covers actual page rendering, window-open routing, tab switches and shortcuts, back and forward, default search routing, grouping and pinning, bookmarking, downloads and cancellation, cookie deletion, denied default site permissions, assistant sidebar layout, workspace and theme persistence, and clean shutdown.

```sh
npm run typecheck
npm run lint
npm test
npm run test:desktop
LEXN_TEST_PUBLIC_WEB=1 npm run test:desktop
```

On PowerShell, set `$env:LEXN_TEST_PUBLIC_WEB = '1'` before running the final command. That opt-in checks Google, text search, and YouTube using the live network. A Google verification challenge skips the live results assertion after checking that the requested query reached Google. The loopback suite independently verifies search routing. Set `LEXN_SCREENSHOT` to a writable PNG path to capture the fresh new-tab screen. Set `LEXN_ELECTRON_BINARY` to test against a particular Electron executable.

On each release platform, manually verify media capture and notifications with OS permission prompts, download open/reveal, signed installer behavior, window chrome and DPI scaling, and invalid TLS certificate refusal. Test representative websites with OAuth popups, video, file input, and full-screen controls.

### Packaged relaunch checks

Run `node tests/packaged-smoke.mjs "/absolute/path/to/the/packaged/executable"` after building. The test uses a temporary browser profile and exercises opening, window activation, duplicate launch, and reopening after exit.

### Local verification for 0.4.0

The Apple Silicon desktop suite checks the True Black palette, saved custom accents, Profile-specific settings, Favorites and cookies, and a long wheel-momentum burst crossing both sidebar surfaces. Spaces bound to the same Profile share its data by design.

### Local verification for 0.3.0

The Apple Silicon desktop suite passed for swipe switching, shared and isolated Profiles, archive and restore, extension popup launch, link-preview promotion, and four live Chromium panes with draggable resizing. The Apple Silicon DMG checksum and ad-hoc signature also verified.

### Local verification for 0.2.0

Apple Silicon verification covered toolbar visibility and restart persistence, keyboard address access, sidebar collapse, profile switching, cookie and browsing data isolation, and migration from the original shared profile.

### Local verification for 0.1.0

On Apple Silicon, the source build, static checks, unit tests, and Playwright desktop tests passed. Google and YouTube homepages loaded. Google redirected the live search to a verification page, and the loopback test confirmed search routing. Chromium refused a locally served untrusted certificate. The Apple Silicon DMG checksum and ad-hoc app signature verified, and the packaged app launched successfully. Windows and Intel macOS builds still require verification on their target systems.

## Known limitations

- Windows and Intel macOS require native installer and runtime validation. Distribution signing and notarization require release credentials.
- Sessions restore current tab URLs, workspace selections, tabs, pins and groups. Chromium back/forward history and closed-tab undo are confined to the running session.
- Profiles have local data only. Password saving is manual and browser autofill remains out of scope. Chrome Web Store installation, automatic PiP on tab switch, sync, incognito, AI actions, and automatic updates remain out of scope. Windows default-browser registration still needs platform work.
- A new-window request opens a normal tab or a pinned-link preview with no opener relationship. Some popup-based sign-in flows may require another sign-in method.
- Search suggestions are local. The new-tab background offers three palettes, and the light theme applies to the browser chrome and management pages.
# drew
