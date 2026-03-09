"""Unit tests for Motion Photo detection service."""

import struct

import pytest

from app.services.motion_photo import detect_motion_photo, extract_motion_video

# --- Constants ---

JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"
# Minimal MP4 ftyp box: size(4) + 'ftyp' + 'isom'
FAKE_VIDEO = b"\x00\x00\x00\x1c\x66\x74\x79\x70\x69\x73\x6f\x6d"
XMP_NS = b"http://ns.adobe.com/xap/1.0/\x00"


# --- Test data builders ---


def _make_jpeg_with_xmp(xmp_payload: bytes, appended: bytes = b"") -> bytes:
    """Build a minimal JPEG with an APP1 XMP segment and optional appended data."""
    # APP1 marker: 0xFFE1 + 2-byte length (includes length bytes itself)
    xmp_data = XMP_NS + xmp_payload
    segment_length = len(xmp_data) + 2  # +2 for the length field itself
    app1 = b"\xff\xe1" + struct.pack(">H", segment_length) + xmp_data
    return JPEG_SOI + app1 + JPEG_EOI + appended


def _make_plain_jpeg() -> bytes:
    """Build a minimal valid JPEG with no XMP."""
    return JPEG_SOI + JPEG_EOI


def _make_pixel_older(video: bytes) -> bytes:
    """Build a Pixel older-format Motion Photo (MicroVideoOffset)."""
    offset = len(video)
    xmp = (
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        b'<rdf:RDF>'
        b'<rdf:Description '
        b'xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" '
        b'GCamera:MicroVideo="1" '
        b'GCamera:MicroVideoOffset="' + str(offset).encode() + b'" '
        b'/>'
        b'</rdf:RDF>'
        b'</x:xmpmeta>'
    )
    return _make_jpeg_with_xmp(xmp, video)


def _make_pixel_newer(video: bytes) -> bytes:
    """Build a Pixel newer-format Motion Photo (MotionPhoto + Item:Length)."""
    length = len(video)
    xmp = (
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        b'<rdf:RDF>'
        b'<rdf:Description '
        b'xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" '
        b'xmlns:Container="http://ns.google.com/photos/1.0/container/" '
        b'GCamera:MotionPhoto="1" '
        b'GCamera:MotionPhotoVersion="1" '
        b'/>'
        b'<Container:Directory>'
        b'<rdf:Seq>'
        b'<rdf:li>'
        b'<Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/>'
        b'</rdf:li>'
        b'<rdf:li>'
        b'<Container:Item Item:Semantic="MotionPhoto" '
        b'Item:Mime="video/mp4" '
        b'Item:Length="' + str(length).encode() + b'"/>'
        b'</rdf:li>'
        b'</rdf:Seq>'
        b'</Container:Directory>'
        b'</rdf:RDF>'
        b'</x:xmpmeta>'
    )
    return _make_jpeg_with_xmp(xmp, video)


def _make_samsung_older(video: bytes) -> bytes:
    """Build a Samsung-format Motion Photo (MotionPhoto_Data marker)."""
    return JPEG_SOI + JPEG_EOI + b"MotionPhoto_Data" + video


# --- Test class ---


