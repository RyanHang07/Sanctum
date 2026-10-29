# Protection and tamper

## Protection

Protection is an optional Windows service, **Sanctum Guard**. Turn it on in **Setup › Protection** with one admin approval. It:

- Blocks flagged sites in the hosts file while sealed, so every browser is covered, extension or not.
- Reopens Sanctum within seconds if it's closed mid-seal, and logs the restart.
- Can close flagged apps that run as administrator.

It can't be turned off while sealed.

## Tamper

These break a seal and reset your streak; your partner is told:

- Changing the Windows clock by more than 2 minutes. Sleep and waking a laptop never count.
- Stopping the guard for 20 seconds, or a browser running without the extension for 90 seconds.
- Sanctum being gone for more than a minute: the PC shutting down, or Sanctum being closed or crashing.

**Setup › Protection** lists what happened and when.
