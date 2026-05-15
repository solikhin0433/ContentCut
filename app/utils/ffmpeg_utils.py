import shutil
import os
from pathlib import Path

def get_ffmpeg_path():
    """Cari path ffmpeg.exe di system PATH atau folder bin local."""
    # 1. Cek di system PATH
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path
    
    # 2. Cek di folder bin local (D:\ContentCut\bin\ffmpeg.exe)
    local_bin = Path(__file__).parent.parent.parent / "bin" / "ffmpeg.exe"
    if local_bin.exists():
        return str(local_bin)
    
    # 3. Cek langsung di root
    root_bin = Path(__file__).parent.parent.parent / "ffmpeg.exe"
    if root_bin.exists():
        return str(root_bin)
        
    return "ffmpeg"  # Fallback ke default, biarkan error jika tidak ada

def get_ffprobe_path():
    """Cari path ffprobe.exe di system PATH atau folder bin local."""
    ffprobe_path = shutil.which("ffprobe")
    if ffprobe_path:
        return ffprobe_path
    
    local_bin = Path(__file__).parent.parent.parent / "bin" / "ffprobe.exe"
    if local_bin.exists():
        return str(local_bin)
    
    root_bin = Path(__file__).parent.parent.parent / "ffprobe.exe"
    if root_bin.exists():
        return str(root_bin)
        
    return "ffprobe"
