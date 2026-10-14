# 묵상셀 · 비공개 묵상 자료실

교회 묵상 자료와 첨부 파일을 함께 관리하는 정적 웹사이트입니다. GitHub Pages에 화면을 올릴 수 있으며, 여러 컴퓨터가 같은 자료를 보려면 Supabase 공유 저장소를 연결해야 합니다.

## 왜 다른 컴퓨터에서 자료가 보이지 않았나요?

기존 버전은 목록을 브라우저 `localStorage`, 첨부 파일과 본문을 `IndexedDB`에 저장했습니다. 이 저장소는 자료를 등록한 브라우저 안에만 있으므로 GitHub Pages에 사이트 파일을 올려도 등록 자료는 함께 배포되지 않습니다.

현재 버전은 다음 두 방식으로 동작합니다.

- `cloud-config.js`가 비어 있으면 기존처럼 현재 브라우저에만 저장
- Supabase 연결 정보가 있으면 자료, 본문, 첨부 파일, 멤버 목록을 공유 저장소에 저장

## Supabase 공유 저장소 연결

1. [Supabase](https://supabase.com/)에서 새 프로젝트를 만듭니다.
2. Supabase Dashboard의 **SQL Editor**를 열고 이 폴더의 `supabase-schema.sql` 전체를 실행합니다.
3. Dashboard의 **Project Settings → API**에서 다음 두 값을 확인합니다.
   - Project URL
   - Publishable key 또는 legacy `anon` key
4. `cloud-config.js`에 두 값을 넣습니다.

```js
window.QTCELL_CLOUD = Object.freeze({
  supabaseUrl: "https://프로젝트-ID.supabase.co",
  supabaseAnonKey: "공개용-Publishable-key",
  bucket: "qtcell-files",
});
```

`service_role` 키는 관리자 권한 전체를 가진 비밀키이므로 브라우저 코드나 GitHub에 절대 넣지 마세요.

## 기존 브라우저 자료 옮기기

Supabase 연결 후, 자료를 원래 등록했던 컴퓨터에서 사이트를 다시 엽니다.

1. `관리자`를 누릅니다.
2. 관리자 비밀번호를 입력합니다.
3. **공유 저장소 → 기존 자료를 공유 저장소로 옮기기**를 누릅니다.
4. 완료 안내가 나오면 다른 컴퓨터에서 GitHub Pages 주소를 새로고침합니다.

이 작업은 기존 `localStorage` 목록과 IndexedDB 첨부 파일을 Supabase로 한 번에 복사합니다. 같은 자료 ID는 덮어쓰므로 다시 눌러도 목록이 중복되지 않습니다.

## GitHub Pages 재배포

다음 변경 파일을 `QTCELL` 저장소에 올립니다.

- `index.html`
- `app.js`
- `reader.js`
- `cloud-config.js`
- `styles.css`
- `assets/` 폴더
- `supabase-schema.sql`과 `README.md`는 운영 참고용

Git을 사용하는 경우:

```powershell
git add index.html app.js reader.js cloud-config.js styles.css assets supabase-schema.sql README.md
git commit -m "Add shared Supabase storage"
git push origin main
```

GitHub의 **Settings → Pages**에서 배포 소스가 `main` 브랜치의 `/ (root)`인지 확인합니다. 배포가 끝나면 `https://raomedon-art.github.io/QTCELL/#library`를 새로고침합니다.

## 로컬 실행

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

접속 주소는 `http://127.0.0.1:8765`입니다.

## 무료 AI 본문 듣기

기기 기본 음성 대신 **Supertonic 3** 한국어 AI 모델을 PC용 ONNX 엔진으로 실행하며, 로컬 엔진이 없으면 브라우저 전용 Worker를 사용합니다. API 키·사용료·외부 음성 서버가 필요 없습니다. 본문 텍스트와 생성한 음성은 기기 밖으로 전송하지 않습니다. AI 생성 음성임을 화면에 표시합니다.

- PC용 ONNX Runtime 1.23.2 가속을 우선 사용. 로컬 서버 시작 시 모델을 메모리에 미리 올리고, 브라우저에서는 같은 출처의 /api/voice로 짧은 구간만 요청. 127.0.0.1에만 바인딩하며 외부 Origin과 잘못된 Host/요청 크기를 거부
- 여성 F1/F2, 남성 M1/M2 목소리와 미리 듣기
- 기본 0.9배, 음높이를 유지하는 재생 속도 변경
- 실제 오디오의 멈춘 위치부터 이어 듣기, 정지, 화면 이동 시 취소
- 기존 `~` → ‘에서’, 하이픈 무음, 장·절 한자어 숫자 발음 유지
- 앞부분 2개 이상·약 6초 분량(짧은 구간은 최대 4개)이 준비되면 먼저 재생. PC 가속이 실제 음성 길이보다 충분히 빠르면 약 6초 분량의 첫 구간부터 시작. 재생 중 최대 60초까지 계속 선행 생성하고 다음 오디오는 미리 로드. 전체 본문 생성 완료를 기다리지 않음. 생성이 재생보다 느린 기기에서는 버퍼가 소진되면 자동으로 대기 후 이어 재생
- 계산 8회에서 공식 예제 기본 수준인 5회로 조정. 격리된 환경에서 최대 4개 WASM 스레드 사용, 지원되지 않으면 1개로 동작. 상세 본문을 열면 저장된 전체 음성이 없을 때 모델 미리 초기화
- 이미 저장된 구간/전체 음성은 이전 버전의 자료까지 재사용. 전체 생성이 끝나면 하나의 WAV도 저장하여 다음 재생에 사용. 저장 작업은 첫 재생을 막지 않음
- 부드럽게 읽기는 구간 사이 최대 160ms 쉼을 오디오에 포함. 속도 조절은 다시 생성하지 않고 적용
- 완성된 전체 음성과 생성 중 완료된 구간을 IndexedDB에 저장. 준비 취소 후 재시도 시 완료 구간을 재사용하고, 같은 본문·목소리·읽기 방식의 전체 음성은 바로 재생. 총 512MB를 넘으면 오래된 저장 항목부터 삭제하며 브라우저에서 저장 자료를 지우면 다시 준비해야 함. 저장 실패 시에도 현재 페이지에서 재생 가능
- 브라우저 방식에서는 모델 약 398MB와 실행 파일 약 14MB: 처음 사용 시 불러오고 브라우저 Cache Storage에 모델 보관. 저장 공간 제한 시 캐시 없이 동작

`index.html`은 `speech-text.js`, `audio-track.js`, `reader-stream.js`, `reader-ai.js`, `voice-worker.mjs`와 `assets/tts/`를 사용합니다. 기존 `reader.js`는 더 이상 로드하지 않으며 기기 음성으로 자동 전환하지 않습니다. 이미지 및 첨부 문서 OCR은 포함하지 않습니다.

### 설치와 실행

모델 파일이 없는 새 설치에서는 PowerShell에서 `./install-voice-model.ps1`을 실행합니다. 공식 저장소에서 고정 버전을 내려받고 ONNX 파일의 LFS SHA-256과 대조합니다. PC 가속을 설치하려면 `python -m pip install --target native-deps -r requirements-voice.txt`를 실행한 뒤 `python serve.py`로 실행합니다. 네이티브 실행용 `native_voice.py`, `supertonic_helper.py`도 필요합니다. 이 로컬 서버는 127.0.0.1:8765에만 바인딩하며 COOP same-origin / COEP credentialless 헤더로 WASM 멀티스레드를 활성화합니다. 기존 단순 HTTP 서버는 단일 스레드로만 동작합니다. HTTPS 또는 localhost의 최신 Chrome/Edge를 권장합니다. 첫 초기화와 합성 시간은 기기 성능에 따라 달라집니다.

공개 사이트 배포 시에는 전체 `assets/tts/`도 접근 가능해야 합니다. 대형 ONNX 파일은 일반 GitHub 파일 제한을 넘으므로 GitHub Pages에 코드만 올리면 재생되지 않습니다. 모델 파일을 별도 정적 파일 호스팅에서 제공하도록 배포 구성을 추가해야 합니다. 현재 적용 범위는 로컬 사이트입니다.

### 모델과 이용 조건

- 공식 모델: https://huggingface.co/supertone-oss-archive/supertonic-3 (revision `aafc6e32416a594460b32413efc49d7fe4ce6d46`)
- 공식 코드: https://github.com/supertone-oss-archive/supertonic (revision `1e9799e964ea4c0dad7cde993b65c3c813a7b373`)
- ONNX Runtime Web 1.30.0 / MIT. 모델 라이선스는 OpenRAIL-M이며 `assets/tts/model/LICENSE`를 함께 제공합니다. 샘플 코드 및 런타임 MIT 고지도 포함합니다.
- 모델 원저장소는 보관 상태이며 업데이트·지원이 종료되었습니다. 버전 및 체크섬을 고정하고 모델은 데이터 파일로만 사용합니다. 사람 음성의 녹음이 아닌 AI 생성물이며 오독 가능성이 있으므로 중요한 구절은 본문과 함께 확인하세요.

## 운영 전 보안 주의

현재 이름 입력 방식은 화면용 간편 입장으로, 실제 사용자 인증이 아닙니다. 제공된 SQL 정책은 기존 UI를 유지하면서 기기 간 공유를 먼저 해결하기 위한 구성입니다. 교회 내부의 민감한 자료를 실제 운영할 때는 Supabase Auth 개인 계정과 `authenticated` 전용 RLS 정책으로 바꿔야 합니다.

PC 실행 코드는 같은 고정된 Supertonic 소스의 `py/helper.py`를 사용하며 MIT 라이선스가 적용됩니다. ONNX Runtime은 MIT이며 설치 패키지의 라이선스 파일을 함께 보관합니다. 로컬 API는 본문이나 생성 음성을 로그에 남기지 않고 응답을 저장하지 않으며, 기존 브라우저 IndexedDB 캐시를 재사용합니다.
