FROM python:3.11-slim

# Unbuffered stdout/stderr — without this, Python fully buffers output when
# it's not a TTY (always true in a container), so log.py's print()-based
# structured logs (M8.2) can sit invisible in the buffer for a long time
# instead of reaching the host's log stream in real time.
ENV PYTHONUNBUFFERED=1

# ffmpeg provides ffprobe (source validation, M2.4) and ffmpeg (rendering,
# M4 — built with libass/libfribidi/libharfbuzz for subtitle burn-in + RTL).
# libgl1/libglib2.0-0 satisfy opencv-python-headless's/mediapipe's runtime
# linking even without a display (M4.2 face detection). fonts-dejavu-core
# provides the watermark's drawtext font (M7.5) at
# ffmpeg_filters.WATERMARK_FONT_PATH.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