class TestDetectMotionPhoto:
    """Tests for detect_motion_photo()."""

    def test_regular_jpeg_returns_none(self):
        """A plain JPEG with no XMP returns None."""
        data = _make_plain_jpeg()
        assert detect_motion_photo(data) is None

    def test_empty_bytes_returns_none(self):
        """Empty input returns None."""
        assert detect_motion_photo(b"") is None

    def test_random_binary_returns_none(self):
        """Non-JPEG random bytes return None."""
        assert detect_motion_photo(b"\x89PNG\r\n\x1a\nrandomdata" * 10) is None

    def test_pixel_older_format(self):
        """Pixel older format (MicroVideoOffset) is detected."""
        data = _make_pixel_older(FAKE_VIDEO)
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "pixel"
        assert result["video_offset"] == len(data) - len(FAKE_VIDEO)

    def test_pixel_newer_format(self):
        """Pixel newer format (MotionPhoto + Item:Length) is detected."""
        data = _make_pixel_newer(FAKE_VIDEO)
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "pixel"
        assert result["video_offset"] == len(data) - len(FAKE_VIDEO)

    def test_samsung_older_format(self):
        """Samsung format (MotionPhoto_Data marker) is detected."""
        data = _make_samsung_older(FAKE_VIDEO)
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "samsung"
        assert result["video_offset"] == len(data) - len(FAKE_VIDEO)

    def test_offset_beyond_file_size_returns_none(self):
        """MicroVideoOffset larger than file size returns None."""
        xmp = (
            b'<x:xmpmeta>'
            b'<rdf:Description '
            b'GCamera:MicroVideo="1" '
            b'GCamera:MicroVideoOffset="999999" '
            b'/>'
            b'</x:xmpmeta>'
        )
        data = _make_jpeg_with_xmp(xmp, b"tiny")
        assert detect_motion_photo(data) is None

    def test_offset_zero_returns_none(self):
        """MicroVideoOffset of 0 returns None."""
        xmp = (
            b'<x:xmpmeta>'
            b'<rdf:Description '
            b'GCamera:MicroVideo="1" '
            b'GCamera:MicroVideoOffset="0" '
            b'/>'
            b'</x:xmpmeta>'
        )
        data = _make_jpeg_with_xmp(xmp, FAKE_VIDEO)
        assert detect_motion_photo(data) is None

    def test_item_length_zero_returns_none(self):
        """Item:Length of 0 returns None."""
        xmp = (
            b'<x:xmpmeta>'
            b'<rdf:Description '
            b'GCamera:MotionPhoto="1" '
            b'/>'
            b'<Container:Item Item:Length="0"/>'
            b'</x:xmpmeta>'
        )
        data = _make_jpeg_with_xmp(xmp, FAKE_VIDEO)
        assert detect_motion_photo(data) is None

    def test_unrelated_xmp_returns_none(self):
        """JPEG with XMP but no GCamera namespace returns None."""
        xmp = (
            b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            b'<rdf:RDF>'
            b'<rdf:Description '
            b'xmlns:dc="http://purl.org/dc/elements/1.1/" '
            b'dc:creator="Test"'
            b'/>'
            b'</rdf:RDF>'
            b'</x:xmpmeta>'
        )
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None


class TestExtractMotionVideo:
    """Tests for extract_motion_video()."""

    def test_extract_from_pixel_older(self):
        """Pixel older format yields the embedded video bytes."""
        data = _make_pixel_older(FAKE_VIDEO)
        result = extract_motion_video(data)
        assert result == FAKE_VIDEO

    def test_extract_from_pixel_newer(self):
        """Pixel newer format yields the embedded video bytes."""
        data = _make_pixel_newer(FAKE_VIDEO)
        result = extract_motion_video(data)
        assert result == FAKE_VIDEO

    def test_extract_from_samsung(self):
        """Samsung format yields the embedded video bytes."""
        data = _make_samsung_older(FAKE_VIDEO)
        result = extract_motion_video(data)
        assert result == FAKE_VIDEO

    def test_plain_jpeg_returns_none(self):
        """A plain JPEG with no Motion Photo returns None."""
        data = _make_plain_jpeg()
        assert extract_motion_video(data) is None

    def test_empty_bytes_returns_none(self):
        """Empty input returns None."""
        assert extract_motion_video(b"") is None

    def test_tiny_video_returns_none(self):
        """Motion Photo with video smaller than 8 bytes returns None."""
        tiny_video = b"\x00\x01\x02"  # 3 bytes, below _MIN_VIDEO_SIZE
        # Pixel older format embeds the tiny video but detect should reject it
        data = _make_pixel_older(tiny_video)
        assert extract_motion_video(data) is None

    def test_samsung_marker_at_very_end_returns_none(self):
        """Samsung marker present but nothing after it returns None."""
        data = JPEG_SOI + JPEG_EOI + b"MotionPhoto_Data"
        assert extract_motion_video(data) is None
