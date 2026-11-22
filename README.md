# Drew

Drew is a Chromium desktop browser with a vertical tab sidebar, isolated local profiles, and a customizable new tab page. It targets macOS 13 or newer on Apple Silicon and supported Intel Macs, and Windows 10/11 on x64. See the [Electron platform requirements](https://www.electronjs.org/docs/latest/breaking-changes/).

## Get started

Use Node.js 24.15 or newer with npm, a desktop session, and enough disk space for Electron and the package outputs. The first Electron launch downloads the runtime for the current platform. macOS builds use Xcode Command Line Tools and the Node.js development headers to compile the scroll monitor.

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

Rebuild after editing. Dev and packaged launches both load the same compiled, local React interface. Fresh installs open with Personal in True Black and Work in Light.

## Browsing

- **Cmd/Ctrl+T** opens the Command Bar to navigate in a new tab, switch to open tabs, or run browser actions such as Clear Cache and Split View. **Cmd/Ctrl+L** opens the same bar for the current address. Use the arrows and Enter to choose a result.
- **Settings → New Tab** controls the background, layout spacing, recent activity, clock, and suggestions from your local history. **Settings → Appearance** offers gradient presets and custom accent colors for each Profile. **Settings → General** sets the URL opened by the Home button.
- **Settings → Appearance → Navigation layout** previews the floating sidebar, top toolbar, and compact rail. With the top toolbar enabled, put the tab strip above or below the address bar, hide it, or use fewer toolbar buttons.
- **Cmd/Ctrl+N** or **Browser menu → New Window** opens an independent tab set in the current Profile. Additional windows share that Profile’s site storage and preferences. The sidebar lists same-Profile tabs under **Other windows**. Selecting one raises its window. Quitting Drew saves open windows, including their current Space, tabs, and split layout.
- **Settings → Import** or **Import browser data** on the welcome screen opens a browser picker with per-browser export guidance. Drew can transfer bookmarks and recent history from detected Chromium Profiles, including Opera and Opera GX. You can also select a Chromium Profile folder, bookmarks HTML file, Arc or Dia Markdown export, or password CSV. Passwords are encrypted through system storage. The import includes bookmarks, history, and passwords, depending on the source you select.
- Move the pointer to the left edge to reveal the sidebar. The full-height rounded sidebar has a small vertical inset. It floats over the live webpage and slides away when the pointer leaves. Pinning it reserves space and resizes the page. **Cmd/Ctrl+S** holds the sidebar open or returns it to auto-hide. The pin and sidebar width apply to every Profile and persist across launches. Bookmarks, History, Downloads, Archived tabs, and Settings are in the fixed sidebar footer and the browser menu. Mac traffic lights sit in the top-left corner. On Windows, minimize, maximize, and close stay above the page in the top-right corner. With the optional toolbar hidden, web content reaches the top edge. The optional navigation toolbar stays hidden by default and can be toggled in Appearance or with **Cmd/Ctrl+Shift+Y**.
- Use a horizontal two-finger swipe over a webpage to go back or forward in its history. Horizontal scrolling areas on websites keep their scroll behavior.
- Swipe horizontally with two fingers over the sidebar or click the bottom dots to switch Spaces. The neighboring sidebar slides into view during the swipe, including its address controls, Favorites, and tabs. The Profile strip stays fixed and updates when the switch completes. The webpage holds its position during the gesture. On macOS, Drew reads the scroll phases, so a new swipe can advance immediately while the previous swipe’s momentum is ignored. Other platforms use wheel-event timing as a fallback for trackpads. **+ → New Space** lets you choose an existing Profile. **+ → New profile** creates an isolated Profile and its first Space. Click the Space name to edit its icon, color, or name.
- Favorites are stored per Profile and available in Spaces linked to that Profile. Click + to add a URL, label, or optional emoji icon. Drop an open tab or a link into the grid to add it. Use the heart beside the address to add the current website. Drag tiles to reorder them, use **Settings → Appearance → Favorite icon size** to change their size, or right-click a tile to edit or remove it. The address bar shows the site’s favicon when available. Pin a tab to keep it in its Space or move it into a nested folder. Today tabs auto-archive after 24 hours of inactivity by default. **Clear** archives them immediately, and **Archived tabs** lets you restore them. Set the timeout or turn it off in General.
- Drag a tab onto the viewport, choose **Add to Split View**, or press **Cmd/Ctrl+Shift+D** to add a pane. Split View supports up to four pages with separate addresses and draggable dividers.
- Links away from a pinned site can open a preview window. Use **Esc** to close it or **Cmd/Ctrl+Enter** to promote it to a tab. Web links the operating system hands off to Drew open in the same preview. On macOS, choose Drew in System Settings to route default-browser links to it.
- Media tabs show play/pause and mute controls in the sidebar when the page exposes suitable media. Native site-driven picture-in-picture can still be used where supported.

Profiles own site storage, history, bookmarks, downloads, permissions, saved passwords, installed extensions, Favorites, and browser preferences. Appearance offers True Black, Soft Dark, Slate, Light, Rose, Sky Blue, Mint, Lavender, and system modes, plus a custom hex accent and three intensity levels. The 0.4.0 upgrade keeps previously global Favorites and preferences in the original Personal Profile. Other Profiles start with their own defaults. The Passwords page saves manually entered credentials using system encryption on macOS and Windows. The Extensions page loads unpacked extensions into the current Profile. Compatible extension popups can be found by name in the Command Bar. Electron provides a subset of Chrome extension APIs. See the [Electron extension support documentation](https://www.electronjs.org/docs/latest/api/extensions).

Settings includes a Notifications section with per-site rules and a block-all option, and a Keyboard Shortcuts section for editing Profile-specific bindings.


### Password import and release security

In **Settings → Import**, select a detected browser and choose **Import all Profiles**, or point Drew at a Chromium User Data folder with **Import Profiles from folder**. Each source Profile gets its own Drew Profile. Imports keep bookmarks and recent history, turn top-level bookmarks-bar links into Favorites, and restore saved pinned URLs and color settings when present in the source preferences. **Import Profiles or Spaces** reads Arc and Dia Markdown exports with available tabs, Favorites, pinned folders, and explicit colors. A Space without a source Profile label becomes its own Drew Profile. Reimporting adds missing items to the same destinations and preserves custom colors and names there.

Select **Include password CSVs** during migration. Drew asks for each source Profile’s password export and encrypts the accounts in its matching Drew Profile. You can also choose a **Password destination Profile** to import a single CSV later. Drew saves one entry per destination Profile, website origin, and exact username. Multiple accounts for a site remain separate, and imports retain existing passwords for matching accounts. Browser password exports are plaintext files and remain in the location you chose until you delete them. Passkeys, session tokens, payment data, and the source browser's private vault are outside the password CSV format Drew imports.

Click a password field or a username field marked for autofill on a matching HTTPS sign-in page, then choose a saved account. You can also use **Cmd/Ctrl+Shift+L** or **Browser menu → Fill saved login**. Autofill checks the current Profile, page and sign-in form, including its submit destination. On a username-only step, Drew fills the username and waits for the password step.

Drew encrypts passwords with Electron's OS-backed storage. The encrypted record binds the password to its Profile and account. macOS uses Keychain and Windows uses DPAPI. Windows DPAPI protects against other OS users. Software already running as the same Windows user can have access to that user's DPAPI material. Drew never stores the selected export or sends imported password values to the interface. Copies go to the system clipboard in the focused Profile window and are cleared after 30 seconds if still present while Drew is running. OS clipboard history and other clipboard readers have their own retention.

Packaged builds require the integrity-checked app archive, disable Node configuration and inspector flags, and encrypt Chromium cookies on write. Browsing history, URLs, bookmarks, download paths, and password account labels are separate local metadata. The password vault does not provide full disk encryption. Keep previous-version installers separate from the upgraded Profile because previous versions may be unable to read newly encrypted cookies.

Run `npm run release:signed` from the target OS with production signing configured. Set `DREW_UPDATE_URL` to the HTTPS directory for the stable release channel on that platform. On Windows, set `DREW_WINDOWS_PUBLISHER` to the signing certificate’s publisher name. The release script runs the dependency audit and tests, then verifies Developer ID and notarization on macOS or timestamped Authenticode on Windows. See the verification output under `release/<version>/distribution`. Local builds omit the update channel.

Publish the signed installer or ZIP and generated blockmaps before publishing the matching update manifest. Verify the installed previous release can download and install the update, retain its Profiles and windows, and reopen successfully. Test a broken download and the operating system’s default-browser registration on both platforms. If an update needs to be rolled back, issue a corrected build with a higher version and document any data compatibility requirements. Drew checks periodically and in **Settings → About**. Download and restart require user action. Target publication within 48 hours of an upstream fix for a critical or actively exploited Chromium issue, and track that deadline from the first available patched Electron release. [Electron update guidance](https://www.electronjs.org/docs/latest/tutorial/updates)

## Browser controls and performance

- **Cmd/Ctrl+F** finds text on the active webpage. Enter and Shift+Enter move between matches. **Cmd/Ctrl+Plus**, **Minus**, and **0** change or reset zoom for the current site and Profile. **Cmd/Ctrl+P** prints. The Command Bar also offers **Save Page as PDF**.
- **Settings → General** includes opt-in Memory Saver and Battery Saver. Background tabs can also be put to sleep from their context menu. Selecting a sleeping tab restores its navigation history when available and reloads the page. Drew protects visible panes, tabs with detected edits, media or capture, sign-in popups, and Profiles with an active download.
- **Cmd/Ctrl+Shift+N** opens a Private window with an in-memory history database and Chromium session. Each Private window starts fresh. Downloaded and explicitly saved files remain on disk.
- The tab context menu can move tabs between Spaces in the same Profile or move a tab to a new window. A move to a new window reloads the page. **Settings → General** can route externally opened links from exact hostnames to a selected Profile.
- **Settings → Import** previews discovered item counts before importing. **Export Workspace** saves the current Space’s links and Profile bookmarks and Favorites as bookmarks HTML. Downloads supports pausing, resuming eligible active downloads, and retrying eligible interrupted or cancelled HTTP(S) downloads.

### Performance and compatibility checks

Use a clean test Profile and sample 1, 12, and 50 tabs on the same Mac and Windows laptops before and after a change. Compare foreground and minimized idle CPU wakeups, memory after sleeping eligible tabs, browser-state message counts, swipe and resize frame times, and unplugged power use with brightness and workload held constant. Run calls, edited forms, video, sign-in popups, and live downloads while testing sleep eligibility.

Release validation still requires an installed signed upgrade and recovery drill, default-browser handoff, real Google and Microsoft accounts, passkeys and MFA, compatible password managers, screen sharing and DRM, and native Windows trackpad and assistive-technology checks.

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

The main process hosts both the shell and the website views. The active website or up to four split panes are attached to the native window. Link previews run in a separate sandboxed child window with a browser-controlled destination strip and an **Open in tab** action. Restored tabs instantiate their Chromium view when first selected, and loaded background views retain their state until closed or the window shuts down. The React shell owns the toolbar, sidebar, internal pages, and overlays. Main-process state drives tab selection, load state, history buttons, titles, and favicons.

### SQLite and profile data

The database lives at `lexn.sqlite` under Electron’s `app.getPath('userData')`. Drew 0.5.0 uses the existing application data directory and macOS Safe Storage name from LexN. SQLite uses `node:sqlite` from Electron, WAL mode, foreign keys and transactional migrations keyed on `PRAGMA user_version`.

| Tables | Stored data |
| --- | --- |
| `workspaces`, `tab_groups`, `tabs` | Profile names, accents, selection, group membership, pinned state, tab positions and current URLs |
| `browser_windows`, `archived_tabs` | Restorable windows, split layouts and archived tab history |
| `bookmarks`, `bookmark_folders` | Saved title, URL, and optional folder |
| `history` | Committed URLs, titles and visit timestamps |
| `downloads` | Destination, progress, timestamps and transfer state from Chromium |
| `settings`, `profile_permissions` | Browser preferences and per-origin permission decisions |

The startup policy restores the active Space and tab URLs by default. Spaces can share a Profile’s persistent Chromium session or use a dedicated Profile. Each profile uses its own persistent Chromium session. The 0.2.0 migration assigns previously shared history, bookmarks, downloads and permissions to the original Personal profile, even if renamed. Personal also keeps the original Chromium partition and its existing site logins. Existing tab collections stay in their respective profiles. Interrupted downloads keep their records.

### Security model

Website views use Chromium sandboxing, context isolation, and web security with Node integration disabled. Website processes receive an isolated wheel listener for history gestures with no page-facing API. The shell serves bundled assets from a dedicated `lexn://shell` origin under a restrictive content security policy. Main-process IPC checks the sender, top-level frame, and exact shell URL, then validates command arguments before acting. Website navigation and popup routing accept HTTP and HTTPS, with a dedicated blank page for new tabs. Chromium retains default TLS validation. Site permissions default to deny, and permission requests from embedded third-party frames are denied. Restored site content can still use the network through Chromium.

The optional assistant sidebar defines an extension point for a future provider. It ships without an external provider, credentials, or automatic page-content collection.

## Packaging

Build on the target operating system. The installer is named Drew and carries the browser’s existing app icon. Build outputs go to a versioned directory under `release/`.

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

This targets Windows x64 and produces an NSIS installer and a portable executable. The installed build registers for HTTP and HTTPS in Windows Default Apps. Users choose Drew in system settings. For external distribution, configure Authenticode signing through the build environment. Test installation, launching, generated shortcuts, downloading, and uninstall on both Windows 10 and Windows 11. See the [Electron Builder NSIS documentation](https://www.electron.build/v26/docs/nsis/).

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
- Sessions restore current tab URLs, workspace selections, tabs, pins, groups and split layouts. Chromium back/forward history and closed-tab undo are confined to the running session. Archived tabs can be searched and restored in batches. **Undo Clear** restores the most recent Clear from its originating window and Space.
- Profiles keep their data locally. Password saving is manual. Chrome Web Store installation, automatic PiP on tab switch, sync and AI actions remain out of scope.
- Eligible HTTPS popups can retain their opener for sign-in. Google and Microsoft accounts, passkeys, MFA, password changes, and password-manager extensions need provider-specific compatibility testing.
- Search suggestions are local. The new-tab background offers three palettes, and the light theme applies to the browser chrome and management pages.
# drew
