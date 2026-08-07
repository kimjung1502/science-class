"""개인정보처리방침.md 하나로 두 산출물을 만든다.

  python build_privacy.py

  → 개인정보처리방침.pdf : 학운위·에듀집 심의 제출용 (A4 인쇄 레이아웃)
  → privacy.html         : 법 제30조제2항이 요구하는 공개 페이지 (로그인 불필요)

마크다운이 유일한 원본이다. 방침을 고칠 때는 .md 만 고치고 이 스크립트를 다시 돌린다.
둘을 따로 손대면 심의에서 대조할 때 어긋난다.

의존: pip install markdown  /  Chrome (PDF 인쇄에만 사용)
"""
import pathlib, subprocess, sys, markdown

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / '개인정보처리방침.md'
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# ── 인쇄용(PDF) 스타일 ────────────────────────────────────────────────
PRINT_CSS = """
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Malgun Gothic", sans-serif; font-size: 10.5pt; line-height: 1.75;
       color: #1c1c1c; margin: 0; word-break: keep-all; }
h1 { font-size: 21pt; text-align: center; margin: 0 0 6mm; letter-spacing: -.02em;
     padding-bottom: 4mm; border-bottom: 2.5px solid #1f3f66; }
h2 { font-size: 13pt; color: #1f3f66; margin: 9mm 0 3mm; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 5mm 0 2mm; page-break-after: avoid; }
p, li { margin: 0 0 2.5mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
blockquote { margin: 0 0 3.5mm; padding: 2mm 3mm; background: #f2f4f7;
             border-left: 3px solid #8fa3bd; font-size: 9pt; color: #4a5568; }
blockquote p { margin: 0; }
table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.5pt;
        page-break-inside: avoid; }
th { background: #1f3f66; color: #fff; text-align: left; font-weight: 600; }
th, td { border: 1px solid #c3ccd8; padding: 2mm 2.5mm; vertical-align: top; }
tr:nth-child(even) td { background: #f7f9fb; }
hr { border: 0; border-top: 1px solid #c3ccd8; margin: 8mm 0 4mm; }
p:has(> em:only-child) { font-size: 8.5pt; color: #6b7280; margin-top: -0.5mm; }
p:has(> em:only-child) em { font-style: normal; }
"""

# ── 공개 페이지(privacy.html) — 사이트 테마(실험노트) 위에 얹는다 ──────
SITE_CSS = """
.policy { max-width: 52rem; margin: 0 auto; }
.policy h1 { font-size: 2rem; font-weight: 800; letter-spacing: -.03em; color: #16213E;
             margin: 0 0 1.2rem; padding-bottom: .8rem; border-bottom: 2px solid #16213E; }
.policy h1 + p, .policy h1 ~ p:nth-of-type(-n+3) { margin-bottom: .35rem; }
.policy h2 { font-size: 1.15rem; font-weight: 800; letter-spacing: -.02em;
             margin: 2.6rem 0 .9rem; padding-top: 1.4rem; border-top: 1px solid #E7E4D6; }
.policy h2:first-of-type { border-top: 0; padding-top: 0; }
.policy h3 { font-size: .95rem; font-weight: 700; margin: 1.4rem 0 .5rem; }
.policy p, .policy li { font-size: .92rem; line-height: 1.85; color: #2C3A5E; }
.policy p { margin: 0 0 .8rem; }
.policy ul, .policy ol { margin: 0 0 1rem; padding-left: 1.35rem; }
.policy li { margin: 0 0 .3rem; }
.policy ul li { list-style: disc; }
.policy ol li { list-style: decimal; }
.policy strong { font-weight: 700; color: #16213E; }
.policy blockquote { margin: 0 0 1rem; padding: .55rem .85rem; background: #F4F2E9;
                     border-left: 3px solid #C4E000; border-radius: .25rem;
                     font-size: .78rem; color: #5A6379; }
.policy blockquote p { margin: 0; font-size: .78rem; }
/* 표는 좁은 화면에서 가로 스크롤 (4열 위탁표 대응) */
.policy .tw { overflow-x: auto; margin: 0 0 1.2rem; -webkit-overflow-scrolling: touch; }
.policy table { border-collapse: collapse; width: 100%; min-width: 34rem; font-size: .83rem; }
.policy th { background: #16213E; color: #C4E000; text-align: left; font-weight: 700;
             white-space: nowrap; }
.policy th, .policy td { border: 1px solid #E7E4D6; padding: .5rem .65rem;
                         vertical-align: top; line-height: 1.6; }
.policy tbody tr:nth-child(even) td { background: #FBFAF6; }
.policy hr { border: 0; border-top: 1px solid #E7E4D6; margin: 2rem 0 1.2rem; }
.policy a { color: #16213E; text-decoration: underline; text-underline-offset: 2px; }
.policy a:hover { color: #FF5B24; }
/* 근거 법조문 줄 */
.policy p:has(> em:only-child) { font-size: .75rem; color: #5A6379; margin-top: -.3rem; }
.policy p:has(> em:only-child) em { font-style: normal; }
@media print { .noprint { display: none !important; } }
"""

PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta content="width=device-width, initial-scale=1.0" name="viewport">
<title>개인정보 처리방침 · 정환쌤과 함께하는 과학 수업</title>
<meta name="description" content="과학 수업 지원 사이트의 개인정보 처리방침. 수집 항목, 보유기간, 위탁, 국외 이전, 정보주체의 권리를 안내합니다.">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<script src="js/theme.js?v=20260724c"></script>
<style>%(css)s</style>
</head>
<body class="font-sans text-ink antialiased min-h-screen flex flex-col">

<header class="sticky top-0 z-50 border-b border-ink/15 bg-paper/85 backdrop-blur-md noprint">
  <div class="mx-auto flex h-16 max-w-max-width items-center justify-between gap-2 px-4 sm:px-5 w-full">
    <a href="index.html" class="flex items-center gap-2.5 min-w-0 flex-1">
      <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-lime font-mono text-sm font-bold">LAB</span>
      <div class="leading-tight min-w-0">
        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">Science Class</div>
        <h1 class="font-bold tracking-tightest text-[15px] truncate">정환쌤과 함께하는 과학 수업</h1>
      </div>
    </a>
    <a href="개인정보처리방침.pdf" class="font-mono text-[12px] text-ink3 hover:text-signal border border-faint rounded-md px-3 py-1.5 shrink-0">PDF 내려받기</a>
  </div>
</header>

<main class="flex-1 px-5 py-10 sm:py-12">
  <div class="policy">
    <div class="pin-label inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-bold text-lime shadow-note mb-5 noprint">
      <span class="text-signal">●</span> 법적 고지
    </div>
%(body)s
  </div>
</main>

<footer class="border-t border-ink/15 bg-paper2/60 px-5 py-6 noprint">
  <div class="policy font-mono text-[11px] text-ink3 flex flex-wrap gap-x-4 gap-y-1">
    <span>정환쌤과 함께하는 과학 수업</span>
    <span>개인정보 보호책임자 김정환 · kimjung1502@gmail.com</span>
  </div>
</footer>

</body>
</html>
"""


def main():
    md = SRC.read_text(encoding='utf-8')
    body = markdown.markdown(md, extensions=['tables', 'sane_lists'])

    # 공개 페이지: 표를 가로 스크롤 상자로 감싼다 (모바일에서 4열 표가 넘칠 때)
    site_body = body.replace('<table>', '<div class="tw"><table>').replace('</table>', '</table></div>')
    (ROOT / 'privacy.html').write_text(
        PAGE % {'css': SITE_CSS, 'body': site_body}, encoding='utf-8')
    print('생성: privacy.html')

    # 심의 제출용 PDF
    tmp = ROOT / '_print.tmp.html'
    tmp.write_text(f"<!doctype html><meta charset='utf-8'><style>{PRINT_CSS}</style>{body}",
                   encoding='utf-8')
    try:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                        f'--print-to-pdf={ROOT / "개인정보처리방침.pdf"}', tmp.as_uri()],
                       check=True)
        print('생성: 개인정보처리방침.pdf')
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print(f'PDF 생략(Chrome 없음/실패): {e}', file=sys.stderr)
    finally:
        tmp.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
