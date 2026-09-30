FROM python:3.11-slim

# ffmpeg provides ffprobe (source validation, M2.4) and ffmpeg (rendering,
# M4 — built with libass/libfribidi/libharfbuzz for subtitle burn-in + RTL).
# libgl1/libglib2.0-0 satisfy opencv-python-headless's/mediapipe's runtime
# linking even without a display (M4.2 face detection).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
