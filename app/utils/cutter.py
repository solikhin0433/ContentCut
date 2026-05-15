import subprocess
import os
from pathlib import Path
from app.utils.ffmpeg_utils import get_ffmpeg_path
from app.utils.smart_crop import calculate_smart_crop

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)


def cut_video(input_path: str, start_time: str, end_time: str, output_filename: str, aspect_ratio: str = "original", crop_position: str = "center") -> str:
    """Potong video menggunakan FFmpeg."""
    output_path = OUTPUT_DIR / output_filename

    cmd = [
        get_ffmpeg_path(),
        "-i", input_path,
        "-ss", start_time,
        "-to", end_time,
    ]

    # Handle aspect ratio parameter
    if aspect_ratio != "original":
        if aspect_ratio == "16:9":
            w_ratio, h_ratio = 16, 9
        elif aspect_ratio == "9:16":
            w_ratio, h_ratio = 9, 16
        elif aspect_ratio == "1:1":
            w_ratio, h_ratio = 1, 1
        elif aspect_ratio == "4:3":
            w_ratio, h_ratio = 4, 3
        else:
            w_ratio, h_ratio = None, None
            
        if w_ratio and h_ratio:
            # Menggunakan trunc untuk memastikan width dan height habis dibagi 2 (syarat x264)
            if crop_position == "left":
                x_pos = "0"
            elif crop_position == "right":
                x_pos = "in_w-out_w"
            elif crop_position == "auto":
                # Panggil AI Smart Crop
                x_pos = calculate_smart_crop(input_path, w_ratio/h_ratio)
            else:
                x_pos = "(in_w-out_w)/2"
                
            crop_filter = f"crop='trunc(min(iw,ih*{w_ratio}/{h_ratio})/2)*2':'trunc(min(iw*{h_ratio}/{w_ratio},ih)/2)*2':'{x_pos}':'(in_h-out_h)/2'"
            cmd.extend(["-vf", crop_filter])

    cmd.extend([
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",
        "-y",
        str(output_path)
    ])

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
