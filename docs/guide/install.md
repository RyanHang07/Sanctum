# Install Sanctum

Sanctum runs on Windows 10 and 11. It installs for your user only, with no admin prompt, and updates itself.

## Download

Get `Sanctum_x.y.z_x64-setup.exe` from the [latest release](https://github.com/ryanhang07/sanctum/releases/latest) and run it.

## Windows protected your PC

Sanctum isn't code-signed yet, so SmartScreen may stop the installer the first time. Choose **More info**, then **Run anyway**. The installer is built from the public source by GitHub Actions on every release.

## Updates

Sanctum checks for a new version a little after it starts and every 6 hours, and downloads it in the background. When it's ready, a small note says so: **Restart to update** installs it in a few seconds. During a seal it waits until the seal ends. Setup › General › About shows your version and can check now. Updates are signed, and Sanctum refuses one that isn't.

## Uninstall

Use Windows' **Settings › Apps**. Uninstalling during a seal counts as tampering, so end the seal first. If you turned on Protection, turn it off in Setup first so the Sanctum Guard service is removed too.

Next: [Set up Sanctum](/docs/first-setup).
