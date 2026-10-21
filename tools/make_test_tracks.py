"""
Генератор тестовых аудиофайлов для проверки плеера.

Создаёт:
  * MP3 с полными ID3v2-тегами (название, исполнитель, альбом, год, номер трека)
  * WAV с настоящим звуковым тоном

Запуск:  python tools/make_test_tracks.py [папка_назначения]
"""

import math
import os
import struct
import sys
import wave

# --- MP3: синтезируем «тихие» MPEG-1 Layer III кадры ---------------------

MPEG1_LAYER3_128K_44K_STEREO = bytes([0xFF, 0xFB, 0x90, 0x00])
FRAME_SIZE = 144 * 128000 // 44100  # 417 байт на кадр при 128 кбит/с


def build_id3_frame(frame_id: str, text: str) -> bytes:
    payload = b"\x03" + text.encode("utf-8") + b"\x00"  # кодировка UTF-8
    return frame_id.encode("ascii") + struct.pack(">I", len(payload)) + b"\x00\x00" + payload


def build_id3v2(tags: dict) -> bytes:
    frames = b""
    frames += build_id3_frame("TIT2", tags["title"])
    frames += build_id3_frame("TPE1", tags["artist"])
    frames += build_id3_frame("TALB", tags["album"])
    frames += build_id3_frame("TYER", str(tags["year"]))
    frames += build_id3_frame("TRCK", str(tags["track"]))
    frames += build_id3_frame("TCON", tags.get("genre", ""))

    size = len(frames)
    synchsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3" + bytes([3, 0, 0]) + synchsafe + frames


def write_mp3(path: str, tags: dict, seconds: int = 6) -> None:
    frame = MPEG1_LAYER3_128K_44K_STEREO + b"\x00" * (FRAME_SIZE - 4)
    frames = frame * int(seconds * 44100 / 1152)
    with open(path, "wb") as fh:
        fh.write(build_id3v2(tags))
        fh.write(frames)


# --- WAV: настоящий тон -----------------------------------------------

def write_wav(path: str, freq: float, seconds: float = 4.0, rate: int = 22050) -> None:
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(rate)
        frames = bytearray()
        total = int(rate * seconds)
        for i in range(total):
            # Простая огибающая, чтобы звук не резал уши
            env = min(1.0, i / 2000, (total - i) / 2000)
            value = int(12000 * env * math.sin(2 * math.pi * freq * i / rate))
            frames += struct.pack("<h", value)
        fh.writeframes(bytes(frames))


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "Music", "Тест")
    os.makedirs(target, exist_ok=True)

    album_dir = os.path.join(target, "Тестовый альбом")
    os.makedirs(album_dir, exist_ok=True)

    tracks = [
        {"title": "Рассвет в городе", "artist": "Неоновый ветер", "album": "Тестовый альбом", "year": 2024, "track": 1, "genre": "Synthwave"},
        {"title": "Ночная магистраль", "artist": "Неоновый ветер", "album": "Тестовый альбом", "year": 2024, "track": 2, "genre": "Synthwave"},
        {"title": "Тихий двор", "artist": "Акварель", "album": "Тестовый альбом", "year": 2025, "track": 3, "genre": "Ambient"},
    ]

    for index, tags in enumerate(tracks):
        path = os.path.join(album_dir, f"{index + 1:02d} - {tags['title']}.mp3")
        write_mp3(path, tags)
        print(f"MP3 : {path}")

    wav_path = os.path.join(album_dir, "Сигнал.wav")
    write_wav(wav_path, 440.0)
    print(f"WAV : {wav_path}")

    print(f"\nГотово. Добавьте папку в плеере: {target}")


if __name__ == "__main__":
    main()
