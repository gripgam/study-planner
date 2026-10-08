# 나의 스터디 플래너

설치형 PWA로 동작하는 정적 웹 앱입니다. 별도 의존성이나 빌드는 필요하지 않습니다.

## 실행

정적 웹 서버로 이 폴더를 제공하세요. 서비스 워커는 `file://` 주소에서 동작하지 않습니다.

```powershell
python -m http.server 8080
```

개발 중에는 `http://localhost:8080`에서 확인할 수 있습니다. 스마트폰 설치와 서비스 워커는 HTTPS 배포 주소에서 사용하세요.

## 배포 및 설치

이 폴더의 파일을 HTTPS를 지원하는 정적 호스팅(예: GitHub Pages, Netlify, Cloudflare Pages)에 그대로 배포합니다. 배포 경로가 하위 경로라면 `manifest.webmanifest`의 `start_url`, `scope`와 HTML의 자산 경로를 그 경로에 맞춰 조정해야 합니다.

- Android Chrome: 배포 주소를 열고 설정의 **홈 화면에 설치**를 누르거나 브라우저 메뉴에서 **앱 설치/홈 화면에 추가**를 선택합니다.
- iPhone Safari: 공유 버튼 → **홈 화면에 추가**를 선택합니다.

설치를 위해서는 스마트폰에서 접근할 수 있는 HTTPS 주소가 필요합니다. 앱은 기기 브라우저의 localStorage에 계획을 저장하므로 설정에서 JSON 백업을 내려받아 보관할 수 있습니다.

## 20분 전 푸시 알림 서버

앱을 닫은 상태의 알림은 정적 파일만으로는 받을 수 없습니다. 이 저장소의 `server.js`는 Web Push 구독과 서버 예약 작업을 제공합니다. 서버는 구독 정보, 기기별 인증 토큰의 해시, 알림에 필요한 일정 제목·시간·반복 정보만 SQLite에 저장합니다. 일정 전체나 브라우저 localStorage는 서버에 전송하지 않습니다.

1. Node.js 20 이상 환경에서 `npm install`을 실행합니다.
2. `.env.example`을 `.env`로 복사하고 `npx web-push generate-vapid-keys`로 만든 VAPID 공개/개인 키와 관리자 메일 주소를 입력합니다. 개인 키는 절대 클라이언트 파일이나 저장소에 넣지 마세요.
3. 앱과 같은 HTTPS 도메인에 서버를 프록시하거나, 별도 HTTPS 도메인에 배포한 뒤 `config.js`의 `window.PLANNER_API_BASE`를 그 서버 주소로 설정합니다. `.env`의 `APP_ORIGIN`에는 PWA의 HTTPS 주소를, 별도 도메인이라면 `CORS_ORIGIN`에는 앱의 정확한 원본을 입력합니다.
4. 영속 디스크가 있는 환경에서 `npm start`로 서버를 실행합니다. 서버가 계속 실행되어야 예약 검사가 동작합니다.

Android의 지원 브라우저는 앱 설정에서 알림을 켜고 권한을 허용합니다. iPhone은 iOS 16.4 이상에서 홈 화면에 설치한 웹 앱을 통해서만 웹 푸시를 지원합니다. 인터넷 연결, 권한, 절전 모드, 운영체제 정책에 따라 알림이 지연되거나 도착하지 않을 수 있습니다.

## 공개 배포

정적 앱(`index.html`, `app.js`, `goals.js`, `onboarding.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`)은 HTTPS 정적 호스팅에 배포합니다. API는 `Dockerfile`과 `docker-compose.yml`로 별도 서버에 배포할 수 있으며, SQLite 데이터 볼륨을 영속적으로 유지해야 합니다. 정적 앱의 `config.js`에 `window.PLANNER_API_BASE = 'https://api.example.com'`을 설정하고, API의 `.env`에는 PWA 주소를 `APP_ORIGIN`, 동일한 주소를 `CORS_ORIGIN`으로 설정합니다.

공개 URL을 배포한 뒤 Android Chrome에서는 메뉴의 **앱 설치/홈 화면에 추가**를, iPhone Safari에서는 공유 → **홈 화면에 추가**를 사용합니다. 설치와 웹 푸시는 브라우저·운영체제 지원 여부에 따라 제한될 수 있지만, 지원하지 않아도 브라우저에서 기본 플래너와 로컬 백업은 사용할 수 있습니다.
