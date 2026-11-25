# Desktop Planner 개인정보처리방침 / Privacy Policy

최종 수정일 / Last updated: 2026-11-25

## 한국어

Desktop Planner(이하 "앱")는 Windows 바탕화면에서 쓰는 개인용 플래너입니다. 앱은 개발자가 운영하는 서버가 없으며, 사용자의 정보를 개발자나 제3자에게 보내지 않습니다.

**저장하는 정보**
- 할 일, 고정 루틴, 체크 기록, 설정은 사용자 컴퓨터의 `%APPDATA%\desktop-planner\planner-data.json`에만 저장됩니다.

**Google 캘린더 연동 (선택)**
- 사용자가 "Google로 로그인"을 누른 경우에만, Google 캘린더 **읽기 전용 권한**(`calendar.readonly`)과 이메일 주소를 요청합니다.
- 받은 일정은 앱 화면에 표시하는 용도로만 쓰며, 사용자 컴퓨터에만 임시 저장(캐시)됩니다.
- 로그인 토큰은 Windows 암호화(DPAPI)로 사용자 컴퓨터에만 저장됩니다.
- 일정을 수정·삭제하거나 다른 곳으로 전송하지 않습니다.
- 설정의 "연결 해제"를 누르면 토큰이 삭제되고 Google 쪽 권한도 취소됩니다. [Google 계정 권한 페이지](https://myaccount.google.com/permissions)에서도 언제든 취소할 수 있습니다.

**iCal 주소 연동 (선택)**
- 사용자가 입력한 iCal 주소에서 일정을 내려받아 표시하며, 주소는 사용자 컴퓨터에만 저장됩니다.

**Google API 서비스 사용자 데이터 정책 준수**
Desktop Planner가 Google API로부터 받은 정보를 사용하고 다른 앱으로 전송하는 방식은 제한적 사용(Limited Use) 요구사항을 포함한 [Google API 서비스 사용자 데이터 정책](https://developers.google.com/terms/api-services-user-data-policy)을 준수합니다.

**문의**: [GitHub Issues](https://github.com/bylhn/desktop-planner/issues)

## English

Desktop Planner ("the app") is a personal planner for the Windows desktop. The app has no developer-run servers and does not send your information to the developer or any third party.

**Data stored**
- To-dos, routines, completion history and settings are stored only on your computer in `%APPDATA%\desktop-planner\planner-data.json`.

**Google Calendar (optional)**
- Only when you click "Sign in with Google", the app requests **read-only** access to Google Calendar (`calendar.readonly`) and your email address.
- Events are used only to display them in the app and are cached only on your computer.
- Sign-in tokens are stored only on your computer, encrypted with Windows DPAPI.
- The app never modifies, deletes or transfers your events.
- "Disconnect" in Settings deletes the token and revokes access. You can also revoke it any time at [Google Account permissions](https://myaccount.google.com/permissions).

**iCal links (optional)**
- Events are downloaded from the iCal links you enter; the links are stored only on your computer.

**Google API Services User Data Policy**
Desktop Planner's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

**Contact**: [GitHub Issues](https://github.com/bylhn/desktop-planner/issues)
