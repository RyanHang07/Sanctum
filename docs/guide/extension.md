# The browser extension

The extension blocks flagged sites, links, and title keywords while you're sealed, and shows a **sealed** page in their place. It works in Chrome, Edge, Brave, Comet, and other Chromium browsers.

## Load it

It ships with Sanctum and loads unpacked, so there's no store listing to trust.

1. Open **Setup › Browser** in Sanctum and copy the folder it shows.
2. In your browser, open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode**, choose **Load unpacked**, and pick that folder.
4. Open the extension's **Details** and turn on **Allow in Incognito**.

Setup shows each browser connect live once it's loaded.

## What it sees

Only what blocking needs. It gets the rules from Sanctum and reports the active tab's domain (never the full address or the title) so Stats can sort time by site. It never reports history, and nothing from it reaches your partner.

## Updates

When Sanctum updates, it puts the new copy of the extension in its folder and asks the browser to reload it (after a seal, never during one). Extension 0.2.2 and earlier don't know how: reload those once on your browser's extensions page.

## While sealed

A browser that has had the extension and runs without it for 90 seconds during a seal breaks the seal. Closing the browser doesn't. Private windows are covered only when **Allow in Incognito** is on.
