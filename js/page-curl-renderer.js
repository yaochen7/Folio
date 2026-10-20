import { curlShape } from './page-curl.js';

const COLUMNS = 192, ROWS = 64;
const VERTEX = `
attribute vec2 aUV;
uniform vec2 uPage, uViewport, uOrigin;
uniform float uFold, uRadius, uTilt;
varying vec2 vUV;
varying vec3 vNormal;
void main() {
  vec2 p = aUV * uPage;
  float c = cos(uTilt), s = sin(uTilt);
  float u = p.x*c - (p.y-uPage.y*.5)*s;
  float v = p.x*s + (p.y-uPage.y*.5)*c;
  float angle = uRadius > .0001 ? clamp((u-uFold)/uRadius, 0., 3.14159265) : (u > uFold ? 3.14159265 : 0.);
  float x = u, z = 0.;
  if (u > uFold) {
    if (angle >= 3.1415926) { x = 2.*uFold + 3.14159265*uRadius-u; z = 2.*uRadius; }
    else { x = uFold + uRadius*sin(angle); z = uRadius*(1.-cos(angle)); }
  }
  vec2 position = vec2(x*c+v*s, -x*s+v*c+uPage.y*.5) + uOrigin;
  float w = 1.-z/2200.;
  gl_Position = vec4((position.x/uViewport.x*2.-1.), (1.-position.y/uViewport.y*2.), -z/1000., w);
  vNormal = vec3(-sin(angle)*c, sin(angle)*s, cos(angle));
  vUV = aUV;
}`;
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uFront, uBack;
varying vec2 vUV;
varying vec3 vNormal;
void main() {
  vec4 paper = gl_FrontFacing ? texture2D(uFront,vUV) : texture2D(uBack,vec2(1.-vUV.x,vUV.y));
  if (paper.a < .01) discard;
  vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 lamp = normalize(vec3(-.3,-.2,1.));
  float light = .86 + .14*clamp(dot(normal,lamp)/lamp.z,0.,1.);
  float rim = pow(max(0.,1.-abs(normal.z)),4.)*.015;
  gl_FragColor = vec4(paper.rgb*light + rim, paper.a);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Page shader unavailable.'); }
  return shader;
}

// Rasterize the browser's already-paginated words at their measured positions.
// Fonts remain local: no HTML screenshots, network images, or foreignObject SVG.
function rasterPage(stage, page, width, height, scale) {
  const source = document.createElement('div');
  source.className = 'fr-raster-source';
  source.style.width = `${width}px`;
  source.style.height = `${height}px`;
  source.setAttribute('aria-hidden', 'true');
  source.append(page);
  stage.append(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(page).backgroundColor;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, width, height, 4);
    else ctx.rect(0, 0, width, height);
    ctx.fill();
    const origin = page.getBoundingClientRect();
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const style = getComputedStyle(node.parentElement);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.fillStyle = style.color;
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const range = document.createRange();
      for (const match of node.textContent.matchAll(/\S+/gu)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = [...range.getClientRects()];
        const draw = (text, rect) => {
          if (style.textTransform === 'uppercase') text = text.toUpperCase();
          const metrics = ctx.measureText(text);
          const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * .9;
          const descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * .2;
          ctx.fillText(text, rect.left - origin.left, rect.top - origin.top + (rect.height - ascent - descent) / 2 + ascent);
        };
        if (rects.length === 1) draw(match[0], rects[0]);
        else {
          let text = '', bounds = null;
          for (let i = 0; i < match[0].length; i++) {
            range.setStart(node, match.index + i);
            range.setEnd(node, match.index + i + 1);
            const rect = range.getBoundingClientRect();
            if (bounds && Math.abs(rect.top - bounds.top) > 2) { draw(text, bounds); text = ''; bounds = null; }
            bounds ||= rect;
            text += match[0][i];
          }
          if (bounds) draw(text, bounds);
        }
      }
    }
    return canvas;
  } finally { source.remove(); }
}

export function createPageCurlRenderer(stage, onLost) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fr-curl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, premultipliedAlpha: true });
  if (!gl) return null;
  let program, vertexShader, fragmentShader;
  try {
    vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX);
    fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Page program unavailable.');
  } catch {
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const vertices = [], indices = [];
  for (let y = 0; y <= ROWS; y++) for (let x = 0; x <= COLUMNS; x++) vertices.push(x / COLUMNS, y / ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLUMNS; x++) {
    const i = y * (COLUMNS + 1) + x;
    indices.push(i, i + COLUMNS + 1, i + 1, i + 1, i + COLUMNS + 1, i + COLUMNS + 2);
  }
  const vertexBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'aUV');
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['uPage', 'uViewport', 'uOrigin', 'uFold', 'uRadius', 'uTilt', 'uFront', 'uBack'].map(name => [name, gl.getUniformLocation(program, name)]));
  gl.uniform1i(uniforms.uFront, 0);
  gl.uniform1i(uniforms.uBack, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const textures = new Map();
  let lost = false;
  const contextLost = event => { event.preventDefault(); lost = true; onLost(); };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.hidden = true;
  stage.append(canvas);
  return {
    triangleCount: indices.length / 3,
    prepare(page, key, width, height) {
      if (lost) return null;
      if (textures.has(key)) { const texture = textures.get(key); textures.delete(key); textures.set(key, texture); return texture; }
      const scale = Math.min(2, gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(width, height));
      const image = rasterPage(stage, page, width, height, scale);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      textures.set(key, texture);
      if (textures.size > 10) { const first = textures.keys().next().value; gl.deleteTexture(textures.get(first)); textures.delete(first); }
      return texture;
    },
    paint({ progress, grab, width, height, originX, originY, front, back }) {
      if (lost || !front || !back) return false;
      const viewportWidth = stage.clientWidth, viewportHeight = stage.clientHeight;
      const scale = Math.min(2, Math.max(1.5, devicePixelRatio || 1));
      const pixelWidth = Math.round(viewportWidth * scale), pixelHeight = Math.round(viewportHeight * scale);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const { fold, radius } = curlShape(progress, width);
      gl.uniform2f(uniforms.uPage, width, height);
      gl.uniform2f(uniforms.uViewport, viewportWidth, viewportHeight);
      gl.uniform2f(uniforms.uOrigin, originX, originY);
      gl.uniform1f(uniforms.uFold, fold);
      gl.uniform1f(uniforms.uRadius, radius);
      gl.uniform1f(uniforms.uTilt, grab * .14 * Math.sin(Math.PI * progress));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, front);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, back);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      canvas.hidden = false;
      return true;
    },
    hide() { canvas.hidden = true; },
    dispose() {
      canvas.removeEventListener('webglcontextlost', contextLost);
      for (const texture of textures.values()) gl.deleteTexture(texture);
      textures.clear();
      gl.deleteBuffer(vertexBuffer); gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
      canvas.remove();
    }
  };
}
