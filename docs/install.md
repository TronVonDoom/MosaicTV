# Installation

MosaicTV ships as a single Docker container:
**`ghcr.io/tronvondoom/mosaictv:latest`** — web UI, database, and ffmpeg all
included. It runs on any 64-bit Intel or AMD (amd64) Docker host: Unraid,
Synology/QNAP models with an Intel or AMD CPU, Proxmox, or any Linux box. There
is no ARM image yet, so a Raspberry Pi or an ARM NAS can't run it.

### Which tag

| Tag | What it is |
| --- | ---------- |
| `:latest` | The newest release. Moves only when a version is released — use this. |
| `:v0.14.0` (any `vX.Y.Z`) | One release, pinned. It never changes, so it never updates either. |
| `:edge` | Every change as it lands on `main`, before a release. For testing what's next — it can break. |

**Settings → Maintenance** shows the version you're running; on `:edge` it
ends with the commit (`0.14.0+cb8eee7`). Put it in any bug report.

Every install needs the same two mounts and one port:

| | Container path | Purpose |
| - | ------------- | ------- |
| **Data** | `/app/data` | Database, logos, music, clips, built idents — **persistent, keep it** |
| **Media** | `/media` | Your media library — mount **read-only** |
| **Port** | `8688` | Web UI + IPTV endpoints |

> ⚠️ MosaicTV has **no login**. Keep it on your LAN — see [Security](security.md).

---

## Option 1 — `docker run` (any platform)

```bash
docker run -d \
  --name mosaictv \
  --restart unless-stopped \
  -p 8688:8688 \
  -e TZ=America/Chicago \
  -v /path/to/appdata/mosaictv:/app/data \
  -v /path/to/your/media:/media:ro \
  ghcr.io/tronvondoom/mosaictv:latest
```

