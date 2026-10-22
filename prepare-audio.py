"""Build immutable, seekable speech assets before a visitor presses play.

Uses the existing publishable client and existing private bucket policies.
No service key, paid speech API, or browser/device voice is used.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
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


def request(path, data=None, method=None, content_type='application/json', extra_headers=None):
    if isinstance(data, (dict, list)):
        data = json.dumps(data, ensure_ascii=False).encode()
    headers = {'apikey': KEY, 'Content-Type': content_type}
    headers.update(extra_headers or {})
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
    # Only replace derived speech assets. Reusing their paths keeps the free
    # storage footprint bounded; the manifest carries an audio cache revision.
    if not path.startswith('audio/v1/'):
        raise ValueError('Not a generated speech asset')
    request(f'/storage/v1/object/{BUCKET}/{path}', data, 'POST', mime,
            {'x-upsert': 'true', 'Cache-Control': 'max-age=60'})


def read_manifest(record, voice):
    path = prefix(record, voice) + '/manifest.json'
    try:
        signed = json.loads(request(f'/storage/v1/object/sign/{BUCKET}/{path}', {'expiresIn': 60}))['signedURL']
        address = signed if signed.startswith('https://') else URL + '/storage/v1' + signed
        with urlopen(address + '&refresh=' + str(time.time_ns()), timeout=90) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code in (400, 404):
            return None
        raise


def matches(manifest, chunks):
    return bool(manifest and not manifest.get('updating')
                and manifest.get('chunks') == chunks
                and all(style in manifest.get('tracks', {}) for style in ['gentle', 'standard']))


def records():
    rows = json.loads(request('/rest/v1/qtcell_records?select=id,summary,content_html,meeting_date,publication_status,audio_source_hash,created_at&order=created_at.desc&limit=1000'))
    return [r for r in rows if r.get('summary', '').strip()]


def publication_progress(record, voice, percent, error=None, ready=False):
    if voice != 'F1' or record.get('publication_status') != 'pending':
        return
    # A superseded edit must never be published by an older generation job.
    query = f'/rest/v1/qtcell_records?id=eq.{record["id"]}&audio_source_hash=eq.{source_hash(record)}&publication_status=eq.pending'
    body = {'audio_progress': percent, 'audio_error': error}
    if ready:
        body['publication_status'] = 'published'
    request(query, body, 'PATCH')


def missing_jobs(rows):
    rows = sorted(rows, key=lambda record: record.get('publication_status') != 'pending')
    candidates = []
    for record in rows:
        chunks = chunks_for(record['summary'])
        for voice in ['F1', 'F2', 'M1', 'M2']:
            candidates.append((record, voice, chunks))
    def missing(candidate):
        record, voice, chunks = candidate
        if voice == 'F1' and record.get('publication_status') == 'pending':
            return {'id': record['id'], 'voice': voice}
        if not matches(read_manifest(record, voice), chunks):
            return {'id': record['id'], 'voice': voice}
        return None
    # Bound network concurrency while preserving pending/newest-first order.
    with ThreadPoolExecutor(max_workers=8) as pool:
        return [job for job in pool.map(missing, candidates) if job]


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
    chunks = chunks_for(record['summary'])
    previous = read_manifest(record, voice)
    if matches(previous, chunks):
        publication_progress(record, voice, 100, ready=True)
        return engine
    publication_progress(record, voice, 1)
    if engine is None:
        from native_voice import NativeVoice
        engine = NativeVoice(ROOT)
        engine.threads = min(4, os.cpu_count() or 1)
        engine.load()
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
            publication_progress(record, voice, max(1, round((index + 1) / len(chunks) * 94)))
            print(f'{record["id"]} {voice} {index + 1}/{len(chunks)} RTF={elapsed / duration:.2f}', flush=True)
    tracks, uploads = {}, []
    revision = hashlib.sha256()
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
            uploads.append((path, data))
            revision.update(data)
            tracks[style] = {'path': path, 'ends': ends, 'duration': total, 'bytes': len(data)}
    # Invalidate the old cue sheet before replacing either audio file. A failed
    # upload leaves a retryable marker, never a ready manifest with stale cues.
    if previous:
        upload(base + '/manifest.json', json.dumps({'version': 1, 'updating': True}).encode(), 'application/json')
    for path, data in uploads:
        upload(path, data, 'audio/ogg')
    manifest = {'version': 1, 'audioRevision': revision.hexdigest()[:24], 'sourceHash': source_hash(record), 'voice': voice, 'chunks': chunks, 'tracks': tracks}
    # Commit the manifest LAST: readers can never discover a half-written track.
    upload(base + '/manifest.json', json.dumps(manifest, ensure_ascii=False).encode(), 'application/json')
    if not matches(read_manifest(record, voice), chunks):
        raise RuntimeError('Published audio verification failed')
    publication_progress(record, voice, 100, ready=True)
    print(f'READY {record["id"]} {voice} {tracks["gentle"]["duration"]:.1f}s', flush=True)
    return engine


def pending_records():
    return json.loads(request('/rest/v1/qtcell_records?select=id,summary,content_html,publication_status,audio_source_hash&publication_status=eq.pending&order=created_at.asc&limit=1000'))


def watch_queue(seconds=18900, poll_seconds=20):
    """Keep the builder ready between uploads instead of relying on cron latency.

    One workflow owns this loop through the existing concurrency group. Recheck
    pending default voices before every optional voice, retaining the loaded
    model. Stop before the runner limit so the queued successor can take over.
    """
    deadline = time.monotonic() + seconds
    engine, model_ready = None, False
    retry_after, backlog = {}, []
    next_scan = 0
    while time.monotonic() < deadline:
        selected = None
        try:
            pending = pending_records()
            for record in pending:
                key = (record['id'], source_hash(record), 'F1')
                if retry_after.get(key, 0) <= time.monotonic():
                    selected = (record, 'F1')
                    break
            if selected is None:
                if not backlog and time.monotonic() >= next_scan:
                    rows = records()
                    rows.insert(0, {'id': 'preview', 'summary': PREVIEW})
                    by_id = {record['id']: record for record in rows}
                    backlog = [(by_id[job['id']], job['voice']) for job in missing_jobs(rows)]
                    next_scan = time.monotonic() + 300
                    # New pending records discovered during the scan take priority
                    # on the next iteration, before this optional backlog.
                    continue
                while backlog:
                    candidate = backlog.pop(0)
                    record, voice = candidate
                    key = (record['id'], source_hash(record), voice)
                    if retry_after.get(key, 0) <= time.monotonic():
                        selected = candidate
                        break
            if selected is None:
                time.sleep(min(poll_seconds, max(0, deadline - time.monotonic())))
                continue
            record, voice = selected
            # Show that the queue has been accepted even during first model setup.
            publication_progress(record, voice, 1)
            if not model_ready:
                download_model()
                model_ready = True
            engine = build(record, voice, engine)
            retry_after.pop((record['id'], source_hash(record), voice), None)
        except Exception as error:
            print(f'QUEUE RETRY {type(error).__name__}', flush=True)
            if selected:
                record, voice = selected
                retry_after[(record['id'], source_hash(record), voice)] = time.monotonic() + 60
                try:
                    publication_progress(record, voice, 0, error='음성 준비를 다시 시도하고 있습니다. 글은 안전하게 저장되어 있습니다.')
                except Exception:
                    pass
            time.sleep(min(poll_seconds, max(0, deadline - time.monotonic())))
    print('Queue worker completed its rotation window', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--id')
    parser.add_argument('--voice', choices=['F1', 'F2', 'M1', 'M2'])
    parser.add_argument('--local-model', action='store_true')
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--watch-seconds', type=int, default=18900)
    args = parser.parse_args()
    if args.watch:
        watch_queue(args.watch_seconds)
        return
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
            try:
                engine = build(row, voice, engine)
            except Exception:
                publication_progress(row, voice, 0, error='음성 준비를 마치지 못했습니다. 다음 작업에서 자동으로 다시 시도합니다.')
                raise


if __name__ == '__main__':
    main()
