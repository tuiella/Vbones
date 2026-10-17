# Vbones

분리된 SD 캐릭터 PNG를 브라우저에 올려서 파츠 배치, Pivot, 부모관계, Pose, 간단한 애니메이션, Squash & Stretch를 빠르게 테스트하는 무료 로컬 웹앱.

기본 사용은 서버·로그인·클라우드가 필요 없습니다. 모든 이미지와 데이터는 브라우저 안에서 처리됩니다. LLM 제어가 필요할 때만 선택적으로 로컬 MCP 브리지를 실행할 수 있습니다.

## 바로 사용 (설치 없음)

https://tuiella.github.io/vbones/

`main` 브랜치에 푸시하면 GitHub Actions가 자동으로 빌드해서 위 주소에 배포합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 표시된 주소(기본 http://localhost:5173)를 엽니다. 배포용 빌드는 `npm run build` (결과: `dist/`, 정적 호스팅 가능).

## 1분 시작

1. 파츠 PNG/WebP 여러 개를 캔버스에 드래그 앤 드롭 (또는 **데모 캐릭터 불러오기**).
2. 캐릭터를 클릭해서 파츠 선택 → 드래그로 이동.
3. 타임라인의 **Preset** (Idle / Squash / Stretch / Attack / Hit / Bounce) 클릭 → 바로 재생.

### 파일 이름 규칙 (자동 설정)

- 파일 이름이 레이어 이름이 됩니다. `Head`, `Body`, `Arm_L`, `Leg_R`, `Hand_R`, `Hair_Front`, `Hair_Back`, `Eye`, `Mouth`, `Weapon`/`Sword` 등을 인식해서 **Role, Pivot, 부모 관계, 그리기 순서**를 자동으로 잡습니다. Hair 레이어는 Spring이 켜진 상태로 들어옵니다.
- 표정 변형: `Eye@Blink.png`, `Mouth@Open.png` 처럼 `@` 뒤에 이름을 붙이면 같은 레이어의 Variant로 등록됩니다.
- 모든 파츠를 같은 크기의 캔버스(예: 512×512)로 내보내면 위치가 그대로 맞춰집니다.

## 조작

| 동작 | 방법 |
|---|---|
| 이동 / 회전 / 스케일 / 피벗 | `W` / `E` / `R` / `P` |
| Shift | 이동 미세 조절 · 회전 15° 스냅 · 스케일 균일 |
| 줌 / 팬 | 마우스 휠 / 중클릭 드래그 또는 `Space`+드래그 |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` (또는 `Ctrl+Y`) |
| 복제 / 삭제 | `Ctrl+D` / `Delete` |
| 키프레임 | `K` (선택 레이어), 타임라인의 Key All |
| 재생 / 정지 | `Enter` 또는 툴바 Play / Stop |

- **Layers (왼쪽)**: 위가 앞쪽. 드래그로 순서 변경, 더블클릭으로 이름 변경, 눈/자물쇠 아이콘으로 Show/Hide·Lock.
- **Inspector (오른쪽)**
  - *Layer*: 이름, Parent, Role, Transform 숫자 입력, Pivot, 표정 Variant, Left 이미지, Spring.
  - *Pose*: 현재 상태를 Pose로 저장 / 적용 / 이름 변경 / 복제 / 삭제.
  - *Squash*: 슬라이더로 Role별 Squash ↔ Stretch 실시간 미리보기, Setup 포즈에 적용 또는 키로 기록.
  - *Scene*: 좌우 방향(Mirror / Sprite Set 모드), 이름 기준 Auto Parent, 데모, 새 프로젝트.
- **Timeline (아래)**: `● Animate`를 켜면 캔버스·Inspector에서 바꾼 값이 현재 프레임의 키로 기록됩니다. 끄면 기본(Setup) 포즈를 편집합니다. 키 다이아몬드를 드래그해서 프레임 이동, 클릭 후 Easing 선택 (Linear, Ease In, Ease Out, Ease In Out, Ease Out Back). 초록 키 = 표정 교체 키.
- **Pivot**은 Setup 모드에서만 편집합니다. 피벗을 옮겨도 이미지와 자식은 제자리에 있습니다.

## 저장 / 내보내기

- **Save**: `project.json` + `images/` 를 담은 ZIP. **Load**로 ZIP 또는 JSON을 불러옵니다.
- **JSON**: 이미지 없이 `project.json`만 저장. JSON을 불러온 뒤 같은 파일 이름의 이미지를 드롭하면 자동으로 연결됩니다.
- **Export PNG**: 현재 프레임을 캐릭터 영역만 잘라 저장 (배경 Checker면 투명).
- **Export WebM**: 현재 클립을 녹화해서 저장 (Chrome / Edge / Firefox).

## MCP / LLM 제어

Vbones는 선택적으로 로컬 MCP 서버를 통해 Claude Code, Cursor, Codex 등 MCP 클라이언트에서 조작할 수 있습니다.

MCP 모드는 **로컬 개발 서버에서 사용**하는 것을 전제로 합니다. GitHub Pages의 HTTPS 페이지는 브라우저 보안 정책 때문에 로컬 `ws://` 브리지와 연결하지 않습니다.

### 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. 로컬 주소에서는 Vbones가 자동으로 `ws://127.0.0.1:3210` MCP 브리지 연결을 시도합니다.

MCP 클라이언트에는 다음과 같이 등록합니다. 경로는 자신의 Vbones 저장소 절대경로로 바꿉니다.

```json
{
  "mcpServers": {
    "vbones": {
      "command": "node",
      "args": ["/absolute/path/to/Vbones/mcp/server.mjs"],
      "cwd": "/absolute/path/to/Vbones"
    }
  }
}
```

클라이언트가 MCP 서버를 직접 실행하지 않는 환경에서 수동 확인하려면 `npm run mcp`를 사용할 수 있습니다. MCP 서버는 stdio를 프로토콜 채널로 사용하므로 별도 터미널 로그는 stderr에만 출력됩니다.

브리지 포트를 바꾸려면 MCP 프로세스에 `VBONES_MCP_PORT` 환경변수를 지정합니다.

### 보안

- 브리지는 `127.0.0.1`에서만 열리고, **로컬 페이지(Origin이 `http://localhost` / `127.0.0.1`)만** 접속할 수 있습니다. 다른 웹사이트는 연결이 거부됩니다. 다른 주소에서 쓰려면 `VBONES_ALLOWED_ORIGINS=http://my-host:5173` 처럼 지정합니다.
- MCP 서버는 실행할 때마다 무작위 토큰을 만들어 저장소 루트의 `.vbones-mcp-token`에 기록합니다(git 제외). Vbones 개발 서버가 같은 출처의 페이지에만 이 토큰을 전달하고, 토큰이 없으면 브리지 연결이 거부됩니다.
- `vbones_import_images`의 `paths`는 `.png .webp .jpg .jpeg .gif` 확장자이면서 실제 이미지 시그니처를 가진 20MB 이하 파일만 읽습니다.
- Vbones 탭은 하나만 명령을 받습니다. 새 탭을 열면 그 탭으로 넘어가고, 이전 탭은 연결이 해제됩니다.

### MCP 도구

| Tool | 역할 |
|---|---|
| `vbones_get_state` | 현재 Rig, Layer, Pose, Clip, 재생 상태 읽기 |
| `vbones_get_layers` | 레이어·부모·Role·Transform·Pivot 목록 읽기 |
| `vbones_import_images` | 로컬 이미지 경로 또는 base64 이미지 업로드 (한 번에 묶어서 가져오므로 드래그 앤 드롭과 같은 순서·부모·표정 처리) |
| `vbones_auto_rig` | 파일명/Role 추론으로 자동 부모관계 설정 |
| `vbones_rig_layer` | 레이어 Role과 Parent 지정 |
| `vbones_set_parent` | 부모 관계 지정/해제 |
| `vbones_set_pivot` | 이미지 로컬 픽셀 좌표로 Pivot 지정 |
| `vbones_set_anchor` | 0~1 정규화 좌표로 Anchor/Pivot 지정. 기본은 그림이 있는(불투명) 영역 기준, `space: "image"`면 이미지 전체 기준 |
| `vbones_set_transform` | 위치·회전·스케일·투명도·표시 상태 변경. Animate 모드에서는 현재 프레임 키로 기록 (`target`: `auto`/`setup`/`key`) |
| `vbones_create_pose` | 현재 화면을 Pose로 저장 |
| `vbones_apply_pose` | 저장한 Pose 적용 |
| `vbones_create_basic_animation` | Idle/Squash/Stretch/Attack/Hit/Bounce 프리셋 생성 |
| `vbones_add_keyframe` | 레이어 키프레임 생성/수정 |
| `vbones_playback` | Play/Stop/Seek |

예를 들어 LLM에 다음처럼 요청할 수 있습니다.

> Head의 앵커를 목 위치인 (0.5, 0.95)로 잡고 Body의 자식으로 연결해. 오른팔은 Body에 연결하고 어깨 앵커를 (0.5, 0.1)로 잡아. 그 다음 Attack 애니메이션을 만들어서 재생해.

이미지 파일명이 `Head.png`, `Body.png`, `Arm_R.png`처럼 의미를 포함하면 `vbones_import_images` → `vbones_auto_rig`만으로 기본 Role, Pivot, 부모관계를 빠르게 구성할 수 있습니다.


## 범위

Transform 계층 기반 컷아웃 애니메이션 테스트 툴입니다. Bone weight, 메시 변형, 게임 엔진·Spine 내보내기는 포함하지 않습니다.

기술: React 18 + TypeScript + Vite, HTML Canvas 2D, JSZip.
