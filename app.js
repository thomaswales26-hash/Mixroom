(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    fileInput: $("#file-input"),
    folderInput: $("#folder-input"),
    browseFiles: $("#browse-files"),
    browseFolder: $("#browse-folder"),
    folderBrowser: $("#folder-browser"),
    folderBrowserClose: $("#folder-browser-close"),
    folderBrowserCancel: $("#folder-browser-cancel"),
    folderBrowserList: $("#folder-browser-list"),
    folderBrowserSummary: $("#folder-browser-summary"),
    folderSelectAll: $("#folder-select-all"),
    folderSelectionCount: $("#folder-selection-count"),
    folderImportConfirm: $("#folder-import-confirm"),
    dropzone: $("#dropzone"),
    trackList: $("#track-list"),
    emptyNote: $("#empty-note"),
    trackCount: $("#track-count"),
    clear: $("#clear-button"),
    crossfade: $("#crossfade"),
    crossfadeValue: $("#crossfade-value"),
    beatAlign: $("#beat-align"),
    beatTarget: $("#beat-target"),
    mood: $("#mood-select"),
    arrange: $("#arrange-button"),
    arrangeHint: $("#arrange-hint"),
    status: $("#status-message"),
    play: $("#play-button"),
    timeline: $("#timeline"),
    canvas: $("#waveform"),
    progress: $("#timeline-progress"),
    playhead: $("#playhead"),
    time: $("#time-display"),
    nowPlaying: $("#now-playing"),
    currentTrack: $("#current-track"),
    summary: $("#mix-summary"),
    volume: $("#volume"),
    export: $("#export-button"),
    settingsToggle: $("#settings-toggle"),
    settingsPanel: $("#settings-panel"),
    settingsClose: $("#settings-close"),
    token: $("#hf-token"),
    model: $("#hf-model"),
  };
  const COLORS = ["#d0e87a", "#e7a477", "#9dace4", "#d39ad0", "#79c6b6", "#e8c66d", "#8cb7d8"];
  const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const KEY_PROFILES = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  };
  const state = {
    tracks: [],
    audioContext: null,
    master: null,
    sources: [],
    playing: false,
    paused: false,
    startedAt: 0,
    startedPosition: 0,
    position: 0,
    timer: null,
    duration: 0,
    offsets: [],
    timings: [],
    transitions: [],
    targetBpm: null,
    draggingId: null,
    pendingFolderFiles: [],
  };

  function getAudioContext() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser does not support Web Audio. Try the latest Chrome, Safari, or Firefox.");
      state.audioContext = new AudioContextClass();
    }
    return state.audioContext;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(safeSeconds / 60);
    return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
  }

  function showStatus(message, isError = false) {
    elements.status.hidden = !message;
    elements.status.textContent = message;
    elements.status.classList.toggle("error", isError);
  }

  function getTargetBpm() {
    const tempos = state.tracks.map((track) => track.bpm).filter((bpm) => Number.isFinite(bpm)).sort((a, b) => a - b);
    if (!tempos.length) return null;
    const middle = Math.floor(tempos.length / 2);
    return Math.round(tempos.length % 2 ? tempos[middle] : (tempos[middle - 1] + tempos[middle]) / 2);
  }

  function getTrackTiming(track) {
    const matched = elements.beatAlign.checked && state.targetBpm && track.bpm && track.beatOffset !== null;
    const rate = matched ? Math.max(0.8, Math.min(1.25, state.targetBpm / track.bpm)) : 1;
    const sourceOffset = matched ? track.beatOffset : 0;
    return {
      rate,
      sourceOffset,
      duration: Math.max(0, track.duration - sourceOffset) / rate,
      beatPeriod: matched ? 60 / (track.bpm * rate) : null,
      matched,
    };
  }

  function getTransitionTiming(firstTiming, secondTiming) {
    const requested = Math.min(
      Number(elements.crossfade.value),
      firstTiming.duration / 2,
      secondTiming.duration / 2,
    );
    if (!(firstTiming.matched && secondTiming.matched) || requested <= 0) {
      return { overlap: requested, fadeStart: firstTiming.duration - requested };
    }

    const beatPeriod = firstTiming.beatPeriod;
    const barDuration = beatPeriod * 4;
    const bars = Math.max(1, Math.round(requested / barDuration));
    const overlap = Math.min(bars * barDuration, firstTiming.duration / 2, secondTiming.duration / 2);
    const desiredStart = Math.max(0, firstTiming.duration - overlap);
    const fadeStart = Math.floor((desiredStart + 0.000001) / beatPeriod) * beatPeriod;
    if (fadeStart + overlap > firstTiming.duration + 0.000001) {
      return { overlap: requested, fadeStart: firstTiming.duration - requested };
    }
    return { overlap, fadeStart };
  }

  function updateMix() {
    state.offsets = [];
    state.targetBpm = getTargetBpm();
    state.timings = state.tracks.map(getTrackTiming);
    state.transitions = [];
    let offset = 0;
    state.tracks.forEach((track, index) => {
      state.offsets.push(offset);
      const timing = state.timings[index];
      if (index < state.tracks.length - 1) {
        const transition = getTransitionTiming(timing, state.timings[index + 1]);
        state.transitions.push(transition);
        timing.fadeOutStart = transition.fadeStart;
        timing.playedDuration = transition.fadeStart + transition.overlap;
        offset += transition.fadeStart;
      } else {
        timing.fadeOutStart = timing.duration;
        timing.playedDuration = timing.duration;
      }
      timing.fadeIn = index > 0 ? state.transitions[index - 1].overlap : 0;
    });
    state.duration = state.tracks.length
      ? state.offsets[state.offsets.length - 1] + state.timings[state.timings.length - 1].playedDuration
      : 0;
    const matchedCount = state.tracks.filter((track) => track.bpm && track.beatOffset !== null).length;
    elements.beatTarget.textContent = !state.tracks.length
      ? "Waiting for tracks"
      : elements.beatAlign.checked
        ? state.targetBpm
          ? `${state.targetBpm} BPM target · ${matchedCount}/${state.tracks.length} analyzed`
          : "No reliable beat estimates"
        : "Beat matching off";
    elements.trackCount.textContent = `${state.tracks.length} ${state.tracks.length === 1 ? "track" : "tracks"}`;
    elements.emptyNote.hidden = state.tracks.length > 0;
    elements.clear.disabled = state.tracks.length === 0;
    elements.arrange.disabled = state.tracks.length < 2;
    elements.play.disabled = state.tracks.length === 0;
    elements.export.disabled = state.tracks.length === 0;
    elements.summary.textContent = state.tracks.length
      ? `${state.tracks.length} tracks · ${formatTime(state.duration)} · ${elements.crossfade.value}s crossfade`
      : "Your mix will appear here";
    if (!state.playing) {
      elements.time.innerHTML = `${formatTime(0)} <i>/</i> ${formatTime(state.duration)}`;
      elements.nowPlaying.textContent = state.tracks.length ? "READY WHEN YOU ARE" : "READY WHEN YOU ARE";
      elements.currentTrack.textContent = state.tracks.length ? "Press play to hear your set" : "Add tracks to begin";
    }
    renderTracks();
    drawMixWaveform();
  }

  function waveformSvg(seed) {
    let value = seed;
    const bars = Array.from({ length: 46 }, (_, index) => {
      value = (value * 9301 + 49297) % 233280;
      const noise = value / 233280;
      const envelope = 0.3 + Math.sin((index / 45) * Math.PI) * 0.45;
      const height = Math.round(4 + noise * 18 * envelope);
      return `<rect x="${index * 2.3}" y="${14 - height / 2}" width="1.2" height="${height}" rx=".6"/>`;
    }).join("");
    return `<svg class="track-wave" viewBox="0 0 105 28" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
  }

  function renderTracks() {
    elements.trackList.innerHTML = "";
    state.tracks.forEach((track, index) => {
      const row = document.createElement("article");
      row.className = "track-row";
      row.draggable = true;
      row.dataset.id = track.id;
      const artwork = document.createElement("span");
      artwork.className = "track-art";
      artwork.style.background = `linear-gradient(145deg, ${track.color}, ${track.color}9c)`;
      artwork.textContent = track.key.replace("♯", "#").split(" ")[0];
      const info = document.createElement("span");
      info.className = "track-info";
      const name = document.createElement("strong");
      name.className = "track-name";
      name.title = track.name;
      name.textContent = track.name;
      const sub = document.createElement("span");
      sub.className = "track-sub";
      sub.textContent = `TRACK ${String(index + 1).padStart(2, "0")} · ${formatTime(track.duration)}`;
      info.append(name, sub);
      const metrics = document.createElement("span");
      metrics.className = "track-metrics";
      metrics.innerHTML = `<span>${track.bpm ? `${track.bpm} BPM` : "— BPM"}</span><span>${track.key}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-track";
      remove.setAttribute("aria-label", `Remove ${track.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => removeTrack(track.id));
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⠿";
      handle.setAttribute("aria-label", "Drag to reorder");
      row.append(handle, artwork, info, waveformSvg(index * 127 + track.name.length * 31), metrics, remove);
      row.addEventListener("dragstart", (event) => {
        state.draggingId = track.id;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        state.draggingId = null;
        row.classList.remove("dragging");
        elements.trackList.querySelectorAll(".drag-target").forEach((item) => item.classList.remove("drag-target"));
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (state.draggingId !== track.id) row.classList.add("drag-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-target"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("drag-target");
        moveTrack(state.draggingId, track.id);
      });
      elements.trackList.append(row);
    });
  }

  function moveTrack(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const from = state.tracks.findIndex((track) => track.id === fromId);
    const to = state.tracks.findIndex((track) => track.id === toId);
    if (from < 0 || to < 0) return;
    stopPlayback();
    const [track] = state.tracks.splice(from, 1);
    state.tracks.splice(to, 0, track);
    updateMix();
  }

  function removeTrack(id) {
    stopPlayback();
    state.tracks = state.tracks.filter((track) => track.id !== id);
    updateMix();
  }

  function fft(real, imag) {
    const length = real.length;
    for (let i = 1, j = 0; i < length; i += 1) {
      let bit = length >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let size = 2; size <= length; size <<= 1) {
      const angle = (-2 * Math.PI) / size;
      const wStepReal = Math.cos(angle);
      const wStepImag = Math.sin(angle);
      for (let start = 0; start < length; start += size) {
        let wReal = 1;
        let wImag = 0;
        for (let j = 0; j < size / 2; j += 1) {
          const even = start + j;
          const odd = even + size / 2;
          const tReal = wReal * real[odd] - wImag * imag[odd];
          const tImag = wReal * imag[odd] + wImag * real[odd];
          real[odd] = real[even] - tReal;
          imag[odd] = imag[even] - tImag;
          real[even] += tReal;
          imag[even] += tImag;
          const nextReal = wReal * wStepReal - wImag * wStepImag;
          wImag = wReal * wStepImag + wImag * wStepReal;
          wReal = nextReal;
        }
      }
    }
  }

  function estimateKey(samples, sampleRate) {
    const size = 2048;
    const chroma = new Float64Array(12);
    const hop = Math.floor(sampleRate * 0.65);
    let used = 0;
    for (let start = 0; start + size < samples.length && used < 24; start += hop) {
      const real = new Float64Array(size);
      const imag = new Float64Array(size);
      for (let i = 0; i < size; i += 1) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
        real[i] = samples[start + i] * window;
      }
      fft(real, imag);
      for (let bin = 4; bin < size / 2; bin += 1) {
        const frequency = (bin * sampleRate) / size;
        if (frequency < 55 || frequency > 1500) continue;
        const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
        const magnitude = Math.hypot(real[bin], imag[bin]);
        chroma[((midi % 12) + 12) % 12] += magnitude;
      }
      used += 1;
    }
    const total = chroma.reduce((sum, value) => sum + value, 0);
    if (!total || used < 2) return "Unknown";
    const normalized = Array.from(chroma, (value) => value / total);
    let best = -Infinity;
    let key = "Unknown";
    for (let root = 0; root < 12; root += 1) {
      for (const [mode, profile] of Object.entries(KEY_PROFILES)) {
        let score = 0;
        for (let note = 0; note < 12; note += 1) score += normalized[(note + root) % 12] * profile[note];
        if (score > best) {
          best = score;
          key = `${NOTE_NAMES[root]} ${mode === "major" ? "maj" : "min"}`;
        }
      }
    }
    return key;
  }

  function estimateBpm(samples, sampleRate) {
    const frameSize = Math.max(1, Math.floor(sampleRate * 0.05));
    const frameCount = Math.min(1800, Math.floor(samples.length / frameSize));
    if (frameCount < 40) return { bpm: null, beatOffset: null };
    const envelope = new Float64Array(frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = frame * frameSize;
      const end = Math.min(start + frameSize, samples.length);
      let energy = 0;
      for (let i = start; i < end; i += 1) energy += samples[i] * samples[i];
      envelope[frame] = Math.sqrt(energy / (end - start));
    }
    const onset = new Float64Array(frameCount);
    let mean = 0;
    for (let i = 1; i < frameCount; i += 1) {
      onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
      mean += onset[i];
    }
    mean /= frameCount;
    for (let i = 0; i < frameCount; i += 1) onset[i] = Math.max(0, onset[i] - mean * 0.35);
    let bestScore = 0;
    let bestBpm = null;
    let bestLag = 0;
    for (let lag = 6; lag <= 24; lag += 1) {
      let correlation = 0;
      let normA = 0;
      let normB = 0;
      for (let i = lag; i < frameCount; i += 1) {
        correlation += onset[i] * onset[i - lag];
        normA += onset[i] ** 2;
        normB += onset[i - lag] ** 2;
      }
      const bpm = 1200 / lag;
      const normalized = correlation / (Math.sqrt(normA * normB) || 1);
      const tempoPreference = bpm < 65 ? 0.9 : bpm > 165 ? 0.94 : 1;
      const score = normalized * tempoPreference;
      if (score > bestScore) {
        bestScore = score;
        bestBpm = Math.round(bpm);
        bestLag = lag;
      }
    }
    if (!bestBpm || bestScore < 0.015) return { bpm: null, beatOffset: null };

    const phaseScores = new Float64Array(bestLag);
    for (let frame = 0; frame < frameCount; frame += 1) {
      phaseScores[frame % bestLag] += onset[frame];
    }
    let phaseFrame = 0;
    for (let frame = 1; frame < bestLag; frame += 1) {
      if (phaseScores[frame] > phaseScores[phaseFrame]) phaseFrame = frame;
    }
    let beatOffset = (phaseFrame * frameSize) / sampleRate;
    if (bestBpm < 75) {
      bestBpm *= 2;
      beatOffset %= 60 / bestBpm;
    } else if (bestBpm > 160) {
      bestBpm = Math.round(bestBpm / 2);
    }
    return { bpm: bestBpm, beatOffset };
  }

  function isAudioFile(file) {
    return file.type.startsWith("audio/") || /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|aif|aiff|alac|caf)$/i.test(file.name);
  }

  function updateFolderSelection() {
    const checkboxes = Array.from(elements.folderBrowserList.querySelectorAll('input[type="checkbox"]'));
    const selected = checkboxes.filter((checkbox) => checkbox.checked);
    elements.folderSelectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    elements.folderSelectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
    elements.folderSelectionCount.textContent = `${selected.length} of ${checkboxes.length} selected`;
    elements.folderImportConfirm.disabled = selected.length === 0;
  }

  function showFolderBrowser(files) {
    const audioFiles = Array.from(files).filter(isAudioFile);
    if (!audioFiles.length) {
      showStatus("No supported audio tracks found in that folder.", true);
      return;
    }

    state.pendingFolderFiles = audioFiles;
    elements.folderBrowserList.replaceChildren();
    audioFiles.forEach((file, index) => {
      const row = document.createElement("label");
      row.className = "folder-file-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.index = String(index);
      checkbox.addEventListener("change", updateFolderSelection);
      const info = document.createElement("span");
      info.className = "folder-file-info";
      const name = document.createElement("span");
      name.className = "folder-file-name";
      name.textContent = file.name;
      name.title = file.name;
      const path = document.createElement("span");
      path.className = "folder-file-path";
      path.textContent = file.webkitRelativePath || file.name;
      info.append(name, path);
      const size = document.createElement("span");
      size.className = "folder-file-size";
      size.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
      row.append(checkbox, info, size);
      elements.folderBrowserList.append(row);
    });

    elements.folderBrowserSummary.textContent = `${audioFiles.length} audio ${audioFiles.length === 1 ? "track" : "tracks"} found. Choose which ones to add.`;
    elements.folderBrowser.setAttribute("aria-label", `Folder contains ${audioFiles.length} audio tracks`);
    elements.folderSelectAll.checked = true;
    updateFolderSelection();
    elements.folderBrowser.showModal();
  }

  async function addFiles(files, source = "file") {
    const audioFiles = Array.from(files).filter(isAudioFile);
    if (!audioFiles.length) {
      showStatus(source === "folder"
        ? "No supported audio tracks found in that folder."
        : "Choose audio files such as MP3, WAV, M4A, OGG, or FLAC.", true);
      return;
    }
    const fileIdentity = (file) => `${file.webkitRelativePath || file.name}:${file.size}`;
    const existing = new Set(state.tracks.map((track) => `${track.sourcePath}:${track.size}`));
    const candidates = audioFiles.filter((file) => !existing.has(fileIdentity(file)));
    if (!candidates.length) {
      showStatus("Those tracks are already in your crate.", true);
      return;
    }
    stopPlayback();
    showStatus(`Analyzing ${candidates.length} ${candidates.length === 1 ? "track" : "tracks"} in your browser…`);
    elements.fileInput.disabled = true;
    elements.folderInput.disabled = true;
    try {
      const context = getAudioContext();
      const failures = [];
      for (const file of candidates) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = await context.decodeAudioData(arrayBuffer);
          const mono = new Float32Array(buffer.length);
          for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
          }
          state.tracks.push({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^.]+$/, ""),
            sourcePath: file.webkitRelativePath || file.name,
            size: file.size,
            buffer,
            duration: buffer.duration,
            ...estimateBpm(mono, buffer.sampleRate),
            key: estimateKey(mono, buffer.sampleRate),
            color: COLORS[state.tracks.length % COLORS.length],
          });
        } catch {
          failures.push(file.name);
        }
      }
      if (failures.length) {
        const names = failures.slice(0, 3).join(", ");
        const more = failures.length > 3 ? ` and ${failures.length - 3} more` : "";
        showStatus(`Imported ${candidates.length - failures.length} of ${candidates.length} tracks. Could not read: ${names}${more}.`, true);
      } else {
        showStatus(`Imported ${candidates.length} ${candidates.length === 1 ? "track" : "tracks"} successfully.`);
      }
      updateMix();
    } catch (error) {
      showStatus(error.message || "Something went wrong while loading your tracks.", true);
      updateMix();
    } finally {
      elements.fileInput.disabled = false;
      elements.folderInput.disabled = false;
      elements.fileInput.value = "";
      elements.folderInput.value = "";
    }
  }

  function pitchClass(key) {
    const root = key.split(" ")[0];
    return NOTE_NAMES.indexOf(root);
  }

  function keyDistance(first, second) {
    if (first === "Unknown" || second === "Unknown") return 0.35;
    const a = pitchClass(first);
    const b = pitchClass(second);
    const distance = Math.min((a - b + 12) % 12, (b - a + 12) % 12);
    const sameMode = first.split(" ")[1] === second.split(" ")[1];
    if (distance === 0 && sameMode) return 1;
    if (distance === 0) return 0.82;
    if (distance === 1 && sameMode) return 0.72;
    if (distance === 2 && sameMode) return 0.64;
    if (distance === 5 && sameMode) return 0.56;
    return Math.max(0.1, 0.48 - distance * 0.045);
  }

  function energy(track) {
    const samples = track.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(samples.length / 50000));
    let sum = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i += step) {
      sum += samples[i] * samples[i];
      count += 1;
    }
    return Math.sqrt(sum / Math.max(1, count));
  }

  function smartOrder(tracks, mood) {
    if (tracks.length < 3) return tracks.slice();
    const ascending = tracks.slice().sort((a, b) => energy(a) - energy(b));
    const energies = new Map(ascending.map((track, index) => [
      track.id,
      index / Math.max(1, ascending.length - 1),
    ]));
    let remaining = tracks.slice();
    let ordered;
    if (mood === "build" || mood === "chill") {
      ordered = mood === "build" ? [ascending[0]] : [ascending[ascending.length - 1]];
      remaining = ascending.slice(mood === "build" ? 1 : 0, mood === "chill" ? -1 : undefined);
      if (mood === "chill") remaining = ascending.slice(0, -1).reverse();
    } else {
      const first = tracks[0];
      ordered = [first];
      remaining = tracks.filter((track) => track.id !== first.id);
    }
    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      const targetLevel = mood === "peak" ? 0.8 : 0.5;
      const next = remaining.reduce((best, candidate) => {
        const tempoFit = last.bpm && candidate.bpm
          ? Math.max(...[0.5, 1, 2].map((ratio) => Math.max(0, 1 - Math.abs(last.bpm * ratio - candidate.bpm) / 18)))
          : 0.45;
        const harmonicFit = keyDistance(last.key, candidate.key);
        const energyFit = 1 - Math.min(1, Math.abs(energies.get(candidate.id) - targetLevel) * 2);
        const score = tempoFit * 0.46 + harmonicFit * 0.34 + energyFit * 0.2;
        return !best || score > best.score ? { track: candidate, score } : best;
      }, null);
      ordered.push(next.track);
      remaining = remaining.filter((track) => track.id !== next.track.id);
    }
    return ordered;
  }

  async function aiOrder(tracks) {
    const token = elements.token.value.trim();
    const model = elements.model.value.trim();
    if (!token) return smartOrder(tracks, elements.mood.value);
    if (!model) throw new Error("Enter a Hugging Face model ID in AI settings.");
    const payload = {
      model,
      messages: [
        {
          role: "system",
          content: "You are a DJ set sequencing assistant. Arrange the provided audio tracks into a cohesive continuous mix. Prefer close BPMs (including half/double-time), harmonically compatible keys, and the requested energy arc. Return only a JSON array containing every provided track id exactly once, in play order. Do not include markdown or commentary.",
        },
        {
          role: "user",
          content: JSON.stringify({
            direction: elements.mood.options[elements.mood.selectedIndex].text,
            tracks: tracks.map(({ id, name, bpm, key, duration }) => ({ id, title: name, bpm, key, durationSeconds: Math.round(duration) })),
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: Math.min(512, tracks.length * 40),
    };
    const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Hugging Face request failed (${response.status}): ${detail.slice(0, 180)}`);
    }
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("The model returned an unexpected response. Check its availability in Hugging Face Inference Providers.");
    const jsonText = content.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonText) throw new Error("The model did not return a valid track order. Try again or use smart ordering.");
    let ids;
    try {
      ids = JSON.parse(jsonText);
    } catch {
      throw new Error("The model returned invalid JSON. Try again or use smart ordering.");
    }
    if (!Array.isArray(ids) || ids.length !== tracks.length || new Set(ids).size !== tracks.length || ids.some((id) => !tracks.some((track) => track.id === id))) {
      throw new Error("The model returned an incomplete or invalid track order. Try again or use smart ordering.");
    }
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return ids.map((id) => byId.get(id));
  }

  async function arrangeTracks() {
    if (state.tracks.length < 2) return;
    elements.arrange.disabled = true;
    const label = elements.arrange.querySelector("span:nth-child(2)");
    label.textContent = elements.token.value.trim() ? "Asking your model…" : "Finding the flow…";
    elements.arrangeHint.textContent = "Matching tempo, key & energy";
    showStatus("");
    try {
      const order = await aiOrder(state.tracks);
      stopPlayback();
      state.tracks = order;
      updateMix();
      elements.arrangeHint.textContent = elements.token.value.trim() ? "Sequenced by your online model" : "Sequenced on this device — private & fast";
      showStatus(elements.token.value.trim()
        ? `Your set was sequenced by ${elements.model.value.trim()}. Audio stayed on this device.`
        : "Your set is arranged for a smoother tempo, key, and energy flow.");
    } catch (error) {
      showStatus(error.message || "Could not arrange tracks.", true);
    } finally {
      label.textContent = "Arrange my set";
      elements.arrange.disabled = state.tracks.length < 2;
    }
  }

  function scheduleMix(context, destination, masterGain = 1, position = 0, leadIn = 0.08) {
    const master = context.createGain();
    master.gain.value = masterGain;
    master.connect(destination);
    const startTime = context.currentTime + leadIn;
    const sources = [];
    state.tracks.forEach((track, index) => {
      const timing = state.timings[index];
      const trackStart = state.offsets[index];
      const trackEnd = trackStart + timing.playedDuration;
      if (trackEnd <= position) return;
      const localPosition = Math.max(0, position - trackStart);
      const sourceOffset = timing.sourceOffset + localPosition * timing.rate;
      const scheduledAt = startTime + Math.max(0, trackStart - position);
      const remaining = timing.playedDuration - localPosition;
      if (remaining <= 0) return;
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      source.playbackRate.value = timing.rate;
      const gain = context.createGain();
      source.connect(gain);
      gain.connect(master);
      const fadeIn = timing.fadeIn;
      const transition = state.transitions[index];
      const fadeOut = transition?.overlap || 0;
      const fadeOutStart = timing.fadeOutStart;
      const gainAtOffset = fadeIn > 0 && localPosition < fadeIn
        ? localPosition / fadeIn
        : fadeOut > 0 && localPosition > fadeOutStart
          ? Math.max(0, (timing.playedDuration - localPosition) / fadeOut)
          : 1;
      gain.gain.setValueAtTime(gainAtOffset, scheduledAt);
      if (fadeIn > localPosition) {
        gain.gain.linearRampToValueAtTime(1, scheduledAt + fadeIn - localPosition);
      }
      if (fadeOut > 0 && localPosition < fadeOutStart) {
        const fadeStart = scheduledAt + fadeOutStart - localPosition;
        gain.gain.setValueAtTime(1, fadeStart);
        gain.gain.linearRampToValueAtTime(0, scheduledAt + timing.playedDuration - localPosition);
      } else if (fadeOut > 0 && localPosition < timing.playedDuration) {
        gain.gain.linearRampToValueAtTime(0, scheduledAt + timing.playedDuration - localPosition);
      }
      source.start(scheduledAt, sourceOffset);
      source.stop(scheduledAt + remaining);
      sources.push(source);
    });
    return { master, startTime, sources };
  }

  async function startPlayback(position = state.position) {
    if (!state.tracks.length) return;
    try {
      const context = getAudioContext();
      await context.resume();
      if (position >= state.duration) position = 0;
      if (state.sources.length) {
        if (state.master && state.playing) {
          state.master.gain.cancelScheduledValues(context.currentTime);
          state.master.gain.setValueAtTime(state.master.gain.value, context.currentTime);
          state.master.gain.linearRampToValueAtTime(0, context.currentTime + 0.025);
        }
        state.sources.forEach((source) => {
          try { source.stop(context.currentTime + 0.03); } catch { /* A source may already have ended. */ }
        });
      }
      const scheduled = scheduleMix(context, context.destination, Number(elements.volume.value), position);
      state.master = scheduled.master;
      state.sources = scheduled.sources;
      state.startedAt = scheduled.startTime;
      state.startedPosition = position;
      state.position = position;
      state.playing = true;
      state.paused = false;
      elements.play.classList.add("is-playing");
      elements.play.setAttribute("aria-label", "Pause mix");
      clearInterval(state.timer);
      state.timer = setInterval(updatePlaybackPosition, 100);
      updatePlaybackPosition();
    } catch (error) {
      showStatus(error.message || "Could not play this mix.", true);
    }
  }

  async function pausePlayback() {
    if (!state.audioContext || !state.playing) return;
    updatePlaybackPosition();
    if (!state.playing) return;
    state.playing = false;
    state.paused = true;
    clearInterval(state.timer);
    await state.audioContext.suspend();
    elements.play.classList.remove("is-playing");
    elements.play.setAttribute("aria-label", "Resume mix");
  }

  function stopPlayback() {
    if (state.audioContext) {
      state.sources.forEach((source) => {
        try { source.stop(); } catch { /* A source may already have ended. */ }
      });
    }
    state.sources = [];
    state.playing = false;
    state.paused = false;
    state.position = 0;
    clearInterval(state.timer);
    elements.play.classList.remove("is-playing");
    elements.play.setAttribute("aria-label", "Play mix");
    elements.progress.style.width = "0%";
    elements.playhead.style.left = "0%";
    updateMix();
  }

  function updatePlaybackPosition() {
    if (!state.audioContext || !state.playing) return;
    const elapsed = state.startedPosition + Math.max(0, state.audioContext.currentTime - state.startedAt);
    if (elapsed >= state.duration) {
      state.playing = false;
      state.paused = false;
      state.position = state.duration;
      clearInterval(state.timer);
      elements.play.classList.remove("is-playing");
      elements.play.setAttribute("aria-label", "Play mix");
      elements.progress.style.width = "100%";
      elements.playhead.style.left = "100%";
      elements.time.innerHTML = `${formatTime(state.duration)} <i>/</i> ${formatTime(state.duration)}`;
      elements.nowPlaying.textContent = "MIX COMPLETE";
      elements.currentTrack.textContent = "That’s a wrap";
      return;
    }
    state.position = elapsed;
    const progress = state.duration ? (elapsed / state.duration) * 100 : 0;
    const trackIndex = state.offsets.findIndex((offset, index) => index === state.offsets.length - 1 || elapsed < state.offsets[index + 1]);
    const track = state.tracks[Math.max(0, trackIndex)];
    elements.progress.style.width = `${progress}%`;
    elements.playhead.style.left = `${progress}%`;
    elements.timeline.setAttribute("aria-valuenow", String(Math.round(progress)));
    elements.time.innerHTML = `${formatTime(elapsed)} <i>/</i> ${formatTime(state.duration)}`;
    elements.nowPlaying.textContent = track ? `NOW PLAYING · ${track.name.toUpperCase()}` : "NOW PLAYING";
    elements.currentTrack.textContent = track ? track.name : "Your continuous mix";
  }

  function drawMixWaveform() {
    const canvas = elements.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const context = canvas.getContext("2d");
    context.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    if (!state.tracks.length) return;
    const total = state.duration || 1;
    state.tracks.forEach((track, trackIndex) => {
      const start = (state.offsets[trackIndex] / total) * width;
      const timing = state.timings[trackIndex];
      const end = ((state.offsets[trackIndex] + timing.playedDuration) / total) * width;
      const samples = track.buffer.getChannelData(0);
      const pixels = Math.max(1, Math.ceil(end - start));
      context.fillStyle = track.color;
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const localTime = (pixel / pixels) * timing.playedDuration;
        const sourceFrame = Math.floor((timing.sourceOffset + localTime * timing.rate) * track.buffer.sampleRate);
        const from = Math.max(0, sourceFrame);
        const bin = Math.max(1, Math.floor((timing.rate * track.buffer.sampleRate * timing.playedDuration) / pixels));
        const to = Math.min(from + bin, samples.length);
        const stride = Math.max(1, Math.floor(bin / 24));
        let peak = 0;
        for (let i = from; i < to; i += stride) peak = Math.max(peak, Math.abs(samples[i]));
        const barHeight = Math.max(2, peak * height * 1.6);
        context.globalAlpha = 0.42 + Math.min(peak, 0.6) * 0.48;
        context.fillRect(start + pixel, (height - barHeight) / 2, Math.max(1, width / pixels * 0.57), barHeight);
      }
    });
    context.globalAlpha = 1;
  }

  function seekToPointer(event) {
    if (!state.tracks.length || !state.duration) return;
    const rect = elements.timeline.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    state.position = progress * state.duration;
    elements.progress.style.width = `${progress * 100}%`;
    elements.playhead.style.left = `${progress * 100}%`;
    elements.timeline.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    elements.time.innerHTML = `${formatTime(state.position)} <i>/</i> ${formatTime(state.duration)}`;
    const trackIndex = state.offsets.findIndex((offset, index) => index === state.offsets.length - 1 || state.position < state.offsets[index + 1]);
    const track = state.tracks[Math.max(0, trackIndex)];
    elements.nowPlaying.textContent = track ? `QUEUED · ${track.name.toUpperCase()}` : "READY WHEN YOU ARE";
    elements.currentTrack.textContent = track ? track.name : "Press play to hear your set";
    if (state.playing) startPlayback(state.position);
    else if (state.paused) {
      state.sources.forEach((source) => {
        try { source.stop(); } catch { /* A source may already have ended. */ }
      });
      state.sources = [];
    }
  }

  async function writeWav(buffer, onProgress) {
    const channels = 2;
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;
    const bytesPerSample = 2;
    const dataSize = frames * channels * bytesPerSample;
    const array = new ArrayBuffer(44 + dataSize);
    const view = new DataView(array);
    const samples = new Int16Array(array, 44);
    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const chunkSize = 1_048_576;
    for (let start = 0; start < frames; start += chunkSize) {
      const end = Math.min(start + chunkSize, frames);
      for (let i = start; i < end; i += 1) {
        const l = Math.max(-1, Math.min(1, left[i]));
        const r = Math.max(-1, Math.min(1, right[i]));
        samples[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
        samples[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      }
      onProgress(end / frames);
      if (end < frames) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Blob([array], { type: "audio/wav" });
  }

  async function exportMix() {
    if (!state.tracks.length || state.duration <= 0) return;
    elements.export.disabled = true;
    const label = elements.export.innerHTML;
    elements.export.textContent = "Rendering…";
    showStatus("Rendering audio at 44.1 kHz…");
    try {
      const sampleRate = 44100;
      const length = Math.ceil(state.duration * sampleRate);
      const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineContext) throw new Error("WAV export is not supported by this browser.");
      const offline = new OfflineContext(2, length, sampleRate);
      scheduleMix(offline, offline.destination, 0.94, 0, 0);
      const rendered = await offline.startRendering();
      showStatus("Audio rendered. Preparing WAV…");
      const blob = await writeWav(rendered, (progress) => {
        showStatus(`Preparing WAV · ${Math.round(progress * 100)}%`);
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mixroom-set-${new Date().toISOString().slice(0, 10)}.wav`;
      showStatus(`WAV ready · ${(blob.size / (1024 * 1024)).toFixed(1)} MB · starting download…`);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      showStatus(error.message || "Could not render the WAV. Try a shorter set or another browser.", true);
    } finally {
      elements.export.disabled = state.tracks.length === 0;
      elements.export.innerHTML = label;
    }
  }

  elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  elements.folderInput.addEventListener("change", (event) => showFolderBrowser(event.target.files));
  elements.browseFiles.addEventListener("click", () => elements.fileInput.click());
  elements.browseFolder.addEventListener("click", () => elements.folderInput.click());
  elements.folderSelectAll.addEventListener("change", () => {
    elements.folderBrowserList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = elements.folderSelectAll.checked;
    });
    updateFolderSelection();
  });
  elements.folderBrowserClose.addEventListener("click", () => elements.folderBrowser.close());
  elements.folderBrowserCancel.addEventListener("click", () => elements.folderBrowser.close());
  elements.folderImportConfirm.addEventListener("click", () => {
    const selectedFiles = Array.from(elements.folderBrowserList.querySelectorAll('input[type="checkbox"]:checked'))
      .map((checkbox) => state.pendingFolderFiles[Number(checkbox.dataset.index)])
      .filter(Boolean);
    elements.folderBrowser.close();
    state.pendingFolderFiles = [];
    addFiles(selectedFiles, "folder");
  });
  elements.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("drag-over");
  });
  elements.dropzone.addEventListener("dragleave", (event) => {
    if (!elements.dropzone.contains(event.relatedTarget)) elements.dropzone.classList.remove("drag-over");
  });
  elements.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("drag-over");
    addFiles(event.dataTransfer.files);
  });
  elements.crossfade.addEventListener("input", () => {
    stopPlayback();
    elements.crossfadeValue.textContent = elements.crossfade.value;
    updateMix();
  });
  elements.beatAlign.addEventListener("change", () => {
    stopPlayback();
    updateMix();
  });
  elements.arrange.addEventListener("click", arrangeTracks);
  elements.clear.addEventListener("click", () => {
    stopPlayback();
    state.tracks = [];
    showStatus("");
    updateMix();
  });
  elements.play.addEventListener("click", () => {
    if (state.playing) pausePlayback();
    else startPlayback();
  });
  elements.volume.addEventListener("input", () => {
    if (state.master) state.master.gain.setTargetAtTime(Number(elements.volume.value), state.audioContext.currentTime, 0.025);
  });
  elements.timeline.addEventListener("click", seekToPointer);
  elements.timeline.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 5 : -5;
      const current = Number(elements.timeline.getAttribute("aria-valuenow")) || 0;
      const next = Math.max(0, Math.min(100, current + step));
      seekToPointer({ clientX: elements.timeline.getBoundingClientRect().left + (next / 100) * elements.timeline.clientWidth });
    }
  });
  elements.export.addEventListener("click", exportMix);
  elements.settingsToggle.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
    elements.settingsToggle.setAttribute("aria-expanded", String(!elements.settingsPanel.hidden));
    if (!elements.settingsPanel.hidden) elements.settingsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  elements.settingsClose.addEventListener("click", () => {
    elements.settingsPanel.hidden = true;
    elements.settingsToggle.setAttribute("aria-expanded", "false");
  });
  window.mixroomNativeDownloadFinished = () => showStatus("WAV saved to your Documents folder.");
  window.mixroomNativeDownloadFailed = (message) => showStatus(message, true);
  window.addEventListener("resize", drawMixWaveform);

  updateMix();
})();
