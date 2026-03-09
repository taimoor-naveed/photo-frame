"""Detection of Motion Photo formats (Google Pixel, Samsung).

Motion Photos are JPEGs with an embedded video appended after the image data.
This module detects the presence and format of the embedded video.
"""

import logging
import re

logger = logging.getLogger(__name__)

# --- Compiled patterns ---

_SAMSUNG_MARKER = b"MotionPhoto_Data"

_MICRO_VIDEO_RE = re.compile(rb'GCamera:MicroVideo="1"')
_MICRO_VIDEO_OFFSET_RE = re.compile(rb'GCamera:MicroVideoOffset="(\d+)"')

_MOTION_PHOTO_RE = re.compile(rb'GCamera:MotionPhoto="1"')
_ITEM_LENGTH_RE = re.compile(rb'Item:Length="(\d+)"')

_MIN_VIDEO_SIZE = 8  # minimum MP4 ftyp box


def detect_motion_photo(data: bytes) -> dict | None:
    """Detect if JPEG data contains an embedded Motion Photo video.

    Returns dict with 'format' and 'video_offset' keys, or None.
    - format: "pixel" or "samsung"
    - video_offset: byte offset where video starts in the data
    """
    if len(data) < 20:
        return None

    # --- Samsung: MotionPhoto_Data marker ---
    samsung_pos = data.find(_SAMSUNG_MARKER)
    if samsung_pos != -1:
        video_start = samsung_pos + len(_SAMSUNG_MARKER)
        video_size = len(data) - video_start
        if video_size >= _MIN_VIDEO_SIZE:
            return {"format": "samsung", "video_offset": video_start}

    # --- Google Pixel older: MicroVideo + MicroVideoOffset ---
    if _MICRO_VIDEO_RE.search(data):
        m = _MICRO_VIDEO_OFFSET_RE.search(data)
        if m:
            offset = int(m.group(1))
            if offset > 0:
                video_start = len(data) - offset
                video_size = offset
                if video_start > 0 and video_size >= _MIN_VIDEO_SIZE:
                    return {"format": "pixel", "video_offset": video_start}

    # --- Google Pixel newer: MotionPhoto + Item:Length ---
    if _MOTION_PHOTO_RE.search(data):
        m = _ITEM_LENGTH_RE.search(data)
        if m:
            length = int(m.group(1))
            if length > 0:
                video_start = len(data) - length
                video_size = length
                if video_start > 0 and video_size >= _MIN_VIDEO_SIZE:
                    return {"format": "pixel", "video_offset": video_start}

    return None


def extract_motion_video(data: bytes) -> bytes | None:
    """Extract embedded video from Motion Photo data.

    Returns the video bytes, or None if no valid Motion Photo is detected.
    """
    info = detect_motion_photo(data)
    if info is None:
        return None

    video_bytes = data[info["video_offset"]:]

    if len(video_bytes) < _MIN_VIDEO_SIZE:
        logger.warning(
            "Motion Photo video too small (%d bytes), skipping", len(video_bytes)
        )
        return None

    logger.info(
        "Extracted %d-byte %s Motion Photo video",
        len(video_bytes),
        info["format"],
    )
    return video_bytes
