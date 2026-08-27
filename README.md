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
- `cloud-config.js`
- `styles.css`
- `assets/` 폴더
- `supabase-schema.sql`과 `README.md`는 운영 참고용

Git을 사용하는 경우:

```powershell
git add index.html app.js cloud-config.js styles.css assets supabase-schema.sql README.md
git commit -m "Add shared Supabase storage"
git push origin main
```

GitHub의 **Settings → Pages**에서 배포 소스가 `main` 브랜치의 `/ (root)`인지 확인합니다. 배포가 끝나면 `https://raomedon-art.github.io/QTCELL/#library`를 새로고침합니다.

## 로컬 실행

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

접속 주소는 `http://127.0.0.1:8765`입니다.

## 운영 전 보안 주의

현재 이름 입력 방식은 화면용 간편 입장으로, 실제 사용자 인증이 아닙니다. 제공된 SQL 정책은 기존 UI를 유지하면서 기기 간 공유를 먼저 해결하기 위한 구성입니다. 교회 내부의 민감한 자료를 실제 운영할 때는 Supabase Auth 개인 계정과 `authenticated` 전용 RLS 정책으로 바꿔야 합니다.
