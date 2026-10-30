# Troubleshooting

## A site isn't blocked

- Check that the extension is loaded and connected in **Setup › Browser**.
- In a private window, turn on **Allow in Incognito** in the extension's Details.
- Turn on Protection to block whole sites in every browser.

## An app isn't closed

Apps run as administrator need Protection on. Check the app is on your Distractions list by its program name; Setup › Distractions shows it.

## The extension says it can't reach Sanctum

Sanctum has to be running. Reload the extension on your browser's extensions page. Extension 0.2.2 and earlier need one reload by hand after Sanctum updates; from 0.3.0 it reloads itself.

## The seal broke on its own

Setup › Protection lists tamper events with the reason: the PC went off, Sanctum was closed, the clock changed, or the guard or extension stopped.

## Reporting a bug

Open an [issue on GitHub](https://github.com/ryanhang07/sanctum/issues) and paste what **Setup › General › About › Copy diagnostics** gives you. It holds versions and settings, never your activity or notes.
