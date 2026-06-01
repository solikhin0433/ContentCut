// ==========================================================================
// 1. STATE & GLOBAL VARIABLES
// ==========================================================================
let timelineSlider = null;
let currentDuration = 0;

// Last Cut Video Globals
window.lastCutVideoBlob = null;
window.lastCutVideoUrl = "";
window.lastVideoName = "";

// MediaPipe Cache
window.mpPoseInstance = null;
window.cachedPoseLandmarks = null;
let lastPoseInferenceTime = 0;

// Speech Recognition Globals
let speechRecognitionInstance = null;

// Studio Workspace State
let studioState = {
  activeTab: "tab-media",
  zoom: 15, // Pixels per second on timeline
  isPlaying: false,
  currentTime: 0,
  duration: 10, // Default project duration, updated dynamically
  selectedClip: null, // Currently selected clip object
  dragTarget: null, // Either 'pip', a text clip object, or handle
  dragStartOffset: { x: 0, y: 0 },
  poseDetectionEnabled: false,

  // Canvas Configuration
  aspectRatio: "16:9",
  canvasBg: {
    type: "color", // 'color', 'blur', 'image'
    color: "#000000",
    image: null,
    imageUrl: "",
  },

  // Project Media Tracks
  video: null, // Main video: { element, src, name, startTime, duration, originalDuration, speed, volume, audioFilter, audioFreq }
  pip: null, // Overlay: { id, type: 'video'|'image', element, src, name, startTime, duration, x, y, width, height, speed, volume, chromaKey: { enabled, color, tolerance }, keyframes: [], audioFilter, audioFreq }
  texts: [], // Texts: { id, type: 'text', text, startTime, duration, x, y, size, color, strokeColor, strokeWidth, shadowColor, fontFamily, keyframes: [] }
  audio: [], // Audio tracks: { id, type: 'audio', element, src, name, startTime, duration, startOffset, volume, audioFilter, audioFreq }

  // Global visual filters
  filters: {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    grayscale: 0,
    sepia: 0,
    huerotate: 0,
    blur: 0,
    glitch: false,
  },
};

// Web Audio API context
let audioCtx = null;
let audioNodes = {
  merger: null,
  mainVideo: null, // { source, filter }
  pip: null, // { source, filter }
  musics: {}, // Map of audio clip ID -> { source, filter, gain }
};

// Export context
let exportRecorder = null;
let exportChunks = [];
let isExporting = false;
let exportTimer = null;
let canvasAnimFrameId = null;

