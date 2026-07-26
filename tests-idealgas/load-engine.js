// 배포되는 HTML 에서 물리 엔진 블록을 그대로 잘라내 Node 에서 평가한다.
// → "테스트가 검증한 코드"와 "학생 화면에서 도는 코드"가 문자 단위로 동일함이 보장된다.
const fs = require('fs');
const path = require('path');

const DEFAULT_HTML = path.join(
  __dirname, '..',
  '실험 수업', '선택_물질과에너지', 'Ⅰ. 물질의 세가지 상태', '1. 기체',
  '이상기체_실험_페이지.html'
);

const BEGIN = '/* ===================== IDEALGAS ENGINE BEGIN =====================';
const END = '/* ===================== IDEALGAS ENGINE END ===================== */';

function extract(htmlPath) {
  const html = fs.readFileSync(htmlPath || DEFAULT_HTML, 'utf8');
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('엔진 블록 마커를 찾지 못했습니다: ' + (htmlPath || DEFAULT_HTML));
  return html.slice(a, b + END.length);
}

function load(htmlPath) {
  const src = extract(htmlPath);
  // 블록은 var IdealGasEngine = (function(){...})(); 하나만 선언한다.
  const factory = new Function(src + '\n;return IdealGasEngine;');
  return { engine: factory(), source: src, htmlPath: htmlPath || DEFAULT_HTML };
}

module.exports = { load, extract, DEFAULT_HTML };
