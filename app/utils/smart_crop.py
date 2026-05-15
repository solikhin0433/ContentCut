import cv2
import mediapipe as mp
import numpy as np
from pathlib import Path

mp_face_detection = mp.solutions.face_detection

def calculate_smart_crop(video_path: str, target_aspect_ratio: float = 9/16) -> str:
    """
    Menganalisa video untuk menemukan area wajah dan menentukan posisi crop X yang ideal.
    Returns: string 'x_pos' untuk filter crop ffmpeg (misal: 'in_w*0.2')
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return "(in_w-out_w)/2" # Fallback ke center

    # Ambil frame di tengah durasi agar lebih representatif
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 2)
    
    success, frame = cap.read()
    cap.release()

    if not success:
        return "(in_w-out_w)/2"

    h, w, _ = frame.shape
    
    # Deteksi Wajah
    with mp_face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5) as face_detection:
        results = face_detection.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        if not results.detections:
            return "(in_w-out_w)/2" # Tidak ada wajah, balik ke tengah

        # Hitung rata-rata posisi X wajah
        face_x_centers = []
        for detection in results.detections:
            bbox = detection.location_data.relative_bounding_box
            face_x_centers.append(bbox.xmin + (bbox.width / 2))
        
        avg_face_x = np.mean(face_x_centers)
        
        # Hitung target width (out_w) berdasarkan aspect ratio
        out_w = h * target_aspect_ratio
        
        # Tentukan x_offset agar avg_face_x berada di tengah out_w
        # Target X center adalah avg_face_x * w
        # out_w / 2 harus ada di kiri dan kanan titik pusat tersebut
        x_start = (avg_face_x * w) - (out_w / 2)
        
        # Pastikan tidak keluar batas (clamping)
        x_start = max(0, min(w - out_w, x_start))
        
        # Return dalam format string yang dipahami FFmpeg
        # Kita gunakan nilai absolut pixel karena kita sudah hitung
        return str(int(x_start))