// ==========================================================================
// 2. HELPER FUNCTIONS & SCRIPT LOADERS
// ==========================================================================
function secToTime(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function timeToSec(time) {
  const parts = time.split(":").reverse();
  let sec = 0;
  for (let i = 0; i < parts.length; i++) {
    sec += parseInt(parts[i]) * Math.pow(60, i);
  }
  return sec;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Keyframe Interpolation Logic
function getInterpolatedProperties(clip, time) {
  if (!clip.keyframes || clip.keyframes.length === 0) {
    return {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      size: clip.size,
    };
  }

  const kfs = clip.keyframes;

  if (time <= kfs[0].time) {
    return {
      x: kfs[0].x,
      y: kfs[0].y,
      width: kfs[0].width,
      height: kfs[0].height,
      size: kfs[0].size,
    };
  }
  if (time >= kfs[kfs.length - 1].time) {
    const last = kfs[kfs.length - 1];
    return {
      x: last.x,
      y: last.y,
      width: last.width,
      height: last.height,
      size: last.size,
    };
  }

  for (let i = 0; i < kfs.length - 1; i++) {
    const kf1 = kfs[i];
    const kf2 = kfs[i + 1];
    if (time >= kf1.time && time <= kf2.time) {
      const t = (time - kf1.time) / (kf2.time - kf1.time);
      return {
        x: Math.round(kf1.x + (kf2.x - kf1.x) * t),
        y: Math.round(kf1.y + (kf2.y - kf1.y) * t),
        width:
          kf1.width && kf2.width
            ? Math.round(kf1.width + (kf2.width - kf1.width) * t)
            : clip.width,
        height:
          kf1.height && kf2.height
            ? Math.round(kf1.height + (kf2.height - kf1.height) * t)
            : clip.height,
        size:
          kf1.size && kf2.size
            ? Math.round(kf1.size + (kf2.size - kf1.size) * t)
            : clip.size,
      };
    }
  }
  return {
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: clip.height,
    size: clip.size,
  };
}

// ==========================================================================
// 3. CORE VIDEO CUTTER ENGINE
// ==========================================================================
async function getVideoInfo() {
  const url = document.getElementById("videoUrl").value.trim();
  if (!url) return alert("Masukkan URL video dulu!");

  const btn = document.getElementById("btnInfo");
  btn.disabled = true;
  btn.textContent = "Mengambil...";
  hideErr();

  try {
    const res = await fetch("/api/video/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Gagal ambil info");

    const d = data.data;
    currentDuration = d.duration;

    // Setup Video Player
    const player = document.getElementById("videoPlayer");
    const thumb = document.getElementById("thumb");

    if (d.preview_url) {
      player.src = d.preview_url;
      player.classList.remove("hidden");
      thumb.classList.add("hidden");
    } else {
      player.classList.add("hidden");
      thumb.src = d.thumbnail || "";
      thumb.classList.remove("hidden");
    }

    document.getElementById("vTitle").textContent = d.title;
    document.getElementById("vUploader").textContent = d.uploader;
    document.getElementById("vDuration").textContent = secToTime(d.duration);
    document.getElementById("vPlatform").textContent = d.platform;

    const initialEnd = Math.min(d.duration, 60);
    document.getElementById("startTime").value = "00:00:00";
    document.getElementById("endTime").value = secToTime(initialEnd);

    initSlider(0, d.duration, initialEnd);

    show("infoCard");
    show("step-cut");
  } catch (e) {
    showErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Cek Video";
  }
}

function initSlider(min, max, initialEnd) {
  const slider = document.getElementById("timeline-slider");

  if (timelineSlider) {
    timelineSlider.destroy();
  }

  noUiSlider.create(slider, {
    start: [0, initialEnd],
    connect: true,
    step: 1,
    range: {
      min: min,
      max: max,
    },
    behaviour: "tap-drag",
  });

  timelineSlider = slider.noUiSlider;

  timelineSlider.on("update", function (values, handle) {
    const start = Math.round(values[0]);
    const end = Math.round(values[1]);

    document.getElementById("slider-start-label").textContent =
      secToTime(start);
    document.getElementById("slider-end-label").textContent = secToTime(end);

    document.getElementById("startTime").value = secToTime(start);
    document.getElementById("endTime").value = secToTime(end);

    // Preview video saat slider digeser
    const player = document.getElementById("videoPlayer");
    if (player.src) {
      player.currentTime = handle === 0 ? start : end;
    }
  });
}

function updateSliderFromInputs() {
  if (!timelineSlider) return;
  const start = timeToSec(document.getElementById("startTime").value);
  const end = timeToSec(document.getElementById("endTime").value);
  timelineSlider.set([start, end]);
}

let progressTimer;
async function cutVideo() {
  const url = document.getElementById("videoUrl").value.trim();
  const start = document.getElementById("startTime").value.trim();
  const end = document.getElementById("endTime").value.trim();
  const qual = document.getElementById("quality").value;
  const aspect = document.getElementById("aspectRatio").value;
  const crop = document.getElementById("cropPosition").value;

  if (!url || !start || !end) return alert("Lengkapi semua field!");

  hide("step-cut");
  show("progressCard");
  hideErr();
  startProgress();

  try {
    const res = await fetch("/api/video/cut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        start_time: start,
        end_time: end,
        quality: qual,
        aspect_ratio: aspect,
        crop_position: crop,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.detail || "Gagal proses");
    }

    const blob = await res.blob();

    window.lastCutVideoBlob = blob;
    window.lastCutVideoUrl = URL.createObjectURL(blob);
    window.lastVideoName = `cut_${Date.now()}`;

    stopProgress();
    show("step-cut");
    showModal();
  } catch (e) {
    stopProgress();
    show("step-cut");
    showErr(e.message);
  }
}

function showModal() {
  show("modal-overlay");
}

function closeModal() {
  hide("modal-overlay");
}

function downloadCutVideoDirect() {
  if (!window.lastCutVideoUrl) return;
  const a = Object.assign(document.createElement("a"), {
    href: window.lastCutVideoUrl,
    download: `videocutter_${Date.now()}.mp4`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  closeModal();
}

const STEPS = [
  [15, "Menghubungkan ke platform video..."],
  [35, "Mengunduh video dari URL..."],
  [65, "Pemotongan FFmpeg..."],
  [85, "Mengemas file hasil..."],
  [95, "Selesai..."],
];

function startProgress() {
  let progress = 0,
    step = 0;
  const fill = document.getElementById("barFill");
  progressTimer = setInterval(() => {
    if (step < STEPS.length) {
      const [target, msg] = STEPS[step];
      if (progress < target) {
        progress += 1.5;
        fill.style.width = progress + "%";
      } else {
        document.getElementById("progressMsg").textContent = msg;
        step++;
      }
    }
  }, 150);
}

function stopProgress() {
  clearInterval(progressTimer);
  document.getElementById("barFill").style.width = "0%";
  hide("progressCard");
}

function showErr(msg) {
  document.getElementById("errMsg").textContent = msg;
  show("errCard");
}

function hideErr() {
  hide("errCard");
}

function show(id) {
  document.getElementById(id).classList.remove("hidden");
}

function hide(id) {
  document.getElementById(id).classList.add("hidden");
}

function resetApp() {
  ["infoCard", "step-cut", "errCard", "progressCard", "modal-overlay"].forEach(
    hide,
  );
  document.getElementById("videoUrl").value = "";
  document.getElementById("videoPlayer").removeAttribute("src");
  document.getElementById("videoPlayer").load();
}

// ==========================================================================
// 4. STUDIO EDITOR WORKSPACE ENGINE (CAPCUT CLONE)
// ==========================================================================

function enterStudioDirect() {
  document.getElementById("cutter-app").classList.add("hidden");
  document.getElementById("studio-app").classList.remove("hidden");
  resetStudioState();
}

function openCutVideoInStudio() {
  closeModal();
  document.getElementById("cutter-app").classList.add("hidden");
  document.getElementById("studio-app").classList.remove("hidden");

  resetStudioState();
  if (window.lastCutVideoUrl) {
    loadMainVideoFromUrl(
      window.lastCutVideoUrl,
      window.lastVideoName || "Hasil Cutter",
    );
  }
}

function exitStudio() {
  stopVideo();
  if (canvasAnimFrameId) cancelAnimationFrame(canvasAnimFrameId);
  document.getElementById("studio-app").classList.add("hidden");
  document.getElementById("cutter-app").classList.remove("hidden");
}

function resetStudioState() {
  studioState = {
    activeTab: "tab-media",
    zoom: 15,
    isPlaying: false,
    currentTime: 0,
    duration: 10,
    selectedClip: null,
    dragTarget: null,
    dragStartOffset: { x: 0, y: 0 },
    poseDetectionEnabled: false,
    aspectRatio: "16:9",
    canvasBg: { type: "color", color: "#000000", image: null, imageUrl: "" },
    video: null,
    pip: null,
    texts: [],
    audio: [],
    filters: {
      brightness: 100,
      contrast: 100,
      saturate: 100,
      grayscale: 0,
      sepia: 0,
      huerotate: 0,
      blur: 0,
      glitch: false,
    },
  };

  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  audioNodes = { merger: null, mainVideo: null, pip: null, musics: {} };

  // Reset UI
  document.getElementById("canvasPlaceholder").classList.remove("hidden");
  document.getElementById("btnPlayPause").disabled = true;
  document.getElementById("btnStop").disabled = true;
  document.getElementById("btnSplit").disabled = true;
  document.getElementById("btnDelete").disabled = true;

  document.getElementById("filter-pose").checked = false;
  document.getElementById("pose-loading-status").classList.add("hidden");
  window.cachedPoseLandmarks = null;

  document.getElementById("pipList").innerHTML =
    '<span class="no-assets">Belum ada overlay</span>';
  document.getElementById("audioList").innerHTML =
    '<span class="no-assets">Belum ada musik</span>';

  document.getElementById("filter-brightness").value = 100;
  document.getElementById("filter-contrast").value = 100;
  document.getElementById("filter-saturate").value = 100;
  document.getElementById("filter-grayscale").value = 0;
  document.getElementById("filter-sepia").value = 0;
  document.getElementById("filter-huerotate").value = 0;
  document.getElementById("filter-blur").value = 0;
  document.getElementById("filter-glitch").checked = false;

  document.getElementById("canvasRatio").value = "16:9";
  const rDirect = document.getElementById("canvasRatioDirect");
  if (rDirect) rDirect.value = "16:9";
  document.getElementById("canvasBgType").value = "color";
  document.getElementById("canvasBgColor").value = "#000000";
  document.getElementById("canvasBgColorGroup").classList.remove("hidden");
  document.getElementById("canvasBgImageGroup").classList.add("hidden");

  switchLibraryTab("tab-media");
  updateInspector();
  drawTimeline();
}

function switchLibraryTab(tabId) {
  studioState.activeTab = tabId;
  document
    .querySelectorAll(".library-tabs .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".library-content .tab-content")
    .forEach((c) => c.classList.remove("active"));

  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) activeBtn.classList.add("active");

  const activeContent = document.getElementById(tabId);
  if (activeContent) activeContent.classList.add("active");
}

function initStudioAudio() {
  if (audioCtx) return;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioCtxClass();

  audioNodes.merger = audioCtx.createGain();
  audioNodes.merger.connect(audioCtx.destination);
}

// --------------------------------------------------------------------------
// 4A. LOAD MAIN VIDEO & OVERLAYS
// --------------------------------------------------------------------------
function loadMainVideo(event) {
  const file = event.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  loadMainVideoFromUrl(url, file.name);
}

function loadMainVideoFromUrl(url, name) {
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.preload = "auto";

  video.onloadedmetadata = function () {
    studioState.duration = video.duration;
    studioState.video = {
      element: video,
      src: url,
      name: name,
      startTime: 0,
      duration: video.duration,
      originalDuration: video.duration,
      speed: 1.0,
      volume: 1.0,
      scale: 1.0,
      x: 0,
      y: 0,
      audioFilter: "none",
      audioFreq: 1000,
    };

    document.getElementById("canvasPlaceholder").classList.add("hidden");
    document.getElementById("btnPlayPause").disabled = false;
    document.getElementById("btnStop").disabled = false;
    document.getElementById("durationDisplay").textContent = secToTime(
      video.duration,
    );
    document.getElementById("studioProjectTitle").textContent =
      `Studio - ${name}`;

    // Web Audio Setup with DSP Filter Node
    initStudioAudio();
    if (audioCtx) {
      const source = audioCtx.createMediaElementSource(video);
      const filter = audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;

      source.connect(filter);
      filter.connect(audioNodes.merger);

      audioNodes.mainVideo = { source, filter };
    }

    if (canvasAnimFrameId) cancelAnimationFrame(canvasAnimFrameId);
    canvasAnimFrameId = requestAnimationFrame(renderCanvasFrame);

    selectClip(studioState.video, "video");
    drawTimeline();
  };

  video.onerror = function () {
    alert("Gagal memuat video.");
  };
}

function addPipOverlay(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const type = file.type.startsWith("video") ? "video" : "image";

  if (type === "video") {
    const el = document.createElement("video");
    el.src = url;
    el.crossOrigin = "anonymous";
    el.preload = "auto";

    el.onloadedmetadata = function () {
      studioState.pip = {
        id: "pip-" + Date.now(),
        type: "video",
        element: el,
        src: url,
        name: file.name,
        startTime: 0,
        duration: Math.min(el.duration, studioState.duration),
        originalDuration: el.duration,
        x: 100,
        y: 100,
        width: 400,
        height: 225,
        speed: 1.0,
        volume: 0.8,
        chromaKey: { enabled: false, color: "#00ff00", tolerance: 30 },
        keyframes: [],
        audioFilter: "none",
        audioFreq: 1000,
      };

      initStudioAudio();
      if (audioCtx) {
        const source = audioCtx.createMediaElementSource(el);
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = 1000;
        filter.Q.value = 1;
        filter.gain.value = 0;

        source.connect(filter);
        filter.connect(audioNodes.merger);

        audioNodes.pip = { source, filter };
      }

      updatePipList();
      selectClip(studioState.pip, "pip");
      drawTimeline();
      if (!studioState.isPlaying) renderCanvasFrame();
    };
  } else {
    const el = new Image();
    el.src = url;
    el.onload = function () {
      studioState.pip = {
        id: "pip-" + Date.now(),
        type: "image",
        element: el,
        src: url,
        name: file.name,
        startTime: 0,
        duration: Math.min(5, studioState.duration),
        x: 100,
        y: 100,
        width: 300,
        height: Math.round(300 * (el.height / el.width)),
        speed: 1.0,
        volume: 0,
        keyframes: [],
      };

      updatePipList();
      selectClip(studioState.pip, "pip");
      drawTimeline();
      if (!studioState.isPlaying) renderCanvasFrame();
    };
  }
}

function updatePipList() {
  const list = document.getElementById("pipList");
  if (!studioState.pip) {
    list.innerHTML = '<span class="no-assets">Belum ada overlay</span>';
    return;
  }
  const pip = studioState.pip;
  list.innerHTML = `
    <div class="asset-item">
      <span>${pip.type === "video" ? "📹" : "🖼️"} ${pip.name}</span>
      <button onclick="removePipOverlay()">Hapus</button>
    </div>
  `;
}

function removePipOverlay() {
  if (studioState.selectedClip === studioState.pip) {
    studioState.selectedClip = null;
    updateInspector();
  }
  studioState.pip = null;
  audioNodes.pip = null;
  updatePipList();
  drawTimeline();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// --------------------------------------------------------------------------
// 4B. AUDIO & MUSIC ENGINE
// --------------------------------------------------------------------------
function addAudioTrack(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const el = document.createElement("audio");
  el.src = url;
  el.preload = "auto";

  el.onloadedmetadata = function () {
    const id = "audio-" + Date.now();
    const clip = {
      id: id,
      type: "audio",
      element: el,
      src: url,
      name: file.name,
      startTime: 0,
      duration: Math.min(el.duration, studioState.duration),
      originalDuration: el.duration,
      startOffset: 0,
      volume: 1.0,
      speed: 1.0,
      audioFilter: "none",
      audioFreq: 1000,
    };

    studioState.audio.push(clip);

    initStudioAudio();
    if (audioCtx) {
      const source = audioCtx.createMediaElementSource(el);
      const filter = audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;

      const gain = audioCtx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioNodes.merger);

      audioNodes.musics[id] = { source, filter, gain };
    }

    updateAudioList();
    selectClip(clip, "audio");
    drawTimeline();
  };
}

function updateAudioList() {
  const list = document.getElementById("audioList");
  if (studioState.audio.length === 0) {
    list.innerHTML = '<span class="no-assets">Belum ada musik</span>';
    return;
  }
  list.innerHTML = studioState.audio
    .map(
      (a) => `
    <div class="asset-item">
      <span>🎵 ${a.name}</span>
      <button onclick="removeAudioTrack('${a.id}')">Hapus</button>
    </div>
  `,
    )
    .join("");
}

function removeAudioTrack(id) {
  const idx = studioState.audio.findIndex((a) => a.id === id);
  if (idx === -1) return;

  const a = studioState.audio[idx];
  if (studioState.selectedClip === a) {
    studioState.selectedClip = null;
    updateInspector();
  }

  a.element.pause();
  studioState.audio.splice(idx, 1);
  delete audioNodes.musics[id];

  updateAudioList();
  drawTimeline();
}

function extractAudioFromVideo() {
  if (!studioState.video) return alert("Pilih video utama dulu!");

  const el = document.createElement("audio");
  el.src = studioState.video.src;
  el.preload = "auto";

  el.onloadedmetadata = function () {
    const id = "audio-extracted-" + Date.now();
    const clip = {
      id: id,
      type: "audio",
      element: el,
      src: studioState.video.src,
      name: "Ekstrak: " + studioState.video.name,
      startTime: 0,
      duration: studioState.video.duration,
      originalDuration: el.duration,
      startOffset: 0,
      volume: 1.0,
      speed: 1.0,
      audioFilter: "none",
      audioFreq: 1000,
    };

    studioState.audio.push(clip);

    setVideoVolume(0);
    const mainVolSlider = document.getElementById("mainVolumeSlider");
    if (mainVolSlider) mainVolSlider.value = 0;

    initStudioAudio();
    if (audioCtx) {
      const source = audioCtx.createMediaElementSource(el);
      const filter = audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;

      const gain = audioCtx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioNodes.merger);

      audioNodes.musics[id] = { source, filter, gain };
    }

    updateAudioList();
    selectClip(clip, "audio");
    drawTimeline();
    alert("Audio berhasil diekstrak! Audio video asli telah di-mute.");
  };
}

// --------------------------------------------------------------------------
// 4C. TEXT ENGINE, PRESETS & AUTO-CAPTIONS
// --------------------------------------------------------------------------
function addNewText() {
  const id = "text-" + Date.now();
  const textClip = {
    id: id,
    type: "text",
    text: "Klik untuk Mengubah Teks",
    startTime: Math.max(0, studioState.currentTime - 1.5),
    duration: 3,
    x: studioState.aspectRatio === "9:16" ? 202 : 640,
    y: 360,
    size: 40,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 2,
    shadowColor: "#000000",
    fontFamily: "Plus Jakarta Sans",
    keyframes: [],
  };

  studioState.texts.push(textClip);
  selectClip(textClip, "text");
  drawTimeline();
  if (!studioState.isPlaying) renderCanvasFrame();
}

function addPresetText(
  text,
  color,
  size,
  strokeColor = "#000000",
  strokeWidth = 0,
) {
  const id = "text-" + Date.now();
  const textClip = {
    id: id,
    type: "text",
    text: text,
    startTime: Math.max(0, studioState.currentTime - 1),
    duration: 3.5,
    x: studioState.aspectRatio === "9:16" ? 202 : 640,
    y: 400,
    size: size,
    color: color,
    strokeColor: strokeColor,
    strokeWidth: strokeWidth,
    shadowColor: strokeWidth > 0 ? "#000000" : "",
    fontFamily:
      strokeColor === "#ff007f" ? "Space Grotesk" : "Plus Jakarta Sans",
    keyframes: [],
  };

  studioState.texts.push(textClip);
  selectClip(textClip, "text");
  drawTimeline();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// Web Speech API Auto-Captions (Speech-to-Text)
function startAutoCaptions() {
  if (!studioState.video)
    return alert("Pilih dan muat video utama terlebih dahulu!");

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    return alert(
      "Browser Anda tidak mendukung Web Speech Recognition. Gunakan Chrome atau Edge.",
    );
  }

  const btn = document.getElementById("btnAutoCaptions");
  btn.textContent = "🎙️ Mendengarkan Suara...";
  btn.classList.add("recording");

  if (speechRecognitionInstance) {
    try {
      speechRecognitionInstance.stop();
    } catch (e) {}
  }

  speechRecognitionInstance = new SpeechRec();
  speechRecognitionInstance.lang = "id-ID"; // Bahasa Indonesia
  speechRecognitionInstance.continuous = true;
  speechRecognitionInstance.interimResults = false;

  speechRecognitionInstance.onresult = function (e) {
    const result = e.results[e.results.length - 1];
    if (result.isFinal) {
      const transcript = result[0].transcript.trim();
      if (!transcript) return;

      const end = studioState.currentTime;
      const wordCount = transcript.split(" ").length;
      const calculatedDuration = Math.max(1.5, wordCount * 0.4);
      const start = Math.max(0, end - calculatedDuration);

      const id = "text-caption-" + Date.now();
      const caption = {
        id: id,
        type: "text",
        text: transcript,
        startTime: start,
        duration: calculatedDuration,
        x: studioState.aspectRatio === "9:16" ? 202 : 640,
        y: studioState.aspectRatio === "9:16" ? 560 : 600, // standard subtitle height
        size: 32,
        color: "#ffff00", // subtitle yellow
        strokeColor: "#000000",
        strokeWidth: 3,
        shadowColor: "#000000",
        fontFamily: "Plus Jakarta Sans",
        keyframes: [],
      };

      studioState.texts.push(caption);
      drawTimeline();
      if (!studioState.isPlaying) renderCanvasFrame();
    }
  };

  speechRecognitionInstance.onerror = function (e) {
    console.log("Speech recognition error: ", e);
  };

  speechRecognitionInstance.onend = function () {
    btn.textContent = "🎙️ Auto-Captions (Lokal) ✨";
    btn.classList.remove("recording");
  };

  // Seek video to start and play
  stopVideo();
  playVideo();
  speechRecognitionInstance.start();
}

// --------------------------------------------------------------------------
// 4D. TIMELINE UI DRAWING & MOUSE INTERACTION
// --------------------------------------------------------------------------
function handleTimelineScroll() {
  const ruler = document.getElementById("timelineRuler");
  const scrollArea = document.getElementById("timelineScrollArea");
  ruler.style.left = -scrollArea.scrollLeft + "px";
}

function drawRulerTicks(width) {
  const ruler = document.getElementById("timelineRuler");
  ruler.innerHTML = "";

  const zoom = studioState.zoom;
  const majorInterval = 5;
  const minorInterval = 1;

  const totalSeconds = width / zoom;
  for (let s = 0; s <= totalSeconds; s += minorInterval) {
    const tick = document.createElement("div");
    tick.style.left = 120 + s * zoom + "px";

    if (s % majorInterval === 0) {
      tick.className = "ruler-tick";
      tick.textContent = secToTime(s).substring(3);
    } else {
      tick.className = "ruler-tick minor";
    }
    ruler.appendChild(tick);
  }
}

function createClipElement(name, startTime, duration, type, id) {
  const el = document.createElement("div");
  el.className = "timeline-clip";
  el.setAttribute("data-type", type);
  el.setAttribute("data-id", id);

  const zoom = studioState.zoom;
  el.style.left = startTime * zoom + "px";
  el.style.width = duration * zoom + "px";
  el.textContent = name;

  if (
    (studioState.selectedClip && studioState.selectedClip.id === id) ||
    (type === "video" && studioState.selectedClip === studioState.video)
  ) {
    el.classList.add("selected");
  }

  const leftHandle = document.createElement("div");
  leftHandle.className = "clip-handle left-handle";
  const rightHandle = document.createElement("div");
  rightHandle.className = "clip-handle right-handle";

  el.appendChild(leftHandle);
  el.appendChild(rightHandle);

  el.addEventListener("mousedown", function (e) {
    e.stopPropagation();

    let clipObject = null;
    if (type === "video") clipObject = studioState.video;
    else if (type === "pip") clipObject = studioState.pip;
    else if (type === "text")
      clipObject = studioState.texts.find((t) => t.id === id);
    else if (type === "audio")
      clipObject = studioState.audio.find((a) => a.id === id);

    selectClip(clipObject, type);

    let isLeftHandle = e.target.classList.contains("left-handle");
    let isRightHandle = e.target.classList.contains("right-handle");

    let startX = e.clientX;
    let initialStart = clipObject.startTime;
    let initialDuration = clipObject.duration;

    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaTime = deltaX / zoom;

      if (isLeftHandle) {
        const newStart = Math.max(
          0,
          Math.min(
            initialStart + deltaTime,
            initialStart + initialDuration - 0.5,
          ),
        );
        const newDuration = initialDuration - (newStart - initialStart);
        clipObject.startTime = newStart;
        clipObject.duration = newDuration;
      } else if (isRightHandle) {
        const newDuration = Math.max(
          0.5,
          Math.min(
            initialDuration + deltaTime,
            (clipObject.originalDuration || studioState.duration) -
              clipObject.startTime,
          ),
        );
        clipObject.duration = newDuration;
      } else {
        const newStart = Math.max(
          0,
          Math.min(
            initialStart + deltaTime,
            studioState.duration - clipObject.duration,
          ),
        );
        clipObject.startTime = newStart;
      }

      el.style.left = clipObject.startTime * zoom + "px";
      el.style.width = clipObject.duration * zoom + "px";

      updatePlayheadUI();
      if (!studioState.isPlaying) renderCanvasFrame();
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      drawTimeline();
      updateInspector();
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  return el;
}

function selectClip(clip, type) {
  studioState.selectedClip = clip;

  document
    .querySelectorAll(".timeline-clip")
    .forEach((c) => c.classList.remove("selected"));
  if (clip) {
    const selector = clip.id
      ? `[data-id="${clip.id}"]`
      : `[data-id="main-video"]`;
    const el = document.querySelector(selector);
    if (el) el.classList.add("selected");

    document.getElementById("btnSplit").disabled = false;
    document.getElementById("btnDelete").disabled = type === "video";
  } else {
    document.getElementById("btnSplit").disabled = true;
    document.getElementById("btnDelete").disabled = true;
  }

  updateInspector();
}

function deselectClips(e) {
  if (e.target === e.currentTarget) {
    selectClip(null, null);
  }
}

function drawTimeline() {
  const zoom = studioState.zoom;
  const totalWidth = studioState.duration * zoom + 240;

  document.getElementById("timelineRuler").style.width = totalWidth + "px";
  document.getElementById("timelineTracks").style.width = totalWidth + "px";

  drawRulerTicks(totalWidth - 240);

  const vTrack = document.getElementById("track-video");
  const pTrack = document.getElementById("track-pip");
  const tTrack = document.getElementById("track-text");
  const aTrack = document.getElementById("track-audio");

  vTrack.innerHTML = "";
  pTrack.innerHTML = "";
  tTrack.innerHTML = "";
  aTrack.innerHTML = "";

  if (studioState.video) {
    vTrack.appendChild(
      createClipElement(
        studioState.video.name,
        studioState.video.startTime,
        studioState.video.duration,
        "video",
        "main-video",
      ),
    );
  }
  if (studioState.pip) {
    pTrack.appendChild(
      createClipElement(
        studioState.pip.name,
        studioState.pip.startTime,
        studioState.pip.duration,
        "pip",
        studioState.pip.id,
      ),
    );
  }
  studioState.texts.forEach((t) => {
    tTrack.appendChild(
      createClipElement(t.text, t.startTime, t.duration, "text", t.id),
    );
  });
  studioState.audio.forEach((a) => {
    aTrack.appendChild(
      createClipElement(a.name, a.startTime, a.duration, "audio", a.id),
    );
  });

  updatePlayheadUI();
}

function updatePlayheadUI() {
  const zoom = studioState.zoom;
  const playhead = document.getElementById("timelinePlayhead");
  playhead.style.left = 120 + studioState.currentTime * zoom + "px";
  document.getElementById("currentTimeDisplay").textContent = secToTime(
    studioState.currentTime,
  );
}

document
  .getElementById("timelineScrollArea")
  .addEventListener("mousedown", function (e) {
    if (
      e.target.classList.contains("track-label") ||
      e.target.closest(".track-label")
    )
      return;

    const scrollArea = document.getElementById("timelineScrollArea");
    const zoom = studioState.zoom;

    function scrub(evt) {
      const rect = scrollArea.getBoundingClientRect();
      const x = evt.clientX - rect.left - 120 + scrollArea.scrollLeft;
      const time = Math.max(0, Math.min(x / zoom, studioState.duration));

      studioState.currentTime = time;
      updatePlayheadUI();
      syncMediaPlayback();
      if (!studioState.isPlaying) renderCanvasFrame();
    }

    scrub(e);

    function onMouseMove(moveEvent) {
      scrub(moveEvent);
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

function zoomTimeline(factor) {
  studioState.zoom = Math.max(2, Math.min(100, studioState.zoom * factor));
  document.getElementById("zoomLabel").textContent =
    `Skala: ${Math.round(studioState.zoom)}px/s`;
  drawTimeline();
}

function splitSelectedClip() {
  const clip = studioState.selectedClip;
  if (!clip) return;

  const playhead = studioState.currentTime;
  if (
    playhead <= clip.startTime ||
    playhead >= clip.startTime + clip.duration
  ) {
    return alert("Geser playhead ke tengah klip untuk membagi.");
  }

  const leftDur = playhead - clip.startTime;
  const rightDur = clip.duration - leftDur;

  if (clip === studioState.video) {
    alert("Klip video utama tidak dapat di-split dalam versi MVP.");
  } else if (clip.id.startsWith("pip")) {
    alert("Klip PIP tidak dapat di-split dalam versi MVP.");
  } else if (clip.id.startsWith("text")) {
    const rightText = Object.assign({}, clip, {
      id: "text-" + Date.now(),
      startTime: playhead,
      duration: rightDur,
      keyframes: clip.keyframes
        ? clip.keyframes.filter((k) => k.time >= playhead)
        : [],
    });

    if (clip.keyframes) {
      clip.keyframes = clip.keyframes.filter((k) => k.time < playhead);
    }

    clip.duration = leftDur;
    studioState.texts.push(rightText);
    selectClip(rightText, "text");
  } else if (clip.id.startsWith("audio")) {
    const rightAudioElement = document.createElement("audio");
    rightAudioElement.src = clip.src;
    rightAudioElement.preload = "auto";

    const id = "audio-" + Date.now();
    const rightAudio = Object.assign({}, clip, {
      id: id,
      element: rightAudioElement,
      startTime: playhead,
      duration: rightDur,
      startOffset: clip.startOffset + leftDur,
    });

    clip.duration = leftDur;
    studioState.audio.push(rightAudio);

    initStudioAudio();
    if (audioCtx) {
      const source = audioCtx.createMediaElementSource(rightAudioElement);
      const filter = audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;

      const gain = audioCtx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioNodes.merger);

      audioNodes.musics[id] = { source, filter, gain };
    }

    selectClip(rightAudio, "audio");
    updateAudioList();
  }

  drawTimeline();
}

function deleteSelectedClip() {
  const clip = studioState.selectedClip;
  if (!clip) return;
  if (clip === studioState.video)
    return alert("Video utama tidak bisa dihapus!");

  if (clip.id.startsWith("pip")) {
    removePipOverlay();
  } else if (clip.id.startsWith("text")) {
    const idx = studioState.texts.findIndex((t) => t.id === clip.id);
    if (idx !== -1) {
      studioState.texts.splice(idx, 1);
      selectClip(null, null);
    }
  } else if (clip.id.startsWith("audio")) {
    removeAudioTrack(clip.id);
  }

  drawTimeline();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// --------------------------------------------------------------------------
// 4E. INSPECTOR PANEL RENDERER & INTERACTIVE VALUES
// --------------------------------------------------------------------------
function updateInspector() {
  const container = document.getElementById("inspectorContent");
  const clip = studioState.selectedClip;

  if (!clip) {
    container.innerHTML = `
      <div class="no-selection">
        <p>Pilih klip di timeline untuk mengubah pengaturannya.</p>
      </div>
    `;
    return;
  }

  // Setup standard filter values
  const filterType = clip.audioFilter || "none";
  const filterFreq = clip.audioFreq || 1000;

  if (clip === studioState.video) {
    const vScale = clip.scale || 1.0;
    const vX = clip.x || 0;
    const vY = clip.y || 0;

    container.innerHTML = `
      <div class="inspector-section">
        <h4>🎞️ Video Utama</h4>
        
        <!-- Size and Position Transform -->
        <div class="filter-group">
          <label>Skala Video (Zoom): <span id="inspect-main-scale-val">${Math.round(vScale * 100)}</span>%</label>
          <input type="range" min="1.0" max="3.0" step="0.05" value="${vScale}" oninput="changeMainVideoScale(this.value)" />
        </div>
        <div class="filter-group">
          <label>Geser X (Horizontal): <span id="inspect-main-x-val">${vX}</span> px</label>
          <input type="range" id="inspect-main-x" min="-1000" max="1000" step="5" value="${vX}" oninput="changeMainVideoX(this.value)" />
        </div>
        <div class="filter-group">
          <label>Geser Y (Vertical): <span id="inspect-main-y-val">${vY}</span> px</label>
          <input type="range" id="inspect-main-y" min="-1000" max="1000" step="5" value="${vY}" oninput="changeMainVideoY(this.value)" />
        </div>
        <button class="btn-action secondary" onclick="resetMainVideoTransform()" style="padding: 6px 12px; font-size: 0.72rem; margin-bottom: 5px;">🔄 Reset Posisi & Ukuran</button>
        <p style="font-size:0.7rem; color:var(--text-muted); line-height:1.3; margin:0 0 10px 0;">
          💡 *Tip: Anda juga bisa menyeret (drag) video utama secara langsung di layar preview.*
        </p>

        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 10px 0;" />

        <div class="filter-group">
          <label>Volume Audio: <span id="inspect-vol-val">${Math.round(clip.volume * 100)}</span>%</label>
          <input type="range" min="0" max="150" value="${Math.round(clip.volume * 100)}" oninput="changeSelectedClipVolume(this.value)" />
        </div>
        <div class="filter-group">
          <label>Kecepatan Playback: <span id="inspect-speed-val">${clip.speed}</span>x</label>
          <input type="range" min="0.5" max="3" step="0.25" value="${clip.speed}" oninput="changeSelectedClipSpeed(this.value)" />
        </div>
        
        <!-- Audio DSP Filters -->
        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 15px 0;" />
        <div class="filter-group">
          <label>Filter Audio DSP</label>
          <select id="inspect-audio-filter" onchange="changeSelectedClipAudioFilter(this.value)">
            <option value="none" ${filterType === "none" ? "selected" : ""}>Normal (Bypass)</option>
            <option value="lowpass" ${filterType === "lowpass" ? "selected" : ""}>Low-Pass (Peredam Desis / High Cut)</option>
            <option value="highpass" ${filterType === "highpass" ? "selected" : ""}>High-Pass (Peredam Dengung / Low Cut)</option>
          </select>
        </div>
        <div class="filter-group ${filterType === "none" ? "hidden" : ""}" id="audio-freq-group">
          <label>Frekuensi Pemotongan: <span id="inspect-audio-freq-val">${filterFreq}</span> Hz</label>
          <input type="range" min="100" max="8000" step="50" value="${filterFreq}" oninput="changeSelectedClipAudioFreq(this.value)" />
        </div>
      </div>
    `;
  } else if (clip.id.startsWith("pip")) {
    const chroma = clip.chromaKey || {
      enabled: false,
      color: "#00ff00",
      tolerance: 30,
    };
    const kfs = clip.keyframes || [];

    container.innerHTML = `
      <div class="inspector-section">
        <h4>🔲 Overlay (PIP)</h4>
        <p style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 10px;">
          Geser/skala overlay secara langsung di layar preview.
        </p>
        
        ${
          clip.type === "video"
            ? `
          <div class="filter-group">
            <label>Volume: <span id="inspect-vol-val">${Math.round(clip.volume * 100)}</span>%</label>
            <input type="range" min="0" max="150" value="${Math.round(clip.volume * 100)}" oninput="changeSelectedClipVolume(this.value)" />
          </div>
          <div class="filter-group">
            <label>Kecepatan: <span id="inspect-speed-val">${clip.speed}</span>x</label>
            <input type="range" min="0.5" max="3" step="0.25" value="${clip.speed}" oninput="changeSelectedClipSpeed(this.value)" />
          </div>
          
          <!-- Audio DSP Filters -->
          <div class="filter-group" style="margin-top:10px;">
            <label>Filter Audio DSP</label>
            <select id="inspect-audio-filter" onchange="changeSelectedClipAudioFilter(this.value)">
              <option value="none" ${filterType === "none" ? "selected" : ""}>Normal (Bypass)</option>
              <option value="lowpass" ${filterType === "lowpass" ? "selected" : ""}>Low-Pass (Desis)</option>
              <option value="highpass" ${filterType === "highpass" ? "selected" : ""}>High-Pass (Dengung)</option>
            </select>
          </div>
          <div class="filter-group ${filterType === "none" ? "hidden" : ""}" id="audio-freq-group">
            <label>Frekuensi: <span id="inspect-audio-freq-val">${filterFreq}</span> Hz</label>
            <input type="range" min="100" max="8000" step="50" value="${filterFreq}" oninput="changeSelectedClipAudioFreq(this.value)" />
          </div>
          
          <div class="checkbox-group" style="margin-top: 15px;">
            <input type="checkbox" id="chroma-enable" ${chroma.enabled ? "checked" : ""} onchange="toggleChromaKey(this.checked)" />
            <label for="chroma-enable">🟢 Chroma Key (Green Screen)</label>
          </div>
          <div class="filter-group" style="margin-top: 8px;">
            <label>Warna Kunci</label>
            <input type="color" id="chroma-color" value="${chroma.color}" onchange="changeChromaColor(this.value)" />
          </div>
          <div class="filter-group">
            <label>Toleransi Jarak: <span id="chroma-tol-val">${chroma.tolerance}</span></label>
            <input type="range" min="5" max="120" value="${chroma.tolerance}" oninput="changeChromaTolerance(this.value)" />
          </div>
        `
            : `<p style="font-size:0.75rem;">Aset: Gambar Statis</p>`
        }
        
        <!-- Keyframe Animation -->
        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 15px 0;" />
        <h5>🔑 Keyframe Posisi & Ukuran</h5>
        <button class="btn-action secondary" onclick="addKeyframeToSelectedClip()" style="margin-bottom:10px;">➕ Tambah Keyframe Posisi</button>
        <div class="keyframe-list">
          ${
            kfs.length === 0
              ? '<span style="font-size:0.75rem; color:var(--text-muted);">Belum ada keyframe</span>'
              : kfs
                  .map(
                    (k, idx) => `
              <div class="keyframe-item" style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; margin-bottom:4px; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px;">
                <span style="cursor:pointer; color:var(--secondary);" onclick="seekToTime(${k.time})">Keyframe #${idx + 1} (${secToTime(k.time).substring(3)})</span>
                <button onclick="removeKeyframeFromSelectedClip(${idx})" style="border:none; background:none; color:#ef4444; cursor:pointer;">❌</button>
              </div>
            `,
                  )
                  .join("")
          }
        </div>
      </div>
    `;
  } else if (clip.id.startsWith("text")) {
    const kfs = clip.keyframes || [];
    container.innerHTML = `
      <div class="inspector-section">
        <h4>🔤 Properti Teks</h4>
        <div class="filter-group">
          <label>Isi Teks</label>
          <input type="text" value="${clip.text}" oninput="changeTextContent(this.value)" placeholder="Ketik teks..." />
        </div>
        <div class="filter-group">
          <label>Ukuran Font: <span id="inspect-text-size-val">${clip.size}</span>px</label>
          <input type="range" min="14" max="100" value="${clip.size}" oninput="changeTextSize(this.value)" />
        </div>
        <div class="filter-group">
          <label>Warna Teks</label>
          <input type="color" value="${clip.color}" onchange="changeTextColor(this.value)" />
        </div>
        <div class="filter-group">
          <label>Warna Stroke (Outline)</label>
          <input type="color" value="${clip.strokeColor}" onchange="changeTextStrokeColor(this.value)" />
        </div>
        <div class="filter-group">
          <label>Tebal Stroke: <span id="inspect-text-stroke-val">${clip.strokeWidth}</span>px</label>
          <input type="range" min="0" max="8" value="${clip.strokeWidth}" oninput="changeTextStrokeWidth(this.value)" />
        </div>
        
        <!-- Keyframe Animation -->
        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 15px 0;" />
        <h5>🔑 Keyframe Gerak</h5>
        <button class="btn-action secondary" onclick="addKeyframeToSelectedClip()" style="margin-bottom:10px;">➕ Tambah Keyframe Posisi</button>
        <div class="keyframe-list">
          ${
            kfs.length === 0
              ? '<span style="font-size:0.75rem; color:var(--text-muted);">Belum ada keyframe</span>'
              : kfs
                  .map(
                    (k, idx) => `
              <div class="keyframe-item" style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; margin-bottom:4px; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px;">
                <span style="cursor:pointer; color:var(--secondary);" onclick="seekToTime(${k.time})">Keyframe #${idx + 1} (${secToTime(k.time).substring(3)})</span>
                <button onclick="removeKeyframeFromSelectedClip(${idx})" style="border:none; background:none; color:#ef4444; cursor:pointer;">❌</button>
              </div>
            `,
                  )
                  .join("")
          }
        </div>
      </div>
    `;
  } else if (clip.id.startsWith("audio")) {
    container.innerHTML = `
      <div class="inspector-section">
        <h4>🎵 Musik Latar</h4>
        <div class="filter-group">
          <label>Volume: <span id="inspect-vol-val">${Math.round(clip.volume * 100)}</span>%</label>
          <input type="range" min="0" max="150" value="${Math.round(clip.volume * 100)}" oninput="changeSelectedClipVolume(this.value)" />
        </div>
        
        <!-- Audio DSP Filters -->
        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 15px 0;" />
        <div class="filter-group">
          <label>Filter Audio DSP</label>
          <select id="inspect-audio-filter" onchange="changeSelectedClipAudioFilter(this.value)">
            <option value="none" ${filterType === "none" ? "selected" : ""}>Normal (Bypass)</option>
            <option value="lowpass" ${filterType === "lowpass" ? "selected" : ""}>Low-Pass (Desis)</option>
            <option value="highpass" ${filterType === "highpass" ? "selected" : ""}>High-Pass (Dengung)</option>
          </select>
        </div>
        <div class="filter-group ${filterType === "none" ? "hidden" : ""}" id="audio-freq-group">
          <label>Frekuensi: <span id="inspect-audio-freq-val">${filterFreq}</span> Hz</label>
          <input type="range" min="100" max="8000" step="50" value="${filterFreq}" oninput="changeSelectedClipAudioFreq(this.value)" />
        </div>
      </div>
    `;
  }
}

// Seek to specific time from keyframe list
function seekToTime(t) {
  studioState.currentTime = t;
  updatePlayheadUI();
  syncMediaPlayback();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// --------------------------------------------------------------------------
// 4F-1. CLIPS VALUE MODIFIERS
// --------------------------------------------------------------------------
function changeSelectedClipVolume(val) {
  const clip = studioState.selectedClip;
  if (!clip) return;

  const gainValue = parseInt(val) / 100;
  clip.volume = gainValue;

  const valDisp = document.getElementById("inspect-vol-val");
  if (valDisp) valDisp.textContent = val;

  if (clip === studioState.video) {
    clip.element.volume = gainValue;
  } else if (clip.id.startsWith("pip")) {
    clip.element.volume = gainValue;
  } else if (clip.id.startsWith("audio")) {
    const gainNode = audioNodes.musics[clip.id];
    if (gainNode) {
      gainNode.gain.gain.value = gainValue;
    }
  }
}

function changeSelectedClipSpeed(val) {
  const clip = studioState.selectedClip;
  if (!clip) return;

  const speed = parseFloat(val);
  clip.speed = speed;

  const valDisp = document.getElementById("inspect-speed-val");
  if (valDisp) valDisp.textContent = val;

  if (clip === studioState.video) {
    clip.element.playbackRate = speed;
  } else if (clip.id.startsWith("pip")) {
    clip.element.playbackRate = speed;
  }
}

// Main Video Scale & Position Modifiers
function changeMainVideoScale(val) {
  if (!studioState.video) return;
  studioState.video.scale = parseFloat(val);
  const disp = document.getElementById("inspect-main-scale-val");
  if (disp) disp.textContent = Math.round(parseFloat(val) * 100);
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeMainVideoX(val) {
  if (!studioState.video) return;
  studioState.video.x = parseInt(val);
  const disp = document.getElementById("inspect-main-x-val");
  if (disp) disp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeMainVideoY(val) {
  if (!studioState.video) return;
  studioState.video.y = parseInt(val);
  const disp = document.getElementById("inspect-main-y-val");
  if (disp) disp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function resetMainVideoTransform() {
  if (!studioState.video) return;
  studioState.video.scale = 1.0;
  studioState.video.x = 0;
  studioState.video.y = 0;

  updateInspector();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// Audio DSP Filter Modifiers
function changeSelectedClipAudioFilter(val) {
  const clip = studioState.selectedClip;
  if (!clip) return;

  clip.audioFilter = val;
  const freqGroup = document.getElementById("audio-freq-group");
  if (val === "none") freqGroup.classList.add("hidden");
  else freqGroup.classList.remove("hidden");

  // Apply Web Audio node updates
  let node = null;
  if (clip === studioState.video) node = audioNodes.mainVideo;
  else if (clip.id.startsWith("pip")) node = audioNodes.pip;
  else if (clip.id.startsWith("audio")) node = audioNodes.musics[clip.id];

  if (node && node.filter) {
    if (val === "none") {
      node.filter.type = "peaking";
      node.filter.gain.value = 0;
    } else {
      node.filter.type = val;
      node.filter.frequency.value = clip.audioFreq || 1000;
      node.filter.Q.value = 1;
    }
  }
}

function changeSelectedClipAudioFreq(val) {
  const clip = studioState.selectedClip;
  if (!clip) return;

  clip.audioFreq = parseInt(val);
  const disp = document.getElementById("inspect-audio-freq-val");
  if (disp) disp.textContent = val;

  let node = null;
  if (clip === studioState.video) node = audioNodes.mainVideo;
  else if (clip.id.startsWith("pip")) node = audioNodes.pip;
  else if (clip.id.startsWith("audio")) node = audioNodes.musics[clip.id];

  if (node && node.filter && clip.audioFilter !== "none") {
    node.filter.frequency.value = clip.audioFreq;
  }
}

// Chroma Key
function toggleChromaKey(checked) {
  const clip = studioState.selectedClip;
  if (!clip || !clip.chromaKey) return;
  clip.chromaKey.enabled = checked;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeChromaColor(color) {
  const clip = studioState.selectedClip;
  if (!clip || !clip.chromaKey) return;
  clip.chromaKey.color = color;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeChromaTolerance(val) {
  const clip = studioState.selectedClip;
  if (!clip || !clip.chromaKey) return;
  clip.chromaKey.tolerance = parseInt(val);
  const disp = document.getElementById("chroma-tol-val");
  if (disp) disp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

// Text updates
function changeTextContent(text) {
  const clip = studioState.selectedClip;
  if (!clip || clip.type !== "text") return;
  clip.text = text;

  const block = document.querySelector(`[data-id="${clip.id}"]`);
  if (block) {
    const handles = block.querySelectorAll(".clip-handle");
    block.textContent = text;
    handles.forEach((h) => block.appendChild(h));
  }

  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeTextSize(val) {
  const clip = studioState.selectedClip;
  if (!clip || clip.type !== "text") return;
  clip.size = parseInt(val);

  const disp = document.getElementById("inspect-text-size-val");
  if (disp) disp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeTextColor(color) {
  const clip = studioState.selectedClip;
  if (!clip || clip.type !== "text") return;
  clip.color = color;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeTextStrokeColor(color) {
  const clip = studioState.selectedClip;
  if (!clip || clip.type !== "text") return;
  clip.strokeColor = color;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeTextStrokeWidth(val) {
  const clip = studioState.selectedClip;
  if (!clip || clip.type !== "text") return;
  clip.strokeWidth = parseInt(val);

  const disp = document.getElementById("inspect-text-stroke-val");
  if (disp) disp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

// Keyframe addition and deletion
function addKeyframeToSelectedClip() {
  const clip = studioState.selectedClip;
  if (!clip) return;

  if (!clip.keyframes) clip.keyframes = [];

  // Record current properties as a keyframe
  const kf = {
    time: studioState.currentTime,
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: clip.height,
    size: clip.size,
  };

  // Remove duplicate keyframe at same time if exists
  clip.keyframes = clip.keyframes.filter(
    (k) => Math.abs(k.time - kf.time) > 0.05,
  );
  clip.keyframes.push(kf);
  clip.keyframes.sort((a, b) => a.time - b.time);

  updateInspector();
  if (!studioState.isPlaying) renderCanvasFrame();
}

function removeKeyframeFromSelectedClip(idx) {
  const clip = studioState.selectedClip;
  if (!clip || !clip.keyframes) return;

  clip.keyframes.splice(idx, 1);
  updateInspector();
  if (!studioState.isPlaying) renderCanvasFrame();
}

// --------------------------------------------------------------------------
// 4G. CANVAS FORMAT & BG PROPERTIES
// --------------------------------------------------------------------------
function changeCanvasRatio(val) {
  studioState.aspectRatio = val;

  // Sync dropdown selectors
  const r1 = document.getElementById("canvasRatio");
  const r2 = document.getElementById("canvasRatioDirect");
  if (r1) r1.value = val;
  if (r2) r2.value = val;

  const wrapper = document.getElementById("canvasWrapper");
  if (val === "16:9") wrapper.style.aspectRatio = "16/9";
  else if (val === "9:16") wrapper.style.aspectRatio = "9/16";
  else if (val === "1:1") wrapper.style.aspectRatio = "1/1";
  else if (val === "4:3") wrapper.style.aspectRatio = "4/3";

  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeCanvasBgType(val) {
  studioState.canvasBg.type = val;

  const colorGroup = document.getElementById("canvasBgColorGroup");
  const imgGroup = document.getElementById("canvasBgImageGroup");

  if (val === "color") {
    colorGroup.classList.remove("hidden");
    imgGroup.classList.add("hidden");
  } else if (val === "image") {
    colorGroup.classList.add("hidden");
    imgGroup.classList.remove("hidden");
  } else {
    colorGroup.classList.add("hidden");
    imgGroup.classList.add("hidden");
  }

  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeCanvasBgColor(color) {
  studioState.canvasBg.color = color;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function changeCanvasBgImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  img.onload = function () {
    studioState.canvasBg.image = img;
    studioState.canvasBg.imageUrl = url;
    if (!studioState.isPlaying) renderCanvasFrame();
  };
}

// --------------------------------------------------------------------------
// 4H. FILTERS & EFFECTS (GLITCH & MEDIAPIPE DETECTOR)
// --------------------------------------------------------------------------
function updateFilter(filterType, val) {
  studioState.filters[filterType] = parseInt(val);
  const valDisp = document.getElementById(`val-${filterType}`);
  if (valDisp) valDisp.textContent = val;
  if (!studioState.isPlaying) renderCanvasFrame();
}

function toggleGlitch(checked) {
  studioState.filters.glitch = checked;
  if (!studioState.isPlaying) renderCanvasFrame();
}

// MediaPipe Pose detection loader
async function togglePoseDetection(checked) {
  studioState.poseDetectionEnabled = checked;

  if (checked) {
    const status = document.getElementById("pose-loading-status");
    status.classList.remove("hidden");

    try {
      if (!window.Pose) {
        // Dynamic loading from CDN
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js",
        );
      }

      if (!window.mpPoseInstance) {
        window.mpPoseInstance = new Pose({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });

        window.mpPoseInstance.setOptions({
          modelComplexity: 0, // 0: fast, 1: medium, 2: heavy
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        window.mpPoseInstance.onResults(function (results) {
          window.cachedPoseLandmarks = results.poseLandmarks;
        });
      }

      status.classList.add("hidden");
    } catch (err) {
      console.log(err);
      alert(
        "Gagal memuat library MediaPipe Pose secara offline. Pastikan koneksi internet aktif saat pertama kali memuat model.",
      );
      document.getElementById("filter-pose").checked = false;
      studioState.poseDetectionEnabled = false;
      status.classList.add("hidden");
    }
  } else {
    window.cachedPoseLandmarks = null;
  }
}

// --------------------------------------------------------------------------
// 4I. MASTER SYNC PLAYBACK
// --------------------------------------------------------------------------
function togglePlayPause() {
  if (!studioState.video) return;
  if (studioState.isPlaying) pauseVideo();
  else playVideo();
}

function playVideo() {
  initStudioAudio();
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  studioState.isPlaying = true;
  document.getElementById("btnPlayPause").textContent = "⏸ Pause";

  const master = studioState.video.element;
  master.currentTime = studioState.currentTime;
  master.playbackRate = studioState.video.speed;
  master.volume = studioState.video.volume;
  master.play().catch((e) => console.log(e));

  syncMediaPlayback();

  if (canvasAnimFrameId) cancelAnimationFrame(canvasAnimFrameId);
  canvasAnimFrameId = requestAnimationFrame(renderCanvasFrame);
  trackPlayheadClock();
}

function pauseVideo() {
  studioState.isPlaying = false;
  document.getElementById("btnPlayPause").textContent = "▶ Play";

  if (studioState.video) studioState.video.element.pause();
  if (studioState.pip && studioState.pip.type === "video")
    studioState.pip.element.pause();
  studioState.audio.forEach((a) => a.element.pause());

  if (speechRecognitionInstance) {
    try {
      speechRecognitionInstance.stop();
    } catch (e) {}
  }
}

function stopVideo() {
  pauseVideo();
  studioState.currentTime = 0;
  if (studioState.video) studioState.video.element.currentTime = 0;
  updatePlayheadUI();
  if (!studioState.isPlaying) renderCanvasFrame();
}

function toggleMuteVideo() {
  if (!studioState.video) return;
  const isMuted = studioState.video.element.muted;
  studioState.video.element.muted = !isMuted;

  const vol = document.getElementById("mainVolumeSlider");
  vol.value = !isMuted ? 0 : Math.round(studioState.video.volume * 100);
  document.getElementById("btnMute").textContent = !isMuted ? "🔇" : "🔊";
}

function setVideoVolume(val) {
  if (!studioState.video) return;
  const volume = parseInt(val) / 100;
  studioState.video.volume = volume;
  studioState.video.element.volume = volume;
  studioState.video.element.muted = volume === 0;
  document.getElementById("btnMute").textContent = volume === 0 ? "🔇" : "🔊";
}

function trackPlayheadClock() {
  if (!studioState.isPlaying) return;

  if (studioState.video) {
    studioState.currentTime = studioState.video.element.currentTime;
    if (studioState.currentTime >= studioState.duration) {
      stopVideo();
      return;
    }
  }

  updatePlayheadUI();
  syncMediaPlayback();
  setTimeout(trackPlayheadClock, 50);
}

function syncMediaPlayback() {
  const current = studioState.currentTime;

  // Sync PIP
  if (studioState.pip && studioState.pip.type === "video") {
    const pip = studioState.pip;
    const start = pip.startTime;
    const end = start + pip.duration;

    if (current >= start && current <= end) {
      const offset = (current - start) * pip.speed;
      if (studioState.isPlaying) {
        if (pip.element.paused) {
          pip.element.currentTime = offset;
          pip.element.playbackRate = pip.speed;
          pip.element.volume = pip.volume;
          pip.element.play().catch(() => {});
        } else {
          if (Math.abs(pip.element.currentTime - offset) > 0.2) {
            pip.element.currentTime = offset;
          }
        }
      } else {
        pip.element.currentTime = offset;
      }
    } else {
      if (!pip.element.paused) pip.element.pause();
    }
  }

  // Sync Audio Clips
  studioState.audio.forEach((a) => {
    const start = a.startTime;
    const end = start + a.duration;

    if (current >= start && current <= end) {
      const offset = (current - start) * a.speed + a.startOffset;
      if (studioState.isPlaying) {
        if (a.element.paused) {
          a.element.currentTime = offset;
          a.element.playbackRate = a.speed;

          const audioNode = audioNodes.musics[a.id];
          if (audioNode && audioNode.gain) {
            audioNode.gain.gain.value = a.volume;
          }
          a.element.play().catch(() => {});
        } else {
          if (Math.abs(a.element.currentTime - offset) > 0.2) {
            a.element.currentTime = offset;
          }
        }
      } else {
        a.element.currentTime = offset;
      }
    } else {
      if (!a.element.paused) a.element.pause();
    }
  });
}

// --------------------------------------------------------------------------
// 4J. CANVAS RENDERING ENGINE (SHADERS & MEDIAPIPE POSES)
// --------------------------------------------------------------------------
function renderCanvasFrame() {
  const canvas = document.getElementById("studioCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const ratio = studioState.aspectRatio;
  let targetWidth = 1280;
  let targetHeight = 720;
  if (ratio === "9:16") targetWidth = 405;
  else if (ratio === "1:1") targetWidth = 720;
  else if (ratio === "4:3") targetWidth = 960;

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  // Draw Background
  const bg = studioState.canvasBg;
  if (bg.type === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (bg.type === "blur" && studioState.video) {
    ctx.save();
    ctx.filter = "blur(20px) brightness(0.6)";
    ctx.drawImage(studioState.video.element, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  } else if (bg.type === "image" && bg.image) {
    ctx.drawImage(bg.image, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#090912";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw Main Video Layer (Letterboxed + Custom Scale & Pos)
  if (studioState.video && studioState.video.element) {
    const video = studioState.video.element;
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    const baseScale = Math.min(canvas.width / vWidth, canvas.height / vHeight);
    const userScale = studioState.video.scale || 1.0;
    const drawW = vWidth * baseScale * userScale;
    const drawH = vHeight * baseScale * userScale;

    const userX = studioState.video.x || 0;
    const userY = studioState.video.y || 0;
    const drawX = (canvas.width - drawW) / 2 + userX;
    const drawY = (canvas.height - drawH) / 2 + userY;

    ctx.drawImage(video, drawX, drawY, drawW, drawH);

    // Background Pose Inference (Throttled at 100ms interval for performance)
    if (
      studioState.poseDetectionEnabled &&
      window.mpPoseInstance &&
      !video.paused
    ) {
      const now = performance.now();
      if (now - lastPoseInferenceTime > 100) {
        lastPoseInferenceTime = now;
        window.mpPoseInstance.send({ image: video }).catch(() => {});
      }
    }
  }

  // Draw PIP Overlay Layer
  if (studioState.pip) {
    const pip = studioState.pip;
    const start = pip.startTime;
    const end = start + pip.duration;

    if (studioState.currentTime >= start && studioState.currentTime <= end) {
      ctx.save();

      // Interpolate positional properties if keyframes exist
      const props = getInterpolatedProperties(pip, studioState.currentTime);
      const w = props.width;
      const h = props.height;
      const x = props.x;
      const y = props.y;

      if (pip.type === "video") {
        if (pip.chromaKey && pip.chromaKey.enabled) {
          const offscreen = document.createElement("canvas");
          offscreen.width = pip.element.videoWidth || 640;
          offscreen.height = pip.element.videoHeight || 360;
          const oCtx = offscreen.getContext("2d");
          oCtx.drawImage(pip.element, 0, 0, offscreen.width, offscreen.height);

          const imgData = oCtx.getImageData(
            0,
            0,
            offscreen.width,
            offscreen.height,
          );
          applyChromaKeyImageData(
            imgData,
            pip.chromaKey.color,
            pip.chromaKey.tolerance,
          );
          oCtx.putImageData(imgData, 0, 0);

          ctx.drawImage(offscreen, x, y, w, h);
        } else {
          ctx.drawImage(pip.element, x, y, w, h);
        }
      } else {
        ctx.drawImage(pip.element, x, y, w, h);
      }

      ctx.restore();
    }
  }

  // Draw Global Visual Filters
  applyFiltersToContext(ctx);

  // Glitch
  if (studioState.filters.glitch && Math.random() < 0.22) {
    applyGlitchEffect(ctx, canvas);
  }

  // Draw Neon Body Glow Poses (MediaPipe landmarks connecting)
  if (studioState.poseDetectionEnabled && window.cachedPoseLandmarks) {
    drawPoseNeonSkeleton(ctx, canvas, window.cachedPoseLandmarks);
  }

  // Draw Texts
  studioState.texts.forEach((t) => {
    if (
      studioState.currentTime >= t.startTime &&
      studioState.currentTime <= t.startTime + t.duration
    ) {
      ctx.save();

      // Interpolated text movement
      const props = getInterpolatedProperties(t, studioState.currentTime);
      const x = props.x;
      const y = props.y;
      const size = props.size;

      ctx.font = `${size}px ${t.fontFamily}, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (t.shadowColor) {
        ctx.shadowColor = t.shadowColor;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
      }

      if (t.strokeColor && t.strokeWidth > 0) {
        ctx.strokeStyle = t.strokeColor;
        ctx.lineWidth = t.strokeWidth;
        ctx.strokeText(t.text, x, y);
      }

      ctx.fillText(t.text, x, y);
      ctx.restore();
    }
  });

  // Selection box outline
  drawCanvasOutlineSelection(ctx);

  if (studioState.isPlaying || isExporting) {
    canvasAnimFrameId = requestAnimationFrame(renderCanvasFrame);
  }
}

function applyChromaKeyImageData(imgData, hexColor, tolerance) {
  const rTarget = parseInt(hexColor.substr(1, 2), 16);
  const gTarget = parseInt(hexColor.substr(3, 2), 16);
  const bTarget = parseInt(hexColor.substr(5, 2), 16);

  const data = imgData.data;
  const tolSq = tolerance * tolerance;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const dSq = (r - rTarget) ** 2 + (g - gTarget) ** 2 + (b - bTarget) ** 2;
    if (dSq < tolSq) {
      data[i + 3] = 0;
    } else if (dSq < tolSq * 1.5) {
      const ratio = (dSq - tolSq) / (tolSq * 0.5);
      data[i + 3] = Math.round(ratio * 255);
    }
  }
}

function applyFiltersToContext(ctx) {
  const f = studioState.filters;
  ctx.filter = `
    brightness(${f.brightness}%)
    contrast(${f.contrast}%)
    saturate(${f.saturate}%)
    grayscale(${f.grayscale}%)
    sepia(${f.sepia}%)
    hue-rotate(${f.huerotate}deg)
    blur(${f.blur}px)
  `;
}

function applyGlitchEffect(ctx, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const slices = Math.floor(Math.random() * 5) + 3;

  for (let i = 0; i < slices; i++) {
    const sy = Math.floor(Math.random() * h);
    const sh = Math.floor(Math.random() * 50) + 10;
    const dx = Math.floor(Math.random() * 30) - 15;
    ctx.drawImage(canvas, 0, sy, w, sh, dx, sy, w, sh);
  }

  ctx.fillStyle = "rgba(0, 242, 254, 0.08)";
  ctx.fillRect(0, 0, w, h);
}

// MediaPipe Neon Skeleton Overlay rendering
function drawPoseNeonSkeleton(ctx, canvas, landmarks) {
  if (!studioState.video || !studioState.video.element) return;

  ctx.save();
  ctx.strokeStyle = "#00f2fe"; // Cyber Cyan
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.shadowColor = "#00f2fe";
  ctx.shadowBlur = 12;

  const video = studioState.video.element;
  const vWidth = video.videoWidth || 1280;
  const vHeight = video.videoHeight || 720;

  const baseScale = Math.min(canvas.width / vWidth, canvas.height / vHeight);
  const userScale = studioState.video.scale || 1.0;
  const drawW = vWidth * baseScale * userScale;
  const drawH = vHeight * baseScale * userScale;

  const userX = studioState.video.x || 0;
  const userY = studioState.video.y || 0;
  const drawX = (canvas.width - drawW) / 2 + userX;
  const drawY = (canvas.height - drawH) / 2 + userY;

  // Render list of skeletal connections
  const connections = [
    [11, 12], // shoulder to shoulder
    [11, 13],
    [13, 15], // left arm
    [12, 14],
    [14, 16], // right arm
    [11, 23],
    [12, 24], // trunk
    [23, 24], // hips
    [23, 25],
    [25, 27], // left leg
    [24, 26],
    [26, 28], // right leg
  ];

  connections.forEach(([p1, p2]) => {
    const pt1 = landmarks[p1];
    const pt2 = landmarks[p2];

    // Visibility check
    if (pt1 && pt2 && pt1.visibility > 0.4 && pt2.visibility > 0.4) {
      ctx.beginPath();
      ctx.moveTo(drawX + pt1.x * drawW, drawY + pt1.y * drawH);
      ctx.lineTo(drawX + pt2.x * drawW, drawY + pt2.y * drawH);
      ctx.stroke();
    }
  });

  ctx.restore();
}

// --------------------------------------------------------------------------
// 4K. CANVAS OUTLINE & DRAGGING (INTERACTIVE PREVIEW)
// --------------------------------------------------------------------------
function drawCanvasOutlineSelection(ctx) {
  if (isExporting || studioState.isPlaying) return; // Jangan gambar garis tepi saat export atau playing
  const clip = studioState.selectedClip;
  if (!clip) return;

  const current = studioState.currentTime;
  const props = getInterpolatedProperties(clip, current);

  if (clip.id && clip.id.startsWith("pip")) {
    if (
      current >= clip.startTime &&
      current <= clip.startTime + clip.duration
    ) {
      ctx.save();
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(props.x, props.y, props.width, props.height);

      // Bottom right dot handle
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(props.x + props.width, props.y + props.height, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else if (clip.id && clip.id.startsWith("text")) {
    if (
      current >= clip.startTime &&
      current <= clip.startTime + clip.duration
    ) {
      ctx.save();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);

      const textHeight = props.size;
      const textWidth = clip.text.length * props.size * 0.55;

      ctx.strokeRect(
        props.x - textWidth / 2 - 10,
        props.y - textHeight / 2 - 5,
        textWidth + 20,
        textHeight + 10,
      );
      ctx.restore();
    }
  }
}

const canvasEl = document.getElementById("studioCanvas");
const wrapperEl = document.getElementById("canvasWrapper");

wrapperEl.addEventListener("mousedown", function (e) {
  if (!studioState.video) return;

  const rect = canvasEl.getBoundingClientRect();
  const clickX = ((e.clientX - rect.left) / rect.width) * canvasEl.width;
  const clickY = ((e.clientY - rect.top) / rect.height) * canvasEl.height;

  const current = studioState.currentTime;

  // 1. Check PIP
  if (
    studioState.pip &&
    current >= studioState.pip.startTime &&
    current <= studioState.pip.startTime + studioState.pip.duration
  ) {
    const pip = studioState.pip;
    const props = getInterpolatedProperties(pip, current);

    const handleDist = Math.sqrt(
      (clickX - (props.x + props.width)) ** 2 +
        (clickY - (props.y + props.height)) ** 2,
    );
    if (handleDist <= 15) {
      studioState.dragTarget = "pip-handle";
      selectClip(pip, "pip");
      return;
    }

    if (
      clickX >= props.x &&
      clickX <= props.x + props.width &&
      clickY >= props.y &&
      clickY <= props.y + props.height
    ) {
      studioState.dragTarget = "pip";
      studioState.dragStartOffset = {
        x: clickX - props.x,
        y: clickY - props.y,
      };
      selectClip(pip, "pip");
      return;
    }
  }

  // 2. Check Texts
  for (let i = studioState.texts.length - 1; i >= 0; i--) {
    const t = studioState.texts[i];
    if (current >= t.startTime && current <= t.startTime + t.duration) {
      const props = getInterpolatedProperties(t, current);
      const textHeight = props.size;
      const textWidth = t.text.length * props.size * 0.55;

      if (
        clickX >= props.x - textWidth / 2 &&
        clickX <= props.x + textWidth / 2 &&
        clickY >= props.y - textHeight / 2 &&
        clickY <= props.y + textHeight / 2
      ) {
        studioState.dragTarget = t;
        studioState.dragStartOffset = {
          x: clickX - props.x,
          y: clickY - props.y,
        };
        selectClip(t, "text");
        return;
      }
    }
  }

  selectClip(studioState.video, "video");
  studioState.dragTarget = "video";
  studioState.dragStartOffset = {
    x: clickX - (studioState.video.x || 0),
    y: clickY - (studioState.video.y || 0),
  };
});

wrapperEl.addEventListener("mousemove", function (e) {
  if (!studioState.dragTarget) return;

  const rect = canvasEl.getBoundingClientRect();
  const clickX = ((e.clientX - rect.left) / rect.width) * canvasEl.width;
  const clickY = ((e.clientY - rect.top) / rect.height) * canvasEl.height;

  if (studioState.dragTarget === "pip") {
    const pip = studioState.pip;
    pip.x = Math.round(clickX - studioState.dragStartOffset.x);
    pip.y = Math.round(clickY - studioState.dragStartOffset.y);
  } else if (studioState.dragTarget === "pip-handle") {
    const pip = studioState.pip;
    pip.width = Math.max(50, Math.round(clickX - pip.x));
    pip.height = Math.max(30, Math.round(clickY - pip.y));
  } else if (studioState.dragTarget === "video") {
    const video = studioState.video;
    video.x = Math.round(clickX - studioState.dragStartOffset.x);
    video.y = Math.round(clickY - studioState.dragStartOffset.y);

    // update inspector inputs if visible
    const valX = document.getElementById("inspect-main-x");
    const valY = document.getElementById("inspect-main-y");
    if (valX) valX.value = video.x;
    if (valY) valY.value = video.y;
    const txtX = document.getElementById("inspect-main-x-val");
    const txtY = document.getElementById("inspect-main-y-val");
    if (txtX) txtX.textContent = video.x;
    if (txtY) txtY.textContent = video.y;
  } else {
    const t = studioState.dragTarget;
    t.x = Math.round(clickX - studioState.dragStartOffset.x);
    t.y = Math.round(clickY - studioState.dragStartOffset.y);
  }

  if (!studioState.isPlaying) renderCanvasFrame();
});

document.addEventListener("mouseup", function () {
  studioState.dragTarget = null;
});

// --------------------------------------------------------------------------
// 4L. EXPORT RECORDER PIPELINE (CLIENT-SIDE RENDER)
// --------------------------------------------------------------------------
function openExportModal() {
  if (!studioState.video) return alert("Pilih video utama untuk diekspor!");

  pauseVideo();
  show("export-overlay");

  document.getElementById("exportBarFill").style.width = "0%";
  document.getElementById("exportProgressMsg").textContent =
    "Mempersiapkan media stream...";
  document.getElementById("btnDownloadExport").classList.add("hidden");
}

function cancelExport() {
  if (exportRecorder && exportRecorder.state !== "inactive") {
    exportRecorder.stop();
  }
  isExporting = false;
  clearInterval(exportTimer);
  stopVideo();
  hide("export-overlay");
}

function exportVideo() {
  isExporting = true;
  studioState.currentTime = 0;

  if (studioState.video) {
    studioState.video.element.currentTime = 0;
  }

  initStudioAudio();
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const canvas = document.getElementById("studioCanvas");
  const canvasStream = canvas.captureStream(30);

  const audioDest = audioCtx.createMediaStreamDestination();
  audioNodes.merger.connect(audioDest);

  const combinedTracks = [
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks(),
  ];

  const outputStream = new MediaStream(combinedTracks);

  let options = { mimeType: "video/webm;codecs=vp9,opus" };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: "video/webm;codecs=vp8,opus" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }
  }

  exportChunks = [];
  exportRecorder = new MediaRecorder(outputStream, options);

  exportRecorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) {
      exportChunks.push(e.data);
    }
  };

  exportRecorder.onstop = function () {
    isExporting = false;
    clearInterval(exportTimer);
    audioNodes.merger.disconnect(audioDest);

    const blob = new Blob(exportChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);

    window.exportedVideoUrl = url;

    document.getElementById("exportProgressMsg").textContent =
      "Rendering selesai! Unduh video Anda.";
    document.getElementById("exportBarFill").style.width = "100%";
    document.getElementById("btnDownloadExport").classList.remove("hidden");
  };

  exportRecorder.start();

  const master = studioState.video.element;
  master.currentTime = 0;
  master.playbackRate = 1.0;
  master.play().catch((e) => console.log(e));

  syncMediaPlayback();

  if (canvasAnimFrameId) cancelAnimationFrame(canvasAnimFrameId);
  canvasAnimFrameId = requestAnimationFrame(renderCanvasFrame);

  exportTimer = setInterval(function () {
    if (!isExporting) return;

    studioState.currentTime = master.currentTime;
    const progress = (studioState.currentTime / studioState.duration) * 100;

    document.getElementById("exportBarFill").style.width =
      Math.min(98, progress) + "%";
    document.getElementById("exportProgressMsg").textContent =
      `Sedang merender: ${secToTime(studioState.currentTime)} / ${secToTime(studioState.duration)}`;

    updatePlayheadUI();
    syncMediaPlayback();

    if (studioState.currentTime >= studioState.duration) {
      exportRecorder.stop();
      master.pause();
    }
  }, 100);
}

function downloadExportedFile() {
  if (!window.exportedVideoUrl) return;
  const a = Object.assign(document.createElement("a"), {
    href: window.exportedVideoUrl,
    download: `studio_${Date.now()}.webm`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  hide("export-overlay");
}

// --------------------------------------------------------------------------
// 4M. DOCUMENT LISTENERS INITIALIZATION
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("videoUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") getVideoInfo();
  });

  document
    .getElementById("startTime")
    .addEventListener("change", updateSliderFromInputs);
  document
    .getElementById("endTime")
    .addEventListener("change", updateSliderFromInputs);

  const btnExport = document.querySelector(".btn-export");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      exportVideo();
    });
  }
});
