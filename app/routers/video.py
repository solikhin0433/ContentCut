from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uuid
from app.utils.downloader import get_video_info, download_video
from app.utils.cutter import cut_video, cleanup_file

router = APIRouter(prefix="/api/video", tags=["video"])


class VideoInfoRequest(BaseModel):
    url: str


class CutVideoRequest(BaseModel):
    url: str
    start_time: str
    end_time: str
    quality: str = "720p"
    aspect_ratio: str = "original"
    crop_position: str = "center"


@router.post("/info")
async def video_info(request: VideoInfoRequest):
    try:
        info = get_video_info(request.url)
        return {"success": True, "data": info}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cut")
async def cut_video_endpoint(request: CutVideoRequest, background_tasks: BackgroundTasks):
    temp_file = None
    try:
        temp_file = download_video(request.url, request.quality)
        output_filename = f"cut_{uuid.uuid4().hex[:8]}.mp4"
        output_path = cut_video(
            input_path=temp_file,
            start_time=request.start_time,
            end_time=request.end_time,
            output_filename=output_filename,
            aspect_ratio=request.aspect_ratio,
            crop_position=request.crop_position
        )
        if temp_file:
            background_tasks.add_task(cleanup_file, temp_file)
        background_tasks.add_task(cleanup_file, output_path)
        
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type="video/mp4"
        )
    except Exception as e:
        if temp_file:
            cleanup_file(temp_file)
        raise HTTPException(status_code=500, detail=str(e))
