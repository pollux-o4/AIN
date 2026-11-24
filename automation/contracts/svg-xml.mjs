// <img>로 넣는 SVG는 XML로 해석된다 · 문법 오류 하나면 그림 전체가 비므로 저장 전에 고친다
const STYLE = /(<style\b[^>]*>)(?!\s*<!\[CDATA\[)([\s\S]*?)(<\/style>)/gi;

/** <style> 안 CSS의 &·< 가 XML 문법을 깨지 않게 CDATA로 감싼다 @param {string} svg */
export const xmlSafeSvg = (svg) =>
  svg.replace(STYLE, (_, open, css, close) =>
    css.includes("]]>") ? open + css + close : `${open}<![CDATA[${css}]]>${close}`,
  );
