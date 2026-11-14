# Mixroom

Mixroom is a private, browser-based DJ mix builder. Add local audio tracks to analyze approximate tempo, beat phase, and key, arrange a set with smart sequencing or an optional online language model, preview beat-aligned crossfades, and export a continuous WAV mix.

## Run it

From this directory, start a local static server:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a modern browser. Audio files are decoded and mixed on your device. The first play or export may ask the browser to enable audio.

## Build the macOS app and installer

On macOS with the Xcode Command Line Tools installed, run:

```sh
./scripts/build-macos.sh
```

This builds a universal Apple Silicon and Intel `Mixroom.app` and creates `Mixroom-1.0.12-macOS.pkg` in the project directory. Install the package to add Mixroom to `/Applications`. The app is ad-hoc signed; the installer is unsigned, and neither is Developer ID signed or notarized. macOS may require you to confirm or override its security warning before installation or first launch.

Prebuilt installers are available on the [GitHub Releases page](https://github.com/thomaswales26-hash/Mixroom/releases).
The browser version is also published at [thomaswales26-hash.github.io/Mixroom](https://thomaswales26-hash.github.io/Mixroom/).

## Online AI (optional)

Open **AI settings** and enter a Hugging Face user access token with Inference Providers access, plus a model supported by your account. The default model is `Qwen/Qwen2.5-7B-Instruct`. The app sends only track names and locally estimated tempo, key, and duration to Hugging Face; it never uploads audio. The token is used for the request only and is not stored. Without a token, **Arrange my set** uses local tempo, key, and energy matching.

Online model availability, access, and usage limits depend on your Hugging Face account and the selected provider/model. If a request fails, local smart sequencing remains available.

## Notes

- Drag tracks to set the order manually; crossfade length and listening direction are adjustable.
- Use **Import from folder** to preview and select supported audio tracks from a folder in the app window, or **Browse files** to choose individual files. Folder imports scan subfolders too.
- Folder import progress and any unreadable-track messages appear inside the folder browser while its track list stays open.
- Tempo and key analysis uses a downsampled 30-second excerpt instead of scanning the full-resolution track, speeding up large-library imports while leaving original audio quality untouched.
- Import analysis detects the first energetic beat as a cue point and marks it in each track row and the mix waveform. Cue estimates use the same local excerpt and are approximate.
- Memory safety limits imports to 30-minute tracks and 4 GiB of decoded audio; WAV exports are limited to 20 minutes. Mixroom warns and restarts the audio page if WebKit terminates it for memory pressure.
- Beat alignment is enabled by default. Mixroom estimates each track's tempo and beat phase locally, adjusts playback rate to a shared median tempo (limited to 0.8×–1.25×), trims the lead-in to the first detected beat, and starts transitions on beat boundaries. Playback rate changes also shift pitch; disable Beat align to preserve original speed and pitch.
- Playback and WAV export use the same linear-amplitude crossfade schedule. Export is stereo 16-bit PCM at 44.1 kHz; conversion is chunked to keep the app responsive and display encoding progress.
- In the macOS app, exported WAV files are saved directly to Documents; existing filenames are preserved by adding a number. In a regular browser, exports use its normal download behavior.
- Tempo, beat phase, and key estimates are approximate analysis aids, not guaranteed musical transcriptions. Tracks without a reliable beat estimate play at their original speed and use regular crossfades.
- WAV rendering uses browser memory proportional to mix duration and is limited to 20 minutes.
