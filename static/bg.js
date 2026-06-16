/* ArcKanban — animated "Neat"-style gradient background.
   A self-contained WebGL fragment shader (domain-warped fbm) — no library,
   no npm, no CDN, nothing fetched. Dark, blobby Prussian glow kept well within
   the dark theme. Falls back to the CSS gradient if WebGL/shader fails;
   honours prefers-reduced-motion; pauses when the tab is hidden. */
(function () {
  "use strict";
  var canvas = document.getElementById("neat-bg");
  if (!canvas) return;
  var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) { canvas.remove(); return; }            // → CSS gradient fallback

  var vsrc = "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }";
  var fsrc = [
    "precision highp float;",
    "uniform vec2 u_res; uniform float u_time;",
    "const vec3 c0=vec3(0.006,0.016,0.038);",   // near-black navy base
    "const vec3 c1=vec3(0.024,0.063,0.140);",   // dark Prussian blue
    "const vec3 c2=vec3(0.020,0.110,0.140);",   // dark teal
    "const vec3 c3=vec3(0.090,0.060,0.190);",   // dark indigo
    "const vec3 c4=vec3(0.035,0.100,0.235);",   // muted blue accent
    "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));vec2 u=f*f*(3.-2.*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}",
    "float fbm(vec2 p){float v=0.,a=0.5;for(int i=0;i<3;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}",  // few octaves = blobby
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/u_res.xy;",
    "  vec2 p=uv*1.05; p.x*=u_res.x/u_res.y;",   // zoomed in = big soft blobs
    "  float t=u_time*0.03;",
    "  vec2 q=vec2(fbm(p+vec2(0.0,t)), fbm(p+vec2(3.4,-t)));",
    "  float f=fbm(p+1.6*q);",                   // gentle single-level warp
    "  vec3 col=c0;",
    "  col=mix(col,c1,smoothstep(0.1,0.9,f));",
    "  col=mix(col,c2,clamp(length(q)*0.8,0.0,1.0));",
    "  col=mix(col,c4,clamp(q.x*q.x*1.2,0.0,1.0));",
    "  col=mix(col,c3,clamp(q.y*0.6,0.0,1.0));",
    "  col*=0.40+0.45*f;",                       // overall dark
    "  float vig=smoothstep(1.35,0.15,length(uv-0.5)); col*=mix(0.5,1.0,vig);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = compile(gl.VERTEX_SHADER, vsrc), fs = compile(gl.FRAGMENT_SHADER, fsrc);
  if (!vs || !fs) { canvas.remove(); return; }
  var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(prog);

  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  var uRes = gl.getUniformLocation(prog, "u_res"), uTime = gl.getUniformLocation(prog, "u_time");

  var SCALE = 0.4;   // render low-res and upscale → inherent soft blur, cheap
  function resize() {
    var w = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * SCALE));
    var h = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * SCALE));
    canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(uRes, w, h);
  }
  window.addEventListener("resize", resize); resize();
  document.body.classList.add("has-neat");

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var start = performance.now(), raf = null, running = false;
  function frame(now) { if (!running) return; gl.uniform1f(uTime, (now - start) / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); raf = requestAnimationFrame(frame); }
  function play() { if (running) return; running = true; start = performance.now() - 14000; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  if (reduce) { gl.uniform1f(uTime, 14.0); gl.drawArrays(gl.TRIANGLES, 0, 3); }   // one static frame
  else { play(); }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else if (!reduce) play(); });
})();
