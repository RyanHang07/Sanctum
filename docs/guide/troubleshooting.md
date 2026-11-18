# Troubleshooting

## A site isn't blocked

- Check that the extension is loaded and connected in **Setup › Browser Extension**.
- In a private window, turn on **Allow in Incognito** in the extension's Details.
- Turn on Protection in **Setup › App Guard** to block whole sites in every browser.

## An app isn't closed

Apps run as administrator need Protection on, with **Close apps run as administrator** in Setup › App Guard. Check the app is on your Distractions list by its program name; Setup › Distractions shows it.

## The extension says it can't reach Sanctum

Sanctum has to be running. Reload the extension on your browser's extensions page. Extension 0.2.2 and earlier need one reload by hand after Sanctum updates; from 0.3.0 it reloads itself.

## The seal broke on its own

The page at the end of the seal says why, and **Stats › Sessions** keeps it: open the session to see what happened and when. The reasons are the PC going off, Sanctum being closed, the clock changing, or the guard or extension stopping.

## Setup › App Guard says "From an older Sanctum"

The guard is from a previous version. Choose **Update** and approve once. If the status line says **Installed, but not running**, or shows an error, choose **Repair**.

## "The seal ended, but it wasn't saved"

The disk was full or read-only when the seal ended. The seal is over, and Sanctum keeps trying to save it; free up space and it catches up.

## Reporting a bug

Open an [issue on GitHub](https://github.com/ryanhang07/sanctum/issues) and paste what **Setup › Behavior › About › Copy diagnostics** gives you. It holds versions and settings, never your activity or notes.
