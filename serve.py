# -*- coding: utf-8 -*-
"""
개발용 로컬 서버 (캐시 끔).

python http.server 는 Cache-Control 헤더를 안 보내서, 브라우저가 옛 HTML을
캐시해 두고 새로고침해도 바뀐 화면이 안 뜨는 일이 생깁니다.
이 서버는 모든 응답에 no-store 를 붙여 항상 최신 파일을 주도록 합니다.

실행:  python serve.py         (기본 8000번 포트)
        python serve.py 8080   (포트 지정)

배포(GitHub Pages)에는 영향 없음 — 개발할 때만 쓰는 스크립트입니다.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = HTTPServer(("127.0.0.1", port), NoCacheHandler)
    print(f"no-cache dev server:  http://localhost:{port}/  (Ctrl+C 로 종료)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버 종료")
