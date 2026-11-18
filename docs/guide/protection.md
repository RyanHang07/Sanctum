# Protection and tamper

## Protection

Protection is an optional Windows service, **Sanctum Guard**. Turn it on in **Setup › App Guard** with one admin approval. It:

- Blocks flagged sites in the hosts file while sealed, so every browser is covered, extension or not.
- Reopens Sanctum within seconds if it's closed mid-seal, and logs the restart. **Times it reopened Sanctum** shows how often.
- With **Close apps run as administrator** on, closes flagged apps that run as administrator.

It can't be turned off while sealed.

The guard is careful with your PC. It only adds and removes its own block in the hosts file, keeps every other line exactly as it was, and never writes after a read that failed. Its folder can only be changed by administrators. If Sanctum can't end a seal, the guard lets it go 15 minutes after its planned end, and if Sanctum won't start, it stops relaunching after five tries.

After an update, App Guard may say **From an older Sanctum. Update it.** Choose **Update** (one admin approval) to put this version's guard in place. If the guard couldn't do something, its last error shows under the status line, and **Repair** reinstalls it.

## Tamper

These break a seal and reset your streak; your partner is told. The seal itself stays on until its planned end, so tampering never lets you out early:

- Changing the Windows clock by more than 2 minutes. Sleep and waking a laptop never count, and a clock set forward can't end a seal early.
- Stopping the guard for 20 seconds, or a browser running without the extension for 90 seconds.
- Sanctum being gone for more than a minute: the PC shutting down, or Sanctum being closed or crashing.

Open a session in **Stats › Sessions** to see what happened and when.
