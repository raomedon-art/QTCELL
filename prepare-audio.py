"""Build immutable, seekable speech assets before a visitor presses play.

Uses the existing publishable client and existing private bucket policies.
No service key, paid speech API, or browser/device voice is used.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave

ROOT = Path(__file__).resolve().parent
URL = 'https://pevpdhrjlmdpgbilquwe.supabase.co'
KEY = 'sb_publishable_jKkqBIEpTjMGMxObZttP-g_FheNzmHO'
BUCKET = 'qtcell-files'
REVISION = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'
MODEL_URL = f'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/{REVISION}/'
PREVIEW = '말씀을 함께 나누는 시간입니다. 오늘의 묵상을 차분하게 들어보세요.'


def request(path, data=None, method=None, content_type='application/json'):
    if isinstance(data, (dict, list)):
        data = json.dumps(data, ensure_ascii=False).encode()
    headers = {'apikey': KEY, 'Content-Type': content_type}
    for attempt in range(3):
        try:
            with urlopen(Request(URL + path, data, headers, method=method), timeout=90) as response:
                return response.read()
        except HTTPError as error:
            if error.code < 500 or attempt == 2:
                raise
        except (TimeoutError, OSError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def source_hash(record):
    return hashlib.sha256((record.get('content_html') or record.get('summary') or '').encode()).hexdigest()


def prefix(record, voice):
    return f'audio/v1/{record["id"]}/{source_hash(record)}/{voice}'


def exists(path):
    try:
        data = json.loads(request(f'/storage/v1/object/sign/{BUCKET}/{path}', {'expiresIn': 60}))
        return bool(data.get('signedURL'))
    except HTTPError as error:
        if error.code in (400, 404):
            return False
        raise


def upload(path, data, mime):
    # Immutable content-addressed paths. Never overwrite unrelated user files.
    try:
        request(f'/storage/v1/object/{BUCKET}/{path}', data, 'POST', mime)
    except HTTPError as error:
        if error.code not in (400, 409) or not exists(path):
            raise


def records():
    rows = json.loads(request('/rest/v1/qtcell_records?select=id,summary,content_html,meeting_date&order=meeting_date.desc&limit=1000'))
    return [r for r in rows if r.get('summary', '').strip()]


def missing_jobs(rows):
    jobs = []
    for record in rows:
        for voice in ['F1', 'F2', 'M1', 'M2']:
            if not exists(prefix(record, voice) + '/manifest.json'):
                jobs.append({'id': record['id'], 'voice': voice})
    return jobs


def download_model():
    directory = ROOT / 'assets/tts/model'
    tree = json.loads(urlopen(f'https://huggingface.co/api/models/supertone-oss-archive/supertonic-3/tree/{REVISION}?recursive=true', timeout=60).read())
    names = ['LICENSE', 'onnx/tts.json', 'onnx/unicode_indexer.json']
    names += [f'onnx/{n}.onnx' for n in ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']]
    names += [f'voice_styles/{v}.json' for v in ['F1', 'F2', 'M1', 'M2']]
    metadata = {entry['path']: entry for entry in tree}
    for name in names:
        dest = directory / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        meta = metadata[name]
        if not dest.exists() or dest.stat().st_size != meta['size']:
            with urlopen(MODEL_URL + name, timeout=300) as response, dest.open('wb') as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
        expected = meta.get('lfs', {}).get('oid')
        if expected and hashlib.sha256(dest.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Model checksum mismatch: {name}')


def chunks_for(text):
    code = 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(require("./speech-text.js").splitText(s))));'
    result = subprocess.run(['node', '-e', code], input=text.encode(), cwd=ROOT, capture_output=True, check=True)
    return json.loads(result.stdout)


def build(record, voice, engine=None):
    base = prefix(record, voice)
    if exists(base + '/manifest.json'):
        return engine
    if engine is None:
        from native_voice import NativeVoice
        engine = NativeVoice(ROOT)
        engine.threads = min(4, os.cpu_count() or 1)
        engine.load()
    chunks = chunks_for(record['summary'])
    if not chunks:
        raise ValueError('No speech chunks')
    pcm_parts, durations = [], []
    for index, chunk in enumerate(chunks):
        wav, elapsed, duration = engine.synthesize(chunk['text'], voice)
        with wave.open(io.BytesIO(wav), 'rb') as audio:
            sample_rate = audio.getframerate()
            pcm = audio.readframes(audio.getnframes())
        pcm_parts.append(pcm)
        durations.append(len(pcm) / (sample_rate * 2))
        if index % 10 == 0:
            print(f'{record["id"]} {voice} {index + 1}/{len(chunks)} RTF={elapsed / duration:.2f}', flush=True)
    tracks = {}
    with tempfile.TemporaryDirectory() as directory:
        for style in ['gentle', 'standard']:
            wav_path, out_path = Path(directory) / 'track.wav', Path(directory) / 'track.ogg'
            total, ends = 0, []
            with wave.open(str(wav_path), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                for index, pcm in enumerate(pcm_parts):
                    output.writeframes(pcm)
                    pause = min(160, chunks[index]['pause']) if style == 'gentle' and index < len(chunks) - 1 else 0
                    silence = round(sample_rate * pause / 1000)
                    output.writeframes(b'\0\0' * silence)
                    total += len(pcm) / (sample_rate * 2) + silence / sample_rate
                    ends.append(total)
            subprocess.run([os.environ.get('FFMPEG', 'ffmpeg'), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav_path), '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '20k', '-vbr', 'off', '-application', 'voip', str(out_path)], check=True)
            data = out_path.read_bytes()
            path = base + '/' + style + '.ogg'
            upload(path, data, 'audio/ogg')
            tracks[style] = {'path': path, 'ends': ends, 'duration': total, 'bytes': len(data)}
    manifest = {'version': 1, 'sourceHash': source_hash(record), 'voice': voice, 'chunks': chunks, 'tracks': tracks}
    # Commit the manifest LAST: readers can never discover a half-written track.
    upload(base + '/manifest.json', json.dumps(manifest, ensure_ascii=False).encode(), 'application/json')
    print(f'READY {record["id"]} {voice} {tracks["gentle"]["duration"]:.1f}s', flush=True)
    return engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--id')
    parser.add_argument('--voice', choices=['F1', 'F2', 'M1', 'M2'])
    parser.add_argument('--local-model', action='store_true')
    args = parser.parse_args()
    rows = records()
    rows.insert(0, {'id': 'preview', 'content_html': '', 'summary': PREVIEW})
    if args.plan:
        jobs = missing_jobs(rows)
        # Limit each run to GitHub's 256-job matrix cap; later runs pick up the rest.
        matrix = json.dumps({'include': jobs[:256]}, separators=(',', ':'))
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('matrix=' + matrix + '\n')
            output.write('count=' + str(len(jobs)) + '\n')
        print(f'{len(jobs)} voice tracks need preparation')
        return
    selected = [r for r in rows if r['id'] == args.id] if args.id else rows
    if not selected:
        raise ValueError('Record not found')
    if not args.local_model:
        download_model()
    engine = None
    for row in selected:
        for voice in ([args.voice] if args.voice else ['F1', 'F2', 'M1', 'M2']):
            engine = build(row, voice, engine)


if __name__ == '__main__':
    main()
