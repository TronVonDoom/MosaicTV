# Hardware Acceleration

MosaicTV transcodes every channel to a consistent format so streams are
seamless. That encoding can run on the **CPU** (works everywhere, default) or
on a **GPU** from any of the major vendors (much lower CPU load).

| Hardware accel | Encoder | Platform |
| -------------- | ------- | -------- |
| **CPU** (default) | libx264 | anywhere |
| **NVIDIA** | h264_nvenc | Nvidia GPUs |
| **Intel QuickSync** | h264_qsv | Intel 11th-gen Core, Arc and newer |
| **VAAPI** | h264_vaapi | Intel (any with an iGPU) and AMD on Linux |
| **AMD AMF** | h264_amf | AMD GPUs, with AMD's own driver stack — outside Docker |
| **Apple** | h264_videotoolbox | macOS, outside Docker |

The Docker image carries the Intel and AMD drivers VAAPI and QuickSync need;
in it, an AMD card encodes through VAAPI.

Choose one per encoding profile under **Settings → Encoding**, or leave it on
**Auto**.

**It's self-validating.** Support is confirmed at runtime by actually encoding a
tiny sample with the chosen encoder on *your* host — not just by asking whether
ffmpeg lists it (many builds list `h264_qsv`/`h264_amf` even with no matching
GPU). If the encoder doesn't genuinely work, MosaicTV logs a warning and falls
back to the CPU (libx264), so a wrong choice or a missing GPU never breaks the
stream. **Auto** probes in order (NVENC → QSV → VAAPI → AMF → VideoToolbox) and
picks the first that works, else CPU.

GPU **decoding** currently accelerates on **NVIDIA (NVDEC)** only, probed per
codec; other vendors decode on the CPU and encode on the GPU (encoding is the
bigger win). 

> **VAAPI render node:** defaults to `/dev/dri/renderD128`. If yours differs,
> set the `VAAPI_DEVICE` environment variable. Pass the device into the
> container (`--device /dev/dri:/dev/dri`).

## Do I need a GPU?

A modern CPU handles a few 720p30 channels fine (`libx264 veryfast`). Consider
a GPU when you want several channels streaming at once, 1080p output, or the
server also does other heavy work. Streams are only encoded **while someone is
watching** — idle channels cost nothing.

---

## NVIDIA setup

### Unraid

1. Install the **Nvidia-Driver** plugin (Community Apps) and reboot as prompted.
2. Edit the MosaicTV container:
   - **Extra Parameters**: add `--runtime=nvidia`
   - **NVIDIA GPUs** (`NVIDIA_VISIBLE_DEVICES`): `all`, or one GPU's UUID from
     `nvidia-smi -L` to pin a specific card
   - **NVIDIA Capabilities** (`NVIDIA_DRIVER_CAPABILITIES`): `all`
3. Apply. Check **Logs** in MosaicTV — streams should mention `h264_nvenc`.

### docker run

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host:

```bash
docker run -d ... \
  --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  ghcr.io/tronvondoom/mosaictv:latest
```

### Docker Compose

Uncomment the NVIDIA lines in `docker-compose.yml`:

```yaml
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=all
```

---

## Intel and AMD setup

The image has the drivers; the container just needs the GPU passed in. On the
host, the GPU shows up as `/dev/dri` (if that folder isn't there, its driver
isn't loaded — on Unraid, the **Intel GPU TOP** plugin loads it for an Intel
iGPU).

- **Unraid:** edit the container and add `--device=/dev/dri` to **Extra
  Parameters**.
- **docker run:** add `--device /dev/dri:/dev/dri`.
- **Docker Compose:** uncomment the `devices:` lines in `docker-compose.yml`.

Leave the profile's **Hardware** on **Auto**: it tries QuickSync first (11th-gen
Core, Arc and newer), then VAAPI (older Intel, and AMD). Check **Logs** —
streams should mention `h264_qsv` or `h264_vaapi`. A host with more than one
GPU may need `VAAPI_DEVICE` set to the right render node (see above).

---

## Encoding profiles

**Settings → Encoding** — create profiles and assign them per channel
(channel **General** tab). Channels without one use the built-in default
(1280×720, 30 fps).

| Setting | What it does |
| ------- | ------------ |
| **Resolution / FPS** | Output size and frame rate for the whole channel |
| **Quality** | Bitrate/CRF ladder (scaled by resolution) |
| **Hardware** | `auto` (GPU if present), `nvidia` (warns + falls back if missing), `cpu` (force libx264) |
| **Preset** | Encoder speed/quality trade-off (`veryfast`… for x264, `p1`–`p7` for nvenc) |
| **Video bitrate / buffer** | Explicit rate control override |
| **Scaling mode / deinterlace** | How source video is fitted; deinterlacing for older content |
| **Burn in subtitles** | Render the source's first embedded subtitle track into the picture |
| **Audio bitrate / channels** | AAC output settings |
| **Normalize loudness** | Even out volume across different sources |
| **Threads** | CPU thread cap for the encoder |

> **Burn-in** is the only way to get subtitles onto a live channel — there's no
> track for a player to switch on, because every viewer receives the same
> encoded picture. It applies to programs (never breaks) and only when the file
> actually has a subtitle stream, so it costs nothing on sources without one.

A practical split: a "HD" profile (1080p, `auto`) for your main channels and a
"Light" profile (720p, `cpu`, capped threads) for background/break-heavy ones.
