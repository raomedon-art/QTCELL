"""Supertonic CPU inference, restricted to the local preview server."""
import io
import json
import os
from pathlib import Path
import sys
import threading
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent / 'native-deps'))


class NativeVoice:
    def __init__(self, directory):
        self.directory = Path(directory) / 'assets' / 'tts' / 'model'
        self.lock = threading.Lock()
        self.engine = None
        self.styles = {}
        self.threads = min(4, max(1, (os.cpu_count() or 2) // 2))

    def load(self):
        with self.lock:
            self._load()

    def _load(self):
        if self.engine is not None:
            return
        import onnxruntime as ort
        from supertonic_helper import TextToSpeech, UnicodeProcessor, load_voice_style
        model = self.directory / 'onnx'
        options = ort.SessionOptions()
        options.intra_op_num_threads = self.threads
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sessions = [ort.InferenceSession(str(model / (name + '.onnx')), sess_options=options, providers=['CPUExecutionProvider'])
                    for name in ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']]
        with (model / 'tts.json').open(encoding='utf-8') as file:
            config = json.load(file)
        engine = TextToSpeech(config, UnicodeProcessor(str(model / 'unicode_indexer.json')), *sessions)
        styles = {name: load_voice_style([str(self.directory / 'voice_styles' / (name + '.json'))]) for name in ['F1', 'F2', 'M1', 'M2']}
        self.styles, self.engine = styles, engine

    def synthesize(self, text, voice):
        if voice not in ['F1', 'F2', 'M1', 'M2'] or not isinstance(text, str) or not text.strip() or len(text) > 300:
            raise ValueError('Invalid voice request')
        # Bound concurrent work. A disconnected client never queues a whole article.
        if not self.lock.acquire(timeout=3):
            raise TimeoutError('Voice engine busy')
        try:
            import numpy as np
            self._load()
            started = time.perf_counter()
            audio, duration = self.engine(text, 'ko', self.styles[voice], 5, 1.0, 0.16)
            sample_rate = self.engine.sample_rate
            samples = audio.reshape(-1)[:int(float(duration[0]) * sample_rate)]
            pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
            output = io.BytesIO()
            with wave.open(output, 'wb') as file:
                file.setnchannels(1)
                file.setsampwidth(2)
                file.setframerate(sample_rate)
                file.writeframes(pcm)
            return output.getvalue(), time.perf_counter() - started, len(samples) / sample_rate
        finally:
            self.lock.release()