Change `TZ` to [your timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
(it controls schedule times and the TV guide), and the two `-v` left-hand paths
to real folders on your host. Then open `http://YOUR-SERVER:8688`.

**With an NVIDIA GPU** (optional — see [Hardware Acceleration](hardware-acceleration.md)):

```bash
docker run -d \
  --name mosaictv \
  --restart unless-stopped \
  --gpus all \
  -p 8688:8688 \
  -e TZ=America/Chicago \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -v /path/to/appdata/mosaictv:/app/data \
  -v /path/to/your/media:/media:ro \
  ghcr.io/tronvondoom/mosaictv:latest
```

**With an Intel or AMD GPU**, pass it in with `--device /dev/dri:/dev/dri`
in place of the three NVIDIA lines.

---

## Option 2 — Unraid (template)

1. On the Unraid terminal, download the template:

   ```bash
   curl -L -o /boot/config/plugins/dockerMan/templates-user/my-MosaicTV.xml \
     https://raw.githubusercontent.com/TronVonDoom/mosaictv/main/unraid/my-MosaicTV.xml
   ```

2. **Docker** tab → **Add Container** → pick **MosaicTV** from the template
   dropdown.
3. Point **Media Library** at your media share (e.g. `/mnt/user/media`) and
   set your **Timezone**. **Apply**.
4. Open the WebUI from the Docker page.

**Updating:** Docker tab → MosaicTV → **Force Update** (or "Check for Updates").
It pulls the newest release (or, with the Repository set to `:edge`, the
newest build of `main`).

**NVIDIA GPU on Unraid:** install the **Nvidia-Driver** plugin (Community
Apps), then edit the container: add `--runtime=nvidia` to **Extra Parameters**
and set **NVIDIA GPUs** to `all` (or one GPU's UUID from `nvidia-smi -L`).
**Intel or AMD GPU on Unraid:** add `--device=/dev/dri` to **Extra
Parameters**. Details in [Hardware Acceleration](hardware-acceleration.md).

---

## Option 3 — Portainer (stack)

Portainer → **Stacks** → **Add stack**, paste:

```yaml
services:
  mosaictv:
    image: ghcr.io/tronvondoom/mosaictv:latest
    container_name: mosaictv
    restart: unless-stopped
    ports:
      - "8688:8688"
    environment:
      - TZ=America/Chicago
    volumes:
      - /path/to/appdata/mosaictv:/app/data
      - /path/to/your/media:/media:ro
```

Edit the paths and timezone, then **Deploy**. To update: re-pull the image and
re-deploy the stack.

## Updating with `docker run` or Compose

```bash
docker pull ghcr.io/tronvondoom/mosaictv:latest
```

then remove and re-create the container with the same command (Compose:
`docker compose pull && docker compose up -d`). Your channels live in the data
folder and come straight back. Before any version that changes the database,
MosaicTV copies it to `backups/` in the data folder first, and puts the copy
back by itself if the change fails.

---

## Option 4 — Docker Compose from source

For development or if you want to build the image yourself:

```bash
git clone https://github.com/TronVonDoom/mosaictv.git
cd mosaictv
# edit docker-compose.yml: media path, TZ, optional NVIDIA lines
docker compose up -d --build
```

Update later with the bundled script (git pull + rebuild + prune):

```bash
./scripts/update.sh
```

---

## Local development (no Docker)

Requires Node 22+ and ffmpeg on your PATH.

```bash
npm run install:all   # install root, server, and web dependencies
npm run dev           # backend on :8688, frontend on :5173
```

Open <http://localhost:5173>. The dev server proxies `/api/*` to the backend.
The server creates `server/prisma/dev.db` on first run and applies any new
migrations each time it starts.

Changing the schema: edit `server/prisma/schema.prisma`, then
`npm --prefix server run db:migrate -- --name what_changed` writes the
migration (and applies it to the dev database). Commit it with the schema;
`npm --prefix server run db:rehearse` replays it against databases from earlier
releases, as CI does. Never edit `prisma/baseline.prisma` or a migration that
has shipped.

---

## Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `TZ` | `America/Chicago` | Timezone for schedules and the guide |
| `PORT` | `8688` | Port the app listens on |
| `DATABASE_URL` | `file:/app/data/mosaictv.db` | SQLite database location |
| `MEDIA_ROOT` | `/media` | Root the in-app folder picker may browse |
| `TMDB_API_KEY` | – | TMDB key (can also be set in the UI under Settings) |
| `TVDB_API_KEY` / `TVDB_PIN` | – | TheTVDB key, and the subscriber PIN a user-supported key needs (both can also be set under Settings) |
| `TVDB_LANGUAGE` | `eng` | The language TheTVDB's names and summaries are read in (ISO 639-2) |
| `NVIDIA_VISIBLE_DEVICES` | – | `all` or a GPU UUID, for NVIDIA transcoding |
| `NVIDIA_DRIVER_CAPABILITIES` | – | `all`, for NVIDIA transcoding |
| `HLS_DIR` | `/app/data/hls` | Where playing channels write their live segments — see below |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | The GPU render node for VAAPI, on a host with more than one |

## Live segments in RAM (optional)

A channel that's playing writes a few-second segment of video every few
seconds, all day, into the data folder — on Unraid usually the cache SSD.
Point `HLS_DIR` at a RAM disk instead and the drive is spared; the segments
are thrown away when the channel stops anyway.

It takes about **225 MB per 1080p channel playing at once** (100 MB at 720p),
so 1 GB covers four. If the RAM disk fills, streams fail — size it with room
to spare.

- **docker run:** add `--tmpfs /transcode:size=1g -e HLS_DIR=/transcode`.
- **Docker Compose:** uncomment the `tmpfs:` and `HLS_DIR` lines in
  `docker-compose.yml`.
- **Unraid:** add `--tmpfs /transcode:size=1g` to **Extra Parameters** and set
  **Live segments folder** (`HLS_DIR`, under *Show more settings*) to
  `/transcode`.

**Settings → Maintenance → Live segments** says where they're going and
whether that's in memory.

Next step: [Getting Started](getting-started.md) →
