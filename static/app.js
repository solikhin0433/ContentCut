function secToTime(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

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
    document.getElementById("thumb").src = d.thumbnail || "";
    document.getElementById("vTitle").textContent = d.title;
    document.getElementById("vUploader").textContent = d.uploader;
    document.getElementById("vDuration").textContent = secToTime(d.duration);
    document.getElementById("vPlatform").textContent = d.platform;
    document.getElementById("endTime").value = secToTime(
      Math.min(d.duration, 60),
    );

    show("infoCard");
    show("step-cut");
  } catch (e) {
    showErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Cek Video";
  }
}

let progressTimer;
async function cutVideo() {
  const url = document.getElementById("videoUrl").value.trim();
  const start = document.getElementById("startTime").value.trim();
  const end = document.getElementById("endTime").value.trim();
  const qual = document.getElementById("quality").value;
  const aspect = document.getElementById("aspectRatio").value;
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
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.detail || "Gagal proses");
    }

    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `videocutter_${Date.now()}.mp4`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();

    stopProgress();
    show("step-cut");
    alert("✅ Video berhasil dipotong! File sudah terdownload.");
  } catch (e) {
    stopProgress();
    show("step-cut");
    showErr(e.message);
  }
}

const STEPS = [
  [15, "Menghubungkan ke platform video..."],
  [35, "Mengunduh video dari URL..."],
  [65, "Memotong video dengan FFmpeg..."],
  [85, "Mengemas file hasil..."],
  [95, "Hampir selesai..."],
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
  ["infoCard", "step-cut", "errCard", "progressCard"].forEach(hide);
  document.getElementById("videoUrl").value = "";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("videoUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") getVideoInfo();
  });
});
