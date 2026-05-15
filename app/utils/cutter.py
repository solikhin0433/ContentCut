import subprocess
import os
from pathlib import Path

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)


def cut_video(input_path: str, start_time: str, end_time: str, output_filename: str) -> str:
    """Potong video menggunakan FFmpeg."""
    output_path = OUTPUT_DIR / output_filename

    cmd = [
        "ffmpeg",
        "-i", input_path,
        "-ss", start_time,
        "-to", end_time,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",
        "-y",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr}")

    return str(output_path)


def cleanup_file(filepath: str):
    """Hapus file temporary."""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
    except Exception:
        pass
