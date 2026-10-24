"""Generate original, quiet PCM sound effects. Run with python3 scripts/generate-sounds.py."""
import math
from pathlib import Path
import struct
import wave

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / 'src/assets/sounds'
# Each note is (start seconds, duration seconds, frequency Hz, peak amplitude).
SOUNDS = {
    'mark': [(0, .045, 480, .10)],
    'correct': [(0, .12, 660, .16), (.09, .18, 880, .14)],
    'wrong': [(0, .16, 260, .14), (.12, .20, 195, .12)],
    'win': [(0, .16, 523, .16), (.13, .16, 659, .16), (.26, .18, 784, .16), (.41, .38, 1047, .14)],
    'lose': [(0, .22, 392, .14), (.18, .24, 330, .13), (.38, .38, 262, .12)],
    'owl': [(0, .24, 440, .16), (.28, .32, 350, .14)],
    'squirrel': [(0, .07, 1050, .12), (.09, .07, 1320, .12), (.18, .10, 1180, .10)],
    'woodpecker': [(0, .045, 700, .16), (.09, .045, 700, .14), (.18, .045, 700, .12)],
}
OUT.mkdir(parents=True, exist_ok=True)
for name, notes in SOUNDS.items():
    samples = [0.] * math.ceil(max(start + duration for start, duration, _, _ in notes) * RATE)
    for start, duration, frequency, amplitude in notes:
        for i in range(int(duration * RATE)):
            t = i / RATE
            envelope = min(t / .006, 1) * (1 - t / duration) ** 2
            samples[int(start * RATE) + i] += amplitude * envelope * math.sin(2 * math.pi * frequency * t)
    with wave.open(str(OUT / f'{name}.wav'), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', round(value * 32767)) for value in samples))
