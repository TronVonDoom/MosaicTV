# Security

**Out of the box MosaicTV has no login — on a home network that's the
point.** Anyone who can reach port 8688 can open the admin UI, change your
channels and read your library listing, the way Threadfin and xTeVe work. To
watch away from home, either keep it on a VPN or turn on **sign-in**.

## Sign-in

**Settings → Sign-in** makes MosaicTV ask who you are away from home:

1. **Set a password** (8 characters at least).
2. Turn on **Ask who you are**. The browser that turns it on stays signed in.
3. Leave **Home signs in by itself** on, and nothing changes at home: phones,
   TVs and players on your home network — and on **Tailscale** — get straight
   in, as they always have. Turn it off and home signs in like anywhere else.

Then, from away:

- **A browser** signs in with the password, or **with a code**: it shows one,
  and you approve it on a phone or computer that's signed in already
  (**Settings → Sign-in → Approve a code**, or the address it names,
  `/pair`). No password typed on a borrowed screen.
- **The MosaicTV app** pairs the same way: it shows a code, you approve it.
- **A player** (TiviMate, VLC, Jellyfin, Emby…) gets **links of its own**
  under **Player links**: an M3U, an XMLTV guide and a tuner address with a
  key in the path. They reach the channels and their guide — nothing else of
  the app — and every address inside them (each channel, each HLS segment,
  the guide's pictures) carries the key. Remove the player and its links stop
  working.
- **Casting** hands the TV a link of its own, so a cast plays wherever the TV
  is.

Everything signed in is listed there with when and from where it was last
seen, and can be signed out. A content reset (**Maintenance → Reset**) leaves
sign-in as it was.

How it's guarded:

- The password is stored scrypt-hashed; tokens are 32 random bytes, stored as
  their SHA-256 (a player's also as itself, so its links can be shown again).
- Ten wrong passwords from one address in a quarter of an hour and it waits.
- A request that came through a **reverse proxy or a tunnel** — one carrying
  `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or a Cloudflare header — never
  counts as home, so a proxy on the same machine can't make the internet look
  local.
- Changes made through a browser must carry the app's own header, which a
  page on another site can't add — it can't act through a signed-in browser.

**Locked out?** Start MosaicTV once with `MOSAICTV_RESET_SIGN_IN=1` in its
environment: sign-in turns off, and you can set a new password. Then take the
variable out.

## Rules of thumb

- ✅ **Do** mount your media **read-only** (`:ro`) — the app never needs to
  write to it, and every install guide in these docs already does this.
- ✅ **Do** turn on sign-in before letting anything from outside reach it.
- ❌ **Don't** port-forward 8688 with sign-in off.
- ❌ **Don't** put it on a VPS/cloud host with a public IP and sign-in off.

## Watching away from home

Two good ways:

- **A VPN** into your home network — then everything works exactly as at
  home. **[Tailscale](https://tailscale.com/)** is the easiest (install on the
  server and your devices, use the server's Tailscale IP), and with sign-in on
  it counts as home; **WireGuard** is built into many routers and Unraid.
- **Sign-in** and a reverse proxy with HTTPS (Caddy, Nginx Proxy Manager,
  Traefik) in front. MosaicTV honors `X-Forwarded-Proto` / `X-Forwarded-Host`,
  so the addresses in its M3U, XMLTV and player links stay right behind it.
  Its session cookie is marked Secure over HTTPS.

## What the app itself limits

- The in-app folder picker only browses inside the media root
  (`/media`, override with `MEDIA_ROOT`) — it can't wander the host
  filesystem.
- Media is only ever read, never modified.
- Nothing phones home — no analytics, no update checks. MosaicTV only goes
  out to the internet for what you've switched on:
  - **TMDB** and **TheTVDB** — artwork and details for shows and movies, once
    you add their keys.
  - **MusicBrainz** and the **Cover Art Archive** — albums, years, genres and
    covers for a Music or Music Videos library that has them turned on.
  - **LRCLIB** — synced lyrics for a Music library that has it turned on, for
    songs with no lyrics of their own.
  - Any **logo URL** you give a channel.

  Each request names the song, show or movie it's looking up — nothing about
  you, your server or what you watch.
