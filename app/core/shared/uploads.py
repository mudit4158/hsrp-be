"""An uploaded photo handed from a router to a core service (bytes, MIME type, original file name)."""

from dataclasses import dataclass


@dataclass
class Photo:
    data: bytes
    mime_type: str
    filename: str | None = None
